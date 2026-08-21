/**
 * 路由层（9–18）：
 * - radix tree（前缀压缩 trie），O(log n) 匹配，不支持时不用正则全遍历
 * - 参数化 /user/:id + 正则约束 /user/:id(\\d+)
 * - 多方法声明、405 + Allow、HEAD 自动推导
 * - 通配 /static/*
 * - 嵌套组、别名、反向 urlFor
 */

import { HttpError } from './errors';

export type HttpMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE' | 'OPTIONS' | 'HEAD';
export const HTTP_METHODS: HttpMethod[] = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS', 'HEAD'];

export interface ParamPart {
  name: string;
  regex?: string;
}
export type PathSegment =
  | { kind: 'static'; value: string }
  | { kind: 'wild'; } // ** or * (通配)
  | { kind: 'param'; name: string; regex?: string };

export interface RouteMatch<T> {
  handler: T;
  params: Record<string, string>;
}

/** 解析路径模板成段序列 */
export function parseSegments(pattern: string): PathSegment[] {
  const segs: PathSegment[] = [];
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
class MethodSet<T> {
  private map = new Map<HttpMethod, T>();
  private methods: HttpMethod[] = [];

  has(m: HttpMethod): boolean {
    return this.map.has(m);
  }
  get(m: HttpMethod): T | undefined {
    return this.map.get(m);
  }
  set(m: HttpMethod, h: T): void {
    this.map.set(m, h);
    if (!this.methods.includes(m)) this.methods.push(m);
  }
  getAllowed(): HttpMethod[] {
    return [...this.methods];
  }
  /** 返回可匹配某方法的 handler（HEAD 自动 fallback GET） */
  resolve(m: HttpMethod): T | undefined {
    if (this.map.has(m)) return this.map.get(m);
    if (m === 'HEAD' && this.map.has('GET')) return this.map.get('GET');
    if (m === 'OPTIONS') return undefined; // OPTIONS 走自动处理
    return undefined;
  }
}

interface RadixNode<T> {
  children: Map<string, RadixNode<T>>;
  paramChild?: { name: string; regex?: string; node: RadixNode<T> };
  wildChild?: { node: RadixNode<T> }; // * 或 ** 通配，吸收后续全部
  handlers: MethodSet<T> | null;
  depth: number;
}

export class RadixTree<T> {
  root: RadixNode<T> = { children: new Map(), handlers: null, depth: 0 };

  private insert(segs: PathSegment[], handler: T, into: RadixNode<T>, depth: number): RadixNode<T> {
    if (segs.length === 0) {
      if (!into.handlers) into.handlers = new MethodSet<T>();
      return into;
    }
    const seg = segs[0];
    const rest = segs.slice(1);

    if (seg.kind === 'param') {
      if (
        !into.paramChild ||
        into.paramChild.name !== seg.name ||
        into.paramChild.regex !== seg.regex
      ) {
        const node: RadixNode<T> = { children: new Map(), handlers: null, depth: depth + 1 };
        into.paramChild = { name: seg.name, regex: seg.regex, node };
      }
      return this.insert(rest, handler, into.paramChild.node, depth + 1);
    }
    if (seg.kind === 'wild') {
      if (!into.wildChild) {
        const node: RadixNode<T> = { children: new Map(), handlers: null, depth: depth + 1 };
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
  add(pattern: string, method: HttpMethod, handler: T): void {
    const segs = parseSegments(pattern);
    const node = this.insert(segs, handler, this.root, 0);
    if (!node.handlers) node.handlers = new MethodSet<T>();
    node.handlers.set(method, handler);
  }

  /**
   * 匹配 URL 段，返回匹配节点（未做方法区分，方法区分交给上层）
   * 匹配顺序：静态 > 参数 > 通配（保证通配为最低优先级）
   */
  match(segments: string[], _ignoreWildTail = false): { node: RadixNode<T>; params: Record<string, string> } | null {
    return this.matchNode(this.root, segments, 0, {});
  }

  private matchNode(
    node: RadixNode<T>,
    segs: string[],
    index: number,
    params: Record<string, string>
  ): { node: RadixNode<T>; params: Record<string, string> } | null {
    if (index >= segs.length) {
      if (node.handlers) return { node, params };
      return null;
    }
    const seg = segs[index];

    // 1) 静态（精确）
    const child = node.children.get(seg);
    if (child) {
      const r = this.matchNode(child, segs, index + 1, params);
      if (r) return r;
    }
    // 2) 参数
    if (node.paramChild) {
      const pc = node.paramChild;
      if (!pc.regex || new RegExp(`^(?:${pc.regex})$`).test(seg)) {
        const next = { ...params, [pc.name]: seg };
        const r = this.matchNode(pc.node, segs, index + 1, next);
        if (r) return r;
      }
    }
    // 3) 通配：吸收 index 及其后所有段
    if (node.wildChild) {
      const rest = segs.slice(index);
      const next = { ...params, ['*']: rest.join('/') };
      const r = this.matchNode(node.wildChild.node, [], 0, next);
      if (r) return r;
    }
    return null;
  }

  /** 收集所有已注册路径（用于 openapi/method 冲突检测） */
  dump(path: string[] = [], node: RadixNode<T> = this.root, out: string[] = []): string[] {
    if (node.handlers) out.push('/' + path.join('/'));
    for (const [k, c] of node.children) this.dump([...path, k], c, out);
    if (node.paramChild) this.dump([...path, `:${node.paramChild.name}`], node.paramChild.node, out);
    if (node.wildChild) this.dump([...path, `*`], node.wildChild.node, out);
    return out;
  }
}

// ---------------------------------------------------------------------------
// 高层 Router：管理方法集与 handler、405、别名、反向 URL
// ---------------------------------------------------------------------------
export interface RouteEntry<T> {
  pattern: string;
  methods: HttpMethod[];
  handler: T;
  alias?: string;
}

export class NeoRouter<T> {
  private tree = new RadixTree<T>();
  private aliases = new Map<string, { pattern: string; paramNames: string[] }>();

  register(pattern: string, methods: HttpMethod | HttpMethod[], handler: T, alias?: string): void {
    const mArr = (Array.isArray(methods) ? methods : [methods]) as HttpMethod[];
    let final = mArr;
    if (methods !== 'HEAD' && (mArr.includes('GET') || mArr.includes('POST') || mArr.includes('PUT') || mArr.includes('PATCH') || mArr.includes('DELETE')))
      final = [...mArr]; // HEAD 自动推导放在 resolve
    for (const m of final) {
      this.tree.add(pattern, m, handler);
    }
    if (alias) {
      const params = parseSegments(pattern)
        .filter((s) => s.kind === 'param')
        .map((s) => (s as { name: string }).name);
      this.aliases.set(alias, { pattern, paramNames: params as string[] });
    }
  }

  /** 匹配路径+方法，返回 handler 与 params；若路径存在但方法不允许则抛 405（带 Allow） */
  resolve(path: string, method: HttpMethod, autoOptions = true): { handler: T; params: Record<string, string> } {
    const segments = path.split('/').filter((s) => s !== '');
    const match = this.tree.match(segments);
    if (!match) throw new HttpError(404, `No route for ${method} ${path}`);
    const ms = match.node.handlers;
    if (!ms || !ms.has(method)) {
      if (autoOptions && method === 'OPTIONS' && ms) {
        return { handler: null as T, params: match.params };
      }
      const allowed = ms ? ms.getAllowed() : [];
      if (method === 'HEAD' && ms?.has('GET')) {
        return { handler: ms.resolve('HEAD') as T, params: match.params };
      }
      // 允许集合：若没有显式注册的方法，给默认
      const allow = allowed.length ? allowed : HTTP_METHODS;
      const err = new HttpError(405, `Method ${method} not allowed`,);
      err.headers = { Allow: allow.filter((m) => m !== 'OPTIONS').join(', ') || 'OPTIONS' };
      throw err;
    }
    const handler = ms.resolve(method);
    if (handler === undefined && method === 'OPTIONS') {
      return { handler: null as T, params: match.params };
    }
    return { handler: handler as T, params: match.params };
  }

  /** Head：路径存在性检查（不抛 405）——用于自动 OPTIONS */
  hasAny(path: string): boolean {
    const segments = path.split('/').filter((s) => s !== '');
    return this.tree.match(segments) !== null;
  }

  methodsFor(path: string): HttpMethod[] | null {
    const segments = path.split('/').filter((s) => s !== '');
    const match = this.tree.match(segments);
    if (!match?.node.handlers) return null;
    return match.node.handlers.getAllowed();
  }

  urlFor(alias: string, params: Record<string, string | number> = {}): string {
    const entry = this.aliases.get(alias);
    if (!entry) throw new Error(`Unknown route alias '${alias}'`);
    let out = entry.pattern;
    for (const p of entry.paramNames) {
      const val = params[p];
      if (val === undefined) throw new Error(`Missing param '${p}' for alias '${alias}'`);
      out = out.replace(`:${p}`, String(val));
    }
    return out;
  }

  /** 遍历所有注册 handler（用于 openapi 与统计） */
  entries(): Array<{ node: any; methods: HttpMethod[] }> {
    const out: Array<{ node: any; methods: HttpMethod[] }> = [];
    this.collect(this.tree.root, out);
    return out;
  }
  private collect(node: any, out: any[]): void {
    if (node.handlers) out.push({ node, methods: node.handlers.getAllowed() });
    node.children.forEach((c: any) => this.collect(c, out));
    if (node.paramChild) this.collect(node.paramChild.node, out);
    if (node.wildChild) this.collect(node.wildChild.node, out);
  }
}