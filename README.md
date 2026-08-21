<div align="center">

# request-neo

**Powered By Vexify 2026** · Apache-2.0

Flask / FastAPI 味的 Node.js 全栈 HTTP 框架：协议、路由、校验、中间件、实时通信、安全、可观测一体。

[快速开始](#quickstart) · [功能矩阵](#matrix) · [API 参考](#api) · [示例代码](#examples)

</div>

---

## <a id="quickstart"></a> 快速开始

```bash
npm i request-neo
```

```ts
import { NeoApp, t, HttpError } from 'request-neo';

const app = new NeoApp({ cors: true, openapi: { title: 'demo' } });
app.listen(3000, () => console.log('up'));
```

- 常驻 HTTP/1.1 服务，`createServer().listen(port)`，不依赖任何 `npx`。
- 自带 `/docs`（Swagger UI）、`/redoc`（ReDoc）、`/openapi.json`、`/metrics`（Prometheus）。

---

## <a id="matrix"></a> 功能矩阵（50 项需求）

### 传输与协议层（1–8）

| 能力 | API |
|---|---|
| 常驻 HTTP/1.1 | `new NeoApp().listen(port)` |
| HTTP/2 可选开关 + ALPN 降级 | `new NeoApp({ http2: true })` |
| HTTPS 一键启用（自签 / 文件热加载） | `new NeoApp({ https: { key, cert } })` |
| 请求体流式解析（不完全缓冲进内存） | `readBodyStream(ctx, { stream: true })` / `parseBody` |
| 大文件上传流式透传（multipart 不落地） | `parseBody(ctx, { multipart: { toDir } })` |
| 响应流式发送（chunked / 背压） | `ctx.res.write(...)` + `ctx.stream()` |
| 连接级超时 / keep-alive / 最大头大小可配 | `new NeoApp({ timeout, keepAlive, maxHeaderSize })` |
| 同端口复用 HTTP + WebSocket + SSE | `app.ws('/chat', …)` + `app.sse('/events', …)` |

### 路由层（9–18）

| 能力 | API |
|---|---|
| Flask 式 `route(path, ['GET','POST'])` | `app.route('/p', ['GET','POST'], handler)` |
| 参数化路由 + 正则约束 | `app.get('/user/:id(\\d+)', handler)` |
| 嵌套路由组 | `app.group('/api/v1', (g) => g.get(…))` |
| 路由级 schema 声明 | `app.get('/u/:id', { params: { id: t.int() } }, handler)` |
| 自动 405 + `Allow` 头 | 内置 |
| radix tree 匹配（O(log n)，不正则遍历） | `RadixTree` |
| 通配 / static | `app.static('/static/*', dir)` |
| 路由别名 + 反向 URL | `get('/item/:id', { alias: 'item.get' })` → `urlFor('item.get', { id: 1 })` |
| HEAD 自动由 GET 推导 | 内置 |
| 路由级中间件挂载点 | `get(path, { middleware: [fn] }, handler)` |

### 校验与类型层（19–27）

| 能力 | API |
|---|---|
| 内置校验器 | `t.str()/t.int()/t.float()/t.bool()/t.obj()/t.arr()/t.file()/t.any()/t.lit()` |
| 链式约束 | `.opt().min().max().enum().regex().desc()` |
| 请求体自动校验（失败 422） | `post('/x', { body: Schema }, handler)` |
| 响应按 schema 序列化（剥离/补默认） | `post('/x', { response: Schema }, handler)` |
| 全链路 TS 类型推断 | `ctx.body.name: string`、`ctx.params.id: number` |
| 编译期 OpenAPI 3.1 提取 | 自动从 `t` 定义生成 |
| 查询参数自动类型转换 | `?age=18` → `number`（`ctx.query.age` 类型推断） |
| 文件字段特殊类型 | `t.file({ maxSize, mime })` |
| 自定义校验函数 | `.check((value, path) => value)` |

### 中间件与控制流（28–34）

| 能力 | API |
|---|---|
| 洋葱模型 | `app.use(async (ctx, next) => { await next(); })` |
| 全局 / 组 / 路由三级叠加 | `app.use` + `group.use` + `{ middleware }` |
| 异常即响应 | `throw new HttpError(401, 'no')` 直接 JSON |
| 统一错误序列化 | `{ status, error, message, requestId, details }` |
| 依赖注入式前置 | `app.deps(async (ctx) => ({ db, user }))` |
| 请求短路 | 中间件内 `ctx.json(...)` 后不再进下一环 |
| 异步资源自动释放 | `finally` / `ctx.on('close')` 钩子 |

### 实时通信（35–39）

| 能力 | API |
|---|---|
| 同端口 WebSocket | `app.ws('/chat', { onConnect, onMessage, onClose })` |
| WS 广播 / 房间 / 定向推送 | `wsSink.broadcast(...)` / `wsSink.toRoom(...)` / `wsSink.toUser(...)` |
| 原生 SSE | `app.sse('/events', (ctx, stream) => stream.send(obj))` |
| SSE 自动重连头 + 心跳 | `sse(pathname, { heartbeatMs })` |
| WS/SSE 共享鉴权中间件 | 均先跑全局 `app.use` |

### 安全（40–45）

| 能力 | API |
|---|---|
| CORS 一键开 / 细粒度 | `new NeoApp({ cors: true })` 或 `app.cors({ origin })` |
| Helmet 级安全头 | `new NeoApp({ securityHeaders: true })` |
| JWT 验证（失败 401） | `app.jwt({ secret })` |
| Session（签名 cookie + 可换 store） | `app.session({ secret, store })` |
| Rate limit（固定/滑动窗口，IP/Token） | `app.rateLimit({ windowMs, max, scope })` |
| CSRF（双 cookie，SSE/WS 除外） | `app.csrf({ secret })` |

### 可观测与文档（46–50）

| 能力 | API |
|---|---|
| 结构化日志（requestId/耗时/路由） | `new NeoApp({ log: { level, pretty } })` |
| 请求级 `ctx.log.debug()` 自动带上下文 | 内置 |
| 自动生成 OpenAPI JSON | `/openapi.json` |
| Swagger UI + ReDoc | `/docs` `/redoc`（`openapi.ui` 可关） |
| Prometheus 指标端点（请求数/延迟/P99） | `/metrics` |

---

## <a id="api"></a> API 参考

### 应用配置

```ts
new NeoApp({
  cors: true | { origin, methods, headers },
  securityHeaders: true,
  http2: boolean,                      // HTTP/2 同端口 ALPN
  https: { key: Buffer, cert: Buffer }, // 一键 HTTPS
  timeout, keepAlive, maxHeaderSize,    // 连接级配置
  body: { maxBodyBytes, maxFiles },
  log: { level: 'debug'|'info'|'warn'|'error', pretty: boolean },
  openapi: { title, version, description, ui: boolean },
  prometheus: boolean,                 // 开启 /metrics
})
```

### 路由方法

`app.route(path, methods, opts?, handler)` · `app.get/post/put/patch/delete(...)` · `app.ws(...)` · `app.sse(...)` · `app.static(prefix, dir)` · `app.group(prefix, cb)` · `app.urlFor(name, params)`。

`HEAD` 由 `GET` 自动推导；`OPTIONS` 由 CORS 中间件处理。

### 校验器

```ts
t.str().min(2).max(50).enum('a','b').regex(/^x/)
t.int().min(1)
t.float().min(0)
t.bool()
t.lit('fixed')
t.obj({ a: t.str(), b: t.arr(t.int()).opt() })
t.arr(t.str()).min(1)
t.file({ maxSize: '10mb', mime: ['image/png'] })
t.any().check(v => v)   // 自定义校验
```

类型穿透：`Infer<typeof User>` / `InferShape<...>`。

### 上下文 `ctx`

`ctx.method` · `ctx.path` · `ctx.params`（类型转换后）· `ctx.query` · `ctx.body`（校验后）· `ctx.headers` · `ctx.files`（multipart）· `ctx.state`（中间件共享）· `ctx.requestId` · `ctx.ip` · `ctx.json()` · `ctx.html()` · `ctx.text()` · `ctx.send()` · `ctx.file()` · `ctx.pipe(readable)`（流式响应）· `ctx.redirect()` · `ctx.noContent()` · `ctx.throw(status, msg)` · `ctx.log`。

### 中间件 / 控制流

`app.use(fn)` · `app.deps(fn)` · `group.use(fn)` · `compose([...])`。

`ctx.nextIsHandled` / `ctx.handled` 标记短路；`finally` 自动释放。

### 安全中间件

`app.cors(opts)` · `app.securityHeaders(opts)` · `app.jwt({ secret })` · `app.session({ secret, store, cookieName })` · `app.rateLimit({ windowMs, max, scope })` · `app.csrf({ secret })`。

---

## <a id="examples"></a> 完整示例

```ts
import { NeoApp, t, HttpError } from 'request-neo';

const app = new NeoApp({ cors: true, openapi: { title: 'demo', version: '2026.1.0' } });

// 洋葱中间件
app.use(async (ctx, next) => {
  const t0 = Date.now();
  await next();
  ctx.log?.debug?.('bench', { ms: Date.now() - t0 });
});

// 依赖注入
app.deps(async () => ({ db: { users: [{ id: 1, name: 'vexify' }] } }));

const User = t.obj({ id: t.int().min(1), name: t.str().min(2), active: t.bool().opt() });

app.get('/hello', (ctx) => ctx.json({ hello: 'request-neo 2026' }));
app.get('/user/:id(\\d+)', { params: { id: t.int() } }, (ctx) => ({
  id: ctx.params.id, name: 'user-' + ctx.params.id,
}));
app.post('/user', { body: User, response: User }, (ctx) => ({ id: ctx.body.id, name: ctx.body.name }));
app.post('/boom', () => { throw new HttpError(401, 'no token'); });

// 同端口 WebSocket + SSE
app.ws('/ws', { onMessage: (ws, msg) => ws.send({ echo: msg.text() }) });
app.sse('/events', (ctx, stream) => stream.send({ hello: 'world' }));

app.listen(3000, () => console.log('request-neo up on :3000'));
```

完整可运行版本见 [`examples/server.js`](examples/server.js)。

---

## 许可

[Apache-2.0](LICENSE) · Powered By **Vexify 2026**