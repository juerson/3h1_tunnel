// src/common/codec.js
function base64Decode(base64Str) {
  let binary = atob(base64Str);
  let bytes = new Uint8Array([...binary].map((char) => char.charCodeAt(0)));
  let decoder = new TextDecoder();
  return decoder.decode(bytes);
}
function sha224(str) {
  if (typeof str !== "string") throw new TypeError("sha224Encrypt: input must be a string");
  const K = [
    1116352408,
    1899447441,
    3049323471,
    3921009573,
    961987163,
    1508970993,
    2453635748,
    2870763221,
    3624381080,
    310598401,
    607225278,
    1426881987,
    1925078388,
    2162078206,
    2614888103,
    3248222580,
    3835390401,
    4022224774,
    264347078,
    604807628,
    770255983,
    1249150122,
    1555081692,
    1996064986,
    2554220882,
    2821834349,
    2952996808,
    3210313671,
    3336571891,
    3584528711,
    113926993,
    338241895,
    666307205,
    773529912,
    1294757372,
    1396182291,
    1695183700,
    1986661051,
    2177026350,
    2456956037,
    2730485921,
    2820302411,
    3259730800,
    3345764771,
    3516065817,
    3600352804,
    4094571909,
    275423344,
    430227734,
    506948616,
    659060556,
    883997877,
    958139571,
    1322822218,
    1537002063,
    1747873779,
    1955562222,
    2024104815,
    2227730452,
    2361852424,
    2428436474,
    2756734187,
    3204031479,
    3329325298
  ];
  const H = [3238371032, 914150663, 812702999, 4144912697, 4290775857, 1750603025, 1694076839, 3204075428];
  function R(x, n) {
    return x >>> n | x << 32 - n;
  }
  const m = new TextEncoder().encode(str);
  const l = m.length * 8;
  const padLen = m.length + 9 + 63 >> 6 << 6;
  const buf = new Uint8Array(padLen);
  buf.set(m);
  buf[m.length] = 128;
  new DataView(buf.buffer).setUint32(buf.length - 4, l, false);
  const w = new Uint32Array(64), h = H.slice();
  for (let i = 0; i < buf.length; i += 64) {
    const view = new DataView(buf.buffer, i, 64);
    for (let j = 0; j < 16; j++) w[j] = view.getUint32(j * 4);
    for (let j = 16; j < 64; j++) {
      const s0 = R(w[j - 15], 7) ^ R(w[j - 15], 18) ^ w[j - 15] >>> 3;
      const s1 = R(w[j - 2], 17) ^ R(w[j - 2], 19) ^ w[j - 2] >>> 10;
      w[j] = w[j - 16] + s0 + w[j - 7] + s1 >>> 0;
    }
    let [a, b, c, d, e, f, g2, hh] = h;
    for (let j = 0; j < 64; j++) {
      const S1 = R(e, 6) ^ R(e, 11) ^ R(e, 25), ch = e & f ^ ~e & g2;
      const temp1 = hh + S1 + ch + K[j] + w[j] >>> 0;
      const S0 = R(a, 2) ^ R(a, 13) ^ R(a, 22), maj = a & b ^ a & c ^ b & c;
      const temp2 = S0 + maj >>> 0;
      [hh, g2, f, e, d, c, b, a] = [g2, f, e, d + temp1 >>> 0, c, b, a, temp1 + temp2 >>> 0];
    }
    h[0] = h[0] + a >>> 0;
    h[1] = h[1] + b >>> 0;
    h[2] = h[2] + c >>> 0;
    h[3] = h[3] + d >>> 0;
    h[4] = h[4] + e >>> 0;
    h[5] = h[5] + f >>> 0;
    h[6] = h[6] + g2 >>> 0;
    h[7] = h[7] + hh >>> 0;
  }
  return h.slice(0, 7).map((x) => x.toString(16).padStart(8, "0")).join("");
}

// src/common/stream.js
var officialSupport = {
  readableStream: typeof ReadableStream !== "undefined",
  transformStream: typeof TransformStream !== "undefined",
  writableStream: typeof WritableStream !== "undefined",
  textDecoderStream: typeof TextDecoderStream !== "undefined",
  textEncoderStream: typeof TextEncoderStream !== "undefined",
  abortSignalTimeout: typeof AbortSignal !== "undefined" && typeof AbortSignal.timeout === "function",
  abortSignalAny: typeof AbortSignal !== "undefined" && typeof AbortSignal.any === "function",
  uint8FromBase64: typeof Uint8Array !== "undefined" && typeof Uint8Array.fromBase64 === "function"
};
function concatBytes(...chunks) {
  let total = 0;
  for (const chunk of chunks) {
    if (chunk) total += chunk.byteLength;
  }
  const out = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    if (!chunk) continue;
    out.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return out;
}
function createTimeoutSignal(ms) {
  if (officialSupport.abortSignalTimeout) return AbortSignal.timeout(ms);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(new DOMException("Timeout expired", "TimeoutError")), ms);
  if (typeof timer === "object" && timer && typeof timer.unref === "function") timer.unref();
  return controller.signal;
}
function createCombinedSignal(signals) {
  const list = signals.filter(Boolean);
  if (officialSupport.abortSignalAny) return AbortSignal.any(list);
  const controller = new AbortController();
  for (const signal of list) {
    if (signal.aborted) {
      controller.abort(signal.reason);
      break;
    }
    signal.addEventListener("abort", () => controller.abort(signal.reason), { once: true });
  }
  return controller.signal;
}
function decodeBase64Bytes(base64Str) {
  if (officialSupport.uint8FromBase64) return Uint8Array.fromBase64(base64Str);
  const binaryStr = atob(base64Str);
  const len = binaryStr.length;
  const bytes = new Uint8Array(len);
  for (let i = 0; i < len; i++) bytes[i] = binaryStr.charCodeAt(i);
  return bytes;
}
function base64ToArrayBuffer(base64Str) {
  if (!base64Str) return { earlyData: null, error: null };
  try {
    const normalized = base64Str.replace(/-/g, "+").replace(/_/g, "/");
    const bytes = decodeBase64Bytes(normalized);
    const buffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
    return { earlyData: buffer, error: null };
  } catch (error) {
    return { earlyData: null, error };
  }
}
function createByteReader(readable) {
  const reader = readable.getReader();
  let pending = new Uint8Array(0);
  const take = (n) => {
    const out = pending.slice(0, n);
    pending = pending.slice(n);
    return out;
  };
  return {
    /** 精确读取 n 个字节，多余的字节留在缓冲区里。 */
    async readExactly(n) {
      while (pending.byteLength < n) {
        const { value, done } = await reader.read();
        if (done) throw new Error("\u8FDE\u63A5\u5728\u8BFB\u53D6\u5B8C\u6210\u524D\u88AB\u4E2D\u65AD");
        pending = concatBytes(pending, value);
      }
      return take(n);
    },
    /**
     * 一直读到 findEnd(buffer) 返回非 -1 为止，返回这段「头部」字节。
     * findEnd 返回的是头部结束位置（不含），其后剩余字节留给转发通道。
     */
    async readUntil(findEnd, { maxBytes = 65536 } = {}) {
      while (true) {
        const end = findEnd(pending);
        if (end !== -1) return take(end);
        if (pending.byteLength > maxBytes) throw new Error("\u54CD\u5E94\u5934\u8FC7\u957F");
        const { value, done } = await reader.read();
        if (done) throw new Error("\u8FDE\u63A5\u5728\u8BFB\u53D6\u5B8C\u6210\u524D\u88AB\u4E2D\u65AD");
        pending = concatBytes(pending, value);
      }
    },
    /**
     * 把「已读到的剩余字节 + socket 后续数据」拼成官方 ReadableStream。
     */
    toReadable() {
      return new ReadableStream({
        async pull(controller) {
          if (pending.byteLength) {
            controller.enqueue(take(pending.byteLength));
            return;
          }
          const { value, done } = await reader.read();
          if (done) controller.close();
          else controller.enqueue(value);
        },
        cancel(reason) {
          return reader.cancel(reason);
        }
      });
    },
    release() {
      try {
        reader.releaseLock();
      } catch {
      }
    }
  };
}
function prependChunk(header, readable) {
  let sent = false;
  return readable.pipeThrough(
    new TransformStream({
      transform(chunk, controller) {
        if (!sent) {
          sent = true;
          controller.enqueue(concatBytes(header, chunk));
          return;
        }
        controller.enqueue(chunk);
      }
    })
  );
}
function pipeSafely(src, dst, { label = "pipe", signal, onError } = {}) {
  return src.pipeTo(dst, signal ? { signal } : void 0).catch((err) => {
    onError?.(err, label);
  });
}

