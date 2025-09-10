import { connect } from 'cloudflare:sockets';
import { sha224Encrypt } from './encrypt.js';
import { hostPortParser, socks5AddressParser } from './address.js';

let userID = '61098bdc-b734-4874-9e87-d18b1ef1cfaf';
let sha224Password = 'b379f280b9a4ce21e465cb31eea09a8fe3f4f8dd1850d9f630737538'; // sha224Encrypt('61098bdc-b734-4874-9e87-d18b1ef1cfaf')
let codeDefaultSOCKS = ''; // 格式: user:pass@host:port、host:port
let codeDefaultHTTP = ''; // 格式: user:pass@host:port、host:port
let codeDefaultPYIP = ''; // [Host][:port]，多值用逗号隔开
let codeDefaultNAT64 = `${["2602", "fc59", "b0", "64"].join(":")}::`; // NAT64 IPv6 前缀，可以去掉或保留"/96"
// 控制 Skc0swodahs 协议的两个关键参数
let s5Lock = false; // true=启用，false=禁用
let allowedRules = ["0.0.0.0/0", "::/0"]; // 你连接节点时，所用的公网IP，是否在这个范围内？不在就不允许连接，支持CIDR和具体的IP地址

const domainList = [
	'https://www.bilibili.com',
	'https://www.nicovideo.jp',
	'https://tv.naver.com',
	'https://www.hotstar.com',
	'https://www.netflix.com',
	'https://www.dailymotion.com',
	'https://www.youtube.com',
	'https://www.hulu.com',
	'https://fmovies.llc',
	'https://hdtodayz.to',
	'https://radar.cloudflare.com',
];

let parsedSocks5Address = {};
let parsedLandingAddress = { hostname: null, port: 443 };
let nat64IPv6Prefix = "";
let enableSocks = false;
let enableHttp = false;
let enableNat = false;

export default {
	async fetch(request, env, ctx) {
		try {
			userID = env.UUID4 || userID;
			sha224Password = sha224Encrypt(env.USERPWD || userID);

			// 下面s5Lock和allowedRules控制ss协议
			s5Lock = (() => {
				const v = env.ENABLED_S5;
				if (typeof v === 'boolean') return v;
				if (typeof v === 'string') return ['1', 'true', 'yes', 'on'].includes(v.trim().toLowerCase());
				return s5Lock;
			})();
			const raw = (env.ALLOWED_RULES ?? "").trim().split(/[, \n\r\t]+/).map(x => x.trim()).filter(Boolean);
			allowedRules = raw.length > 0 ? raw : ["0.0.0.0/0", "::/0"];

			const url = new URL(request.url);
			const path = url.pathname;
			const upgradeHeader = request.headers.get("Upgrade");
			if (!upgradeHeader || upgradeHeader !== 'websocket') {
				if (path === '/') {
					const randomDomain = domainList[Math.floor(Math.random() * domainList.length)];
					return Response.redirect(randomDomain, 301);
				}
				return new Response('404 Not Found!', { status: 404 });
			} else {
				// 复位，防止上次请求的状态影响本次请求（特指，客户端上修改的path值）
				parsedSocks5Address = {};
				enableSocks = false;
				enableHttp = false;
				enableNat = false;
				// 重新获取数据并更新它们
				let connectData = parseConnetMode(path, env, codeDefaultSOCKS, codeDefaultHTTP, codeDefaultPYIP, codeDefaultNAT64);
				({ parsedSocks5Address, parsedLandingAddress, nat64IPv6Prefix, enableSocks, enableHttp, enableNat } = connectData);
				return await handleWebSocket(request);
			}
		} catch (err) {
			return new Response(err.toString());
		}
	},
};

