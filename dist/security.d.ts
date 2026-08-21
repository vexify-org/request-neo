/**
 * 安全（40–45）：cors / helmet 级安全头 / JWT / session / rate limit / CSRF。
 */
import type { Context } from './context';
import type { CtxMiddleware } from './context';
export interface CorsOptions {
    origin?: boolean | string | string[] | ((origin: string) => boolean | string | string[]);
    methods?: string[];
    allowedHeaders?: string[];
    exposedHeaders?: string[];
    credentials?: boolean;
    maxAge?: number;
    optionsStatus?: number;
}
export declare function cors(opts?: CorsOptions): CtxMiddleware;
export interface SecurityHeadersOptions {
    csp?: string | false;
    hsts?: number | false;
    noSniff?: boolean;
    frameOptions?: string | false;
    xPoweredBy?: boolean;
    referrerPolicy?: string | false;
    crossOriginOpener?: string | false;
    contentSecurityPolicyReportOnly?: boolean;
}
export declare function securityHeaders(opts?: SecurityHeadersOptions): CtxMiddleware;
export interface JwtOptions {
    secret: string;
    header?: string;
    cookie?: string;
    algorithms?: string[];
    issuer?: string;
    audience?: string;
    expiresIn?: string | number;
}
/** 生成 JWT（HS256） */
export declare function signJwt(payload: Record<string, unknown>, secret: string, opts?: {
    expiresIn?: string | number;
    issuer?: string;
    audience?: string;
}): string;
/** JWT 中间件（失败自动 401） */
export declare function jwt(opts: JwtOptions): CtxMiddleware;
export declare function sign(payload: Record<string, unknown>, secret: string, opts?: {
    expiresIn?: string | number;
}): string;
export interface SessionStore {
    get(id: string): Promise<Record<string, unknown> | null | undefined>;
    set(id: string, data: Record<string, unknown>, ttlMs?: number): Promise<void>;
    destroy(id: string): Promise<void>;
}
export declare class MemorySessionStore implements SessionStore {
    private map;
    private sweep;
    get(id: string): Promise<Record<string, unknown> | null>;
    set(id: string, data: Record<string, unknown>, ttlMs?: number): Promise<void>;
    destroy(id: string): Promise<void>;
}
export interface SessionOptions {
    name?: string;
    secret: string;
    store?: SessionStore;
    maxAge?: number;
    httpOnly?: boolean;
    secure?: boolean;
    sameSite?: 'lax' | 'strict' | 'none';
    path?: string;
}
export declare function session(opts: SessionOptions): CtxMiddleware;
export declare function parseCookies(header?: string): Record<string, string> | undefined;
export interface RateLimitOptions {
    windowMs?: number;
    max?: number;
    store?: RateLimitStore;
    keyGenerator?: (ctx: Context) => string;
    skip?: (ctx: Context) => boolean;
    /** 'fixed' | 'sliding' */
    type?: 'fixed' | 'sliding';
    onLimit?: (ctx: Context) => void;
}
export interface RateLimitStore {
    incr(key: string, windowMs: number): Promise<{
        count: number;
        resetAt: number;
    }>;
    slidingIncr?(key: string): Promise<{
        count: number;
    }>;
}
export declare class MemoryRateLimitStore implements RateLimitStore {
    private map;
    incr(key: string, windowMs: number): Promise<{
        count: number;
        resetAt: number;
    }>;
    slidingIncr(key: string): Promise<{
        count: number;
    }>;
}
export declare function rateLimit(opts: RateLimitOptions): CtxMiddleware;
export interface CsrfOptions {
    secret: string;
    cookieName?: string;
    headerName?: string;
    ignoreMethods?: string[];
    ignorePaths?: RegExp[];
}
export declare function csrf(opts: CsrfOptions): CtxMiddleware;
