/**
 * 连接上下文层：决定「这条转发通道怎么连」，并把结果固化成对象沿调用链传递。
 *
 * 为什么需要这一层：
 *   改造前，relayAddr / enableRelay / nat64Prefix 等 10 个变量
 *   是模块级全局变量，每个请求进来就改写一遍。同一个 Worker isolate 里
 *   两个客户端同时连接、且使用不同的 /relay= 或 /landing= 路径时，
 *   后到的请求会覆盖先到请求的连接配置，导致转发通道连错目标。
 *
 *   现在这些值在请求开始时一次性算出，装进 ctx 对象，
 *   之后只能通过参数传递，不再有任何跨请求共享的可变状态。
 */

import { parseHostPort, parseRelayAddr } from '../common/addr.js';
import { BUILTIN_DEFAULTS } from './config.js';

/**
 * 解析连接模式。优先级：path > env；relay > gateway > landing > nat64。
 *
 * @param {string} path 请求路径，可能携带 /relay= /gateway= /landing= /nat= 参数
 * @param {object} env Worker 的 env 对象
 * @param {object} defaults 代码内置默认值，见 BUILTIN_DEFAULTS
 * @returns {{relayAddr: object, landingAddr: object, nat64Prefix: string, enableRelay: boolean, enableGateway: boolean, enableNat: boolean}}
 */
export function parseDialMode(path, env = {}, defaults = BUILTIN_DEFAULTS) {
	const envRelayAddr = env.SOCKS5 || defaults.relay;
	const envGatewayAddr = env.HTTP || defaults.gateway;
	const envLandingStr = env.LANDING_ADDRESS || defaults.landing;
	let nat64Addr = env.NAT64 || defaults.nat64;

	const hasRelay = path.includes('/socks=');
	const hasGateway = path.match(/\/(https?)=([^/]+)/i); // 不区分 `gateway://` 和 `https://`
	const hasLanding = path.includes('/pyip='); // 支持以逗号隔开的多个值，后面随机选一个
	const hasNat64 = path.includes('/nat='); // 不区分是否有 => "/96" => 自动去掉"/"以及其后面的内容

	let enableRelay = false;
	let enableGateway = false;
	let enableNat = false;
	let landingAddr = { hostname: null, port: 443 };
	let upstreamAddr = {};

	if (hasRelay) {
		upstreamAddr = parseRelayAddr(path.split('/socks=')[1]);
		enableRelay = true;
	} else if (hasGateway) {
		upstreamAddr = parseRelayAddr(hasGateway[2]);
		enableGateway = true;
	} else if (hasLanding) {
		let landingAddrRaw = path.split('/pyip=')[1];
		let arr = landingAddrRaw.split(',');
		let randomIndex = Math.floor(Math.random() * arr.length);
		let chosenAddr = arr[randomIndex].trim();
		landingAddr = parseHostPort(chosenAddr);
	} else if (hasNat64) {
		nat64Addr = path.split('/nat=')[1];
		enableNat = true; // 从path中传入该参数，就强制开启nat64
	} else if (envRelayAddr) {
		upstreamAddr = parseRelayAddr(envRelayAddr);
		enableRelay = true;
	} else if (envGatewayAddr) {
		upstreamAddr = parseRelayAddr(envGatewayAddr);
		enableGateway = true;
	} else if (envLandingStr) {
		let arr = envLandingStr.split(',');
		let randomIndex = Math.floor(Math.random() * arr.length);
		let chosenAddr = arr[randomIndex].trim();
		landingAddr = parseHostPort(chosenAddr);
	}
	let nat64Prefix = nat64Addr.split('/')[0];

	// 注意：upstreamAddr 装的是 relay 还是 gateway 地址，取决于 enableRelay / enableGateway
	return {
		upstreamAddr,
		landingAddr,
		nat64Prefix,
		enableRelay,
		enableGateway,
		enableNat,
	};
}

/**
 * 创建一条转发通道的连接上下文。
 * @param {object} runtime 运行期配置，见 resolveRuntimeConfig
 * @param {string} path 请求路径
 * @param {object} env Worker 的 env 对象
 */
export function createConnContext(runtime, path, env = {}) {
	const mode = parseDialMode(path, env);

	return {
		...runtime,
		upstreamAddr: mode.upstreamAddr,
		landingAddr: mode.landingAddr,
		nat64Prefix: mode.nat64Prefix,
		enableRelay: mode.enableRelay,
		enableGateway: mode.enableGateway,
		enableNat: mode.enableNat,
	};
}
