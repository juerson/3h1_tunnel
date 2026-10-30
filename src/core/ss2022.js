/**
 * Shadowsocks 2022（2022-blake3-aes-128-gcm）TCP 协议层。
 *
 * 依据 SIP022：https://shadowsocks.org/doc/sip022.html
 *
 * 为什么单独一个文件：SS2022 需要「流式 AEAD 分块 + BLAKE3 派生 subkey + 双向各自 salt」，
 * 与现有的明文握手解析（handshake.js）结构差异很大。集中在这里，实现出问题时只需读这一个文件。
 *
 * 请求流（客户端 → 服务端）:
 *   salt(16) │ AEAD( type=0(1) + ts(8) + hdrLen(2) ) │ AEAD( ATYP+ADDR+PORT + padLen(2) + pad + 初始载荷 )
 *            │ 重复: AEAD( len(2) ) │ AEAD( payload )
 *
 * 响应流（服务端 → 客户端）:
 *   salt(16) │ AEAD( type=1(1) + ts(8) + 请求salt(16) + len(2) ) │ AEAD( payload )
 *            │ 重复: AEAD( len(2) ) │ AEAD( payload )
 *
 * 双向各自持有独立 salt/subkey；nonce 是 12 字节 little-endian 计数器，每次 AEAD 操作后 +1。
 */

import { concatBytes } from '../common/stream.js';
import { blake3Hash, deriveKey, IV } from '../common/blake3.js';

export const SS2022_METHOD = '2022-blake3-aes-128-gcm';
export const KEY_SIZE = 16; // aes-128 → 16
export const SALT_SIZE = 16; // salt 与 key 等长
export const TAG_SIZE = 16;
export const MAX_PAYLOAD = 0xffff; // 单个 payload chunk 明文上限

const CONTEXT = 'shadowsocks 2022 session subkey';
const TIMESTAMP_TOLERANCE_SEC = 30;

// ——————————————————————— 通用工具 ———————————————————————

function toU8(x) {
	return x instanceof Uint8Array ? x : new Uint8Array(x);
}

/** 字节 → base64（SS2022 的 PSK 用 base64 表示）。 */
export function bytesToBase64(bytes) {
	let binary = '';
	for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
	return btoa(binary);
}

/** base64 → 字节，兼容 url-safe。 */
export function base64ToBytes(str) {
	const binary = atob(String(str).replace(/-/g, '+').replace(/_/g, '/'));
	const out = new Uint8Array(binary.length);
	for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i);
	return out;
}

/**
 * 从口令得到 16 字节 PSK。
 *
 * SS2022 约定：口令本身就是 base64 编码的 PSK，客户端直接 base64 解码后当 PSK 使用，
 * 例如 "yQ0wV0N1K3xir9WmJ8YOZQ==" → 16 字节。因此这里**优先按 base64 解码**，
 * 只要解码结果 ≥ 16 字节就直接取前 16 字节，保证与客户端完全一致。
 * 仅当口令不是合法 base64（例如直接把 uuid 当口令）时，才退回 BLAKE3 派生 16 字节。
 */
export function pskFromSecret(secret) {
	try {
		const decoded = base64ToBytes(String(secret));
		if (decoded.length >= KEY_SIZE) return decoded.slice(0, KEY_SIZE);
	} catch {
		/* 非法 base64，走下面的派生兜底 */
	}
	return blake3Hash(new TextEncoder().encode(String(secret)), IV, 0).slice(0, KEY_SIZE);
}

// ——————————————————————— AEAD ———————————————————————

/** 12 字节 little-endian 计数器。 */
function nonceBytes(counter) {
	const n = new Uint8Array(12);
	let c = counter;
	for (let i = 0; i < 12; i++) {
		n[i] = Number(c & 0xffn);
		c >>= 8n;
	}
	return n;
}

/** session_subkey := blake3::derive_key("shadowsocks 2022 session subkey", psk + salt)，取前 16 字节。 */
export async function deriveSessionSubkey(psk, salt) {
	return deriveKey(CONTEXT, concatBytes(psk, salt)).slice(0, KEY_SIZE);
}

async function importAesKey(subkey) {
	return crypto.subtle.importKey('raw', subkey, { name: 'AES-GCM' }, false, ['encrypt', 'decrypt']);
}

async function aeadSeal(key, counter, plaintext) {
	return new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv: nonceBytes(counter), tagLength: 128 }, key, plaintext));
}

async function aeadOpen(key, counter, ciphertext) {
	return new Uint8Array(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: nonceBytes(counter), tagLength: 128 }, key, ciphertext));
}

// ——————————————————————— SOCKS5 地址解析 ———————————————————————

function parseSocksAddr(bytes, offset) {
	const atyp = bytes[offset++];
	let address = '';
	if (atyp === 1) {
		if (offset + 4 > bytes.length) throw new Error('IPv4 越界');
		address = `${bytes[offset]}.${bytes[offset + 1]}.${bytes[offset + 2]}.${bytes[offset + 3]}`;
		offset += 4;
	} else if (atyp === 3) {
		const len = bytes[offset++];
		if (offset + len > bytes.length) throw new Error('域名越界');
		address = new TextDecoder().decode(bytes.slice(offset, offset + len));
		offset += len;
	} else if (atyp === 4) {
		if (offset + 16 > bytes.length) throw new Error('IPv6 越界');
		const parts = [];
		for (let i = 0; i < 8; i++, offset += 2) parts.push(((bytes[offset] << 8) | bytes[offset + 1]).toString(16));
		address = parts.join(':');
	} else {
		throw new Error(`未知 ATYP: ${atyp}`);
	}
	if (offset + 2 > bytes.length) throw new Error('端口越界');
	const port = (bytes[offset] << 8) | bytes[offset + 1];
	offset += 2;
	return { atyp, address, port, end: offset };
}

