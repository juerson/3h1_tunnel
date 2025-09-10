// src/worker-基础版.js
import { connect } from "cloudflare:sockets";

// src/encrypt.js
function sha224Encrypt(str) {
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
    let [a, b, c, d, e, f, g, hh] = h;
    for (let j = 0; j < 64; j++) {
      const S1 = R(e, 6) ^ R(e, 11) ^ R(e, 25), ch = e & f ^ ~e & g;
      const temp1 = hh + S1 + ch + K[j] + w[j] >>> 0;
      const S0 = R(a, 2) ^ R(a, 13) ^ R(a, 22), maj = a & b ^ a & c ^ b & c;
      const temp2 = S0 + maj >>> 0;
      [hh, g, f, e, d, c, b, a] = [g, f, e, d + temp1 >>> 0, c, b, a, temp1 + temp2 >>> 0];
    }
    h[0] = h[0] + a >>> 0;
    h[1] = h[1] + b >>> 0;
    h[2] = h[2] + c >>> 0;
    h[3] = h[3] + d >>> 0;
    h[4] = h[4] + e >>> 0;
    h[5] = h[5] + f >>> 0;
    h[6] = h[6] + g >>> 0;
    h[7] = h[7] + hh >>> 0;
  }
  return h.slice(0, 7).map((x) => x.toString(16).padStart(8, "0")).join("");
}

