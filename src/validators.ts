/**
 * 校验与类型层（19–27）
 *
 * t.str() / t.int() / t.bool() / t.obj() / t.arr() / t.file() ...
 * 链式约束(.opt/.min/.max/.enum/.regex) + 自定义函数 + OpenAPI 提取 + 全链路 TS 类型推断。
 */

import { HttpError } from './errors';

// ---------------------------------------------------------------------------
// OpenAPI 3.1 schema 描述
// ---------------------------------------------------------------------------
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

// ---------------------------------------------------------------------------
// Fail 累积器（对象/数组嵌套时聚合字段错误，输出 HttpError(422)）
// ---------------------------------------------------------------------------
class Fail {
  private errors: { path: string[]; reason: string }[] = [];
  get has(): boolean {
    return this.errors.length > 0;
  }
  push(path: string[], reason: string): void {
    this.errors.push({ path, reason });
  }
  throw(): never {
    throw to422(this.errors);
  }
  toError(): HttpError {
    return to422(this.errors);
  }
}

export function to422(errors: { path: string[]; reason: string }[]): HttpError {
  return new HttpError(422, 'request validation failed', {
    details: errors.map((e) => ({ field: e.path.join('.') || '.', reason: e.reason })),
  });
}

// ---------------------------------------------------------------------------
// Validator 基类
// ---------------------------------------------------------------------------
export abstract class Validator<T = unknown> {
  /** 是否可选（嵌套对象中缺省跳过） */
  optional = false;
  description?: string;

  protected minC?: number;
  protected maxC?: number;
  protected enumC?: unknown[];
  protected patternC?: string;
  protected customFns: Array<(value: unknown, path: string[]) => unknown> = [];

  abstract readonly typeName: string;
  abstract infer(): T;
  abstract parseCore(value: unknown, fail: Fail, path: string[]): T;
  abstract toOpenAPI(): OASchema;

  /** 复制自身（链式调用时派生新实例） */
  protected abstract duplicate(): Validator<T>;

  wireType(): string {
    return 'string';
  }

  // ---------------- 链式约束 ----------------
  opt(): this {
    const c = this.duplicate();
    c.optional = true;
    return c as this;
  }
  desc(text: string): this {
    const c = this.duplicate();
    c.description = text;
    return c as this;
  }
  min(v: number): this {
    const c = this.duplicate();
    c.minC = v;
    return c as this;
  }
  max(v: number): this {
    const c = this.duplicate();
    c.maxC = v;
    return c as this;
  }
  enum(...values: unknown[]): this {
    const c = this.duplicate();
    c.enumC = values;
    return c as this;
  }
  regex(re: RegExp | string): this {
    const c = this.duplicate();
    c.patternC = re instanceof RegExp ? re.source : re;
    return c as this;
  }
  /** 自定义校验函数；抛错或返回非 undefined 视为失败 */
  check(fn: (value: T, path: string[]) => T | void): this {
    const c = this.duplicate();
    c.customFns = [...this.customFns, fn as (value: unknown, path: string[]) => unknown];
    return c as this;
  }

  // ---------------- 统一入口 ----------------
  parse(value: unknown, path: string[] = []): T {
    if (value === undefined || value === null) {
      if (this.optional) return undefined as T;
      const f = new Fail();
      f.push(path, 'field is required' + (value === null ? ' (got null)' : ''));
      f.throw();
    }
    const fail = new Fail();
    const coerced = this.parseCore(value, fail, path);
    if (fail.has) fail.throw();

    // 链式约束（作用于单个标量）
    if (typeof coerced === 'number' && !Number.isNaN(coerced)) {
      if (this.minC !== undefined && coerced < this.minC) {
        const f = new Fail(); f.push(path, `must be >= ${this.minC}`); f.throw();
      }
      if (this.maxC !== undefined && coerced > this.maxC) {
        const f = new Fail(); f.push(path, `must be <= ${this.maxC}`); f.throw();
      }
    }
    if (typeof coerced === 'string') {
      if (this.minC !== undefined && coerced.length < this.minC) {
        const f = new Fail(); f.push(path, `length must be >= ${this.minC}`); f.throw();
      }
      if (this.maxC !== undefined && coerced.length > this.maxC) {
        const f = new Fail(); f.push(path, `length must be <= ${this.maxC}`); f.throw();
      }
      if (this.patternC !== undefined && !new RegExp(this.patternC).test(coerced)) {
        const f = new Fail(); f.push(path, `must match pattern: ${this.patternC}`); f.throw();
      }
    }
    if (this.enumC !== undefined) {
      const ok = this.enumC.some((e) => e === coerced || String(e) === String(coerced));
      if (!ok) {
        const f = new Fail(); f.push(path, `must be one of: ${this.enumC.join(', ')}`); f.throw();
      }
    }
    // 自定义函数
    let val: unknown = coerced;
    for (const fn of this.customFns) {
      const r: unknown = fn(val, path);
      if (r !== undefined) val = r;
    }
    return val as T;
  }

