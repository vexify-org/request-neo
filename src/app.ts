/**
 * request-neo 核心 App。
 *
 * 一个 class 完成：传输（listen/http2/https/ALPN/超时）、路由、校验、中间件洋葱、
 * deps 注入、WS/SSE、静态、安全、OpenAPI/docs、metrics。
 */

import { createServer as createHttpServer } from 'node:http';
import type { Server, IncomingMessage, ServerResponse } from 'node:http';
import { createServer as createSecureServer } from 'node:https';
import type { ConnectionOptions as TlsOptions } from 'node:tls';
import { createSecureContext } from 'node:tls';
import { readFileSync } from 'node:fs';
import { networkInterfaces } from 'node:os';

import { Context } from './context';
import { HttpError, normalizeError } from './errors';
import { NeoRouter, HTTP_METHODS, type HttpMethod } from './router';
import { compose, type CtxMiddleware } from './middleware';
import { t, Validator, type OASchema } from './validators';
import { parseBody, type BodyParseOptions } from './stream';
import { WSServer } from './ws';
import { openSSE, type SSEStream } from './sse';
import { cors, securityHeaders, jwt, session, rateLimit, csrf, type CorsOptions } from './security';
import { NeoLogger } from './logger';
import {
  createMetrics,
  renderPrometheus,
  buildOpenApi,
  swaggerUiHtml,
  reDocHtml,
  type OpenApiRoute,
  type MetricStore,
} from './observability';
import { randomUUID } from 'node:crypto';
import { existsSync, createReadStream, statSync } from 'node:fs';
import { extname, join, resolve } from 'node:path';

// ==========================================================================
// 类型
// ==========================================================================
type ParamsOf<S> = S extends undefined ? Record<string, string> : { [K in keyof S]: S[K] extends Validator<infer T> ? T : string };
type QueryOf<S> = S extends undefined ? Record<string, unknown> : { [K in keyof S]: S[K] extends Validator<infer T> ? T : unknown };
type BodyOf<S> = S extends undefined ? unknown : S extends Validator<infer T> ? T : unknown;

export interface RouteSchema {
  summary?: string;
  description?: string;
  tags?: string[];
  body?: Validator<any>;
  params?: Record<string, Validator<any>>;
  query?: Record<string, Validator<any>>;
  response?: Validator<any>;
}

export interface RouteOptions extends RouteSchema {
  alias?: string;
  middleware?: CtxMiddleware[];
}

export type RouterOutput = unknown;

export type DepsResolver<D> = (ctx: Context) => Promise<D> | D;
export type ShortCircuit = void;

export interface AppOptions {
  /** 请求体上限 */
  body?: BodyParseOptions;
  /** 日志 */
  log?: { level?: 'trace' | 'debug' | 'info' | 'warn' | 'error' | 'fatal'; pretty?: boolean };
  /** 安全头默认开启 */
  securityHeaders?: boolean | Record<string, unknown>;
  cors?: boolean | CorsOptions;
  http2?: boolean;
  /** 秒级请求超时 */
  requestTimeout?: number;
  keepAliveTimeout?: number;
  maxHeaderSize?: number;
  baseUrl?: string;
  openapi?: {
    enabled?: boolean;
    title?: string;
    version?: string;
  };
  docs?: { swagger?: boolean; redoc?: boolean };
  metrics?: boolean;
  notFoundMessage?: string;
}

// ==========================================================================
// App
// ==========================================================================
export class NeoApp<Deps = Record<string, unknown>> {
  private router = new NeoRouter<RouteRecord>();
  private globalMiddleware: CtxMiddleware[] = [];
  private groupStack: { prefix: string; tags: string[]; middleware: CtxMiddleware[] }[] = [];
  private depsResolver?: DepsResolver<Deps>;
  private wsServer = new WSServer();
  private _wsServerGet(): WSServer {
    return this.wsServer;
  }
  private sseRoutes = new Map<string, (ctx: Context, stream: SSEStream) => unknown>();
  private staticRoutes: Array<{ prefix: string; dir: string }> = [];
  private routeRecords: Array<OpenApiRoute & { alias?: string }> = [];
  private options: Required<Pick<AppOptions, 'openapi' | 'docs' | 'metrics'>> & AppOptions;
  private metricsStore: MetricStore = createMetrics();
  private server?: Server;
  private nextId = 1;

