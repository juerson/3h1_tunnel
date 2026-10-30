/**
 * 上游层：relay 客户端、gateway CONNECT 客户端、NAT64 地址合成。
 *
 * 三者都需要「这条转发通道走哪条上游路线」的信息，
 * 一律从连接上下文 ctx 取，不再依赖模块级全局变量。
 */

import { connect } from 'cloudflare:sockets';
import { createByteReader } from '../common/stream.js';
import { BUILTIN_DEFAULTS } from './config.js';

const textEncoder = new TextEncoder();
const textDecoder = new TextDecoder();

/**
 * 通过 relay 上游建立到目标的连接。
 *
 * 握手阶段用官方 ReadableStreamDefaultReader 精确读取应答，
 * 既能正确处理半包，也不会把多读到的字节丢掉——
 * 那些字节是上游服务器紧接着发来的转发数据，必须原样交给客户端。
 *
 * @param {object} ctx 连接上下文
 * @param {number} addressType 目标地址类型 1=IPv4 3=域名 4=IPv6
 * @param {string} addressRemote 目标地址
 * @param {number} portRemote 目标端口
 * @param {Function} log 日志函数
 * @returns {Promise<{socket: object, readable: ReadableStream}>}
 */
export async function dialRelay(ctx, addressType, addressRemote, portRemote, log) {
	const { username, password, hostname, port } = ctx.upstreamAddr;
	const socket = connect({ hostname, port });
	const writer = socket.writable.getWriter();
	const encoder = new TextEncoder();
	// 官方 ReadableStreamDefaultReader：精确读取应答，既能处理半包，也不会丢掉多读到的字节
	const byteReader = createByteReader(socket.readable);

	try {
		// 1. 问候
		await writer.write(new Uint8Array([5, 2, 0, 2]));
		log('sent relay greeting');

		let res = await byteReader.readExactly(2);
		if (res[0] !== 0x05) throw new Error(`relay server version error: ${res[0]} expected: 5`);
		if (res[1] === 0xff) throw new Error('no acceptable methods');
		if (res[1] === 0x02) {
			log('relay server needs auth');
			if (!username || !password) throw new Error('please provide username/password');
			const authRequest = new Uint8Array([1, username.length, ...encoder.encode(username), password.length, ...encoder.encode(password)]);
			await writer.write(authRequest);
			res = await byteReader.readExactly(2);
			if (res[0] !== 0x01 || res[1] !== 0x00) throw new Error('fail to auth relay server');
		}

		// 2. 连接请求
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
				throw new Error(`invild  addressType is ${addressType}`);
		}
		const relayRequest = new Uint8Array([5, 1, 0, ...DSTADDR, portRemote >> 8, portRemote & 0xff]);
		await writer.write(relayRequest);
		log('sent relay request');

		// 3. 应答：4 字节头 + 绑定地址 + 端口
		res = await byteReader.readExactly(4);
		if (res[0] !== 0x05) throw new Error(`relay server version error: ${res[0]} expected: 5`);
		if (res[1] !== 0x00) throw new Error('fail to open relay connection');
		const atyp = res[3];
		if (atyp === 0x01) await byteReader.readExactly(4);
		else if (atyp === 0x03) {
			const len = await byteReader.readExactly(1);
			await byteReader.readExactly(len[0]);
		} else if (atyp === 0x04) await byteReader.readExactly(16);
		await byteReader.readExactly(2);
		log('relay connection opened');
	} catch (err) {
		log('relay connect failed:', err);
		try {
			writer.releaseLock();
		} catch {
			/* 写入可能未完成，忽略 */
		}
		byteReader.release();
		socket.close().catch(() => {});
		throw err;
	}

	writer.releaseLock();
	// 官方 ReadableStream：握手期间多读到的字节先吐出来，再直通 socket
	return { socket, readable: byteReader.toReadable() };
}

/**
 * 构造 HTTP CONNECT 请求报文。
 */
export function buildGatewayRequest(host, port, username, password) {
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

/**
 * 把请求报文写进 socket。
 */
export async function sendRaw(sock, request) {
	const writer = sock.writable.getWriter();
	await writer.write(textEncoder.encode(request));
	writer.releaseLock();
}

/**
 * 查找 HTTP 响应头的结束位置（\r\n\r\n 的起始下标），找不到返回 -1。
 */
export function findHeaderEnd(buffer) {
	for (let i = 0; i < buffer.length - 3; i++) {
		if (buffer[i] === 13 && buffer[i + 1] === 10 && buffer[i + 2] === 13 && buffer[i + 3] === 10) {
			return i;
		}
	}
	return -1;
}

/**
 * 通过 gateway 上游建立到目标的连接。
 * @param {object} ctx 连接上下文
 * @param {string} remoteHost 目标主机
 * @param {number} remotePort 目标端口
 * @param {Function} log 日志函数
 * @returns {Promise<{socket: object, readable: ReadableStream}>}
 */
export async function dialGateway(ctx, remoteHost, remotePort, log) {
	const { hostname, port, username, password } = ctx.upstreamAddr; // 共用relay解析函数
	log(`准备使用HTTP上游 ${hostname}:${port} 连接 ${remoteHost}:${remotePort}`);
	const sock = await connect({ hostname, port });
	const request = buildGatewayRequest(remoteHost, remotePort, username, password);
	await sendRaw(sock, request);

	// 官方 ReadableStreamDefaultReader：一直读到 HTTP 响应头结束
	const byteReader = createByteReader(sock.readable);
	try {
		const head = await byteReader.readUntil((buf) => {
			const idx = findHeaderEnd(buf);
			return idx === -1 ? -1 : idx + 4;
		});
		const responseText = textDecoder.decode(head);
		if (!/^HTTP\/1\.[01] 200/.test(responseText)) {
			throw new Error(`HTTP上游响应异常: ${responseText.split('\r\n')[0]}`);
		}
		log(`HTTP连接 ${remoteHost}:${remotePort} 成功！`);
	} catch (err) {
		log('http upstream connect failed:', err);
		byteReader.release();
		sock.close().catch(() => {});
		throw err;
	}

	// 官方 ReadableStream：响应头之后多读到的字节先吐出来，再直通 socket
	return { socket: sock, readable: byteReader.toReadable() };
}

/**
 * 解析最终要连接的目标地址（中转地址 优先，否则走 NAT64）。
 * @param {object} ctx 连接上下文
 * @param {string} addressRemote 客户端请求的目标地址
 * @param {number} portRemote 客户端请求的目标端口
 */
export async function resolveDialTarget(ctx, addressRemote, portRemote) {
	// 是否强制nat64
	if (!ctx.enableNat && ctx.landingAddr?.hostname) {
		return {
			address: ctx.landingAddr.hostname,
			port: ctx.landingAddr.port || portRemote,
		};
	} else {
		const nat64Address = await composeNAT64(addressRemote, ctx.nat64Prefix);
		return {
			address: nat64Address || addressRemote,
			port: portRemote,
		};
	}
}

/**
 * 通过 DoH 把目标域名解析成 IPv4，再拼成 NAT64 的 IPv6 地址。
 * @param {string} addressRemote 目标域名
 * @param {string} prefix NAT64 前缀
 */
export async function composeNAT64(addressRemote, prefix = BUILTIN_DEFAULTS.nat64) {
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
