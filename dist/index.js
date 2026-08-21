"use strict";
/**
 * request-neo — Powered By Vexify 2026.
 *
 * Flask / FastAPI 味的 Node.js HTTP 框架：协议、路由、校验、中间件、
 * 实时、安全、可观测一体。
 */
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __exportStar = (this && this.__exportStar) || function(m, exports) {
    for (var p in m) if (p !== "default" && !Object.prototype.hasOwnProperty.call(exports, p)) __createBinding(exports, m, p);
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.TAGLINE = exports.VERSION = exports.NAME = exports.createMetrics = exports.reDocHtml = exports.swaggerUiHtml = exports.renderPrometheus = exports.buildOpenApi = exports.Logger = exports.NeoLogger = exports.streamToSSE = exports.openSSE = exports.readBodyStream = exports.parseBody = exports.parseSegments = exports.RadixTree = exports.NeoRouter = exports.compose = exports.LiteralValidator = exports.AnyValidator = exports.FileValidator = exports.ArrValidator = exports.ObjValidator = exports.BoolValidator = exports.FloatValidator = exports.IntValidator = exports.StrValidator = exports.Validator = exports.t = exports.normalizeError = exports.HttpError = exports.Context = exports.RouterGroup = exports.NeoApp = void 0;
const app_1 = require("./app");
var app_2 = require("./app");
Object.defineProperty(exports, "NeoApp", { enumerable: true, get: function () { return app_2.NeoApp; } });
Object.defineProperty(exports, "RouterGroup", { enumerable: true, get: function () { return app_2.RouterGroup; } });
var context_1 = require("./context");
Object.defineProperty(exports, "Context", { enumerable: true, get: function () { return context_1.Context; } });
var errors_1 = require("./errors");
Object.defineProperty(exports, "HttpError", { enumerable: true, get: function () { return errors_1.HttpError; } });
Object.defineProperty(exports, "normalizeError", { enumerable: true, get: function () { return errors_1.normalizeError; } });
var validators_1 = require("./validators");
Object.defineProperty(exports, "t", { enumerable: true, get: function () { return validators_1.t; } });
Object.defineProperty(exports, "Validator", { enumerable: true, get: function () { return validators_1.Validator; } });
Object.defineProperty(exports, "StrValidator", { enumerable: true, get: function () { return validators_1.StrValidator; } });
Object.defineProperty(exports, "IntValidator", { enumerable: true, get: function () { return validators_1.IntValidator; } });
Object.defineProperty(exports, "FloatValidator", { enumerable: true, get: function () { return validators_1.FloatValidator; } });
Object.defineProperty(exports, "BoolValidator", { enumerable: true, get: function () { return validators_1.BoolValidator; } });
Object.defineProperty(exports, "ObjValidator", { enumerable: true, get: function () { return validators_1.ObjValidator; } });
Object.defineProperty(exports, "ArrValidator", { enumerable: true, get: function () { return validators_1.ArrValidator; } });
Object.defineProperty(exports, "FileValidator", { enumerable: true, get: function () { return validators_1.FileValidator; } });
Object.defineProperty(exports, "AnyValidator", { enumerable: true, get: function () { return validators_1.AnyValidator; } });
Object.defineProperty(exports, "LiteralValidator", { enumerable: true, get: function () { return validators_1.LiteralValidator; } });
var middleware_1 = require("./middleware");
Object.defineProperty(exports, "compose", { enumerable: true, get: function () { return middleware_1.compose; } });
var router_1 = require("./router");
Object.defineProperty(exports, "NeoRouter", { enumerable: true, get: function () { return router_1.NeoRouter; } });
Object.defineProperty(exports, "RadixTree", { enumerable: true, get: function () { return router_1.RadixTree; } });
Object.defineProperty(exports, "parseSegments", { enumerable: true, get: function () { return router_1.parseSegments; } });
var stream_1 = require("./stream");
Object.defineProperty(exports, "parseBody", { enumerable: true, get: function () { return stream_1.parseBody; } });
Object.defineProperty(exports, "readBodyStream", { enumerable: true, get: function () { return stream_1.readBodyStream; } });
var sse_1 = require("./sse");
Object.defineProperty(exports, "openSSE", { enumerable: true, get: function () { return sse_1.openSSE; } });
Object.defineProperty(exports, "streamToSSE", { enumerable: true, get: function () { return sse_1.streamToSSE; } });
__exportStar(require("./ws"), exports);
__exportStar(require("./security"), exports);
var logger_1 = require("./logger");
Object.defineProperty(exports, "NeoLogger", { enumerable: true, get: function () { return logger_1.NeoLogger; } });
Object.defineProperty(exports, "Logger", { enumerable: true, get: function () { return logger_1.Logger; } });
var observability_1 = require("./observability");
Object.defineProperty(exports, "buildOpenApi", { enumerable: true, get: function () { return observability_1.buildOpenApi; } });
Object.defineProperty(exports, "renderPrometheus", { enumerable: true, get: function () { return observability_1.renderPrometheus; } });
Object.defineProperty(exports, "swaggerUiHtml", { enumerable: true, get: function () { return observability_1.swaggerUiHtml; } });
Object.defineProperty(exports, "reDocHtml", { enumerable: true, get: function () { return observability_1.reDocHtml; } });
Object.defineProperty(exports, "createMetrics", { enumerable: true, get: function () { return observability_1.createMetrics; } });
// 包元信息
exports.NAME = 'request-neo';
exports.VERSION = '2026.1.0';
exports.TAGLINE = 'Powered By Vexify 2026';
exports.default = app_1.NeoApp;