// src/common/blake3.js
var IV = new Uint32Array([1779033703, 3144134277, 1013904242, 2773480762, 1359893119, 2600822924, 528734635, 1541459225]);
var MSG_PERMUTATION = [2, 6, 3, 10, 7, 0, 4, 13, 1, 11, 12, 5, 9, 14, 15, 8];
var CHUNK_START = 1;
var CHUNK_END = 2;
var ROOT = 8;
var DERIVE_KEY_CONTEXT = 32;
var DERIVE_KEY_MATERIAL = 64;
var BLOCK_LEN = 64;
var CHUNK_LEN = 1024;
var rotr = (x, n) => x >>> n | x << 32 - n;
function g(v, a, b, c, d, mx, my) {
  v[a] = v[a] + v[b] + mx >>> 0;
  v[d] = rotr(v[d] ^ v[a], 16);
  v[c] = v[c] + v[d] >>> 0;
  v[b] = rotr(v[b] ^ v[c], 12);
  v[a] = v[a] + v[b] + my >>> 0;
  v[d] = rotr(v[d] ^ v[a], 8);
  v[c] = v[c] + v[d] >>> 0;
  v[b] = rotr(v[b] ^ v[c], 7);
}
function roundFn(v, m) {
  g(v, 0, 4, 8, 12, m[0], m[1]);
  g(v, 1, 5, 9, 13, m[2], m[3]);
  g(v, 2, 6, 10, 14, m[4], m[5]);
  g(v, 3, 7, 11, 15, m[6], m[7]);
  g(v, 0, 5, 10, 15, m[8], m[9]);
  g(v, 1, 6, 11, 12, m[10], m[11]);
  g(v, 2, 7, 8, 13, m[12], m[13]);
  g(v, 3, 4, 9, 14, m[14], m[15]);
}
function permute(m) {
  const p = MSG_PERMUTATION;
  return new Uint32Array([m[p[0]], m[p[1]], m[p[2]], m[p[3]], m[p[4]], m[p[5]], m[p[6]], m[p[7]], m[p[8]], m[p[9]], m[p[10]], m[p[11]], m[p[12]], m[p[13]], m[p[14]], m[p[15]]]);
}
function compress(cv, block, counterLow, counterHigh, blockLen, flags) {
  const v = new Uint32Array(16);
  for (let i = 0; i < 8; i++) v[i] = cv[i];
  v[8] = IV[0];
  v[9] = IV[1];
  v[10] = IV[2];
  v[11] = IV[3];
  v[12] = counterLow >>> 0;
  v[13] = counterHigh >>> 0;
  v[14] = blockLen >>> 0;
  v[15] = flags >>> 0;
  let m = block;
  for (let r = 0; r < 7; r++) {
    roundFn(v, m);
    m = permute(m);
  }
  const out = new Uint32Array(16);
  for (let i = 0; i < 8; i++) {
    out[i] = (v[i] ^ v[i + 8]) >>> 0;
    out[i + 8] = (v[i + 8] ^ cv[i]) >>> 0;
  }
  return out;
}
function bytesToWords(bytes, count) {
  const w = new Uint32Array(count);
  const limit = Math.min(bytes.length, count * 4);
  for (let i = 0; i < limit; i++) w[i >> 2] |= bytes[i] << (i & 3) * 8;
  return w;
}
function wordsToBytes(words) {
  const out = new Uint8Array(words.length * 4);
  const dv = new DataView(out.buffer);
  for (let i = 0; i < words.length; i++) dv.setUint32(i * 4, words[i], true);
  return out;
}
function blake3Hash(input, key = IV, flags = 0) {
  if (input.length > CHUNK_LEN) throw new Error("blake3Hash: input exceeds one chunk (>1024 bytes)");
  let cv = Uint32Array.from(key);
  const numBlocks = Math.max(1, Math.ceil(input.length / BLOCK_LEN));
  for (let i = 0; i < numBlocks; i++) {
    const start = i * BLOCK_LEN;
    const blockBytes = input.subarray(start, Math.min(start + BLOCK_LEN, input.length));
    const isLast = i === numBlocks - 1;
    let bFlags = flags;
    if (i === 0) bFlags |= CHUNK_START;
    if (isLast) bFlags |= CHUNK_END | ROOT;
    const out = compress(cv, bytesToWords(blockBytes, 16), 0, 0, blockBytes.length, bFlags);
    if (isLast) return wordsToBytes(out.subarray(0, 8));
    cv = out.subarray(0, 8);
  }
  throw new Error("blake3Hash: unreachable");
}
function deriveKey(contextStr, keyMaterial) {
  const contextKey = blake3Hash(new TextEncoder().encode(contextStr), IV, DERIVE_KEY_CONTEXT);
  const keyWords = bytesToWords(contextKey, 8);
  return blake3Hash(keyMaterial, keyWords, DERIVE_KEY_MATERIAL);
}

