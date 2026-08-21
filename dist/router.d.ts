/**
 * 路由层（9–18）：
 * - radix tree（前缀压缩 trie），O(log n) 匹配，不支持时不用正则全遍历
 * - 参数化 /user/:id + 正则约束 /user/:id(\\d+)
 * - 多方法声明、405 + Allow、HEAD 自动推导
 * - 通配 /static/*
 * - 嵌套组、别名、反向 urlFor
 */
export type HttpMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE' | 'OPTIONS' | 'HEAD';
export declare const HTTP_METHODS: HttpMethod[];
export interface ParamPart {
    name: string;
    regex?: string;
}
export type PathSegment = {
    kind: 'static';
    value: string;
} | {
    kind: 'wild';
} | {
    kind: 'param';
    name: string;
    regex?: string;
};
export interface RouteMatch<T> {
    handler: T;
    params: Record<string, string>;
}
/** 解析路径模板成段序列 */
export declare function parseSegments(pattern: string): PathSegment[];
declare class MethodSet<T> {
    private map;
    private methods;
    has(m: HttpMethod): boolean;
    get(m: HttpMethod): T | undefined;
    set(m: HttpMethod, h: T): void;
    getAllowed(): HttpMethod[];
    /** 返回可匹配某方法的 handler（HEAD 自动 fallback GET） */
    resolve(m: HttpMethod): T | undefined;
}
interface RadixNode<T> {
    children: Map<string, RadixNode<T>>;
    paramChild?: {
        name: string;
        regex?: string;
        node: RadixNode<T>;
    };
    wildChild?: {
        node: RadixNode<T>;
    };
    handlers: MethodSet<T> | null;
    depth: number;
}
export declare class RadixTree<T> {
    root: RadixNode<T>;
    private insert;
    /** 注册一个完整方法 handler */
    add(pattern: string, method: HttpMethod, handler: T): void;
    /**
     * 匹配 URL 段，返回匹配节点（未做方法区分，方法区分交给上层）
     * 匹配顺序：静态 > 参数 > 通配（保证通配为最低优先级）
     */
    match(segments: string[], _ignoreWildTail?: boolean): {
        node: RadixNode<T>;
        params: Record<string, string>;
    } | null;
    private matchNode;
    /** 收集所有已注册路径（用于 openapi/method 冲突检测） */
    dump(path?: string[], node?: RadixNode<T>, out?: string[]): string[];
}
export interface RouteEntry<T> {
    pattern: string;
    methods: HttpMethod[];
    handler: T;
    alias?: string;
}
export declare class NeoRouter<T> {
    private tree;
    private aliases;
    register(pattern: string, methods: HttpMethod | HttpMethod[], handler: T, alias?: string): void;
    /** 匹配路径+方法，返回 handler 与 params；若路径存在但方法不允许则抛 405（带 Allow） */
    resolve(path: string, method: HttpMethod, autoOptions?: boolean): {
        handler: T;
        params: Record<string, string>;
    };
    /** Head：路径存在性检查（不抛 405）——用于自动 OPTIONS */
    hasAny(path: string): boolean;
    methodsFor(path: string): HttpMethod[] | null;
    urlFor(alias: string, params?: Record<string, string | number>): string;
    /** 遍历所有注册 handler（用于 openapi 与统计） */
    entries(): Array<{
        node: any;
        methods: HttpMethod[];
    }>;
    private collect;
}
export {};