  /** 约束失败聚合抛出 */
  protected applyConstraints(oa: OASchema): OASchema {
    if (this.description !== undefined) oa.description = this.description;
    if (this.enumC !== undefined) oa.enum = this.enumC;
    return oa;
  }
}

// ---------------------------------------------------------------------------
// 标量校验器
// ---------------------------------------------------------------------------
export class StrValidator extends Validator<string> {
  readonly typeName = 'string';
  private coerce: boolean;
  constructor(opts?: { coerce?: boolean }) {
    super();
    this.coerce = opts?.coerce ?? true;
  }
  protected duplicate(): StrValidator {
    const c = new StrValidator({ coerce: this.coerce });
    c.minC = this.minC; c.maxC = this.maxC; c.enumC = this.enumC;
    c.patternC = this.patternC; c.customFns = this.customFns;
    return c;
  }
  infer(): string {
    return '' as string;
  }
  wireType(): string {
    return 'string';
  }
  parseCore(value: unknown, fail: Fail, _path: string[]): string {
    if (typeof value === 'string') return value;
    if (this.coerce && (typeof value === 'number' || typeof value === 'boolean' || value === null)) {
      return String(value);
    }
    fail.push(_path, 'expected a string');
    return '';
  }
  toOpenAPI(): OASchema {
    const oa: OASchema = { type: 'string' };
    if (this.minC !== undefined) oa.minLength = this.minC;
    if (this.maxC !== undefined) oa.maxLength = this.maxC;
    if (this.patternC !== undefined) oa.pattern = this.patternC;
    return this.applyConstraints(oa);
  }
}

export class IntValidator extends Validator<number> {
  readonly typeName = 'integer';
  private coerce: boolean;
  constructor(opts?: { coerce?: boolean }) {
    super();
    this.coerce = opts?.coerce ?? true;
  }
  protected duplicate(): IntValidator {
    const c = new IntValidator({ coerce: this.coerce });
    c.minC = this.minC; c.maxC = this.maxC; c.enumC = this.enumC;
    c.customFns = this.customFns;
    return c;
  }
  infer(): number {
    return 0 as number;
  }
  wireType(): string {
    return 'integer';
  }
  parseCore(value: unknown, fail: Fail, _path: string[]): number {
    const num = (() => {
      if (typeof value === 'number') return value;
      if (this.coerce && typeof value === 'string') {
        if (value.trim() === '') return NaN;
        return Number(value);
      }
      return NaN;
    })();
    if (Number.isNaN(num) || !Number.isInteger(num)) {
      fail.push(_path, 'expected an integer');
      return NaN;
    }
    return num;
  }
  toOpenAPI(): OASchema {
    const oa: OASchema = { type: 'integer' };
    if (this.minC !== undefined) oa.minimum = this.minC;
    if (this.maxC !== undefined) oa.maximum = this.maxC;
    return this.applyConstraints(oa);
  }
}

export class FloatValidator extends Validator<number> {
  readonly typeName = 'number';
  private coerce: boolean;
  constructor(opts?: { coerce?: boolean }) {
    super();
    this.coerce = opts?.coerce ?? true;
  }
  protected duplicate(): FloatValidator {
    const c = new FloatValidator({ coerce: this.coerce });
    c.minC = this.minC; c.maxC = this.maxC; c.enumC = this.enumC;
    c.customFns = this.customFns;
    return c;
  }
  infer(): number {
    return 0 as number;
  }
  wireType(): string {
    return 'float';
  }
  parseCore(value: unknown, fail: Fail, _path: string[]): number {
    const num = (() => {
      if (typeof value === 'number') return value;
      if (this.coerce && typeof value === 'string') {
        return Number(value);
      }
      return NaN;
    })();
    if (Number.isNaN(num)) {
      fail.push(_path, 'expected a number');
      return NaN;
    }
    return num;
  }
  toOpenAPI(): OASchema {
    const oa: OASchema = { type: 'number' };
    if (this.minC !== undefined) oa.minimum = this.minC;
    if (this.maxC !== undefined) oa.maximum = this.maxC;
    return this.applyConstraints(oa);
  }
}