async function handleWebSocket(request) {
	const [client, webSocket] = Object.values(new WebSocketPair());
	webSocket.accept();

	let address = '';
	let portWithRandomLog = '';

	const log = (info, event) => {
		console.log(`[${address}:${portWithRandomLog}] ${info}`, event || '');
	};

	// 外部中断信号
	const outerController = new AbortController();

	// 启用超时管理
	const { resetIdleTimer, controller } = setupTimeoutControl({
		webSocket,
		signal: outerController.signal, // 支持外部终止
		idleTimeoutMs: 20_000, // 20s
		maxLifetimeMs: 180_000, // 180s
		onAbort: (reason) => {
			log?.('🐳 disconnecting reason:', reason);
			safeCloseWebSocket(webSocket);
		},
	});

	const earlyDataHeader = request.headers.get('sec-websocket-protocol') || '';
	const webSocketReadableStream = makeWebSocketReadableStream(webSocket, earlyDataHeader, log);

	let isDns = false;
	let udpStreamWrite = null;
	let remoteSocketWrapper = { value: null };

	// 启动握手超时
	const clearHandshakeTimer = startHandshakeTimeout({
		webSocket,
		remoteSocketWrapper,
		timeoutMs: 5_000, // 5秒超时握手时间
		log,
	});

	try {
		webSocketReadableStream
			.pipeTo(
				new WritableStream({
					async write(chunk, controller) {
						// 每次收到数据都重置空闲计时器
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
							...(s5Lock ? { 0: [parseSkc0swodahsHeader, [chunk]] } : {}),
							1: [parseS5elvHeader, [chunk, userID]],
							2: [parseNaj0rtHeader, [chunk, sha224Password]],
						};
						const entry = parseHandlers[mapCode];
						if (!entry) return log(`Unsupported protocol mapCode: ${mapCode}`);

						const [handlerFn, args] = entry;
						let headerInfo = handlerFn(...args);
						if (!headerInfo || headerInfo?.hasError) return controller.error(`Header parse error: ${headerInfo?.message}`);

						// 握手成功且协议头收到，清除握手超时限制
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
						portWithRandomLog = `${headerInfo?.portRemote}--${Math.random()} ${headerInfo?.isUDP ? 'udp ' : 'tcp '}`;

						handleTCPOutbds(remoteSocketWrapper, headerInfo, webSocket, log);
					},
					close() {
						log(`webSocketReadableStream is close`);
					},
					abort(reason) {
						log(`webSocketReadableStream is abort`, JSON.stringify(reason));
					},
				}),
				{ signal: controller.signal } // 用超时控制的AbortSignal(兼容外部signal)
			)
			.catch((err) => {
				log('webSocketReadableStream pipeTo error', err);
			});
	} catch (e) {
		if (e.name === 'AbortError') {
			log('Stream aborted by AbortController, usually due to a timeout or explicit cancellation:', e);
		} else {
			log('Unexpected pipeTo error:', e);
		}
	}

	return new Response(null, { status: 101, webSocket: client });
}

// 握手超时
function startHandshakeTimeout({ webSocket, remoteSocketWrapper, timeoutMs = 5_000, log }) {
	let handshakeTimeout = setTimeout(() => {
		if (!remoteSocketWrapper.value) {
			log('🤝 Handshake timeout: no protocol header received, closing WebSocket');
			try {
				if (webSocket.readyState === WebSocket.OPEN) {
					webSocket.close(1008, 'Handshake timeout');
				}
			} catch (e) {
				log('Failed to close WebSocket after timeout', e);
			}
		}
	}, timeoutMs);

	// 提供清理函数
	return () => clearTimeout(handshakeTimeout);
}

// 空闲超时和最大生命周期控制
function setupTimeoutControl({ webSocket, signal, onAbort, idleTimeoutMs = 30_000, maxLifetimeMs = 180_000 }) {
	let idleTimer = null;
	let lifetimeTimer = null;
	const controller = new AbortController();
	let aborted = false; // 防止多次 abort

	const cleanup = () => {
		clearTimeout(idleTimer);
		clearTimeout(lifetimeTimer);
		if (signal && onExternalAbort) {
			signal.removeEventListener('abort', onExternalAbort);
		}
	};

	const doAbort = (reason) => {
		if (aborted) return;
		aborted = true;
		console.warn(
			reason === 'idle' ? `⏳ Idle for over ${idleTimeoutMs / 1000}s, disconnecting.` : `🛑 Max lifetime of ${maxLifetimeMs / 1000}s reached, disconnecting.`
		);
		safeCloseWebSocket(webSocket);
		controller.abort();
		onAbort?.(reason);
		cleanup();
	};

	const resetIdleTimer = () => {
		clearTimeout(idleTimer);
		if (aborted) return;
		idleTimer = setTimeout(() => doAbort('idle'), idleTimeoutMs);
	};

	const onExternalAbort = () => {
		doAbort('external');
	};

	// 启动 idle 定时器与最大生命周期定时器
	resetIdleTimer();
	lifetimeTimer = setTimeout(() => doAbort('lifetime'), maxLifetimeMs);

	// 监听外部信号量 abort
	signal?.addEventListener('abort', onExternalAbort);

	return {
		controller, // AbortController 实例
		resetIdleTimer, // 每次收到数据时要调用
		cleanup, // 可手动提前释放资源
	};
}