  constructor(userOpts: AppOptions = {}) {
    this.options = {
      ...userOpts,
      openapi: { enabled: true, title: 'request-neo API', version: '1.0.0', ...(userOpts.openapi ?? {}) },
      docs: { swagger: true, redoc: true, ...(userOpts.docs ?? {}) },
      metrics: userOpts.metrics ?? true,
    };
    const logger = new NeoLogger(userOpts.log ?? {});
    NeoLogger.getDefault().level = logger.level;
    NeoLogger.getDefault().pretty = logger.pretty;

    // 默认安全头
    if (userOpts.securityHeaders !== false) {
      this.use(securityHeaders((userOpts.securityHeaders as any) ?? {}));
    }
    if (userOpts.cors === true) {
      this.use(cors());
    } else if (userOpts.cors && typeof userOpts.cors === 'object') {
      this.use(cors(userOpts.cors));
    }
  }

  // ========================================================================
  // 中间件
  // ========================================================================
  /** 全局中间件 */
  use(fn: CtxMiddleware): this {
    this.globalMiddleware.push(fn);
    return this;
  }

  // ========================================================================
  // 路由注册
  // ========================================================================
  /** 核心：Flask 式 app.route(path, ['GET','POST'], schema?, handler?) */
  route<P extends RouteSchema | undefined = undefined, S extends RouteSchema = P extends RouteSchema ? P : RouteSchema>(
    path: string,
    methods: HttpMethod | HttpMethod[],
    schemaOrHandler: S | RouteHandler<S, Deps>,
    maybeHandler?: RouteHandler<S, Deps>,
    routeOpts?: RouteOptions
  ): this {
    const schema = (isFunction(schemaOrHandler) ? {} : schemaOrHandler) as S;
    const handler = (isFunction(schemaOrHandler) ? schemaOrHandler : maybeHandler!) as RouteHandler<S, Deps>;
    if (!handler && !isFunction(schemaOrHandler)) throw new Error('route handler required');
    this.registerRecord(path, methods, schema, handler, routeOpts);
    return this;
  }

  private registerRecord(
    path: string,
    methods: HttpMethod | HttpMethod[],
    schema: RouteSchema,
    handler: RouteHandler<any, Deps>,
    opts?: RouteOptions,
    inherited?: { prefix?: string; tags?: string[] }
  ): void {
    const { prefix = '', tags = [] } = inherited ?? {};
    const pre = prefix || '';
    const fullPath = joinPath(pre, path);
    const mArr = (Array.isArray(methods) ? methods : [methods]) as HttpMethod[];
    const fullSchema: RouteSchema = schema;

    const record: any = { handler, schema: fullSchema, tags: [...tags, ...(schema.tags ?? [])] };
    if (opts?.summary) record.summary = opts.summary;
    if (opts?.description) record.description = opts.description;
    if (opts?.alias) record.alias = opts.alias;

    this.router.register(fullPath, mArr, record, opts?.alias);

    // 记录 openapi
    this.routeRecords.push({
      path: fullPath,
      method: mArr[0],
      summary: opts?.summary ?? schema.summary,
      description: opts?.description ?? schema.description,
      tags: fullSchema.tags ?? tags,
      schema: mappableSchema(schema),
      alias: opts?.alias,
    });
    if (mArr.includes('GET') && !mArr.includes('HEAD')) {
      this.routeRecords.push({
        path: fullPath, method: 'HEAD', summary: opts?.summary, tags: fullSchema.tags ?? tags,
        schema: mappableSchema(schema),
      });
    }
  }