// src/core/ss2022.js
var KEY_SIZE = 16;
var SALT_SIZE = 16;
var TAG_SIZE = 16;
var MAX_PAYLOAD = 65535;
var CONTEXT = "shadowsocks 2022 session subkey";
var TIMESTAMP_TOLERANCE_SEC = 30;
function toU8(x) {
  return x instanceof Uint8Array ? x : new Uint8Array(x);
}
function base64ToBytes(str) {
  const binary = atob(String(str).replace(/-/g, "+").replace(/_/g, "/"));
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i);
  return out;
}
function pskFromSecret(secret) {
  try {
    const decoded = base64ToBytes(String(secret));
    if (decoded.length >= KEY_SIZE) return decoded.slice(0, KEY_SIZE);
  } catch {
  }
  return blake3Hash(new TextEncoder().encode(String(secret)), IV, 0).slice(0, KEY_SIZE);
}
function nonceBytes(counter) {
  const n = new Uint8Array(12);
  let c = counter;
  for (let i = 0; i < 12; i++) {
    n[i] = Number(c & 0xffn);
    c >>= 8n;
  }
  return n;
}
async function deriveSessionSubkey(psk, salt) {
  return deriveKey(CONTEXT, concatBytes(psk, salt)).slice(0, KEY_SIZE);
}
async function importAesKey(subkey) {
  return crypto.subtle.importKey("raw", subkey, { name: "AES-GCM" }, false, ["encrypt", "decrypt"]);
}
async function aeadSeal(key, counter, plaintext) {
  return new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv: nonceBytes(counter), tagLength: 128 }, key, plaintext));
}
async function aeadOpen(key, counter, ciphertext) {
  return new Uint8Array(await crypto.subtle.decrypt({ name: "AES-GCM", iv: nonceBytes(counter), tagLength: 128 }, key, ciphertext));
}
function parseSocksAddr(bytes, offset) {
  const atyp = bytes[offset++];
  let address = "";
  if (atyp === 1) {
    if (offset + 4 > bytes.length) throw new Error("IPv4 \u8D8A\u754C");
    address = `${bytes[offset]}.${bytes[offset + 1]}.${bytes[offset + 2]}.${bytes[offset + 3]}`;
    offset += 4;
  } else if (atyp === 3) {
    const len = bytes[offset++];
    if (offset + len > bytes.length) throw new Error("\u57DF\u540D\u8D8A\u754C");
    address = new TextDecoder().decode(bytes.slice(offset, offset + len));
    offset += len;
  } else if (atyp === 4) {
    if (offset + 16 > bytes.length) throw new Error("IPv6 \u8D8A\u754C");
    const parts = [];
    for (let i = 0; i < 8; i++, offset += 2) parts.push((bytes[offset] << 8 | bytes[offset + 1]).toString(16));
    address = parts.join(":");
  } else {
    throw new Error(`\u672A\u77E5 ATYP: ${atyp}`);
  }
  if (offset + 2 > bytes.length) throw new Error("\u7AEF\u53E3\u8D8A\u754C");
  const port = bytes[offset] << 8 | bytes[offset + 1];
  offset += 2;
  return { atyp, address, port, end: offset };
}
function checkTimestamp(bytes, offset) {
  const view = new DataView(bytes.buffer, bytes.byteOffset + offset, 8);
  const ts = Number(view.getBigUint64(0, false));
  const now = Math.floor(Date.now() / 1e3);
  const diff = Math.abs(ts - now);
  if (diff > TIMESTAMP_TOLERANCE_SEC) throw new Error(`\u65F6\u95F4\u6233\u504F\u5DEE ${diff}s \u8D85\u8FC7 ${TIMESTAMP_TOLERANCE_SEC}s\uFF08\u8BF7\u6821\u51C6\u5BA2\u6237\u7AEF\u65F6\u95F4\uFF09`);
}
function createRequestDecoder(psk) {
  let buf = new Uint8Array(0);
  let phase = "salt";
  let key = null;
  let nonce = 0n;
  let salt = null;
  let headerLen = 0;
  let wantLen = -1;
  let header = null;
  let established = false;
  let failed = null;
  async function feed(chunk) {
    if (failed) return { error: failed };
    if (chunk && toU8(chunk).byteLength) buf = concatBytes(buf, toU8(chunk));
    const payloads = [];
    try {
      for (; ; ) {
        if (phase === "salt") {
          if (buf.byteLength < SALT_SIZE) break;
          salt = buf.slice(0, SALT_SIZE);
          buf = buf.slice(SALT_SIZE);
          key = await importAesKey(await deriveSessionSubkey(psk, salt));
          nonce = 0n;
          phase = "hdr1";
        } else if (phase === "hdr1") {
          const need = 1 + 8 + 2 + TAG_SIZE;
          if (buf.byteLength < need) break;
          const ct = buf.slice(0, need);
          buf = buf.slice(need);
          const pt = await aeadOpen(key, nonce++, ct);
          if (pt[0] !== 0) throw new Error(`\u8BF7\u6C42\u5934 type=${pt[0]} \u975E\u5BA2\u6237\u7AEF\u6D41`);
          checkTimestamp(pt, 1);
          headerLen = pt[9] << 8 | pt[10];
          if (headerLen < 1) throw new Error("\u53EF\u53D8\u5934\u957F\u5EA6\u975E\u6CD5");
          phase = "hdr2";
        } else if (phase === "hdr2") {
          const need = headerLen + TAG_SIZE;
          if (buf.byteLength < need) break;
          const ct = buf.slice(0, need);
          buf = buf.slice(need);
          const pt = await aeadOpen(key, nonce++, ct);
          const addr = parseSocksAddr(pt, 0);
          let p = addr.end;
          if (p + 2 > pt.length) throw new Error("\u7F3A\u5C11 padding \u957F\u5EA6");
          const padLen = pt[p] << 8 | pt[p + 1];
          p += 2;
          if (p + padLen > pt.length) throw new Error("padding \u8D8A\u754C");
          p += padLen;
          const initialPayload = pt.slice(p);
          if (initialPayload.byteLength === 0 && padLen === 0) throw new Error("\u8BF7\u6C42\u5934\u65E2\u65E0\u8F7D\u8377\u4E5F\u65E0 padding");
          header = {
            hasError: false,
            addressRemote: addr.address,
            portRemote: addr.port,
            addressType: addr.atyp,
            // 与 S5elv/ss 一致，直接用 ATYP(1/3/4)
            rawClientData: initialPayload,
            responseHeader: null,
            isUDP: false
          };
          established = true;
          phase = "len";
        } else if (phase === "len") {
          const need = 2 + TAG_SIZE;
          if (buf.byteLength < need) break;
          const ct = buf.slice(0, need);
          buf = buf.slice(need);
          const pt = await aeadOpen(key, nonce++, ct);
          wantLen = pt[0] << 8 | pt[1];
          phase = "payload";
        } else if (phase === "payload") {
          const need = wantLen + TAG_SIZE;
          if (buf.byteLength < need) break;
          const ct = buf.slice(0, need);
          buf = buf.slice(need);
          const pt = await aeadOpen(key, nonce++, ct);
          if (pt.byteLength) payloads.push(pt);
          wantLen = -1;
          phase = "len";
        } else {
          break;
        }
      }
    } catch (e) {
      failed = e?.message || String(e);
      return { error: failed };
    }
    return { header, payloads, salt, error: null };
  }
  return {
    feed,
    get established() {
      return established;
    },
    get requestSalt() {
      return salt;
    }
  };
}
function buildResponseHeader(requestSalt, firstPayloadLen) {
  const hdr = new Uint8Array(27);
  hdr[0] = 1;
  new DataView(hdr.buffer).setBigUint64(1, BigInt(Math.floor(Date.now() / 1e3)), false);
  hdr.set(requestSalt, 9);
  hdr[25] = firstPayloadLen >> 8 & 255;
  hdr[26] = firstPayloadLen & 255;
  return hdr;
}
function createResponseEncoderFactory(psk, requestSalt) {
  return function makeResponseTransform() {
    let key = null;
    let nonce = 0n;
    let salt = null;
    let started = false;
    let headerSent = false;
    return new TransformStream({
      async transform(chunk, controller) {
        const view = toU8(chunk);
        if (!view.byteLength) return;
        if (!started) {
          salt = crypto.getRandomValues(new Uint8Array(SALT_SIZE));
          key = await importAesKey(await deriveSessionSubkey(psk, salt));
          nonce = 0n;
          started = true;
        }
        let offset = 0;
        while (offset < view.byteLength) {
          const len = Math.min(MAX_PAYLOAD, view.byteLength - offset);
          const piece = view.slice(offset, offset + len);
          offset += len;
          if (!headerSent) {
            const hdrCt = await aeadSeal(key, nonce++, buildResponseHeader(requestSalt, len));
            const payloadCt = await aeadSeal(key, nonce++, piece);
            controller.enqueue(concatBytes(salt, hdrCt, payloadCt));
            headerSent = true;
          } else {
            const lenCt = await aeadSeal(key, nonce++, new Uint8Array([len >> 8 & 255, len & 255]));
            const payloadCt = await aeadSeal(key, nonce++, piece);
            controller.enqueue(concatBytes(lenCt, payloadCt));
          }
        }
      }
    });
  };
}

