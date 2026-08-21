"use strict";
/**
 * 请求上下文：封装 req/res + 路由参数 + 查询 + 流式 body + 响应发送。
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.Context = void 0;
const node_url_1 = require("node:url");
const errors_1 = require("./errors");
const logger_1 = require("./logger");
class Context {
    req;
    res;
    requestId;
    url;
    method;
    started;
    params;
    query;
    /** 依赖注入结果 */
    state;
    deps;
    body;
    files = {};
    rawBody;
    /** 流的当前状态 */
    _streamMode = false;
    _bodyStart = null;
    get stream() {
        return this.req;
    }
    constructor(req, res, requestId, baseUrl) {
        this.req = req;
        this.res = res;
        this.requestId = requestId;
        this.started = Date.now();
        const proto = this.isSecure() ? 'https' : 'http';
        const host = req.headers.host || 'localhost';
        this.url = new node_url_1.URL(`${proto}://${host}` + (req.url ?? '/'));
        this.method = (req.method ?? 'GET').toUpperCase();
        this.params = {};
        this.query = this.parseQuery();
        // 限定读取，流式优化
        this.res.setHeader('X-Request-Id', requestId);
    }
    isSecure() {
        // @ts-ignore socket 上可能带 encrypted 标志（TLS/HTTP2）
        const sock = this.req.socket;
        if (sock?.encrypted === true)
            return true;
        // @ts-ignore HTTP2 头部伪头
        if (this.req.stream && this.req.stream.session?.socket?.encrypted)
            return true;
        return false;
    }
    parseQuery() {
        const out = {};
        for (const [k, v] of this.url.searchParams.entries()) {
            if (v === '') {
                out[k] = true;
            }
            else if (!Number.isNaN(Number(v)) && v.trim() !== '') {
                out[k] = Number(v);
            }
            else if (v === 'true') {
                out[k] = true;
            }
            else if (v === 'false') {
                out[k] = false;
            }
            else {
                out[k] = v;
            }
        }
        const seen = new Set();
        for (const k of this.url.searchParams.keys()) {
            if (seen.has(k)) {
                const all = this.url.searchParams.getAll(k);
                out[k] = all.length === 1 ? all[0] : all;
            }
            seen.add(k);
        }
        return out;
    }
    // ---------------- Headers ----------------
    get headers() {
        return this.req.headers;
    }
    header(name) {
        const v = this.req.headers[name.toLowerCase()];
        return Array.isArray(v) ? v[0] : (v ?? undefined);
    }
    setHeader(name, value) {
        this.res.setHeader(name, value);
        return this;
    }
    get headerNames() {
        return Object.keys(this.req.headers);
    }
    set status(code) {
        this.res.statusCode = code;
    }
    get status() {
        return this.res.statusCode;
    }
    // ---------------- Logging ----------------
    _log;
    _route;
    get log() {
        if (!this._log)
            this._log = new logger_1.Logger(this.requestId, this.req, this._route);
        return this._log;
    }
    set route(v) {
        this._route = v;
        if (this._log)
            this._log.setRoute(v);
    }
    get route() {
        return this._route;
    }
    // ---------------- 流式 body ----------------
    /** 请求体是否分派给流式处理（比如已 pipe） */
    get streaming() {
        return this._streamMode;
    }
    markStreaming() {
        this._streamMode = true;
    }
    setBodySizeHint(n) {
        this._bodyStart = n;
    }
    // ---------------- 响应发送 ----------------
    json(data, status) {
        this.markHandled();
        if (status !== undefined)
            this.res.statusCode = status;
        const body = Buffer.from(JSON.stringify(data));
        this.res.setHeader('Content-Type', 'application/json; charset=utf-8');
        this.res.setHeader('Content-Length', String(body.length));
        this.res.end(body);
        return this;
    }
    text(data, status) {
        this.markHandled();
        if (status !== undefined)
            this.res.statusCode = status;
        const body = Buffer.from(data);
        this.res.setHeader('Content-Type', 'text/plain; charset=utf-8');
        this.res.setHeader('Content-Length', String(body.length));
        this.res.end(body);
        return this;
    }
    send(data, status, type) {
        this.markHandled();
        if (status !== undefined)
            this.res.statusCode = status;
        const buf = Buffer.isBuffer(data) ? data : Buffer.from(String(data));
        if (type)
            this.res.setHeader('Content-Type', type);
        if (!this.res.hasHeader('Content-Length')) {
            this.res.setHeader('Content-Length', String(buf.length));
        }
        this.res.end(buf);
        return this;
    }
    html(data, status) {
        return this.send(data, status, 'text/html; charset=utf-8');
    }
    file(buf, contentType) {
        this.markHandled();
        this.res.setHeader('Content-Type', contentType);
        this.res.setHeader('Content-Length', String(buf.length));
        this.res.end(buf);
        return this;
    }
    /** 流式发送可读流（背压感知，pipe） */
    pipe(stream, contentType = 'application/octet-stream', status = 200) {
        this.markHandled();
        this.res.statusCode = status;
        this.res.setHeader('Content-Type', contentType);
        stream.pipe(this.res);
        return this;
    }
    redirect(url, status = 302) {
        this.markHandled();
        this.res.statusCode = status;
        this.res.setHeader('Location', url);
        this.res.end();
        return this;
    }
    /** 操作为空响应 */
    noContent(status = 204) {
        this.markHandled();
        this.res.statusCode = status;
        this.res.end();
        return this;
    }
    /** 内部：标记响应已开始（避免框架再覆盖） */
    _handled = false;
    markHandled() {
        this._handled = true;
        this._streamMode = true;
    }
    get handled() {
        return this._handled || this.res.writableEnded;
    }
    get ip() {
        return (this.req.socket.remoteAddress || '').replace(/^::ffff:/, '');
    }
    /** 请求体原始输入流（供 multipart 透传使用） */
    bodyStream() {
        return this.req;
    }
    throw(status, message) {
        throw new errors_1.HttpError(status, message);
    }
    // Error 辅助
    error(status, message) {
        return new errors_1.HttpError(status, message);
    }
}
exports.Context = Context;