  // =====================================================
  // 便捷方法
  // =====================================================
  get<S extends RouteSchema | undefined = undefined>(path: string, schema: S | RouteHandler<S, Deps>, handler?: RouteHandler<S, Deps>): this {
    if (isFunction(schema)) return this.route(path, ['GET'], {}, schema);
    return this.route(path, ['GET'], schema as S, handler as RouteHandler<S, Deps>);
  }
  post<S extends RouteSchema | undefined = undefined>(path: string, schema: S | RouteHandler<S, Deps>, handler?: RouteHandler<S, Deps>): this {
    if (isFunction(schema)) return this.route(path, ['POST'], {}, schema);
    return this.route(path, ['POST'], schema as S, handler as RouteHandler<S, Deps>);
  }
  put<S extends RouteSchema | undefined = undefined>(path: string, schema: S | RouteHandler<S, Deps>, handler?: RouteHandler<S, Deps>): this {
    if (isFunction(schema)) return this.route(path, ['PUT'], {}, schema);
    return this.route(path, ['PUT'], schema as S, handler as RouteHandler<S, Deps>);
  }
  patch<S extends RouteSchema | undefined = undefined>(path: string, schema: S | RouteHandler<S, Deps>, handler?: RouteHandler<S, Deps>): this {
    if (isFunction(schema)) return this.route(path, ['PATCH'], {}, schema);
    return this.route(path, ['PATCH'], schema as S, handler as RouteHandler<S, Deps>);
  }
  delete<S extends RouteSchema | undefined = undefined>(path: string, schema: S | RouteHandler<S, Deps>, handler?: RouteHandler<S, Deps>): this {
    if (isFunction(schema)) return this.route(path, ['DELETE'], {}, schema);
    return this.route(path, ['DELETE'], schema as S, handler as RouteHandler<S, Deps>);
  }
  all(path: string, handler: RouteHandler<RouteSchema, Deps>): this {
    return this.route(path, HTTP_METHODS, {}, handler);
  }

  // =====================================================
  // 嵌套路由组（FastAPI Router 味）
  // =====================================================
  group(prefix: string, callback: (g: RouterGroup<Deps>) => void, opts?: { tags?: string[]; middleware?: CtxMiddleware[] }): this {
    const g = new RouterGroup<Deps>(this, prefix, opts?.tags ?? [], opts?.middleware ?? []);
    callback(g);
    return this;
  }

  /** 路由组内部注册（被 RouterGroup 调用） */
  _groupRoute(prefix: string, tags: string[], path: string, methods: HttpMethod | HttpMethod[], schema: RouteSchema, handler: RouteHandler<any, Deps>, opts?: RouteOptions & { middleware?: CtxMiddleware[] }): void {
    void tags;
    this.registerRecord(path, methods, schema, handler, opts, { prefix, tags });
  }
  _groupUse(mw: CtxMiddleware): void {
    this.use(mw);
  }

  // ========================================================================
  // 依赖注入
  // ========================================================================
  deps(fn: DepsResolver<Deps>): this {
    if (this.depsResolver) throw new Error('deps already bound');
    this.depsResolver = fn;
    return this;
  }

  // ========================================================================
  // WebSocket
  // ========================================================================
  ws(path: string, spec: import('./ws').WsHandlerSpec): this {
    this.wsServer.route(path, spec);
    return this;
  }

  // ========================================================================
  // SSE
  // ========================================================================
  sse(path: string, handler: (ctx: Context, stream: SSEStream) => unknown, opts?: { heartbeatMs?: number }): this {
    this.sseRoutes.set(normalizePath2(path), { handler, opts });
    return this;
  }

  // ========================================================================
  // 静态 / 反向 URL / 别名
  // ========================================================================
  static(prefix: string, dir: string): this {
    this.staticRoutes.push({ prefix: normalizeStaticPrefix(prefix), dir: resolve(dir) });
    return this;
  }

  urlFor(alias: string, params: Record<string, string | number> = {}): string {
    return this.router.urlFor(alias, params);
  }

  // ========================================================================
  // 安全快捷
  // ========================================================================
  cors(opts?: CorsOptions): this {
    return this.use(cors(opts));
  }
  helmet(opts?: Record<string, unknown>): this {
    return this.use(securityHeaders(opts as any));
  }
  jwt(opts: import('./security').JwtOptions): this {
    return this.use(jwt(opts));
  }
  session(opts: import('./security').SessionOptions): this {
    return this.use(session(opts));
  }
  rateLimit(opts: import('./security').RateLimitOptions): this {
    return this.use(rateLimit(opts));
  }
  csrf(opts: import('./security').CsrfOptions): this {
    return this.use(csrf(opts));
  }
  signJwt(payload: Record<string, unknown>, secret: string, opts?: { expiresIn?: string | number }): string {
    return require('./security').sign(payload, secret, opts);
  }