// src/core/config.js
var REDIRECT_LIST = [
  "https://www.bilibili.com",
  "https://www.nicovideo.jp",
  "https://tv.naver.com",
  "https://www.hotstar.com",
  "https://www.netflix.com",
  "https://www.dailymotion.com",
  "https://www.youtube.com",
  "https://www.hulu.com",
  "https://fmovies.llc",
  "https://hdtodayz.to",
  "https://radar.cloudflare.com"
];
var BUILTIN_DEFAULTS = {
  /** S5elv 条目的 uuid，env.UUID4 优先 */
  userID: "61098bdc-b734-4874-9e87-d18b1ef1cfaf",
  /** Naj0rt 与 Skc0swodahs 条目 password，env.USERPWD 优选 */
  handshakePWD: "yQ0wV0N1K3xir9WmJ8YOZQ==",
  /** relay 即 socks5 上游地址，格式: user:pass@host:port、host:port */
  relay: "",
  /** gateway 即 http(s) 上游地址，格式同上 */
  gateway: "",
  /** 中转地址 地址即pyip，格式 [Host][:port]，多值用逗号隔开 */
  landing: "",
  /** NAT64 IPv6 前缀，可以去掉或保留 "/96" */
  nat64: `${["2602", "fc59", "b0", "64"].join(":")}::`
};
var DEFAULTS = {
  github: {
    GITHUB_TOKEN: "",
    // 令牌
    GITHUB_OWNER: "",
    // 仓库所有者
    GITHUB_REPO: "",
    // 仓库名称
    GITHUB_BRANCH: "main",
    // 分支名称
    GITHUB_FILE_PATH: "README.md"
    // 文件路径(相对于仓库根目录)
  },
  password: {
    CONFIG_PASSWORD: BUILTIN_DEFAULTS.userID,
    // 查看条目配置的密码
    SUB_PASSWORD: BUILTIN_DEFAULTS.userID
    // 查看条目订阅的密码
  },
  urls: {
    DATA_SOURCE_URL: `https://raw.githubusercontent.com/${base64Decode("anVlcnNvbg==")}/${base64Decode("M2gxX3R1bm5lbA==")}/refs/heads/master/domain.txt`,
    C_TEMPLATE_URL: `https://raw.githubusercontent.com/${base64Decode("anVlcnNvbg==")}/${base64Decode("M2gxX3R1bm5lbA==")}/refs/heads/master/${base64Decode("Y2xhc2hUZW1wbGF0ZQ==")}.yaml`
  }
};
function parseBoolEnv(value, fallback = false) {
  if (typeof value === "boolean") return value;
  if (typeof value === "string") return ["1", "true", "yes", "on"].includes(value.trim().toLowerCase());
  return fallback;
}
function resolveRuntimeConfig(env = {}) {
  const userID = env.U || env.UUID4 || BUILTIN_DEFAULTS.userID;
  const password = env.P || env.USERPWD || BUILTIN_DEFAULTS.handshakePWD;
  return {
    userID,
    password,
    sha224Password: sha224(password),
    // 下面skc0Lock和allowedRules控制ss握手格式
    skc0Lock: parseBoolEnv(env.ENABLED_S5, false),
    // SS2022(2022-blake3-aes-128-gcm) 的 16 字节 PSK：由 Naj0rt 密码派生（无密码时即 uuid）
    ssPsk: pskFromSecret(password),
    allowedRules: parseAllowedRules(env.ALLOWED_RULES),
    // 远端 TCP 主动断开时，是否立刻关闭 WebSocket（默认关闭）
    closeWSOnSocketClosed: parseBoolEnv(env.CLOSE_WS_ON_SOCKET_CLOSE, false)
  };
}
function parseAllowedRules(raw) {
  const list = String(raw ?? "").trim().split(/[, \n\r\t]+/).map((x) => x.trim()).filter(Boolean);
  return list.length > 0 ? list : ["0.0.0.0/0", "::/0"];
}

// src/common/addr.js
function parseHostPort(s) {
  const v = (x) => {
    x = +x;
    return x >= 1 && x <= 65535 ? x : 443;
  };
  let h, p = 443, i;
  if (s[0] === "[") {
    if ((i = s.indexOf("]")) === -1) return { hostname: null, port: null };
    h = s.slice(0, i + 1);
    if (s[i + 1] === ":") p = v(s.slice(i + 2));
  } else if ((i = s.lastIndexOf(":")) !== -1 && s.indexOf(":") === i) {
    h = s.slice(0, i);
    p = v(s.slice(i + 1));
  } else h = s;
  return { hostname: h, port: p };
}
function parseRelayAddr(address) {
  let [latter, former] = address.split("@").reverse();
  let username, password, hostname, port;
  if (former) {
    const formers = former.split(":");
    if (formers.length !== 2) throw new Error("Invalid relay address format");
    [username, password] = formers;
  }
  const latters = latter.split(":");
  port = Number(latters.pop());
  if (isNaN(port)) throw new Error("Invalid relay address format");
  hostname = latters.join(":");
  const regex = /^\[.*\]$/;
  if (hostname.includes(":") && !regex.test(hostname)) {
    throw new Error("Invalid relay address format");
  }
  return { username, password, hostname, port };
}

// src/core/context.js
function parseDialMode(path, env = {}, defaults = BUILTIN_DEFAULTS) {
  const envRelayAddr = env.SOCKS5 || defaults.relay;
  const envGatewayAddr = env.HTTP || defaults.gateway;
  const envLandingStr = env.LANDING_ADDRESS || defaults.landing;
  let nat64Addr = env.NAT64 || defaults.nat64;
  const hasRelay = path.includes("/socks=");
  const hasGateway = path.match(/\/(https?)=([^/]+)/i);
  const hasLanding = path.includes("/pyip=");
  const hasNat64 = path.includes("/nat=");
  let enableRelay = false;
  let enableGateway = false;
  let enableNat = false;
  let landingAddr = { hostname: null, port: 443 };
  let upstreamAddr = {};
  if (hasRelay) {
    upstreamAddr = parseRelayAddr(path.split("/socks=")[1]);
    enableRelay = true;
  } else if (hasGateway) {
    upstreamAddr = parseRelayAddr(hasGateway[2]);
    enableGateway = true;
  } else if (hasLanding) {
    let landingAddrRaw = path.split("/pyip=")[1];
    let arr = landingAddrRaw.split(",");
    let randomIndex = Math.floor(Math.random() * arr.length);
    let chosenAddr = arr[randomIndex].trim();
    landingAddr = parseHostPort(chosenAddr);
  } else if (hasNat64) {
    nat64Addr = path.split("/nat=")[1];
    enableNat = true;
  } else if (envRelayAddr) {
    upstreamAddr = parseRelayAddr(envRelayAddr);
    enableRelay = true;
  } else if (envGatewayAddr) {
    upstreamAddr = parseRelayAddr(envGatewayAddr);
    enableGateway = true;
  } else if (envLandingStr) {
    let arr = envLandingStr.split(",");
    let randomIndex = Math.floor(Math.random() * arr.length);
    let chosenAddr = arr[randomIndex].trim();
    landingAddr = parseHostPort(chosenAddr);
  }
  let nat64Prefix = nat64Addr.split("/")[0];
  return {
    upstreamAddr,
    landingAddr,
    nat64Prefix,
    enableRelay,
    enableGateway,
    enableNat
  };
}
function createConnContext(runtime, path, env = {}) {
  const mode = parseDialMode(path, env);
  return {
    ...runtime,
    upstreamAddr: mode.upstreamAddr,
    landingAddr: mode.landingAddr,
    nat64Prefix: mode.nat64Prefix,
    enableRelay: mode.enableRelay,
    enableGateway: mode.enableGateway,
    enableNat: mode.enableNat
  };
}

