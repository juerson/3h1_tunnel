/**
 * 流控版运行期配置：只保留流控链路真正用得到的字段。
 *
 * 与 src/core/config.js 的 resolveRuntimeConfig 是「同一目标、不同实现」：
 *   1. 流控链路只走 S5elv + WebSocket，不涉及 SS2022 / 摘要校验，
 *      因此不再派生 ssPsk、sha224Password，也不再解析 SS IP 白名单；
 *   2. 连接模式参数（relay / gateway / landing / nat64）仍由 core/context.js
 *      与 core/connector.js 从 core/config.js 的 BUILTIN_DEFAULTS 读取，功能一字不减；
 *   3. 所有值仍然每次请求现场计算，不引入任何模块级可变状态。
 *
 * 依赖 core/config.js 的常量与 parseBoolEnv，但不调用其 resolveRuntimeConfig，
 * 从而让派生 SS2022 密钥 / 摘要的整条依赖（blake3、sha224）在打包时被裁剪掉。
 */

import { BUILTIN_DEFAULTS, parseBoolEnv } from '../core/config.js';

/**
 * 计算流控版请求的运行期配置。
 * @param {object} env Worker 的 env 对象
 */
export function resolveFlowRuntimeConfig(env = {}) {
	// S5elv 条目的 uuid：env.UUID4 优先，缺省用内置值
	const userID = env.UUID4 || BUILTIN_DEFAULTS.userID;

	// 流控模式（env.FLOW）：
	//   auto  （默认）—— 兼容：flow:"" 与 flow:"xtls-rprx-vision" 都接受，按客户端实际数据自适应；
	//   none          —— 仅接受 flow:""（普通模式）；客户端若声明 vision 则直接拒绝；
	//   vision        —— 仅接受 flow:"xtls-rprx-vision"；客户端若 flow 为空则直接拒绝。
	// 兼容简写值：off/false/0 => none；on/true/1 => vision；其它未知值 => auto。
	let flowMode = String(env.FLOW || 'auto').toLowerCase();
	if (flowMode === 'off' || flowMode === 'false' || flowMode === '0' || flowMode === 'none') {
		flowMode = 'none';
	} else if (flowMode === 'vision' || flowMode === 'on' || flowMode === 'true' || flowMode === '1') {
		flowMode = 'vision';
	} else {
		flowMode = 'auto';
	}

	return {
		userID,
		flowMode,
		// 远端 TCP 主动断开时是否立刻关闭 WebSocket（默认关闭）
		closeWSOnSocketClosed: parseBoolEnv(env.CLOSE_WS_ON_SOCKET_CLOSE, false),
	};
}