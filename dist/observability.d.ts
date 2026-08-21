/**
 * 可观测（46–50）：结构化日志（见 logger.ts）、OpenAPI 生成、Swagger UI / ReDoc、Prometheus 指标。
 */
import type { OASchema } from './validators';
export interface MetricStore {
    httpRequestsTotal: Map<string, number>;
    httpRequestDurationMs: Map<string, number[]>;
}
export declare function createMetrics(): MetricStore;
/** 序列化 Prometheus 文本格式 */
export declare function renderPrometheus(metrics: MetricStore): string;
export interface OpenApiRoute {
    path: string;
    method: string;
    summary?: string;
    description?: string;
    tags?: string[];
    schema?: {
        query?: {
            params?: Record<string, OASchema>;
        };
        params?: {
            params?: Record<string, OASchema>;
        };
        body?: OASchema;
        response?: OASchema;
    };
}
export interface OpenApiBuilderOptions {
    defaultMethod?: string;
}
export declare function buildOpenApi(routes: OpenApiRoute[], opts?: {
    title?: string;
    version?: string;
    description?: string;
}): Record<string, unknown>;
export declare function swaggerUiHtml(openapiPath: string, title?: string): string;
export declare function reDocHtml(openapiPath: string, title?: string): string;
export interface ObserverImpl {
    recordRequest(method: string, route: string, status: number, ms: number): void;
}