export class BoolValidator extends Validator<boolean> {
  readonly typeName = 'boolean';
  private coerce: boolean;
  constructor(opts?: { coerce?: boolean }) {
    super();
    this.coerce = opts?.coerce ?? true;
  }
  protected duplicate(): BoolValidator {
    const c = new BoolValidator({ coerce: this.coerce });
    c.minC = this.minC; c.maxC = this.maxC; c.enumC = this.enumC;
    c.customFns = this.customFns;
    return c;
  }
  infer(): boolean {
    return true as boolean;
  }
  wireType(): string {
    return 'boolean';
  }
  parseCore(value: unknown, fail: Fail, _path: string[]): boolean {
    if (typeof value === 'boolean') return value;
    if (this.coerce && typeof value === 'string') {
      if (value === 'true' || value === '1' || value === 'on') return true;
      if (value === 'false' || value === '0' || value === 'off') return false;
      fail.push(_path, 'expected a boolean');
      return false;
    }
    fail.push(_path, 'expected a boolean');
    return false;
  }
  toOpenAPI(): OASchema {
    return this.applyConstraints({ type: 'boolean' });
  }
}

export class AnyValidator extends Validator<unknown> {
  readonly typeName = 'any';
  protected duplicate(): AnyValidator {
    const c = new AnyValidator();
    c.optional = this.optional; c.description = this.description;
    c.customFns = this.customFns;
    return c;
  }
  infer(): unknown {
    return undefined as unknown;
  }
  parseCore(value: unknown, _fail: Fail, _path: string[]): unknown {
    return value;
  }
  toOpenAPI(): OASchema {
    return this.applyConstraints({});
  }
}

// ---------------------------------------------------------------------------
// 复合校验器：对象 / 数组
// ---------------------------------------------------------------------------
export type InferShape<S extends Record<string, Validator<any>>> = {
  [K in keyof S as S[K]['optional'] extends true ? K : K]: S[K] extends Validator<infer T>
    ? S[K]['optional'] extends true
      ? T | undefined
      : T
    : unknown;
};

export class ObjValidator<S extends Record<string, Validator<any>>> extends Validator<InferShape<S>> {
  readonly typeName = 'object';
  private shape: S;
  private strict: boolean;
  constructor(shape: S, opts?: { strict?: boolean }) {
    super();
    this.shape = shape;
    this.strict = opts?.strict ?? true;
  }
  protected duplicate(): ObjValidator<S> {
    const c = new ObjValidator(this.shape, { strict: this.strict }) as ObjValidator<S>;
    c.optional = this.optional; c.customFns = this.customFns; c.description = this.description;
    return c;
  }
  infer(): InferShape<S> {
    return {} as InferShape<S>;
  }
  wireType(): string {
    return 'object';
  }
  /** 供响应剥离子访问 */
  getShape(): S {
    return this.shape;
  }
  parseCore(value: unknown, fail: Fail, path: string[]): InferShape<S> {
    if (typeof value !== 'object' || value === null || Array.isArray(value)) {
      fail.push(path, 'expected an object');
      return {} as InferShape<S>;
    }
    const src = value as Record<string, unknown>;
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(this.shape)) {
      const v = this.shape[key];
      const sub = v.parse(src[key], [...path, key]);
      if (sub !== undefined) out[key] = sub;
    }
    if (!this.strict) {
      for (const key of Object.keys(src)) {
        if (!(key in this.shape)) out[key] = src[key];
      }
    }
    return out as InferShape<S>;
  }
  toOpenAPI(): OASchema {
    const properties: Record<string, OASchema> = {};
    const required: string[] = [];
    for (const key of Object.keys(this.shape)) {
      const v = this.shape[key];
      properties[key] = v.toOpenAPI();
      if (!v.optional) required.push(key);
    }
    return this.applyConstraints({
      type: 'object',
      properties,
      required: required.length ? required : undefined,
      additionalProperties: this.strict ? false : undefined,
    });
  }
}

export class ArrValidator<E extends Validator<any>> extends Validator<E['infer'][]> {
  readonly typeName = 'array';
  private elem: E;
  private minLen?: number;
  private maxLen?: number;
  constructor(elem: E) {
    super();
    this.elem = elem;
  }
  protected duplicate(): ArrValidator<E> {
    const c = new ArrValidator<E>(this.elem);
    c.optional = this.optional; c.customFns = this.customFns; c.description = this.description;
    c.minLen = this.minLen; c.maxLen = this.maxLen;
    return c;
  }
  /** 元素数组长度约束 */
  arrMin(n: number): this {
    const c = this.duplicate(); c.minLen = n; return c as this;
  }
  arrMax(n: number): this {
    const c = this.duplicate(); c.maxLen = n; return c as this;
  }
  infer(): E['infer'][] {
    return [] as E['infer'][];
  }
  wireType(): string {
    return 'array';
  }
  parseCore(value: unknown, fail: Fail, path: string[]): E['infer'][] {
    if (!Array.isArray(value)) {
      fail.push(path, 'expected an array');
      return [];
    }
    const out: E['infer'][] = [];
    for (let i = 0; i < value.length; i++) {
      const sub = this.elem.parse(value[i], [...path, String(i)]);
      if (sub !== undefined) out.push(sub);
    }
    if (this.minLen !== undefined && out.length < this.minLen) fail.push(path, `must have at least ${this.minLen} items`);
    if (this.maxLen !== undefined && out.length > this.maxLen) fail.push(path, `must have at most ${this.maxLen} items`);
    return out;
  }
  toOpenAPI(): OASchema {
    const oa: OASchema = { type: 'array', items: this.elem.toOpenAPI() };
    if (this.minLen !== undefined) (oa as any).minItems = this.minLen;
    if (this.maxLen !== undefined) (oa as any).maxItems = this.maxLen;
    return this.applyConstraints(oa);
  }
}

