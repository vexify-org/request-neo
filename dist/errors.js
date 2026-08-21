"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.HttpError = void 0;
exports.normalizeError = normalizeError;
class HttpError extends Error {
    status;
    code;
    details;
    headers;
    expose;
    constructor(status, message, options = {}) {
        super(message ?? defaultMessage(status));
        this.name = 'HttpError';
        this.status = status;
        this.code = options.title ?? codeForStatus(status);
        this.headers = options.headers;
        this.expose = status < 500; // 5xx 不暴露内部细节
        if (options.details !== undefined)
            this.details = options.details;
        if (options.cause !== undefined) {
            try {
                this.cause = options.cause;
            }
            catch { }
        }
    }
    /** 规整后的响应体 */
    toJSON() {
        const out = {};
        out.status = this.status;
        out.error = this.code;
        if (this.expose)
            out.message = this.message;
        if (this.details !== undefined)
            out.details = this.details;
        return out;
    }
    /** 追加一条路径错误，用于数组/对象字段校验 */
    withDetail(fieldPath, reason) {
        const d = Array.isArray(this.details) ? this.details : [];
        const merged = new HttpError(this.status, this.message, {
            title: this.code,
            details: [...d, { field: fieldPath, reason }],
            headers: this.headers,
        });
        return merged;
    }
}
exports.HttpError = HttpError;
function defaultMessage(status) {
    const m = {
        400: 'Bad Request',
        401: 'Unauthorized',
        403: 'Forbidden',
        404: 'Not Found',
        405: 'Method Not Allowed',
        413: 'Payload Too Large',
        415: 'Unsupported Media Type',
        422: 'Unprocessable Entity',
        429: 'Too Many Requests',
        500: 'Internal Server Error',
        503: 'Service Unavailable',
    };
    return m[status] ?? 'HTTP Error';
}
function codeForStatus(status) {
    const m = {
        400: 'bad_request',
        401: 'unauthorized',
        403: 'forbidden',
        404: 'not_found',
        405: 'method_not_allowed',
        413: 'payload_too_large',
        415: 'unsupported_media_type',
        422: 'unprocessable_entity',
        429: 'too_many_requests',
        500: 'internal_server_error',
        503: 'service_unavailable',
    };
    return m[status] ?? 'http_error';
}
/** 把任意 throw 归一为 HttpError（0-9 feature 层统一错误出口） */
function normalizeError(err) {
    if (err instanceof HttpError)
        return err;
    if (err instanceof Error) {
        const e = err;
        const status = e.status ?? e.statusCode;
        if (typeof status === 'number' && status >= 400 && status < 600) {
            return new HttpError(status, e.message);
        }
    }
    // 未捕获异常统一 500，避免泄漏堆栈
    const message = err instanceof Error ? err.message : String(err);
    return new HttpError(500, message);
}