function makeWebSocketReadableStream(webSocket, earlyDataHeader, log) {
	let canceled = false;

	const stream = new ReadableStream({
		start(controller) {
			webSocket.addEventListener('message', (e) => {
				if (!canceled) controller.enqueue(e.data);
			});
			webSocket.addEventListener('close', () => {
				if (!canceled) controller.close();
				safeCloseWebSocket(webSocket);
			});
			webSocket.addEventListener('error', (err) => {
				log('WebSocket error');
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
		},
	});

	return stream;
}

function parseS5elvHeader(buffer, userID) {
	const view = new Uint8Array(buffer);
	if (view.length < 24) return { hasError: true, message: 'Too short' };

	const bytes2UUID = (bytes) =>
		[...bytes].map((b, i) => `${[4, 6, 8, 10].includes(i) ? '-' : ''}${b.toString(16).padStart(2, '0')}`).join('');
	const uuid = bytes2UUID(view.slice(1, 17));
	if (uuid !== userID) return { hasError: true, message: 'Unauthorized UUID' };

	const optLen = view[17];
	const base = 18 + optLen;

	let isUDP = false;
	const command = view[base];
	if (command === 2) isUDP = true;
	else if (command !== 1) return { hasError: true, message: `command ${command} is not support` };

	const port = (view[base + 1] << 8) | view[base + 2];

	let p = base + 3;
	const addrType = view[p++];

	let address = '';
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
			const h = view[p++],
				l = view[p++];
			parts.push(((h << 8) | l).toString(16));
		}
		address = parts.join(':');
	} else {
		return { hasError: true, message: `Invalid address type ${addrType}` };
	}
	const mapAddressType = (atype) => ({ 1: 1, 2: 3, 3: 4 }[atype] ?? null);

	return {
		hasError: false,
		addressRemote: address,
		portRemote: port,
		rawClientData: new Uint8Array(buffer, p),
		addressType: mapAddressType(addrType),
		responseHeader: new Uint8Array([view[0], 0]),
		isUDP,
	};
}

function parseNaj0rtHeader(buffer, sha224Password) {
	const view = new Uint8Array(buffer);
	if (view.length < 56 + 2 + 1 + 1 + 2 + 2) return { hasError: true, message: 'Header too short' };

	// 校验明文密码
	const passStr = String.fromCharCode(...view.slice(0, 56));
	if (passStr !== sha224Password) return { hasError: true, message: 'Unauthorized password' };

	// 检查CRLF
	if (view[56] !== 0x0d || view[57] !== 0x0a) return { hasError: true, message: 'Missing CRLF after password hash' };

	let isUDP = false;
	let p = 58;

	const cmd = view[p++];
	if (cmd == 0x03) isUDP = true;
	else if (cmd !== 0x01 && cmd !== 0x03) return { hasError: true, message: `Unknown CMD: ${cmd}` };

	const addrType = view[p++];
	let address = '';
	if (addrType === 1) {
		// IPv4
		if (view.length < p + 4 + 2) return { hasError: true, message: 'Header too short for IPv4' };
		address = `${view[p++]}.${view[p++]}.${view[p++]}.${view[p++]}`;
	} else if (addrType === 3) {
		// 域名
		const len = view[p++];
		if (view.length < p + len + 2) return { hasError: true, message: 'Header too short for domain' };
		address = String.fromCharCode(...view.slice(p, p + len));
		p += len;
	} else if (addrType === 4) {
		// IPv6
		if (view.length < p + 16 + 2) return { hasError: true, message: 'Header too short for IPv6' };
		let parts = [];
		for (let i = 0; i < 8; ++i) {
			const part = (view[p++] << 8) | view[p++];
			parts.push(part.toString(16));
		}
		address = parts.join(':');
	} else {
		return { hasError: true, message: `Unknown addrType: ${addrType}` };
	}
	const port = (view[p++] << 8) | view[p++];

	return {
		hasError: false,
		addressRemote: address,
		portRemote: port,
		rawClientData: new Uint8Array(buffer, p + 2),
		addressType: addrType,
		responseHeader: null,
		isUDP,
	};
}

