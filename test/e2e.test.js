// 回归测试：端到端验证 request-neo 各层能力。
const assert = require('node:assert');
const { NeoApp, t, HttpError, signJwt, RedisSessionStore, RedisRateLimitStore } = require('../dist/index');
const http = require('node:http');

let pass = 0, fail = 0;
function check(name, cond, extra) {
  if (cond) { pass++; console.log('  ok  ', name); }
  else { fail++; console.log('  FAIL', name, extra ?? ''); }
}

function req(port, opts, data) {
  return new Promise((resolve, reject) => {
    const r = http.request({ port, hostname: '127.0.0.1', method: opts.method || 'GET', path: opts.path, headers: opts.headers || {} }, (res) => {
      let b = '';
      res.on('data', (c) => b += c);
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: b, json() { try { return JSON.parse(b); } catch { return null; } } }));
    });
    r.on('error', reject);
    if (data !== undefined) r.write(data);
    r.end();
  });
}

function reqSSE(port) {
  return new Promise((resolve) => {
    const r = http.request({ port, hostname: '127.0.0.1', path: '/stream', headers: authRef }, (res) => {
      res.on('end', () => {});
      resolve({ status: res.statusCode, headers: res.headers });
      r.abort();
    });
    r.end();
  });
}

let authRef;
async function main() {
  const app = new NeoApp({ cors: true, log: { level: 'error' } });

  // 安全中间件
  app.use((ctx, next) => { // 洋葱：请求打点 + finally
    ctx.state = { start: Date.now() };
    return next().finally(() => { ctx.state = undefined; });
  });
  app.jwt({ secret: 's3cret', header: 'authorization' });
  app.rateLimit({ windowMs: 60000, max: 1000 });

  const User = t.obj({ id: t.int().min(1), name: t.str().min(2), tags: t.arr(t.str()).opt(), active: t.bool().opt() });

  app.get('/hello', ctx => ctx.json({ ok: true }));
  app.get('/user/:id(\\d+)', { params: { id: t.int() } }, ctx => ({ id: ctx.params.id, name: 'n' + ctx.params.id }));
  app.post('/user', { body: User, response: User }, ctx => ({ id: ctx.body.id, name: ctx.body.name, extra: 'x' }));
  app.route('/multi', ['GET', 'POST'], ctx => ({ m: ctx.method }));
  app.post('/boom', () => { throw new HttpError(401, 'nope'); });
  // urlFor 别名
  app.get('/item/:a/:b', { alias: 'items.get' }, ctx => ({ a: ctx.params.a, b: ctx.params.b }));

  // 分组
  app.group('/api', (g) => g.post('/echo', ctx => ({ echo: ctx.body })));

  // WS/SSE
  app.sse('/stream', (ctx, s) => { s.send({ head: 1 }); });
  app.ws('/chat', { onMessage: (ws, m) => ws.send('r:' + m.text()) });

  const token = signJwt({ sub: '1' }, 's3cret');
  authRef = { authorization: 'Bearer ' + token };

  const server = await new Promise((res) => { const s = app.listen(0, () => res(s)); });
  const port = server.address().port;

  try {
    check('GET /hello', (await req(port, { path: '/hello', headers: { authorization: 'Bearer ' + token } })).status === 200);
    check('jwt 401', (await req(port, { path: '/hello' })).status === 401);
    check('param int + regex', (await req(port, { path: '/user/42', headers: { authorization: 'Bearer ' + token } })).json().id === 42);
    check('regex reject non-digit -> 404', (await req(port, { path: '/user/ab', headers: { authorization: 'Bearer ' + token } })).status === 404);
    const postOk = await req(port, { path: '/user', method: 'POST', headers: { authorization: 'Bearer ' + token, 'Content-Type': 'application/json' } }, JSON.stringify({ id: 7, name: 'neo', tags: ['a'] }));
    check('POST schema + response-strip', postOk.status === 200 && postOk.json().id === 7 && postOk.json().name === 'neo' && postOk.json().extra === undefined, postOk.body);
    const postBad = await req(port, { path: '/user', method: 'POST', headers: { authorization: 'Bearer ' + token, 'Content-Type': 'application/json' } }, JSON.stringify({ id: 'x' }));
    check('POST invalid -> 422+details', postBad.status === 422 && postBad.json().details?.length > 0, postBad.body);
    check('route multi GET', (await req(port, { path: '/multi', headers: { authorization: 'Bearer ' + token } })).json().m === 'GET');
    check('route multi POST', (await req(port, { path: '/multi', method: 'POST', headers: { authorization: 'Bearer ' + token } })).json().m === 'POST');
    check('HTTPError 401 uniform', (await req(port, { path: '/boom', method: 'POST', headers: { authorization: 'Bearer ' + token } })).json().error === 'unauthorized');
    const del = await req(port, { path: '/hello', method: 'DELETE', headers: { authorization: 'Bearer ' + token } });
    check('405 + Allow', del.status === 405 && (del.headers['allow'] || '').includes('GET'), del.headers);
    const head = await req(port, { path: '/hello', method: 'HEAD', headers: { authorization: 'Bearer ' + token } });
    check('HEAD auto via GET', head.status === 200);
    const echo = await req(port, { path: '/api/echo', method: 'POST', headers: { authorization: 'Bearer ' + token, 'Content-Type': 'application/json' } }, JSON.stringify({ x: 1 }));
    check('group echo', echo.status === 200 && JSON.stringify(echo.json().echo) === '{"x":1}');
    const auth = { authorization: 'Bearer ' + token };
    const docs = await req(port, { path: '/docs', headers: auth });
    check('/docs swagger', docs.status === 200 && docs.body.includes('swagger'));
    const oa = await req(port, { path: '/openapi.json', headers: auth });
    check('/openapi.json', oa.status === 200 && oa.json().openapi === '3.1.0' && !!oa.json().paths['/user/{id}']);
    const metrics = await req(port, { path: '/metrics', headers: auth });
    check('/metrics prometheus', metrics.status === 200 && metrics.body.includes('http_requests_total'));
    const sse = await reqSSE(port);
    check('SSE content-type', sse.status === 200 && (sse.headers['content-type'] || '').includes('text/event-stream'));
    // urlFor
    const url = app.urlFor('items.get', { a: 1, b: 2 });
    check('urlFor alias', url === '/item/1/2', url);
    check('404 uniform', (await req(port, { path: '/nope', headers: { authorization: 'Bearer ' + token } })).json().error === 'not_found');
  } finally {
    server.close();
  }

  await testStores();
  await testGracefulClose();
  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
}

