"use strict";
/**
 * 实时（35–39）：同端口 WebSocket。手写 RFC6455 服务端握手 + 帧解析 + 广播/房间/定向推送。
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.WSServer = void 0;
const node_crypto_1 = require("node:crypto");
// 全局房间表：room -> Set<WSClient>
const rooms = new Map();
const clientsById = new Map();
const useStrictProtocol = false;
class WSServer {
    wsRoutes = new Map();
    binaryMode = true;
    route(path, spec) {
        this.wsRoutes.set(normalizePath(path), spec);
    }
    has(path) {
        return this.wsRoutes.get(normalizePath(path));
    }
    /** 是否应把该请求当作 WS 升级（判断 Upgrade: websocket） */
    isUpgrade(req) {
        const up = (req.headers.upgrade || '').toLowerCase();
        const conn = (req.headers.connection || '').toLowerCase();
        return up === 'websocket' && conn.includes('upgrade');
    }
    /** 处理升级：握手成功后装载路由处理函数 */
    handleUpgrade(req, socket, head) {
        const urlPath = (req.url || '/').split('?')[0];
        const spec = this.has(urlPath);
        if (!spec) {
            // 无路由：拒绝
            this.rejectUpgrade(socket);
            return false;
        }
        // 鉴权钩子若存在
        if (spec.authorize) {
            const base = new URL((req.headers['x-forwarded-proto'] === 'https' ? 'https' : 'http') + '://' + (req.headers.host || 'localhost') + (req.url || '/'));
            const authResult = Promise.resolve(spec.authorize(req, base));
            authResult.then((ok) => {
                if (!ok) {
                    this.rejectUpgrade(socket);
                    return;
                }
                this.doHandshake(req, socket, head, spec);
            }).catch(() => {
                this.rejectUpgrade(socket);
            });
            return true;
        }
        this.doHandshake(req, socket, head, spec);
        return true;
    }
    rejectUpgrade(socket) {
        socket.end('HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n');
    }
    doHandshake(req, socket, head, spec) {
        const key = req.headers['sec-websocket-key'];
        if (!key) {
            this.rejectUpgrade(socket);
            return;
        }
        const accept = (0, node_crypto_1.createHash)('sha1').update(key + '258EAFA5-E914-47DA-95CA-C5AB0DC85B11').digest('base64');
        const headBuf = Buffer.concat([
            Buffer.from('HTTP/1.1 101 Switching Protocols\r\n' +
                'Upgrade: websocket\r\n' +
                'Connection: Upgrade\r\n' +
                (useStrictProtocol ? 'Sec-WebSocket-Accept: ' + accept + '\r\n' : 'Sec-WebSocket-Accept: ' + accept + '\r\n') +
                '\r\n'),
            head,
        ]);
        socket.write(headBuf);
        const url = (req.url || '/').split('?')[0];
        const query = {};
        const qText = (req.url || '').split('?')[1];
        if (qText)
            new URLSearchParams(qText).forEach((v, k) => { query[k] = v; });
        const client = {
            socket,
            id: (0, node_crypto_1.randomUUID)(),
            url,
            query,
            rooms: new Set(),
            closed: false,
            handlers: spec,
        };
        clientsById.set(client.id, client);
        spec.onConnect?.(toConn(client));
        this.attachSocket(client);
    }
    attachSocket(client) {
        const { socket } = client;
        // 解析帧缓冲
        let buffer = Buffer.alloc(0);
        const closeAndClean = (code, reason) => {
            if (client.closed)
                return;
            client.closed = true;
            clientsById.delete(client.id);
            for (const r of client.rooms)
                rooms.get(r)?.delete(client);
            client.rooms.clear();
            try {
                client.handlers.onClose?.(toConn(client), code, reason);
            }
            catch { }
            try {
                socket.end();
            }
            catch { }
        };
        socket.on('data', (chunk) => {
            buffer = Buffer.concat([buffer, chunk]);
            // 循环解析完整帧
            for (;;) {
                if (buffer.length < 2)
                    break;
                const b0 = buffer[0];
                const opcode = b0 & 0x0f;
                const fin = (b0 & 0x80) !== 0;
                const isMasked = (buffer[1] & 0x80) !== 0;
                let len = buffer[1] & 0x7f;
                let offset = 2;
                if (len === 126) {
                    if (buffer.length < offset + 2)
                        break;
                    len = buffer.readUInt16BE(offset);
                    offset += 2;
                }
                else if (len === 127) {
                    if (buffer.length < offset + 8)
                        break;
                    len = Number(buffer.readBigUInt64BE(offset));
                    offset += 8;
                }
                if (isMasked) {
                    if (buffer.length < offset + 4)
                        break;
                    const mask = buffer.subarray(offset, offset + 4);
                    offset += 4;
                    if (buffer.length < offset + len)
                        break;
                    const payload = Buffer.from(buffer.subarray(offset, offset + len));
                    for (let i = 0; i < payload.length; i++)
                        payload[i] = payload[i] ^ mask[i % 4];
                    this.handleFrame(client, opcode, payload, fin, buffer, offset + len, closeAndClean);
                    buffer = buffer.slice(offset + len);
                }
                else {
                    if (buffer.length < offset + len)
                        break;
                    const payload = Buffer.from(buffer.subarray(offset, offset + len));
                    this.handleFrame(client, opcode, payload, fin, buffer, offset + len, closeAndClean);
                    buffer = buffer.slice(offset + len);
                }
            }
        });
        socket.on('close', () => closeAndClean(1006, 'connection closed'));
        socket.on('error', () => closeAndClean(1006, 'socket error'));
        socket.on('end', () => { });
    }
    handleFrame(client, opcode, payload, fin, buffer, afterIdx, closeAndClean) {
        void afterIdx;
        void buffer;
        switch (opcode) {
            case 0x1: // text
                client.handlers.onMessage?.(toConn(client), {
                    type: 'text',
                    data: payload,
                    text: () => payload.toString('utf8'),
                });
                break;
            case 0x2: { // binary
                const msg = { type: 'binary', data: payload, text: () => payload.toString('utf8') };
                client.handlers.onMessage?.(toConn(client), msg);
                break;
            }
            case 0x8: // close
                this.sendFrame(client.socket, 0x8, Buffer.from([0x09, 0x09]));
                closeAndClean(1000, 'closed');
                break;
            case 0x9: // ping -> pong
                this.rawSend(client.socket, 0xA, payload);
                break;
            case 0xA: // pong，忽略
                if (client.handlers.onMessage) { /* 心跳可忽略 */ }
                break;
            default:
                break;
        }
        void fin;
    }
    rawSend(socket, opcode, payload) {
        try {
            if (socket.destroyed)
                return;
            let header;
            const len = payload.length;
            if (len < 126) {
                header = Buffer.from([0x80 | opcode, len]);
            }
            else if (len < 65536) {
                header = Buffer.alloc(4);
                header[0] = 0x80 | opcode;
                header[1] = 126;
                header.writeUInt16BE(len, 2);
            }
            else {
                header = Buffer.alloc(10);
                header[0] = 0x80 | opcode;
                header[1] = 127;
                header.writeBigUInt64BE(BigInt(len), 2);
            }
            socket.write(Buffer.concat([header, payload]));
        }
        catch { }
    }
    sendFrame(socket, opcode, payload) {
        this.rawSend(socket, opcode, payload);
    }
    // ---------------- 对外广播 ---------------- 
    /** 全服务器广播 */
    broadcast(data, opts) {
        const payload = encodePayload(data);
        for (const c of clientsById.values()) {
            if (opts?.exclude && c.id === opts.exclude)
                continue;
            if (!c.closed)
                this.rawSend(c.socket, 0x1, payload);
        }
    }
    /** 向房间广播 */
    toRoom(room, data) {
        const payload = encodePayload(data);
        const set = rooms.get(room);
        if (!set)
            return;
        for (const c of set)
            if (!c.closed)
                this.rawSend(c.socket, 0x1, payload);
    }
    /** 定向推送给某 userId */
    toUser(userId, data) {
        const payload = encodePayload(data);
        for (const c of clientsById.values()) {
            if (String(c.userId) === String(userId) && !c.closed)
                this.rawSend(c.socket, 0x1, payload);
        }
    }
    /** 房间列表（统计） */
    roomMemberCounts() {
        const out = {};
        rooms.forEach((s, r) => { out[r] = s.size; });
        return out;
    }
    count() {
        return clientsById.size;
    }
}
exports.WSServer = WSServer;
function toConn(client) {
    const conn = {
        id: client.id,
        url: client.url,
        query: client.query,
        headers: {},
        userId: client.userId,
        readyState: client.closed ? 3 : 1,
        isOpen: () => !client.closed,
        send: (data) => {
            if (client.closed)
                return false;
            try {
                const payload = encodePayload(data);
                client.socket.write(buildFrame(0x1, payload));
                return true;
            }
            catch {
                return false;
            }
        },
        close: (code = 1000, reason = '') => {
            if (client.closed)
                return;
            client.closed = true;
            clientsById.delete(client.id);
            for (const r of client.rooms)
                rooms.get(r)?.delete(client);
            client.rooms.clear();
            try {
                const codeBuf = Buffer.from([(code >> 8) & 0xff, code & 0xff]);
                const payload = Buffer.concat([codeBuf, Buffer.from(reason)]);
                client.socket.write(buildFrame(0x8, payload));
                setTimeout(() => { try {
                    client.socket.end();
                }
                catch { } }, 30);
            }
            catch { }
        },
        join: (room) => {
            if (!room)
                return;
            client.rooms.add(room);
            if (!rooms.has(room))
                rooms.set(room, new Set());
            rooms.get(room).add(client);
        },
        leave: (room) => {
            client.rooms.delete(room);
            rooms.get(room)?.delete(client);
        },
    };
    return conn;
}
function buildFrame(opcode, payload) {
    const len = payload.length;
    let header;
    if (len < 126) {
        header = Buffer.from([0x80 | opcode, len]);
    }
    else if (len < 65536) {
        header = Buffer.alloc(4);
        header[0] = 0x80 | opcode;
        header[1] = 126;
        header.writeUInt16BE(len, 2);
    }
    else {
        header = Buffer.alloc(10);
        header[0] = 0x80 | opcode;
        header[1] = 127;
        header.writeBigUInt64BE(BigInt(len), 2);
    }
    return Buffer.concat([header, payload]);
}
function encodePayload(data) {
    if (Buffer.isBuffer(data))
        return data;
    if (typeof data === 'string')
        return Buffer.from(data);
    return Buffer.from(JSON.stringify(data));
}
function normalizePath(p) {
    return '/' + p.split('/').filter((s) => s !== '').join('/');
}
