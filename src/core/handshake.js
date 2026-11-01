/**
 * 握手格式层：三种入站握手格式的握手头解析、握手类型探测、IP 白名单匹配。
 *
 * 三个握手格式：
 *   S5elv     —— S5elv，uuid 鉴权
 *   Naj0rt   —— Naj0rt，sha224 密码摘要鉴权
 *   Skc0swodahs —— ss，SS2022(2022-blake3-aes-128-gcm) 加密，由 IP 白名单放行
 *                 （实现见 core/ss2022.js；本文件的 parseSkc0swodahs 为旧明文实现，已不再走主链路）
 *
 * 所有解析函数都是纯函数：输入字节 → 输出结构化描述或错误信息，不触碰网络与全局状态。
 */

/**
 * 解析 S5elv 握手头。
 * @param {ArrayBuffer} buffer 客户端首包
 * @param {string} userID 允许的 uuid
 */
export function parseS5elv(buffer, userID) {
	const view = new Uint8Array(buffer);
	if (view.length < 24) return { hasError: true, message: 'Too short' };

	const bytes2UUID = (bytes) =>
		[...bytes].map((b, i) => `${[4, 6, 8, 10].includes(i) ? '-' : ''}${b.toString(16).padStart(2, '0')}`).join('');
	const uuid = bytes2UUID(view.slice(1, 17));
	if (uuid !== userID) return { hasError: true, message: 'Unauthorized UUID' };

	const optLen = view[17];
	const base = 18 + optLen;
	// base 之后至少要有 command(1)+port(2)+addrType(1)，越界即拒绝，避免按偏移取值时抛 RangeError
	if (base + 4 > view.length) return { hasError: true, message: 'Header too short' };

	let isUDP = false;
	const command = view[base];
	if (command === 2) isUDP = true;
	else if (command !== 1) return { hasError: true, message: `command ${command} is not support` };

	const port = (view[base + 1] << 8) | view[base + 2];

	let p = base + 3;
	const addrType = view[p++];

	let address = '';
	if (addrType === 1) {
		if (p + 4 > view.length) return { hasError: true, message: 'Header too short for IPv4' };
		address = `${view[p++]}.${view[p++]}.${view[p++]}.${view[p++]}`;
	} else if (addrType === 2) {
		if (p + 1 > view.length) return { hasError: true, message: 'Header too short for domain' };
		const len = view[p++];
		if (p + len > view.length) return { hasError: true, message: 'Header too short for domain' };
		let chars = [];
		for (let i = 0; i < len; ++i) chars.push(view[p + i]);
		address = String.fromCharCode(...chars);
		p += len;
	} else if (addrType === 3) {
		if (p + 16 > view.length) return { hasError: true, message: 'Header too short for IPv6' };
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

/**
 * 解析 Naj0rt 握手头。
 * @param {ArrayBuffer} buffer 客户端首包
 * @param {string} sha224Password 密码的 sha224 摘要
 */
export function parseNaj0rt(buffer, sha224Password) {
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

/**
 * 解析 Skc0swodahs（ss，未加密）握手头。
 * @param {ArrayBuffer} buffer 客户端首包
 */
export function parseSkc0swodahs(buffer) {
	if (buffer.byteLength < 1) return { hasError: true, message: 'Header too short' };
	const view = new DataView(buffer);
	const addrType = view.getUint8(0);
	let address = '',
		offset = 1;
	const textDecoder = new TextDecoder();
	if (addrType === 1) {
		if (buffer.byteLength < 5) return { hasError: true, message: 'Header too short for IPv4' };
		address = Array.from(new Uint8Array(buffer.slice(1, 5))).join('.');
		offset = 5;
	} else if (addrType === 3) {
		if (buffer.byteLength < 2) return { hasError: true, message: 'Header too short for domain' };
		const len = view.getUint8(1);
		if (buffer.byteLength < 2 + len) return { hasError: true, message: 'Header too short for domain' };
		address = textDecoder.decode(buffer.slice(2, 2 + len));
		offset = 2 + len;
	} else if (addrType === 4) {
		if (buffer.byteLength < 17) return { hasError: true, message: 'Header too short for IPv6' };
		const parts = [];
		for (let i = 0; i < 8; i++) parts.push(view.getUint16(1 + i * 2).toString(16));
		address = parts.join(':');
		offset = 17;
	} else {
		return { hasError: true, message: `Invalid addressType: ${addrType}` };
	}
	if (buffer.byteLength < offset + 2) return { hasError: true, message: 'Header too short for port' };
	const port = new DataView(buffer.slice(offset, offset + 2)).getUint16(0);

	return {
		hasError: false,
		addressRemote: address,
		portRemote: port,
		rawClientData: new Uint8Array(buffer.slice(offset + 2)),
		addressType: addrType,
		responseHeader: null,
		isUDP: false,
	};
}

/**
 * 探测客户端使用的是哪种握手格式。
 *
 * 注意：SS2022(ss) 首包是随机 salt，无法按字节识别，因此这里不参与 ss 判定——
 * ss 的识别与鉴权由 session.js 里的 AEAD 试解密完成。
 *
 * @param {ArrayBuffer} buffer 客户端首包
 * @returns {number} 1=S5elv 2=Naj0rt 3=无法识别
 */
export function detectKind(buffer) {
	const view = new Uint8Array(buffer);

	// 检查 UUID（v4 或 v7） -> S5elv 类型
	if (view.byteLength >= 17) {
		const version = (view[7] & 0xf0) >> 4;
		const isRFC4122Variant = (view[9] & 0xc0) === 0x80;

		if (isRFC4122Variant && (version === 4 || version === 7)) {
			return 1;
		}
	}
	// 检查 Naj0rt 定界符 -> Naj0rt 类型
	if (view.byteLength >= 62) {
		const [b0, b1, b2, b3] = [view[56], view[57], view[58], view[59]];
		const validB2 = [0x01, 0x03, 0x7f];
		const validB3 = [0x01, 0x03, 0x04];

		if (b0 === 0x0d && b1 === 0x0a && validB2.includes(b2) && validB3.includes(b3)) {
			return 2;
		}
	}

	return 3;
}

/**
 * 判断请求来源 IP 是否命中白名单。
 * 
 * @param {Request} request 用于取 CF-Connecting-IP
 * @param {string[]} allowedRules IP/CIDR 白名单
 */
export function isIpAllowed(request, allowedRules = ['0.0.0.0/0', '::/0']) {
	if (!Array.isArray(allowedRules)) return false;
	if (allowedRules.some((r) => r === '0.0.0.0/0' || r === '::/0')) return true;
	const ip = request?.headers?.get('CF-Connecting-IP');
	console.log("My IP:", ip);
	return !!ip && allowedRules.some((rule) => isIpMatch(ip, rule));
}

/**
 * 判断某个 IP 是否命中一条规则（支持 CIDR 与单个 IP）。
 */
export function isIpMatch(ip, rule) {
	// 允许所有 IPv4 / IPv6 流量
	if (['0.0.0.0/0', '::/0'].includes(rule)) return true;
	// 判断 rule 是 CIDR 还是单个 IP
	if (rule.includes('/')) {
		return inCIDR(ip, rule);
	} else {
		return ip === rule; // 精确匹配
	}
}

/**
 * 判断 ip 是否落在 cidr 网段内。
 */
export function inCIDR(ip, cidr) {
	const [range, bits = '32'] = cidr.split('/');
	const ipBig = ipToBigInt(ip);
	const rangeBig = ipToBigInt(range);
	const prefix = parseInt(bits, 10);

	if (ip.includes('.') && range.includes('.')) {
		// IPv4
		const mask = ~((1 << (32 - prefix)) - 1) >>> 0;
		return Number(ipBig & BigInt(mask)) === Number(rangeBig & BigInt(mask));
	} else if (!ip.includes('.') && !range.includes('.')) {
		// IPv6
		const mask = (1n << 128n) - (1n << (128n - BigInt(prefix)));
		return (ipBig & mask) === (rangeBig & mask);
	} else {
		return false; // IPv4 vs IPv6 不匹配
	}
}

/**
 * 把 IP 文本转成 BigInt，便于按位比较。
 */
export function ipToBigInt(ip) {
	if (ip.includes('.')) {
		// IPv4
		const [a, b, c, d] = parseIPv4(ip);
		return BigInt((a << 24) | (b << 16) | (c << 8) | d);
	} else {
		// IPv6
		const parts = parseIPv6(ip);
		return parts.reduce((acc, part) => (acc << 16n) + BigInt(part), 0n);
	}
}

/**
 * 解析 IPv4 文本为 4 个十进制段。
 */
export function parseIPv4(ip) {
	return ip.split('.').map((x) => parseInt(x, 10));
}

/**
 * 解析 IPv6 文本为 8 个十六进制段（自动展开 ::）。
 */
export function parseIPv6(ip) {
	const parts = ip.split('::');
	let head = parts[0].split(':').filter(Boolean);
	let tail = parts[1] ? parts[1].split(':').filter(Boolean) : [];
	let missing = 8 - (head.length + tail.length);
	let full = [...head, ...Array(missing).fill('0'), ...tail];
	return full.map((x) => parseInt(x || '0', 16));
}
