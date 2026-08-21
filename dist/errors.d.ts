export interface HttpResponse {
}
export interface HttpErrorOptions {
    title?: string;
    cause?: unknown;
    headers?: Record<string, string>;
    details?: unknown;
}
export declare class HttpError extends Error {
    readonly status: number;
    readonly code: string;
    readonly details?: unknown;
    headers?: Record<string, string>;
    readonly expose: boolean;
    constructor(status: number, message?: string, options?: HttpErrorOptions);
    /** 规整后的响应体 */
    toJSON(): Record<string, unknown>;
    /** 追加一条路径错误，用于数组/对象字段校验 */
    withDetail(fieldPath: string, reason: string): HttpError;
}
/** 把任意 throw 归一为 HttpError（0-9 feature 层统一错误出口） */
export declare function normalizeError(err: unknown): HttpError;
export {};