  // ========================================================================
  // Listen（HTTP / HTTPS / HTTP2+ALPN）
  // ========================================================================
  listen(port = 3000, hostname?: string, callback?: () => void): Server {
    const opts = this.options;
    const tls = (this as any).__tls as TlsOptions | undefined;
    this.wireBuiltinRoutes();

    let server: Server;
    if (opts.http2 && tls) {
      server = createHttp2SecureServer(tls, this.handleRequest as any) as any;
    } else if (tls) {
      server = createSecureServer(tls, this.handleRequest) as any;
    } else {
      server = createHttpServer(this.handleRequest);
    }

    this.server = server;

    // 连接级超时 / keep-alive / 最大头大小
    const to = opts.requestTimeout;
    if (to) {
      try { server.requestTimeout = to * 1000; } catch {}
    }
    const headersTimeout = (opts.requestTimeout ?? 60) * 1000;
    try { server.headersTimeout = headersTimeout; } catch {}
    if (opts.keepAliveTimeout) {
      try { server.keepAliveTimeout = opts.keepAliveTimeout * 1000; } catch {}
    }
    if (opts.maxHeaderSize) {
      try { server.maxHeadersCount = Math.ceil(opts.maxHeaderSize / 8192); } catch {}
    }

    // WS 升级
    server.on('upgrade', (req: IncomingMessage, socket: any, head: Buffer) => {
      this.wsServer.handleUpgrade(req, socket, head);
    });

    if (typeof hostname === 'function') {
      callback = hostname as any;
      hostname = undefined;
    }
    if (typeof hostname === 'number') {
      // hostname 传的是端口
      callback = callback;
    }
    if (hostname) server.listen(port, hostname, callback);
    else server.listen(port, callback);
    return server;
  }

  /** HTTPS 一键启用（自签生成或提供证书文件路径热加载） */
  useTls(opts: TlsOptions | { certPath?: string; keyPath?: string } | { caPath?: string }): this {
    let tlsOpts: TlsOptions;
    if (isFileBasedTls(opts)) {
      tlsOpts = {
        cert: readFileSync((opts as any).certPath!),
        key: readFileSync((opts as any).keyPath!),
        ...((opts as any).caPath ? { ca: readFileSync((opts as any).caPath) } : {}),
      };
      this._tlsPaths = (opts as any);
    } else {
      tlsOpts = opts as TlsOptions;
      require('node:https');
    }
    (this as any).__tls = tlsOpts;
    this._hotReload = true;
    return this;
  }

  private _tlsPaths?: { certPath?: string; keyPath?: string; caPath?: string };
  private _hotReload = false;

  /** 自签证书生成（仅用于测试/开发） */
  static selfSigned(hostname = 'localhost'): TlsOptions {
    return generateSelfSigned(hostname);
  }

  // ========================================================================
  // 内置路由：openapi / docs / metrics / 404
  // ========================================================================
  private wired = false;
  private wireBuiltinRoutes(): void {
    if (this.wired) return;
    this.wired = true;
    const metricsEnabled = this.options.metrics;
    const openapiEnabled = this.options.openapi?.enabled;
    const docSwagger = this.options.docs?.swagger;
    const docRedoc = this.options.docs?.redoc;

    if (openapiEnabled) {
      this.router.register('/openapi.json', 'GET', { handler: (ctx: Context) => {
        ctx.json(this.buildOpenAPI());
      }, schema: {} }, undefined);
      if (docSwagger) {
        this.router.register('/docs', 'GET', { handler: (ctx: Context) => {
          ctx.html(swaggerUiHtml('/openapi.json', this.options.openapi?.title ?? 'API Docs'));
        }, schema: {} }, undefined);
        this.router.register('/docs/html', 'GET', { handler: (ctx: Context) => {
          ctx.html(swaggerUiHtml('/openapi.json', this.options.openapi?.title ?? 'API Docs'));
        }, schema: {} }, undefined);
      }
      if (docRedoc) {
        this.router.register('/redoc', 'GET', { handler: (ctx: Context) => {
          ctx.html(reDocHtml('/openapi.json', this.options.openapi?.title ?? 'API Reference'));
        }, schema: {} }, undefined);
      }
    }
    if (metricsEnabled) {
      this.router.register('/metrics', 'GET', { handler: (ctx: Context) => {
        ctx.res.setHeader('Content-Type', 'text/plain; version=0.0.4; charset=utf-8');
        ctx.send(renderPrometheus(this.metricsStore));
      }, schema: {} }, undefined);
    }
  }