// src/address.js
function hostPortParser(s) {
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
function socks5AddressParser(address) {
  let [latter, former] = address.split("@").reverse();
  let username, password, hostname, port;
  if (former) {
    const formers = former.split(":");
    if (formers.length !== 2) throw new Error("Invalid SOCKS address format");
    [username, password] = formers;
  }
  const latters = latter.split(":");
  port = Number(latters.pop());
  if (isNaN(port)) throw new Error("Invalid SOCKS address format");
  hostname = latters.join(":");
  const regex = /^\[.*\]$/;
  if (hostname.includes(":") && !regex.test(hostname)) {
    throw new Error("Invalid SOCKS address format");
  }
  return { username, password, hostname, port };
}

// src/worker-基础版.js
var userID = "61098bdc-b734-4874-9e87-d18b1ef1cfaf";
var sha224Password = "b379f280b9a4ce21e465cb31eea09a8fe3f4f8dd1850d9f630737538";
var codeDefaultSOCKS = "";
var codeDefaultHTTP = "";
var codeDefaultPYIP = "";
var codeDefaultNAT64 = `${["2602", "fc59", "b0", "64"].join(":")}::`;
var s5Lock = false;
var allowedRules = ["0.0.0.0/0", "::/0"];
var domainList = [
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
var parsedSocks5Address = {};
var parsedLandingAddress = { hostname: null, port: 443 };
var nat64IPv6Prefix = "";
var enableSocks = false;
var enableHttp = false;
var enableNat = false;
var worker_default = {
  async fetch(request, env, ctx) {
    try {
      userID = env.UUID4 || userID;
      sha224Password = sha224Encrypt(env.USERPWD || userID);
      s5Lock = (() => {
        const v = env.ENABLED_S5;
        if (typeof v === "boolean") return v;
        if (typeof v === "string") return ["1", "true", "yes", "on"].includes(v.trim().toLowerCase());
        return s5Lock;
      })();
      const raw = (env.ALLOWED_RULES ?? "").trim().split(/[, \n\r\t]+/).map((x) => x.trim()).filter(Boolean);
      allowedRules = raw.length > 0 ? raw : ["0.0.0.0/0", "::/0"];
      const url = new URL(request.url);
      const path = url.pathname;
      const upgradeHeader = request.headers.get("Upgrade");
      if (!upgradeHeader || upgradeHeader !== "websocket") {
        if (path === "/") {
          const randomDomain = domainList[Math.floor(Math.random() * domainList.length)];
          return Response.redirect(randomDomain, 301);
        }
        return new Response("404 Not Found!", { status: 404 });
      } else {
        parsedSocks5Address = {};
        enableSocks = false;
        enableHttp = false;
        enableNat = false;
        let connectData = parseConnetMode(path, env, codeDefaultSOCKS, codeDefaultHTTP, codeDefaultPYIP, codeDefaultNAT64);
        ({ parsedSocks5Address, parsedLandingAddress, nat64IPv6Prefix, enableSocks, enableHttp, enableNat } = connectData);
        return await handleWebSocket(request);
      }
    } catch (err) {
      return new Response(err.toString());
    }
  }
};
async function handleWebSocket(request) {
  const [client, webSocket] = Object.values(new WebSocketPair());
  webSocket.accept();
  let address = "";
  let portWithRandomLog = "";
  const log = (info, event) => {
    console.log(`[${address}:${portWithRandomLog}] ${info}`, event || "");
  };
  const outerController = new AbortController();
  const { resetIdleTimer, controller } = setupTimeoutControl({
    webSocket,
    signal: outerController.signal,
    // 支持外部终止
    idleTimeoutMs: 2e4,
    // 20s
    maxLifetimeMs: 18e4,
    // 180s
    onAbort: (reason) => {
      log?.("\u{1F433} disconnecting reason:", reason);
      safeCloseWebSocket(webSocket);
    }
  });
  const earlyDataHeader = request.headers.get("sec-websocket-protocol") || "";
  const webSocketReadableStream = makeWebSocketReadableStream(webSocket, earlyDataHeader, log);
  let isDns = false;
  let udpStreamWrite = null;
  let remoteSocketWrapper = { value: null };
  const clearHandshakeTimer = startHandshakeTimeout({
    webSocket,
    remoteSocketWrapper,
    timeoutMs: 5e3,
    // 5秒超时握手时间
    log
  });
  try {
    webSocketReadableStream.pipeTo(
      new WritableStream({
        async write(chunk, controller2) {
          resetIdleTimer();
          if (isDns && udpStreamWrite) {
            return udpStreamWrite(chunk);
          }
          if (remoteSocketWrapper.value) {
            const writer = remoteSocketWrapper.value.writable.getWriter();
            await writer.write(chunk);
            writer.releaseLock();
            return;
          }
          let mapCode = parsedProtocolMapCode(chunk, request, allowedRules);
          const parseHandlers = {
            ...s5Lock ? { 0: [parseSkc0swodahsHeader, [chunk]] } : {},
            1: [parseS5elvHeader, [chunk, userID]],
            2: [parseNaj0rtHeader, [chunk, sha224Password]]
          };
          const entry = parseHandlers[mapCode];
          if (!entry) return log(`Unsupported protocol mapCode: ${mapCode}`);
          const [handlerFn, args] = entry;
          let headerInfo = handlerFn(...args);
          if (!headerInfo || headerInfo?.hasError) return controller2.error(`Header parse error: ${headerInfo?.message}`);
          clearHandshakeTimer();
          if (headerInfo?.isUDP && headerInfo?.portRemote != 53) {
            return;
          } else if (headerInfo?.isUDP) {
            const { write } = await handleUDPOutbds(webSocket, headerInfo?.responseHeader, log);
            udpStreamWrite = write;
            udpStreamWrite(headerInfo?.rawClientData);
            return;
          }
          address = headerInfo?.addressRemote;
          portWithRandomLog = `${headerInfo?.portRemote}--${Math.random()} ${headerInfo?.isUDP ? "udp " : "tcp "}`;
          handleTCPOutbds(remoteSocketWrapper, headerInfo, webSocket, log);
        },
        close() {
          log(`webSocketReadableStream is close`);
        },
        abort(reason) {
          log(`webSocketReadableStream is abort`, JSON.stringify(reason));
        }
      }),
      { signal: controller.signal }
      // 用超时控制的AbortSignal(兼容外部signal)
    ).catch((err) => {
      log("webSocketReadableStream pipeTo error", err);
    });
  } catch (e) {
    if (e.name === "AbortError") {
      log("Stream aborted by AbortController, usually due to a timeout or explicit cancellation:", e);
    } else {
      log("Unexpected pipeTo error:", e);
    }
  }
  return new Response(null, { status: 101, webSocket: client });
}
function startHandshakeTimeout({ webSocket, remoteSocketWrapper, timeoutMs = 5e3, log }) {
  let handshakeTimeout = setTimeout(() => {
    if (!remoteSocketWrapper.value) {
      log("\u{1F91D} Handshake timeout: no protocol header received, closing WebSocket");
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
function setupTimeoutControl({ webSocket, signal, onAbort, idleTimeoutMs = 3e4, maxLifetimeMs = 18e4 }) {
  let idleTimer = null;
  let lifetimeTimer = null;
  const controller = new AbortController();
  let aborted = false;
  const cleanup = () => {
    clearTimeout(idleTimer);
    clearTimeout(lifetimeTimer);
    if (signal && onExternalAbort) {
      signal.removeEventListener("abort", onExternalAbort);
    }
  };
  const doAbort = (reason) => {
    if (aborted) return;
    aborted = true;
    console.warn(
      reason === "idle" ? `\u23F3 Idle for over ${idleTimeoutMs / 1e3}s, disconnecting.` : `\u{1F6D1} Max lifetime of ${maxLifetimeMs / 1e3}s reached, disconnecting.`
    );
    safeCloseWebSocket(webSocket);
    controller.abort();
    onAbort?.(reason);
    cleanup();
  };
  const resetIdleTimer = () => {
    clearTimeout(idleTimer);
    if (aborted) return;
    idleTimer = setTimeout(() => doAbort("idle"), idleTimeoutMs);
  };
  const onExternalAbort = () => {
    doAbort("external");
  };
  resetIdleTimer();
  lifetimeTimer = setTimeout(() => doAbort("lifetime"), maxLifetimeMs);
  signal?.addEventListener("abort", onExternalAbort);
  return {
    controller,
    // AbortController 实例
    resetIdleTimer,
    // 每次收到数据时要调用
    cleanup
    // 可手动提前释放资源
  };
}
function makeWebSocketReadableStream(webSocket, earlyDataHeader, log) {
  let canceled = false;
  const stream = new ReadableStream({
    start(controller) {
      webSocket.addEventListener("message", (e) => {
        if (!canceled) controller.enqueue(e.data);
      });
      webSocket.addEventListener("close", () => {
        if (!canceled) controller.close();
        safeCloseWebSocket(webSocket);
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
      safeCloseWebSocket(webSocket);
    }
  });
  return stream;
}
function parseS5elvHeader(buffer, userID2) {
  const view = new Uint8Array(buffer);
  if (view.length < 24) return { hasError: true, message: "Too short" };
  const bytes2UUID = (bytes) => [...bytes].map((b, i) => `${[4, 6, 8, 10].includes(i) ? "-" : ""}${b.toString(16).padStart(2, "0")}`).join("");
  const uuid = bytes2UUID(view.slice(1, 17));
  if (uuid !== userID2) return { hasError: true, message: "Unauthorized UUID" };
  const optLen = view[17];
  const base = 18 + optLen;
  let isUDP = false;
  const command = view[base];
  if (command === 2) isUDP = true;
  else if (command !== 1) return { hasError: true, message: `command ${command} is not support` };
  const port = view[base + 1] << 8 | view[base + 2];
  let p = base + 3;
  const addrType = view[p++];
  let address = "";
  if (addrType === 1) {
    address = `${view[p++]}.${view[p++]}.${view[p++]}.${view[p++]}`;
  } else if (addrType === 2) {
    const len = view[p++];
    let chars = [];
    for (let i = 0; i < len; ++i) chars.push(view[p + i]);
    address = String.fromCharCode(...chars);
    p += len;
  } else if (addrType === 3) {
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
function parseNaj0rtHeader(buffer, sha224Password2) {
  const view = new Uint8Array(buffer);
  if (view.length < 56 + 2 + 1 + 1 + 2 + 2) return { hasError: true, message: "Header too short" };
  const passStr = String.fromCharCode(...view.slice(0, 56));
  if (passStr !== sha224Password2) return { hasError: true, message: "Unauthorized password" };
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
function parseSkc0swodahsHeader(buffer) {
  const view = new DataView(buffer);
  const addrType = view.getUint8(0);
  let address = "", offset = 1;
  const textDecoder2 = new TextDecoder();
  if (addrType === 1) {
    address = Array.from(new Uint8Array(buffer.slice(1, 5))).join(".");
    offset = 5;
  } else if (addrType === 3) {
    const len = view.getUint8(1);
    address = textDecoder2.decode(buffer.slice(2, 2 + len));
    offset = 2 + len;
  } else if (addrType === 4) {
    const parts = [];
    for (let i = 0; i < 8; i++) parts.push(view.getUint16(1 + i * 2).toString(16));
    address = parts.join(":");
    offset = 17;
  } else {
    return { hasError: true, message: `Invalid addressType: ${addrType}` };
  }
  const port = new DataView(buffer.slice(offset, offset + 2)).getUint16(0);
  return {
    hasError: false,
    addressRemote: address,
    portRemote: port,
    rawClientData: buffer.slice(offset + 2),
    addressType: addrType,
    responseHeader: null,
    isUDP: false
  };
}
async function handleTCPOutbds(remoteSocket, headerInfo, webSocket, log) {
  const { addressType, addressRemote, portRemote, rawClientData, responseHeader: vResponseHeader } = headerInfo;
  async function connectAndWrite(address, port, { socks = false, http = false } = {}) {
    const tcpSocket2 = socks ? await socks5Connect(addressType, address, port, log) : http ? await httpConnect(address, port, log) : connect({ hostname: address, port });
    log(`connected to ${address}:${port}`);
    remoteSocket.value = tcpSocket2;
    const writer = tcpSocket2.writable.getWriter();
    await writer.write(rawClientData);
    writer.releaseLock();
    return tcpSocket2;
  }
  async function retry() {
    let opt = enableSocks ? { socks: true } : enableHttp ? { http: true } : {};
    if (enableSocks || enableHttp) {
      tcpSocket = await connectAndWrite(addressRemote, portRemote, opt);
    } else {
      const { address, port } = await resolveTargetAddress(addressRemote, portRemote);
      tcpSocket = await connectAndWrite(address, port);
    }
    tcpSocket.closed.catch((error) => log("retry tcpSocket closed error", error)).finally(() => safeCloseWebSocket(webSocket));
    remoteSocketToWS(tcpSocket, webSocket, vResponseHeader, null, log);
  }
  let tcpSocket = await connectAndWrite(addressRemote, portRemote);
  remoteSocketToWS(tcpSocket, webSocket, vResponseHeader, retry, log);
}
async function resolveTargetAddress(addressRemote, portRemote, serverAddr = parsedLandingAddress) {
  if (!enableNat && serverAddr?.hostname) {
    return {
      address: serverAddr.hostname,
      port: serverAddr.port || portRemote
    };
  } else {
    const nat64Address = await getNAT64IPv6Addr(addressRemote);
    return {
      address: nat64Address || addressRemote,
      port: portRemote
    };
  }
}
async function getNAT64IPv6Addr(addressRemote, prefix = nat64IPv6Prefix) {
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
async function socks5Connect(addressType, addressRemote, portRemote, log) {
  const { username, password, hostname, port } = parsedSocks5Address;
  const socket = connect({ hostname, port });
  const socksGreeting = new Uint8Array([5, 2, 0, 2]);
  const writer = socket.writable.getWriter();
  await writer.write(socksGreeting);
  log("sent socks greeting");
  const reader = socket.readable.getReader();
  const encoder = new TextEncoder();
  let res = (await reader.read()).value;
  if (res[0] !== 5) {
    log(`socks server version error: ${res[0]} expected: 5`);
    return;
  }
  if (res[1] === 255) {
    log("no acceptable methods");
    return;
  }
  if (res[1] === 2) {
    log("socks server needs auth");
    if (!username || !password) {
      log("please provide username/password");
      return;
    }
    const authRequest = new Uint8Array([1, username.length, ...encoder.encode(username), password.length, ...encoder.encode(password)]);
    await writer.write(authRequest);
    res = (await reader.read()).value;
    if (res[0] !== 1 || res[1] !== 0) {
      log("fail to auth socks server");
      return;
    }
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
      log(`invild  addressType is ${addressType}`);
      return;
  }
  const socksRequest = new Uint8Array([5, 1, 0, ...DSTADDR, portRemote >> 8, portRemote & 255]);
  await writer.write(socksRequest);
  log("sent socks request");
  res = (await reader.read()).value;
  if (res[1] === 0) log("socks connection opened");
  else {
    log("fail to open socks connection");
    return;
  }
  writer.releaseLock();
  reader.releaseLock();
  return socket;
}
var textEncoder = new TextEncoder();
var textDecoder = new TextDecoder();
function buildConnectRequest(host, port, username, password) {
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
async function sendRequest(sock, request) {
  const writer = sock.writable.getWriter();
  await writer.write(textEncoder.encode(request));
  writer.releaseLock();
}
async function readResponse(sock) {
  const reader = sock.readable.getReader();
  let headerBuffer = new Uint8Array(0);
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) throw new Error("HTTP\u8FDE\u63A5\u88AB\u4E2D\u65AD");
      headerBuffer = appendBuffer(headerBuffer, value);
      const headerEnd = findHeaderEnd(headerBuffer);
      if (headerEnd !== -1) {
        const responseText = textDecoder.decode(headerBuffer.slice(0, headerEnd));
        if (/^HTTP\/1\.[01] 200/.test(responseText)) {
          const body = headerBuffer.slice(headerEnd + 4);
          if (body.length) {
            const writer = sock.readable.getWriter();
            writer.write(body);
            writer.close();
          }
          return true;
        } else {
          throw new Error(`HTTP\u4EE3\u7406\u54CD\u5E94\u5F02\u5E38: ${responseText.split("\r\n")[0]}`);
        }
      }
    }
  } finally {
    reader.releaseLock();
  }
}
function appendBuffer(buffer, newData) {
  const newLength = buffer.length + newData.length;
  if (buffer.length === 0) return newData;
  const mergedBuffer = new Uint8Array(newLength);
  mergedBuffer.set(buffer);
  mergedBuffer.set(newData, buffer.length);
  return mergedBuffer;
}
function findHeaderEnd(buffer) {
  for (let i = 0; i < buffer.length - 3; i++) {
    if (buffer[i] === 13 && buffer[i + 1] === 10 && buffer[i + 2] === 13 && buffer[i + 3] === 10) {
      return i;
    }
  }
  return -1;
}
async function httpConnect(remoteHost, remotePort, log) {
  const { hostname, port, username, password } = parsedSocks5Address;
  log(`\u51C6\u5907\u4F7F\u7528HTTP\u4EE3\u7406 ${hostname}:${port} \u8FDE\u63A5 ${remoteHost}:${remotePort}`);
  const sock = await connect({ hostname, port });
  const request = buildConnectRequest(remoteHost, remotePort, username, password);
  await sendRequest(sock, request);
  const success = await readResponse(sock);
  if (!success) throw new Error("HTTP\u4EE3\u7406\u8FDE\u63A5\u5931\u8D25");
  log(`HTTP\u8FDE\u63A5 ${remoteHost}:${remotePort} \u6210\u529F\uFF01`);
  return sock;
}
async function remoteSocketToWS(remoteSocket, webSocket, vRspnHeader = null, retry, log) {
  let hasData = false, firstChunk = true, headerBuffer = vRspnHeader instanceof Uint8Array ? vRspnHeader : null;
  const writer = new WritableStream({
    write(chunk, controller) {
      if (webSocket.readyState !== WebSocket.OPEN) return controller.error("WebSocket not open");
      try {
        let payload;
        if (firstChunk && headerBuffer) {
          payload = new Uint8Array(headerBuffer.length + chunk.length);
          payload.set(headerBuffer, 0);
          payload.set(chunk, headerBuffer.length);
          firstChunk = false;
          headerBuffer = null;
        } else {
          payload = chunk;
        }
        webSocket.send(payload);
        hasData = true;
      } catch (e) {
        controller.error("WritableStream error", e);
      }
    },
    abort(reason) {
      console.error("WritableStream aborted:", reason);
    }
  });
  try {
    await remoteSocket.readable.pipeTo(writer);
  } catch (e) {
    console.error("pipeTo error in remoteSocketToWS:", e);
    safeCloseWebSocket(webSocket);
  }
  if (!hasData && typeof retry === "function") retry();
}
function base64ToArrayBuffer(base64Str) {
  if (!base64Str) return { earlyData: null, error: null };
  try {
    const normalized = base64Str.replace(/-/g, "+").replace(/_/g, "/");
    const binaryStr = atob(normalized);
    const len = binaryStr.length;
    const buffer = new Uint8Array(len);
    for (let i = 0; i < len; i++) {
      buffer[i] = binaryStr.charCodeAt(i);
    }
    return { earlyData: buffer.buffer, error: null };
  } catch (error) {
    return { earlyData: null, error };
  }
}
function safeCloseWebSocket(ws, code = 1e3, reason = "Normal Closure") {
  try {
    if (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING) {
      ws.close(code, reason);
    }
  } catch (e) {
    console.error("Failed close WebSocket", e);
  }
}
async function handleUDPOutbds(webSocket, vResponseHeader, log) {
  let isS5elvHeaderSent = false;
  const transformStream = new TransformStream({
    start(controller) {
    },
    transform(chunk, controller) {
      for (let index = 0; index < chunk.byteLength; ) {
        const lengthBuffer = chunk.slice(index, index + 2);
        const udpPakcetLength = new DataView(lengthBuffer).getUint16(0);
        const udpData = new Uint8Array(chunk.slice(index + 2, index + 2 + udpPakcetLength));
        index = index + 2 + udpPakcetLength;
        controller.enqueue(udpData);
      }
    },
    flush(controller) {
    }
  });
  transformStream.readable.pipeTo(
    new WritableStream({
      async write(chunk) {
        const resp = await fetch("https://1.1.1.1/dns-query", { method: "POST", headers: { "content-type": "application/dns-message" }, body: chunk });
        const dnsQueryResult = await resp.arrayBuffer();
        const udpSize = dnsQueryResult.byteLength;
        const udpSizeBuffer = new Uint8Array([udpSize >> 8 & 255, udpSize & 255]);
        if (webSocket.readyState === WebSocket.OPEN) {
          log(`doh success and dns message length is ${udpSize}`);
          if (isS5elvHeaderSent) {
            webSocket.send(await new Blob([udpSizeBuffer, dnsQueryResult]).arrayBuffer());
          } else {
            webSocket.send(await new Blob([vResponseHeader, udpSizeBuffer, dnsQueryResult]).arrayBuffer());
            isS5elvHeaderSent = true;
          }
        }
      }
    })
  ).catch((error) => log("dns udp has error" + error));
  const writer = transformStream.writable.getWriter();
  return {
    write(chunk) {
      writer.write(chunk);
    }
  };
}
function parsedProtocolMapCode(buffer, request = null, allowedRules2 = ["0.0.0.0/0", "::/0"]) {
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
    if (validB1.includes(view[0]) && Array.isArray(allowedRules2)) {
      if (allowedRules2.some((r) => r === "0.0.0.0/0" || r === "::/0")) return 0;
      if (request) {
        const ip = request.headers.get("CF-Connecting-IP");
        if (ip && allowedRules2.some((rule) => isIpMatch(ip, rule))) {
          return 0;
        }
      }
    }
  }
  return 3;
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
function parseConnetMode(path, env, codeDefaultSOCKS2, codeDefaultHTTP2, codeDefaultPYIP2, codeDefaultNAT642) {
  let socksAddr = env.SOCKS5 || codeDefaultSOCKS2;
  let httpAddr = env.HTTP || codeDefaultHTTP2;
  let pyipStr = env.LANDING_ADDRESS || codeDefaultPYIP2;
  let nat64Addr = env.NAT64 || codeDefaultNAT642;
  const hasSocks = path.includes("/socks=");
  const hasHttpMath = path.match(/\/(https?)=([^/]+)/i);
  const hasPyIp = path.includes("/pyip=");
  const hasNat64 = path.includes("/nat=");
  let enableSocks2 = false;
  let enableHttp2 = false;
  let enableNat2 = false;
  let parsedLandingAddress2 = { hostname: null, port: 443 };
  let parsedSocks5Address2 = {};
  if (hasSocks) {
    let socksAddr2 = path.split("/socks=")[1];
    parsedSocks5Address2 = socks5AddressParser(socksAddr2);
    enableSocks2 = true;
  } else if (hasHttpMath) {
    let httpAddr2 = hasHttpMath[2];
    parsedSocks5Address2 = socks5AddressParser(httpAddr2);
    enableHttp2 = true;
  } else if (hasPyIp) {
    let pyAddr = path.split("/pyip=")[1];
    let arr = pyAddr.split(",");
    let randomIndex = Math.floor(Math.random() * arr.length);
    let choiceAddr = arr[randomIndex].trim();
    parsedLandingAddress2 = hostPortParser(choiceAddr);
  } else if (hasNat64) {
    nat64Addr = path.split("/nat=")[1];
    enableNat2 = true;
  } else if (socksAddr) {
    parsedSocks5Address2 = socks5AddressParser(socksAddr);
    enableSocks2 = true;
  } else if (httpAddr) {
    parsedSocks5Address2 = socks5AddressParser(httpAddr);
    enableHttp2 = true;
  } else if (pyipStr) {
    let arr = pyipStr.split(",");
    let randomIndex = Math.floor(Math.random() * arr.length);
    let choiceAddr = arr[randomIndex].trim();
    parsedLandingAddress2 = hostPortParser(choiceAddr);
  }
  let nat64IPv6Prefix2 = nat64Addr.split("/")[0];
  return { parsedSocks5Address: parsedSocks5Address2, parsedLandingAddress: parsedLandingAddress2, nat64IPv6Prefix: nat64IPv6Prefix2, enableSocks: enableSocks2, enableHttp: enableHttp2, enableNat: enableNat2 };
}
export {
  worker_default as default
};
