/**
 * 官方 Streams API 优先，运行时不支持时回退到手写实现。
 *
 * 对应 Cloudflare 官方文档 Workers → Runtime APIs → Streams 的 6 个条目：
 *   1. ReadableStream
 *   2. ReadableStream BYOBReader
 *   3. ReadableStream DefaultReader
 *   4. TransformStream
 *   5. WritableStream
 *   6. WritableStream DefaultWriter
 *
 * 另外用到的官方能力：AbortSignal.timeout() / AbortSignal.any()、Uint8Array.fromBase64()、WebSocket.binaryType。
 *
 * 重要说明：Workers 运行时目前没有官方的「WebSocket → ReadableStream」桥接接口
 * （不存在 webSocketStream 之类的 API，cloudflare:sockets 只导出 connect），
 * 所以 WebSocket 侧的流包装仍然只能手写，这一层已集中在本文件之外的调用方处理。
 */

// ——————————————————————— 官方能力探测 ———————————————————————
export const officialSupport = {
	readableStream: typeof ReadableStream !== 'undefined',
	transformStream: typeof TransformStream !== 'undefined',
	writableStream: typeof WritableStream !== 'undefined',
	textDecoderStream: typeof TextDecoderStream !== 'undefined',
	textEncoderStream: typeof TextEncoderStream !== 'undefined',
	abortSignalTimeout: typeof AbortSignal !== 'undefined' && typeof AbortSignal.timeout === 'function',
	abortSignalAny: typeof AbortSignal !== 'undefined' && typeof AbortSignal.any === 'function',
	uint8FromBase64: typeof Uint8Array !== 'undefined' && typeof Uint8Array.fromBase64 === 'function',
};

// ——————————————————————— 字节工具 ———————————————————————
/**
 * 合并多个 Uint8Array（官方 TypedArray API，等价于手写拼接）。
 */
export function concatBytes(...chunks) {
	let total = 0;
	for (const chunk of chunks) {
		if (chunk) total += chunk.byteLength;
	}
	const out = new Uint8Array(total);
	let offset = 0;
	for (const chunk of chunks) {
		if (!chunk) continue;
		out.set(chunk, offset);
		offset += chunk.byteLength;
	}
	return out;
}

// ——————————————————————— 官方优先：AbortSignal ———————————————————————
/**
 * 官方 AbortSignal.timeout()；不可用时手写兜底。
 */
export function createTimeoutSignal(ms) {
	if (officialSupport.abortSignalTimeout) return AbortSignal.timeout(ms);
	const controller = new AbortController();
	const timer = setTimeout(() => controller.abort(new DOMException('Timeout expired', 'TimeoutError')), ms);
	// 定时器不应阻止进程退出
	if (typeof timer === 'object' && timer && typeof timer.unref === 'function') timer.unref();
	return controller.signal;
}

/**
 * 官方 AbortSignal.any()；不可用时手写兜底（等价实现）。
 */
export function createCombinedSignal(signals) {
	const list = signals.filter(Boolean);
	if (officialSupport.abortSignalAny) return AbortSignal.any(list);
	const controller = new AbortController();
	for (const signal of list) {
		if (signal.aborted) {
			controller.abort(signal.reason);
			break;
		}
		signal.addEventListener('abort', () => controller.abort(signal.reason), { once: true });
	}
	return controller.signal;
}

// ——————————————————————— 官方优先：Base64 ———————————————————————
/**
 * 官方 Uint8Array.fromBase64()；不可用时退回官方 atob()，最后才手写解码。
 */
export function decodeBase64Bytes(base64Str) {
	if (officialSupport.uint8FromBase64) return Uint8Array.fromBase64(base64Str);
	const binaryStr = atob(base64Str);
	const len = binaryStr.length;
	const bytes = new Uint8Array(len);
	for (let i = 0; i < len; i++) bytes[i] = binaryStr.charCodeAt(i);
	return bytes;
}