function parseSkc0swodahsHeader(buffer) {
	const view = new DataView(buffer);
	const addrType = view.getUint8(0);
	let address = '',
		offset = 1;
	const textDecoder = new TextDecoder();
	if (addrType === 1) {
		address = Array.from(new Uint8Array(buffer.slice(1, 5))).join('.');
		offset = 5;
	} else if (addrType === 3) {
		const len = view.getUint8(1);
		address = textDecoder.decode(buffer.slice(2, 2 + len));
		offset = 2 + len;
	} else if (addrType === 4) {
		const parts = [];
		for (let i = 0; i < 8; i++) parts.push(view.getUint16(1 + i * 2).toString(16));
		address = parts.join(':');
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
		isUDP: false,
	};
}

async function handleTCPOutbds(remoteSocket, headerInfo, webSocket, log) {
	const { addressType, addressRemote, portRemote, rawClientData, responseHeader: vResponseHeader } = headerInfo;
	async function connectAndWrite(address, port, { socks = false, http = false } = {}) {
		const tcpSocket = socks ? await socks5Connect(addressType, address, port, log) : (http ? await httpConnect(address, port, log) : connect({ hostname: address, port }));
		log(`connected to ${address}:${port}`);
		remoteSocket.value = tcpSocket;
		const writer = tcpSocket.writable.getWriter();
		await writer.write(rawClientData);
		writer.releaseLock();
		return tcpSocket;
	}
	async function retry() {
		let opt = enableSocks ? { socks: true } : (enableHttp ? { http: true } : {})
		if (enableSocks || enableHttp) {
			tcpSocket = await connectAndWrite(addressRemote, portRemote, opt);
		} else {
			const { address, port } = await resolveTargetAddress(addressRemote, portRemote);
			tcpSocket = await connectAndWrite(address, port);
		}
		tcpSocket.closed.catch((error) => log('retry tcpSocket closed error', error)).finally(() => safeCloseWebSocket(webSocket));
		remoteSocketToWS(tcpSocket, webSocket, vResponseHeader, null, log);
	}

	let tcpSocket = await connectAndWrite(addressRemote, portRemote);
	remoteSocketToWS(tcpSocket, webSocket, vResponseHeader, retry, log);
}

// ———————————————————————— pyip/nat64 代理 ————————————————————————
async function resolveTargetAddress(addressRemote, portRemote, serverAddr = parsedLandingAddress) {
	// 是否强制nat64
	if (!enableNat && serverAddr?.hostname) {
		return {
			address: serverAddr.hostname,
			port: serverAddr.port || portRemote,
		};
	} else {
		const nat64Address = await getNAT64IPv6Addr(addressRemote);
		return {
			address: nat64Address || addressRemote,
			port: portRemote,
		};
	}
}
async function getNAT64IPv6Addr(addressRemote, prefix = nat64IPv6Prefix) {
	if (typeof addressRemote !== 'string' || !addressRemote.trim()) return '';

	try {
		const response = await fetch(`https://dns.google.com/resolve?name=${addressRemote}&type=A`, {
			headers: { Accept: 'application/dns-json' },
		});

		if (!response.ok) return '';
		const data = await response.json();
		const ipv4 = data.Answer?.find((r) => r.type === 1)?.data;
		if (!ipv4) return '';

		const parts = ipv4.split('.');
		if (parts.length !== 4) return '';

		const hexParts = parts.map((p) => {
			const num = Number(p);
			if (!Number.isInteger(num) || num < 0 || num > 255) return null;
			return num.toString(16).padStart(2, '0');
		});

		if (hexParts.includes(null)) return '';

		const ipv6 = `${prefix}${hexParts[0]}${hexParts[1]}:${hexParts[2]}${hexParts[3]}`;
		return `[${ipv6}]`;
	} catch {
		return '';
	}
}