  private buildOpenAPI(): Record<string, unknown> {
    const routes = this.routeRecords.map((r) => ({
      path: r.path,
      method: r.method,
      summary: r.summary,
      description: r.description,
      tags: r.tags ?? [],
      schema: r.schema as any,
    }));
    return buildOpenApi(routes, {
      title: this.options.openapi?.title,
      version: this.options.openapi?.version,
    });
  }

  // ========================================================================
  // 请求处理
  // ========================================================================
  private handleRequest = async (req: IncomingMessage, res: ServerResponse): Promise<void> => {
    const requestId = (req.headers['x-request-id'] as string) || randomUUID();
    const ctx = new Context(req, res, requestId, this.options.baseUrl);
    const started = Date.now();

    try {
      // 解析 URL 路径
      const path = ctx.url.pathname;
      const method = ctx.method as HttpMethod;

      // 1) 静态文件
      if (this.tryStatic(ctx, path)) return;

      // 2) 路由解析
      let match;
      try {
        match = this.router.resolve(path, method);
      } catch (err) {
        // OPTIONS 自动应答
        if (err instanceof HttpError && err.status === 405 && method === 'OPTIONS') {
          ctx.markHandled();
          const allow = err.headers?.Allow ?? 'GET, POST';
          ctx.res.statusCode = 204;
          ctx.setHeader('Allow', allow);
          ctx.setHeader('Access-Control-Allow-Methods', allow);
          ctx.res.end();
          this.afterRequest(ctx, path, method, 204, started);
          return;
        }
        if (err instanceof HttpError && err.status === 405) {
          ctx.setHeader('Allow', err.headers?.Allow ?? '');
        }
        throw err;
      }

      const route: RouteRecord = match.handler;
      ctx.route = route.schema?.summary || path;
      ctx.params = match.params as any;

      // 3) 组装洋葱栈：全局中间件 + handler（含 schema 校验）
      const stack: CtxMiddleware[] = [...this.globalMiddleware];
      if (route.routeMw?.length) stack.push(...route.routeMw);

      const finalHandler = wrapHandler(route, ctx, this.depsResolver as any);

      stack.push(async (c, next) => {
        void c;
        await finalHandler();
        await next();
      });

      const runner = compose(stack);
      await runner(ctx);

      // 若 handler 没写响应
      if (!ctx.handled) {
        ctx.noContent(204);
      }
      this.afterRequest(ctx, path, method, ctx.status, started);
    } catch (err) {
      this.handleError(ctx, err);
      this.afterRequest(ctx, path, ctx.method as HttpMethod, ctx.status, started);
    } finally {
      // finally 钩子：异步资源释放由用户在中间件中通过 try/finally
    }
  };

  private tryStatic(ctx: Context, path: string): boolean {
    for (const { prefix, dir } of this.staticRoutes) {
      if (prefix === '/' || path.startsWith(prefix)) {
        const rel = path.slice(prefix.length).replace(/^\/+/, '');
        const full = join(dir, rel || 'index.html');
        if (existsSync(full)) {
          try {
            const st = statSync(full);
            if (st.isFile()) {
              ctx.markHandled();
              ctx.res.setHeader('Content-Type', mimeType(extname(full)));
              ctx.res.setHeader('Content-Length', String(st.size));
              ctx.res.statusCode = 200;
              createReadStream(full).pipe(ctx.res);
              return true;
            }
          } catch {
            return false;
          }
        }
      }
    }
    return false;
  }

