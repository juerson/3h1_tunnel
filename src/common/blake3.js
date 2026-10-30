/**
 * 手写 BLAKE3（仅实现 SS2022 用得到的子集）。
 *
 * 为什么手写：Cloudflare Workers 的 Web Crypto 只提供 SHA/HKDF/PBKDF2 等，
 * 没有 BLAKE3，而 Shadowsocks 2022 的 session subkey 必须用 BLAKE3 的
 * derive_key 模式派生，无法用 Web Crypto 替代。
 *
 * 实现范围（受限于 SS2022 的实际输入）：
 *   - 支持单 chunk（输入 ≤ 1024 字节）的 hash / keyed-hash；
 *   - 支持 derive_key（context 与 key_material 都走同一条单 chunk 路径）。
 *   SS2022 的 context 固定 30 字节、key_material = key+salt ≤ 64 字节，
 *   密码派生也远小于 1024 字节，因此单 chunk 已足够。
 *
 * 参考：BLAKE3 spec  https://github.com/BLAKE3-team/BLAKE3-specs
 */

const IV = new Uint32Array([0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19]);

// 每轮结束后对消息调度做置换
const MSG_PERMUTATION = [2, 6, 3, 10, 7, 0, 4, 13, 1, 11, 12, 5, 9, 14, 15, 8];

// domain flags
const CHUNK_START = 1;
const CHUNK_END = 2;
const ROOT = 8;
const DERIVE_KEY_CONTEXT = 32;
export const DERIVE_KEY_MATERIAL = 64;

const BLOCK_LEN = 64;
const CHUNK_LEN = 1024;

const rotr = (x, n) => (x >>> n) | (x << (32 - n));

/** BLAKE3 的 G 混合函数（旋转量 16/12/8/7）。 */
function g(v, a, b, c, d, mx, my) {
	v[a] = (v[a] + v[b] + mx) >>> 0;
	v[d] = rotr(v[d] ^ v[a], 16);
	v[c] = (v[c] + v[d]) >>> 0;
	v[b] = rotr(v[b] ^ v[c], 12);
	v[a] = (v[a] + v[b] + my) >>> 0;
	v[d] = rotr(v[d] ^ v[a], 8);
	v[c] = (v[c] + v[d]) >>> 0;
	v[b] = rotr(v[b] ^ v[c], 7);
}

/** 一轮 8 次 G 调用。 */
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

/**
 * BLAKE3 压缩函数，返回 16 个 u32 字。
 * counter 用两个 u32 表示（低、高），本实现只会用到 0。
 */
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

/** 把字节按 little-endian 装进 count 个字（不足补零）。 */
function bytesToWords(bytes, count) {
	const w = new Uint32Array(count);
	const limit = Math.min(bytes.length, count * 4);
	for (let i = 0; i < limit; i++) w[i >> 2] |= bytes[i] << ((i & 3) * 8);
	return w;
}

/** 把字按 little-endian 还原成字节。 */
function wordsToBytes(words) {
	const out = new Uint8Array(words.length * 4);
	const dv = new DataView(out.buffer);
	for (let i = 0; i < words.length; i++) dv.setUint32(i * 4, words[i], true);
	return out;
}

/**
 * BLAKE3 hash（单 chunk，输入 ≤ 1024 字节）。
 * @param {Uint8Array} input
 * @param {Uint32Array} key 8 个字的初始链接值，默认 IV
 * @param {number} flags 域标志
 * @returns {Uint8Array} 32 字节
 */
export function blake3Hash(input, key = IV, flags = 0) {
	if (input.length > CHUNK_LEN) throw new Error('blake3Hash: input exceeds one chunk (>1024 bytes)');
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
	// 不可达：numBlocks ≥ 1 且最后一轮必然 return
	throw new Error('blake3Hash: unreachable');
}

/**
 * BLAKE3 的 derive_key 模式。
 * session_subkey := blake3::derive_key(context, key_material)
 * @param {string} contextStr
 * @param {Uint8Array} keyMaterial
 * @returns {Uint8Array} 32 字节
 */
export function deriveKey(contextStr, keyMaterial) {
	const contextKey = blake3Hash(new TextEncoder().encode(contextStr), IV, DERIVE_KEY_CONTEXT);
	const keyWords = bytesToWords(contextKey, 8);
	return blake3Hash(keyMaterial, keyWords, DERIVE_KEY_MATERIAL);
}

export { IV };