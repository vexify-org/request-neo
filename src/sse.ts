/**
 * 实时（35–39）：原生 SSE。流式 send、自动重连头 + 心跳、与 WS 共享鉴权（由上层注入）。
 */

import type { ServerResponse } from 'node:http';
import type { Context } from './context';

export interface SSEStream {
  /** 发送一个事件对象 */
  send(data: unknown, options?: SSEEventOptions): void;
  /** 发送原始事件行 */
  raw(lines: string): void;
  /** 发送心跳注释 */
  heartbeat(): void;
  /** 结束流 */
  close(): void;
  /** 是否已关闭 */
  readonly closed: boolean;
  /** 连接使用的响应对象 */
  res: ServerResponse;
}

export interface SSEEventOptions {
  event?: string;
  id?: string | number;
  retry?: number;
}

export interface SSEContext extends SSEStream {
  ctx: Context;
}

/** 给 res 挂载 SSE 上下文 */
export function openSSE(res: ServerResponse, connectOpts?: {
  onOpen?: (stream: SSEStream) => unknown;
  heartbeatMs?: number;
  retryMs?: number;
}): SSEStream {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache, no-transform',
    'Connection': 'keep-alive',
    'X-Accel-Buffering': 'no',
  });
  res.write('\n'); // 开篇空行有时对部分客户端必要
  if (connectOpts?.retryMs !== undefined) {
    res.write(`retry: ${connectOpts.retryMs}\n\n`);
  }

  let closed = false;
  let heartbeatTimer: ReturnType<typeof setInterval> | null = null;

  const stream: SSEStream = {
    res,
    get closed() {
      return closed;
    },
    send(data, options) {
      if (closed || res.writableEnded) return;
      let out = '';
      if (options?.event) out += `event: ${options.event}\n`;
      if (options?.id !== undefined) out += `id: ${options.id}\n`;
      if (options?.retry !== undefined) out += `retry: ${options.retry}\n`;
      const lines = typeof data === 'string' ? data.split('\n') : JSON.stringify(data).split('\n');
      for (const line of lines) out += `data: ${line}\n`;
      out += '\n';
      res.write(out);
    },
    raw(lines) {
      if (closed || res.writableEnded) return;
      res.write(lines + '\n');
    },
    heartbeat() {
      if (closed || res.writableEnded) return;
      res.write(': ping\n\n');
    },
    close() {
      if (closed) return;
      closed = true;
      if (heartbeatTimer) {
        clearInterval(heartbeatTimer);
        heartbeatTimer = null;
      }
      try { res.end(); } catch {}
    },
  };

  // 心跳
  const hb = connectOpts?.heartbeatMs;
  if (hb && hb > 0) {
    heartbeatTimer = setInterval(() => stream.heartbeat(), hb);
    // 不要让定时器阻塞退出
    if (typeof (heartbeatTimer as any).unref === 'function') (heartbeatTimer as any).unref();
  }

  // 客户端断开时清理
  res.on('close', () => {
    if (heartbeatTimer) clearInterval(heartbeatTimer);
    closed = true;
  });

  connectOpts?.onOpen?.(stream);
  return stream;
}

/** 便捷：把可迭代/生成器转成 SSE */
export function streamToSSE(res: ServerResponse, iterator: AsyncIterable<unknown>, opts?: {
  heartbeatMs?: number;
  onDone?: () => unknown;
}): void {
  const stream = openSSE(res, { heartbeatMs: opts?.heartbeatMs });
  (async () => {
    try {
      for await (const item of iterator) {
        stream.send(item);
      }
    } catch {
      // 客户端断开
    } finally {
      stream.close();
      opts?.onDone?.();
    }
  })();
}