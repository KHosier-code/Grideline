// Single-container entrypoint for hosts outside Replit (e.g. Railway).
//
// On Replit, a path router sent /api/* to the API service and everything else
// to the web service. This file reproduces that inside one container:
//   - the API (+ approved data worker) runs via dist/production.mjs on API_PORT
//   - the static web server runs via serve.mjs on WEB_PORT
//   - a small gateway listens on PORT and forwards by path
// If either child exits, the container exits so the host restarts it.
import { spawn } from 'node:child_process';
import { createServer, request } from 'node:http';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const publicPort = Number(process.env.PORT || 3000);
const apiPort = Number(process.env.API_PORT || 8080);
const webPort = Number(process.env.WEB_PORT || 21788);

const children = [];
let stopping = false;

function start(name, args, env) {
  const child = spawn(process.execPath, args, {
    cwd: root,
    env: { ...process.env, ...env },
    stdio: 'inherit',
  });
  children.push(child);
  child.once('exit', (code, signal) => {
    if (stopping) return;
    console.error(`${name} exited`, { code, signal });
    shutdown('SIGTERM', code ?? 1);
  });
  return child;
}

function shutdown(signal, exitCode = 0) {
  if (stopping) return;
  stopping = true;
  for (const child of children) if (child.exitCode === null) child.kill(signal);
  setTimeout(() => process.exit(exitCode), 10_000).unref();
  Promise.all(children.map(child => child.exitCode !== null ? null
    : new Promise(resolve => child.once('exit', resolve)))).then(() => process.exit(exitCode));
}

process.once('SIGTERM', () => shutdown('SIGTERM'));
process.once('SIGINT', () => shutdown('SIGINT'));

start('Gridline API', ['--enable-source-maps', process.env.GRIDLINE_API_ENTRY || 'artifacts/api-server/dist/production.mjs'], {
  PORT: String(apiPort),
});
start('Gridline web', ['artifacts/nfl-analytics/serve.mjs'], {
  PORT: String(webPort),
  BASE_PATH: '/',
  INTERNAL_API_ORIGIN: `http://127.0.0.1:${apiPort}`,
});

const isApiPath = pathname => pathname === '/api' || pathname.startsWith('/api/');

createServer((req, res) => {
  const pathname = (req.url || '/').split('?')[0];
  const port = isApiPath(pathname) ? apiPort : webPort;
  const headers = { ...req.headers };
  // Keep the public host visible to the API (the Clerk proxy builds its URL from it).
  if (!headers['x-forwarded-host'] && headers.host) headers['x-forwarded-host'] = headers.host;
  if (!headers['x-forwarded-proto']) headers['x-forwarded-proto'] = 'https';
  const upstream = request({ host: '127.0.0.1', port, method: req.method, path: req.url, headers }, upstreamRes => {
    res.writeHead(upstreamRes.statusCode ?? 502, upstreamRes.headers);
    upstreamRes.pipe(res);
  });
  upstream.on('error', () => {
    if (!res.headersSent) res.writeHead(502, { 'Content-Type': 'text/plain' });
    res.end('Gridline is starting up. Please retry in a moment.');
  });
  req.pipe(upstream);
}).listen(publicPort, '0.0.0.0', () => {
  console.info(`Gridline gateway listening on ${publicPort} (api ${apiPort}, web ${webPort})`);
});