// ———————————————————————— socks5 代理 ————————————————————————
async function socks5Connect(addressType, addressRemote, portRemote, log) {
	const { username, password, hostname, port } = parsedSocks5Address;
	const socket = connect({ hostname, port });
	const socksGreeting = new Uint8Array([5, 2, 0, 2]);
	const writer = socket.writable.getWriter();
	await writer.write(socksGreeting);

	log('sent socks greeting');

	const reader = socket.readable.getReader();
	const encoder = new TextEncoder();
	let res = (await reader.read()).value;
	if (res[0] !== 0x05) {
		log(`socks server version error: ${res[0]} expected: 5`);
		return;
	}
	if (res[1] === 0xff) {
		log('no acceptable methods');
		return;
	}
	if (res[1] === 0x02) {
		log('socks server needs auth');
		if (!username || !password) {
			log('please provide username/password');
			return;
		}
		const authRequest = new Uint8Array([1, username.length, ...encoder.encode(username), password.length, ...encoder.encode(password)]);
		await writer.write(authRequest);
		res = (await reader.read()).value;
		if (res[0] !== 0x01 || res[1] !== 0x00) {
			log('fail to auth socks server');
			return;
		}
	}
	let DSTADDR;
	switch (addressType) {
		case 1:
			DSTADDR = new Uint8Array([1, ...addressRemote.split('.').map(Number)]);
			break;
		case 3:
			DSTADDR = new Uint8Array([3, addressRemote.length, ...encoder.encode(addressRemote)]);
			break;
		case 4:
			DSTADDR = new Uint8Array([4, ...addressRemote.split(':').flatMap((x) => [parseInt(x.slice(0, 2), 16), parseInt(x.slice(2), 16)])]);
			break;
		default:
			log(`invild  addressType is ${addressType}`);
			return;
	}
	const socksRequest = new Uint8Array([5, 1, 0, ...DSTADDR, portRemote >> 8, portRemote & 0xff]);
	await writer.write(socksRequest);
	log('sent socks request');
	res = (await reader.read()).value;
	if (res[1] === 0x00) log('socks connection opened');
	else {
		log('fail to open socks connection');
		return;
	}
	writer.releaseLock();
	reader.releaseLock();
	return socket;
}

// ———————————————————————— http 代理 ————————————————————————
const textEncoder = new TextEncoder();
const textDecoder = new TextDecoder();
function buildConnectRequest(host, port, username, password) {
	const headers = [
		`CONNECT ${host}:${port} HTTP/1.1`,
		`Host: ${host}:${port}`,
		`User-Agent: Mozilla/5.0 (Windows NT10.0; Win64; x64) AppleWebKit/537.36`,
		`Proxy-Connection: keep-alive`,
		`Connection: keep-alive`,
	];
	if (username && password) {
		const auth = btoa(`${username}:${password}`);
		headers.push(`Proxy-Authorization: Basic ${auth}`);
	}
	return headers.join('\r\n') + '\r\n\r\n';
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
			if (done) throw new Error('HTTP连接被中断');
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
					throw new Error(`HTTP代理响应异常: ${responseText.split('\r\n')[0]}`);
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
	const { hostname, port, username, password } = parsedSocks5Address; // 共用socks5解析函数
	log(`准备使用HTTP代理 ${hostname}:${port} 连接 ${remoteHost}:${remotePort}`);
	const sock = await connect({ hostname, port });
	const request = buildConnectRequest(remoteHost, remotePort, username, password);
	await sendRequest(sock, request);
	const success = await readResponse(sock);
	if (!success) throw new Error('HTTP代理连接失败');
	log(`HTTP连接 ${remoteHost}:${remotePort} 成功！`);
	return sock;
}

async function remoteSocketToWS(remoteSocket, webSocket, vRspnHeader = null, retry, log) {
	let hasData = false,
		firstChunk = true,
		headerBuffer = vRspnHeader instanceof Uint8Array ? vRspnHeader : null;
	const writer = new WritableStream({
		write(chunk, controller) {
			if (webSocket.readyState !== WebSocket.OPEN) return controller.error('WebSocket not open');
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
				controller.error('WritableStream error', e);
			}
		},
		abort(reason) {
			console.error('WritableStream aborted:', reason);
		},
	});
	try {
		await remoteSocket.readable.pipeTo(writer);
	} catch (e) {
		console.error('pipeTo error in remoteSocketToWS:', e);
		safeCloseWebSocket(webSocket);
	}
	if (!hasData && typeof retry === 'function') retry();
}

// ————————————————————————————————— 工具函数 —————————————————————————————————

