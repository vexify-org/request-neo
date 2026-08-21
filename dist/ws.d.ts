/**
 * 实时（35–39）：同端口 WebSocket。手写 RFC6455 服务端握手 + 帧解析 + 广播/房间/定向推送。
 */
import type { IncomingMessage } from 'node:http';
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
export declare class WSServer {
    private wsRoutes;
    private binaryMode;
    route(path: string, spec: WsHandlerSpec): void;
    has(path: string): WsHandlerSpec | undefined;
    /** 是否应把该请求当作 WS 升级（判断 Upgrade: websocket） */
    isUpgrade(req: IncomingMessage): boolean;
    /** 处理升级：握手成功后装载路由处理函数 */
    handleUpgrade(req: IncomingMessage, socket: Socket, head: Buffer): boolean;
    private rejectUpgrade;
    private doHandshake;
    private attachSocket;
    private handleFrame;
    private rawSend;
    private sendFrame;
    /** 全服务器广播 */
    broadcast(data: string | Buffer | object, opts?: {
        exclude?: string;
    }): void;
    /** 向房间广播 */
    toRoom(room: string, data: string | Buffer | object): void;
    /** 定向推送给某 userId */
    toUser(userId: string | number, data: string | Buffer | object): void;
    /** 房间列表（统计） */
    roomMemberCounts(): Record<string, number>;
    count(): number;
}
