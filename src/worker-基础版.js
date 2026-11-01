/**
 * 基础版入口 —— 纯转发通道转发，不提供订阅页面。
 *
 * 这里是 wrangler.toml 中 main 指向的部署入口。
 * 所有实际逻辑都在 src/core/ 下，本文件只负责「组装上下文 + 分发路由」。
 */

import { REDIRECT_LIST, resolveRuntimeConfig } from './core/config.js';
import { createConnContext } from './core/context.js';
import { handleWS } from './core/session.js';
import { isIpAllowed } from './core/handshake.js';

export default {
	async fetch(request, env, ctx) {
		try {
			const runtime = resolveRuntimeConfig(env);

			const url = new URL(request.url);
			const path = url.pathname;
			const upgradeHeader = request.headers.get('Upgrade');

			if (!upgradeHeader || upgradeHeader !== 'websocket') {
				if (path === '/') {
					const randomDomain = REDIRECT_LIST[Math.floor(Math.random() * REDIRECT_LIST.length)];
					return Response.redirect(randomDomain, 301);
				}
				return new Response('404 Not Found!', { status: 404 });
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