// src/core/handshake.js
function parseS5elv(buffer, userID) {
  const view = new Uint8Array(buffer);
  if (view.length < 24) return { hasError: true, message: "Too short" };
  const bytes2UUID = (bytes) => [...bytes].map((b, i) => `${[4, 6, 8, 10].includes(i) ? "-" : ""}${b.toString(16).padStart(2, "0")}`).join("");
  const uuid = bytes2UUID(view.slice(1, 17));
  if (uuid !== userID) return { hasError: true, message: "Unauthorized UUID" };
  const optLen = view[17];
  const base = 18 + optLen;
  if (base + 4 > view.length) return { hasError: true, message: "Header too short" };
  let isUDP = false;
  const command = view[base];
  if (command === 2) isUDP = true;
  else if (command !== 1) return { hasError: true, message: `command ${command} is not support` };
  const port = view[base + 1] << 8 | view[base + 2];
  let p = base + 3;
  const addrType = view[p++];
  let address = "";
  if (addrType === 1) {
    if (p + 4 > view.length) return { hasError: true, message: "Header too short for IPv4" };
    address = `${view[p++]}.${view[p++]}.${view[p++]}.${view[p++]}`;
  } else if (addrType === 2) {
    if (p + 1 > view.length) return { hasError: true, message: "Header too short for domain" };
    const len = view[p++];
    if (p + len > view.length) return { hasError: true, message: "Header too short for domain" };
    let chars = [];
    for (let i = 0; i < len; ++i) chars.push(view[p + i]);
    address = String.fromCharCode(...chars);
    p += len;
  } else if (addrType === 3) {
    if (p + 16 > view.length) return { hasError: true, message: "Header too short for IPv6" };
    let parts = [];
    for (let i = 0; i < 8; ++i) {
      const h = view[p++], l = view[p++];
      parts.push((h << 8 | l).toString(16));
    }
    address = parts.join(":");
  } else {
    return { hasError: true, message: `Invalid address type ${addrType}` };
  }
  const mapAddressType = (atype) => ({ 1: 1, 2: 3, 3: 4 })[atype] ?? null;
  return {
    hasError: false,
    addressRemote: address,
    portRemote: port,
    rawClientData: new Uint8Array(buffer, p),
    addressType: mapAddressType(addrType),
    responseHeader: new Uint8Array([view[0], 0]),
    isUDP
  };
}
function parseNaj0rt(buffer, sha224Password) {
  const view = new Uint8Array(buffer);
  if (view.length < 56 + 2 + 1 + 1 + 2 + 2) return { hasError: true, message: "Header too short" };
  const passStr = String.fromCharCode(...view.slice(0, 56));
  if (passStr !== sha224Password) return { hasError: true, message: "Unauthorized password" };
  if (view[56] !== 13 || view[57] !== 10) return { hasError: true, message: "Missing CRLF after password hash" };
  let isUDP = false;
  let p = 58;
  const cmd = view[p++];
  if (cmd == 3) isUDP = true;
  else if (cmd !== 1 && cmd !== 3) return { hasError: true, message: `Unknown CMD: ${cmd}` };
  const addrType = view[p++];
  let address = "";
  if (addrType === 1) {
    if (view.length < p + 4 + 2) return { hasError: true, message: "Header too short for IPv4" };
    address = `${view[p++]}.${view[p++]}.${view[p++]}.${view[p++]}`;
  } else if (addrType === 3) {
    const len = view[p++];
    if (view.length < p + len + 2) return { hasError: true, message: "Header too short for domain" };
    address = String.fromCharCode(...view.slice(p, p + len));
    p += len;
  } else if (addrType === 4) {
    if (view.length < p + 16 + 2) return { hasError: true, message: "Header too short for IPv6" };
    let parts = [];
    for (let i = 0; i < 8; ++i) {
      const part = view[p++] << 8 | view[p++];
      parts.push(part.toString(16));
    }
    address = parts.join(":");
  } else {
    return { hasError: true, message: `Unknown addrType: ${addrType}` };
  }
  const port = view[p++] << 8 | view[p++];
  return {
    hasError: false,
    addressRemote: address,
    portRemote: port,
    rawClientData: new Uint8Array(buffer, p + 2),
    addressType: addrType,
    responseHeader: null,
    isUDP
  };
}
function detectKind(buffer, request = null, allowedRules = ["0.0.0.0/0", "::/0"]) {
  const view = new Uint8Array(buffer);
  if (view.byteLength >= 17) {
    const version = (view[7] & 240) >> 4;
    const isRFC4122Variant = (view[9] & 192) === 128;
    if (isRFC4122Variant && (version === 4 || version === 7)) {
      return 1;
    }
  }
  if (view.byteLength >= 62) {
    const [b0, b1, b2, b3] = [view[56], view[57], view[58], view[59]];
    const validB2 = [1, 3, 127];
    const validB3 = [1, 3, 4];
    if (b0 === 13 && b1 === 10 && validB2.includes(b2) && validB3.includes(b3)) {
      return 2;
    }
  }
  if (view.byteLength > 10) {
    const validB1 = [1, 3, 4];
    if (validB1.includes(view[0]) && Array.isArray(allowedRules)) {
      if (allowedRules.some((r) => r === "0.0.0.0/0" || r === "::/0")) return 0;
      if (request) {
        const ip = request.headers.get("CF-Connecting-IP");
        if (ip && allowedRules.some((rule) => isIpMatch(ip, rule))) {
          return 0;
        }
      }
    }
  }
  return 3;
}
function isIpAllowed(request, allowedRules = ["0.0.0.0/0", "::/0"]) {
  if (!Array.isArray(allowedRules)) return false;
  if (allowedRules.some((r) => r === "0.0.0.0/0" || r === "::/0")) return true;
  const ip = request?.headers?.get("CF-Connecting-IP");
  return !!ip && allowedRules.some((rule) => isIpMatch(ip, rule));
}
function isIpMatch(ip, rule) {
  if (["0.0.0.0/0", "::/0"].includes(rule)) return true;
  if (rule.includes("/")) {
    return inCIDR(ip, rule);
  } else {
    return ip === rule;
  }
}
function inCIDR(ip, cidr) {
  const [range, bits = "32"] = cidr.split("/");
  const ipBig = ipToBigInt(ip);
  const rangeBig = ipToBigInt(range);
  const prefix = parseInt(bits, 10);
  if (ip.includes(".") && range.includes(".")) {
    const mask = ~((1 << 32 - prefix) - 1) >>> 0;
    return Number(ipBig & BigInt(mask)) === Number(rangeBig & BigInt(mask));
  } else if (!ip.includes(".") && !range.includes(".")) {
    const mask = (1n << 128n) - (1n << 128n - BigInt(prefix));
    return (ipBig & mask) === (rangeBig & mask);
  } else {
    return false;
  }
}
function ipToBigInt(ip) {
  if (ip.includes(".")) {
    const [a, b, c, d] = parseIPv4(ip);
    return BigInt(a << 24 | b << 16 | c << 8 | d);
  } else {
    const parts = parseIPv6(ip);
    return parts.reduce((acc, part) => (acc << 16n) + BigInt(part), 0n);
  }
}
function parseIPv4(ip) {
  return ip.split(".").map((x) => parseInt(x, 10));
}
function parseIPv6(ip) {
  const parts = ip.split("::");
  let head = parts[0].split(":").filter(Boolean);
  let tail = parts[1] ? parts[1].split(":").filter(Boolean) : [];
  let missing = 8 - (head.length + tail.length);
  let full = [...head, ...Array(missing).fill("0"), ...tail];
  return full.map((x) => parseInt(x || "0", 16));
}

