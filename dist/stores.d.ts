/**
 * Redis 存储扩展：Session / RateLimit 的可替换持久化 store。
 *
 * 用最小适配器接口解耦具体客户端库（node-redis / ioredis 均可），
 * 不引入硬依赖——需要者自行 npm i redis 或 ioredis 即可。
 */
import type { SessionStore, RateLimitStore } from './security';
/** 兼容 node-redis / ioredis 所需的最小命令子集 */
export interface RedisLike {
    get(key: string): Promise<string | null>;
    set(key: string, value: string, ...args: unknown[]): Promise<unknown>;
    del(...keys: string[]): Promise<unknown>;
    incr(key: string): Promise<number>;
    expire(key: string, seconds: number): Promise<unknown>;
}
/** 会话 key 规则：`<prefix>:<id>` */
export interface RedisStoreOptions {
    client: RedisLike;
    /** key 前缀，默认 `request-neo` */
    prefix?: string;
}
export declare class RedisSessionStore implements SessionStore {
    protected client: RedisLike;
    protected prefix: string;
    constructor(opts: RedisStoreOptions);
    private key;
    get(id: string): Promise<Record<string, unknown> | null>;
    set(id: string, data: Record<string, unknown>, ttlMs?: number): Promise<void>;
    destroy(id: string): Promise<void>;
}
/**
 * Rate limit 使用 Redis 计数器，天然支持多进程/水平扩展。
 *
 * - 固定窗口：INCR + 首次设置 EXPIRE
 * - 滑动窗口：秒级哈希槽，剔除窗口外计数
 */
export declare class RedisRateLimitStore implements RateLimitStore {
    protected client: RedisLike;
    protected prefix: string;
    constructor(opts: RedisStoreOptions);
    private fixedKey;
    incr(key: string, windowMs: number): Promise<{
        count: number;
        resetAt: number;
    }>;
    slidingIncr(key: string): Promise<{
        count: number;
    }>;
}
