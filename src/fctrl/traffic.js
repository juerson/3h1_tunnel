/**
 * 流控帧层：一种「握手期按块填充、完成后再透传」的链路控制。
 *
 * 目标格式（与某主流实现的流控格式一致）：
 *   首块： [uuid(16)] [command(1)] [contentLen(2,BE)] [paddingLen(2,BE)] [content] [padding]
 *   后续：           [command(1)] [contentLen(2,BE)] [paddingLen(2,BE)] [content] [padding]
 *
 *   command: 0=继续填充 1=结束填充 2=结束并直通
 *   uuid 只出现在整条链路的「第一块」里，用于接收端识别并进入该模式；
 *   识别不到 uuid 时按原样透传，从而同时兼容未启用流控的普通链路。
 *
 * 本文件只做纯字节变换与状态推进，不碰网络。工作线程侧（服务端）只用两个方向：
 *   - 上行（客户端 → 工作线程）: unpadding（去掉填充、还原真实数据）
 *   - 下行（目标 → 工作线程）: padding（给真实数据补填充）
 */

import { concatBytes } from '../common/stream.js';

/** 缓冲区尺寸，与主流实现保持一致（影响单块填充上限）。 */
const SIZE = 8192;

/** TLS 记录/握手的特征前缀。 */
const TLS_HEAD = [0x16, 0x03, 0x03];
const TLS_HEAD_CLIENT = [0x16, 0x03];
const TLS_APP = [0x17, 0x03, 0x03];
const TLS13_SIGN = [0x00, 0x2b, 0x00, 0x02, 0x03, 0x04];
const HS_CLIENT_HELLO = 0x01;
const HS_SERVER_HELLO = 0x02;

export const CMD_CONTINUE = 0x00;
export const CMD_END = 0x01;
export const CMD_DIRECT = 0x02;

/** 填充长度种子，与主流实现一致。 */
const SEED = [900, 500, 900, 256];

const TLS13_SUITE = new Set([0x1301, 0x1302, 0x1303, 0x1304, 0x1305]);
/**
 * 参考实现（sing-vmess 的 constant.go + vision.go）只排除
 * TLS_AES_128_CCM_8_SHA256(0x1305)，其余 TLS1.3 套件都算「可 XTLS 直通」。
 *
 * 注意：之前这里写的是 0x1301(AES_128_GCM)，Chrome 默认就协商 0x1301，
 * 于是服务端把 enableXtls 误判成 false，与客户端的判定相反（日志里 tls13=false）。
 */
const TLS13_EXCLUDE = 0x1305;

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

/** 调试用：把字节转成 hex（默认最多 n 字节）。 */
function hex(bytes, n) {
	if (!bytes) return '';
	const len = Math.min(n ?? bytes.byteLength, bytes.byteLength);
	let s = '';
	for (let i = 0; i < len; i++) s += bytes[i].toString(16).padStart(2, '0');
	return s;
}

/**
 * 创建一条链路的流控状态。
 * @param {Uint8Array} userUUID 16 字节用户标识（与入口 uuid 同源）
 */
export function createTrafficState(userUUID) {
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
		wIsPadding: false, // 未确认流控前置为 false，保证普通链路透传
		writeOnceUUID: uuid.slice(), // 下行第一块要带 uuid，写一次后清空
	};
}

