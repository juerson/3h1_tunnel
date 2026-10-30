/**
 * 流控版会话层：一条 WebSocket 转发通道的完整主流程（带链路流控）。
 *
 * 与 src/core/session.js 的差别（同协议、不同写法，故另写一份，不改原文件）：
 *   1. 首包改为解析带 addons 的入口头（flow 字段）；
 *   2. 上行分片先经 unpadding 还原真实数据再写目标；
 *   3. 下行经 padding 后再回写客户端。
 * 其余桥接、超时、建连、转发一律复用 core 里已验证的实现。
 */

import { concatBytes, pipeSafely } from '../common/stream.js';
import { openChannel } from '../core/relay.js';
import { makeWSStream, closeWS, setupKeepalive, startHelloTimer } from '../core/lifecycle.js';
import { createTrafficState, createUpReader, createDownWriter } from './traffic.js';
import { parseEntry, uuidToBytes } from './entry.js';

/** 调试开关：定位问题期间保持 true，稳定后可改 false 以关闭逐帧日志。 */
const FLOW_DEBUG = false;
/** 每个分片/下行最多打印多少条，避免刷屏。 */
const DEBUG_MAX = 12;

function toU8(x) {
	return x instanceof Uint8Array ? x : new Uint8Array(x);
}

function hexHead(bytes, n) {
	if (!bytes) return '';
	const len = Math.min(n ?? bytes.byteLength, bytes.byteLength);
	let s = '';
	for (let i = 0; i < len; i++) s += bytes[i].toString(16).padStart(2, '0');
	return s;
}

/**
 * 处理一条 WebSocket 连接。
 * @param {object} ctx 连接上下文
 * @param {Request} request 原始请求
 */
