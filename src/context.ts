/**
 * 请求上下文：封装 req/res + 路由参数 + 查询 + 流式 body + 响应发送。
 */

import type { IncomingMessage, ServerResponse } from 'node:http';
import { URL } from 'node:url';
import { HttpError } from './errors';
import { Logger } from './logger';

export type CtxMiddleware = (ctx: Context, next: () => Promise<unknown>) => unknown;

export class Context<
  P extends Record<string, string> = Record<string, string>,
  Q extends Record<string, unknown> = Record<string, unknown>,
  B = unknown,
  Deps = unknown
> {
  readonly req: IncomingMessage;
  readonly res: ServerResponse;
  readonly requestId: string;
  readonly url: URL;
  readonly method: string;
  readonly started: number;
  params!: P;
  query!: Q;
  /** 依赖注入结果 */
  state!: Record<string, unknown>;
  deps!: Deps;
  body!: B;
  files: Record<string, any> = {};
  rawBody?: Buffer;

  /** 流的当前状态 */
  private _streamMode = false;
  private _bodyStart: number | null = null;

  get stream(): IncomingMessage {
    return this.req;
  }

  constructor(req: IncomingMessage, res: ServerResponse, requestId: string, baseUrl?: string) {
    this.req = req;
    this.res = res;
    this.requestId = requestId;
    this.started = Date.now();
    const proto = this.isSecure() ? 'https' : 'http';
    const host = req.headers.host || 'localhost';
    this.url = new URL(`${proto}://${host}` + (req.url ?? '/'));
    this.method = (req.method ?? 'GET').toUpperCase();
    this.params = {} as P;
    this.query = this.parseQuery();

    // 限定读取，流式优化
    this.res.setHeader('X-Request-Id', requestId);
  }

  private isSecure(): boolean {
    // @ts-ignore socket 上可能带 encrypted 标志（TLS/HTTP2）
    const sock = this.req.socket as any;
    if (sock?.encrypted === true) return true;
    // @ts-ignore HTTP2 头部伪头
    if ((this.req as any).stream && (this.req as any).stream.session?.socket?.encrypted) return true;
    return false;
  }

  private parseQuery(): Q {
    const out: Record<string, unknown> = {};
    for (const [k, v] of this.url.searchParams.entries()) {
      if (v === '') {
        out[k] = true;
      } else if (!Number.isNaN(Number(v)) && v.trim() !== '') {
        out[k] = Number(v);
      } else if (v === 'true') {
        out[k] = true;
      } else if (v === 'false') {
        out[k] = false;
      } else {
        out[k] = v;
      }
    }
    const seen = new Set<string>();
    for (const k of this.url.searchParams.keys()) {
      if (seen.has(k)) {
        const all = this.url.searchParams.getAll(k);
        out[k] = all.length === 1 ? all[0] : all;
      }
      seen.add(k);
    }
    return out as Q;
  }

  // ---------------- Headers ----------------
  get headers(): Record<string, string | string[] | undefined> {
    return this.req.headers;
  }
  header(name: string): string | undefined {
    const v = this.req.headers[name.toLowerCase()];
    return Array.isArray(v) ? v[0] : (v ?? undefined);
  }
  setHeader(name: string, value: string | number): this {
    this.res.setHeader(name, value);
    return this;
  }
  get headerNames(): string[] {
    return Object.keys(this.req.headers);
  }
  set status(code: number) {
    this.res.statusCode = code;
  }
  get status(): number {
    return this.res.statusCode;
  }

  // ---------------- Logging ----------------
  private _log?: Logger;
  private _route?: string;
  get log(): Logger {
    if (!this._log) this._log = new Logger(this.requestId, this.req, this._route);
    return this._log;
  }
  set route(v: string | undefined) {
    this._route = v;
    if (this._log) this._log.setRoute(v);
  }
  get route(): string | undefined {
    return this._route;
  }

  // ---------------- 流式 body ----------------
  /** 请求体是否分派给流式处理（比如已 pipe） */
  get streaming(): boolean {
    return this._streamMode;
  }
  markStreaming(): void {
    this._streamMode = true;
  }
  setBodySizeHint(n: number): void {
    this._bodyStart = n;
  }

  // ---------------- 响应发送 ----------------
  json(data: unknown, status?: number): this {
    this.markHandled();
    if (status !== undefined) this.res.statusCode = status;
    const body = Buffer.from(JSON.stringify(data as any));
    this.res.setHeader('Content-Type', 'application/json; charset=utf-8');
    this.res.setHeader('Content-Length', String(body.length));
    this.res.end(body);
    return this;
  }
  text(data: string, status?: number): this {
    this.markHandled();
    if (status !== undefined) this.res.statusCode = status;
    const body = Buffer.from(data);
    this.res.setHeader('Content-Type', 'text/plain; charset=utf-8');
    this.res.setHeader('Content-Length', String(body.length));
    this.res.end(body);
    return this;
  }
  send(data: Buffer | string, status?: number, type?: string): this {
    this.markHandled();
    if (status !== undefined) this.res.statusCode = status;
    const buf = Buffer.isBuffer(data) ? data : Buffer.from(String(data));
    if (type) this.res.setHeader('Content-Type', type);
    if (!this.res.hasHeader('Content-Length')) {
      this.res.setHeader('Content-Length', String(buf.length));
    }
    this.res.end(buf);
    return this;
  }
  html(data: string, status?: number): this {
    return this.send(data, status, 'text/html; charset=utf-8');
  }
  file(buf: Buffer, contentType: string): this {
    this.markHandled();
    this.res.setHeader('Content-Type', contentType);
    this.res.setHeader('Content-Length', String(buf.length));
    this.res.end(buf);
    return this;
  }
  /** 流式发送可读流（背压感知，pipe） */
  pipe(stream: NodeJS.ReadableStream, contentType = 'application/octet-stream', status = 200): this {
    this.markHandled();
    this.res.statusCode = status;
    this.res.setHeader('Content-Type', contentType);
    stream.pipe(this.res);
    return this;
  }
  redirect(url: string, status = 302): this {
    this.markHandled();
    this.res.statusCode = status;
    this.res.setHeader('Location', url);
    this.res.end();
    return this;
  }

  /** 操作为空响应 */
  noContent(status = 204): this {
    this.markHandled();
    this.res.statusCode = status;
    this.res.end();
    return this;
  }

  /** 内部：标记响应已开始（避免框架再覆盖） */
  private _handled = false;
  markHandled(): void {
    this._handled = true;
    this._streamMode = true;
  }
  get handled(): boolean {
    return this._handled || this.res.writableEnded;
  }

  get ip(): string {
    return (this.req.socket.remoteAddress || '').replace(/^::ffff:/, '');
  }

  /** 请求体原始输入流（供 multipart 透传使用） */
  bodyStream(): IncomingMessage {
    return this.req;
  }

  throw(status: number, message?: string): never {
    throw new HttpError(status, message);
  }

  // Error 辅助
  error(status: number, message?: string): HttpError {
    return new HttpError(status, message);
  }
}