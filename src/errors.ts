// HttpError：统一异常类型，handler 里 throw 后由框架转为 JSON 响应。
export interface HttpResponse {} // 占位（保持类型引用一致性）

export interface HttpErrorOptions {
  title?: string;
  cause?: unknown;
  headers?: Record<string, string>;
  details?: unknown;
}

export class HttpError extends Error {
  readonly status: number;
  readonly code: string;
  readonly details?: unknown;
  headers?: Record<string, string>;
  readonly expose: boolean;

  constructor(status: number, message?: string, options: HttpErrorOptions = {}) {
    super(message ?? defaultMessage(status));
    this.name = 'HttpError';
    this.status = status;
    this.code = options.title ?? codeForStatus(status);
    this.headers = options.headers;
    this.expose = status < 500; // 5xx 不暴露内部细节
    if (options.details !== undefined) this.details = options.details;
    if (options.cause !== undefined) {
      try {
        (this as any).cause = options.cause;
      } catch {}
    }
  }

  /** 规整后的响应体 */
  toJSON(): Record<string, unknown> {
    const out: Record<string, unknown> = {};
    out.status = this.status;
    out.error = this.code;
    if (this.expose) out.message = this.message;
    if (this.details !== undefined) out.details = this.details;
    return out;
  }

  /** 追加一条路径错误，用于数组/对象字段校验 */
  withDetail(fieldPath: string, reason: string): HttpError {
    const d = Array.isArray(this.details) ? this.details : [];
    const merged = new HttpError(this.status, this.message, {
      title: this.code,
      details: [...d, { field: fieldPath, reason }],
      headers: this.headers,
    });
    return merged;
  }
}

function defaultMessage(status: number): string {
  const m: Record<number, string> = {
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

function codeForStatus(status: number): string {
  const m: Record<number, string> = {
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
export function normalizeError(err: unknown): HttpError {
  if (err instanceof HttpError) return err;
  if (err instanceof Error) {
    const e = err as Error & { status?: number; statusCode?: number };
    const status = e.status ?? e.statusCode;
    if (typeof status === 'number' && status >= 400 && status < 600) {
      return new HttpError(status, e.message);
    }
  }
  // 未捕获异常统一 500，避免泄漏堆栈
  const message = err instanceof Error ? err.message : String(err);
  return new HttpError(500, message);
}

export { };