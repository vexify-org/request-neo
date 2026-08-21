/**
 * 可观测（46–49）：pino 风格结构化日志，带 requestId / 耗时 / 路由名上下文。
 */

import type { IncomingMessage } from 'node:http';

type LogLevel = 'trace' | 'debug' | 'info' | 'warn' | 'error' | 'fatal';

interface LogOptions {
  level?: LogLevel;
  pretty?: boolean;
}

export class NeoLogger {
  level: LogLevel = 'info';
  pretty = false;
  private static defaultInstance: NeoLogger;
  private static extraTransports: ((obj: Record<string, unknown>) => void)[] = [];

  constructor(opts?: LogOptions) {
    if (opts) {
      this.level = opts.level ?? 'info';
      this.pretty = opts.pretty ?? false;
    }
  }

  static getDefault(): NeoLogger {
    if (!NeoLogger.defaultInstance) NeoLogger.defaultInstance = new NeoLogger();
    return NeoLogger.defaultInstance;
  }
  /** 注册额外输出（如写文件 / 上传） */
  static addTransport(fn: (obj: Record<string, unknown>) => void): void {
    NeoLogger.extraTransports.push(fn);
  }
  setLevel(l: LogLevel): void {
    this.level = l;
  }

  private ordered: Record<string, number> = { trace: 10, debug: 20, info: 30, warn: 40, error: 50, fatal: 60 };

  private emit(lvl: LogLevel, msg: string, obj?: Record<string, unknown>, ctx?: Record<string, unknown>): void {
    if (this.ordered[lvl] < this.ordered[this.level]) return;
    const rec: Record<string, unknown> = { level: lvl, time: new Date().toISOString(), msg };
    if (ctx) for (const k of Object.keys(ctx)) if (ctx[k] !== undefined) rec[k] = ctx[k];
    if (obj) for (const k of Object.keys(obj)) if (obj[k] !== undefined) rec[k] = obj[k];
    if (lvl === 'error' || lvl === 'fatal') {
      const err = obj?.err ?? obj?.error;
      if (err instanceof Error) {
        rec.err = {
          message: (err as Error).message,
          name: (err as Error).name,
          status: (err as any).status,
          stack: (err as Error).stack,
        };
      } else if (err !== undefined) {
        rec.err = err;
      }
    }
    // 归一化 err 对象再序列化，避免循环引用
    let outLine: string;
    if (this.pretty) {
      outLine = this.prettify(rec);
    } else {
      try {
        outLine = JSON.stringify(rec);
      } catch {
        const safe: Record<string, unknown> = { ...rec, err: String((rec.err as any)?.message ?? rec.err) };
        outLine = JSON.stringify(safe);
      }
    }
    if (lvl === 'error' || lvl === 'fatal') console.error(outLine);
    else console.log(outLine);
    for (const t of NeoLogger.extraTransports) t(rec);
  }

  private prettify(rec: Record<string, unknown>): string {
    const level = String(rec.level).padEnd(5).toUpperCase();
    const time = String(rec.time).slice(0, 23);
    const msg = String(rec.msg);
    const rest: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(rec)) {
      if (['level', 'time', 'msg'].includes(k)) continue;
      rest[k] = v;
    }
    const suffix = Object.keys(rest).length ? ' ' + JSON.stringify(rest) : '';
    return `${time} ${level} ${msg}${suffix}`;
  }

  trace(msg: string, obj?: Record<string, unknown>): void { this.emit('trace', msg, obj); }
  debug(msg: string, obj?: Record<string, unknown>): void { this.emit('debug', msg, obj); }
  info(msg: string, obj?: Record<string, unknown>): void { this.emit('info', msg, obj); }
  warn(msg: string, obj?: Record<string, unknown>): void { this.emit('warn', msg, obj); }
  error(msg: string, obj?: Record<string, unknown>): void { this.emit('error', msg, obj, obj); }
  fatal(msg: string, obj?: Record<string, unknown>): void { this.emit('fatal', msg, obj, obj); }
}

/**
 * 请求级 Logger：自动带 requestId / method / url / 路由名。
 */
export class Logger {
  private requestId: string;
  private req: IncomingMessage;
  private route?: string;
  private built: Record<string, unknown>;

  constructor(requestId: string, req: IncomingMessage, route?: string) {
    this.requestId = requestId;
    this.req = req;
    this.route = route;
    this.built = {
      requestId,
      method: req.method,
      url: req.url,
      route: route,
    };
  }
  setRoute(r?: string): void {
    this.route = r;
    this.built.route = r;
  }
  private ctx(fields?: Record<string, unknown>): Record<string, unknown> {
    const c: Record<string, unknown> = { ...this.built, ...fields };
    for (const k of Object.keys(c)) if (c[k] === undefined) delete c[k];
    return c;
  }

  trace(msg: string, fields?: Record<string, unknown>): void {
    NeoLogger.getDefault().trace(msg, this.ctx(fields));
  }
  debug(msg: string, fields?: Record<string, unknown>): void {
    NeoLogger.getDefault().debug(msg, this.ctx(fields));
  }
  info(msg: string, fields?: Record<string, unknown>): void {
    NeoLogger.getDefault().info(msg, this.ctx(fields));
  }
  warn(msg: string, fields?: Record<string, unknown>): void {
    NeoLogger.getDefault().warn(msg, this.ctx(fields));
  }
  error(msg: string, fields?: Record<string, unknown>): void {
    NeoLogger.getDefault().error(msg, this.ctx(fields));
  }
  fatal(msg: string, fields?: Record<string, unknown>): void {
    NeoLogger.getDefault().fatal(msg, this.ctx(fields));
  }
}

export { NeoLogger as Logger_ };