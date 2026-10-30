/**
 * 将 array 拆分成若干个子数组，每个子数组的长度最多为 chunkSize 条，最后一个子数组可能少于 chunkSize 条
 * @param {Array} array - 需要分割的原始数组。
 * @param {number} maxChunkSize -  按最大长度切块
 * @returns {Array} 返回分割后的嵌套数组
 */
function splitArrayByMaxSize(array, maxChunkSize) {
	const result = [];
	for (let i = 0; i < array.length; i += maxChunkSize) {
		result.push(array.slice(i, i + maxChunkSize));
	}
	return result;
}

/**
 * 看成将一个大的ips数组转换二维数组，然后根据page数，决定取哪一组数据返回
 * @param {*} ipsArray 全部ips的数组
 * @param {*} maxItem 想要多少个条目，超出upperLimit范围采用默认的数值defaultCount
 * @param {*} page 取第几页的数据,数值index从零开始，这个已经处理成从第1开始
 * @param {*} upperLimit 限制最大上限数，防止无休止取一个很大值（无意义）
 * @param {*} defaultCount 当用户传入的最大条目数不在指定范围，那么这个数就起作用
 * @returns 返回一个含有多个IP或域名的数组
 */
export function pageItems(ipsArray, maxItem, page, upperLimit = 500, defaultCount = 300) {
	if (!Array.isArray(ipsArray)) {
		return { hasError: true, message: '输入数据不是有效的数组' };
	}

	let max = maxItem > 0 && maxItem <= upperLimit ? maxItem : defaultCount;
	let chunkedArray = splitArrayByMaxSize(ipsArray, max);
	let totalPage = chunkedArray.length;

	if (page > totalPage || page < 1) {
		return { hasError: true, message: '数据为空，或者没有该页数，数据过少远达不到这个页码！' };
	}
	let data = chunkedArray[page - 1]; // page从1开始，所以需要减1

	return { chunkedIPs: data, totalPage };
}

// ————————————————————————  中转地址 和 relay 地址解析 ————————————————————————

 // 解析主机名和端口号，也就是[host][:port]的主机名和端口号，注意：ipv6保留[]，并且传入时也要带[]
export function parseHostPort(s) {
	const v = (x) => {
		x = +x;
		return x >= 1 && x <= 65535 ? x : 443;
	};
	let h,
		p = 443,
		i;
	if (s[0] === '[') {
		if ((i = s.indexOf(']')) === -1) return { hostname: null, port: null };
		h = s.slice(0, i + 1);
		if (s[i + 1] === ':') p = v(s.slice(i + 2));
	} else if ((i = s.lastIndexOf(':')) !== -1 && s.indexOf(':') === i) {
		h = s.slice(0, i);
		p = v(s.slice(i + 1));
	} else h = s;
	return { hostname: h, port: p };
}

// 解析relay地址格式，支持user:pass@host:port和:@host:port两种形式
export function parseRelayAddr(address) {
	let [latter, former] = address.split('@').reverse();
	let username, password, hostname, port;
	if (former) {
		const formers = former.split(':');
		if (formers.length !== 2) throw new Error('Invalid relay address format');
		[username, password] = formers;
	}
	const latters = latter.split(':');
	port = Number(latters.pop());
	if (isNaN(port)) throw new Error('Invalid relay address format');
	hostname = latters.join(':');
	const regex = /^\[.*\]$/;
	if (hostname.includes(':') && !regex.test(hostname)) {
		throw new Error('Invalid relay address format');
	}
	return { username, password, hostname, port };
}

// —————————————————— 随机生成 IPv4 CIDR 范围指定数量的 IP 地址 —————————————————

function isValidCIDR(cidr) {
	if (typeof cidr !== 'string') return false;
	const cidrPattern = /^(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})\/(\d{1,2})$/;
	const match = cidr.match(cidrPattern);
	if (!match) return false;
	const ipParts = match[1].split('.').map(Number);
	const prefix = Number(match[2]);
	if (
		ipParts.some(n => n < 0 || n > 255 || !Number.isInteger(n)) ||
		prefix < 0 || prefix > 32 || !Number.isInteger(prefix)
	) {
		return false;
	}
	return true;
}
function cidrToIpRange(cidr) {
	const [ip, prefix] = cidr.split('/');
	const ipParts = ip.split('.').map(Number);
	const base = (ipParts[0] << 24) | (ipParts[1] << 16) | (ipParts[2] << 8) | ipParts[3];
	const bits = 32 - parseInt(prefix, 10);
	const count = bits === 0 ? 2 ** 32 : 2 ** bits;
	return { base: base >>> 0, count };
}
function intToIp(int) {
	return [
		(int >>> 24) & 0xff,
		(int >>> 16) & 0xff,
		(int >>> 8) & 0xff,
		int & 0xff,
	].join('.');
}
// 随机采样
function getRandomIndexes(n, size) {
	if (size > n) size = n; // 防止越界
	const arr = Array.from({ length: n }, (_, i) => i);
	for (let i = 0; i < size; i++) {
		const j = i + Math.floor(Math.random() * (n - i));
		[arr[i], arr[j]] = [arr[j], arr[i]];
	}
	return arr.slice(0, size);
}
export function genAddrsFromCIDR(cidr, maxCount = 1000, ratio = 4) {
	try {
		if (!isValidCIDR(cidr)) return [];
		if (!Number.isInteger(maxCount) || maxCount <= 0) return [];

		const { base, count } = cidrToIpRange(cidr);
		if (!Number.isFinite(count) || count <= 0) return [];

		const maxTotal = maxCount * ratio;
		const FULL_GEN_THRESHOLD = 2048;

		const useFullTable = (count <= FULL_GEN_THRESHOLD) || (count <= maxTotal);
		// 使用全量生成＋抽取
		if (useFullTable) {
			if (count <= maxCount) {
				// 返回所有IP
				return Array.from({ length: count }, (_, i) => intToIp(base + i));
			} else {
				// 随机抽取maxCount个
				const randomOffsets = getRandomIndexes(count, maxCount);
				return randomOffsets.map(offset => intToIp(base + offset));
			}
		}

		// 超大范围随机采样maxCount个
		const set = new Set();
		const ATTEMPT_LIMIT = maxCount * 10;
		let attempt = 0;
		while (set.size < maxCount && attempt < ATTEMPT_LIMIT) {
			const offset = Math.floor(Math.random() * count);
			set.add(intToIp(base + offset));
			attempt++;
		}
		// 若未采样够
		if (set.size < maxCount) return [];
		return Array.from(set);
	} catch (e) {
		console.log("function generateIPsFromCIDR error:", e);
		return [];
	}
}
