/**
 * request-neo 核心 App。
 *
 * 一个 class 完成：传输（listen/http2/https/ALPN/超时）、路由、校验、中间件洋葱、
 * deps 注入、WS/SSE、静态、安全、OpenAPI/docs、metrics。
 */
import type { Server } from 'node:http';
import type { ConnectionOptions as TlsOptions } from 'node:tls';
import { Context } from './context';
import { type HttpMethod } from './router';
import { type CtxMiddleware } from './middleware';
import { t, Validator } from './validators';
import { type BodyParseOptions } from './stream';
import { type SSEStream } from './sse';
import { type CorsOptions } from './security';
type ParamsOf<S> = S extends undefined ? Record<string, string> : {
    [K in keyof S]: S[K] extends Validator<infer T> ? T : string;
};
type QueryOf<S> = S extends undefined ? Record<string, unknown> : {
    [K in keyof S]: S[K] extends Validator<infer T> ? T : unknown;
};
type BodyOf<S> = S extends undefined ? unknown : S extends Validator<infer T> ? T : unknown;
export interface RouteSchema {
    summary?: string;
    description?: string;
    tags?: string[];
    alias?: string;
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
    log?: {
        level?: 'trace' | 'debug' | 'info' | 'warn' | 'error' | 'fatal';
        pretty?: boolean;
    };
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
    docs?: {
        swagger?: boolean;
        redoc?: boolean;
    };
    metrics?: boolean;
    notFoundMessage?: string;
}
export declare class NeoApp<Deps = Record<string, unknown>> {
    private router;
    private globalMiddleware;
    private groupStack;
    private depsResolver?;
    private wsServer;
    private _wsServerGet;
    private sseRoutes;
    private staticRoutes;
    private routeRecords;
    private options;
    private metricsStore;
    private server?;
    private nextId;
    constructor(userOpts?: AppOptions);
    /** 全局中间件 */
    use(fn: CtxMiddleware): this;
    /** 核心：Flask 式 app.route(path, ['GET','POST'], schema?, handler?) */
    route<S extends RouteSchema>(path: string, methods: HttpMethod | HttpMethod[], schema: S, handler: RouteHandler<S, Deps>, routeOpts?: RouteOptions): this;
    route(path: string, methods: HttpMethod | HttpMethod[], handler: RouteHandler<any, Deps>, routeOpts?: RouteOptions): this;
    private registerRecord;
    get<S extends RouteSchema>(path: string, schema: S, handler: RouteHandler<S, Deps>): this;
    get(path: string, handler: any): this;
    post<S extends RouteSchema>(path: string, schema: S, handler: RouteHandler<S, Deps>): this;
    post(path: string, handler: any): this;
    put<S extends RouteSchema>(path: string, schema: S, handler: RouteHandler<S, Deps>): this;
    put(path: string, handler: any): this;
    patch<S extends RouteSchema>(path: string, schema: S, handler: RouteHandler<S, Deps>): this;
    patch(path: string, handler: any): this;
    delete<S extends RouteSchema>(path: string, schema: S, handler: RouteHandler<S, Deps>): this;
    delete(path: string, handler: any): this;
    all(path: string, handler: RouteHandler<RouteSchema, Deps>): this;
    group(prefix: string, callback: (g: RouterGroup<Deps>) => void, opts?: {
        tags?: string[];
        middleware?: CtxMiddleware[];
    }): this;
    /** 路由组内部注册（被 RouterGroup 调用） */
    _groupRoute(prefix: string, tags: string[], path: string, methods: HttpMethod | HttpMethod[], schema: RouteSchema, handler: RouteHandler<any, Deps>, opts?: RouteOptions & {
        middleware?: CtxMiddleware[];
    }): void;
    _groupUse(mw: CtxMiddleware): void;
    deps(fn: DepsResolver<Deps>): this;
    ws(path: string, spec: import('./ws').WsHandlerSpec): this;
    sse(path: string, handler: (ctx: Context, stream: SSEStream) => unknown, opts?: {
        heartbeatMs?: number;
    }): this;
    static(prefix: string, dir: string): this;
    urlFor(alias: string, params?: Record<string, string | number>): string;
    cors(opts?: CorsOptions): this;
    helmet(opts?: Record<string, unknown>): this;
    jwt(opts: import('./security').JwtOptions): this;
    session(opts: import('./security').SessionOptions): this;
    rateLimit(opts: import('./security').RateLimitOptions): this;
    csrf(opts: import('./security').CsrfOptions): this;
    signJwt(payload: Record<string, unknown>, secret: string, opts?: {
        expiresIn?: string | number;
    }): string;
    listen(port?: number, hostname?: string, callback?: () => void): Server;
    /** HTTPS 一键启用（自签生成或提供证书文件路径热加载） */
    useTls(opts: TlsOptions | {
        certPath?: string;
        keyPath?: string;
    } | {
        caPath?: string;
    }): this;
    private _tlsPaths?;
    private _hotReload;
    /** 自签证书生成（仅用于测试/开发） */
    static selfSigned(hostname?: string): TlsOptions;
    private wired;
    private wireBuiltinRoutes;
    private buildOpenAPI;
    private handleRequest;
    private tryStatic;
    private handleError;
    private afterRequest;
    getOpenApi(): Record<string, unknown>;
    close(callback?: (err?: Error) => void): this;
}
export declare class RouterGroup<Deps> {
    private app;
    private prefix;
    private tags;
    private middleware;
    constructor(app: NeoApp<Deps>, prefix: string, tags: string[], middleware: CtxMiddleware[]);
    use(mw: CtxMiddleware): this;
    route(path: string, methods: HttpMethod | HttpMethod[], schemaOrHandler: any, maybeHandler?: any): this;
    get(path: string, schema: any, handler?: any): this;
    post(path: string, schema: any, handler?: any): this;
    put(path: string, schema: any, handler?: any): this;
    patch(path: string, schema: any, handler?: any): this;
    delete(path: string, schema: any, handler?: any): this;
    ws(path: string, spec: import('./ws').WsHandlerSpec): this;
    sse(path: string, handler: (ctx: Context, stream: SSEStream) => unknown): this;
    private join;
}
export type RouteHandler<S extends RouteSchema, Deps = any> = (ctx: RouteCtx<S, Deps>, deps: Deps) => RouterOutput;
export type RouteCtx<S extends RouteSchema, Deps = any> = Context<S extends {
    params: infer P;
} ? ParamsOf<P> : Record<string, string>, S extends {
    query: infer Q;
} ? QueryOf<Q> : Record<string, unknown>, BodyOf<S extends {
    body: infer B;
} ? B : undefined>, Deps>;
export declare function joinPath(prefix: string, path: string): string;
export declare function createDeps<D>(fn: DepsResolver<D>): DepsResolver<D>;
export { t, Validator };
export type { HttpMethod, CtxMiddleware };
export { NetworkBindings as _NetworkBindings };
declare const NetworkBindings: Readonly<{}>;