  private handleError(ctx: Context, err: unknown): void {
    if (ctx.handled || ctx.res.writableEnded) return;
    const httpErr = normalizeError(err);
    const body = { ...httpErr.toJSON(), requestId: ctx.requestId };
    let status = httpErr.status;
    try {
      ctx.res.setHeader('Content-Type', 'application/json; charset=utf-8');
      if (httpErr.headers) {
        for (const [k, v] of Object.entries(httpErr.headers)) ctx.res.setHeader(k, v);
      }
      ctx.res.statusCode = status;
      if (httpErr.status === 404 && !httpErr.expose) {
        body.message = (this as any).notFoundMessage ?? 'Not Found';
      }
      ctx.res.end(JSON.stringify(body));
    } catch {
      try { ctx.res.end(JSON.stringify({ error: 'internal_server_error', message: 'Internal Server Error', status: 500, requestId: ctx.requestId })); } catch {}
    }
    // 日志
    if (status >= 500) {
      NeoLogger.getDefault().error('request error', { err: httpErr, ip: ctx.ip });
    }
  }

  private afterRequest(ctx: Context, route: string, method: string, status: number, started: number): void {
    const ms = Date.now() - started;
    // metrics
    if (this.options.metrics) {
      const key = `${method}|${route}|${status}`;
      this.metricsStore.httpRequestsTotal.set(key, (this.metricsStore.httpRequestsTotal.get(key) ?? 0) + 1);
      if (!this.metricsStore.httpRequestDurationMs.has(route)) this.metricsStore.httpRequestDurationMs.set(route, []);
      const arr = this.metricsStore.httpRequestDurationMs.get(route)!;
      if (arr.length > 10000) arr.shift();
      arr.push(ms);
    }
    // 结构化日志（自带 requestId / 耗时 / 路由）
    NeoLogger.getDefault().info('request', { route, method, status, durationMs: ms, ip: ctx.ip, requestId: ctx.requestId });
  }

  // OpenAPI 提取
  getOpenApi(): Record<string, unknown> {
    return this.buildOpenAPI();
  }
}

// ==========================================================================
// RouterGroup
// ==========================================================================
export class RouterGroup<Deps> {
  constructor(
    private app: NeoApp<Deps>,
    private prefix: string,
    private tags: string[],
    private middleware: CtxMiddleware[]
  ) {
    this.app = app;
  }

  use(mw: CtxMiddleware): this {
    this.middleware.push(mw);
    this.app._groupUse(mw);
    return this;
  }
  route<P extends RouteSchema | undefined = undefined, S extends RouteSchema = P extends RouteSchema ? P : RouteSchema>(
    path: string,
    methods: HttpMethod | HttpMethod[],
    schemaOrHandler: S | RouteHandler<S, Deps>,
    maybeHandler?: RouteHandler<S, Deps>
  ): this {
    const schema = (isFunction(schemaOrHandler) ? {} : schemaOrHandler) as S;
    const handler = (isFunction(schemaOrHandler) ? schemaOrHandler : maybeHandler!) as RouteHandler<S, Deps>;
    this.app._groupRoute(this.prefix, this.tags, path, methods, schema, handler, {});
    return this;
  }
  get<S extends RouteSchema | undefined = undefined>(path: string, schema: S | RouteHandler<S, Deps>, handler?: RouteHandler<S, Deps>): this {
    return this.route(path, ['GET'], schema as any, handler as any);
  }
  post<S extends RouteSchema | undefined = undefined>(path: string, schema: S | RouteHandler<S, Deps>, handler?: RouteHandler<S, Deps>): this {
    return this.route(path, ['POST'], schema as any, handler as any);
  }
  put<S extends RouteSchema | undefined = undefined>(path: string, schema: S | RouteHandler<S, Deps>, handler?: RouteHandler<S, Deps>): this {
    return this.route(path, ['PUT'], schema as any, handler as any);
  }
  patch<S extends RouteSchema | undefined = undefined>(path: string, schema: S | RouteHandler<S, Deps>, handler?: RouteHandler<S, Deps>): this {
    return this.route(path, ['PATCH'], schema as any, handler as any);
  }
  delete<S extends RouteSchema | undefined = undefined>(path: string, schema: S | RouteHandler<S, Deps>, handler?: RouteHandler<S, Deps>): this {
    return this.route(path, ['DELETE'], schema as any, handler as any);
  }
  ws(path: string, spec: import('./ws').WsHandlerSpec): this {
    this.app.ws(this.join(this.prefix, path), spec);
    return this;
  }
  sse(path: string, handler: (ctx: Context, stream: SSEStream) => unknown): this {
    this.app.sse(this.join(this.prefix, path), handler);
    return this;
  }
  private join(prefix: string, path: string): string {
    return normalizePath2(prefix + '/' + path);
  }
}

