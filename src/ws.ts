/**
 * 实时（35–39）：同端口 WebSocket。手写 RFC6455 服务端握手 + 帧解析 + 广播/房间/定向推送。
 */

import type { IncomingMessage, ServerResponse } from 'node:http';
import { createHash, randomUUID } from 'node:crypto';
import { Socket } from 'node:net';

export interface WsHandleOp {
  method: 'GET';
  handler: WsHandler;
}

export interface WsConnection {
  id: string;
  url: string;
  userId?: string | number;
  query: Record<string, string>;
  headers: Record<string, string | string[] | undefined>;
  readyState: 0 | 1 | 2 | 3;
  close(code?: number, reason?: string): void;
  send(data: string | Buffer | object): boolean;
  /** 加入房间 */
  join(room: string): void;
  /** 离开房间 */
  leave(room: string): void;
  isOpen(): boolean;
}

export interface WsMessage {
  type: 'text' | 'binary';
  data: Buffer;
  text(): string;
}

export interface WsContext extends WsConnection {
  onMessage?: (msg: WsMessage) => unknown;
  onClose?: (code: number, reason: string) => unknown;
}

export interface WsHandlerSpec {
  onConnect?: (ws: WsConnection) => unknown;
  onMessage?: (ws: WsConnection, msg: WsMessage) => unknown;
  onClose?: (ws: WsConnection, code: number, reason: string) => unknown;
  /** 连接前鉴权：返回 false 拒绝 */
  authorize?: (req: IncomingMessage, url: URL) => Promise<boolean> | boolean;
}

export type WsHandler = WsHandlerSpec;

interface WSClient {
  socket: Socket;
  id: string;
  url: string;
  query: Record<string, string>;
  userId?: string | number;
  rooms: Set<string>;
  closed: boolean;
  handlers: WsHandlerSpec;
}

// 全局房间表：room -> Set<WSClient>
const rooms = new Map<string, Set<WSClient>>();
const clientsById = new Map<string, WSClient>();

const useStrictProtocol = false;

export class WSServer {
  private wsRoutes = new Map<string, WsHandlerSpec>();
  private binaryMode = true;

  route(path: string, spec: WsHandlerSpec): void {
    this.wsRoutes.set(normalizePath(path), spec);
  }

  has(path: string): WsHandlerSpec | undefined {
    return this.wsRoutes.get(normalizePath(path));
  }

  /** 是否应把该请求当作 WS 升级（判断 Upgrade: websocket） */
  isUpgrade(req: IncomingMessage): boolean {
    const up = (req.headers.upgrade || '').toLowerCase();
    const conn = (req.headers.connection || '').toLowerCase();
    return up === 'websocket' && conn.includes('upgrade');
  }