// src/core/relay.js
import { connect as connect2 } from "cloudflare:sockets";

// src/core/connector.js
import { connect } from "cloudflare:sockets";
var textEncoder = new TextEncoder();
var textDecoder = new TextDecoder();
async function dialRelay(ctx, addressType, addressRemote, portRemote, log) {
  const { username, password, hostname, port } = ctx.upstreamAddr;
  const socket = connect({ hostname, port });
  const writer = socket.writable.getWriter();
  const encoder = new TextEncoder();
  const byteReader = createByteReader(socket.readable);
  try {
    await writer.write(new Uint8Array([5, 2, 0, 2]));
    log("sent relay greeting");
    let res = await byteReader.readExactly(2);
    if (res[0] !== 5) throw new Error(`relay server version error: ${res[0]} expected: 5`);
    if (res[1] === 255) throw new Error("no acceptable methods");
    if (res[1] === 2) {
      log("relay server needs auth");
      if (!username || !password) throw new Error("please provide username/password");
      const authRequest = new Uint8Array([1, username.length, ...encoder.encode(username), password.length, ...encoder.encode(password)]);
      await writer.write(authRequest);
      res = await byteReader.readExactly(2);
      if (res[0] !== 1 || res[1] !== 0) throw new Error("fail to auth relay server");
    }
    let DSTADDR;
    switch (addressType) {
      case 1:
        DSTADDR = new Uint8Array([1, ...addressRemote.split(".").map(Number)]);
        break;
      case 3:
        DSTADDR = new Uint8Array([3, addressRemote.length, ...encoder.encode(addressRemote)]);
        break;
      case 4:
        DSTADDR = new Uint8Array([4, ...addressRemote.split(":").flatMap((x) => [parseInt(x.slice(0, 2), 16), parseInt(x.slice(2), 16)])]);
        break;
      default:
        throw new Error(`invild  addressType is ${addressType}`);
    }
    const relayRequest = new Uint8Array([5, 1, 0, ...DSTADDR, portRemote >> 8, portRemote & 255]);
    await writer.write(relayRequest);
    log("sent relay request");
    res = await byteReader.readExactly(4);
    if (res[0] !== 5) throw new Error(`relay server version error: ${res[0]} expected: 5`);
    if (res[1] !== 0) throw new Error("fail to open relay connection");
    const atyp = res[3];
    if (atyp === 1) await byteReader.readExactly(4);
    else if (atyp === 3) {
      const len = await byteReader.readExactly(1);
      await byteReader.readExactly(len[0]);
    } else if (atyp === 4) await byteReader.readExactly(16);
    await byteReader.readExactly(2);
    log("relay connection opened");
  } catch (err) {
    log("relay connect failed:", err);
    try {
      writer.releaseLock();
    } catch {
    }
    byteReader.release();
    socket.close().catch(() => {
    });
    throw err;
  }
  writer.releaseLock();
  return { socket, readable: byteReader.toReadable() };
}
function buildGatewayRequest(host, port, username, password) {
  const headers = [
    `CONNECT ${host}:${port} HTTP/1.1`,
    `Host: ${host}:${port}`,
    `User-Agent: Mozilla/5.0 (Windows NT10.0; Win64; x64) AppleWebKit/537.36`,
    `Proxy-Connection: keep-alive`,
    `Connection: keep-alive`
  ];
  if (username && password) {
    const auth = btoa(`${username}:${password}`);
    headers.push(`Proxy-Authorization: Basic ${auth}`);
  }
  return headers.join("\r\n") + "\r\n\r\n";
}
async function sendRaw(sock, request) {
  const writer = sock.writable.getWriter();
  await writer.write(textEncoder.encode(request));
  writer.releaseLock();
}
function findHeaderEnd(buffer) {
  for (let i = 0; i < buffer.length - 3; i++) {
    if (buffer[i] === 13 && buffer[i + 1] === 10 && buffer[i + 2] === 13 && buffer[i + 3] === 10) {
      return i;
    }
  }
  return -1;
}
async function dialGateway(ctx, remoteHost, remotePort, log) {
  const { hostname, port, username, password } = ctx.upstreamAddr;
  log(`\u51C6\u5907\u4F7F\u7528HTTP\u4E0A\u6E38 ${hostname}:${port} \u8FDE\u63A5 ${remoteHost}:${remotePort}`);
  const sock = await connect({ hostname, port });
  const request = buildGatewayRequest(remoteHost, remotePort, username, password);
  await sendRaw(sock, request);
  const byteReader = createByteReader(sock.readable);
  try {
    const head = await byteReader.readUntil((buf) => {
      const idx = findHeaderEnd(buf);
      return idx === -1 ? -1 : idx + 4;
    });
    const responseText = textDecoder.decode(head);
    if (!/^HTTP\/1\.[01] 200/.test(responseText)) {
      throw new Error(`HTTP\u4E0A\u6E38\u54CD\u5E94\u5F02\u5E38: ${responseText.split("\r\n")[0]}`);
    }
    log(`HTTP\u8FDE\u63A5 ${remoteHost}:${remotePort} \u6210\u529F\uFF01`);
  } catch (err) {
    log("http upstream connect failed:", err);
    byteReader.release();
    sock.close().catch(() => {
    });
    throw err;
  }
  return { socket: sock, readable: byteReader.toReadable() };
}
async function resolveDialTarget(ctx, addressRemote, portRemote) {
  if (!ctx.enableNat && ctx.landingAddr?.hostname) {
    return {
      address: ctx.landingAddr.hostname,
      port: ctx.landingAddr.port || portRemote
    };
  } else {
    const nat64Address = await composeNAT64(addressRemote, ctx.nat64Prefix);
    return {
      address: nat64Address || addressRemote,
      port: portRemote
    };
  }
}
async function composeNAT64(addressRemote, prefix = BUILTIN_DEFAULTS.nat64) {
  if (typeof addressRemote !== "string" || !addressRemote.trim()) return "";
  try {
    const response = await fetch(`https://dns.google.com/resolve?name=${addressRemote}&type=A`, {
      headers: { Accept: "application/dns-json" }
    });
    if (!response.ok) return "";
    const data = await response.json();
    const ipv4 = data.Answer?.find((r) => r.type === 1)?.data;
    if (!ipv4) return "";
    const parts = ipv4.split(".");
    if (parts.length !== 4) return "";
    const hexParts = parts.map((p) => {
      const num = Number(p);
      if (!Number.isInteger(num) || num < 0 || num > 255) return null;
      return num.toString(16).padStart(2, "0");
    });
    if (hexParts.includes(null)) return "";
    const ipv6 = `${prefix}${hexParts[0]}${hexParts[1]}:${hexParts[2]}${hexParts[3]}`;
    return `[${ipv6}]`;
  } catch {
    return "";
  }
}