function base64ToArrayBuffer(base64Str) {
	if (!base64Str) return { earlyData: null, error: null };
	try {
		const normalized = base64Str.replace(/-/g, '+').replace(/_/g, '/');
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

function safeCloseWebSocket(ws, code = 1000, reason = 'Normal Closure') {
	try {
		if (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING) {
			ws.close(code, reason);
		}
	} catch (e) {
		console.error('Failed close WebSocket', e);
	}
}

// UDP，疑是永不执行，worker/pages不支持udp
async function handleUDPOutbds(webSocket, vResponseHeader, log) {
	let isS5elvHeaderSent = false;
	const transformStream = new TransformStream({
		start(controller) { },
		transform(chunk, controller) {
			for (let index = 0; index < chunk.byteLength;) {
				const lengthBuffer = chunk.slice(index, index + 2);
				const udpPakcetLength = new DataView(lengthBuffer).getUint16(0);
				const udpData = new Uint8Array(chunk.slice(index + 2, index + 2 + udpPakcetLength));
				index = index + 2 + udpPakcetLength;
				controller.enqueue(udpData);
			}
		},
		flush(controller) { },
	});

	transformStream.readable
		.pipeTo(
			new WritableStream({
				async write(chunk) {
					const resp = await fetch("https://1.1.1.1/dns-query", { method: 'POST', headers: { 'content-type': 'application/dns-message' }, body: chunk });
					const dnsQueryResult = await resp.arrayBuffer();
					const udpSize = dnsQueryResult.byteLength;
					const udpSizeBuffer = new Uint8Array([(udpSize >> 8) & 0xff, udpSize & 0xff]);
					if (webSocket.readyState === WebSocket.OPEN) {
						log(`doh success and dns message length is ${udpSize}`);
						if (isS5elvHeaderSent) {
							webSocket.send(await new Blob([udpSizeBuffer, dnsQueryResult]).arrayBuffer());
						} else {
							webSocket.send(await new Blob([vResponseHeader, udpSizeBuffer, dnsQueryResult]).arrayBuffer());
							isS5elvHeaderSent = true;
						}
					}
				},
			})
		)
		.catch((error) => log('dns udp has error' + error));
	const writer = transformStream.writable.getWriter();

	return {
		write(chunk) {
			writer.write(chunk);
		},
	};
}

function parsedProtocolMapCode(buffer, request = null, allowedRules = ["0.0.0.0/0", "::/0"]) {
	const view = new Uint8Array(buffer);

	// 检查 UUID（v4 或 v7） -> vless 协议
	if (view.byteLength >= 17) {
		const version = (view[7] & 0xf0) >> 4;
		const isRFC4122Variant = (view[9] & 0xc0) === 0x80;

		if (isRFC4122Variant && (version === 4 || version === 7)) {
			return 1;
		}
	}
	// 检查 trojan 定界符 -> trojan 协议
	if (view.byteLength >= 62) {
		const [b0, b1, b2, b3] = [view[56], view[57], view[58], view[59]];
		const validB2 = [0x01, 0x03, 0x7f];
		const validB3 = [0x01, 0x03, 0x04];

		if (b0 === 0x0d && b1 === 0x0a && validB2.includes(b2) && validB3.includes(b3)) {
			return 2;
		}
	}
	// 未加密的 ss 协议
	if (view.byteLength > 10) {
		const validB1 = [0x01, 0x03, 0x04];
		// 由 IP 是否在白名单 allowedRules 中决定是否放行
		if (validB1.includes(view[0]) && Array.isArray(allowedRules)) {
			if (allowedRules.some(r => r === "0.0.0.0/0" || r === "::/0")) return 0;
			if (request) {
				const ip = request.headers.get("CF-Connecting-IP");
				if (ip && allowedRules.some(rule => isIpMatch(ip, rule))) {
					return 0;
				}
			}
		}
	}

	return 3;
}
function isIpMatch(ip, rule) {
	// 允许所有 IPv4 / IPv6 流量
	if (["0.0.0.0/0", "::/0"].includes(rule)) return true;
	// 判断 rule 是 CIDR 还是单个 IP
	if (rule.includes("/")) {
		return inCIDR(ip, rule);
	} else {
		return ip === rule; // 精确匹配
	}
}
function inCIDR(ip, cidr) {
	const [range, bits = "32"] = cidr.split('/');
	const ipBig = ipToBigInt(ip);
	const rangeBig = ipToBigInt(range);
	const prefix = parseInt(bits, 10);

	if (ip.includes(".") && range.includes(".")) {
		// IPv4
		const mask = ~((1 << (32 - prefix)) - 1) >>> 0;
		return Number(ipBig & BigInt(mask)) === Number(rangeBig & BigInt(mask));
	} else if (!ip.includes(".") && !range.includes(".")) {
		// IPv6
		const mask = (1n << 128n) - (1n << (128n - BigInt(prefix)));
		return (ipBig & mask) === (rangeBig & mask);
	} else {
		return false; // IPv4 vs IPv6 不匹配
	}
}
function ipToBigInt(ip) {
	if (ip.includes(".")) { // IPv4
		const [a, b, c, d] = parseIPv4(ip);
		return BigInt((a << 24) | (b << 16) | (c << 8) | d);
	} else { // IPv6
		const parts = parseIPv6(ip);
		return parts.reduce((acc, part) => (acc << 16n) + BigInt(part), 0n);
	}
}
function parseIPv4(ip) {
	return ip.split('.').map(x => parseInt(x, 10));
}
function parseIPv6(ip) {
	const parts = ip.split("::");
	let head = parts[0].split(":").filter(Boolean);
	let tail = parts[1] ? parts[1].split(":").filter(Boolean) : [];
	let missing = 8 - (head.length + tail.length);
	let full = [...head, ...Array(missing).fill("0"), ...tail];
	return full.map(x => parseInt(x || "0", 16));
}

// 优先级：path > env; socks5 > http > pyip > nat64
function parseConnetMode(path, env, codeDefaultSOCKS, codeDefaultHTTP, codeDefaultPYIP, codeDefaultNAT64) {
	let socksAddr = env.SOCKS5 || codeDefaultSOCKS;
	let httpAddr = env.HTTP || codeDefaultHTTP;
	let pyipStr = env.LANDING_ADDRESS || codeDefaultPYIP;
	let nat64Addr = env.NAT64 || codeDefaultNAT64;

	const hasSocks = path.includes('/socks=');
	const hasHttpMath = path.match(/\/(https?)=([^/]+)/i); // 不区分 `http://` 和 `https://`
	const hasPyIp = path.includes('/pyip='); // 支持以逗号隔开的多个值，后面随机选一个
	const hasNat64 = path.includes('/nat='); // 不区分是否有 => "/96" => 自动去掉"/"以及其后面的内容

	let enableSocks = false;
	let enableHttp = false;
	let enableNat = false;
	let parsedLandingAddress = { hostname: null, port: 443 };
	let parsedSocks5Address = {};

	if (hasSocks) {
		let socksAddr = path.split('/socks=')[1];
		parsedSocks5Address = socks5AddressParser(socksAddr);
		enableSocks = true;
	} else if (hasHttpMath) {
		let httpAddr = hasHttpMath[2];
		parsedSocks5Address = socks5AddressParser(httpAddr);
		enableHttp = true;
	} else if (hasPyIp) {
		let pyAddr = path.split('/pyip=')[1];
		let arr = pyAddr.split(',');
		let randomIndex = Math.floor(Math.random() * arr.length);
		let choiceAddr = arr[randomIndex].trim();
		parsedLandingAddress = hostPortParser(choiceAddr);
	} else if (hasNat64) {
		nat64Addr = path.split('/nat=')[1];
		enableNat = true; // 从path中传入该参数，就强制开启nat64
	} else if (socksAddr) {
		parsedSocks5Address = socks5AddressParser(socksAddr);
		enableSocks = true;
	} else if (httpAddr) {
		parsedSocks5Address = socks5AddressParser(httpAddr);
		enableHttp = true;
	} else if (pyipStr) {
		let arr = pyipStr.split(',');
		let randomIndex = Math.floor(Math.random() * arr.length);
		let choiceAddr = arr[randomIndex].trim();
		parsedLandingAddress = hostPortParser(choiceAddr);
	}
	let nat64IPv6Prefix = nat64Addr.split("/")[0];

	// 注意：返回的 parsedSocks5Address 是 socks5 还是 HTTP 取决于后面的 enableSocks 和 enableHttp
	return { parsedSocks5Address, parsedLandingAddress, nat64IPv6Prefix, enableSocks, enableHttp, enableNat };
}
