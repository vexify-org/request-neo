/**
 * 校验与类型层（19–27）
 *
 * t.str() / t.int() / t.bool() / t.obj() / t.arr() / t.file() ...
 * 链式约束(.opt/.min/.max/.enum/.regex) + 自定义函数 + OpenAPI 提取 + 全链路 TS 类型推断。
 */
import { HttpError } from './errors';
export interface OASchema {
    type?: string;
    properties?: Record<string, OASchema>;
    items?: OASchema;
    required?: string[];
    enum?: unknown[];
    format?: string;
    description?: string;
    minimum?: number;
    maximum?: number;
    minLength?: number;
    maxLength?: number;
    pattern?: string;
    additionalProperties?: boolean | OASchema;
    nullable?: boolean;
    examples?: unknown[];
}
declare class Fail {
    private errors;
    get has(): boolean;
    push(path: string[], reason: string): void;
    throw(): never;
    toError(): HttpError;
}
export declare function to422(errors: {
    path: string[];
    reason: string;
}[]): HttpError;
export declare abstract class Validator<T = unknown> {
    /** 是否可选（嵌套对象中缺省跳过） */
    optional: boolean;
    description?: string;
    protected minC?: number;
    protected maxC?: number;
    protected enumC?: unknown[];
    protected patternC?: string;
    protected customFns: Array<(value: unknown, path: string[]) => unknown>;
    abstract readonly typeName: string;
    abstract infer(): T;
    abstract parseCore(value: unknown, fail: Fail, path: string[]): T;
    abstract toOpenAPI(): OASchema;
    /** 复制自身（链式调用时派生新实例） */
    protected abstract duplicate(): Validator<T>;
    wireType(): string;
    opt(): this;
    desc(text: string): this;
    min(v: number): this;
    max(v: number): this;
    enum(...values: unknown[]): this;
    regex(re: RegExp | string): this;
    /** 自定义校验函数；抛错或返回非 undefined 视为失败 */
    check(fn: (value: T, path: string[]) => T | void): this;
    parse(value: unknown, path?: string[]): T;
    /** 约束失败聚合抛出 */
    protected applyConstraints(oa: OASchema): OASchema;
}
export declare class StrValidator extends Validator<string> {
    readonly typeName = "string";
    private coerce;
    constructor(opts?: {
        coerce?: boolean;
    });
    protected duplicate(): StrValidator;
    infer(): string;
    wireType(): string;
    parseCore(value: unknown, fail: Fail, _path: string[]): string;
    toOpenAPI(): OASchema;
}
export declare class IntValidator extends Validator<number> {
    readonly typeName = "integer";
    private coerce;
    constructor(opts?: {
        coerce?: boolean;
    });
    protected duplicate(): IntValidator;
    infer(): number;
    wireType(): string;
    parseCore(value: unknown, fail: Fail, _path: string[]): number;
    toOpenAPI(): OASchema;
}
export declare class FloatValidator extends Validator<number> {
    readonly typeName = "number";
    private coerce;
    constructor(opts?: {
        coerce?: boolean;
    });
    protected duplicate(): FloatValidator;
    infer(): number;
    wireType(): string;
    parseCore(value: unknown, fail: Fail, _path: string[]): number;
    toOpenAPI(): OASchema;
}
export declare class BoolValidator extends Validator<boolean> {
    readonly typeName = "boolean";
    private coerce;
    constructor(opts?: {
        coerce?: boolean;
    });
    protected duplicate(): BoolValidator;
    infer(): boolean;
    wireType(): string;
    parseCore(value: unknown, fail: Fail, _path: string[]): boolean;
    toOpenAPI(): OASchema;
}
export declare class AnyValidator extends Validator<unknown> {
    readonly typeName = "any";
    protected duplicate(): AnyValidator;
    infer(): unknown;
    parseCore(value: unknown, _fail: Fail, _path: string[]): unknown;
    toOpenAPI(): OASchema;
}
export type InferShape<S extends Record<string, Validator<any>>> = {
    [K in keyof S as S[K]['optional'] extends true ? K : K]: S[K] extends Validator<infer T> ? S[K]['optional'] extends true ? T | undefined : T : unknown;
};
export declare class ObjValidator<S extends Record<string, Validator<any>>> extends Validator<InferShape<S>> {
    readonly typeName = "object";
    private shape;
    private strict;
    constructor(shape: S, opts?: {
        strict?: boolean;
    });
    protected duplicate(): ObjValidator<S>;
    infer(): InferShape<S>;
    wireType(): string;
    /** 供响应剥离子访问 */
    getShape(): S;
    parseCore(value: unknown, fail: Fail, path: string[]): InferShape<S>;
    toOpenAPI(): OASchema;
}
export declare class ArrValidator<E extends Validator<any>> extends Validator<ReturnType<E['infer']>[]> {
    readonly typeName = "array";
    private elem;
    private minLen?;
    private maxLen?;
    constructor(elem: E);
    protected duplicate(): ArrValidator<E>;
    /** 元素数组长度约束 */
    arrMin(n: number): this;
    arrMax(n: number): this;
    infer(): ReturnType<E['infer']>[];
    wireType(): string;
    parseCore(value: unknown, fail: Fail, path: string[]): ReturnType<E['infer']>[];
    toOpenAPI(): OASchema;
}
export interface FileDescriptor {
    fieldname: string;
    filename: string;
    mime: string;
    size: number;
    /** 临时落盘路径（若内存则不存在） */
    path?: string;
    /** 若 size <= maxMemoryBytes 则缓冲在内存，可直接读数据 */
    data?: Buffer;
}
export interface FileValidatorOpts {
    maxSize?: number;
    mime?: string[];
    maxMemoryBytes?: number;
}
export declare class FileValidator extends Validator<FileDescriptor> {
    readonly typeName = "file";
    private opts;
    constructor(opts?: FileValidatorOpts);
    protected duplicate(): FileValidator;
    infer(): FileDescriptor;
    wireType(): string;
    parseCore(value: unknown, fail: Fail, _path: string[]): FileDescriptor;
    toOpenAPI(): OASchema;
}
export declare class LiteralValidator<V extends string | number | boolean> extends Validator<V> {
    readonly typeName = "literal";
    private val;
    constructor(val: V);
    protected duplicate(): LiteralValidator<V>;
    infer(): V;
    parseCore(value: unknown, fail: Fail, path: string[]): V;
    toOpenAPI(): OASchema;
}
export interface SchemaShape extends Record<string, Validator<any>> {
}
export declare const t: {
    str(): StrValidator;
    string(): StrValidator;
    int(): IntValidator;
    integer(): IntValidator;
    num(): FloatValidator;
    float(): FloatValidator;
    bool(): BoolValidator;
    boolean(): BoolValidator;
    any(): AnyValidator;
    obj<S extends SchemaShape>(shape: S, opts?: {
        strict?: boolean;
    }): ObjValidator<S>;
    object<S extends SchemaShape>(shape: S, opts?: {
        strict?: boolean;
    }): ObjValidator<S>;
    arr<E extends Validator<any>>(elem: E): ArrValidator<E>;
    array<E extends Validator<any>>(elem: E): ArrValidator<E>;
    file(opts?: FileValidatorOpts): FileValidator;
    lit<V extends string | number | boolean>(val: V): LiteralValidator<V>;
};
export type Infer<T extends Validator<any>> = T extends Validator<infer U> ? U : unknown;
export {};
