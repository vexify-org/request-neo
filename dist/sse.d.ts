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
export declare function openSSE(res: ServerResponse, connectOpts?: {
    onOpen?: (stream: SSEStream) => unknown;
    heartbeatMs?: number;
    retryMs?: number;
}): SSEStream;
/** 便捷：把可迭代/生成器转成 SSE */
export declare function streamToSSE(res: ServerResponse, iterator: AsyncIterable<unknown>, opts?: {
    heartbeatMs?: number;
    onDone?: () => unknown;
}): void;
