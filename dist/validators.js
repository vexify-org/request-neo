"use strict";
/**
 * 校验与类型层（19–27）
 *
 * t.str() / t.int() / t.bool() / t.obj() / t.arr() / t.file() ...
 * 链式约束(.opt/.min/.max/.enum/.regex) + 自定义函数 + OpenAPI 提取 + 全链路 TS 类型推断。
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.t = exports.LiteralValidator = exports.FileValidator = exports.ArrValidator = exports.ObjValidator = exports.AnyValidator = exports.BoolValidator = exports.FloatValidator = exports.IntValidator = exports.StrValidator = exports.Validator = void 0;
exports.to422 = to422;
const errors_1 = require("./errors");
// ---------------------------------------------------------------------------
// Fail 累积器（对象/数组嵌套时聚合字段错误，输出 HttpError(422)）
// ---------------------------------------------------------------------------
class Fail {
    errors = [];
    get has() {
        return this.errors.length > 0;
    }
    push(path, reason) {
        this.errors.push({ path, reason });
    }
    throw() {
        throw to422(this.errors);
    }
    toError() {
        return to422(this.errors);
    }
}
function to422(errors) {
    return new errors_1.HttpError(422, 'request validation failed', {
        details: errors.map((e) => ({ field: e.path.join('.') || '.', reason: e.reason })),
    });
}
// ---------------------------------------------------------------------------
// Validator 基类
// ---------------------------------------------------------------------------
class Validator {
    /** 是否可选（嵌套对象中缺省跳过） */
    optional = false;
    description;
    minC;
    maxC;
    enumC;
    patternC;
    customFns = [];
    wireType() {
        return 'string';
    }
    // ---------------- 链式约束 ----------------
    opt() {
        const c = this.duplicate();
        c.optional = true;
        return c;
    }
    desc(text) {
        const c = this.duplicate();
        c.description = text;
        return c;
    }
    min(v) {
        const c = this.duplicate();
        c.minC = v;
        return c;
    }
    max(v) {
        const c = this.duplicate();
        c.maxC = v;
        return c;
    }
    enum(...values) {
        const c = this.duplicate();
        c.enumC = values;
        return c;
    }
    regex(re) {
        const c = this.duplicate();
        c.patternC = re instanceof RegExp ? re.source : re;
        return c;
    }
    /** 自定义校验函数；抛错或返回非 undefined 视为失败 */
    check(fn) {
        const c = this.duplicate();
        c.customFns = [...this.customFns, fn];
        return c;
    }
    // ---------------- 统一入口 ----------------
    parse(value, path = []) {
        if (value === undefined || value === null) {
            if (this.optional)
                return undefined;
            const f = new Fail();
            f.push(path, 'field is required' + (value === null ? ' (got null)' : ''));
            f.throw();
        }
        const fail = new Fail();
        const coerced = this.parseCore(value, fail, path);
        if (fail.has)
            fail.throw();
        // 链式约束（作用于单个标量）
        if (typeof coerced === 'number' && !Number.isNaN(coerced)) {
            if (this.minC !== undefined && coerced < this.minC) {
                const f = new Fail();
                f.push(path, `must be >= ${this.minC}`);
                f.throw();
            }
            if (this.maxC !== undefined && coerced > this.maxC) {
                const f = new Fail();
                f.push(path, `must be <= ${this.maxC}`);
                f.throw();
            }
        }
        if (typeof coerced === 'string') {
            if (this.minC !== undefined && coerced.length < this.minC) {
                const f = new Fail();
                f.push(path, `length must be >= ${this.minC}`);
                f.throw();
            }
            if (this.maxC !== undefined && coerced.length > this.maxC) {
                const f = new Fail();
                f.push(path, `length must be <= ${this.maxC}`);
                f.throw();
            }
            if (this.patternC !== undefined && !new RegExp(this.patternC).test(coerced)) {
                const f = new Fail();
                f.push(path, `must match pattern: ${this.patternC}`);
                f.throw();
            }
        }
        if (this.enumC !== undefined) {
            const ok = this.enumC.some((e) => e === coerced || String(e) === String(coerced));
            if (!ok) {
                const f = new Fail();
                f.push(path, `must be one of: ${this.enumC.join(', ')}`);
                f.throw();
            }
        }
        // 自定义函数
        let val = coerced;
        for (const fn of this.customFns) {
            const r = fn(val, path);
            if (r !== undefined)
                val = r;
        }
        return val;
    }
    /** 约束失败聚合抛出 */
    applyConstraints(oa) {
        if (this.description !== undefined)
            oa.description = this.description;
        if (this.enumC !== undefined)
            oa.enum = this.enumC;
        return oa;
    }
}
exports.Validator = Validator;
// ---------------------------------------------------------------------------
// 标量校验器
// ---------------------------------------------------------------------------
class StrValidator extends Validator {
    typeName = 'string';
    coerce;
    constructor(opts) {
        super();
        this.coerce = opts?.coerce ?? true;
    }
    duplicate() {
        const c = new StrValidator({ coerce: this.coerce });
        c.minC = this.minC;
        c.maxC = this.maxC;
        c.enumC = this.enumC;
        c.patternC = this.patternC;
        c.customFns = this.customFns;
        return c;
    }
    infer() {
        return '';
    }
    wireType() {
        return 'string';
    }
    parseCore(value, fail, _path) {
        if (typeof value === 'string')
            return value;
        if (this.coerce && (typeof value === 'number' || typeof value === 'boolean' || value === null)) {
            return String(value);
        }
        fail.push(_path, 'expected a string');
        return '';
    }
    toOpenAPI() {
        const oa = { type: 'string' };
        if (this.minC !== undefined)
            oa.minLength = this.minC;
        if (this.maxC !== undefined)
            oa.maxLength = this.maxC;
        if (this.patternC !== undefined)
            oa.pattern = this.patternC;
        return this.applyConstraints(oa);
    }
}
exports.StrValidator = StrValidator;
class IntValidator extends Validator {
    typeName = 'integer';
    coerce;
    constructor(opts) {
        super();
        this.coerce = opts?.coerce ?? true;
    }
    duplicate() {
        const c = new IntValidator({ coerce: this.coerce });
        c.minC = this.minC;
        c.maxC = this.maxC;
        c.enumC = this.enumC;
        c.customFns = this.customFns;
        return c;
    }
    infer() {
        return 0;
    }
    wireType() {
        return 'integer';
    }
    parseCore(value, fail, _path) {
        const num = (() => {
            if (typeof value === 'number')
                return value;
            if (this.coerce && typeof value === 'string') {
                if (value.trim() === '')
                    return NaN;
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
    toOpenAPI() {
        const oa = { type: 'integer' };
        if (this.minC !== undefined)
            oa.minimum = this.minC;
        if (this.maxC !== undefined)
            oa.maximum = this.maxC;
        return this.applyConstraints(oa);
    }
}
exports.IntValidator = IntValidator;
class FloatValidator extends Validator {
    typeName = 'number';
    coerce;
    constructor(opts) {
        super();
        this.coerce = opts?.coerce ?? true;
    }
    duplicate() {
        const c = new FloatValidator({ coerce: this.coerce });
        c.minC = this.minC;
        c.maxC = this.maxC;
        c.enumC = this.enumC;
        c.customFns = this.customFns;
        return c;
    }
    infer() {
        return 0;
    }
    wireType() {
        return 'float';
    }
    parseCore(value, fail, _path) {
        const num = (() => {
            if (typeof value === 'number')
                return value;
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
    toOpenAPI() {
        const oa = { type: 'number' };
        if (this.minC !== undefined)
            oa.minimum = this.minC;
        if (this.maxC !== undefined)
            oa.maximum = this.maxC;
        return this.applyConstraints(oa);
    }
}
exports.FloatValidator = FloatValidator;
class BoolValidator extends Validator {
    typeName = 'boolean';
    coerce;
    constructor(opts) {
        super();
        this.coerce = opts?.coerce ?? true;
    }
    duplicate() {
        const c = new BoolValidator({ coerce: this.coerce });
        c.minC = this.minC;
        c.maxC = this.maxC;
        c.enumC = this.enumC;
        c.customFns = this.customFns;
        return c;
    }
    infer() {
        return true;
    }
    wireType() {
        return 'boolean';
    }
    parseCore(value, fail, _path) {
        if (typeof value === 'boolean')
            return value;
        if (this.coerce && typeof value === 'string') {
            if (value === 'true' || value === '1' || value === 'on')
                return true;
            if (value === 'false' || value === '0' || value === 'off')
                return false;
            fail.push(_path, 'expected a boolean');
            return false;
        }
        fail.push(_path, 'expected a boolean');
        return false;
    }
    toOpenAPI() {
        return this.applyConstraints({ type: 'boolean' });
    }
}
exports.BoolValidator = BoolValidator;
class AnyValidator extends Validator {
    typeName = 'any';
    duplicate() {
        const c = new AnyValidator();
        c.optional = this.optional;
        c.description = this.description;
        c.customFns = this.customFns;
        return c;
    }
    infer() {
        return undefined;
    }
    parseCore(value, _fail, _path) {
        return value;
    }
    toOpenAPI() {
        return this.applyConstraints({});
    }
}
exports.AnyValidator = AnyValidator;
class ObjValidator extends Validator {
    typeName = 'object';
    shape;
    strict;
    constructor(shape, opts) {
        super();
        this.shape = shape;
        this.strict = opts?.strict ?? true;
    }
    duplicate() {
        const c = new ObjValidator(this.shape, { strict: this.strict });
        c.optional = this.optional;
        c.customFns = this.customFns;
        c.description = this.description;
        return c;
    }
    infer() {
        return {};
    }
    wireType() {
        return 'object';
    }
    /** 供响应剥离子访问 */
    getShape() {
        return this.shape;
    }
    parseCore(value, fail, path) {
        if (typeof value !== 'object' || value === null || Array.isArray(value)) {
            fail.push(path, 'expected an object');
            return {};
        }
        const src = value;
        const out = {};
        for (const key of Object.keys(this.shape)) {
            const v = this.shape[key];
            const sub = v.parse(src[key], [...path, key]);
            if (sub !== undefined)
                out[key] = sub;
        }
        if (!this.strict) {
            for (const key of Object.keys(src)) {
                if (!(key in this.shape))
                    out[key] = src[key];
            }
        }
        return out;
    }
    toOpenAPI() {
        const properties = {};
        const required = [];
        for (const key of Object.keys(this.shape)) {
            const v = this.shape[key];
            properties[key] = v.toOpenAPI();
            if (!v.optional)
                required.push(key);
        }
        return this.applyConstraints({
            type: 'object',
            properties,
            required: required.length ? required : undefined,
            additionalProperties: this.strict ? false : undefined,
        });
    }
}
exports.ObjValidator = ObjValidator;
class ArrValidator extends Validator {
    typeName = 'array';
    elem;
    minLen;
    maxLen;
    constructor(elem) {
        super();
        this.elem = elem;
    }
    duplicate() {
        const c = new ArrValidator(this.elem);
        c.optional = this.optional;
        c.customFns = this.customFns;
        c.description = this.description;
        c.minLen = this.minLen;
        c.maxLen = this.maxLen;
        return c;
    }
    /** 元素数组长度约束 */
    arrMin(n) {
        const c = this.duplicate();
        c.minLen = n;
        return c;
    }
    arrMax(n) {
        const c = this.duplicate();
        c.maxLen = n;
        return c;
    }
    infer() {
        return [];
    }
    wireType() {
        return 'array';
    }
    parseCore(value, fail, path) {
        if (!Array.isArray(value)) {
            fail.push(path, 'expected an array');
            return [];
        }
        const out = [];
        for (let i = 0; i < value.length; i++) {
            const sub = this.elem.parse(value[i], [...path, String(i)]);
            if (sub !== undefined)
                out.push(sub);
        }
        if (this.minLen !== undefined && out.length < this.minLen)
            fail.push(path, `must have at least ${this.minLen} items`);
        if (this.maxLen !== undefined && out.length > this.maxLen)
            fail.push(path, `must have at most ${this.maxLen} items`);
        return out;
    }
    toOpenAPI() {
        const oa = { type: 'array', items: this.elem.toOpenAPI() };
        if (this.minLen !== undefined)
            oa.minItems = this.minLen;
        if (this.maxLen !== undefined)
            oa.maxItems = this.maxLen;
        return this.applyConstraints(oa);
    }
}
exports.ArrValidator = ArrValidator;
class FileValidator extends Validator {
    typeName = 'file';
    opts;
    constructor(opts = {}) {
        super();
        this.opts = opts;
    }
    duplicate() {
        const c = new FileValidator({ ...this.opts });
        c.optional = this.optional;
        c.customFns = this.customFns;
        return c;
    }
    infer() {
        return {};
    }
    wireType() {
        return 'file';
    }
    parseCore(value, fail, _path) {
        if (value === null || typeof value !== 'object' || !('fieldname' in value)) {
            fail.push(_path, 'expected a file upload');
            return {};
        }
        const f = value;
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
    toOpenAPI() {
        const oa = { type: 'string', format: 'binary' };
        return this.applyConstraints(oa);
    }
}
exports.FileValidator = FileValidator;
// ---------------------------------------------------------------------------
// 字面量 / 组合
// ---------------------------------------------------------------------------
class LiteralValidator extends Validator {
    typeName = 'literal';
    val;
    constructor(val) {
        super();
        this.val = val;
    }
    duplicate() {
        const c = new LiteralValidator(this.val);
        c.optional = this.optional;
        c.customFns = this.customFns;
        return c;
    }
    infer() {
        return this.val;
    }
    parseCore(value, fail, path) {
        if (value === this.val)
            return this.val;
        if (String(value) === String(this.val))
            return this.val;
        fail.push(path, `must equal ${JSON.stringify(this.val)}`);
        return this.val;
    }
    toOpenAPI() {
        return this.applyConstraints({ enum: [this.val] });
    }
}
exports.LiteralValidator = LiteralValidator;
exports.t = {
    str() {
        return new StrValidator();
    },
    string() {
        return new StrValidator();
    },
    int() {
        return new IntValidator();
    },
    integer() {
        return new IntValidator();
    },
    num() {
        return new FloatValidator();
    },
    float() {
        return new FloatValidator();
    },
    bool() {
        return new BoolValidator();
    },
    boolean() {
        return new BoolValidator();
    },
    any() {
        return new AnyValidator();
    },
    obj(shape, opts) {
        return new ObjValidator(shape, opts);
    },
    object(shape, opts) {
        return new ObjValidator(shape, opts);
    },
    arr(elem) {
        return new ArrValidator(elem);
    },
    array(elem) {
        return new ArrValidator(elem);
    },
    file(opts = {}) {
        return new FileValidator(opts);
    },
    lit(val) {
        return new LiteralValidator(val);
    },
};