// src/core/lifecycle.js
function closeWS(ws, code = 1e3, reason = "Normal Closure") {
  try {
    if (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING) {
      ws.close(code, reason);
    }
  } catch (e) {
    console.error("Failed close WebSocket", e);
  }
}
function startHelloTimer({ webSocket, remoteSocketWrapper, timeoutMs = 5e3, log }) {
  let handshakeTimeout = setTimeout(() => {
    if (!remoteSocketWrapper.value) {
      log("\u{1F91D} Handshake timeout: no handshake header received, closing WebSocket");
      try {
        if (webSocket.readyState === WebSocket.OPEN) {
          webSocket.close(1008, "Handshake timeout");
        }
      } catch (e) {
        log("Failed to close WebSocket after timeout", e);
      }
    }
  }, timeoutMs);
  return () => clearTimeout(handshakeTimeout);
}
function setupKeepalive({ webSocket, signal, onAbort, idleTimeoutMs = 3e4, maxLifetimeMs = 18e4 }) {
  let idleTimer = null;
  let aborted = false;
  const idleController = new AbortController();
  const doAbort = (reason) => {
    if (aborted) return;
    aborted = true;
    clearTimeout(idleTimer);
    if (reason === "idle") {
      console.warn(`\u23F3 Idle for over ${idleTimeoutMs / 1e3}s, disconnecting.`);
    } else if (reason === "lifetime") {
      console.warn(`\u{1F6D1} Max lifetime of ${maxLifetimeMs / 1e3}s reached, disconnecting.`);
    } else {
      console.warn(`\u{1F6AB} External abort signal, disconnecting.`);
    }
    closeWS(webSocket);
    idleController.abort(reason);
    onAbort?.(reason);
  };
  const resetIdleTimer = () => {
    if (aborted) return;
    clearTimeout(idleTimer);
    idleTimer = setTimeout(() => doAbort("idle"), idleTimeoutMs);
  };
  const lifetimeSignal = createTimeoutSignal(maxLifetimeMs);
  lifetimeSignal.addEventListener?.("abort", () => doAbort("lifetime"));
  signal?.addEventListener?.("abort", () => doAbort("external"));
  resetIdleTimer();
  const combined = createCombinedSignal([idleController.signal, lifetimeSignal, signal].filter(Boolean));
  return {
    signal: combined,
    // 供 pipeTo 使用
    resetIdleTimer,
    // 每次收到数据时要调用
    abort: doAbort
    // 可手动提前释放资源
  };
}
function makeWSStream(webSocket, earlyDataHeader, log) {
  let canceled = false;
  const stream = new ReadableStream({
    start(controller) {
      webSocket.addEventListener("message", (e) => {
        if (!canceled) controller.enqueue(e.data);
      });
      webSocket.addEventListener("close", () => {
        if (!canceled) controller.close();
        closeWS(webSocket);
      });
      webSocket.addEventListener("error", (err) => {
        log("WebSocket error");
        controller.error(`ReadableStream error: ${err.message}`);
      });
      const { earlyData, error } = base64ToArrayBuffer(earlyDataHeader);
      if (error) controller.error(`Base64 decode error: ${error.message}`);
      else if (earlyData) controller.enqueue(earlyData);
    },
    cancel(reason) {
      if (canceled) return;
      canceled = true;
      log(`ReadableStream canceled: ${reason}`);
      closeWS(webSocket);
    }
  });
  return stream;
}

// src/core/relay.js
async function openChannel(ctx, remoteSocket, headerInfo, webSocket, log) {
  const { addressType, addressRemote, portRemote, rawClientData, responseHeader: vResponseHeader, makeResponseTransform } = headerInfo;
  async function connectAndWrite(address, port, { relay = false, gateway = false } = {}) {
    let socket2, readable2;
    if (relay) {
      ({ socket: socket2, readable: readable2 } = await dialRelay(ctx, addressType, address, port, log));
    } else if (gateway) {
      ({ socket: socket2, readable: readable2 } = await dialGateway(ctx, address, port, log));
    } else {
      socket2 = connect2({ hostname: address, port });
      readable2 = socket2.readable;
    }
    log(`connected to ${address}:${port}`);
    if (remoteSocket.writer) {
      try {
        remoteSocket.writer.releaseLock();
      } catch {
      }
      remoteSocket.writer = null;
    }
    remoteSocket.value = socket2;
    const writer = socket2.writable.getWriter();
    remoteSocket.writer = writer;
    await writer.write(rawClientData);
    return { socket: socket2, readable: readable2 };
  }
  async function retry() {
    let opt = ctx.enableRelay ? { relay: true } : ctx.enableGateway ? { gateway: true } : {};
    let target = { address: addressRemote, port: portRemote };
    if (!ctx.enableRelay && !ctx.enableGateway) {
      target = await resolveDialTarget(ctx, addressRemote, portRemote);
    }
    const { socket: socket2, readable: readable2 } = await connectAndWrite(target.address, target.port, opt);
    socket2.closed.catch((error) => log("retry tcpSocket closed error", error)).finally(() => closeWS(webSocket));
    pumpToClient(readable2, webSocket, vResponseHeader, null, log, null, makeResponseTransform);
  }
  const { socket, readable } = await connectAndWrite(addressRemote, portRemote);
  pumpToClient(readable, webSocket, vResponseHeader, retry, log, ctx.closeWSOnSocketClosed ? socket.closed : null, makeResponseTransform);
}
async function pumpToClient(readable, webSocket, vRspnHeader = null, retry, log, socketClosed = null, makeResponseTransform = null) {
  let hasData = false;
  let source = readable;
  if (typeof makeResponseTransform === "function") {
    source = readable.pipeThrough(makeResponseTransform());
  } else if (vRspnHeader instanceof Uint8Array && vRspnHeader.byteLength) {
    source = prependChunk(vRspnHeader, readable);
  }
  const writer = new WritableStream({
    write(chunk) {
      if (webSocket.readyState !== WebSocket.OPEN) throw new Error("WebSocket not open");
      webSocket.send(chunk);
      hasData = true;
    },
    abort(reason) {
      console.error("WritableStream aborted:", reason);
    }
  });
  await pipeSafely(source, writer, {
    label: "remote->ws",
    onError: (e) => {
      console.error("pipeTo error in remoteSocketToWS:", e);
      closeWS(webSocket);
    }
  });
  if (socketClosed && hasData) {
    socketClosed.catch((error) => log("tcpSocket closed error", error)).finally(() => closeWS(webSocket));
  }
  if (!hasData && typeof retry === "function") retry();
}
async function pumpDNS(webSocket, vResponseHeader, log) {
  let isS5elvHeaderSent = false;
  let frameBuffer = new Uint8Array(0);
  const transformStream = new TransformStream({
    transform(chunk, controller) {
      const view = chunk instanceof Uint8Array ? chunk : new Uint8Array(chunk);
      const buf = frameBuffer.byteLength ? concatBytes(frameBuffer, view) : view;
      frameBuffer = new Uint8Array(0);
      let index = 0;
      while (index + 2 <= buf.byteLength) {
        const udpPakcetLength = buf[index] << 8 | buf[index + 1];
        if (index + 2 + udpPakcetLength > buf.byteLength) break;
        controller.enqueue(buf.slice(index + 2, index + 2 + udpPakcetLength));
        index += 2 + udpPakcetLength;
      }
      if (index < buf.byteLength) frameBuffer = buf.slice(index);
    },
    flush() {
      frameBuffer = new Uint8Array(0);
    }
  });
  pipeSafely(
    transformStream.readable,
    new WritableStream({
      async write(chunk) {
        const resp = await fetch("https://1.1.1.1/dns-query", { method: "POST", headers: { "content-type": "application/dns-message" }, body: chunk });
        const dnsQueryResult = await resp.arrayBuffer();
        const udpSize = dnsQueryResult.byteLength;
        const udpSizeBuffer = new Uint8Array([udpSize >> 8 & 255, udpSize & 255]);
        if (webSocket.readyState === WebSocket.OPEN) {
          log(`doh success and dns message length is ${udpSize}`);
          const dnsBytes = new Uint8Array(dnsQueryResult);
          if (isS5elvHeaderSent) {
            webSocket.send(concatBytes(udpSizeBuffer, dnsBytes));
          } else {
            webSocket.send(concatBytes(vResponseHeader, udpSizeBuffer, dnsBytes));
            isS5elvHeaderSent = true;
          }
        }
      }
    }),
    {
      label: "doh",
      onError: (error) => log("dns udp has error" + error)
    }
  );
  const writer = transformStream.writable.getWriter();
  return {
    write(chunk) {
      writer.write(chunk).catch((err) => log("dns udp write error", err));
    }
  };
}

