/**
 * 转发通道层：建立到目标的连接、转发下行数据、UDP(DoH) 旁路。
 *
 * 数据搬运一律走官方 Streams API：
 *   下行 socket → WS 用 pipeThrough().pipeTo()，自动背压；
 *   上行 WS → socket 复用同一个 WritableStreamDefaultWriter，减少加锁开销。
 */

import { connect } from 'cloudflare:sockets';
import { concatBytes, pipeSafely, prependChunk } from '../common/stream.js';
import { dialGateway, resolveDialTarget, dialRelay } from './connector.js';
import { closeWS } from './lifecycle.js';

/**
 * 建立到目标的连接，并把客户端首包剩余数据转发过去。
 *
 * @param {object} ctx 连接上下文
 * @param {{value: object|null, writer: object|null}} remoteSocket 远端连接的持有者
 * @param {object} headerInfo 握手头解析结果
 * @param {WebSocket} webSocket 客户端连接
 * @param {Function} log 日志函数
 */
export async function openChannel(ctx, remoteSocket, headerInfo, webSocket, log) {
	const { addressType, addressRemote, portRemote, rawClientData, responseHeader: vResponseHeader, makeResponseTransform } = headerInfo;

	// 统一返回 { socket, readable }：readable 是官方 ReadableStream，
	// relay / gateway 上游握手阶段多读到的字节会保留在流的开头，不会丢数据。
	async function connectAndWrite(address, port, { relay = false, gateway = false } = {}) {
		let socket, readable;
		if (relay) {
			({ socket, readable } = await dialRelay(ctx, addressType, address, port, log));
		} else if (gateway) {
			({ socket, readable } = await dialGateway(ctx, address, port, log));
		} else {
			socket = connect({ hostname: address, port });
			readable = socket.readable;
		}
		log(`connected to ${address}:${port}`);
		if (remoteSocket.writer) {
			try {
				remoteSocket.writer.releaseLock();
			} catch {
				/* 旧连接已关闭，忽略 */
			}
			remoteSocket.writer = null;
		}
		remoteSocket.value = socket;
		const writer = socket.writable.getWriter();
		// 立刻把 writer 挂到 wrapper 上：上行链路随后到达的分片会复用同一个 writer。
		// 否则上行会对同一个 stream 再次 getWriter()，撞上 "stream is currently locked"，
		// 管道报错、转发通道直接断掉（客户端把握手头和首段载荷拆成两条 WS 消息时就会发生）。
		remoteSocket.writer = writer;
		await writer.write(rawClientData);
		return { socket, readable };
	}

	async function retry() {
		let opt = ctx.enableRelay ? { relay: true } : ctx.enableGateway ? { gateway: true } : {};
		let target = { address: addressRemote, port: portRemote };
		if (!ctx.enableRelay && !ctx.enableGateway) {
			target = await resolveDialTarget(ctx, addressRemote, portRemote);
		}
		const { socket, readable } = await connectAndWrite(target.address, target.port, opt);
		socket.closed.catch((error) => log('retry tcpSocket closed error', error)).finally(() => closeWS(webSocket));
		pumpToClient(readable, webSocket, vResponseHeader, null, log, null, makeResponseTransform);
	}

	const { socket, readable } = await connectAndWrite(addressRemote, portRemote);

	// CLOSE_WS_ON_SOCKET_CLOSE（默认关闭）：远端 TCP 先断开时是否立刻关掉 WS。
	//   关闭：worker 不关 WS，客户端要等空闲超时（20s）才发现通道已断，表现为「假死」；
	//   打开：远端一断开即立刻关 WS，缩短断开感知延迟（适合移动端切网、目标重启、上游被墙等），
	//        代价是客户端会收到关闭帧，且 retry 另建连接时会先被打断。
	//   客户端先断开时两种状态收尾行为一致。
	// 打开方式：wrangler.toml 设 CLOSE_WS_ON_SOCKET_CLOSE = "1"（'1'/'true'/'yes'/'on'）。
	pumpToClient(readable, webSocket, vResponseHeader, retry, log, ctx.closeWSOnSocketClosed ? socket.closed : null, makeResponseTransform);
}

/**
 * 下行：把远端 socket 的数据写回 WebSocket。
 *
 * @param {ReadableStream} readable 远端数据流
 * @param {WebSocket} webSocket 客户端连接
 * @param {Uint8Array|null} vRspnHeader 握手响应头，会拼在第一个分片前面
 * @param {Function|null} retry 一条数据都没收到时的重试回调
 * @param {Function} log 日志函数
 * @param {Promise|null} socketClosed 远端连接关闭信号，用于「断开立刻关 WS」
 */
