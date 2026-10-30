// src/common/codec.js
function base64Decode(base64Str) {
  let binary = atob(base64Str);
  let bytes = new Uint8Array([...binary].map((char) => char.charCodeAt(0)));
  let decoder = new TextDecoder();
  return decoder.decode(bytes);
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

// src/fctrl/runtime.js
function resolveFlowRuntimeConfig(env = {}) {
  const userID = env.UUID4 || BUILTIN_DEFAULTS.userID;
  let flowMode = String(env.FLOW || "auto").toLowerCase();
  if (flowMode === "off" || flowMode === "false" || flowMode === "0" || flowMode === "none") {
    flowMode = "none";
  } else if (flowMode === "vision" || flowMode === "on" || flowMode === "true" || flowMode === "1") {
    flowMode = "vision";
  } else {
    flowMode = "auto";
  }
  return {
    userID,
    flowMode,
    // 远端 TCP 主动断开时是否立刻关闭 WebSocket（默认关闭）
    closeWSOnSocketClosed: parseBoolEnv(env.CLOSE_WS_ON_SOCKET_CLOSE, false)
  };
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

// src/fctrl/traffic.js
var SIZE = 8192;
var TLS_HEAD = [22, 3, 3];
var TLS_HEAD_CLIENT = [22, 3];
var TLS_APP = [23, 3, 3];
var TLS13_SIGN = [0, 43, 0, 2, 3, 4];
var HS_CLIENT_HELLO = 1;
var HS_SERVER_HELLO = 2;
var CMD_CONTINUE = 0;
var CMD_END = 1;
var SEED = [900, 500, 900, 256];
var TLS13_SUITE = /* @__PURE__ */ new Set([4865, 4866, 4867, 4868, 4869]);
var TLS13_EXCLUDE = 4869;
function toU8(x) {
  return x instanceof Uint8Array ? x : new Uint8Array(x);
}
function startsWith(a, b, n) {
  if (a.byteLength < n) return false;
  for (let i = 0; i < n; i++) if (a[i] !== b[i]) return false;
  return true;
}
function contains(hay, needle) {
  const n = needle.length;
  outer: for (let i = 0; i + n <= hay.length; i++) {
    for (let j = 0; j < n; j++) if (hay[i + j] !== needle[j]) continue outer;
    return true;
  }
  return false;
}
function randInt(max) {
  return Math.floor(Math.random() * max);
}
function hex(bytes, n) {
  if (!bytes) return "";
  const len = Math.min(n ?? bytes.byteLength, bytes.byteLength);
  let s = "";
  for (let i = 0; i < len; i++) s += bytes[i].toString(16).padStart(2, "0");
  return s;
}
function createTrafficState(userUUID) {
  const uuid = toU8(userUUID).slice(0, 16);
  return {
    userUUID: uuid,
    // 过滤 TLS 特征的剩余计数（前若干块内识别，识别完成后归零）
    numberOfPacketToFilter: 8,
    enableXtls: false,
    isTLS12orAbove: false,
    isTLS: false,
    cipher: 0,
    remainingServerHello: -1,
    // 是否已确认对端启用流控（由上行首块是否带 uuid 决定）
    flowStarted: false,
    // —— 上行读取（unpadding）状态 ——
    rRemainingCommand: -1,
    rRemainingContent: -1,
    rRemainingPadding: -1,
    rCurrentCommand: 0,
    // —— 下行写出（padding）状态 ——
    wIsPadding: false,
    // 未确认流控前置为 false，保证普通链路透传
    writeOnceUUID: uuid.slice()
    // 下行第一块要带 uuid，写一次后清空
  };
}
function filterTLS(state, buffers) {
  for (const b of buffers) {
    if (!b) continue;
    state.numberOfPacketToFilter--;
    if (b.byteLength >= 6) {
      if (startsWith(b, TLS_HEAD, 3) && b[5] === HS_SERVER_HELLO) {
        state.remainingServerHello = (b[3] << 8 | b[4]) + 5;
        state.isTLS12orAbove = true;
        state.isTLS = true;
        if (b.byteLength >= 79 && state.remainingServerHello >= 79) {
          const sidLen = b[43];
          const cs = 43 + sidLen + 1;
          state.cipher = b[cs] << 8 | b[cs + 1];
        }
      } else if (startsWith(b, TLS_HEAD_CLIENT, 2) && b[5] === HS_CLIENT_HELLO) {
        state.isTLS = true;
      }
    }
    if (state.remainingServerHello > 0) {
      const end = Math.min(state.remainingServerHello, b.byteLength);
      state.remainingServerHello -= end;
      if (contains(b.subarray(0, end), TLS13_SIGN)) {
        const known = TLS13_SUITE.has(state.cipher);
        if (known && state.cipher !== TLS13_EXCLUDE) state.enableXtls = true;
        state.numberOfPacketToFilter = 0;
        return;
      } else if (state.remainingServerHello <= 0) {
        state.numberOfPacketToFilter = 0;
        return;
      }
    }
  }
}
function isTLSAppRecord(b) {
  return b.byteLength > 6 && startsWith(b, TLS_APP, 3);
}
function xtlsPadding(content, command, state, longPadding) {
  const contentLen = content ? content.byteLength : 0;
  let paddingLen;
  if (contentLen < SEED[0] && longPadding) {
    paddingLen = randInt(SEED[1]) + SEED[2] - contentLen;
  } else {
    paddingLen = randInt(SEED[3]);
  }
  const cap = SIZE - 21 - contentLen;
  if (paddingLen > cap) paddingLen = cap;
  if (paddingLen < 0) paddingLen = 0;
  const head = new Uint8Array([command, contentLen >> 8 & 255, contentLen & 255, paddingLen >> 8 & 255, paddingLen & 255]);
  const parts = [];
  if (state.writeOnceUUID) {
    parts.push(state.writeOnceUUID);
    state.writeOnceUUID = null;
  }
  parts.push(head);
  if (content && content.byteLength) parts.push(content);
  if (paddingLen) parts.push(new Uint8Array(paddingLen));
  return concatBytes(...parts);
}
function padBuffers(state, buffers) {
  const list = buffers.filter(Boolean);
  if (!list.length) return [];
  const out = [];
  const longPadding = state.isTLS;
  for (let i = 0; i < list.length; i++) {
    const b = list[i];
    if (state.isTLS && isTLSAppRecord(b)) {
      out.push(xtlsPadding(b, CMD_END, state, true));
      state.wIsPadding = false;
      for (let j = i + 1; j < list.length; j++) out.push(list[j]);
      return out;
    }
    if (!state.isTLS12orAbove && state.numberOfPacketToFilter <= 1) {
      out.push(xtlsPadding(b, CMD_END, state, longPadding));
      state.wIsPadding = false;
      for (let j = i + 1; j < list.length; j++) out.push(list[j]);
      return out;
    }
    out.push(xtlsPadding(b, CMD_CONTINUE, state, longPadding));
  }
  return out;
}
function createUpReader(state, log = () => {
}) {
  let pending = new Uint8Array(0);
  let decided = false;
  let isFlow = false;
  let paddingDone = false;
  async function feed(chunk) {
    const view = toU8(chunk);
    if (view.byteLength) pending = concatBytes(pending, view);
    const payloads = [];
    try {
      if (!decided) {
        if (pending.byteLength < 21) {
          log(`up wait: have=${pending.byteLength}/21`);
          return { payloads, error: null };
        }
        decided = true;
        const matches = startsWith(pending, state.userUUID, 16);
        log(`up decide: matchesUUID=${matches} head=${hex(pending, 32)} expect=${hex(state.userUUID, 16)}`);
        if (matches) {
          isFlow = true;
          state.flowStarted = true;
          state.wIsPadding = true;
          pending = pending.slice(16);
          state.rRemainingCommand = 5;
        } else {
          isFlow = false;
        }
      }
      if (!isFlow) {
        if (pending.byteLength) {
          payloads.push(pending);
          pending = new Uint8Array(0);
        }
        return { payloads, error: null };
      }
      if (paddingDone) {
        if (pending.byteLength) {
          payloads.push(pending);
          pending = new Uint8Array(0);
        }
        if (state.numberOfPacketToFilter > 0 && payloads.length) filterTLS(state, payloads);
        if (payloads.length) log(`up passthrough: [${payloads.map((p) => p.byteLength).join(",")}]B first=${hex(payloads[0], 16)}`);
        return { payloads, error: null };
      }
      while (pending.byteLength > 0) {
        if (state.rRemainingCommand > 0) {
          const data = pending[0];
          pending = pending.slice(1);
          switch (state.rRemainingCommand) {
            case 5:
              state.rCurrentCommand = data;
              break;
            case 4:
              state.rRemainingContent = data << 8;
              break;
            case 3:
              state.rRemainingContent |= data;
              break;
            case 2:
              state.rRemainingPadding = data << 8;
              break;
            case 1:
              state.rRemainingPadding |= data;
              break;
          }
          state.rRemainingCommand--;
        } else if (state.rRemainingContent > 0) {
          let len = state.rRemainingContent;
          if (pending.byteLength < len) len = pending.byteLength;
          payloads.push(pending.slice(0, len));
          pending = pending.slice(len);
          state.rRemainingContent -= len;
        } else {
          let len = state.rRemainingPadding;
          if (pending.byteLength < len) len = pending.byteLength;
          pending = pending.slice(len);
          state.rRemainingPadding -= len;
        }
        if (state.rRemainingCommand <= 0 && state.rRemainingContent <= 0 && state.rRemainingPadding <= 0) {
          if (state.rCurrentCommand === 0) {
            state.rRemainingCommand = 5;
          } else {
            state.rRemainingCommand = -1;
            state.rRemainingContent = -1;
            state.rRemainingPadding = -1;
            if (pending.byteLength > 0) payloads.push(pending);
            pending = new Uint8Array(0);
            paddingDone = true;
            break;
          }
        }
      }
    } catch (e) {
      return { payloads, error: e?.message || String(e) };
    }
    if (payloads.length) log(`up out: [${payloads.map((p) => p.byteLength).join(",")}]B first=${hex(payloads[0], 16)}`);
    if (state.numberOfPacketToFilter > 0 && payloads.length) {
      filterTLS(state, payloads);
    }
    return { payloads, error: null };
  }
  return { feed };
}
function createDownWriter(state, log = () => {
}, onActivity = null) {
  return function makeTransform() {
    let headerSent = false;
    let n = 0;
    return new TransformStream({
      transform(chunk, controller) {
        const view = toU8(chunk);
        if (!view.byteLength) return;
        n++;
        onActivity?.();
        const mb = [view];
        if (state.numberOfPacketToFilter > 0) filterTLS(state, mb);
        const out = state.flowStarted && state.wIsPadding ? padBuffers(state, mb) : mb.filter(Boolean);
        const seq = headerSent ? out : [new Uint8Array([0, 0]), ...out];
        headerSent = true;
        if (n <= 12) {
          log(`down #${n}: in=${view.byteLength}B out=[${out.map((p) => p.byteLength).join(",")}] flowStarted=${state.flowStarted} wIsPadding=${state.wIsPadding} isTLS=${state.isTLS} tls13=${state.enableXtls} npf=${state.numberOfPacketToFilter} head=${hex(view, 6)}`);
        }
        for (const p of seq) if (p && p.byteLength) controller.enqueue(p);
      }
    });
  };
}

// src/fctrl/entry.js
function uuidToBytes(str) {
  const hex2 = String(str).replace(/-/g, "");
  if (hex2.length !== 32) return null;
  const out = new Uint8Array(16);
  for (let i = 0; i < 16; i++) {
    const byte = parseInt(hex2.slice(i * 2, i * 2 + 2), 16);
    if (Number.isNaN(byte)) return null;
    out[i] = byte;
  }
  return out;
}
function parseFlowAddons(bytes) {
  let p = 0;
  let flow = "";
  while (p < bytes.length) {
    const tag = bytes[p++];
    const field = tag >> 3;
    const wire = tag & 7;
    if (wire === 2) {
      if (p >= bytes.length) break;
      const len = bytes[p++];
      if (p + len > bytes.length) break;
      if (field === 1) flow = new TextDecoder().decode(bytes.subarray(p, p + len));
      p += len;
    } else if (wire === 0) {
      while (p < bytes.length && bytes[p] & 128) p++;
      p++;
    } else if (wire === 5) {
      p += 4;
    } else if (wire === 1) {
      p += 8;
    } else {
      break;
    }
  }
  return flow;
}
function equalBytes(a, b) {
  if (a.byteLength !== b.byteLength) return false;
  for (let i = 0; i < a.byteLength; i++) if (a[i] !== b[i]) return false;
  return true;
}
function mapAddrType(at) {
  return { 1: 1, 2: 3, 3: 4 }[at] ?? null;
}
function parseEntry(buf, uuidBytes) {
  if (buf.byteLength < 1) return { status: "need_more" };
  if (buf[0] !== 0) return { status: "error", message: `bad version ${buf[0]}` };
  if (buf.byteLength < 17) return { status: "need_more" };
  if (!equalBytes(buf.subarray(1, 17), uuidBytes)) return { status: "error", message: "uuid mismatch" };
  if (buf.byteLength < 18) return { status: "need_more" };
  const addonsLen = buf[17];
  let p = 18;
  if (buf.byteLength < p + addonsLen) return { status: "need_more" };
  const flow = parseFlowAddons(buf.subarray(p, p + addonsLen));
  p += addonsLen;
  if (buf.byteLength < p + 1) return { status: "need_more" };
  const command = buf[p++];
  if (command === 3) return { status: "error", message: "mux not supported" };
  if (command !== 1 && command !== 2) return { status: "error", message: `bad command ${command}` };
  const isUDP = command === 2;
  if (buf.byteLength < p + 3) return { status: "need_more" };
  const port = buf[p] << 8 | buf[p + 1];
  p += 2;
  const addrType = buf[p++];
  let address = "";
  if (addrType === 1) {
    if (buf.byteLength < p + 4) return { status: "need_more" };
    address = `${buf[p]}.${buf[p + 1]}.${buf[p + 2]}.${buf[p + 3]}`;
    p += 4;
  } else if (addrType === 2) {
    if (buf.byteLength < p + 1) return { status: "need_more" };
    const len = buf[p++];
    if (buf.byteLength < p + len) return { status: "need_more" };
    address = new TextDecoder().decode(buf.subarray(p, p + len));
    p += len;
  } else if (addrType === 3) {
    if (buf.byteLength < p + 16) return { status: "need_more" };
    const parts = [];
    for (let i = 0; i < 8; i++, p += 2) parts.push((buf[p] << 8 | buf[p + 1]).toString(16));
    address = parts.join(":");
  } else {
    return { status: "error", message: `bad addrType ${addrType}` };
  }
  return {
    status: "ok",
    addressRemote: address,
    portRemote: port,
    addressType: mapAddrType(addrType),
    isUDP,
    flow,
    body: buf.subarray(p)
  };
}

// src/fctrl/session.js
var FLOW_DEBUG = false;
var DEBUG_MAX = 12;
function toU82(x) {
  return x instanceof Uint8Array ? x : new Uint8Array(x);
}
function hexHead(bytes, n) {
  if (!bytes) return "";
  const len = Math.min(n ?? bytes.byteLength, bytes.byteLength);
  let s = "";
  for (let i = 0; i < len; i++) s += bytes[i].toString(16).padStart(2, "0");
  return s;
}
async function handleWS(ctx, request) {
  const [client, webSocket] = Object.values(new WebSocketPair());
  webSocket.binaryType = "arraybuffer";
  webSocket.accept();
  let address = "";
  let portWithRandomLog = "";
  const log = (info, event) => {
    console.log(`[${address}:${portWithRandomLog}] ${info}`, event || "");
  };
  const dbg = (...args) => {
    if (FLOW_DEBUG) console.log("[flow]", ...args);
  };
  const { resetIdleTimer, signal } = setupKeepalive({
    webSocket,
    idleTimeoutMs: 2e4,
    maxLifetimeMs: 18e4,
    onAbort: (reason) => {
      log("disconnecting reason:", reason);
      dbg("keepalive abort:", reason);
      closeWS(webSocket);
    }
  });
  const earlyDataHeader = request.headers.get("sec-websocket-protocol") || "";
  const webSocketReadableStream = makeWSStream(webSocket, earlyDataHeader, log);
  const remoteSocketWrapper = { value: null, writer: null };
  let trafficState = null;
  let upReader = null;
  let hsBuf = new Uint8Array(0);
  let handshakeDone = false;
  let frameNo = 0;
  const clearHandshakeTimer = startHelloTimer({ webSocket, remoteSocketWrapper, timeoutMs: 5e3, log });
  const uuidBytes = uuidToBytes(ctx.userID);
  const flowMode = ctx.flowMode || "auto";
  const useFlow = flowMode !== "none";
  dbg("flow mode=", flowMode, "useFlow=", useFlow);
  dbg("session start: path=", new URL(request.url).pathname, "expectedUUID=", hexHead(uuidBytes, 16), "earlyDataHeaderLen=", earlyDataHeader.length);
  async function acceptHeader(headerInfo, extraPayloads, { awaitConnect = false } = {}) {
    clearHandshakeTimer();
    if (headerInfo?.isUDP) {
      dbg("acceptHeader: UDP \u8BF7\u6C42\uFF0C\u76F4\u63A5\u4E22\u5F03");
      return;
    }
    address = headerInfo?.addressRemote;
    portWithRandomLog = `${headerInfo?.portRemote}--${Math.random()} tcp `;
    dbg(`acceptHeader: TCP target=${address}:${headerInfo?.portRemote} rawClientData=${headerInfo?.rawClientData?.byteLength ?? 0}B extra=${extraPayloads?.length ?? 0}`);
    const start = () => openChannel(ctx, remoteSocketWrapper, headerInfo, webSocket, log).catch((err) => {
      log("handleTCPOutbds error", err);
      dbg("openChannel failed:", err?.message || String(err));
      closeWS(webSocket);
    });
    if (!awaitConnect) return start();
    await start();
    dbg("openChannel ready, writer=", !!remoteSocketWrapper.writer);
    const sock = remoteSocketWrapper.value;
    if (sock?.closed) {
      sock.closed.catch((e) => dbg("target sock closed with error:", e?.message || String(e))).finally(() => dbg("target sock closed"));
    }
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
          if (handshakeDone) {
            const view2 = toU82(chunk);
            frameNo++;
            if (frameNo <= DEBUG_MAX) dbg(`#${frameNo} in=${view2.byteLength}B (post-handshake) head=${hexHead(view2, 16)}`);
            if (!useFlow) {
              const w = remoteSocketWrapper.writer;
              if (w && view2.byteLength) await w.write(view2);
              return;
            }
            const out = await upReader.feed(view2);
            if (out.error) {
              dbg("up feed error:", out.error);
              return controller.error(`flow decode error: ${out.error}`);
            }
            const writer = remoteSocketWrapper.writer;
            if (writer) {
              for (const p of out.payloads) if (p.byteLength) await writer.write(p);
            } else {
              dbg("post-handshake chunk dropped: writer \u672A\u5C31\u7EEA");
            }
            return;
          }
          const view = toU82(chunk);
          frameNo++;
          if (frameNo <= DEBUG_MAX) dbg(`#${frameNo} in=${view.byteLength}B (handshake) head=${hexHead(view, 32)}`);
          hsBuf = concatBytes(hsBuf, view);
          const parsed = parseEntry(hsBuf, uuidBytes);
          if (parsed.status === "need_more") {
            dbg(`entry need_more: have=${hsBuf.byteLength}B`);
            if (hsBuf.byteLength > 65536) return controller.error("entry header too long");
            return;
          }
          if (parsed.status === "error") {
            dbg("entry parse error:", parsed.message, "bufHead=", hexHead(hsBuf, 32));
            return controller.error(`entry parse error: ${parsed.message}`);
          }
          dbg(`entry ok: flow="${parsed.flow}" proto=${parsed.isUDP ? "udp" : "tcp"} target=${parsed.addressRemote}:${parsed.portRemote} body=${parsed.body.byteLength}B bodyHead=${hexHead(parsed.body, 32)}`);
          if (flowMode === "none" && parsed.flow) {
            dbg(`mode=none: \u5BA2\u6237\u7AEF\u58F0\u660E flow="${parsed.flow}"\uFF0C\u62D2\u7EDD`);
            return controller.error(`server mode=none: flow must be empty, got "${parsed.flow}"`);
          }
          if (flowMode === "vision" && parsed.flow !== "xtls-rprx-vision") {
            dbg(`mode=vision: \u5BA2\u6237\u7AEF flow="${parsed.flow}"\uFF0C\u62D2\u7EDD`);
            return controller.error(`server mode=vision: flow must be "xtls-rprx-vision"`);
          }
          handshakeDone = true;
          let rawClientData;
          let extraPayloads = [];
          let makeResponseTransform;
          if (useFlow) {
            trafficState = createTrafficState(uuidBytes);
            upReader = createUpReader(trafficState, dbg);
            const out = await upReader.feed(parsed.body);
            if (out.error) {
              dbg("up feed error:", out.error);
              return controller.error(`flow decode error: ${out.error}`);
            }
            extraPayloads = out.payloads.slice();
            rawClientData = extraPayloads.length ? extraPayloads.shift() : new Uint8Array(0);
            makeResponseTransform = createDownWriter(trafficState, dbg, resetIdleTimer);
            dbg(`handshake done: flowStarted=${trafficState.flowStarted} rawClientData=${rawClientData.byteLength}B extra=${extraPayloads.length}`);
          } else {
            rawClientData = parsed.body;
            dbg(`handshake done(none mode): passthrough rawClientData=${rawClientData.byteLength}B`);
          }
          const headerInfo = {
            hasError: false,
            addressRemote: parsed.addressRemote,
            portRemote: parsed.portRemote,
            addressType: parsed.addressType,
            rawClientData,
            responseHeader: new Uint8Array([0, 0]),
            isUDP: parsed.isUDP,
            makeResponseTransform
          };
          return acceptHeader(headerInfo, extraPayloads, { awaitConnect: true });
        },
        close() {
          log(`webSocketReadableStream is close`);
          dbg(`ws readable close: frameNo=${frameNo} handshakeDone=${handshakeDone} flowStarted=${trafficState?.flowStarted ?? false}`);
        },
        abort(reason) {
          log(`webSocketReadableStream is abort`, JSON.stringify(reason));
          dbg(`ws readable abort: frameNo=${frameNo} reason=${JSON.stringify(reason)}`);
        }
      }),
      {
        signal,
        label: "ws->remote",
        onError: (err) => {
          log("webSocketReadableStream pipeTo error", err);
          dbg("pipeTo error:", err?.message || String(err));
        }
      }
    );
  } catch (e) {
    if (e.name === "AbortError") {
      log("Stream aborted by AbortController, usually due to a timeout or explicit cancellation:", e);
      dbg("stream aborted:", e?.message || String(e));
    } else {
      log("Unexpected pipeTo error:", e);
      dbg("unexpected error:", e?.message || String(e));
    }
  }
  return new Response(null, { status: 101, webSocket: client });
}

// src/worker-流控版.js
var worker_default = {
  async fetch(request, env, ctx) {
    try {
      const runtime = resolveFlowRuntimeConfig(env);
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