function checkTimestamp(bytes, offset) {
	const view = new DataView(bytes.buffer, bytes.byteOffset + offset, 8);
	const ts = Number(view.getBigUint64(0, false));
	const now = Math.floor(Date.now() / 1000);
	const diff = Math.abs(ts - now);
	if (diff > TIMESTAMP_TOLERANCE_SEC) throw new Error(`时间戳偏差 ${diff}s 超过 ${TIMESTAMP_TOLERANCE_SEC}s（请校准客户端时间）`);
}

// ——————————————————————— 请求解密器 ———————————————————————

/**
 * 创建请求流的逐步解密器。
 * 因为 WebSocket 分片边界与 SS2022 分块边界不对齐，必须跨分片累积后按状态机推进。
 *
 * @param {Uint8Array} psk 16 字节预共享密钥
 * @returns {{feed:Function, established:boolean, requestSalt:Uint8Array|null}}
 */
export function createRequestDecoder(psk) {
	let buf = new Uint8Array(0);
	let phase = 'salt';
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
			for (;;) {
				if (phase === 'salt') {
					if (buf.byteLength < SALT_SIZE) break;
					salt = buf.slice(0, SALT_SIZE);
					buf = buf.slice(SALT_SIZE);
					key = await importAesKey(await deriveSessionSubkey(psk, salt));
					nonce = 0n;
					phase = 'hdr1';
				} else if (phase === 'hdr1') {
					const need = 1 + 8 + 2 + TAG_SIZE; // 固定长度头 11B + tag
					if (buf.byteLength < need) break;
					const ct = buf.slice(0, need);
					buf = buf.slice(need);
					const pt = await aeadOpen(key, nonce++, ct);
					if (pt[0] !== 0) throw new Error(`请求头 type=${pt[0]} 非客户端流`);
					checkTimestamp(pt, 1);
					headerLen = (pt[9] << 8) | pt[10];
					if (headerLen < 1) throw new Error('可变头长度非法');
					phase = 'hdr2';
				} else if (phase === 'hdr2') {
					const need = headerLen + TAG_SIZE;
					if (buf.byteLength < need) break;
					const ct = buf.slice(0, need);
					buf = buf.slice(need);
					const pt = await aeadOpen(key, nonce++, ct);

					const addr = parseSocksAddr(pt, 0);
					let p = addr.end;
					if (p + 2 > pt.length) throw new Error('缺少 padding 长度');
					const padLen = (pt[p] << 8) | pt[p + 1];
					p += 2;
					if (p + padLen > pt.length) throw new Error('padding 越界');
					p += padLen;
					const initialPayload = pt.slice(p);
					if (initialPayload.byteLength === 0 && padLen === 0) throw new Error('请求头既无载荷也无 padding');

					header = {
						hasError: false,
						addressRemote: addr.address,
						portRemote: addr.port,
						addressType: addr.atyp, // 与 S5elv/ss 一致，直接用 ATYP(1/3/4)
						rawClientData: initialPayload,
						responseHeader: null,
						isUDP: false,
					};
					established = true;
					phase = 'len';
				} else if (phase === 'len') {
					const need = 2 + TAG_SIZE;
					if (buf.byteLength < need) break;
					const ct = buf.slice(0, need);
					buf = buf.slice(need);
					const pt = await aeadOpen(key, nonce++, ct);
					wantLen = (pt[0] << 8) | pt[1];
					phase = 'payload';
				} else if (phase === 'payload') {
					const need = wantLen + TAG_SIZE;
					if (buf.byteLength < need) break;
					const ct = buf.slice(0, need);
					buf = buf.slice(need);
					const pt = await aeadOpen(key, nonce++, ct);
					if (pt.byteLength) payloads.push(pt);
					wantLen = -1;
					phase = 'len';
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
		},
	};
}

// ——————————————————————— 响应加密器 ———————————————————————

function buildResponseHeader(requestSalt, firstPayloadLen) {
	const hdr = new Uint8Array(27);
	hdr[0] = 1; // server stream
	new DataView(hdr.buffer).setBigUint64(1, BigInt(Math.floor(Date.now() / 1000)), false);
	hdr.set(requestSalt, 9);
	hdr[25] = (firstPayloadLen >> 8) & 0xff;
	hdr[26] = firstPayloadLen & 0xff;
	return hdr;
}

/**
 * 创建响应流加密 TransformStream 工厂（每次调用返回一条全新的流，便于 retry 重建）。
 *
 * @param {Uint8Array} psk 16 字节预共享密钥
 * @param {Uint8Array} requestSalt 请求流的 salt，必须原样回填进响应头
 * @returns {Function} () => TransformStream
 */
export function createResponseEncoderFactory(psk, requestSalt) {
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
						controller.enqueue(concatBytes(salt, hdrCt, payloadCt)); // salt+头+首片一次性发出
						headerSent = true;
					} else {
						const lenCt = await aeadSeal(key, nonce++, new Uint8Array([(len >> 8) & 0xff, len & 0xff]));
						const payloadCt = await aeadSeal(key, nonce++, piece);
						controller.enqueue(concatBytes(lenCt, payloadCt));
					}
				}
			},
		});
	};
}