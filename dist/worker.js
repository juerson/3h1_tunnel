// src/worker.js
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

// src/base64.js
function base64Encode(str) {
  let encoder = new TextEncoder();
  let bytes = encoder.encode(str);
  let binary = Array.from(bytes, (byte) => String.fromCharCode(byte)).join("");
  return btoa(binary);
}
function base64Decode(base64Str) {
  let binary = atob(base64Str);
  let bytes = new Uint8Array([...binary].map((char) => char.charCodeAt(0)));
  let decoder = new TextDecoder();
  return decoder.decode(bytes);
}

// src/crawler.js
async function fetchGitHubFile(token, owner, repo, filePath, branch = "main") {
  const githubUrl = `https://api.github.com/repos/${owner}/${repo}/contents/${filePath}?ref=${branch}`;
  try {
    const response = await fetch(githubUrl, {
      headers: {
        Authorization: `token ${token}`,
        Accept: "application/vnd.github.v3.raw",
        "User-Agent": "Mozilla/5.0"
      }
    });
    if (!response.ok) {
      console.error(`GitHub API Error: ${response.status} ${response.statusText}`);
      return emptyFile();
    }
    const contentType = response.headers.get("Content-Type") || "application/octet-stream";
    const body = await response.arrayBuffer();
    return { body, contentType };
  } catch (error) {
    console.error(`Network or parsing error: ${error.message}`);
    return emptyFile();
  }
  function emptyFile() {
    return { body: new ArrayBuffer(0), contentType: "text/plain; charset=utf-8" };
  }
}
async function fetchWebPageContent(url) {
  try {
    const response = await fetch(url);
    if (response.ok) {
      return await response.text();
    }
    console.error(`Failed to get: ${response.status}`);
  } catch (err) {
    console.error(`Failed to fetch ${url} web content: ${err.message}`);
  }
  return "";
}