/** 内存桩 Redis 客户端，模拟 node-redis/ioredis 的最小命令 */
function mockRedis() {
  const map = new Map();
  return {
    map,
    async get(k) { return map.has(k) ? map.get(k) : null; },
    async set(k, v, mode, ttl) { map.set(k, v); if (mode === 'PX' && ttl) this._ttl = { k, ttl }; },
    async del(...ks) { for (const k of ks) map.delete(k); },
    async incr(k) { const n = (Number(map.get(k)) || 0) + 1; map.set(k, String(n)); return n; },
    async expire(k, s) { this._exp = { k, s }; },
  };
}

async function testStores() {
  // RedisSessionStore
  const client = mockRedis();
  const ss = new RedisSessionStore({ client, prefix: 't' });
  await ss.set('abc', { user: 1 }, 60000);
  const got = await ss.get('abc');
  check('RedisSessionStore set/get', got && got.user === 1, JSON.stringify(got));
  check('RedisSessionStore persist as JSON', client.map.get('t:session:abc') === '{"user":1}');
  await ss.destroy('abc');
  check('RedisSessionStore destroy', (await ss.get('abc')) === null);
  check('RedisSessionStore missing -> null', (await ss.get('missing')) === null);

  // RedisRateLimitStore 固定窗口
  const rl = new RedisRateLimitStore({ client, prefix: 't' });
  const a = await rl.incr('ip:1', 60000);
  const b = await rl.incr('ip:1', 60000);
  check('RedisRateLimitStore fixed incr', a.count === 1 && b.count === 2, JSON.stringify([a, b]));
  check('RedisRateLimitStore resetAt future', b.resetAt > Date.now());
}

async function testGracefulClose() {
  const app = new NeoApp({ log: { level: 'error' } });
  app.get('/ok', (ctx) => ctx.json({ ok: true }));
  const server = app.listen(0);
  await new Promise((res) => server.once('listening', res));
  const port = server.address().port;
  const ok = await req(port, { path: '/ok' });
  check('pre-close request works', ok.status === 200);
  await new Promise((res) => app.close(res));
  // close 后新连接应被拒绝
  let refused = false;
  await new Promise((r) => {
    const sock = http.get({ port, hostname: '127.0.0.1', path: '/ok' }, () => { r(); });
    sock.on('error', () => { refused = true; r(); });
  });
  check('close() refuses new conns', refused === true);
}

main().catch((e) => { console.error('FATAL', e); process.exit(1); });