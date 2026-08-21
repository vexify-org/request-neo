"use strict";
/**
 * 安全（40–45）：cors / helmet 级安全头 / JWT / session / rate limit / CSRF。
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.MemoryRateLimitStore = exports.MemorySessionStore = void 0;
exports.cors = cors;
exports.securityHeaders = securityHeaders;
exports.signJwt = signJwt;
exports.jwt = jwt;
exports.sign = sign;
exports.session = session;
exports.parseCookies = parseCookies;
exports.rateLimit = rateLimit;
exports.csrf = csrf;
const node_crypto_1 = require("node:crypto");
function cors(opts = {}) {
    const origin = opts.origin ?? '*';
    const methods = opts.methods ?? ['GET', 'HEAD', 'PUT', 'PATCH', 'POST', 'DELETE', 'OPTIONS'];
    const allowedHeaders = opts.allowedHeaders;
    const exposedHeaders = opts.exposedHeaders;
    const credentials = opts.credentials ?? false;
    const maxAge = opts.maxAge;
    const optionsStatus = opts.optionsStatus ?? 204;
    return (ctx, next) => {
        const reqOrigin = ctx.header('Origin');
        const h = ctx.res;
        // 处理允许源
        let allowOrigin = false;
        if (origin === '*') {
            allowOrigin = credentials ? (reqOrigin ?? '*') : '*';
        }
        else if (typeof origin === 'string') {
            allowOrigin = origin;
        }
        else if (Array.isArray(origin)) {
            allowOrigin = reqOrigin && origin.includes(reqOrigin) ? reqOrigin : false;
        }
        else if (typeof origin === 'function') {
            const r = origin(reqOrigin ?? '');
            allowOrigin = r === true ? reqOrigin ?? '*' : r === false ? false : Array.isArray(r) ? (reqOrigin && r.includes(reqOrigin) ? reqOrigin : false) : r;
        }
        if (allowOrigin !== false && allowOrigin !== '') {
            h.setHeader('Access-Control-Allow-Origin', String(allowOrigin));
            if (credentials)
                h.setHeader('Access-Control-Allow-Credentials', 'true');
            else
                h.removeHeader('Access-Control-Allow-Credentials');
            if (exposedHeaders)
                h.setHeader('Access-Control-Expose-Headers', exposedHeaders.join(', '));
        }
        if (ctx.method === 'OPTIONS') {
            h.setHeader('Access-Control-Allow-Methods', methods.join(', '));
            if (allowedHeaders)
                h.setHeader('Access-Control-Allow-Headers', (Array.isArray(allowedHeaders) ? allowedHeaders : [allowedHeaders]).join(', '));
            else if (reqOrigin) {
                const reqHeaders = ctx.header('Access-Control-Request-Headers');
                if (reqHeaders)
                    h.setHeader('Access-Control-Allow-Headers', reqHeaders);
            }
            if (maxAge !== undefined)
                h.setHeader('Access-Control-Max-Age', String(maxAge));
            ctx.res.statusCode = optionsStatus;
            ctx.markHandled();
            ctx.res.end();
            return;
        }
        return next();
    };
}
function securityHeaders(opts = {}) {
    const csp = opts.csp ?? "default-src 'self'";
    const hsts = opts.hsts ?? 31536000;
    const noSniff = opts.noSniff ?? true;
    const frameOptions = opts.frameOptions ?? 'DENY';
    const referrerPolicy = opts.referrerPolicy ?? 'no-referrer';
    const crossOriginOpener = opts.crossOriginOpener ?? 'same-origin';
    return (ctx, next) => {
        const h = ctx.res;
        if (csp !== false)
            h.setHeader('Content-Security-Policy', csp);
        if (hsts !== false) {
            const proto = ctx.header('x-forwarded-proto');
            if (!proto || proto === 'https') {
                h.setHeader('Strict-Transport-Security', `max-age=${hsts}; includeSubDomains`);
            }
        }
        if (noSniff)
            h.setHeader('X-Content-Type-Options', 'nosniff');
        if (frameOptions !== false)
            h.setHeader('X-Frame-Options', frameOptions);
        if (referrerPolicy !== false)
            h.setHeader('Referrer-Policy', referrerPolicy);
        if (crossOriginOpener !== false)
            h.setHeader('Cross-Origin-Opener-Policy', crossOriginOpener);
        h.setHeader('X-DNS-Prefetch-Control', 'off');
        if (opts.xPoweredBy)
            h.setHeader('X-Powered-By', 'request-neo');
        else
            h.removeHeader('X-Powered-By');
        return next();
    };
}
const base64Url = (buf) => buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const fromBase64Url = (s) => Buffer.from(s.replace(/-/g, '+').replace(/_/g, '/'), 'base64');
function hmacSign(key, data) {
    return (0, node_crypto_1.createHmac)('sha256', key).update(data).digest();
}
/** 生成 JWT（HS256） */
function signJwt(payload, secret, opts) {
    const now = Math.floor(Date.now() / 1000);
    const header = { alg: 'HS256', typ: 'JWT' };
    const full = { ...payload, iat: now };
    if (opts?.expiresIn) {
        const sec = parseDuration(opts.expiresIn);
        full.exp = now + sec;
    }
    if (opts?.issuer)
        full.iss = opts.issuer;
    if (opts?.audience)
        full.aud = opts.audience;
    const headerB64 = base64Url(Buffer.from(JSON.stringify(header)));
    const payloadB64 = base64Url(Buffer.from(JSON.stringify(full)));
    const sig = hmacSign(secret, `${headerB64}.${payloadB64}`);
    return `${headerB64}.${payloadB64}.${base64Url(sig)}`;
}
function verifyJwt(token, secret, opts) {
    const parts = token.split('.');
    if (parts.length !== 3)
        throw new Error('Malformed token');
    const [hB64, pB64, sB64] = parts;
    const expected = hmacSign(secret, `${hB64}.${pB64}`);
    const supplied = fromBase64Url(sB64);
    if (!safeEqual(expected, supplied))
        throw new Error('Invalid signature');
    const payload = JSON.parse(fromBase64Url(pB64).toString('utf8'));
    const now = Math.floor(Date.now() / 1000);
    if (payload.exp !== undefined && now >= payload.exp)
        throw new Error('Token expired');
    if (payload.nbf !== undefined && now < payload.nbf)
        throw new Error('Token not yet valid');
    if (opts?.issuer && payload.iss !== opts.issuer)
        throw new Error('Invalid issuer');
    if (opts?.audience && payload.aud !== opts.audience)
        throw new Error('Invalid audience');
    return payload;
}
function safeEqual(a, b) {
    const la = a.length, lb = b.length;
    if (la !== lb) {
        (0, node_crypto_1.timingSafeEqual)(a, a);
        return false;
    }
    return (0, node_crypto_1.timingSafeEqual)(a, b);
}
function parseDuration(v) {
    if (typeof v === 'number')
        return v;
    const m = v.match(/^(\d+)([smhd]?)$/);
    if (!m)
        return Number(v) || 0;
    const n = parseInt(m[1], 10);
    switch (m[2]) {
        case 's': return n;
        case 'm': return n * 60;
        case 'h': return n * 3600;
        case 'd': return n * 86400;
        default: return n;
    }
}
/** JWT 中间件（失败自动 401） */
function jwt(opts) {
    const headerName = opts.header ?? 'authorization';
    return (ctx, next) => {
        let token;
        const h = ctx.header(headerName);
        if (h && h.startsWith('Bearer '))
            token = h.slice(7);
        else if (opts.cookie) {
            token = parseCookies(ctx.header('cookie'))?.[opts.cookie];
        }
        if (!token) {
            ctx.res.setHeader('WWW-Authenticate', 'Bearer');
            throw Object.assign(new Error('Unauthorized'), { status: 401 });
        }
        try {
            const payload = verifyJwt(token, opts.secret, { issuer: opts.issuer, audience: opts.audience });
            ctx.state = Object.assign(ctx.state || {}, { user: payload, jwt: payload });
        }
        catch {
            ctx.res.setHeader('WWW-Authenticate', 'Bearer');
            throw Object.assign(new Error('Invalid or expired token'), { status: 401 });
        }
        return next();
    };
}
function sign(payload, secret, opts) {
    return signJwt(payload, secret, opts);
}
class MemorySessionStore {
    map = new Map();
    sweep() {
        const now = Date.now();
        for (const [k, v] of this.map)
            if (v.exp !== 0 && v.exp < now)
                this.map.delete(k);
    }
    async get(id) {
        this.sweep();
        const v = this.map.get(id);
        if (!v)
            return null;
        if (v.exp !== 0 && v.exp < Date.now()) {
            this.map.delete(id);
            return null;
        }
        return { ...v.data };
    }
    async set(id, data, ttlMs = 24 * 3600 * 1000) {
        this.map.set(id, { data: { ...data }, exp: Date.now() + ttlMs });
    }
    async destroy(id) {
        this.map.delete(id);
    }
}
exports.MemorySessionStore = MemorySessionStore;
function session(opts) {
    const name = opts.name ?? 'sid';
    const store = opts.store ?? new MemorySessionStore();
    const maxAge = opts.maxAge ?? 24 * 3600 * 1000;
    const httpOnly = opts.httpOnly ?? true;
    const secure = opts.secure ?? false;
    const sameSite = opts.sameSite ?? 'lax';
    const path = opts.path ?? '/';
    return async (ctx, next) => {
        const cookies = parseCookies(ctx.header('cookie'));
        const sid = cookies?.[name];
        let data = {};
        let isNew = true;
        let realSid = sid || null;
        if (sid && isSignedOk(sid, opts.secret)) {
            const raw = sid.slice(0, sid.lastIndexOf('.'));
            const existing = await store.get(raw);
            if (existing) {
                data = existing;
                realSid = raw;
                isNew = false;
            }
        }
        const sessionObj = {
            get id() { return realSid ?? ''; },
            data,
            async save() {
                const id = realSid ?? (0, node_crypto_1.randomBytes)(16).toString('hex');
                await store.set(id, data, maxAge);
                realSid = id;
                ctx.setHeader('Set-Cookie', serializeCookie(name, signValue(id, opts.secret), {
                    maxAge, httpOnly, secure, sameSite, path,
                }));
            },
            async destroy() {
                if (realSid)
                    await store.destroy(realSid);
                ctx.setHeader('Set-Cookie', serializeCookie(name, '', { maxAge: 0, httpOnly, secure, sameSite, path }));
            },
        };
        ctx.session = sessionObj;
        return next();
    };
}
function parseCookies(header) {
    if (!header)
        return undefined;
    const out = {};
    for (const part of header.split(';')) {
        const idx = part.indexOf('=');
        if (idx > 0) {
            const k = part.slice(0, idx).trim();
            const v = part.slice(idx + 1).trim();
            out[k] = decodeURIComponent(v);
        }
    }
    return out;
}
function isSignedOk(v, secret) {
    const dot = v.lastIndexOf('.');
    if (dot <= 0)
        return false;
    const payload = v.slice(0, dot);
    const sig = v.slice(dot + 1);
    const expected = base64Url((0, node_crypto_1.createHmac)('sha256', secret).update(payload).digest());
    return sig === expected;
}
function signValue(payload, secret) {
    const sig = base64Url((0, node_crypto_1.createHmac)('sha256', secret).update(payload).digest());
    return `${payload}.${sig}`;
}
function serializeCookie(name, value, opts) {
    let out = `${name}=${encodeURIComponent(value)}; Path=${opts.path}`;
    if (opts.maxAge > 0)
        out += `; Max-Age=${Math.floor(opts.maxAge / 1000)}`;
    else if (opts.maxAge === 0)
        out += '; Max-Age=0';
    if (opts.httpOnly)
        out += '; HttpOnly';
    if (opts.secure)
        out += '; Secure';
    if (opts.sameSite)
        out += `; SameSite=${opts.sameSite}`;
    return out;
}
class MemoryRateLimitStore {
    map = new Map();
    async incr(key, windowMs) {
        const now = Date.now();
        let e = this.map.get(key);
        if (!e || e.resetAt <= now) {
            e = { count: 0, resetAt: now + windowMs, window: windowMs, buckets: [] };
            this.map.set(key, e);
        }
        e.count++;
        return { count: e.count, resetAt: e.resetAt };
    }
    async slidingIncr(key) {
        const now = Date.now();
        const window = 60 * 1000;
        let e = this.map.get(key);
        if (!e) {
            e = { count: 0, resetAt: now + window, window, buckets: [] };
            this.map.set(key, e);
        }
        e.buckets.push(now);
        const cutoff = now - window;
        e.buckets = e.buckets.filter((t) => t > cutoff);
        return { count: e.buckets.length };
    }
}
exports.MemoryRateLimitStore = MemoryRateLimitStore;
function rateLimit(opts) {
    const windowMs = opts.windowMs ?? 60 * 1000;
    const max = opts.max ?? 100;
    const store = opts.store ?? new MemoryRateLimitStore();
    const keyGenerator = opts.keyGenerator ?? defaultKeyGen;
    const type = opts.type ?? 'fixed';
    return async (ctx, next) => {
        if (opts.skip && opts.skip(ctx))
            return next();
        const key = keyGenerator(ctx);
        let result;
        if (type === 'sliding' && store.slidingIncr) {
            result = { count: (await store.slidingIncr(key)).count };
        }
        else {
            result = await store.incr(key, windowMs);
        }
        ctx.setHeader('X-RateLimit-Limit', String(max));
        ctx.setHeader('X-RateLimit-Remaining', String(Math.max(0, max - result.count)));
        if (result.resetAt !== undefined) {
            ctx.setHeader('X-RateLimit-Reset', String(Math.ceil((result.resetAt - Date.now()) / 1000)));
        }
        if (result.count > max) {
            const retryAfter = result.resetAt !== undefined ? Math.ceil((result.resetAt - Date.now()) / 1000) : 1;
            ctx.setHeader('Retry-After', String(Math.max(1, retryAfter)));
            opts.onLimit?.(ctx);
            throw Object.assign(new Error('Too many requests'), { status: 429 });
        }
        return next();
    };
}
function defaultKeyGen(ctx) {
    // 优先 token，其次 ip
    const auth = ctx.header('authorization');
    if (auth) {
        try {
            return (0, node_crypto_1.createHash)('md5').update(auth).digest('hex');
        }
        catch { }
    }
    return ctx.ip || 'unknown';
}
function csrf(opts) {
    const cookieName = opts.cookieName ?? '_csrf';
    const headerName = opts.headerName ?? 'x-csrf-token';
    const ignoreMethods = opts.ignoreMethods ?? ['GET', 'HEAD', 'OPTIONS', 'TRACE'];
    const ttlMs = 8 * 3600 * 1000;
    return (ctx, next) => {
        // SSE/WS 除外（无 Cookie 语义或由鉴权覆盖）
        const up = String(ctx.header('upgrade') || '').toLowerCase();
        if (up === 'websocket')
            return next();
        // 首次：下发 token
        const cookies = parseCookies(ctx.header('cookie'));
        let token = cookies?.[cookieName];
        if (ignoreMethods.includes(ctx.method)) {
            // GET 就创建/刷新 cookie
            if (!token || !isValidCsrf(token, opts.secret, ttlMs)) {
                token = newCsrfToken(opts.secret);
            }
            ctx.setHeader('Set-Cookie', serializeCookie(cookieName, token, {
                maxAge: ttlMs, httpOnly: false, secure: false, sameSite: 'strict', path: '/',
            }));
            return next();
        }
        // 校验请求带 token
        if (opts.ignorePaths) {
            for (const re of opts.ignorePaths)
                if (re.test(ctx.url.pathname))
                    return next();
        }
        const got = ctx.header(headerName) || (cookies?.[cookieName]);
        if (!got || !token || got !== token || !isValidCsrf(token, opts.secret, ttlMs)) {
            throw Object.assign(new Error('CSRF token mismatch'), { status: 403 });
        }
        return next();
    };
}
function newCsrfToken(secret) {
    const payload = `${Date.now()}`;
    const sig = base64Url((0, node_crypto_1.createHmac)('sha256', secret).update(payload).digest());
    return `${payload}.${sig}`;
}
function isValidCsrf(token, secret, ttlMs) {
    const dot = token.lastIndexOf('.');
    if (dot <= 0)
        return false;
    const payload = token.slice(0, dot);
    const sig = token.slice(dot + 1);
    const expected = base64Url((0, node_crypto_1.createHmac)('sha256', secret).update(payload).digest());
    if (sig !== expected)
        return false;
    if (Date.now() - Number(payload) > ttlMs)
        return false;
    return true;
}
