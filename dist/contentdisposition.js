"use strict";
/**
 * 解析 Content-Disposition 头部（multipart part headers 用）。
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.parseContentDisposition = parseContentDisposition;
function parseContentDisposition(header) {
    const result = {};
    // 形如: form-data; name="field"; filename="a.txt"
    const params = splitParams(header);
    for (const [key, value] of params) {
        if (key === 'name')
            result.name = value;
        else if (key === 'filename')
            result.filename = stripQuotesPattern(value);
        else
            result[key] = value;
    }
    return result;
}
function stripQuotesPattern(v) {
    return v.replace(/^"|"$/g, '');
}
function splitParams(header) {
    const out = [];
    // 用正则切分，支持双引号内的分号
    const re = /([\w*]+)=(")?([^";]*?)\2|([\w*]+)/g;
    let m;
    while ((m = re.exec(header)) !== null) {
        if (m[4]) {
            // 裸 token（形如 form-data / inline），忽略
            continue;
        }
        const key = m[1];
        let val = m[3] ?? '';
        // RFC 2047? filename* 处理
        if (key.endsWith('*')) {
            val = decodeExtended(val);
        }
        out.push([key, val]);
    }
    return out;
}
function decodeExtended(v) {
    // RFC 5987: UTF-8''%E4...
    const eq = v.indexOf("''");
    if (eq >= 0) {
        const raw = v.slice(eq + 2);
        try {
            return decodeURIComponent(raw);
        }
        catch {
            return raw;
        }
    }
    return v;
}
