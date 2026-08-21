<div align="center">

# request-neo

**Powered By Vexify 2026** · Apache-2.0

A Flask / FastAPI-flavored, full-stack Node.js HTTP framework — protocol, routing, validation, middleware, real-time, security, and observability in one package.

[Quick Start](#quickstart) · [Feature Matrix](#matrix) · [API Reference](#api) · [Examples](#examples)

</div>

---

## <a id="quickstart"></a> Quick Start

```bash
npm i request-neo
```

```ts
import { NeoApp, t, HttpError } from 'request-neo';

const app = new NeoApp({ cors: true, openapi: { title: 'demo' } });
app.listen(3000, () => console.log('up'));
```

- Long-lived HTTP/1.1 server — `createServer().listen(port)`, no `npx` required.
- Built-in `/docs` (Swagger UI), `/redoc` (ReDoc), `/openapi.json`, `/metrics` (Prometheus).

---

## <a id="matrix"></a> Feature Matrix (50 requirements)

### Transport & Protocol (1–8)

| Capability | API |
|---|---|
| Persistent HTTP/1.1 server | `new NeoApp().listen(port)` |
| Optional HTTP/2 + ALPN fallback | `new NeoApp({ http2: true })` |
| One-line HTTPS (self-signed / hot-load files) | `new NeoApp({ https: { key, cert } })` |
| Streaming request body parsing (no full buffering) | `readBodyStream(ctx, { stream: true })` / `parseBody` |
| Large-file streaming passthrough (multipart, no disk staging) | `parseBody(ctx, { multipart: { toDir } })` |
| Streaming responses (chunked / backpressure-aware) | `ctx.res.write(...)` + `ctx.pipe()` |
| Configurable timeouts / keep-alive / max header size | `new NeoApp({ timeout, keepAlive, maxHeaderSize })` |
| HTTP + WebSocket + SSE on the same port | `app.ws('/chat', …)` + `app.sse('/events', …)` |

### Routing (9–18)

| Capability | API |
|---|---|
| Flask-style `route(path, ['GET','POST'])` | `app.route('/p', ['GET','POST'], handler)` |
| Parametric routes + regex constraints | `app.get('/user/:id(\\d+)', handler)` |
| Nested route groups | `app.group('/api/v1', (g) => g.get(…))` |
| Route-level schema declarations | `app.get('/u/:id', { params: { id: t.int() } }, handler)` |
| Automatic 405 + `Allow` header | built-in |
| Radix-tree matching (O(log n), no regex scan) | `RadixTree` |
| Wildcard / static files | `app.static('/static/*', dir)` |
| Route aliases + reverse URL | `get('/item/:id', { alias: 'item.get' })` → `urlFor('item.get', { id: 1 })` |
| HEAD auto-derived from GET | built-in |
| Route-level middleware mount points | `get(path, { middleware: [fn] }, handler)` |

### Validation & Types (19–27)

| Capability | API |
|---|---|
| Built-in validators | `t.str()/t.int()/t.float()/t.bool()/t.obj()/t.arr()/t.file()/t.any()/t.lit()` |
| Chained constraints | `.opt().min().max().enum().regex().desc()` |
| Auto body validation (422 on failure) | `post('/x', { body: Schema }, handler)` |
| Response serialization against schema (strip/defaults) | `post('/x', { response: Schema }, handler)` |
| End-to-end TS type inference | `ctx.body.name: string`、`ctx.params.id: number` |
| Compile-time OpenAPI 3.1 extraction | generated automatically from `t` definitions |
| Automatic query-param type coercion | `?age=18` → `number` |
| Special file field type | `t.file({ maxSize, mime })` |
| Plug-and-play custom check functions | `.check((value, path) => value)` |

### Middleware & Control Flow (28–34)

| Capability | API |
|---|---|
| Onion model | `app.use(async (ctx, next) => { await next(); })` |
| Global / group / route middleware stacking | `app.use` + `group.use` + `{ middleware }` |
| Errors as responses | `throw new HttpError(401, 'no')` responds as JSON |
| Unified error serialization | `{ status, error, message, requestId, details }` |
| DI-style preflight | `app.deps(async (ctx) => ({ db, user }))` |
| Request short-circuiting | `ctx.json(...)` skips the next onion layers |
| Async resource auto-release | `finally` / `ctx.on('close')` hooks |

### Real-time (35–39)

| Capability | API |
|---|---|
| Same-port WebSocket | `app.ws('/chat', { onConnect, onMessage, onClose })` |
| Broadcast / rooms / targeted push | `wsSink.broadcast(...)` / `wsSink.toRoom(...)` / `wsSink.toUser(...)` |
| Native SSE | `app.sse('/events', (ctx, stream) => stream.send(obj))` |
| SSE auto-reconnect headers + heartbeat | `sse(pathname, { heartbeatMs })` |
| Shared auth middleware for WS/SSE | both run the global `app.use` first |

### Security (40–45)

| Capability | API |
|---|---|
| One-line CORS / fine-grained | `new NeoApp({ cors: true })` or `app.cors({ origin })` |
| Helmet-level security headers | `new NeoApp({ securityHeaders: true })` |
| JWT verification (auto 401) | `app.jwt({ secret })` |
| Sessions (signed cookie + swappable store) | `app.session({ secret, store })` |
| Rate limiting (fixed/sliding window, IP/Token) | `app.rateLimit({ windowMs, max, scope })` |
| CSRF (double-cookie; excludes SSE/WS) | `app.csrf({ secret })` |

### Observability & Docs (46–50)

| Capability | API |
|---|---|
| Structured logging (requestId/duration/route) | `new NeoApp({ log: { level, pretty } })` |
| Request-level `ctx.log.debug()` with context | built-in |
| Automatic OpenAPI JSON | `/openapi.json` |
| Swagger UI + ReDoc | `/docs` `/redoc` (`openapi.ui` toggle) |
| Prometheus metrics endpoint (counts/latency/P99) | `/metrics` |

---

## <a id="api"></a> API Reference

### App options

```ts
new NeoApp({
  cors: true | { origin, methods, headers },
  securityHeaders: true,
  http2: boolean,                        // HTTP/2 same-port ALPN
  https: { key: Buffer, cert: Buffer },   // one-line HTTPS
  timeout, keepAlive, maxHeaderSize,     // connection-level config
  body: { maxBodyBytes, maxFiles },
  log: { level: 'debug'|'info'|'warn'|'error', pretty: boolean },
  openapi: { title, version, description, ui: boolean },
  prometheus: boolean,                   // enable /metrics
})
```

### Routing methods

`app.route(path, methods, opts?, handler)` · `app.get/post/put/patch/delete(...)` · `app.ws(...)` · `app.sse(...)` · `app.static(prefix, dir)` · `app.group(prefix, cb)` · `app.urlFor(name, params)`.

`HEAD` is auto-derived from `GET`; `OPTIONS` is handled by the CORS middleware.

### Validators

```ts
t.str().min(2).max(50).enum('a','b').regex(/^x/)
t.int().min(1)
t.float().min(0)
t.bool()
t.lit('fixed')
t.obj({ a: t.str(), b: t.arr(t.int()).opt() })
t.arr(t.str()).min(1)
t.file({ maxSize: '10mb', mime: ['image/png'] })
t.any().check(v => v)   // custom check
```

Type passthrough: `Infer<typeof User>` / `InferShape<...>`.

### Context `ctx`

`ctx.method` · `ctx.path` · `ctx.params` (coerced) · `ctx.query` · `ctx.body` (validated) · `ctx.headers` · `ctx.files` (multipart) · `ctx.state` (middleware-shared) · `ctx.requestId` · `ctx.ip` · `ctx.json()` · `ctx.html()` · `ctx.text()` · `ctx.send()` · `ctx.file()` · `ctx.pipe(readable)` (streaming) · `ctx.redirect()` · `ctx.noContent()` · `ctx.throw(status, msg)` · `ctx.log`.

### Middleware / control flow

`app.use(fn)` · `app.deps(fn)` · `group.use(fn)` · `compose([...])`.

`ctx.nextIsHandled` / `ctx.handled` mark short-circuiting; `finally` auto-releases.

### Security middleware

`app.cors(opts)` · `app.securityHeaders(opts)` · `app.jwt({ secret })` · `app.session({ secret, store, cookieName })` · `app.rateLimit({ windowMs, max, scope })` · `app.csrf({ secret })`.

---

## <a id="examples"></a> Full Example

```ts
import { NeoApp, t, HttpError } from 'request-neo';

const app = new NeoApp({ cors: true, openapi: { title: 'demo', version: '1.0.0' } });

// Onion middleware
app.use(async (ctx, next) => {
  const t0 = Date.now();
  await next();
  ctx.log?.debug?.('bench', { ms: Date.now() - t0 });
});

// Dependency injection
app.deps(async () => ({ db: { users: [{ id: 1, name: 'vexify' }] } }));

const User = t.obj({ id: t.int().min(1), name: t.str().min(2), active: t.bool().opt() });

app.get('/hello', (ctx) => ctx.json({ hello: 'request-neo 2026' }));
app.get('/user/:id(\\d+)', { params: { id: t.int() } }, (ctx) => ({
  id: ctx.params.id, name: 'user-' + ctx.params.id,
}));
app.post('/user', { body: User, response: User }, (ctx) => ({ id: ctx.body.id, name: ctx.body.name }));
app.post('/boom', () => { throw new HttpError(401, 'no token'); });

// Same-port WebSocket + SSE
app.ws('/ws', { onMessage: (ws, msg) => ws.send({ echo: msg.text() }) });
app.sse('/events', (ctx, stream) => stream.send({ hello: 'world' }));

app.listen(3000, () => console.log('request-neo up on :3000'));
```

A fully runnable version lives in [`examples/server.js`](examples/server.js).

---

## License

[Apache-2.0](LICENSE) · Powered By **Vexify 2026**