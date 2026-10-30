/**
 * 入口层：入站首包（请求头）解析。
 *
 * 与 src/core/handshake.js 里的实现是**同协议、不同写法**，因此按约定另写一份，
 * 不修改原文件。差别在于本版需要额外解析 addons：
 *
 *   version(1)=0 │ uuid(16) │ addonsLen(1) │ addons(addonsLen) │ command(1)
 *   │ port(2,BE) │ addrType(1) │ address │ body...
 *
 * addons 是 protobuf，其中 field 1 为 flow 字符串（空=普通链路）。
 * 本文件只做纯解析，不碰网络。
 */

/** 把 "xxxx-xxxx-..." 形式的 uuid 转成 16 字节；非法返回 null。 */
export function uuidToBytes(str) {
	const hex = String(str).replace(/-/g, '');
	if (hex.length !== 32) return null;
	const out = new Uint8Array(16);
	for (let i = 0; i < 16; i++) {
		const byte = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
		if (Number.isNaN(byte)) return null;
		out[i] = byte;
	}
	return out;
}

/** 解析 addons（protobuf）里的 flow（field 1, string）。 */
export function parseFlowAddons(bytes) {
	let p = 0;
	let flow = '';
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
			while (p < bytes.length && bytes[p] & 0x80) p++;
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

/** 把入口地址类型映射到中转用的类型（1=IPv4 3=域名 4=IPv6）。 */
function mapAddrType(at) {
	return { 1: 1, 2: 3, 3: 4 }[at] ?? null;
}

/**
 * 解析入口首包。
 * @param {Uint8Array} buf 已累积的字节
 * @param {Uint8Array} uuidBytes 允许的 uuid
 * @returns {{status:'need_more'}|{status:'error',message:string}|{status:'ok',addressRemote:string,portRemote:number,addressType:number,isUDP:boolean,flow:string,body:Uint8Array}}
 */
export function parseEntry(buf, uuidBytes) {
	if (buf.byteLength < 1) return { status: 'need_more' };
	if (buf[0] !== 0) return { status: 'error', message: `bad version ${buf[0]}` };
	if (buf.byteLength < 17) return { status: 'need_more' };
	if (!equalBytes(buf.subarray(1, 17), uuidBytes)) return { status: 'error', message: 'uuid mismatch' };
	if (buf.byteLength < 18) return { status: 'need_more' };

	const addonsLen = buf[17];
	let p = 18;
	if (buf.byteLength < p + addonsLen) return { status: 'need_more' };
	const flow = parseFlowAddons(buf.subarray(p, p + addonsLen));
	p += addonsLen;

	if (buf.byteLength < p + 1) return { status: 'need_more' };
	const command = buf[p++];
	if (command === 3) return { status: 'error', message: 'mux not supported' };
	if (command !== 1 && command !== 2) return { status: 'error', message: `bad command ${command}` };
	const isUDP = command === 2;

	if (buf.byteLength < p + 3) return { status: 'need_more' };
	const port = (buf[p] << 8) | buf[p + 1];
	p += 2;
	const addrType = buf[p++];

	let address = '';
	if (addrType === 1) {
		if (buf.byteLength < p + 4) return { status: 'need_more' };
		address = `${buf[p]}.${buf[p + 1]}.${buf[p + 2]}.${buf[p + 3]}`;
		p += 4;
	} else if (addrType === 2) {
		if (buf.byteLength < p + 1) return { status: 'need_more' };
		const len = buf[p++];
		if (buf.byteLength < p + len) return { status: 'need_more' };
		address = new TextDecoder().decode(buf.subarray(p, p + len));
		p += len;
	} else if (addrType === 3) {
		if (buf.byteLength < p + 16) return { status: 'need_more' };
		const parts = [];
		for (let i = 0; i < 8; i++, p += 2) parts.push(((buf[p] << 8) | buf[p + 1]).toString(16));
		address = parts.join(':');
	} else {
		return { status: 'error', message: `bad addrType ${addrType}` };
	}

	return {
		status: 'ok',
		addressRemote: address,
		portRemote: port,
		addressType: mapAddrType(addrType),
		isUDP,
		flow,
		body: buf.subarray(p),
	};
}