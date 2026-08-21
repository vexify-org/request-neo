/**
 * 可观测（46–49）：pino 风格结构化日志，带 requestId / 耗时 / 路由名上下文。
 */
import type { IncomingMessage } from 'node:http';
type LogLevel = 'trace' | 'debug' | 'info' | 'warn' | 'error' | 'fatal';
interface LogOptions {
    level?: LogLevel;
    pretty?: boolean;
}
export declare class NeoLogger {
    level: LogLevel;
    pretty: boolean;
    private static defaultInstance;
    private static extraTransports;
    constructor(opts?: LogOptions);
    static getDefault(): NeoLogger;
    /** 注册额外输出（如写文件 / 上传） */
    static addTransport(fn: (obj: Record<string, unknown>) => void): void;
    setLevel(l: LogLevel): void;
    private ordered;
    private emit;
    private prettify;
    trace(msg: string, obj?: Record<string, unknown>): void;
    debug(msg: string, obj?: Record<string, unknown>): void;
    info(msg: string, obj?: Record<string, unknown>): void;
    warn(msg: string, obj?: Record<string, unknown>): void;
    error(msg: string, obj?: Record<string, unknown>): void;
    fatal(msg: string, obj?: Record<string, unknown>): void;
}
/**
 * 请求级 Logger：自动带 requestId / method / url / 路由名。
 */
export declare class Logger {
    private requestId;
    private req;
    private route?;
    private built;
    constructor(requestId: string, req: IncomingMessage, route?: string);
    setRoute(r?: string): void;
    private ctx;
    trace(msg: string, fields?: Record<string, unknown>): void;
    debug(msg: string, fields?: Record<string, unknown>): void;
    info(msg: string, fields?: Record<string, unknown>): void;
    warn(msg: string, fields?: Record<string, unknown>): void;
    error(msg: string, fields?: Record<string, unknown>): void;
    fatal(msg: string, fields?: Record<string, unknown>): void;
}
export { NeoLogger as Logger_ };
