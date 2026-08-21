#!/usr/bin/env node
/**
 * request-neo CLI — Powered By Vexify 2026.
 *
 *   request-neo init [dir]         生成一个最小可运行项目
 *   request-neo serve [file]       运行服务文件（默认 examples/server.js）
 *   request-neo --help / -h        帮助
 *   request-neo --version / -v     版本
 */
'use strict';

const fs = require('node:fs');
const path = require('node:path');

const VERSION = '2026.1.0';
const TAGLINE = 'Powered By Vexify 2026';

const HELP = `
  request-neo — Flask / FastAPI 味的 Node.js 全栈 HTTP 框架

  用法:
    request-neo init [dir]        在当前目录/目标目录生成最小项目
    request-neo serve [file]      运行服务文件（默认 examples/server.js）
    request-neo -h, --help        显示帮助
    request-neo -v, --version     显示版本

  示例:
    request-neo init ./my-api
    cd ./my-api && npm install && npm start
`;

const TEMPLATE_MAIN = (name) => `// ${name} — Powered By Vexify ${VERSION}
const { NeoApp, t, HttpError } = require('request-neo');

const app = new NeoApp({
  cors: true,
  openapi: { title: '${name}', version: '${VERSION}' },
});

app.get('/hello', (ctx) => ctx.json({ hello: '${name} ${VERSION}' }));
app.get('/health', () => ({ ok: true }));

app.get('/user/:id(\\\\d+)', { params: { id: t.int().min(1) } }, (ctx) => ({
  id: ctx.params.id,
  name: 'user-' + ctx.params.id,
}));

app.post('/user', { body: t.obj({ id: t.int().min(1), name: t.str().min(2) }) }, (ctx) =>
  ctx.json({ created: ctx.body.id })
);

app.post('/boom', () => { throw new HttpError(401, 'no token'); });

const port = process.env.PORT || 3000;
app.listen(port, () => {
  console.log('\\n  request-neo ' + ${JSON.stringify(name)} + ' listening on http://localhost:' + port);
  console.log('  Docs:   http://localhost:' + port + '/docs');
  console.log('  OpenAPI: http://localhost:' + port + '/openapi.json');
  console.log('  Metrics: http://localhost:' + port + '/metrics\\n');
});
`;

const TEMPLATE_PKG = (name) => JSON.stringify(
  {
    name,
    version: VERSION,
    private: true,
    license: 'Apache-2.0',
    main: 'index.js',
    scripts: { start: 'node index.js', dev: 'node index.js' },
    dependencies: { 'request-neo': `^${VERSION}` },
  },
  null,
  2
) + '\n';

function init(name) {
  const dir = name || '.';
  const target = path.resolve(dir);
  const pkgName = (name || 'request-neo-app').replace(/[/\\]/g, '-');
  if (!fs.existsSync(target)) fs.mkdirSync(target, { recursive: true });
  const main = path.join(target, 'index.js');
  if (fs.existsSync(main) && !process.env.FORCE) {
    console.error(`  ! ${main} 已存在，跳过（用 FORCE=1 强制覆盖）`);
    process.exit(1);
  }
  fs.writeFileSync(main, TEMPLATE_MAIN(pkgName));
  fs.writeFileSync(path.join(target, 'package.json'), TEMPLATE_PKG(pkgName));
  console.log(`\n  ✓ 已生成项目 ${pkgName} @ ${target}`);
  console.log(`    下一步:\n      cd ${target}\n      npm install\n      npm start\n`);
}

function serve(file) {
  const p = path.resolve(file || 'examples/server.js');
  const abs = fs.existsSync(p) ? p : path.resolve('server.js');
  if (!fs.existsSync(abs)) {
    console.error(`  ✗ 找不到服务文件: ${file}（在当前目录创建 server.js 或指定路径）`);
    process.exit(1);
  }
  require(abs);
}

function main(argv) {
  const [cmd, arg] = argv;
  switch (cmd) {
    case 'init':
      return init(arg);
    case 'serve':
      return serve(arg);
    case '-v':
    case '--version':
      return console.log(`request-neo ${VERSION} — ${TAGLINE}`);
    case '-h':
    case '--help':
    case undefined:
      return console.log(HELP);
    default:
      console.error(`  未知命令: ${cmd}\n`);
      console.log(HELP);
      process.exit(1);
  }
}

main(process.argv.slice(2));