/** 识别并推进 TLS 特征（用于判断何时可以结束填充）。 */
export function filterTLS(state, buffers) {
	for (const b of buffers) {
		if (!b) continue;
		state.numberOfPacketToFilter--;
		if (b.byteLength >= 6) {
			if (startsWith(b, TLS_HEAD, 3) && b[5] === HS_SERVER_HELLO) {
				state.remainingServerHello = ((b[3] << 8) | b[4]) + 5;
				state.isTLS12orAbove = true;
				state.isTLS = true;
				if (b.byteLength >= 79 && state.remainingServerHello >= 79) {
					const sidLen = b[43];
					const cs = 43 + sidLen + 1;
					state.cipher = (b[cs] << 8) | b[cs + 1];
				}
			} else if (startsWith(b, TLS_HEAD_CLIENT, 2) && b[5] === HS_CLIENT_HELLO) {
				state.isTLS = true;
			}
		}
		if (state.remainingServerHello > 0) {
			const end = Math.min(state.remainingServerHello, b.byteLength);
			// 只扣掉「真正检查过的那一段」，否则 ServerHello 跨分片时会算出负数，
			// 导致后面再也无法识别 TLS1.3（参考实现：remainingServerHello -= end）。
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

/**
 * 判断一个分片是否「以 TLS 应用数据记录开头」。
 *
 * 对齐参考实现 sing-vmess vision.go 的判定：
 *   c.isTLS && buffer.Len() > 6 && bytes.Equal(tlsApplicationDataStart, buffer.To(3))
 * 参考实现只看「首条记录的类型」，不要求整块都是完整记录；
 * 之前的 isCompleteRecord() 额外要求整块都是完整应用数据记录，
 * 会让「应用数据被切成半块」时迟迟不结束填充阶段。
 */
function isTLSAppRecord(b) {
	return b.byteLength > 6 && startsWith(b, TLS_APP, 3);
}

/**
 * 生成一个填充块。
 * @param {Uint8Array|null} content 真实内容
 * @param {number} command 命令字
 * @param {object} state 链路状态（writeOnceUUID 会在首块后清空）
 * @param {boolean} longPadding 是否使用长填充
 */
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

	const head = new Uint8Array([command, (contentLen >> 8) & 0xff, contentLen & 0xff, (paddingLen >> 8) & 0xff, paddingLen & 0xff]);
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

/**
 * 下行（服务端 → 客户端）按需填充。
 *
 * 严格对齐参考实现 sing-vmess vision.go 的 VisionConn.Write：
 *   - 逐块判断，**遇到第一个「以 TLS 应用数据记录开头」的分片就收尾**，
 *     该块用 End 命令结束填充，其后的分片原样透传（不再生成任何帧）；
 *   - 未识别到 TLS1.2+ 且过滤计数快用完时，同样用 End 收尾。
 *
 * 【为什么不发 Direct(2)】
 *   参考实现启用 XTLS 时会发 Direct 并切换到 splice 直写；
 *   工作线程夹在中间、没有 TLS 连接可 splice，发 Direct 对端也会切到
 *   direct 读取模式。此时「End + 后续原样透传」与「Direct + 后续原样透传」
 *   在客户端侧完全等价（见 vision.go 里 currentCommand==End / ==Direct 两个分支），
 *   所以这里一律发 End。
 *
 * @returns {Uint8Array[]} 待写出的分片
 */
export function padBuffers(state, buffers) {
	const list = buffers.filter(Boolean);
	if (!list.length) return [];
	const out = [];
	const longPadding = state.isTLS;

	for (let i = 0; i < list.length; i++) {
		const b = list[i];
		if (state.isTLS && isTLSAppRecord(b)) {
			// 首个应用数据分片：结束填充，其后的分片原样透传
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

/**
 * 上行（客户端 → 服务端）解填充。跨分片累积，直到出现完整块边界。
 * 未识别到 uuid 时原样透传；识别后按块还原。
 * @returns {{payloads: Uint8Array[], error: string|null}}
 */
export function createUpReader(state, log = () => {}) {
	let pending = new Uint8Array(0);
	let decided = false;
	let isFlow = false;
	let paddingDone = false; // 填充阶段结束后，后续上行一律原样透传

	async function feed(chunk) {
		const view = toU8(chunk);
		if (view.byteLength) pending = concatBytes(pending, view);
		const payloads = [];

		try {
			if (!decided) {
				// 首块至少要能放下 uuid(16)+命令头(5)
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

			// 填充阶段已结束：后续数据是明文，直接透传，绝不能再按块解析
			if (paddingDone) {
				if (pending.byteLength) {
					payloads.push(pending);
					pending = new Uint8Array(0);
				}
				if (state.numberOfPacketToFilter > 0 && payloads.length) filterTLS(state, payloads);
				if (payloads.length) log(`up passthrough: [${payloads.map((p) => p.byteLength).join(',')}]B first=${hex(payloads[0], 16)}`);
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
						paddingDone = true; // 后续上行不再解填充
						break;
					}
				}
			}
		} catch (e) {
			return { payloads, error: e?.message || String(e) };
		}

		if (payloads.length) log(`up out: [${payloads.map((p) => p.byteLength).join(',')}]B first=${hex(payloads[0], 16)}`);

		// 识别真实 TLS 特征（与下行共用同一计数器）
		if (state.numberOfPacketToFilter > 0 && payloads.length) {
			filterTLS(state, payloads);
		}
		return { payloads, error: null };
	}

	return { feed };
}

/**
 * 下行方向：返回 TransformStream 工厂，供转发管道对每个分片做填充。
 * 首片前面会拼上入口响应头（version=0 + addonsLen=0）。
 *
 * @param {object} state 链路状态
 * @param {Function} log 调试日志
 * @param {Function|null} onActivity 每收到一块下行数据时回调（用来重置空闲计时器）
 */
export function createDownWriter(state, log = () => {}, onActivity = null) {
	return function makeTransform() {
		let headerSent = false;
		let n = 0;
		return new TransformStream({
			transform(chunk, controller) {
				const view = toU8(chunk);
				if (!view.byteLength) return;
				n++;
				// 下行有数据流动，说明链路是活的 —— 空闲计时器必须一起重置，
				// 否则「目标正在回数据、客户端暂时没说话」时会被误判为空闲而掐断。
				onActivity?.();
				const mb = [view];
				if (state.numberOfPacketToFilter > 0) filterTLS(state, mb);
				const out = state.flowStarted && state.wIsPadding ? padBuffers(state, mb) : mb.filter(Boolean);
				const seq = headerSent ? out : [new Uint8Array([0, 0]), ...out];
				headerSent = true;
				if (n <= 12) {
					log(`down #${n}: in=${view.byteLength}B out=[${out.map((p) => p.byteLength).join(',')}] flowStarted=${state.flowStarted} wIsPadding=${state.wIsPadding} isTLS=${state.isTLS} tls13=${state.enableXtls} npf=${state.numberOfPacketToFilter} head=${hex(view, 6)}`);
				}
				for (const p of seq) if (p && p.byteLength) controller.enqueue(p);
			},
		});
	};
}