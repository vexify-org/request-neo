/**
 * 请求上下文：封装 req/res + 路由参数 + 查询 + 流式 body + 响应发送。
 */
import type { IncomingMessage, ServerResponse } from 'node:http';
import { URL } from 'node:url';
import { HttpError } from './errors';
import { Logger } from './logger';
export type CtxMiddleware = (ctx: Context, next: () => Promise<unknown>) => unknown;
export declare class Context<P extends Record<string, string> = Record<string, string>, Q extends Record<string, unknown> = Record<string, unknown>, B = unknown, Deps = unknown> {
    readonly req: IncomingMessage;
    readonly res: ServerResponse;
    readonly requestId: string;
    readonly url: URL;
    readonly method: string;
    readonly started: number;
    params: P;
    query: Q;
    /** 依赖注入结果 */
    state: Record<string, unknown>;
    deps: Deps;
    body: B;
    files: Record<string, any>;
    rawBody?: Buffer;
    /** 流的当前状态 */
    private _streamMode;
    private _bodyStart;
    get stream(): IncomingMessage;
    constructor(req: IncomingMessage, res: ServerResponse, requestId: string, baseUrl?: string);
    private isSecure;
    private parseQuery;
    get headers(): Record<string, string | string[] | undefined>;
    header(name: string): string | undefined;
    setHeader(name: string, value: string | number): this;
    get headerNames(): string[];
    set status(code: number);
    get status(): number;
    private _log?;
    private _route?;
    get log(): Logger;
    set route(v: string | undefined);
    get route(): string | undefined;
    /** 请求体是否分派给流式处理（比如已 pipe） */
    get streaming(): boolean;
    markStreaming(): void;
    setBodySizeHint(n: number): void;
    json(data: unknown, status?: number): this;
    text(data: string, status?: number): this;
    send(data: Buffer | string, status?: number, type?: string): this;
    html(data: string, status?: number): this;
    file(buf: Buffer, contentType: string): this;
    /** 流式发送可读流（背压感知，pipe） */
    pipe(stream: NodeJS.ReadableStream, contentType?: string, status?: number): this;
    redirect(url: string, status?: number): this;
    /** 操作为空响应 */
    noContent(status?: number): this;
    /** 内部：标记响应已开始（避免框架再覆盖） */
    private _handled;
    markHandled(): void;
    get handled(): boolean;
    get ip(): string;
    /** 请求体原始输入流（供 multipart 透传使用） */
    bodyStream(): IncomingMessage;
    throw(status: number, message?: string): never;
    error(status: number, message?: string): HttpError;
}
