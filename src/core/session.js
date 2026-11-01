/**
 * 会话层：一条 WebSocket 转发通道的完整主流程。
 *
 * 基础版与订阅版共用这一份实现——两者原本是各自复制粘贴的，
 * 现在统一到经过生产验证的「基础版」流程上。
 */

import { pipeSafely } from '../common/stream.js';
import { detectKind, parseNaj0rt, parseS5elv } from './handshake.js';
import { createRequestDecoder, createResponseEncoderFactory, SALT_SIZE } from './ss2022.js';
import { openChannel, pumpDNS } from './relay.js';
import { makeWSStream, closeWS, setupKeepalive, startHelloTimer } from './lifecycle.js';

/**
 * 处理一条 WebSocket 连接。
 * @param {object} ctx 连接上下文
 * @param {Request} request 原始请求
 */
export async function handleWS(ctx, request) {
	const [client, webSocket] = Object.values(new WebSocketPair());
	// 官方 WebSocket.binaryType：显式声明二进制帧类型，兼容日期变化后默认值会变成 blob
	webSocket.binaryType = 'arraybuffer';
	webSocket.accept();

	let address = '';
	let portWithRandomLog = '';

	const log = (info, event) => {
		console.log(`[${address}:${portWithRandomLog}] ${info}`, event || '');
	};

	// 启用超时管理（空闲 / 生命周期由内部合并信号驱动；不存在可触发的“外部中断”来源）
	const { resetIdleTimer, signal } = setupKeepalive({
		webSocket,
		idleTimeoutMs: 20_000, // 20s
		maxLifetimeMs: 180_000, // 180s
		onAbort: (reason) => {
			log?.('🐳 disconnecting reason:', reason);
			closeWS(webSocket);
		},
	});

	const earlyDataHeader = request.headers.get('sec-websocket-protocol') || '';
	const webSocketReadableStream = makeWSStream(webSocket, earlyDataHeader, log);

	let isDns = false;
	let udpStreamWrite = null;
	// 官方 WritableStreamDefaultWriter：复用同一个 writer，避免每个分片都重新加锁/解锁
	let remoteSocketWrapper = { value: null, writer: null };
	// SS2022 请求解密器：一旦识别为 ss 就长期持有，后续分片继续走它解密
	let ssDecoder = null;

	// 启动握手超时
	const clearHandshakeTimer = startHelloTimer({
		webSocket,
		remoteSocketWrapper,
		timeoutMs: 5_000, // 5秒超时握手时间
		log,
	});

	/**
	 * 握手解析完成后的收尾：UDP 旁路 / 建连转发 / 首包剩余数据写入。
	 * @param {object} headerInfo 握手指令解析结果
	 * @param {Uint8Array[]|null} extraPayloads 与握手头同一批到达、需要继续发给远端的普通载荷
	 * @param {{awaitConnect?: boolean}} opts SS2022 需要等建连完成后再补写剩余载荷
	 */
	async function acceptHeader(headerInfo, extraPayloads, { awaitConnect = false } = {}) {
		// 握手成功且握手头收到，清除握手超时限制
		clearHandshakeTimer();

		if (headerInfo?.isUDP && headerInfo?.portRemote != 53) {
			return;
		} else if (headerInfo?.isUDP) {
			const { write } = await pumpDNS(webSocket, headerInfo?.responseHeader, log);
			udpStreamWrite = write;
			udpStreamWrite(headerInfo?.rawClientData);
			return;
		}

		address = headerInfo?.addressRemote;
		portWithRandomLog = `${headerInfo?.portRemote}--${Math.random()} ${headerInfo?.isUDP ? 'udp ' : 'tcp '}`;

		// 不 await：建连要花时间，不能挡住 101 响应。
		// 但必须接住拒绝——否则建连失败会变成未处理的 Promise 拒绝，
		// 客户端只能干等到空闲超时才断开。
		const start = () =>
			openChannel(ctx, remoteSocketWrapper, headerInfo, webSocket, log).catch((err) => {
				log('handleTCPOutbds error', err);
				closeWS(webSocket);
			});

		if (!awaitConnect) return start();

		await start();
		// SS2022：首包可能在握手头之后还带了普通载荷，此时 writer 已就绪，继续补写
		if (extraPayloads?.length) {
			if (!remoteSocketWrapper.writer) remoteSocketWrapper.writer = remoteSocketWrapper.value.writable.getWriter();
			for (const p of extraPayloads) if (p.byteLength) await remoteSocketWrapper.writer.write(p);
		}
	}

	try {
		pipeSafely(
			webSocketReadableStream,
			new WritableStream({
				async write(chunk, controller) {
					// 每次收到数据都重置空闲计时器
					resetIdleTimer();

					if (isDns && udpStreamWrite) {
						return udpStreamWrite(chunk);
					}

					if (remoteSocketWrapper.value) {
						// 官方 WritableStreamDefaultWriter：首次写入时创建并复用
						if (!remoteSocketWrapper.writer) {
							remoteSocketWrapper.writer = remoteSocketWrapper.value.writable.getWriter();
						}
						// SS2022：握手头之后的每个分片都要先解密再转发
						if (ssDecoder) {
							const out = await ssDecoder.feed(chunk);
							if (out.error) return controller.error(`ss2022 decode error: ${out.error}`);
							for (const p of out.payloads) if (p.byteLength) await remoteSocketWrapper.writer.write(p);
							return;
						}
						await remoteSocketWrapper.writer.write(chunk);
						return;
					}

					// ——— 握手阶段：优先尝试 SS2022 ———
					// SS2022 首个字节是随机 salt，无法靠「首字节」识别，改为直接试解密：
					// 能通过 AEAD 认证的才算 ss，否则退回 CLI 协议探测（vless/trojan）。
					// 首帧 ≥ salt(16)+固定头密文(27) 才值得试；一旦解码器已建立，则后续任何分片都继续喂给它。
					const chunkLen = chunk?.byteLength ?? chunk?.length ?? 0;
					const ssCandidate = ssDecoder || (ctx.skc0Lock && chunkLen >= SALT_SIZE + 27);
					if (ssCandidate) {
						if (!ssDecoder) ssDecoder = createRequestDecoder(ctx.ssPsk);
						const out = await ssDecoder.feed(chunk);
						if (out.error) {
							ssDecoder = null; // 认证失败 → 不是 ss
						} else if (out.header) {
							out.header.makeResponseTransform = createResponseEncoderFactory(ctx.ssPsk, ssDecoder.requestSalt);
							return acceptHeader(out.header, out.payloads, { awaitConnect: true });
						} else {
							return; // 已认证但可变头未收全，等后续分片
						}
					}

					let mapCode = detectKind(chunk);
					const parseHandlers = {
						1: [parseS5elv, [chunk, ctx.userID]],
						2: [parseNaj0rt, [chunk, ctx.sha224Password]],
					};
					const entry = parseHandlers[mapCode];
					if (!entry) return log(`Unsupported handshake mapCode: ${mapCode}`);

					const [handlerFn, args] = entry;
					const headerInfo = handlerFn(...args);
					if (!headerInfo || headerInfo?.hasError) return controller.error(`Header parse error: ${headerInfo?.message}`);

					return acceptHeader(headerInfo, null);
				},
				close() {
					log(`webSocketReadableStream is close`);
				},
				abort(reason) {
					log(`webSocketReadableStream is abort`, JSON.stringify(reason));
				},
			}),
			{
				signal, // 用超时控制的 AbortSignal（官方 AbortSignal.any 合并空闲/生命周期/外部信号）
				label: 'ws->remote',
				onError: (err) => log('webSocketReadableStream pipeTo error', err),
			}
		);
	} catch (e) {
		if (e.name === 'AbortError') {
			log('Stream aborted by AbortController, usually due to a timeout or explicit cancellation:', e);
		} else {
			log('Unexpected pipeTo error:', e);
		}
	}

	return new Response(null, { status: 101, webSocket: client });
}