export async function handleWS(ctx, request) {
	const [client, webSocket] = Object.values(new WebSocketPair());
	webSocket.binaryType = 'arraybuffer';
	webSocket.accept();

	let address = '';
	let portWithRandomLog = '';
	const log = (info, event) => {
		console.log(`[${address}:${portWithRandomLog}] ${info}`, event || '');
	};
	const dbg = (...args) => {
		if (FLOW_DEBUG) console.log('[flow]', ...args);
	};

	const { resetIdleTimer, signal } = setupKeepalive({
		webSocket,
		idleTimeoutMs: 20_000,
		maxLifetimeMs: 180_000,
		onAbort: (reason) => {
			log('disconnecting reason:', reason);
			dbg('keepalive abort:', reason);
			closeWS(webSocket);
		},
	});

	const earlyDataHeader = request.headers.get('sec-websocket-protocol') || '';
	const webSocketReadableStream = makeWSStream(webSocket, earlyDataHeader, log);


	const remoteSocketWrapper = { value: null, writer: null };

	let trafficState = null;
	let upReader = null;
	let hsBuf = new Uint8Array(0);
	let handshakeDone = false;
	let frameNo = 0;

	const clearHandshakeTimer = startHelloTimer({ webSocket, remoteSocketWrapper, timeoutMs: 5_000, log });
	const uuidBytes = uuidToBytes(ctx.userID);

	// 服务端流控模式：auto=兼容(自适应) | none=仅普通 | vision=仅 vision
	const flowMode = ctx.flowMode || 'auto';
	// none 模式不启用流控（纯透传）；auto / vision 均启用流控；vision 模式还会额外校验入口 flow
	const useFlow = flowMode !== 'none';
	dbg('flow mode=', flowMode, 'useFlow=', useFlow);

	dbg('session start: path=', new URL(request.url).pathname, 'expectedUUID=', hexHead(uuidBytes, 16), 'earlyDataHeaderLen=', earlyDataHeader.length);

	async function acceptHeader(headerInfo, extraPayloads, { awaitConnect = false } = {}) {
		clearHandshakeTimer();

		if (headerInfo?.isUDP) {
			// 本版只处理 TCP；UDP 请求（含 DoH 旁路）一律丢弃。
			dbg('acceptHeader: UDP 请求，直接丢弃');
			return;
		}

		address = headerInfo?.addressRemote;
		portWithRandomLog = `${headerInfo?.portRemote}--${Math.random()} tcp `;
		dbg(`acceptHeader: TCP target=${address}:${headerInfo?.portRemote} rawClientData=${headerInfo?.rawClientData?.byteLength ?? 0}B extra=${extraPayloads?.length ?? 0}`);

		const start = () =>
			openChannel(ctx, remoteSocketWrapper, headerInfo, webSocket, log).catch((err) => {
				log('handleTCPOutbds error', err);
				dbg('openChannel failed:', err?.message || String(err));
				closeWS(webSocket);
			});

		if (!awaitConnect) return start();

		await start();
		dbg('openChannel ready, writer=', !!remoteSocketWrapper.writer);
		const sock = remoteSocketWrapper.value;
		if (sock?.closed) {
			sock.closed
				.catch((e) => dbg('target sock closed with error:', e?.message || String(e)))
				.finally(() => dbg('target sock closed'));
		}
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
					resetIdleTimer();


					// ——— 握手之后：上行分片继续走 unpadding ———
					if (handshakeDone) {
						const view = toU8(chunk);
						frameNo++;
						if (frameNo <= DEBUG_MAX) dbg(`#${frameNo} in=${view.byteLength}B (post-handshake) head=${hexHead(view, 16)}`);
						if (!useFlow) {
							// 流控关闭（mode=none）：后续上行分片原样透传
							const w = remoteSocketWrapper.writer;
							if (w && view.byteLength) await w.write(view);
							return;
						}
						const out = await upReader.feed(view);
						if (out.error) {
							dbg('up feed error:', out.error);
							return controller.error(`flow decode error: ${out.error}`);
						}
						const writer = remoteSocketWrapper.writer;
						if (writer) {
							for (const p of out.payloads) if (p.byteLength) await writer.write(p);
						} else {
							dbg('post-handshake chunk dropped: writer 未就绪');
						}
						return;
					}

					// ——— 握手阶段：累积并解析入口头 ———
					const view = toU8(chunk);
					frameNo++;
					if (frameNo <= DEBUG_MAX) dbg(`#${frameNo} in=${view.byteLength}B (handshake) head=${hexHead(view, 32)}`);
					hsBuf = concatBytes(hsBuf, view);
					const parsed = parseEntry(hsBuf, uuidBytes);
					if (parsed.status === 'need_more') {
						dbg(`entry need_more: have=${hsBuf.byteLength}B`);
						if (hsBuf.byteLength > 65_536) return controller.error('entry header too long');
						return;
					}
					if (parsed.status === 'error') {
						dbg('entry parse error:', parsed.message, 'bufHead=', hexHead(hsBuf, 32));
						return controller.error(`entry parse error: ${parsed.message}`);
					}

					dbg(`entry ok: flow="${parsed.flow}" proto=${parsed.isUDP ? 'udp' : 'tcp'} target=${parsed.addressRemote}:${parsed.portRemote} body=${parsed.body.byteLength}B bodyHead=${hexHead(parsed.body, 32)}`);

					// 按服务端模式校验客户端声明的 flow
					if (flowMode === 'none' && parsed.flow) {
						dbg(`mode=none: 客户端声明 flow="${parsed.flow}"，拒绝`);
						return controller.error(`server mode=none: flow must be empty, got "${parsed.flow}"`);
					}
					if (flowMode === 'vision' && parsed.flow !== 'xtls-rprx-vision') {
						dbg(`mode=vision: 客户端 flow="${parsed.flow}"，拒绝`);
						return controller.error(`server mode=vision: flow must be "xtls-rprx-vision"`);
					}

					handshakeDone = true;

					let rawClientData;
					let extraPayloads = [];
					let makeResponseTransform;
					if (useFlow) {
						trafficState = createTrafficState(uuidBytes);
						upReader = createUpReader(trafficState, dbg);
						const out = await upReader.feed(parsed.body);
						if (out.error) {
							dbg('up feed error:', out.error);
							return controller.error(`flow decode error: ${out.error}`);
						}
						extraPayloads = out.payloads.slice();
						rawClientData = extraPayloads.length ? extraPayloads.shift() : new Uint8Array(0);
						makeResponseTransform = createDownWriter(trafficState, dbg, resetIdleTimer);
						dbg(`handshake done: flowStarted=${trafficState.flowStarted} rawClientData=${rawClientData.byteLength}B extra=${extraPayloads.length}`);
					} else {
						// 流控关闭（mode=none）：整段入口 body 原样透传（等同基础版）
						rawClientData = parsed.body;
						dbg(`handshake done(none mode): passthrough rawClientData=${rawClientData.byteLength}B`);
					}

					const headerInfo = {
						hasError: false,
						addressRemote: parsed.addressRemote,
						portRemote: parsed.portRemote,
						addressType: parsed.addressType,
						rawClientData,
						responseHeader: new Uint8Array([0, 0]),
						isUDP: parsed.isUDP,
						makeResponseTransform,
					};
					return acceptHeader(headerInfo, extraPayloads, { awaitConnect: true });
				},
				close() {
					log(`webSocketReadableStream is close`);
					dbg(`ws readable close: frameNo=${frameNo} handshakeDone=${handshakeDone} flowStarted=${trafficState?.flowStarted ?? false}`);
				},
				abort(reason) {
					log(`webSocketReadableStream is abort`, JSON.stringify(reason));
					dbg(`ws readable abort: frameNo=${frameNo} reason=${JSON.stringify(reason)}`);
				},
			}),
			{
				signal,
				label: 'ws->remote',
				onError: (err) => {
					log('webSocketReadableStream pipeTo error', err);
					dbg('pipeTo error:', err?.message || String(err));
				},
			}
		);
	} catch (e) {
		if (e.name === 'AbortError') {
			log('Stream aborted by AbortController, usually due to a timeout or explicit cancellation:', e);
			dbg('stream aborted:', e?.message || String(e));
		} else {
			log('Unexpected pipeTo error:', e);
			dbg('unexpected error:', e?.message || String(e));
		}
	}

	return new Response(null, { status: 101, webSocket: client });
}