// ---------------------------------------------------------------------------
// 文件字段（multipart；被自动吸收为本地临时文件流）
// ---------------------------------------------------------------------------
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

export class FileValidator extends Validator<FileDescriptor> {
  readonly typeName = 'file';
  private opts: FileValidatorOpts;
  constructor(opts: FileValidatorOpts = {}) {
    super();
    this.opts = opts;
  }
  protected duplicate(): FileValidator {
    const c = new FileValidator({ ...this.opts });
    c.optional = this.optional; c.customFns = this.customFns;
    return c;
  }
  infer(): FileDescriptor {
    return {} as FileDescriptor;
  }
  wireType(): string {
    return 'file';
  }
  parseCore(value: unknown, fail: Fail, _path: string[]): FileDescriptor {
    if (value === null || typeof value !== 'object' || !('fieldname' in (value as any))) {
      fail.push(_path, 'expected a file upload');
      return {} as FileDescriptor;
    }
    const f = value as FileDescriptor;
    if (this.opts.maxSize !== undefined && f.size > this.opts.maxSize) {
      fail.push(_path, `file exceeds max size ${this.opts.maxSize}`);
    }
    if (this.opts.mime && this.opts.mime.length) {
      const mime = f.mime.split(';')[0].trim().toLowerCase();
      if (!this.opts.mime.includes(mime)) {
        fail.push(_path, `file mime not allowed (got ${mime})`);
      }
    }
    return f;
  }
  toOpenAPI(): OASchema {
    const oa: OASchema = { type: 'string', format: 'binary' } as any;
    return this.applyConstraints(oa);
  }
}

// ---------------------------------------------------------------------------
// 字面量 / 组合
// ---------------------------------------------------------------------------
export class LiteralValidator<V extends string | number | boolean> extends Validator<V> {
  readonly typeName = 'literal';
  private val: V;
  constructor(val: V) {
    super();
    this.val = val;
  }
  protected duplicate(): LiteralValidator<V> {
    const c = new LiteralValidator(this.val);
    c.optional = this.optional; c.customFns = this.customFns;
    return c;
  }
  infer(): V {
    return this.val;
  }
  parseCore(value: unknown, fail: Fail, path: string[]): V {
    if (value === this.val) return this.val;
    if (String(value) === String(this.val)) return this.val;
    fail.push(path, `must equal ${JSON.stringify(this.val)}`);
    return this.val;
  }
  toOpenAPI(): OASchema {
    return this.applyConstraints({ enum: [this.val] });
  }
}

// ---------------------------------------------------------------------------
// 命名空间 t
// ---------------------------------------------------------------------------
export interface SchemaShape extends Record<string, Validator<any>> {}

export const t = {
  str(): StrValidator {
    return new StrValidator();
  },
  string(): StrValidator {
    return new StrValidator();
  },
  int(): IntValidator {
    return new IntValidator();
  },
  integer(): IntValidator {
    return new IntValidator();
  },
  num(): FloatValidator {
    return new FloatValidator();
  },
  float(): FloatValidator {
    return new FloatValidator();
  },
  bool(): BoolValidator {
    return new BoolValidator();
  },
  boolean(): BoolValidator {
    return new BoolValidator();
  },
  any(): AnyValidator {
    return new AnyValidator();
  },
  obj<S extends SchemaShape>(shape: S, opts?: { strict?: boolean }): ObjValidator<S> {
    return new ObjValidator(shape, opts);
  },
  object<S extends SchemaShape>(shape: S, opts?: { strict?: boolean }): ObjValidator<S> {
    return new ObjValidator(shape, opts);
  },
  arr<E extends Validator<any>>(elem: E): ArrValidator<E> {
    return new ArrValidator(elem);
  },
  array<E extends Validator<any>>(elem: E): ArrValidator<E> {
    return new ArrValidator(elem);
  },
  file(opts: FileValidatorOpts = {}): FileValidator {
    return new FileValidator(opts);
  },
  lit<V extends string | number | boolean>(val: V): LiteralValidator<V> {
    return new LiteralValidator(val);
  },
};

export type Infer<T extends Validator<any>> = T extends Validator<infer U> ? U : unknown;