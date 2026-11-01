/**
 * 订阅版入口 —— 在基础版的转发通道能力之上，额外提供 /config 与 /sub 订阅页面。
 *
 * 转发通道逻辑与基础版共用 src/core/ 下的同一份实现；
 * 两个版本此前是各自复制粘贴的，现在只有配置与路由分发不同。
 */

import { DEFAULTS, DEFAULT_MAX_ITEM_MAP, extractGroupedEnv, extractUrlParams, resolveRuntimeConfig } from './core/config.js';
import { createConnContext } from './core/context.js';
import { handleWS } from './core/session.js';
import { isIpAllowed } from './core/handshake.js';
import { handleRoute } from './subscription/route.js';

export default {
	async fetch(request, env, ctx) {
		try {
			const runtime = resolveRuntimeConfig(env);

			const url = new URL(request.url);
			const path = url.pathname;
			const upgradeHeader = request.headers.get('Upgrade');

			if (!upgradeHeader || upgradeHeader !== 'websocket') {
				const config = {
					env: extractGroupedEnv(env, DEFAULTS),
					query: extractUrlParams(url, DEFAULT_MAX_ITEM_MAP),
					subParameter: {
						// S5elv条目的userID => uuid
						uuid: runtime.userID,
						// Naj0rt条目的密码
						password: runtime.password,
						// 是否支持ss握手格式，不支持就不要生成订阅
						onSkc0: runtime.skc0Lock,
					},
				};
				return await handleRoute(path, config, DEFAULT_MAX_ITEM_MAP);
			}

			// WS 入口白名单：未设置即全放行，设置了就只放行白名单内的来源 IP
			if (!isIpAllowed(request, runtime.wsAllowedRules)) {
				return new Response('Forbidden', { status: 403 });
			}

			// 连接上下文按请求创建，后续整条链路只通过参数传递，不再有全局状态
			const connection = createConnContext(runtime, path, env);
			return await handleWS(connection, request);
		} catch (err) {
			return new Response(err.toString());
		}
	},
};
