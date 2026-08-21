"use strict";
/**
 * 路由层（9–18）：
 * - radix tree（前缀压缩 trie），O(log n) 匹配，不支持时不用正则全遍历
 * - 参数化 /user/:id + 正则约束 /user/:id(\\d+)
 * - 多方法声明、405 + Allow、HEAD 自动推导
 * - 通配 /static/*
 * - 嵌套组、别名、反向 urlFor
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.NeoRouter = exports.RadixTree = exports.HTTP_METHODS = void 0;
exports.parseSegments = parseSegments;
const errors_1 = require("./errors");
exports.HTTP_METHODS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS', 'HEAD'];
/** 解析路径模板成段序列 */
function parseSegments(pattern) {
    const segs = [];
    // 按 / 分割，保留空段（如尾斜杠）不影响
    const parts = pattern.split('/').filter((p) => p !== '');
    for (const part of parts) {
        if (part === '*' || part === '**') {
            segs.push({ kind: 'wild' });
            continue;
        }
        const paramMatch = part.match(/^:([A-Za-z0-9_]+)(?:\(([^)]*)\))?$/);
        if (paramMatch) {
            segs.push({ kind: 'param', name: paramMatch[1], regex: paramMatch[2] });
            continue;
        }
        segs.push({ kind: 'static', value: part });
    }
    return segs;
}
// ---------------------------------------------------------------------------
// 每节点持有不同方法的 handler
// ---------------------------------------------------------------------------
class MethodSet {
    map = new Map();
    methods = [];
    has(m) {
        return this.map.has(m);
    }
    get(m) {
        return this.map.get(m);
    }
    set(m, h) {
        this.map.set(m, h);
        if (!this.methods.includes(m))
            this.methods.push(m);
    }
    getAllowed() {
        return [...this.methods];
    }
    /** 返回可匹配某方法的 handler（HEAD 自动 fallback GET） */
    resolve(m) {
        if (this.map.has(m))
            return this.map.get(m);
        if (m === 'HEAD' && this.map.has('GET'))
            return this.map.get('GET');
        if (m === 'OPTIONS')
            return undefined; // OPTIONS 走自动处理
        return undefined;
    }
}
class RadixTree {
    root = { children: new Map(), handlers: null, depth: 0 };
    insert(segs, handler, into, depth) {
        if (segs.length === 0) {
            if (!into.handlers)
                into.handlers = new MethodSet();
            return into;
        }
        const seg = segs[0];
        const rest = segs.slice(1);
        if (seg.kind === 'param') {
            if (!into.paramChild ||
                into.paramChild.name !== seg.name ||
                into.paramChild.regex !== seg.regex) {
                const node = { children: new Map(), handlers: null, depth: depth + 1 };
                into.paramChild = { name: seg.name, regex: seg.regex, node };
            }
            return this.insert(rest, handler, into.paramChild.node, depth + 1);
        }
        if (seg.kind === 'wild') {
            if (!into.wildChild) {
                const node = { children: new Map(), handlers: null, depth: depth + 1 };
                into.wildChild = { node };
            }
            return this.insert(rest, handler, into.wildChild.node, depth + 1);
        }
        // static
        let child = into.children.get(seg.value);
        if (!child) {
            child = { children: new Map(), handlers: null, depth: depth + 1 };
            into.children.set(seg.value, child);
        }
        return this.insert(rest, handler, child, depth + 1);
    }
    /** 注册一个完整方法 handler */
    add(pattern, method, handler) {
        const segs = parseSegments(pattern);
        const node = this.insert(segs, handler, this.root, 0);
        if (!node.handlers)
            node.handlers = new MethodSet();
        node.handlers.set(method, handler);
    }
    /**
     * 匹配 URL 段，返回匹配节点（未做方法区分，方法区分交给上层）
     * 匹配顺序：静态 > 参数 > 通配（保证通配为最低优先级）
     */
    match(segments, _ignoreWildTail = false) {
        return this.matchNode(this.root, segments, 0, {});
    }
    matchNode(node, segs, index, params) {
        if (index >= segs.length) {
            if (node.handlers)
                return { node, params };
            return null;
        }
        const seg = segs[index];
        // 1) 静态（精确）
        const child = node.children.get(seg);
        if (child) {
            const r = this.matchNode(child, segs, index + 1, params);
            if (r)
                return r;
        }
        // 2) 参数
        if (node.paramChild) {
            const pc = node.paramChild;
            if (!pc.regex || new RegExp(`^(?:${pc.regex})$`).test(seg)) {
                const next = { ...params, [pc.name]: seg };
                const r = this.matchNode(pc.node, segs, index + 1, next);
                if (r)
                    return r;
            }
        }
        // 3) 通配：吸收 index 及其后所有段
        if (node.wildChild) {
            const rest = segs.slice(index);
            const next = { ...params, ['*']: rest.join('/') };
            const r = this.matchNode(node.wildChild.node, [], 0, next);
            if (r)
                return r;
        }
        return null;
    }
    /** 收集所有已注册路径（用于 openapi/method 冲突检测） */
    dump(path = [], node = this.root, out = []) {
        if (node.handlers)
            out.push('/' + path.join('/'));
        for (const [k, c] of node.children)
            this.dump([...path, k], c, out);
        if (node.paramChild)
            this.dump([...path, `:${node.paramChild.name}`], node.paramChild.node, out);
        if (node.wildChild)
            this.dump([...path, `*`], node.wildChild.node, out);
        return out;
    }
}
exports.RadixTree = RadixTree;
class NeoRouter {
    tree = new RadixTree();
    aliases = new Map();
    register(pattern, methods, handler, alias) {
        const mArr = (Array.isArray(methods) ? methods : [methods]);
        let final = mArr;
        if (methods !== 'HEAD' && (mArr.includes('GET') || mArr.includes('POST') || mArr.includes('PUT') || mArr.includes('PATCH') || mArr.includes('DELETE')))
            final = [...mArr]; // HEAD 自动推导放在 resolve
        for (const m of final) {
            this.tree.add(pattern, m, handler);
        }
        if (alias) {
            const params = parseSegments(pattern)
                .filter((s) => s.kind === 'param')
                .map((s) => s.name);
            this.aliases.set(alias, { pattern, paramNames: params });
        }
    }
    /** 匹配路径+方法，返回 handler 与 params；若路径存在但方法不允许则抛 405（带 Allow） */
    resolve(path, method, autoOptions = true) {
        const segments = path.split('/').filter((s) => s !== '');
        const match = this.tree.match(segments);
        if (!match)
            throw new errors_1.HttpError(404, `No route for ${method} ${path}`);
        const ms = match.node.handlers;
        if (!ms || !ms.has(method)) {
            if (autoOptions && method === 'OPTIONS' && ms) {
                return { handler: null, params: match.params };
            }
            const allowed = ms ? ms.getAllowed() : [];
            if (method === 'HEAD' && ms?.has('GET')) {
                return { handler: ms.resolve('HEAD'), params: match.params };
            }
            // 允许集合：若没有显式注册的方法，给默认
            const allow = allowed.length ? allowed : exports.HTTP_METHODS;
            const err = new errors_1.HttpError(405, `Method ${method} not allowed`);
            err.headers = { Allow: allow.filter((m) => m !== 'OPTIONS').join(', ') || 'OPTIONS' };
            throw err;
        }
        const handler = ms.resolve(method);
        if (handler === undefined && method === 'OPTIONS') {
            return { handler: null, params: match.params };
        }
        return { handler: handler, params: match.params };
    }
    /** Head：路径存在性检查（不抛 405）——用于自动 OPTIONS */
    hasAny(path) {
        const segments = path.split('/').filter((s) => s !== '');
        return this.tree.match(segments) !== null;
    }
    methodsFor(path) {
        const segments = path.split('/').filter((s) => s !== '');
        const match = this.tree.match(segments);
        if (!match?.node.handlers)
            return null;
        return match.node.handlers.getAllowed();
    }
    urlFor(alias, params = {}) {
        const entry = this.aliases.get(alias);
        if (!entry)
            throw new Error(`Unknown route alias '${alias}'`);
        let out = entry.pattern;
        for (const p of entry.paramNames) {
            const val = params[p];
            if (val === undefined)
                throw new Error(`Missing param '${p}' for alias '${alias}'`);
            out = out.replace(`:${p}`, String(val));
        }
        return out;
    }
    /** 遍历所有注册 handler（用于 openapi 与统计） */
    entries() {
        const out = [];
        this.collect(this.tree.root, out);
        return out;
    }
    collect(node, out) {
        if (node.handlers)
            out.push({ node, methods: node.handlers.getAllowed() });
        node.children.forEach((c) => this.collect(c, out));
        if (node.paramChild)
            this.collect(node.paramChild.node, out);
        if (node.wildChild)
            this.collect(node.wildChild.node, out);
    }
}
exports.NeoRouter = NeoRouter;