/**
 * 把 base64 字符串解成精确长度的 ArrayBuffer（握手格式解析代码依赖 ArrayBuffer + offset 语义）。
 */
export function base64ToArrayBuffer(base64Str) {
	if (!base64Str) return { earlyData: null, error: null };
	try {
		const normalized = base64Str.replace(/-/g, '+').replace(/_/g, '/');
		const bytes = decodeBase64Bytes(normalized);
		const buffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
		return { earlyData: buffer, error: null };
	} catch (error) {
		return { earlyData: null, error };
	}
}

// ——————————————————————— 官方优先：ReadableStream 读取器 ———————————————————————
/**
 * 基于官方 ReadableStreamDefaultReader 的字节读取器。
 *
 * 解决的问题：手写代码常见「一次 read() 假设拿到完整应答」和「读完后丢弃已读字节」两个缺陷，
 * 这里统一做精确读取，并把读到的多余字节留给后续转发数据。
 */
export function createByteReader(readable) {
	const reader = readable.getReader();
	let pending = new Uint8Array(0);

	const take = (n) => {
		const out = pending.slice(0, n);
		pending = pending.slice(n);
		return out;
	};

	return {
		/** 精确读取 n 个字节，多余的字节留在缓冲区里。 */
		async readExactly(n) {
			while (pending.byteLength < n) {
				const { value, done } = await reader.read();
				if (done) throw new Error('连接在读取完成前被中断');
				pending = concatBytes(pending, value);
			}
			return take(n);
		},

		/**
		 * 一直读到 findEnd(buffer) 返回非 -1 为止，返回这段「头部」字节。
		 * findEnd 返回的是头部结束位置（不含），其后剩余字节留给转发通道。
		 */
		async readUntil(findEnd, { maxBytes = 65536 } = {}) {
			while (true) {
				const end = findEnd(pending);
				if (end !== -1) return take(end);
				if (pending.byteLength > maxBytes) throw new Error('响应头过长');
				const { value, done } = await reader.read();
				if (done) throw new Error('连接在读取完成前被中断');
				pending = concatBytes(pending, value);
			}
		},

		/**
		 * 把「已读到的剩余字节 + socket 后续数据」拼成官方 ReadableStream。
		 */
		toReadable() {
			return new ReadableStream({
				async pull(controller) {
					if (pending.byteLength) {
						controller.enqueue(take(pending.byteLength));
						return;
					}
					const { value, done } = await reader.read();
					if (done) controller.close();
					else controller.enqueue(value);
				},
				cancel(reason) {
					return reader.cancel(reason);
				},
			});
		},

		release() {
			try {
				reader.releaseLock();
			} catch {
				/* 已被 cancel，忽略 */
			}
		},
	};
}

// ——————————————————————— 官方优先：TransformStream ———————————————————————
/**
 * 用官方 TransformStream 在流的首个分片前面拼上一段握手响应头。
 */
export function prependChunk(header, readable) {
	let sent = false;
	return readable.pipeThrough(
		new TransformStream({
			transform(chunk, controller) {
				if (!sent) {
					sent = true;
					controller.enqueue(concatBytes(header, chunk));
					return;
				}
				controller.enqueue(chunk);
			},
		})
	);
}

// ——————————————————————— 官方优先：管道错误统一收口 ———————————————————————
/**
 * 把 ReadableStream.pipeTo(WritableStream) 的 catch 收敛到一处。
 * - signal：传给官方 pipeTo 的第二参数（{ signal }），用于超时/取消时终止管道；
 * - label ：出错时一并回传，便于区分是上行、下行还是 DoH 管道；
 * - onError：捕获回调，返回的 Promise 不会 reject（错误只在此处处理）。
 */
export function pipeSafely(src, dst, { label = 'pipe', signal, onError } = {}) {
	return src.pipeTo(dst, signal ? { signal } : undefined).catch((err) => {
		onError?.(err, label);
	});
}