export async function pumpToClient(readable, webSocket, vRspnHeader = null, retry, log, socketClosed = null, makeResponseTransform = null) {
	let hasData = false;

	// SS2022：整条下行流都要经 AEAD 加密后再写回客户端；
	// 其它格式沿用「把握手响应头拼在首个分片前面」的做法。
	let source = readable;
	if (typeof makeResponseTransform === 'function') {
		source = readable.pipeThrough(makeResponseTransform());
	} else if (vRspnHeader instanceof Uint8Array && vRspnHeader.byteLength) {
		source = prependChunk(vRspnHeader, readable);
	}

	// 官方 WritableStream：把转发数据写回 WebSocket
	const writer = new WritableStream({
		write(chunk) {
			if (webSocket.readyState !== WebSocket.OPEN) throw new Error('WebSocket not open');
			webSocket.send(chunk);
			hasData = true;
		},
		abort(reason) {
			console.error('WritableStream aborted:', reason);
		},
	});
	await pipeSafely(source, writer, {
		label: 'remote->ws',
		onError: (e) => {
			console.error('pipeTo error in remoteSocketToWS:', e);
			closeWS(webSocket);
		},
	});

	// 可选增强：远端 TCP 主动断开时，立刻关闭 WebSocket（默认关闭）
	// 只在「转发通道已经跑起来（有数据）」时才关：连接刚建立就没数据，说明下面要走 retry()
	// 换地址重连，此时把 WS 关掉会把重试一起打断。
	if (socketClosed && hasData) {
		socketClosed
			.catch((error) => log('tcpSocket closed error', error))
			.finally(() => closeWS(webSocket));
	}

	if (!hasData && typeof retry === 'function') retry();
}

/**
 * UDP 旁路：把客户端的 DNS 查询转发到 DoH（1.1.1.1），结果回传。
 * @param {WebSocket} webSocket 客户端连接
 * @param {Uint8Array} vResponseHeader 握手响应头
 * @param {Function} log 日志函数
 */
export async function pumpDNS(webSocket, vResponseHeader, log) {
	let isS5elvHeaderSent = false;
	// 跨分片残包缓冲：一个 UDP 帧可能被切在两个分片之间，必须攒着等下个分片补齐，
	// 否则会出现「半截帧被当完整帧发出去」或「残包被直接丢弃」两种错误。
	let frameBuffer = new Uint8Array(0);
	const transformStream = new TransformStream({
		transform(chunk, controller) {
			// chunk 可能是 ArrayBuffer 也可能是 Uint8Array（取决于握手格式解析器给出的 rawClientData 类型），
			// 统一成 Uint8Array 视图再分帧；直接对 Uint8Array 调 new DataView() 会抛 TypeError。
			const view = chunk instanceof Uint8Array ? chunk : new Uint8Array(chunk);
			const buf = frameBuffer.byteLength ? concatBytes(frameBuffer, view) : view;
			frameBuffer = new Uint8Array(0);
			let index = 0;
			while (index + 2 <= buf.byteLength) {
				const udpPakcetLength = (buf[index] << 8) | buf[index + 1];
				if (index + 2 + udpPakcetLength > buf.byteLength) break; // 帧体不完整，留待下个分片
				controller.enqueue(buf.slice(index + 2, index + 2 + udpPakcetLength));
				index += 2 + udpPakcetLength;
			}
			if (index < buf.byteLength) frameBuffer = buf.slice(index); // 保留残包
		},
		flush() {
			// 流结束时仍有残包，说明帧不完整、无法补齐，丢弃（DNS over UDP 以单帧为单位）
			frameBuffer = new Uint8Array(0);
		},
	});

	pipeSafely(
		transformStream.readable,
		new WritableStream({
			async write(chunk) {
				const resp = await fetch('https://1.1.1.1/dns-query', { method: 'POST', headers: { 'content-type': 'application/dns-message' }, body: chunk });
				const dnsQueryResult = await resp.arrayBuffer();
				const udpSize = dnsQueryResult.byteLength;
				const udpSizeBuffer = new Uint8Array([(udpSize >> 8) & 0xff, udpSize & 0xff]);
				if (webSocket.readyState === WebSocket.OPEN) {
					log(`doh success and dns message length is ${udpSize}`);
					const dnsBytes = new Uint8Array(dnsQueryResult);
					if (isS5elvHeaderSent) {
						webSocket.send(concatBytes(udpSizeBuffer, dnsBytes));
					} else {
						webSocket.send(concatBytes(vResponseHeader, udpSizeBuffer, dnsBytes));
						isS5elvHeaderSent = true;
					}
				}
			},
		}),
		{
			label: 'doh',
			onError: (error) => log('dns udp has error' + error),
		}
	);
	const writer = transformStream.writable.getWriter();

	return {
		write(chunk) {
			// 写入失败（例如分帧出错）会产生 Promise 拒绝，这里必须接住，
			// 否则会变成未处理的 Promise 拒绝，把整个 Worker 请求带崩。
			writer.write(chunk).catch((err) => log('dns udp write error', err));
		},
	};
}