  /** 处理升级：握手成功后装载路由处理函数 */
  handleUpgrade(req: IncomingMessage, socket: Socket, head: Buffer): boolean {
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

  private rejectUpgrade(socket: Socket): void {
    socket.end('HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n');
  }

  private doHandshake(req: IncomingMessage, socket: Socket, head: Buffer, spec: WsHandlerSpec): void {
    const key = req.headers['sec-websocket-key'] as string;
    if (!key) {
      this.rejectUpgrade(socket);
      return;
    }
    const accept = createHash('sha1').update(key + '258EAFA5-E914-47DA-95CA-C5AB0DC85B11').digest('base64');
    const headBuf = Buffer.concat([
      Buffer.from(
        'HTTP/1.1 101 Switching Protocols\r\n' +
          'Upgrade: websocket\r\n' +
          'Connection: Upgrade\r\n' +
          (useStrictProtocol ? 'Sec-WebSocket-Accept: ' + accept + '\r\n' : 'Sec-WebSocket-Accept: ' + accept + '\r\n') +
          '\r\n'
      ),
      head,
    ]);
    socket.write(headBuf);

    const url = (req.url || '/').split('?')[0];
    const query: Record<string, string> = {};
    const qText = (req.url || '').split('?')[1];
    if (qText) new URLSearchParams(qText).forEach((v, k) => { query[k] = v; });

    const client: WSClient = {
      socket,
      id: randomUUID(),
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

  private attachSocket(client: WSClient): void {
    const { socket } = client;
    // 解析帧缓冲
    let buffer = Buffer.alloc(0);
    const closeAndClean = (code: number, reason: string) => {
      if (client.closed) return;
      client.closed = true;
      clientsById.delete(client.id);
      for (const r of client.rooms) rooms.get(r)?.delete(client);
      client.rooms.clear();
      try {
        client.handlers.onClose?.(toConn(client), code, reason);
      } catch {}
      try { socket.end(); } catch {}
    };

    socket.on('data', (chunk: Buffer) => {
      buffer = Buffer.concat([buffer, chunk]);
      // 循环解析完整帧
      for (;;) {
        if (buffer.length < 2) break;
        const b0 = buffer[0];
        const opcode = b0 & 0x0f;
        const fin = (b0 & 0x80) !== 0;
        const isMasked = (buffer[1] & 0x80) !== 0;
        let len = buffer[1] & 0x7f;
        let offset = 2;
        if (len === 126) {
          if (buffer.length < offset + 2) break;
          len = buffer.readUInt16BE(offset);
          offset += 2;
        } else if (len === 127) {
          if (buffer.length < offset + 8) break;
          len = Number(buffer.readBigUInt64BE(offset));
          offset += 8;
        }
        if (isMasked) {
          if (buffer.length < offset + 4) break;
          const mask = buffer.subarray(offset, offset + 4);
          offset += 4;
          if (buffer.length < offset + len) break;
          const payload = Buffer.from(buffer.subarray(offset, offset + len));
          for (let i = 0; i < payload.length; i++) payload[i] = payload[i] ^ mask[i % 4];
          this.handleFrame(client, opcode, payload, fin, buffer, offset + len, closeAndClean);
          buffer = buffer.slice(offset + len);
        } else {
          if (buffer.length < offset + len) break;
          const payload = Buffer.from(buffer.subarray(offset, offset + len));
          this.handleFrame(client, opcode, payload, fin, buffer, offset + len, closeAndClean);
          buffer = buffer.slice(offset + len);
        }
      }
    });
    socket.on('close', () => closeAndClean(1006, 'connection closed'));
    socket.on('error', () => closeAndClean(1006, 'socket error'));
    socket.on('end', () => {});
  }

  private handleFrame(
    client: WSClient,
    opcode: number,
    payload: Buffer,
    fin: boolean,
    buffer: Buffer,
    afterIdx: number,
    closeAndClean: (code: number, reason: string) => void
  ): void {
    void afterIdx; void buffer;
    switch (opcode) {
      case 0x1: // text
        client.handlers.onMessage?.(toConn(client), {
          type: 'text',
          data: payload,
          text: () => payload.toString('utf8'),
        });
        break;
      case 0x2: { // binary
        const msg: WsMessage = { type: 'binary', data: payload, text: () => payload.toString('utf8') };
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

  private rawSend(socket: Socket, opcode: number, payload: Buffer): void {
    try {
      if (socket.destroyed) return;
      let header: Buffer;
      const len = payload.length;
      if (len < 126) {
        header = Buffer.from([0x80 | opcode, len]);
      } else if (len < 65536) {
        header = Buffer.alloc(4);
        header[0] = 0x80 | opcode;
        header[1] = 126;
        header.writeUInt16BE(len, 2);
      } else {
        header = Buffer.alloc(10);
        header[0] = 0x80 | opcode;
        header[1] = 127;
        header.writeBigUInt64BE(BigInt(len), 2);
      }
      socket.write(Buffer.concat([header, payload]));
    } catch {}
  }
  private sendFrame(socket: Socket, opcode: number, payload: Buffer): void {
    this.rawSend(socket, opcode, payload);
  }

  // ---------------- 对外广播 ---------------- 
  /** 全服务器广播 */
  broadcast(data: string | Buffer | object, opts?: { exclude?: string }): void {
    const payload = encodePayload(data);
    for (const c of clientsById.values()) {
      if (opts?.exclude && c.id === opts.exclude) continue;
      if (!c.closed) this.rawSend(c.socket, 0x1, payload);
    }
  }
  /** 向房间广播 */
  toRoom(room: string, data: string | Buffer | object): void {
    const payload = encodePayload(data);
    const set = rooms.get(room);
    if (!set) return;
    for (const c of set) if (!c.closed) this.rawSend(c.socket, 0x1, payload);
  }
  /** 定向推送给某 userId */
  toUser(userId: string | number, data: string | Buffer | object): void {
    const payload = encodePayload(data);
    for (const c of clientsById.values()) {
      if (String(c.userId) === String(userId) && !c.closed) this.rawSend(c.socket, 0x1, payload);
    }
  }
  /** 房间列表（统计） */
  roomMemberCounts(): Record<string, number> {
    const out: Record<string, number> = {};
    rooms.forEach((s, r) => { out[r] = s.size; });
    return out;
  }

  count(): number {
    return clientsById.size;
  }
}

function toConn(client: WSClient): WsConnection {
  const conn: WsConnection = {
    id: client.id,
    url: client.url,
    query: client.query,
    headers: {},
    userId: client.userId,
    readyState: client.closed ? 3 : 1,
    isOpen: () => !client.closed,
    send: (data) => {
      if (client.closed) return false;
      try {
        const payload = encodePayload(data);
        client.socket.write(buildFrame(0x1, payload));
        return true;
      } catch {
        return false;
      }
    },
    close: (code = 1000, reason = '') => {
      if (client.closed) return;
      client.closed = true;
      clientsById.delete(client.id);
      for (const r of client.rooms) rooms.get(r)?.delete(client);
      client.rooms.clear();
      try {
        const codeBuf = Buffer.from([(code >> 8) & 0xff, code & 0xff]);
        const payload = Buffer.concat([codeBuf, Buffer.from(reason)]);
        client.socket.write(buildFrame(0x8, payload));
        setTimeout(() => { try { client.socket.end(); } catch {} }, 30);
      } catch {}
    },
    join: (room) => {
      if (!room) return;
      client.rooms.add(room);
      if (!rooms.has(room)) rooms.set(room, new Set());
      rooms.get(room)!.add(client);
    },
    leave: (room) => {
      client.rooms.delete(room);
      rooms.get(room)?.delete(client);
    },
  };
  return conn;
}

function buildFrame(opcode: number, payload: Buffer): Buffer {
  const len = payload.length;
  let header: Buffer;
  if (len < 126) {
    header = Buffer.from([0x80 | opcode, len]);
  } else if (len < 65536) {
    header = Buffer.alloc(4);
    header[0] = 0x80 | opcode;
    header[1] = 126;
    header.writeUInt16BE(len, 2);
  } else {
    header = Buffer.alloc(10);
    header[0] = 0x80 | opcode;
    header[1] = 127;
    header.writeBigUInt64BE(BigInt(len), 2);
  }
  return Buffer.concat([header, payload]);
}

function encodePayload(data: string | Buffer | object): Buffer {
  if (Buffer.isBuffer(data)) return data;
  if (typeof data === 'string') return Buffer.from(data);
  return Buffer.from(JSON.stringify(data));
}

function normalizePath(p: string): string {
  return '/' + p.split('/').filter((s) => s !== '').join('/');
}