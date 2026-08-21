// 示例：启动一个几乎用完所有能力的 request-neo 服务。
const { NeoApp, t, HttpError } = require('../dist/index');

const app = new NeoApp({
  cors: true,
  log: { level: 'info', pretty: true, },
  body: { maxBodyBytes: 32 * 1024 * 1024, maxFiles: 20 },
  openapi: { title: 'request-neo demo', version: '2026.1.0' },
});

// 全局中间件（洋葱）
app.use(async (ctx, next) => {
  const t0 = Date.now();
  await next();
  ctx.log?.debug?.('bench', { ms: Date.now() - t0 });
});

// 依赖注入
app.deps(async (ctx) => ({ db: { users: [{ id: 1, name: 'vexify' }] }, ts: Date.now() }));

// 路由 + schema + 全链路类型推断
const User = t.obj({
  id: t.int().min(1),
  name: t.str().min(2).max(50),
  tags: t.arr(t.str()).opt(),
  active: t.bool().opt(),
});

app.get('/hello', (ctx) => ctx.json({ hello: 'request-neo 2026', method: ctx.method }));
app.get('/health', ctx => ({ ok: true }));
app.get('/user/:id(\\d+)', { params: { id: t.int().min(1) } }, (ctx) => {
  // ctx.params.id 已被 t.int 归一为 number
  return { id: ctx.params.id, name: `user-${ctx.params.id}` };
});
app.post('/user', { body: User, response: User }, (ctx) => {
  // ctx.body 类型为 User 形状；返回会按 response schema 序列化
  return { id: ctx.body.id, name: ctx.body.name, tags: ctx.body.tags, extra: 'stripped' };
});
app.route('/multi', ['GET', 'POST'], (ctx) => {
  if (ctx.method === 'GET') return ctx.json({ m: 'get' });
  return ctx.json({ m: 'post' });
});
app.post('/auth/fail', () => {
  throw new HttpError(401, 'need token');
});

// 参数化路由别名 + urlFor
app.get('/item/:id', { alias: 'item.get' }, (ctx) => ({ id: ctx.params.id }));

// 嵌套路由组
app.group('/api/v1', (g) => {
  g.get('/ping', ctx => ({ pong: true }));
  g.post('/echo', ctx => ({ got: ctx.body }));
});

// WebSocket 同端口
app.ws('/ws', {
  onConnect: (ws) => { console.log('ws connect', ws.id); },
  onMessage: (ws, msg) => {
    const data = msg.text();
    ws.send({ echo: data, at: Date.now() });
  },
  onClose: (ws, code) => console.log('ws close', code),
});

// SSE
app.sse('/events', (ctx, stream) => {
  stream.send({ hello: 'world' });
  const iv = setInterval(() => stream.send({ t: Date.now() }), 2000);
  ctx.res.on('close', () => clearInterval(iv));
});

// 静态
const path = require('node:path');
app.static('/assets', path.join(__dirname, 'public'));

const port = process.env.PORT || 3000;
app.listen(port, () => {
  console.log(`\n  request-neo (Powered By Vexify 2026) listening on http://localhost:${port}`);
  console.log(`  Docs:  http://localhost:${port}/docs`);
  console.log(`  OpenAPI: http://localhost:${port}/openapi.json`);
  console.log(`  Metrics: http://localhost:${port}/metrics\n`);
});