// src/address.js
function splitArrayByMaxSize(array, maxChunkSize) {
  const result = [];
  for (let i = 0; i < array.length; i += maxChunkSize) {
    result.push(array.slice(i, i + maxChunkSize));
  }
  return result;
}
function ipsPaging(ipsArray, maxNode, page, upperLimit = 500, defaultCount = 300) {
  if (!Array.isArray(ipsArray)) {
    return { hasError: true, message: "\u8F93\u5165\u6570\u636E\u4E0D\u662F\u6709\u6548\u7684\u6570\u7EC4" };
  }
  let max = maxNode > 0 && maxNode <= upperLimit ? maxNode : defaultCount;
  let chunkedArray = splitArrayByMaxSize(ipsArray, max);
  let totalPage = chunkedArray.length;
  if (page > totalPage || page < 1) {
    return { hasError: true, message: "\u6570\u636E\u4E3A\u7A7A\uFF0C\u6216\u8005\u6CA1\u6709\u8BE5\u9875\u6570\uFF0C\u6570\u636E\u8FC7\u5C11\u8FDC\u8FBE\u4E0D\u5230\u8FD9\u4E2A\u9875\u7801\uFF01" };
  }
  let data = chunkedArray[page - 1];
  console.log(`\u5F53\u524D\u9875\u7801\uFF1A${page}\uFF0C\u603B\u9875\u6570\uFF1A${totalPage}\uFF0C\u6BCF\u9875\u6700\u5927\u8282\u70B9\u6570\uFF1A${max}`);
  return { chunkedIPs: data, totalPage };
}
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
function isValidCIDR(cidr) {
  if (typeof cidr !== "string") return false;
  const cidrPattern = /^(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})\/(\d{1,2})$/;
  const match = cidr.match(cidrPattern);
  if (!match) return false;
  const ipParts = match[1].split(".").map(Number);
  const prefix = Number(match[2]);
  if (ipParts.some((n) => n < 0 || n > 255 || !Number.isInteger(n)) || prefix < 0 || prefix > 32 || !Number.isInteger(prefix)) {
    return false;
  }
  return true;
}
function cidrToIpRange(cidr) {
  const [ip, prefix] = cidr.split("/");
  const ipParts = ip.split(".").map(Number);
  const base = ipParts[0] << 24 | ipParts[1] << 16 | ipParts[2] << 8 | ipParts[3];
  const bits = 32 - parseInt(prefix, 10);
  const count = bits === 0 ? 2 ** 32 : 2 ** bits;
  return { base: base >>> 0, count };
}
function intToIp(int) {
  return [
    int >>> 24 & 255,
    int >>> 16 & 255,
    int >>> 8 & 255,
    int & 255
  ].join(".");
}
function getRandomIndexes(n, size) {
  if (size > n) size = n;
  const arr = Array.from({ length: n }, (_, i) => i);
  for (let i = 0; i < size; i++) {
    const j = i + Math.floor(Math.random() * (n - i));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr.slice(0, size);
}
function generateIPsFromCIDR(cidr, maxCount = 1e3, ratio = 4) {
  try {
    if (!isValidCIDR(cidr)) return [];
    if (!Number.isInteger(maxCount) || maxCount <= 0) return [];
    const { base, count } = cidrToIpRange(cidr);
    if (!Number.isFinite(count) || count <= 0) return [];
    const maxTotal = maxCount * ratio;
    const FULL_GEN_THRESHOLD = 2048;
    const useFullTable = count <= FULL_GEN_THRESHOLD || count <= maxTotal;
    if (useFullTable) {
      if (count <= maxCount) {
        return Array.from({ length: count }, (_, i) => intToIp(base + i));
      } else {
        const randomOffsets = getRandomIndexes(count, maxCount);
        return randomOffsets.map((offset) => intToIp(base + offset));
      }
    }
    const set = /* @__PURE__ */ new Set();
    const ATTEMPT_LIMIT = maxCount * 10;
    let attempt = 0;
    while (set.size < maxCount && attempt < ATTEMPT_LIMIT) {
      const offset = Math.floor(Math.random() * count);
      set.add(intToIp(base + offset));
      attempt++;
    }
    if (set.size < maxCount) return [];
    return Array.from(set);
  } catch (e) {
    console.log("function generateIPsFromCIDR error:", e);
    return [];
  }
}

// src/output.js
var base64Fp = ["Y2hyb21l", "ZmlyZWZveA==", "ZWRnZQ==", "c2FmYXJp", "aW9z", "YW5kcm9pZA==", "cmFuZG9t", "cmFuZG9taXplZA=="];
var HTTP_WITH_PORTS = [80, 8080, 8880, 2052, 2082, 2086, 2095];
var HTTPS_WITH_PORTS = [443, 2053, 2083, 2087, 2096, 8443];
function getRandomElement(array) {
  const randomIndex = Math.floor(Math.random() * array.length);
  return array[randomIndex];
}
function markdownToHtml(md) {
  return md.replace(/^# (.*$)/gim, "<h1>$1</h1>").replace(/^## (.*$)/gim, "<h2>$1</h2>").replace(/^### (.*$)/gim, "<h3>$1</h3>").replace(/`{3}([\s\S]*?)`{3}/gim, "<pre><code>$1</code></pre>").replace(/`([^`]+)`/gim, "<code>$1</code>").replace(/\*\*(.*?)\*\*/gim, "<strong>$1</strong>").replace(/\*(.*?)\*/gim, "<em>$1</em>").replace(/\n$/gim, "<br />");
}
function getBaseConfig(subParameter, hostName, nodePath = "/") {
  let { uuid, password, onSs } = subParameter;
  let addr = "www.visa.com";
  let path = nodePath;
  let plugin = (isWorkersDevDomain) => {
    return encodeURIComponent([`${atob("djJyYXktcGx1Z2lu")}`, ...isWorkersDevDomain ? [] : ["tls"], "mux=0", "mode=websocket", `path=${path}`, `host=${hostName}`].join(";"));
  };
  let params = [
    {
      "tls": "none",
      "port": getRandomElement(HTTP_WITH_PORTS),
      "plugin": plugin(true),
      "randomfp": atob(getRandomElement(base64Fp))
    },
    {
      "tls": "tls",
      "port": getRandomElement(HTTPS_WITH_PORTS),
      "plugin": plugin(false),
      "randomfp": atob(getRandomElement(base64Fp))
    }
  ];
  let linkArray = [];
  for (let param of params) {
    let tls = param.tls;
    let plugin2 = param.plugin;
    let randomfp = param.randomfp;
    let serverAddr = `${addr}:${param.port}`;
    let remark = encodeURIComponent(`cfwks-${serverAddr}`);
    let linkArr = [
      `${atob("dmxlc3M6Ly8=")}${uuid}@${serverAddr}?${atob("ZW5jcnlwdGlvbj1ub25l")}&security=${tls}&fp=${randomfp}&${atob("YWxsb3dJbnNlY3VyZT0xJnR5cGU9d3M=")}&host=${hostName}&path=${encodeURIComponent(path)}#${remark}`,
      `${atob("dHJvamFuOi8v")}${password}@${serverAddr}?security=${tls}&fp=${randomfp}&${atob("YWxsb3dJbnNlY3VyZT0xJnR5cGU9d3M=")}&host=${hostName}&path=${encodeURIComponent(path)}#${remark}`,
      ...onSs ? [`${atob("c3M6Ly8=")}bm9uZTpub25l@${serverAddr}?plugin=${plugin2}#${remark}`] : []
    ];
    linkArray.push(linkArr);
  }
  let jsonArr = [
    "ICAgIHsgDQogICAgICAidHlwZSI6ICJ2bGVzcyIsDQogICAgICAidGFnIjogIiNyZW1hcmtzIyIsDQogICAgICAic2VydmVyIjogIiNzZXJ2ZXIjIiwNCiAgICAgICJzZXJ2ZXJfcG9ydCI6ICNwb3J0IywNCiAgICAgICJ1dWlkIjogIiN1dWlkNCMiLA0KICAgICAgIm5ldHdvcmsiOiAidGNwIiwNCiAgICAgICJ0bHMiOiB7DQogICAgICAgICJlbmFibGVkIjogI3RscyMsDQogICAgICAgICJpbnNlY3VyZSI6IHRydWUsDQogICAgICAgICJzZXJ2ZXJfbmFtZSI6ICIjaG9zdE5hbWUjIiwNCiAgICAgICAgInV0bHMiOiB7DQogICAgICAgICAgImVuYWJsZWQiOiB0cnVlLA0KICAgICAgICAgICJmaW5nZXJwcmludCI6ICIjZnAjIg0KICAgICAgICB9DQogICAgICB9LA0KICAgICAgInRyYW5zcG9ydCI6IHsNCiAgICAgICAgInR5cGUiOiAid3MiLA0KICAgICAgICAicGF0aCI6ICIjcGF0aCMiLA0KICAgICAgICAiaGVhZGVycyI6IHsNCiAgICAgICAgICAiSG9zdCI6ICIjaG9zdE5hbWUjIg0KICAgICAgICB9DQogICAgICB9DQogICAgfQ",
    "ICAgIHsNCiAgICAgICJ0eXBlIjogInRyb2phbiIsDQogICAgICAidGFnIjogIiNyZW1hcmtzIyIsDQogICAgICAic2VydmVyIjogIiNzZXJ2ZXIjIiwNCiAgICAgICJzZXJ2ZXJfcG9ydCI6ICNwb3J0IywNCiAgICAgICJwYXNzd29yZCI6ICIjcGFzc3dvcmQjIiwNCiAgICAgICJuZXR3b3JrIjogInRjcCIsDQogICAgICAidGxzIjogew0KICAgICAgICAiZW5hYmxlZCI6ICN0bHMjLA0KICAgICAgICAiaW5zZWN1cmUiOiB0cnVlLA0KICAgICAgICAic2VydmVyX25hbWUiOiAiI2hvc3ROYW1lIyIsDQogICAgICAgICJ1dGxzIjogew0KICAgICAgICAgICJlbmFibGVkIjogdHJ1ZSwNCiAgICAgICAgICAiZmluZ2VycHJpbnQiOiAiI2ZwIyINCiAgICAgICAgfQ0KICAgICAgfSwNCiAgICAgICJ0cmFuc3BvcnQiOiB7DQogICAgICAgICJ0eXBlIjogIndzIiwNCiAgICAgICAgInBhdGgiOiAiI3BhdGgjIiwNCiAgICAgICAgImhlYWRlcnMiOiB7DQogICAgICAgICAgIkhvc3QiOiAiI2hvc3ROYW1lIyINCiAgICAgICAgfQ0KICAgICAgfQ0KICAgIH0",
    ...onSs ? ["ICAgIHsNCiAgICAgICJ0eXBlIjogInNoYWRvd3NvY2tzIiwNCiAgICAgICJ0YWciOiAiI3JlbWFya3MjIiwNCiAgICAgICJzZXJ2ZXIiOiAiI3NlcnZlciMiLA0KICAgICAgInNlcnZlcl9wb3J0IjogI3BvcnQjLA0KICAgICAgIm1ldGhvZCI6ICJub25lIiwNCiAgICAgICJwYXNzd29yZCI6ICJub25lIiwNCiAgICAgICJwbHVnaW4iOiAidjJyYXktcGx1Z2luIiwNCiAgICAgICJwbHVnaW5fb3B0cyI6ICIjdGxzdHIjbXV4PTA7bW9kZT13ZWJzb2NrZXQ7cGF0aD0jcGF0aCM7aG9zdD0jaG9zdE5hbWUjIg0KICAgIH0"] : []
  ];
  let yamlArr = [
    "cHJveGllczoKICAtIHR5cGU6IHZsZXNzCiAgICBuYW1lOiAnI3JlbWFya3MjJwogICAgc2VydmVyOiAnI3NlcnZlciMnCiAgICBwb3J0OiAjcG9ydCMKICAgIHV1aWQ6ICcjdXVpZDQjJwogICAgbmV0d29yazogd3MKICAgIHRsczogI3RscyMKICAgIHVkcDogZmFsc2UKICAgIHNlcnZlcm5hbWU6ICcjaG9zdE5hbWUjJwogICAgY2xpZW50LWZpbmdlcnByaW50OiAnI2ZwIycKICAgIHNraXAtY2VydC12ZXJpZnk6IHRydWUKICAgIHdzLW9wdHM6CiAgICAgIHBhdGg6ICcjcGF0aCMnCiAgICAgIGhlYWRlcnM6CiAgICAgICAgSG9zdDogJyNob3N0TmFtZSMnCiAgLSB0eXBlOiB0cm9qYW4KICAgIG5hbWU6ICcjcmVtYXJrcyMnCiAgICBzZXJ2ZXI6ICcjc2VydmVyIycKICAgIHBvcnQ6ICNwb3J0IwogICAgcGFzc3dvcmQ6ICcjcGFzc3dvcmQjJwogICAgbmV0d29yazogd3MKICAgIHVkcDogZmFsc2UKICAgIHNuaTogJyNob3N0TmFtZSMnCiAgICBjbGllbnQtZmluZ2VycHJpbnQ6ICcjZnAjJwogICAgc2tpcC1jZXJ0LXZlcmlmeTogdHJ1ZQogICAgd3Mtb3B0czoKICAgICAgcGF0aDogJyNwYXRoIycKICAgICAgaGVhZGVyczoKICAgICAgICBIb3N0OiAnI2hvc3ROYW1lIyc",
    ...onSs ? ["ICAtIHR5cGU6IHNzCiAgICBuYW1lOiAnI3JlbWFya3MjJwogICAgc2VydmVyOiAnI3NlcnZlciMnCiAgICBwb3J0OiAjcG9ydCMKICAgIGNpcGhlcjogbm9uZQogICAgcGFzc3dvcmQ6IG5vbmUKICAgIHVkcDogZmFsc2UKICAgIHBsdWdpbjogdjJyYXktcGx1Z2luCiAgICBwbHVnaW4tb3B0czoKICAgICAgbW9kZTogd2Vic29ja2V0CiAgICAgIHRsczogI3RscyMKICAgICAgaG9zdDogJyNob3N0TmFtZSMnCiAgICAgIHBhdGg6ICcjcGF0aCMnCiAgICAgIG11eDogZmFsc2U"] : []
  ];
  let replacements = {
    "#remarks#": "cfwks-ws-tls",
    "#server#": addr,
    "#port#": getRandomElement(HTTPS_WITH_PORTS),
    "#uuid4#": uuid,
    "#password#": password,
    "#tls#": true,
    "#hostName#": hostName,
    "#path#": path,
    "#fp#": atob(getRandomElement(base64Fp)),
    "#tlstr#": "tls;"
  };
  let regex = new RegExp(Object.keys(replacements).join("|"), "g");
  let jsonArray = [];
  jsonArr.forEach((ele) => {
    let objStr = base64Decode(ele).replace(regex, (match) => replacements[match]);
    const obj = JSON.parse(objStr);
    jsonArray.push(obj);
  });
  let yamlArray = [];
  yamlArr.forEach((ele) => {
    let pValue = base64Decode(ele).replace(regex, (match) => replacements[match]);
    yamlArray.push(pValue);
  });
  let onS5ray = onSs ? `
### 3\u3001${base64Decode("c3PljY/orq7lnKh2MnJheU4vdjJyYXlOR+S4reS9v+eUqA==")}
\`\`\`${base64Decode("5Yir5ZCNKHJlbWFyayk6")}            cfwks-ss
${base64Decode("5Zyw5Z2AKGFkZHJlc3MpOg==")}           ${addr}
${base64Decode("56uv5Y+jKHBvcnQpOg==")}              ${params[1].port}
${base64Decode("5a+G56CBKHBhc3N3b3JkKTo=")}          0
${base64Decode("5Yqg5a+G5pa55byPKGVuY3J5cHRpb24pOg==")}    none

${base64Decode("5bqV5bGC5Lyg6L6T5pa55byPKHRyYW5zcG9ydCk=")}
${base64Decode("5Lyg6L6T5Y2P6K6uKG5ldHdvcmspOg==")}        ws
${base64Decode("5Lyq6KOF5Z+f5ZCNKGhvc3QpOg==")}           ${hostName}
${base64Decode("6Lev5b6EKHBhdGgpOg==")}               ${path}

${base64Decode("5Lyg6L6T5bGC5a6J5YWoKFRMUyk6")}          tls
\`\`\`` : "";
  let markdown = `## \u4E00\u3001${base64Decode("5YiG5Lqr6ZO+5o6l")}
### 1\u3001${base64Decode("V2Vic29ja2V0ICsgTlRMUw==")}
\`\`\`${linkArray[0].join("\n")}\`\`\`
### 2\u3001${base64Decode("V2Vic29ja2V0ICsgVExT")}
\`\`\`${linkArray[1].join("\n")}\`\`\`${onS5ray}
## \u4E8C\u3001${base64Decode("566A5piTIHNpbmctYm94IOmFjee9rg==")}
\`\`\`${JSON.stringify({ "outbounds": jsonArray }, null, 2)}\`\`\`
## \u4E09\u3001${base64Decode("566A5piTIGNsYXNoL21paG9tbyDphY3nva4=")}
\`\`\`${yamlArray.join("\n")}\`\`\``;
  let content = markdownToHtml(markdown);
  let htmlMainTemplate = "PCFET0NUWVBFIGh0bWw+DQo8aHRtbD4NCg0KPGhlYWQ+DQoJPG1ldGEgY2hhcnNldD0idXRmLTgiPg0KCTxzdHlsZT4NCgkJaHRtbCwNCgkJYm9keSB7DQoJCQltYXJnaW46IDA7DQoJCQlwYWRkaW5nOiAwOw0KCQkJZm9udC1mYW1pbHk6IHN5c3RlbS11aSwgc2Fucy1zZXJpZjsNCgkJCWJhY2tncm91bmQ6ICNmMGYyZjU7DQoJCQlkaXNwbGF5OiBmbGV4Ow0KCQkJanVzdGlmeS1jb250ZW50OiBjZW50ZXI7DQoJCQlhbGlnbi1pdGVtczogY2VudGVyOw0KCQl9DQoNCgkJLmJveCB7DQoJCQliYWNrZ3JvdW5kOiB3aGl0ZTsNCgkJCW1heC13aWR0aDogMTIwMHB4Ow0KCQkJd2lkdGg6IDkwJTsNCgkJCXBhZGRpbmc6IDJyZW07DQoJCQlib3JkZXItcmFkaXVzOiAxMnB4Ow0KCQkJYm94LXNoYWRvdzogMCA0cHggMjBweCByZ2JhKDAsIDAsIDAsIDAuMSk7DQoJCX0NCg0KCQloMSwNCgkJaDIsDQoJCWgzIHsNCgkJCW1hcmdpbi10b3A6IDA7DQoJCX0NCg0KCQlwcmUgew0KCQkJYmFja2dyb3VuZDogI2VlZTsNCgkJCXBhZGRpbmc6IDFlbTsNCgkJCW92ZXJmbG93LXg6IGF1dG87DQoJCQlib3JkZXItcmFkaXVzOiA2cHg7DQoJCX0NCg0KCQljb2RlIHsNCgkJCWZvbnQtZmFtaWx5OiB1aS1tb25vc3BhY2UsIG1vbm9zcGFjZTsNCgkJfQ0KCTwvc3R5bGU+DQo8L2hlYWQ+DQoNCjxib2R5Pg0KCTxkaXYgY2xhc3M9ImJveCI+DQoJCSR7aHRtbH0NCgk8L2Rpdj4NCjwvYm9keT4NCg0KPC9odG1sPg0K";
  return base64Decode(htmlMainTemplate).replace("${html}", content);
}
function buildLinks(ipsArray, subParameter, hostName, nodePath = "/", defaultPort = 0) {
  let path = nodePath;
  let isWorkersDevDomain = hostName.endsWith(atob("LndvcmtlcnMuZGV2"));
  let tls = isWorkersDevDomain ? "none" : "tls";
  let ports = isWorkersDevDomain ? HTTP_WITH_PORTS : HTTPS_WITH_PORTS;
  let plugin = encodeURIComponent([`${atob("djJyYXktcGx1Z2lu")}`, ...isWorkersDevDomain ? [] : ["tls"], "mux=0", "mode=websocket", `path=${path}`, `host=${hostName}`].join(";"));
  let { uuid, password, onSs } = subParameter;
  let linkArray = [];
  for (let addr of ipsArray) {
    if (!addr) continue;
    let port = defaultPort !== 0 ? defaultPort : getRandomElement(ports);
    let serverAddr = `${addr}:${port}`;
    let remark = encodeURIComponent(`cfwks-${serverAddr}`);
    let randomfp = atob(getRandomElement(base64Fp));
    let linkArr = [
      `${atob("dmxlc3M6Ly8=")}${uuid}@${serverAddr}?${atob("ZW5jcnlwdGlvbj1ub25l")}&security=${tls}&fp=${randomfp}&${atob("YWxsb3dJbnNlY3VyZT0xJnR5cGU9d3M=")}&host=${hostName}&path=${encodeURIComponent(path)}#${remark}`,
      `${atob("dHJvamFuOi8v")}${password}@${serverAddr}?security=${tls}&fp=${randomfp}&${atob("YWxsb3dJbnNlY3VyZT0xJnR5cGU9d3M=")}&host=${hostName}&path=${encodeURIComponent(path)}#${remark}`,
      ...onSs ? [`${atob("c3M6Ly8=")}bm9uZTpub25l@${serverAddr}?plugin=${plugin}#${remark}`] : []
    ];
    linkArray.push(getRandomElement(linkArr));
  }
  return base64Encode(linkArray.join("\n"));
}
function buildJsons(ipsArray, subParameter, hostName, nodePath = "/", defaultPort = 0) {
  let isWorkersDevDomain = hostName.endsWith(atob("LndvcmtlcnMuZGV2"));
  let ports = isWorkersDevDomain ? HTTP_WITH_PORTS : HTTPS_WITH_PORTS;
  let { uuid, password, onSs } = subParameter;
  let path = nodePath;
  let jsonArr = [
    "ICAgIHsgDQogICAgICAidHlwZSI6ICJ2bGVzcyIsDQogICAgICAidGFnIjogIiNyZW1hcmtzIyIsDQogICAgICAic2VydmVyIjogIiNzZXJ2ZXIjIiwNCiAgICAgICJzZXJ2ZXJfcG9ydCI6ICNwb3J0IywNCiAgICAgICJ1dWlkIjogIiN1dWlkNCMiLA0KICAgICAgIm5ldHdvcmsiOiAidGNwIiwNCiAgICAgICJ0bHMiOiB7DQogICAgICAgICJlbmFibGVkIjogI3RscyMsDQogICAgICAgICJpbnNlY3VyZSI6IHRydWUsDQogICAgICAgICJzZXJ2ZXJfbmFtZSI6ICIjaG9zdE5hbWUjIiwNCiAgICAgICAgInV0bHMiOiB7DQogICAgICAgICAgImVuYWJsZWQiOiB0cnVlLA0KICAgICAgICAgICJmaW5nZXJwcmludCI6ICIjZnAjIg0KICAgICAgICB9DQogICAgICB9LA0KICAgICAgInRyYW5zcG9ydCI6IHsNCiAgICAgICAgInR5cGUiOiAid3MiLA0KICAgICAgICAicGF0aCI6ICIjcGF0aCMiLA0KICAgICAgICAiaGVhZGVycyI6IHsNCiAgICAgICAgICAiSG9zdCI6ICIjaG9zdE5hbWUjIg0KICAgICAgICB9DQogICAgICB9DQogICAgfQ",
    "ICAgIHsNCiAgICAgICJ0eXBlIjogInRyb2phbiIsDQogICAgICAidGFnIjogIiNyZW1hcmtzIyIsDQogICAgICAic2VydmVyIjogIiNzZXJ2ZXIjIiwNCiAgICAgICJzZXJ2ZXJfcG9ydCI6ICNwb3J0IywNCiAgICAgICJwYXNzd29yZCI6ICIjcGFzc3dvcmQjIiwNCiAgICAgICJuZXR3b3JrIjogInRjcCIsDQogICAgICAidGxzIjogew0KICAgICAgICAiZW5hYmxlZCI6ICN0bHMjLA0KICAgICAgICAiaW5zZWN1cmUiOiB0cnVlLA0KICAgICAgICAic2VydmVyX25hbWUiOiAiI2hvc3ROYW1lIyIsDQogICAgICAgICJ1dGxzIjogew0KICAgICAgICAgICJlbmFibGVkIjogdHJ1ZSwNCiAgICAgICAgICAiZmluZ2VycHJpbnQiOiAiI2ZwIyINCiAgICAgICAgfQ0KICAgICAgfSwNCiAgICAgICJ0cmFuc3BvcnQiOiB7DQogICAgICAgICJ0eXBlIjogIndzIiwNCiAgICAgICAgInBhdGgiOiAiI3BhdGgjIiwNCiAgICAgICAgImhlYWRlcnMiOiB7DQogICAgICAgICAgIkhvc3QiOiAiI2hvc3ROYW1lIyINCiAgICAgICAgfQ0KICAgICAgfQ0KICAgIH0",
    ...onSs ? ["ICAgIHsNCiAgICAgICJ0eXBlIjogInNoYWRvd3NvY2tzIiwNCiAgICAgICJ0YWciOiAiI3JlbWFya3MjIiwNCiAgICAgICJzZXJ2ZXIiOiAiI3NlcnZlciMiLA0KICAgICAgInNlcnZlcl9wb3J0IjogI3BvcnQjLA0KICAgICAgIm1ldGhvZCI6ICJub25lIiwNCiAgICAgICJwYXNzd29yZCI6ICJub25lIiwNCiAgICAgICJwbHVnaW4iOiAidjJyYXktcGx1Z2luIiwNCiAgICAgICJwbHVnaW5fb3B0cyI6ICIjdGxzdHIjbXV4PTA7bW9kZT13ZWJzb2NrZXQ7cGF0aD0jcGF0aCM7aG9zdD0jaG9zdE5hbWUjIg0KICAgIH0"] : []
  ];
  let nStr = [];
  let outbds = [];
  for (let addr of ipsArray) {
    if (!addr) continue;
    let port = defaultPort !== 0 ? defaultPort : getRandomElement(ports);
    let remarks = `cfwks-${addr}:${port}`;
    let replacements = {
      "#remarks#": remarks,
      "#server#": addr,
      "#port#": port,
      "#uuid4#": uuid,
      "#password#": password,
      "#tls#": !isWorkersDevDomain,
      "#hostName#": hostName,
      "#path#": path,
      "#fp#": atob(getRandomElement(base64Fp)),
      "#tlstr#": isWorkersDevDomain ? "" : "tls;"
    };
    let regex = new RegExp(Object.keys(replacements).join("|"), "g");
    let oValue = base64Decode(getRandomElement(jsonArr)).replace(regex, (match) => replacements[match]);
    if (!nStr.includes(remarks)) {
      outbds.push(oValue);
      nStr.push(remarks);
    }
  }
  return [nStr, outbds];
}
function buildYamls(ipsArray, subParameter, hostName, nodePath = "/", defaultPort = 0) {
  let isWorkersDevDomain = hostName.endsWith(atob("LndvcmtlcnMuZGV2"));
  let ports = isWorkersDevDomain ? HTTP_WITH_PORTS : HTTPS_WITH_PORTS;
  let { uuid, password, onSs } = subParameter;
  let path = nodePath;
  let yamlArr = [
    "ICAtIHsidHlwZSI6InZsZXNzIiwibmFtZSI6IiNyZW1hcmtzIyIsInNlcnZlciI6IiNzZXJ2ZXIjIiwicG9ydCI6I3BvcnQjLCJ1dWlkIjoiI3V1aWQ0IyIsIm5ldHdvcmsiOiJ3cyIsInRscyI6I3RscyMsInVkcCI6ZmFsc2UsInNlcnZlcm5hbWUiOiIiLCJjbGllbnQtZmluZ2VycHJpbnQiOiIjZnAjIiwic2tpcC1jZXJ0LXZlcmlmeSI6dHJ1ZSwid3Mtb3B0cyI6eyJwYXRoIjoiI3BhdGgjIiwiaGVhZGVycyI6eyJIb3N0IjoiI2hvc3ROYW1lIyJ9fX0=",
    "ICAtIHsidHlwZSI6InRyb2phbiIsIm5hbWUiOiIjcmVtYXJrcyMiLCJzZXJ2ZXIiOiIjc2VydmVyIyIsInBvcnQiOiNwb3J0IywicGFzc3dvcmQiOiIjcGFzc3dvcmQjIiwibmV0d29yayI6IndzIiwidWRwIjpmYWxzZSwic25pIjoiIiwiY2xpZW50LWZpbmdlcnByaW50IjoiI2ZwIyIsInNraXAtY2VydC12ZXJpZnkiOnRydWUsIndzLW9wdHMiOnsicGF0aCI6IiNwYXRoIyIsImhlYWRlcnMiOnsiSG9zdCI6IiNob3N0TmFtZSMifX19",
    ...onSs ? ["ICAtIHsidHlwZSI6InNzIiwibmFtZSI6IiNyZW1hcmtzIyIsInNlcnZlciI6IiNzZXJ2ZXIjIiwicG9ydCI6I3BvcnQjLCJjaXBoZXIiOiJub25lIiwicGFzc3dvcmQiOiJub25lIiwicGx1Z2luIjoidjJyYXktcGx1Z2luIiwicGx1Z2luLW9wdHMiOnsibW9kZSI6IndlYnNvY2tldCIsInRscyI6I3RscyMsImhvc3QiOiIjaG9zdE5hbWUjIiwicGF0aCI6IiNwYXRoIyIsIm11eCI6ZmFsc2V9LCJ1ZHAiOmZhbHNlfQ"] : []
  ];
  let nStr = [];
  let poies = [];
  for (let addr of ipsArray) {
    if (!addr) continue;
    let port = defaultPort !== 0 ? defaultPort : getRandomElement(ports);
    let remarks = `cfwks-${addr}:${port}`;
    let replacements = {
      "#remarks#": remarks,
      "#server#": addr,
      "#port#": port,
      "#uuid4#": uuid,
      "#password#": password,
      "#tls#": !isWorkersDevDomain,
      "#hostName#": hostName,
      "#path#": path,
      "#fp#": atob(getRandomElement(base64Fp))
    };
    let regex = new RegExp(Object.keys(replacements).join("|"), "g");
    let pValue = base64Decode(getRandomElement(yamlArr)).replace(regex, (match) => replacements[match]);
    if (!nStr.includes(remarks)) {
      poies.push(pValue);
      nStr.push(remarks);
    }
  }
  return [nStr, poies];
}

// src/worker.js
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
    CONFIG_PASSWORD: "",
    // 查看节点配置的密码
    SUB_PASSWORD: ""
    // 查看节点订阅的密码
  },
  urls: {
    DATA_SOURCE_URL: "https://raw.githubusercontent.com/juerson/3h1_tunnel/refs/heads/master/domain.txt",
    // 数据源URL
    CLASH_TEMPLATE_URL: "https://raw.githubusercontent.com/juerson/3h1_tunnel/refs/heads/master/clashTemplate.yaml"
    // clash模板
  }
};
var defaultMaxNodeMap = {
  "djJyYXk=": {
    upperLimit: 2e3,
    // 最大上限
    default: 300
    // 默认值，传入的数据不合法使用它
  },
  "c2luZ2JveA==": {
    upperLimit: 100,
    default: 30
  },
  "Y2xhc2g=": {
    upperLimit: 100,
    default: 30
  },
  "": {
    // 这个用于当target输入错误兜底的
    upperLimit: 500,
    default: 300
  }
};
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
      let password = env.USERPWD || userID;
      sha224Password = sha224Encrypt(password);
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
        const config = {
          env: extractGroupedEnv(env, DEFAULTS),
          query: extractUrlParams(url, defaultMaxNodeMap),
          subParameter: {
            // vless节点的userID => uuid
            uuid: userID,
            // trojan节点的密码
            password,
            // 是否支持ss协议，不支持就不要生成订阅
            onSs: s5Lock
          }
        };
        return await handleRequest(path, config, defaultMaxNodeMap);
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
async function handleRequest(path, config, defaultMaxNodeMap2) {
  const { target, hostName, pwdPassword, defaultPort, maxNode, page, nodePath, cidr } = config.query;
  const { CONFIG_PASSWORD, SUB_PASSWORD } = config.env.password;
  const { DATA_SOURCE_URL, CLASH_TEMPLATE_URL } = config.env.urls;
  const github = config.env.github;
  function isGitHubConfigComplete(githubConfig) {
    return Object.values(githubConfig).every((val) => val !== "");
  }
  function replaceTemplate(template, data) {
    return template.replace(/(\s*[-*]\s*)\$\{(\w+)\}/g, (_, prefix, key) => {
      return "\n" + data[key];
    });
  }
  switch (path) {
    case "/":
      const randomDomain = domainList[Math.floor(Math.random() * domainList.length)];
      return Response.redirect(randomDomain, 301);
    case `/config`:
      let html_doc = "404 Not Found!", status = 404;
      if (pwdPassword == CONFIG_PASSWORD) {
        html_doc = getBaseConfig(config?.subParameter, hostName, nodePath);
        status = 200;
      }
      return new Response(html_doc, { status, headers: { "Content-Type": "text/html; charset=UTF-8" } });
    case "/sub":
      if (pwdPassword == SUB_PASSWORD) {
        let ipsArray = generateIPsFromCIDR(cidr, maxNode);
        if (ipsArray.length === 0) {
          let ipContents = "";
          if (isGitHubConfigComplete(github)) {
            try {
              const file = await fetchGitHubFile(
                github?.GITHUB_TOKEN,
                github?.GITHUB_OWNER,
                github?.GITHUB_REPO,
                github?.GITHUB_FILE_PATH,
                github?.GITHUB_BRANCH
              );
              ipContents = new TextDecoder().decode(file.body);
            } catch (e) {
              console.log(`\u83B7\u53D6GitHub\u7684\u6570\u636E\u5931\u8D25\uFF1A${e.message}`);
            }
          }
          if (!ipContents.trim()) ipContents = await fetchWebPageContent(DATA_SOURCE_URL);
          if (!ipContents.trim()) {
            return new Response("Null Data", { status: 200, headers: { "Content-Type": "text/plain;charset=utf-8" } });
          }
          ipsArray = ipContents.trim().split(/\r\n|\n|\r/).map((line) => line.trim()).filter((line) => line.length > 0);
        }
        let upperLimit = defaultMaxNodeMap2[target]?.upperLimit ?? defaultMaxNodeMap2[""]?.upperLimit;
        let defaultCount = defaultMaxNodeMap2[target]?.default ?? defaultMaxNodeMap2[""]?.default;
        let ipsResult = ipsPaging(ipsArray, maxNode, page, upperLimit, defaultCount);
        if (ipsResult?.hasError) {
          return new Response(ipsResult.message, { status: 200, headers: { "Content-Type": "text/plain; charset=utf-8" } });
        }
        let htmlDoc = "Not Found!";
        if (target === "djJyYXk=") {
          htmlDoc = buildLinks(ipsResult?.chunkedIPs, config?.subParameter, hostName, nodePath, defaultPort);
        } else if (target === "c2luZ2JveA==") {
          let [_, outbds] = buildJsons(ipsResult?.chunkedIPs, config?.subParameter, hostName, nodePath, defaultPort);
          if (outbds.length > 0) htmlDoc = base64Decode("ew0KICAib3V0Ym91bmRzIjogWw0KI291dGJkcyMNCiAgXQ0KfQ").replace("#outbds#", outbds.join(",\n"));
        } else if (target === "Y2xhc2g=") {
          const isCFworkersDomain = hostName.endsWith(base64Decode("d29ya2Vycy5kZXY"));
          if (isCFworkersDomain) {
            htmlDoc = base64Decode(
              "6K2m5ZGK77ya5L2/55So5Z+f5ZCNI2hvc3ROYW1lI+eUn+aIkOeahGNsYXNo6K6i6ZiF5peg5rOV5L2/55So77yB57uI5q2i5pON5L2c44CC"
            ).replace("#hostName#", hostName);
            return new Response(htmlDoc, { status: 200, headers: { "Content-Type": "text/plain; charset=utf-8" } });
          }
          let [nStr, poies] = buildYamls(ipsResult?.chunkedIPs, config?.subParameter, hostName, nodePath, defaultPort);
          let confTemplate = await fetchWebPageContent(CLASH_TEMPLATE_URL);
          if (poies.length > 0 && poies.length > 0) {
            htmlDoc = replaceTemplate(confTemplate, {
              proxies: poies.join("\n"),
              proxy_name: nStr.map((ipWithPort) => `      - ${ipWithPort}`).join("\n")
            });
          }
        }
        return new Response(htmlDoc, { status: 200, headers: { "Content-Type": "text/plain; charset=utf-8" } });
      }
    default:
      return new Response("Not Found!", { status: 404, headers: { "Content-Type": "text/plain; charset=utf-8" } });
  }
}
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
function extractGroupedEnv(env, groupedDefaults, encodeFields = ["CONFIG_PASSWORD", "SUB_PASSWORD"]) {
  const result = {};
  for (const [groupName, vars] of Object.entries(groupedDefaults)) {
    result[groupName] = {};
    for (const [key, defaultVal] of Object.entries(vars)) {
      let value = env[key] ?? defaultVal;
      if (encodeFields.includes(key)) {
        value = encodeURIComponent(String(value));
      }
      result[groupName][key] = value;
    }
  }
  return result;
}
function extractUrlParams(url, defaultMaxNodeMap2, encodeFields = ["pwdPassword"]) {
  const search = url.searchParams;
  const target = base64Encode(search.get("target")) || "";
  const defaultMax = defaultMaxNodeMap2[target]?.default ?? defaultMaxNodeMap2[""]?.default;
  const rawParams = {
    target,
    hostName: search.get("host") || url.hostname,
    pwdPassword: search.get("pwd") || "",
    defaultPort: parseInt(search.get("port") || "0", 10),
    maxNode: parseInt(search.get("max") || defaultMax.toString(), 10),
    page: parseInt(search.get("page") || "1", 10),
    nodePath: search.get("path") || "/",
    // 节点中的path值，可以改为/?ed=2048、/?ed=2560、/pyip=x.x.x.x、/socks=xx:xx@x.x.x.x:port
    cidr: search.get("cidr") || ""
  };
  for (const key of encodeFields) {
    if (key in rawParams) {
      rawParams[key] = encodeURIComponent(rawParams[key]);
    }
  }
  return rawParams;
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
