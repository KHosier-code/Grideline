import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { resolve, sep } from 'node:path';
import { documentForPath, injectMetadata } from './metadata.mjs';

const root = resolve(import.meta.dirname, 'dist/public');
const port = Number(process.env.PORT);
if (!Number.isInteger(port) || port <= 0) throw new Error('PORT is required');
const mime = { '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.svg': 'image/svg+xml', '.ico': 'image/x-icon', '.txt': 'text/plain', '.xml': 'application/xml', '.woff2': 'font/woff2' };
const base = `/${(process.env.BASE_PATH || '/').split('/').filter(Boolean).join('/')}`;
const prefix = base === '/' ? '' : base;

// Once PUBLIC_SITE_URL names the live domain (https://probablesports.com), visits
// to the old domain and to www forward to it permanently. /api never reaches
// this server, so scheduled jobs posting to the old domain keep working.
const canonical = process.env.PUBLIC_SITE_URL ? new URL(process.env.PUBLIC_SITE_URL) : null;
const forwardedHosts = new Set(['gridelineanalytics.com', 'www.gridelineanalytics.com',
  ...(canonical && !canonical.hostname.startsWith('www.') ? [`www.${canonical.hostname}`] : [])]);

createServer(async (req, res) => {
  const host = String(req.headers['x-forwarded-host'] || req.headers.host || '').split(',')[0].trim().toLowerCase().replace(/:\d+$/, '');
  if (canonical && host !== canonical.hostname && forwardedHosts.has(host)) {
    res.writeHead(301, { Location: `${canonical.origin}${req.url || '/'}`, 'Cache-Control': 'public, max-age=86400' }).end();
    return;
  }
  if (req.method !== 'GET' && req.method !== 'HEAD') { res.writeHead(405).end(); return; }
  let pathname;
  try { pathname = decodeURIComponent(new URL(req.url || '/', 'http://localhost').pathname); }
  catch { res.writeHead(400).end(); return; }
  if (!pathname.startsWith(`${prefix}/`) && pathname !== prefix) { res.writeHead(404).end(); return; }
  const relative = pathname.slice(prefix.length).replace(/^\/+/, '');
  if (relative.includes('\\') || relative.split('/').includes('..')) { res.writeHead(404).end(); return; }
  const filename = resolve(root, relative);
  if (filename !== root && !filename.startsWith(root + sep)) { res.writeHead(404).end(); return; }
  try {
    if (relative === 'sitemap.xml') {
      const origin = new URL(process.env.PUBLIC_SITE_URL || 'https://gridelineanalytics.com').origin;
      const urls = ['/', '/touchdowns', '/pickem', '/parlays', '/power-ratings', '/qb-rankings', '/games', '/teams', '/usage', '/defense-vs-position', '/red-zone', '/performance', '/methodology']
        .map(path => `<url><loc>${origin}${prefix}${path}</loc></url>`).join('');
      res.writeHead(200, { 'Content-Type': 'application/xml; charset=utf-8' });
      res.end(req.method === 'HEAD' ? undefined : `<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${urls}</urlset>`);
      return;
    }
    if (relative && /\.[a-z0-9]+$/i.test(relative)) {
      const file = await stat(filename);
      if (!file.isFile()) throw new Error('Not a file');
      const ext = relative.slice(relative.lastIndexOf('.'));
      res.writeHead(200, { 'Content-Type': mime[ext] || 'application/octet-stream', 'Cache-Control': 'public, max-age=3600' });
      res.end(req.method === 'HEAD' ? undefined : await readFile(filename));
      return;
    }
    const metadata = await documentForPath(pathname);
    const html = injectMetadata(await readFile(resolve(root, 'index.html'), 'utf8'), metadata);
    res.writeHead(metadata.status, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
    res.end(req.method === 'HEAD' ? undefined : html);
  } catch {
    res.writeHead(404).end();
  }
}).listen(port, '0.0.0.0');