// ==========================================================================
// Handler 类型与封装
// ==========================================================================
export type RouteHandler<S extends RouteSchema, Deps = any> = (
  ctx: RouteCtx<S, Deps>,
  deps: Deps
) => RouterOutput;

export type RouteCtx<S extends RouteSchema, Deps = any> = Context<
  S extends { params: infer P } ? ParamsOf<P> : Record<string, string>,
  S extends { query: infer Q } ? QueryOf<Q> : Record<string, unknown>,
  BodyOf<S extends { body: infer B } ? B : undefined>,
  Deps
>;

interface RouteRecord {
  handler: RouteHandler<any, any>;
  schema: RouteSchema;
  alias?: string;
  routeMw?: CtxMiddleware[];
}

/** 把 handler + schema 校验 + deps 注入 + 响应序列化包成一个中间件 */
function wrapHandler(route: RouteRecord, ctx: Context, resolver?: DepsResolver<any>): () => Promise<void> {
  return async () => {
    // 1) 参数校验
    if (route.schema?.params) {
      const out: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(route.schema.params)) {
        out[k] = v.parse(ctx.params?.[k], ['params', k]);
      }
      ctx.params = Object.assign({}, ctx.params, out) as any;
    }
    // 2) 查询参数校验 + 类型转换
    if (route.schema?.query) {
      const qout: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(route.schema.query)) {
        qout[k] = v.parse(ctx.query?.[k], ['query', k]);
      }
      ctx.query = qout as any;
    }
    // 3) body 解析
    let bodyParsed = false;
    if (route.schema?.body) {
      const parsed = await parseBody(ctx.req, {});
      ctx.markStreaming();
      if (parsed.type === 'multipart' && parsed.value && (parsed.value as any).__binary) {
        // 二进制
      }
      ctx.body = route.schema.body.parse(
        parsed.type === 'json' ? parsed.value : parsed.type === 'multipart' ? parsed.value : parsed.value,
        ['body']
      ) as any;
      bodyParsed = true;
    } else if (hasBody(ctx.method)) {
      // 非 GET，无显式 schema：宽松解析
      const parsed = await parseBody(ctx.req, {});
      ctx.markStreaming();
      ctx.body = (parsed.type === 'json' ? parsed.value : parsed.value) as any;
      if (parsed.type === 'multipart' && parsed.value && !(parsed.value as any).__binary) ctx.files = parsed.value as any;
    }

    // 4) deps
    let deps: any = undefined;
    if (resolver) {
      deps = await resolver(ctx);
      ctx.deps = deps;
      ctx.state = ctx.state ?? {};
    }

    // 5) 调用 handler
    let result = await route.handler(ctx as any, deps);

    // 6) 响应序列化（多出字段剥离 / 缺字段补默认）
    if (route.schema?.response && !ctx.handled && result !== undefined) {
      const resp = route.schema.response;
      ctx.body = result;
      // 根据 schema 剥离：若为对象 schema，仅保留已声明字段
      const cleaned = serializeBySchema(resp, result);
      ctx.json(cleaned);
    } else if (!ctx.handled && result !== undefined) {
      ctx.json(result);
    } else if (!ctx.handled) {
      // 无返回：保持未响应
    }
  };
}

function hasBody(method: string): boolean {
  return !['GET', 'HEAD', 'OPTIONS', 'TRACE'].includes(method);
}

function serializeBySchema(schema: Validator<any>, value: unknown): unknown {
  // 若响应 schema 是对象，剥离开放未知字段
  if (schema && (schema as any).getShape && typeof value === 'object' && value !== null && !Array.isArray(value)) {
    const shape = (schema as any).getShape() as Record<string, Validator<any>>;
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(shape)) {
      if ((value as Record<string, unknown>)[key] !== undefined) {
        out[key] = serializeBySchema(shape[key], (value as Record<string, unknown>)[key]);
      } else if (!shape[key].optional) {
        out[key] = defaultFor(shape[key]);
      }
    }
    return out;
  }
  return value;
}
function defaultFor(v: Validator<any>): unknown {
  try { return v.infer(); } catch { return null; }
}

// ==========================================================================
// utils
// ==========================================================================
function isFunction(x: unknown): boolean {
  return typeof x === 'function';
}

