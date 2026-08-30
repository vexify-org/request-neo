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

export class RedisSessionStore implements SessionStore {
  protected client: RedisLike;
  protected prefix: string;

  constructor(opts: RedisStoreOptions) {
    this.client = opts.client;
    this.prefix = opts.prefix ?? 'request-neo';
  }

  private key(id: string): string {
    return `${this.prefix}:session:${id}`;
  }

  async get(id: string): Promise<Record<string, unknown> | null> {
    const raw = await this.client.get(this.key(id));
    if (!raw) return null;
    try {
      return JSON.parse(raw) as Record<string, unknown>;
    } catch {
      return null;
    }
  }

  async set(id: string, data: Record<string, unknown>, ttlMs = 24 * 3600 * 1000): Promise<void> {
    const raw = JSON.stringify(data);
    const ms = Math.floor(ttlMs);
    // node-redis v4 的 set 用额外参数：PX ms；ioredis 同样接受。
    await this.client.set(this.key(id), raw, 'PX', ms);
  }

  async destroy(id: string): Promise<void> {
    await this.client.del(this.key(id));
  }
}

/**
 * Rate limit 使用 Redis 计数器，天然支持多进程/水平扩展。
 *
 * - 固定窗口：INCR + 首次设置 EXPIRE
 * - 滑动窗口：秒级哈希槽，剔除窗口外计数
 */
export class RedisRateLimitStore implements RateLimitStore {
  protected client: RedisLike;
  protected prefix: string;

  constructor(opts: RedisStoreOptions) {
    this.client = opts.client;
    this.prefix = opts.prefix ?? 'request-neo';
  }

  private fixedKey(key: string): string {
    return `${this.prefix}:rl:${key}`;
  }

  async incr(key: string, windowMs: number): Promise<{ count: number; resetAt: number }> {
    const now = Date.now();
    const k = this.fixedKey(key);
    const count = await this.client.incr(k);
    // 首次计数时设置过期（简化为窗口约等于 TTL，避免每次命令数量）
    if (count === 1) {
      await this.client.expire(k, Math.ceil(windowMs / 1000));
    }
    return { count, resetAt: now + windowMs };
  }

  async slidingIncr(key: string): Promise<{ count: number }> {
    const window = 60 * 1000;
    const slot = Math.floor(Date.now() / 1000);
    const bucketKey = `${this.prefix}:rlw:${key}`;
    const slotKey = `${bucketKey}:${slot}`;
    await this.client.incr(slotKey);
    await this.client.expire(slotKey, Math.ceil(window / 1000) + 1);
    // 统计最近 window 秒内所有槽位（模拟滑动窗口，可选用 MGET / SORT 进阶优化）
    let count = 0;
    const nowSlot = slot;
    for (let s = nowSlot - 60; s <= nowSlot; s++) {
      const v = await this.client.get(`${bucketKey}:${s}`);
      if (v) count += Number(v);
    }
    return { count };
  }
}