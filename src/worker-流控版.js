/**
 * 流控版入口 —— 在基础版的转发通道能力之上，为 WebSocket 链路启用「握手期填充」流控。
 *
 * 所有实际逻辑集中在 src/fctrl/ 下（会话、入口解析、流控帧），
 * 本文件只负责「组装上下文 + 分发路由」，与基础版/订阅版保持同一形态。
 */

import { REDIRECT_LIST } from './core/config.js';
import { resolveFlowRuntimeConfig } from './fctrl/runtime.js';
import { createConnContext } from './core/context.js';
import { handleWS } from './fctrl/session.js';

export default {
	async fetch(request, env, ctx) {
		try {
			const runtime = resolveFlowRuntimeConfig(env);

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

			const connection = createConnContext(runtime, path, env);
			return await handleWS(connection, request);
		} catch (err) {
			return new Response(err.toString());
		}
	},
};