export function joinPath(prefix: string, path: string): string {
  return normalizePath2((prefix ? normalizePath2(prefix) : '') + '/' + path);
}
function normalizePath2(p: string): string {
  return '/' + p.split('/').filter((s) => s !== '').join('/');
}
function normalizeStaticPrefix(p: string): string {
  return p === '/' ? '/' : '/' + p.split('/').filter((s) => s !== '').join('/');
}

function mappableSchema(s: RouteSchema): OpenApiRoute['schema'] {
  return {
    body: s.body?.toOpenAPI(),
    params: s.params ? { params: mapValToOa(s.params) } : undefined,
    query: s.query ? { params: mapValToOa(s.query) } : undefined,
    response: s.response?.toOpenAPI(),
  };
}
function mapValToOa(m: Record<string, Validator<any>>): Record<string, OASchema> {
  const out: Record<string, OASchema> = {};
  for (const [k, v] of Object.entries(m)) out[k] = v.toOpenAPI();
  return out;
}

function mimeType(ext: string): string {
  const map: Record<string, string> = {
    '.html': 'text/html', '.htm': 'text/html', '.css': 'text/css', '.js': 'application/javascript',
    '.mjs': 'application/javascript', '.json': 'application/json', '.png': 'image/png', '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg', '.gif': 'image/gif', '.svg': 'image/svg+xml', '.webp': 'image/webp',
    '.ico': 'image/x-icon', '.txt': 'text/plain', '.xml': 'application/xml', '.pdf': 'application/pdf',
    '.woff': 'font/woff', '.woff2': 'font/woff2', '.wasm': 'application/wasm',
  };
  return map[ext] ?? 'application/octet-stream';
}

function isFileBasedTls(o: unknown): boolean {
  return typeof o === 'object' && o !== null && (!('key' in (o as any)) || !('cert' in (o as any))) && Boolean((o as any).certPath);
}

// HTTP2（同端口 ALPN 降级）
function createHttp2SecureServer(tlsOpts: TlsOptions, handler: (req: any, res: any) => void) {
  const http2 = require('node:http2') as typeof import('node:http2');
  return http2.createSecureServer({ ...tlsOpts, allowHTTP1: true }, handler);
}

// 自签证书生成（仅测试用）
function generateSelfSigned(hostname: string): TlsOptions {
  const forge = selfSignedMini(hostname);
  return { key: forge.key, cert: forge.cert };
}
function selfSignedMini(hostname: string): { key: string; cert: string } {
  // 使用 node 自带的 openssl_private_cert？无可直接调用；提供占位并提示。
  const { execSync } = require('node:child_process');
  const { mkdtempSync } = require('node:fs');
  const { tmpdir } = require('node:os');
  const { join: j } = require('node:path');
  try {
    const dir = mkdtempSync(j(tmpdir(), 'rneo-'));
    const conf = `${require('node:path').resolve(dir)}/openssl.conf`;
    const keyPath = `${dir}/key.pem`;
    const certPath = `${dir}/cert.pem`;
    const confContent = `[req]
distinguished_name = dn
x509_extensions = v3
prompt = no
[dn]
CN = ${hostname}
[req]
[ext]
subjectAltName=@alt
[alt]
DNS.1 = ${hostname}
[v3]
subjectAltName=@alt
`;
    require('node:fs').writeFileSync(conf, confContent);
    execSync(`openssl req -x509 -newkey rsa:2048 -nodes -keyout ${keyPath} -out ${certPath} -days 365 -config ${conf} 2>/dev/null || openssl req -x509 -newkey rsa:2048 -nodes -keyout ${keyPath} -out ${certPath} -days 365 -subj "/CN=${hostname}" 2>/dev/null`, { stdio: 'ignore' });
    return {
      key: readFileSync(keyPath, 'utf8'),
      cert: readFileSync(certPath, 'utf8'),
    };
  } catch {
    throw new Error('selfSigned() requires openssl binary available at runtime');
  }
}

export function createDeps<D>(fn: DepsResolver<D>): DepsResolver<D> {
  return fn;
}

export { t, Validator };
export type { HttpMethod, CtxMiddleware };
export { NetworkBindings as _NetworkBindings };
const NetworkBindings = Object.freeze({});