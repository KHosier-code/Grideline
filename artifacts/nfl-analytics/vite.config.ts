import path from 'path';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { defineConfig } from 'vite';
import { readFile } from 'node:fs/promises';
import { documentForPath, injectMetadata } from './metadata.mjs';

import runtimeErrorOverlay from '@replit/vite-plugin-runtime-error-modal';

// Artifact workflows inject both values when serving. Production builds are
// static and do not open a port, so keep build-time defaults available for
// direct verification commands.
const rawPort = process.env.PORT ?? '5173';

const port = Number(rawPort);

if (Number.isNaN(port) || port <= 0) {
  throw new Error(`Invalid PORT value: "${rawPort}"`);
}

const basePath = process.env.BASE_PATH ?? '/';

export default defineConfig({
  base: basePath,
  plugins: [
    {
      name: 'gridline-document-metadata',
      configureServer(server) {
        server.middlewares.use(async (req, res, next) => {
          if (req.url?.split('?')[0] === `${basePath.replace(/\/$/, '')}/sitemap.xml`) {
            const origin = new URL(process.env.PUBLIC_SITE_URL || 'https://gridelineanalytics.com').origin;
            const prefix = basePath.replace(/\/$/, '');
            const urls = ['/', '/touchdowns', '/power-ratings', '/qb-rankings', '/games', '/teams', '/usage', '/defense-vs-position', '/performance', '/methodology'].map(p => `<url><loc>${origin}${prefix}${p}</loc></url>`).join('');
            res.setHeader('Content-Type', 'application/xml; charset=utf-8');
            res.end(`<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${urls}</urlset>`);
            return;
          }
          if (req.method !== 'GET' || !req.headers.accept?.includes('text/html')) return next();
          const pathname = new URL(req.url || '/', 'http://localhost').pathname;
          if (/\.[a-z0-9]+$/i.test(pathname)) return next();
          try {
            const metadata = await documentForPath(pathname, { apiOrigin: 'http://localhost:80' });
            const html = await readFile(path.resolve(import.meta.dirname, 'index.html'), 'utf8');
            res.statusCode = metadata.status;
            res.setHeader('Content-Type', 'text/html; charset=utf-8');
            res.setHeader('Cache-Control', 'no-store');
            res.end(injectMetadata(await server.transformIndexHtml(req.url || '/', html), metadata));
          } catch (error) { next(error); }
        });
      },
    },
    react(),
    tailwindcss(),
    runtimeErrorOverlay(),
    ...(process.env.NODE_ENV !== 'production' &&
    process.env.REPL_ID !== undefined
      ? [
          await import('@replit/vite-plugin-cartographer').then((m) =>
            m.cartographer({
              root: path.resolve(import.meta.dirname, '..'),
            }),
          ),
          await import('@replit/vite-plugin-dev-banner').then((m) =>
            m.devBanner(),
          ),
        ]
      : []),
  ],
  resolve: {
    alias: {
      '@': path.resolve(import.meta.dirname, 'src'),
      '@assets': path.resolve(
        import.meta.dirname,
        '..',
        '..',
        'attached_assets',
      ),
    },
    dedupe: ['react', 'react-dom'],
  },
  root: path.resolve(import.meta.dirname),
  build: {
    outDir: path.resolve(import.meta.dirname, process.env.PERF_HOME_FIXTURE === '1' ? 'dist/performance-fixture' : 'dist/public'),
    emptyOutDir: true,
    // Build the fixture as a separate production entry so the actual app
    // bundle and its chunking remain byte-for-byte the ordinary build.
    ...(process.env.PERF_HOME_FIXTURE === '1' ? {
      rollupOptions: { input: path.resolve(import.meta.dirname, 'tests/performance-home.html') },
    } : {}),
  },
  server: {
    port,
    strictPort: true,
    host: '0.0.0.0',
    allowedHosts: true,
    fs: {
      strict: true,
    },
  },
  preview: {
    port,
    host: '0.0.0.0',
    allowedHosts: true,
  },
});