// src/core/session.js
async function handleWS(ctx, request) {
  const [client, webSocket] = Object.values(new WebSocketPair());
  webSocket.binaryType = "arraybuffer";
  webSocket.accept();
  let address = "";
  let portWithRandomLog = "";
  const log = (info, event) => {
    console.log(`[${address}:${portWithRandomLog}] ${info}`, event || "");
  };
  const { resetIdleTimer, signal } = setupKeepalive({
    webSocket,
    idleTimeoutMs: 2e4,
    // 20s
    maxLifetimeMs: 18e4,
    // 180s
    onAbort: (reason) => {
      log?.("\u{1F433} disconnecting reason:", reason);
      closeWS(webSocket);
    }
  });
  const earlyDataHeader = request.headers.get("sec-websocket-protocol") || "";
  const webSocketReadableStream = makeWSStream(webSocket, earlyDataHeader, log);
  let isDns = false;
  let udpStreamWrite = null;
  let remoteSocketWrapper = { value: null, writer: null };
  let ssDecoder = null;
  const clearHandshakeTimer = startHelloTimer({
    webSocket,
    remoteSocketWrapper,
    timeoutMs: 5e3,
    // 5秒超时握手时间
    log
  });
  async function acceptHeader(headerInfo, extraPayloads, { awaitConnect = false } = {}) {
    clearHandshakeTimer();
    if (headerInfo?.isUDP && headerInfo?.portRemote != 53) {
      return;
    } else if (headerInfo?.isUDP) {
      const { write } = await pumpDNS(webSocket, headerInfo?.responseHeader, log);
      udpStreamWrite = write;
      udpStreamWrite(headerInfo?.rawClientData);
      return;
    }
    address = headerInfo?.addressRemote;
    portWithRandomLog = `${headerInfo?.portRemote}--${Math.random()} ${headerInfo?.isUDP ? "udp " : "tcp "}`;
    const start = () => openChannel(ctx, remoteSocketWrapper, headerInfo, webSocket, log).catch((err) => {
      log("handleTCPOutbds error", err);
      closeWS(webSocket);
    });
    if (!awaitConnect) return start();
    await start();
    if (extraPayloads?.length) {
      if (!remoteSocketWrapper.writer) remoteSocketWrapper.writer = remoteSocketWrapper.value.writable.getWriter();
      for (const p of extraPayloads) if (p.byteLength) await remoteSocketWrapper.writer.write(p);
    }
  }
  try {
    pipeSafely(
      webSocketReadableStream,
      new WritableStream({
        async write(chunk, controller) {
          resetIdleTimer();
          if (isDns && udpStreamWrite) {
            return udpStreamWrite(chunk);
          }
          if (remoteSocketWrapper.value) {
            if (!remoteSocketWrapper.writer) {
              remoteSocketWrapper.writer = remoteSocketWrapper.value.writable.getWriter();
            }
            if (ssDecoder) {
              const out = await ssDecoder.feed(chunk);
              if (out.error) return controller.error(`ss2022 decode error: ${out.error}`);
              for (const p of out.payloads) if (p.byteLength) await remoteSocketWrapper.writer.write(p);
              return;
            }
            await remoteSocketWrapper.writer.write(chunk);
            return;
          }
          const chunkLen = chunk?.byteLength ?? chunk?.length ?? 0;
          const ssCandidate = ssDecoder || ctx.skc0Lock && chunkLen >= SALT_SIZE + 27 && isIpAllowed(request, ctx.allowedRules);
          if (ssCandidate) {
            if (!ssDecoder) ssDecoder = createRequestDecoder(ctx.ssPsk);
            const out = await ssDecoder.feed(chunk);
            if (out.error) {
              ssDecoder = null;
            } else if (out.header) {
              out.header.makeResponseTransform = createResponseEncoderFactory(ctx.ssPsk, ssDecoder.requestSalt);
              return acceptHeader(out.header, out.payloads, { awaitConnect: true });
            } else {
              return;
            }
          }
          let mapCode = detectKind(chunk, request, ctx.allowedRules);
          const parseHandlers = {
            1: [parseS5elv, [chunk, ctx.userID]],
            2: [parseNaj0rt, [chunk, ctx.sha224Password]]
          };
          const entry = parseHandlers[mapCode];
          if (!entry) return log(`Unsupported handshake mapCode: ${mapCode}`);
          const [handlerFn, args] = entry;
          const headerInfo = handlerFn(...args);
          if (!headerInfo || headerInfo?.hasError) return controller.error(`Header parse error: ${headerInfo?.message}`);
          return acceptHeader(headerInfo, null);
        },
        close() {
          log(`webSocketReadableStream is close`);
        },
        abort(reason) {
          log(`webSocketReadableStream is abort`, JSON.stringify(reason));
        }
      }),
      {
        signal,
        // 用超时控制的 AbortSignal（官方 AbortSignal.any 合并空闲/生命周期/外部信号）
        label: "ws->remote",
        onError: (err) => log("webSocketReadableStream pipeTo error", err)
      }
    );
  } catch (e) {
    if (e.name === "AbortError") {
      log("Stream aborted by AbortController, usually due to a timeout or explicit cancellation:", e);
    } else {
      log("Unexpected pipeTo error:", e);
    }
  }
  return new Response(null, { status: 101, webSocket: client });
}

// src/worker-基础版.js
var worker_default = {
  async fetch(request, env, ctx) {
    try {
      const runtime = resolveRuntimeConfig(env);
      const url = new URL(request.url);
      const path = url.pathname;
      const upgradeHeader = request.headers.get("Upgrade");
      if (!upgradeHeader || upgradeHeader !== "websocket") {
        if (path === "/") {
          const randomDomain = REDIRECT_LIST[Math.floor(Math.random() * REDIRECT_LIST.length)];
          return Response.redirect(randomDomain, 301);
        }
        return new Response("404 Not Found!", { status: 404 });
      }
      const connection = createConnContext(runtime, path, env);
      return await handleWS(connection, request);
    } catch (err) {
      return new Response(err.toString());
    }
  }
};
export {
  worker_default as default
};
