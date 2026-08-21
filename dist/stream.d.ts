/**
 * 传输（5）+ 流（6）：请求体流式解析（JSON / urlencoded / plain / binary），
 * 大文件 multipart 不落地直接 pipe。全部通过长度/类型分流，避免整包进内存。
 */
import type { IncomingMessage } from 'node:http';
export interface BodyParseOptions {
    /** JSON / urlencoded 等结构化体上限（超出则 413） */
    maxBodyBytes?: number;
    /** multipart 缓冲在内存的上限（超出则落盘） */
    maxFieldBytes?: number;
    maxFiles?: number;
    /** multipart 文件落盘目录 */
    uploadDir?: string;
}
export type ParsedBody = {
    type: 'json';
    value: unknown;
} | {
    type: 'urlencoded';
    value: Record<string, unknown>;
} | {
    type: 'text';
    value: string;
} | {
    type: 'multipart';
    value: Record<string, unknown>;
};
/**
 * 流式读取请求体到内存（带上限）。用于 JSON/urlencoded/text。
 */
export declare function readBodyStream(req: IncomingMessage, maxBytes?: number, isBinary?: boolean): Promise<Buffer>;
export declare function detectContentType(req: IncomingMessage): string;
/**
 * 解析请求体（自动按 content-type 分流，尽量流式）。
 * - JSON / urlencoded / plain → 内存缓冲 + JSON.parse
 * - multipart → 流式解析，文件按 maxFieldBytes 区分内存/落盘，不整包进内存
 */
export declare function parseBody(req: IncomingMessage, opts?: BodyParseOptions): Promise<ParsedBody>;
export interface MultipartFile {
    fieldname: string;
    filename: string;
    mime: string;
    size: number;
    path?: string;
    data?: Buffer;
}
