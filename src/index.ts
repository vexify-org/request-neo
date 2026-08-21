/**
 * request-neo — Powered By Vexify 2026.
 *
 * Flask / FastAPI 味的 Node.js HTTP 框架：协议、路由、校验、中间件、
 * 实时、安全、可观测一体。
 */

import { NeoApp } from './app';

export { NeoApp, RouterGroup } from './app';
export type {
  AppOptions,
  RouteSchema,
  RouteOptions,
  RouteHandler,
  RouteCtx,
  RouterOutput,
  DepsResolver,
} from './app';

export { Context } from './context';
export type { CtxMiddleware } from './context';

export { HttpError, normalizeError } from './errors';
export type { HttpErrorOptions, HttpResponse } from './errors';

export {
  t,
  Validator,
  StrValidator,
  IntValidator,
  FloatValidator,
  BoolValidator,
  ObjValidator,
  ArrValidator,
  FileValidator,
  AnyValidator,
  LiteralValidator,
} from './validators';
export type {
  OASchema,
  Infer,
  InferShape,
  FileDescriptor,
  FileValidatorOpts,
  SchemaShape,
} from './validators';

export { compose } from './middleware';

export { NeoRouter, RadixTree, parseSegments } from './router';
export type { HttpMethod, PathSegment } from './router';

export { parseBody, readBodyStream } from './stream';
export type { BodyParseOptions, ParsedBody, MultipartFile } from './stream';

export { openSSE, streamToSSE } from './sse';
export type { SSEStream, SSEEventOptions, SSEContext } from './sse';

export * from './ws';
export type { WsConnection, WsMessage, WsHandlerSpec, WsHandleOp } from './ws';

export * from './security';
export type {
  CorsOptions,
  SecurityHeadersOptions,
  JwtOptions,
  SessionOptions,
  SessionStore,
  MemorySessionStore,
  RateLimitOptions,
  RateLimitStore,
  CsrfOptions,
} from './security';

export {
  NeoLogger,
  Logger,
} from './logger';

export {
  buildOpenApi,
  renderPrometheus,
  swaggerUiHtml,
  reDocHtml,
  createMetrics,
} from './observability';
export type { OpenApiRoute, MetricStore, OpenApiBuilderOptions } from './observability';

// 包元信息
export const NAME = 'request-neo';
export const VERSION = '2026.1.0';
export const TAGLINE = 'Powered By Vexify 2026';

export default NeoApp;