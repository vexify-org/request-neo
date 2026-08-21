"use strict";
/**
 * request-neo 核心 App。
 *
 * 一个 class 完成：传输（listen/http2/https/ALPN/超时）、路由、校验、中间件洋葱、
 * deps 注入、WS/SSE、静态、安全、OpenAPI/docs、metrics。
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports._NetworkBindings = exports.Validator = exports.t = exports.RouterGroup = exports.NeoApp = void 0;
exports.joinPath = joinPath;
exports.createDeps = createDeps;
const node_http_1 = require("node:http");
const node_https_1 = require("node:https");
const node_fs_1 = require("node:fs");
const context_1 = require("./context");
const errors_1 = require("./errors");
const router_1 = require("./router");
const middleware_1 = require("./middleware");
const validators_1 = require("./validators");
Object.defineProperty(exports, "t", { enumerable: true, get: function () { return validators_1.t; } });
Object.defineProperty(exports, "Validator", { enumerable: true, get: function () { return validators_1.Validator; } });
const stream_1 = require("./stream");
const ws_1 = require("./ws");
const sse_1 = require("./sse");
const security_1 = require("./security");
const logger_1 = require("./logger");
const observability_1 = require("./observability");
const node_crypto_1 = require("node:crypto");
const node_fs_2 = require("node:fs");
const node_path_1 = require("node:path");
// ==========================================================================
// App
// ==========================================================================
class NeoApp {
    router = new router_1.NeoRouter();
    globalMiddleware = [];
    groupStack = [];
    depsResolver;
    wsServer = new ws_1.WSServer();
    _wsServerGet() {
        return this.wsServer;
    }
    sseRoutes = new Map();
    staticRoutes = [];
    routeRecords = [];
    options;
    metricsStore = (0, observability_1.createMetrics)();
    server;
    nextId = 1;
    constructor(userOpts = {}) {
        this.options = {
            ...userOpts,
            openapi: { enabled: true, title: 'request-neo API', version: '1.0.0', ...(userOpts.openapi ?? {}) },
            docs: { swagger: true, redoc: true, ...(userOpts.docs ?? {}) },
            metrics: userOpts.metrics ?? true,
        };
        const logger = new logger_1.NeoLogger(userOpts.log ?? {});
        logger_1.NeoLogger.getDefault().level = logger.level;
        logger_1.NeoLogger.getDefault().pretty = logger.pretty;
        // 默认安全头
        if (userOpts.securityHeaders !== false) {
            this.use((0, security_1.securityHeaders)(userOpts.securityHeaders ?? {}));
        }
        if (userOpts.cors === true) {
            this.use((0, security_1.cors)());
        }
        else if (userOpts.cors && typeof userOpts.cors === 'object') {
            this.use((0, security_1.cors)(userOpts.cors));
        }
    }
    // ========================================================================
    // 中间件
    // ========================================================================
    /** 全局中间件 */
    use(fn) {
        this.globalMiddleware.push(fn);
        return this;
    }
    route(path, methods, schemaOrHandler, maybeHandler, routeOpts) {
        const schema = (isFunction(schemaOrHandler) ? {} : schemaOrHandler);
        const handler = (isFunction(schemaOrHandler) ? schemaOrHandler : maybeHandler);
        if (!handler && !isFunction(schemaOrHandler))
            throw new Error('route handler required');
        this.registerRecord(path, methods, schema, handler, routeOpts);
        return this;
    }
    registerRecord(path, methods, schema, handler, opts, inherited) {
        const { prefix = '', tags = [] } = inherited ?? {};
        const pre = prefix || '';
        const fullPath = joinPath(pre, path);
        const mArr = (Array.isArray(methods) ? methods : [methods]);
        const fullSchema = schema;
        const record = { handler, schema: fullSchema, tags: [...tags, ...(schema.tags ?? [])] };
        if (opts?.summary)
            record.summary = opts.summary;
        if (opts?.description)
            record.description = opts.description;
        if (opts?.alias)
            record.alias = opts.alias;
        if (schema.alias)
            record.alias = schema.alias;
        if (opts?.middleware?.length)
            record.routeMw = opts.middleware;
        // 组中间件在全局栈中已由 _groupUse 注册，保持简单
        this.router.register(fullPath, mArr, record, record.alias);
        // 记录 openapi
        this.routeRecords.push({
            path: fullPath,
            method: mArr[0],
            summary: opts?.summary ?? schema.summary,
            description: opts?.description ?? schema.description,
            tags: fullSchema.tags ?? tags,
            schema: mappableSchema(schema),
            alias: opts?.alias,
        });
        if (mArr.includes('GET') && !mArr.includes('HEAD')) {
            this.routeRecords.push({
                path: fullPath, method: 'HEAD', summary: opts?.summary, tags: fullSchema.tags ?? tags,
                schema: mappableSchema(schema),
            });
        }
    }
    get(path, schemaOrHandler, handler) {
        return this.route(path, 'GET', schemaOrHandler, handler);
    }
    post(path, schemaOrHandler, handler) {
        return this.route(path, 'POST', schemaOrHandler, handler);
    }
    put(path, schemaOrHandler, handler) {
        return this.route(path, 'PUT', schemaOrHandler, handler);
    }
    patch(path, schemaOrHandler, handler) {
        return this.route(path, 'PATCH', schemaOrHandler, handler);
    }
    delete(path, schemaOrHandler, handler) {
        return this.route(path, 'DELETE', schemaOrHandler, handler);
    }
    all(path, handler) {
        return this.route(path, router_1.HTTP_METHODS, {}, handler);
    }
    // =====================================================
    // 嵌套路由组（FastAPI Router 味）
    // =====================================================
    group(prefix, callback, opts) {
        const g = new RouterGroup(this, prefix, opts?.tags ?? [], opts?.middleware ?? []);
        callback(g);
        return this;
    }
    /** 路由组内部注册（被 RouterGroup 调用） */
    _groupRoute(prefix, tags, path, methods, schema, handler, opts) {
        void tags;
        this.registerRecord(path, methods, schema, handler, opts, { prefix, tags });
    }
    _groupUse(mw) {
        this.use(mw);
    }
    // ========================================================================
    // 依赖注入
    // ========================================================================
    deps(fn) {
        if (this.depsResolver)
            throw new Error('deps already bound');
        this.depsResolver = fn;
        return this;
    }
    // ========================================================================
    // WebSocket
    // ========================================================================
    ws(path, spec) {
        this.wsServer.route(path, spec);
        return this;
    }
    // ========================================================================
    // SSE
    // ========================================================================
    sse(path, handler, opts) {
        this.sseRoutes.set(normalizePath2(path), { handler, opts });
        return this;
    }
    // ========================================================================
    // 静态 / 反向 URL / 别名
    // ========================================================================
    static(prefix, dir) {
        this.staticRoutes.push({ prefix: normalizeStaticPrefix(prefix), dir: (0, node_path_1.resolve)(dir) });
        return this;
    }
    urlFor(alias, params = {}) {
        return this.router.urlFor(alias, params);
    }
    // ========================================================================
    // 安全快捷
    // ========================================================================
    cors(opts) {
        return this.use((0, security_1.cors)(opts));
    }
    helmet(opts) {
        return this.use((0, security_1.securityHeaders)(opts));
    }
    jwt(opts) {
        return this.use((0, security_1.jwt)(opts));
    }
    session(opts) {
        return this.use((0, security_1.session)(opts));
    }
    rateLimit(opts) {
        return this.use((0, security_1.rateLimit)(opts));
    }
    csrf(opts) {
        return this.use((0, security_1.csrf)(opts));
    }
    signJwt(payload, secret, opts) {
        return require('./security').sign(payload, secret, opts);
    }
    // ========================================================================
    // Listen（HTTP / HTTPS / HTTP2+ALPN）
    // ========================================================================
    listen(port = 3000, hostname, callback) {
        const opts = this.options;
        const tls = this.__tls;
        this.wireBuiltinRoutes();
        let server;
        if (opts.http2 && tls) {
            server = createHttp2SecureServer(tls, this.handleRequest);
        }
        else if (tls) {
            server = (0, node_https_1.createServer)(tls, this.handleRequest);
        }
        else {
            server = (0, node_http_1.createServer)(this.handleRequest);
        }
        this.server = server;
        // 连接级超时 / keep-alive / 最大头大小
        const to = opts.requestTimeout;
        if (to) {
            try {
                server.requestTimeout = to * 1000;
            }
            catch { }
        }
        const headersTimeout = (opts.requestTimeout ?? 60) * 1000;
        try {
            server.headersTimeout = headersTimeout;
        }
        catch { }
        if (opts.keepAliveTimeout) {
            try {
                server.keepAliveTimeout = opts.keepAliveTimeout * 1000;
            }
            catch { }
        }
        if (opts.maxHeaderSize) {
            try {
                server.maxHeadersCount = Math.ceil(opts.maxHeaderSize / 8192);
            }
            catch { }
        }
        // WS 升级
        server.on('upgrade', (req, socket, head) => {
            this.wsServer.handleUpgrade(req, socket, head);
        });
        if (typeof hostname === 'function') {
            callback = hostname;
            hostname = undefined;
        }
        if (typeof hostname === 'number') {
            // hostname 传的是端口
            callback = callback;
        }
        if (hostname)
            server.listen(port, hostname, callback);
        else
            server.listen(port, callback);
        return server;
    }
    /** HTTPS 一键启用（自签生成或提供证书文件路径热加载） */
    useTls(opts) {
        let tlsOpts;
        if (isFileBasedTls(opts)) {
            tlsOpts = {
                cert: (0, node_fs_1.readFileSync)(opts.certPath),
                key: (0, node_fs_1.readFileSync)(opts.keyPath),
                ...(opts.caPath ? { ca: (0, node_fs_1.readFileSync)(opts.caPath) } : {}),
            };
            this._tlsPaths = opts;
        }
        else {
            tlsOpts = opts;
            require('node:https');
        }
        this.__tls = tlsOpts;
        this._hotReload = true;
        return this;
    }
    _tlsPaths;
    _hotReload = false;
    /** 自签证书生成（仅用于测试/开发） */
    static selfSigned(hostname = 'localhost') {
        return generateSelfSigned(hostname);
    }
    // ========================================================================
    // 内置路由：openapi / docs / metrics / 404
    // ========================================================================
    wired = false;
    wireBuiltinRoutes() {
        if (this.wired)
            return;
        this.wired = true;
        const metricsEnabled = this.options.metrics;
        const openapiEnabled = this.options.openapi?.enabled;
        const docSwagger = this.options.docs?.swagger;
        const docRedoc = this.options.docs?.redoc;
        if (openapiEnabled) {
            this.router.register('/openapi.json', 'GET', { handler: (ctx) => {
                    ctx.json(this.buildOpenAPI());
                }, schema: {} }, undefined);
            if (docSwagger) {
                this.router.register('/docs', 'GET', { handler: (ctx) => {
                        ctx.html((0, observability_1.swaggerUiHtml)('/openapi.json', this.options.openapi?.title ?? 'API Docs'));
                    }, schema: {} }, undefined);
                this.router.register('/docs/html', 'GET', { handler: (ctx) => {
                        ctx.html((0, observability_1.swaggerUiHtml)('/openapi.json', this.options.openapi?.title ?? 'API Docs'));
                    }, schema: {} }, undefined);
            }
            if (docRedoc) {
                this.router.register('/redoc', 'GET', { handler: (ctx) => {
                        ctx.html((0, observability_1.reDocHtml)('/openapi.json', this.options.openapi?.title ?? 'API Reference'));
                    }, schema: {} }, undefined);
            }
        }
        if (metricsEnabled) {
            this.router.register('/metrics', 'GET', { handler: (ctx) => {
                    ctx.res.setHeader('Content-Type', 'text/plain; version=0.0.4; charset=utf-8');
                    ctx.send((0, observability_1.renderPrometheus)(this.metricsStore));
                }, schema: {} }, undefined);
        }
    }
    buildOpenAPI() {
        const routes = this.routeRecords.map((r) => ({
            path: r.path,
            method: r.method,
            summary: r.summary,
            description: r.description,
            tags: r.tags ?? [],
            schema: r.schema,
        }));
        return (0, observability_1.buildOpenApi)(routes, {
            title: this.options.openapi?.title,
            version: this.options.openapi?.version,
        });
    }
    // ========================================================================
    // 请求处理
    // ========================================================================
    handleRequest = async (req, res) => {
        const requestId = req.headers['x-request-id'] || (0, node_crypto_1.randomUUID)();
        const ctx = new context_1.Context(req, res, requestId, this.options.baseUrl);
        const started = Date.now();
        const path = ctx.url.pathname;
        try {
            // 解析 URL 路径
            const method = ctx.method;
            // 1) 静态文件
            if (this.tryStatic(ctx, path))
                return;
            // 1.5) SSE 路由（同端口原生 SSE，共享全局中间件鉴权）
            if (method === 'GET') {
                const sseEntry = this.sseRoutes.get(normalizePath2(path));
                if (sseEntry) {
                    const runner = (0, middleware_1.compose)([...this.globalMiddleware]);
                    let authErr = null;
                    try {
                        await runner(ctx);
                        if (ctx.handled)
                            return; // 中间件短路已应答
                    }
                    catch (e) {
                        authErr = (0, errors_1.normalizeError)(e);
                    }
                    if (authErr) {
                        ctx.res.statusCode = authErr.status;
                        ctx.res.setHeader('Content-Type', 'application/json; charset=utf-8');
                        ctx.res.end(JSON.stringify({ ...authErr.toJSON(), requestId: ctx.requestId }));
                        this.afterRequest(ctx, path, 'GET', authErr.status, started);
                        return;
                    }
                    const stream = (0, sse_1.openSSE)(res, { heartbeatMs: sseEntry.opts?.heartbeatMs });
                    (async () => {
                        try {
                            await sseEntry.handler(ctx, stream);
                        }
                        catch (e) {
                            const hn = (0, errors_1.normalizeError)(e);
                            stream.send({ error: hn.code, message: hn.expose ? hn.message : undefined, status: hn.status });
                        }
                    })();
                    this.afterRequest(ctx, path, 'GET', 200, started);
                    return;
                }
            }
            // 2) 路由解析
            let match;
            try {
                match = this.router.resolve(path, method);
            }
            catch (err) {
                // OPTIONS 自动应答
                if (err instanceof errors_1.HttpError && err.status === 405 && method === 'OPTIONS') {
                    ctx.markHandled();
                    const allow = err.headers?.Allow ?? 'GET, POST';
                    ctx.res.statusCode = 204;
                    ctx.setHeader('Allow', allow);
                    ctx.setHeader('Access-Control-Allow-Methods', allow);
                    ctx.res.end();
                    this.afterRequest(ctx, path, method, 204, started);
                    return;
                }
                if (err instanceof errors_1.HttpError && err.status === 405) {
                    ctx.setHeader('Allow', err.headers?.Allow ?? '');
                }
                throw err;
            }
            const route = match.handler;
            ctx.route = route.schema?.summary || path;
            ctx.params = match.params;
            // 3) 组装洋葱栈：全局中间件 + handler（含 schema 校验）
            const stack = [...this.globalMiddleware];
            if (route.routeMw?.length)
                stack.push(...route.routeMw);
            const finalHandler = wrapHandler(route, ctx, this.depsResolver, this.options.body);
            stack.push(async (c, next) => {
                void c;
                await finalHandler();
                await next();
            });
            const runner = (0, middleware_1.compose)(stack);
            await runner(ctx);
            // 若 handler 没写响应
            if (!ctx.handled) {
                ctx.noContent(204);
            }
            this.afterRequest(ctx, path, method, ctx.status, started);
        }
        catch (err) {
            this.handleError(ctx, err);
            this.afterRequest(ctx, path, ctx.method, ctx.status, started);
        }
        finally {
            // finally 钩子：异步资源释放由用户在中间件中通过 try/finally
        }
    };
    tryStatic(ctx, path) {
        for (const { prefix, dir } of this.staticRoutes) {
            if (prefix === '/' || path.startsWith(prefix)) {
                const rel = path.slice(prefix.length).replace(/^\/+/, '');
                const full = (0, node_path_1.join)(dir, rel || 'index.html');
                if ((0, node_fs_2.existsSync)(full)) {
                    try {
                        const st = (0, node_fs_2.statSync)(full);
                        if (st.isFile()) {
                            ctx.markHandled();
                            ctx.res.setHeader('Content-Type', mimeType((0, node_path_1.extname)(full)));
                            ctx.res.setHeader('Content-Length', String(st.size));
                            ctx.res.statusCode = 200;
                            (0, node_fs_2.createReadStream)(full).pipe(ctx.res);
                            return true;
                        }
                    }
                    catch {
                        return false;
                    }
                }
            }
        }
        return false;
    }
    handleError(ctx, err) {
        if (ctx.handled || ctx.res.writableEnded)
            return;
        const httpErr = (0, errors_1.normalizeError)(err);
        const body = { ...httpErr.toJSON(), requestId: ctx.requestId };
        let status = httpErr.status;
        try {
            ctx.res.setHeader('Content-Type', 'application/json; charset=utf-8');
            if (httpErr.headers) {
                for (const [k, v] of Object.entries(httpErr.headers))
                    ctx.res.setHeader(k, v);
            }
            ctx.res.statusCode = status;
            if (httpErr.status === 404 && !httpErr.expose) {
                body.message = this.notFoundMessage ?? 'Not Found';
            }
            ctx.res.end(JSON.stringify(body));
        }
        catch {
            try {
                ctx.res.end(JSON.stringify({ error: 'internal_server_error', message: 'Internal Server Error', status: 500, requestId: ctx.requestId }));
            }
            catch { }
        }
        // 日志
        if (status >= 500) {
            logger_1.NeoLogger.getDefault().error('request error', { err: httpErr, ip: ctx.ip });
        }
    }
    afterRequest(ctx, route, method, status, started) {
        const ms = Date.now() - started;
        // metrics
        if (this.options.metrics) {
            const key = `${method}|${route}|${status}`;
            this.metricsStore.httpRequestsTotal.set(key, (this.metricsStore.httpRequestsTotal.get(key) ?? 0) + 1);
            if (!this.metricsStore.httpRequestDurationMs.has(route))
                this.metricsStore.httpRequestDurationMs.set(route, []);
            const arr = this.metricsStore.httpRequestDurationMs.get(route);
            if (arr.length > 10000)
                arr.shift();
            arr.push(ms);
        }
        // 结构化日志（自带 requestId / 耗时 / 路由）
        logger_1.NeoLogger.getDefault().info('request', { route, method, status, durationMs: ms, ip: ctx.ip, requestId: ctx.requestId });
    }
    // OpenAPI 提取
    getOpenApi() {
        return this.buildOpenAPI();
    }
}
exports.NeoApp = NeoApp;
// ==========================================================================
// RouterGroup
// ==========================================================================
class RouterGroup {
    app;
    prefix;
    tags;
    middleware;
    constructor(app, prefix, tags, middleware) {
        this.app = app;
        this.prefix = prefix;
        this.tags = tags;
        this.middleware = middleware;
        this.app = app;
    }
    use(mw) {
        this.middleware.push(mw);
        this.app._groupUse(mw);
        return this;
    }
    route(path, methods, schemaOrHandler, maybeHandler) {
        const schema = (isFunction(schemaOrHandler) ? {} : schemaOrHandler);
        const handler = (isFunction(schemaOrHandler) ? schemaOrHandler : maybeHandler);
        this.app._groupRoute(this.prefix, this.tags, path, methods, schema, handler, {});
        return this;
    }
    get(path, schema, handler) {
        return this.route(path, ['GET'], schema, handler);
    }
    post(path, schema, handler) {
        return this.route(path, ['POST'], schema, handler);
    }
    put(path, schema, handler) {
        return this.route(path, ['PUT'], schema, handler);
    }
    patch(path, schema, handler) {
        return this.route(path, ['PATCH'], schema, handler);
    }
    delete(path, schema, handler) {
        return this.route(path, ['DELETE'], schema, handler);
    }
    ws(path, spec) {
        this.app.ws(this.join(this.prefix, path), spec);
        return this;
    }
    sse(path, handler) {
        this.app.sse(this.join(this.prefix, path), handler);
        return this;
    }
    join(prefix, path) {
        return normalizePath2(prefix + '/' + path);
    }
}
exports.RouterGroup = RouterGroup;
/** 把 handler + schema 校验 + deps 注入 + 响应序列化包成一个中间件 */
function wrapHandler(route, ctx, resolver, bodyOpts) {
    return async () => {
        // 1) 参数校验
        if (route.schema?.params) {
            const out = {};
            for (const [k, v] of Object.entries(route.schema.params)) {
                out[k] = v.parse(ctx.params?.[k], ['params', k]);
            }
            ctx.params = Object.assign({}, ctx.params, out);
        }
        // 2) 查询参数校验 + 类型转换
        if (route.schema?.query) {
            const qout = {};
            for (const [k, v] of Object.entries(route.schema.query)) {
                qout[k] = v.parse(ctx.query?.[k], ['query', k]);
            }
            ctx.query = qout;
        }
        // 3) body 解析
        if (route.schema?.body) {
            const parsed = await (0, stream_1.parseBody)(ctx.req, bodyOpts);
            ctx.markStreaming();
            ctx.body = route.schema.body.parse(parsed.type === 'multipart' && parsed.value?.__binary ? parsed.value.__binary : parsed.value, ['body']);
        }
        else if (hasBody(ctx.method)) {
            // 非 GET，无显式 schema：宽松解析
            const parsed = await (0, stream_1.parseBody)(ctx.req, bodyOpts);
            ctx.markStreaming();
            ctx.body = parsed.value;
            if (parsed.type === 'multipart' && parsed.value && !parsed.value.__binary)
                ctx.files = parsed.value;
        }
        // 4) deps
        let deps = undefined;
        if (resolver) {
            deps = await resolver(ctx);
            ctx.deps = deps;
            ctx.state = ctx.state ?? {};
        }
        // 5) 调用 handler
        let result = await route.handler(ctx, deps);
        // 6) 响应序列化（多出字段剥离 / 缺字段补默认）
        if (route.schema?.response && !ctx.handled && result !== undefined) {
            const resp = route.schema.response;
            ctx.body = result;
            // 根据 schema 剥离：若为对象 schema，仅保留已声明字段
            const cleaned = serializeBySchema(resp, result);
            ctx.json(cleaned);
        }
        else if (!ctx.handled && result !== undefined) {
            ctx.json(result);
        }
        else if (!ctx.handled) {
            // 无返回：保持未响应
        }
    };
}
function hasBody(method) {
    return !['GET', 'HEAD', 'OPTIONS', 'TRACE'].includes(method);
}
function serializeBySchema(schema, value) {
    // 若响应 schema 是对象，剥离开放未知字段
    if (schema && schema.getShape && typeof value === 'object' && value !== null && !Array.isArray(value)) {
        const shape = schema.getShape();
        const out = {};
        for (const key of Object.keys(shape)) {
            if (value[key] !== undefined) {
                out[key] = serializeBySchema(shape[key], value[key]);
            }
            else if (!shape[key].optional) {
                out[key] = defaultFor(shape[key]);
            }
        }
        return out;
    }
    return value;
}
function defaultFor(v) {
    try {
        return v.infer();
    }
    catch {
        return null;
    }
}
// ==========================================================================
// utils
// ==========================================================================
function isFunction(x) {
    return typeof x === 'function';
}
function joinPath(prefix, path) {
    return normalizePath2((prefix ? normalizePath2(prefix) : '') + '/' + path);
}
function normalizePath2(p) {
    return '/' + p.split('/').filter((s) => s !== '').join('/');
}
function normalizeStaticPrefix(p) {
    return p === '/' ? '/' : '/' + p.split('/').filter((s) => s !== '').join('/');
}
function mappableSchema(s) {
    return {
        body: s.body?.toOpenAPI(),
        params: s.params ? { params: mapValToOa(s.params) } : undefined,
        query: s.query ? { params: mapValToOa(s.query) } : undefined,
        response: s.response?.toOpenAPI(),
    };
}
function mapValToOa(m) {
    const out = {};
    for (const [k, v] of Object.entries(m))
        out[k] = v.toOpenAPI();
    return out;
}
function mimeType(ext) {
    const map = {
        '.html': 'text/html', '.htm': 'text/html', '.css': 'text/css', '.js': 'application/javascript',
        '.mjs': 'application/javascript', '.json': 'application/json', '.png': 'image/png', '.jpg': 'image/jpeg',
        '.jpeg': 'image/jpeg', '.gif': 'image/gif', '.svg': 'image/svg+xml', '.webp': 'image/webp',
        '.ico': 'image/x-icon', '.txt': 'text/plain', '.xml': 'application/xml', '.pdf': 'application/pdf',
        '.woff': 'font/woff', '.woff2': 'font/woff2', '.wasm': 'application/wasm',
    };
    return map[ext] ?? 'application/octet-stream';
}
function isFileBasedTls(o) {
    return typeof o === 'object' && o !== null && (!('key' in o) || !('cert' in o)) && Boolean(o.certPath);
}
// HTTP2（同端口 ALPN 降级）
function createHttp2SecureServer(tlsOpts, handler) {
    const http2 = require('node:http2');
    return http2.createSecureServer({ ...tlsOpts, allowHTTP1: true }, handler);
}
// 自签证书生成（仅测试用）
function generateSelfSigned(hostname) {
    const forge = selfSignedMini(hostname);
    return { key: forge.key, cert: forge.cert };
}
function selfSignedMini(hostname) {
    // 使用 node 自带的 openssl_private_cert？无可直接调用；提供占位并提示。
    const { execSync } = require('node:child_process');
    const { mkdtempSync } = require('node:fs');
    const { tmpdir } = require('node:os');
    const { join: j } = require('node:path');
    try {
        const dir = mkdtempSync(j(tmpdir(), 'rneo-'));
        const conf = `${require('node:path').resolve(dir)}/openssl.conf`;
        const keyPath = `${dir}/key.pem`;
        const certPath = `${dir}/cert.pem`;
        const confContent = `[req]
distinguished_name = dn
x509_extensions = v3
prompt = no
[dn]
CN = ${hostname}
[req]
[ext]
subjectAltName=@alt
[alt]
DNS.1 = ${hostname}
[v3]
subjectAltName=@alt
`;
        require('node:fs').writeFileSync(conf, confContent);
        execSync(`openssl req -x509 -newkey rsa:2048 -nodes -keyout ${keyPath} -out ${certPath} -days 365 -config ${conf} 2>/dev/null || openssl req -x509 -newkey rsa:2048 -nodes -keyout ${keyPath} -out ${certPath} -days 365 -subj "/CN=${hostname}" 2>/dev/null`, { stdio: 'ignore' });
        return {
            key: (0, node_fs_1.readFileSync)(keyPath, 'utf8'),
            cert: (0, node_fs_1.readFileSync)(certPath, 'utf8'),
        };
    }
    catch {
        throw new Error('selfSigned() requires openssl binary available at runtime');
    }
}
function createDeps(fn) {
    return fn;
}
const NetworkBindings = Object.freeze({});
exports._NetworkBindings = NetworkBindings;
