"use strict";
/**
 * 可观测（46–49）：pino 风格结构化日志，带 requestId / 耗时 / 路由名上下文。
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.Logger_ = exports.Logger = exports.NeoLogger = void 0;
class NeoLogger {
    level = 'info';
    pretty = false;
    static defaultInstance;
    static extraTransports = [];
    constructor(opts) {
        if (opts) {
            this.level = opts.level ?? 'info';
            this.pretty = opts.pretty ?? false;
        }
    }
    static getDefault() {
        if (!NeoLogger.defaultInstance)
            NeoLogger.defaultInstance = new NeoLogger();
        return NeoLogger.defaultInstance;
    }
    /** 注册额外输出（如写文件 / 上传） */
    static addTransport(fn) {
        NeoLogger.extraTransports.push(fn);
    }
    setLevel(l) {
        this.level = l;
    }
    ordered = { trace: 10, debug: 20, info: 30, warn: 40, error: 50, fatal: 60 };
    emit(lvl, msg, obj, ctx) {
        if (this.ordered[lvl] < this.ordered[this.level])
            return;
        const rec = { level: lvl, time: new Date().toISOString(), msg };
        if (ctx)
            for (const k of Object.keys(ctx))
                if (ctx[k] !== undefined)
                    rec[k] = ctx[k];
        if (obj)
            for (const k of Object.keys(obj))
                if (obj[k] !== undefined)
                    rec[k] = obj[k];
        if (lvl === 'error' || lvl === 'fatal') {
            const err = obj?.err ?? obj?.error;
            if (err instanceof Error) {
                rec.err = {
                    message: err.message,
                    name: err.name,
                    status: err.status,
                    stack: err.stack,
                };
            }
            else if (err !== undefined) {
                rec.err = err;
            }
        }
        // 归一化 err 对象再序列化，避免循环引用
        let outLine;
        if (this.pretty) {
            outLine = this.prettify(rec);
        }
        else {
            try {
                outLine = JSON.stringify(rec);
            }
            catch {
                const safe = { ...rec, err: String(rec.err?.message ?? rec.err) };
                outLine = JSON.stringify(safe);
            }
        }
        if (lvl === 'error' || lvl === 'fatal')
            console.error(outLine);
        else
            console.log(outLine);
        for (const t of NeoLogger.extraTransports)
            t(rec);
    }
    prettify(rec) {
        const level = String(rec.level).padEnd(5).toUpperCase();
        const time = String(rec.time).slice(0, 23);
        const msg = String(rec.msg);
        const rest = {};
        for (const [k, v] of Object.entries(rec)) {
            if (['level', 'time', 'msg'].includes(k))
                continue;
            rest[k] = v;
        }
        const suffix = Object.keys(rest).length ? ' ' + JSON.stringify(rest) : '';
        return `${time} ${level} ${msg}${suffix}`;
    }
    trace(msg, obj) { this.emit('trace', msg, obj); }
    debug(msg, obj) { this.emit('debug', msg, obj); }
    info(msg, obj) { this.emit('info', msg, obj); }
    warn(msg, obj) { this.emit('warn', msg, obj); }
    error(msg, obj) { this.emit('error', msg, obj, obj); }
    fatal(msg, obj) { this.emit('fatal', msg, obj, obj); }
}
exports.NeoLogger = NeoLogger;
exports.Logger_ = NeoLogger;
/**
 * 请求级 Logger：自动带 requestId / method / url / 路由名。
 */
class Logger {
    requestId;
    req;
    route;
    built;
    constructor(requestId, req, route) {
        this.requestId = requestId;
        this.req = req;
        this.route = route;
        this.built = {
            requestId,
            method: req.method,
            url: req.url,
            route: route,
        };
    }
    setRoute(r) {
        this.route = r;
        this.built.route = r;
    }
    ctx(fields) {
        const c = { ...this.built, ...fields };
        for (const k of Object.keys(c))
            if (c[k] === undefined)
                delete c[k];
        return c;
    }
    trace(msg, fields) {
        NeoLogger.getDefault().trace(msg, this.ctx(fields));
    }
    debug(msg, fields) {
        NeoLogger.getDefault().debug(msg, this.ctx(fields));
    }
    info(msg, fields) {
        NeoLogger.getDefault().info(msg, this.ctx(fields));
    }
    warn(msg, fields) {
        NeoLogger.getDefault().warn(msg, this.ctx(fields));
    }
    error(msg, fields) {
        NeoLogger.getDefault().error(msg, this.ctx(fields));
    }
    fatal(msg, fields) {
        NeoLogger.getDefault().fatal(msg, this.ctx(fields));
    }
}
exports.Logger = Logger;
