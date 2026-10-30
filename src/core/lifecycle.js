/**
 * 生命周期层：WebSocket ↔ ReadableStream 桥接、空闲/生命周期超时、握手超时。
 *
 * 说明：Cloudflare Workers 的 WebSocket 没有暴露 readable / writable，
 * 只有 send() 与 message 事件，所以这一层只能手写封装（官方没有对应 API）。
 */

import { base64ToArrayBuffer, createCombinedSignal, createTimeoutSignal } from '../common/stream.js';

/**
 * 安全关闭 WebSocket。
 */
export function closeWS(ws, code = 1000, reason = 'Normal Closure') {
	try {
		if (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING) {
			ws.close(code, reason);
		}
	} catch (e) {
		console.error('Failed close WebSocket', e);
	}
}

/**
 * 启动握手超时计时器：超时仍未收到握手头就关闭连接。
 * @returns {Function} 清理函数
 */
export function startHelloTimer({ webSocket, remoteSocketWrapper, timeoutMs = 5_000, log }) {
	let handshakeTimeout = setTimeout(() => {
		if (!remoteSocketWrapper.value) {
			log('🤝 Handshake timeout: no handshake header received, closing WebSocket');
			try {
				if (webSocket.readyState === WebSocket.OPEN) {
					webSocket.close(1008, 'Handshake timeout');
				}
			} catch (e) {
				log('Failed to close WebSocket after timeout', e);
			}
		}
	}, timeoutMs);

	// 提供清理函数
	return () => clearTimeout(handshakeTimeout);
}

/**
 * 空闲超时 + 最大生命周期 + 外部中断，三者合并成一个 AbortSignal。
 *
 * 官方优先：AbortSignal.timeout() 管最大生命周期，AbortSignal.any() 合并信号。
 * 空闲计时器需要按收到的数据重置，官方没有可重置版本，因此这一处保留手写 AbortController。
 *
 * @returns {{signal: AbortSignal, resetIdleTimer: Function, abort: Function}}
 */
export function setupKeepalive({ webSocket, signal, onAbort, idleTimeoutMs = 30_000, maxLifetimeMs = 180_000 }) {
	let idleTimer = null;
	let aborted = false; // 防止多次 abort
	const idleController = new AbortController();

	const doAbort = (reason) => {
		if (aborted) return;
		aborted = true;
		clearTimeout(idleTimer);
		if (reason === 'idle') {
			console.warn(`⏳ Idle for over ${idleTimeoutMs / 1000}s, disconnecting.`);
		} else if (reason === 'lifetime') {
			console.warn(`🛑 Max lifetime of ${maxLifetimeMs / 1000}s reached, disconnecting.`);
		} else {
			console.warn(`🚫 External abort signal, disconnecting.`);
		}
		closeWS(webSocket);
		idleController.abort(reason);
		onAbort?.(reason);
	};

	const resetIdleTimer = () => {
		if (aborted) return;
		clearTimeout(idleTimer);
		idleTimer = setTimeout(() => doAbort('idle'), idleTimeoutMs);
	};

	// 官方 AbortSignal.timeout：最大生命周期
	const lifetimeSignal = createTimeoutSignal(maxLifetimeMs);
	lifetimeSignal.addEventListener?.('abort', () => doAbort('lifetime'));

	// 外部中断信号
	signal?.addEventListener?.('abort', () => doAbort('external'));

	// 启动 idle 定时器
	resetIdleTimer();

	// 官方 AbortSignal.any：把「空闲 + 生命周期 + 外部」合并成一个信号
	const combined = createCombinedSignal([idleController.signal, lifetimeSignal, signal].filter(Boolean));

	return {
		signal: combined, // 供 pipeTo 使用
		resetIdleTimer, // 每次收到数据时要调用
		abort: doAbort, // 可手动提前释放资源
	};
}

/**
 * 把 WebSocket 包装成官方 ReadableStream。
 *
 * earlyDataHeader 里的 base64 内容是客户端在握手阶段捎带的首包，
 * 会被解码成第一个分片投递给下游。
 */
export function makeWSStream(webSocket, earlyDataHeader, log) {
	let canceled = false;

	const stream = new ReadableStream({
		start(controller) {
			webSocket.addEventListener('message', (e) => {
				if (!canceled) controller.enqueue(e.data);
			});
			webSocket.addEventListener('close', () => {
				if (!canceled) controller.close();
				closeWS(webSocket);
			});
			webSocket.addEventListener('error', (err) => {
				log('WebSocket error');
				controller.error(`ReadableStream error: ${err.message}`);
			});

			const { earlyData, error } = base64ToArrayBuffer(earlyDataHeader);
			if (error) controller.error(`Base64 decode error: ${error.message}`);
			else if (earlyData) controller.enqueue(earlyData);
		},

		cancel(reason) {
			if (canceled) return;
			canceled = true;
			log(`ReadableStream canceled: ${reason}`);
			closeWS(webSocket);
		},
	});

	return stream;
}
