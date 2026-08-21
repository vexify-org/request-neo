"use strict";
/**
 * 传输（5）+ 流（6）：请求体流式解析（JSON / urlencoded / plain / binary），
 * 大文件 multipart 不落地直接 pipe。全部通过长度/类型分流，避免整包进内存。
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.readBodyStream = readBodyStream;
exports.detectContentType = detectContentType;
exports.parseBody = parseBody;
const node_stream_1 = require("node:stream");
const defaultMaxBody = 10 * 1024 * 1024; // 10MB
/**
 * 流式读取请求体到内存（带上限）。用于 JSON/urlencoded/text。
 */
function readBodyStream(req, maxBytes = defaultMaxBody, isBinary = false) {
    return new Promise((resolve, reject) => {
        const chunks = [];
        let total = 0;
        let resolved = false;
        const cleanup = () => {
            req.removeListener('data', onData);
            req.removeListener('end', onEnd);
            req.removeListener('error', onError);
            req.removeListener('aborted', onAbort);
        };
        const fail = (err) => {
            if (resolved)
                return;
            resolved = true;
            cleanup();
            reject(err);
        };
        function onData(chunk) {
            total += chunk.length;
            if (isBinary && total > maxBytes) {
                fail(Object.assign(new Error('Payload too large'), { status: 413 }));
                req.destroy();
                return;
            }
            if (!isBinary && total > maxBytes) {
                // 结构体超限直接 413
                fail(Object.assign(new Error('Payload too large'), { status: 413 }));
                req.destroy();
                return;
            }
            chunks.push(chunk);
        }
        function onEnd() {
            if (resolved)
                return;
            resolved = true;
            cleanup();
            resolve(Buffer.concat(chunks));
        }
        function onError(e) {
            fail(e);
        }
        function onAbort() {
            fail(Object.assign(new Error('Request aborted'), { status: 499 }));
        }
        req.on('data', onData);
        req.on('end', onEnd);
        req.on('error', onError);
        req.on('aborted', onAbort);
        // 若已进入 flowing，手动切回暂停再开
        if (req._readableState?.flowing) {
            req.pause();
            req.resume();
        }
    });
}
function detectContentType(req) {
    const ct = (req.headers['content-type'] ?? '')
        .toLowerCase()
        .split(';')[0]
        .trim();
    return ct || '';
}
/**
 * 解析请求体（自动按 content-type 分流，尽量流式）。
 * - JSON / urlencoded / plain → 内存缓冲 + JSON.parse
 * - multipart → 流式解析，文件按 maxFieldBytes 区分内存/落盘，不整包进内存
 */
