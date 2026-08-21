"use strict";
/**
 * 实时（35–39）：原生 SSE。流式 send、自动重连头 + 心跳、与 WS 共享鉴权（由上层注入）。
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.openSSE = openSSE;
exports.streamToSSE = streamToSSE;
/** 给 res 挂载 SSE 上下文 */
function openSSE(res, connectOpts) {
    // 用 setHeader 保留中间件已设的安全头
    res.statusCode = 200;
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache, no-transform');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');
    res.flushHeaders?.();
    if (connectOpts?.retryMs !== undefined) {
        res.write(`retry: ${connectOpts.retryMs}\n\n`);
    }
    let closed = false;
    let heartbeatTimer = null;
    const stream = {
        res,
        get closed() {
            return closed;
        },
        send(data, options) {
            if (closed || res.writableEnded)
                return;
            let out = '';
            if (options?.event)
                out += `event: ${options.event}\n`;
            if (options?.id !== undefined)
                out += `id: ${options.id}\n`;
            if (options?.retry !== undefined)
                out += `retry: ${options.retry}\n`;
            const lines = typeof data === 'string' ? data.split('\n') : JSON.stringify(data).split('\n');
            for (const line of lines)
                out += `data: ${line}\n`;
            out += '\n';
            res.write(out);
        },
        raw(lines) {
            if (closed || res.writableEnded)
                return;
            res.write(lines + '\n');
        },
        heartbeat() {
            if (closed || res.writableEnded)
                return;
            res.write(': ping\n\n');
        },
        close() {
            if (closed)
                return;
            closed = true;
            if (heartbeatTimer) {
                clearInterval(heartbeatTimer);
                heartbeatTimer = null;
            }
            try {
                res.end();
            }
            catch { }
        },
    };
    // 心跳
    const hb = connectOpts?.heartbeatMs;
    if (hb && hb > 0) {
        heartbeatTimer = setInterval(() => stream.heartbeat(), hb);
        // 不要让定时器阻塞退出
        if (typeof heartbeatTimer.unref === 'function')
            heartbeatTimer.unref();
    }
    // 客户端断开时清理
    res.on('close', () => {
        if (heartbeatTimer)
            clearInterval(heartbeatTimer);
        closed = true;
    });
    connectOpts?.onOpen?.(stream);
    return stream;
}
/** 便捷：把可迭代/生成器转成 SSE */
function streamToSSE(res, iterator, opts) {
    const stream = openSSE(res, { heartbeatMs: opts?.heartbeatMs });
    (async () => {
        try {
            for await (const item of iterator) {
                stream.send(item);
            }
        }
        catch {
            // 客户端断开
        }
        finally {
            stream.close();
            opts?.onDone?.();
        }
    })();
}