async function parseBody(req, opts = {}) {
    const ct = detectContentType(req);
    const maxBody = opts.maxBodyBytes ?? defaultMaxBody;
    const hasBody = req.method !== 'GET' &&
        req.method !== 'HEAD' &&
        req.method !== 'OPTIONS' &&
        ct !== '';
    if (!hasBody) {
        return { type: 'json', value: {} }; // GET 无 body
    }
    if (ct === 'application/json' || ct.endsWith('+json')) {
        const buf = await readBodyStream(req, maxBody);
        if (buf.length === 0)
            return { type: 'json', value: {} };
        try {
            return { type: 'json', value: JSON.parse(buf.toString('utf8')) };
        }
        catch {
            throw Object.assign(new Error('Invalid JSON body'), { status: 400 });
        }
    }
    if (ct === 'application/x-www-form-urlencoded') {
        const buf = await readBodyStream(req, maxBody);
        const params = new URLSearchParams(buf.toString('utf8'));
        const value = {};
        for (const k of params.keys()) {
            const all = params.getAll(k);
            value[k] = all.length === 1 ? all[0] : all;
        }
        return { type: 'urlencoded', value };
    }
    if (ct === 'text/plain' || ct.startsWith('text/')) {
        const buf = await readBodyStream(req, maxBody);
        return { type: 'text', value: buf.toString('utf8') };
    }
    if (ct === 'application/octet-stream' || ct.startsWith('application/')) {
        const buf = await readBodyStream(req, maxBody, true);
        return { type: 'multipart', value: { __binary: buf } };
    }
    if (ct.startsWith('multipart/form-data')) {
        return parseMultipart(req, opts);
    }
    // 未知类型：透传二进制
    const buf = await readBodyStream(req, maxBody, true);
    return { type: 'multipart', value: { __binary: buf } };
}
// ---------------------------------------------------------------------------
// Multipart 流式解析（不整包进内存；大文件落盘）
// ---------------------------------------------------------------------------
const node_fs_1 = require("node:fs");
const node_path_1 = require("node:path");
const node_os_1 = require("node:os");
const node_crypto_1 = require("node:crypto");
const contentdisposition_1 = require("./contentdisposition");
function parseMultipart(req, opts) {
    const boundary = extractBoundary(req.headers['content-type']);
    if (!boundary)
        throw Object.assign(new Error('Invalid multipart content-type'), { status: 400 });
    const maxFieldBytes = opts.maxFieldBytes ?? 1024 * 1024; // 1MB field 上限
    const maxFiles = opts.maxFiles ?? 10;
    const uploadDir = opts.uploadDir ?? (0, node_path_1.join)((0, node_os_1.tmpdir)(), 'request-neo');
    if (!(0, node_fs_1.existsSync)(uploadDir))
        (0, node_fs_1.mkdirSync)(uploadDir, { recursive: true });
    return new Promise((resolve, reject) => {
        const result = { fields: {}, files: {} };
        let fileCount = 0;
        let settled = false;
        const fail = (e) => {
            if (settled)
                return;
            settled = true;
            reject(Object.assign(e, { status: e.status ?? 400 }));
        };
        function done(result_) {
            if (settled)
                return;
            settled = true;
            const merged = { ...result_.fields };
            for (const k of Object.keys(result_.files)) {
                const fs = result_.files[k];
                merged[k] = fs && fs.length === 1 ? fs[0] : (fs ?? []);
            }
            resolve({ type: 'multipart', value: merged });
        }
        // ---- 状态 ----
        let phase = 'start';
        let headerBuf = '';
        let partName = null;
        let partFilename = null;
        let partMime = '';
        let isFile = false;
        let fieldBuf = [];
        let fieldSize = 0;
        let sink = null;
        let carry = Buffer.alloc(0);
        function startPart() {
            phase = 'headers';
            headerBuf = '';
            partName = null;
            partFilename = null;
            partMime = '';
            isFile = false;
            fieldBuf = [];
            fieldSize = 0;
            sink = null;
        }
        function finalizePartBody() {
            // 当前部分 body 收尾
            if (isFile) {
                sink?.finalize();
            }
            else {
                const text = Buffer.concat(fieldBuf).toString('utf8');
                if (partName !== null) {
                    const existing = result.fields[partName];
                    result.fields[partName] =
                        existing === undefined ? text : Array.isArray(existing) ? [...existing, text] : [existing, text];
                }
            }
        }
        function indexOf(buf, needle, from = 0) {
            const hay = buf;
            const ndl = typeof needle === 'string' ? Buffer.from(needle) : needle;
            if (ndl.length === 0)
                return -1;
            for (let i = from; i + ndl.length <= hay.length; i++) {
                let j = 0;
                while (j < ndl.length && hay[i + j] === ndl[j])
                    j++;
                if (j === ndl.length)
                    return i;
            }
            return -1;
        }
        function feedBodyData(buf) {
            if (buf.length === 0)
                return;
            if (isFile)
                sink?.write(buf);
            else {
                fieldBuf.push(buf);
                fieldSize += buf.length;
                if (fieldSize > maxFieldBytes)
                    fail(Object.assign(new Error('Field too large'), { status: 413 }));
            }
        }
        function processBuffer() {
            // 循环处理，直到需要更多数据或完成
            outer: while (phase !== 'done') {
                if (phase === 'start') {
                    // 期望首个 `--boundary`（起始，无前置 CRLF；容忍前置 \r\n）
                    const marker = '--' + boundary;
                    const m = indexOf(carry, marker, 0);
                    if (m < 0) {
                        // 等待；若缓冲过长仍无边界 → 异常
                        if (carry.length > marker.length * 2 + 64) {
                            fail(Object.assign(new Error('Multipart boundary not found'), { status: 400 }));
                            return;
                        }
                        return;
                    }
                    // 丢弃 marker 前内容
                    carry = carry.slice(m + marker.length);
                    // 期待 \r\n
                    if (carry.toString('latin1', 0, 2) === '\r\n') {
                        carry = carry.slice(2);
                    }
                    startPart();
                    continue; // 进入 headers 处理
                }
                if (phase === 'headers') {
                    const headEnd = indexOf(carry, '\r\n\r\n');
                    if (headEnd < 0) {
                        headerBuf += carry.toString('latin1');
                        if (headerBuf.length > 64 * 1024) {
                            fail(Object.assign(new Error('Part headers too large'), { status: 431 }));
                            return;
                        }
                        carry = Buffer.alloc(0);
                        return; // 等更多数据
                    }
                    const section = headerBuf + carry.slice(0, headEnd).toString('latin1');
                    parseHeaders(section);
                    carry = carry.slice(headEnd + 4); // 跳过空行
                    phase = 'body';
                    if (isFile) {
                        fileCount++;
                        if (fileCount > maxFiles) {
                            fail(Object.assign(new Error('Too many files'), { status: 413 }));
                            return;
                        }
                        const ms = new MemoryOrFileSink(maxFieldBytes, uploadDir);
                        ms.onDone((info) => {
                            const f = {
                                fieldname: partName,
                                filename: partFilename ?? '',
                                mime: partMime,
                                size: info.size,
                                path: info.path,
                                data: info.data,
                            };
                            if (opts.maxBodyBytes !== undefined && info.size > opts.maxBodyBytes) {
                                fail(Object.assign(new Error('File too large'), { status: 413 }));
                                return;
                            }
                            if (f.path)
                                regCleanup(f.path);
                            if (!result.files[f.fieldname])
                                result.files[f.fieldname] = [];
                            result.files[f.fieldname].push(f);
                        });
                        sink = ms;
                    }
                    continue; // body
                }
                if (phase === 'body') {
                    // 后续边界：`\r\n--boundary`
                    const delim = '\r\n--' + boundary;
                    const idx = indexOf(carry, delim);
                    if (idx < 0) {
                        // 无完整分隔；输出安全数据（保留分隔前缀）
                        const keep = delim.length - 1;
                        const safe = Math.max(0, carry.length - keep);
                        if (safe > 0) {
                            feedBodyData(carry.slice(0, safe));
                            carry = carry.slice(safe);
                        }
                        else {
                            return;
                        }
                        return; // 等更多
                    }
                    // idx 处是 `\r\n--boundary`：此前 body 数据到 idx
                    feedBodyData(carry.slice(0, idx));
                    carry = carry.slice(idx + delim.length);
                    // 判断结束 `--boundary--` 或继续
                    const after = carry.toString('latin1', 0, 2);
                    if (after === '--') {
                        finalizePartBody();
                        carry = Buffer.alloc(0);
                        phase = 'done';
                        done(result);
                        return;
                    }
                    if (carry.toString('latin1', 0, 2) === '\r\n')
                        carry = carry.slice(2);
                    finalizePartBody();
                    // 这个立即出现的部分是下一个 part 数据？不，`--boundary\r\n` 后是下一 part headers。
                    startPart();
                    continue;
                }
            }
        }
        function parseHeaders(text) {
            const lines = text.split('\r\n');
            for (const line of lines) {
                const i = line.indexOf(':');
                if (i > 0) {
                    const name = line.slice(0, i).trim().toLowerCase();
                    const value = line.slice(i + 1).trim();
                    if (name === 'content-disposition') {
                        const cd = (0, contentdisposition_1.parseContentDisposition)(value);
                        partName = cd.name ?? null;
                        partFilename = cd.filename ?? null;
                    }
                    else if (name === 'content-type') {
                        partMime = value;
                    }
                }
            }
            isFile = partFilename !== null;
        }
        const toCleanup = [];
        function regCleanup(p) {
            toCleanup.push(p);
        }
        process.once?.('exit', () => {
            for (const p of toCleanup)
                try {
                    require('node:fs').unlinkSync(p);
                }
                catch { }
        });
        req.on('error', fail);
        req.on('aborted', () => fail(Object.assign(new Error('Request aborted'), { status: 499 })));
        req.on('data', (c) => {
            carry = Buffer.concat([carry, c]);
            processBuffer();
        });
        req.on('end', () => {
            if (!settled)
                fail(Object.assign(new Error('Multipart stream ended unexpectedly'), { status: 400 }));
        });
    });
}
function extractBoundary(ct) {
    if (!ct)
        return null;
    const m = ct.match(/boundary=(?:"([^"]+)"|([^;]+))/i);
    return m ? (m[1] || m[2]).trim() : null;
}
class MemoryOrFileSink extends node_stream_1.Writable {
    maxInMemory;
    uploadDir;
    bufParts = [];
    bufSize = 0;
    stream;
    tmpPath;
    size = 0;
    doneCb;
    constructor(maxInMemory, uploadDir) {
        super();
        this.maxInMemory = maxInMemory;
        this.uploadDir = uploadDir;
    }
    _write(chunk, _enc, cb) {
        this.size += chunk.length;
        if (!this.stream && this.bufSize + chunk.length > this.maxInMemory) {
            const name = (0, node_crypto_1.randomBytes)(8).toString('hex');
            this.tmpPath = (0, node_path_1.join)(this.uploadDir, `${name}.upload`);
            this.stream = (0, node_fs_1.createWriteStream)(this.tmpPath);
            for (const b of this.bufParts)
                this.stream.write(b);
            this.bufParts = [];
            this.stream.write(chunk, cb);
        }
        else if (this.stream) {
            this.stream.write(chunk, cb);
        }
        else {
            this.bufParts.push(chunk);
            this.bufSize += chunk.length;
            cb();
        }
    }
    _final(cb) {
        if (this.stream) {
            this.stream.end(() => {
                cb();
                this.doneCb?.({ size: this.size, path: this.tmpPath });
            });
        }
        else {
            cb();
            this.doneCb?.({ size: this.size, data: Buffer.concat(this.bufParts) });
        }
    }
    onDone(fn) {
        this.doneCb = fn;
    }
    finalize() {
        this.end();
    }
}
