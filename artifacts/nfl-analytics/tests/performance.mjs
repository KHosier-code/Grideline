// Run after `node tests/build-performance.mjs`. The app entry is the ordinary
// production bundle; the separately optimized fixture uses the real Home
// component and API, but intentionally does not measure Clerk.
import { chromium } from '@playwright/test';
import { spawn } from 'node:child_process';
import { readdir, stat, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const base = process.env.BASE_PATH ?? '/';
const prefix = base === '/' ? '' : `/${base.split('/').filter(Boolean).join('/')}`;
const port = Number(process.env.PERF_PORT ?? 5198);
const origin = `http://127.0.0.1:${port}`;
const routes = ['/', '/tests/performance-home.html', '/games', '/games/perf-not-a-real-game', '/performance'];
let sparseGameId = null;
const profiles = {
  mobile: { viewport: { width: 390, height: 844 }, isMobile: true, deviceScaleFactor: 2, cpu: 4, latency: 150, throughput: 200 * 1024 },
  desktop: { viewport: { width: 1440, height: 900 }, isMobile: false, deviceScaleFactor: 1, cpu: 1, latency: 20, throughput: 5 * 1024 * 1024 },
};
const budgets = { mobile: { lcpMs: 9000, routeReadyMs: 11000, interactionMs: 3500, cls: 0.1, initialJsKiB: 400 }, desktop: { lcpMs: 4000, routeReadyMs: 6000, interactionMs: 2000, cls: 0.1, initialJsKiB: 400 } };
const sleep = ms => new Promise(r => setTimeout(r, ms));
const server = spawn('pnpm', ['--filter', '@workspace/nfl-analytics', 'run', 'serve', '--', '--port', String(port), '--strictPort'], {
  cwd: resolve(root, '../..'), env: { ...process.env, PORT: String(port), BASE_PATH: base }, stdio: 'pipe', detached: true,
});
let output = '';
server.stderr.on('data', data => { output += data; });
server.stdout.on('data', data => { output += data; });
try {
  let ready = false;
  for (let i = 0; i < 100; i++) {
    if (server.exitCode !== null) throw new Error(`Preview failed: ${output}`);
    try { ready = (await fetch(`${origin}${prefix}/`)).ok; } catch { /* startup */ }
    if (ready) break;
    await sleep(100);
  }
  if (!ready) throw new Error(`Preview did not start: ${output}`);
  const fixtureResponse = await fetch(`${origin}${prefix}/tests/performance-home.html`);
  if (!fixtureResponse.ok || !(await fixtureResponse.text()).includes('Weekly Home performance fixture')) {
    throw new Error('The production build is missing the weekly Home fixture. Run tests/build-performance.mjs first.');
  }
  const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH ?? '/repl/tools/bin/chromium', args: ['--no-sandbox'] });
  try {
    const results = [];
    for (const [profile, settings] of Object.entries(profiles)) {
      for (const [index] of routes.entries()) {
        // Measure Home and Games before the first explicit dashboard lookup.
        // Pre-fetching the dashboard here would hide cold API work from Home.
        if (index === 3 && routes[3] === '/games/perf-not-a-real-game') {
          const dashboardResponse = await fetch('http://localhost:80/api/consumer/dashboard');
          if (!dashboardResponse.ok) throw new Error(`Consumer API unavailable (${dashboardResponse.status}); start the API workflow before measuring.`);
          const dashboard = await dashboardResponse.json();
          const comparisonLabels = new Set(['Blended pass EPA / dropback', 'Blended rush EPA / carry', 'Offensive red-zone rate', 'Seconds per play']);
          for (const candidate of dashboard.games ?? []) {
            if (!candidate.gameId || candidate.prediction) continue;
            const detailResponse = await fetch(`http://localhost:80/api/consumer/games/${encodeURIComponent(candidate.gameId)}`);
            if (!detailResponse.ok) throw new Error(`Game Detail unavailable (${detailResponse.status}).`);
            const detail = await detailResponse.json();
            const chartableComparison = detail.matchupBoard?.assessments?.some(assessment =>
              assessment.edge !== 'insufficient' && assessment.confidence !== 'unavailable'
              && assessment.metrics.some(metric => comparisonLabels.has(metric.label)
                && Number.isFinite(metric.homeValue) && Number.isFinite(metric.awayValue)));
            if (!detail.prediction && !chartableComparison && !detail.movement?.streams?.some(stream => stream.observations.length > 0)) {
              sparseGameId = candidate.gameId;
              break;
            }
          }
          if (!sparseGameId) throw new Error('Consumer dashboard has no genuinely sparse Game Detail with an unavailable saved projection.');
          routes[3] = `/games/${encodeURIComponent(sparseGameId)}`;
        }
        const route = routes[index];
        const isHomeFixture = route === '/tests/performance-home.html';
        const context = await browser.newContext({ viewport: settings.viewport, isMobile: settings.isMobile, deviceScaleFactor: settings.deviceScaleFactor });
        const page = await context.newPage();
        await page.route('**/api/**', async route => {
          const request = route.request();
          const path = new URL(request.url()).pathname + new URL(request.url()).search;
          try {
            const response = await fetch(`http://localhost:80${path}`, { method: request.method() });
            await route.fulfill({ status: response.status, body: Buffer.from(await response.arrayBuffer()), headers: { 'content-type': response.headers.get('content-type') ?? 'application/json' } });
          } catch { await route.abort(); }
        });
        const client = await context.newCDPSession(page);
        await client.send('Network.enable');
        await client.send('Network.emulateNetworkConditions', {
          offline: false, latency: settings.latency,
          downloadThroughput: settings.throughput, uploadThroughput: settings.throughput,
        });
        await client.send('Emulation.setCPUThrottlingRate', { rate: settings.cpu });
        await page.addInitScript(() => {
          window.__perf = { cls: 0, lcp: 0, longTasks: 0 };
          new PerformanceObserver(list => { for (const e of list.getEntries()) if (!e.hadRecentInput) window.__perf.cls += e.value; }).observe({ type: 'layout-shift', buffered: true });
          new PerformanceObserver(list => { for (const e of list.getEntries()) window.__perf.lcp = e.startTime; }).observe({ type: 'largest-contentful-paint', buffered: true });
          new PerformanceObserver(list => { for (const e of list.getEntries()) window.__perf.longTasks += Math.max(0, e.duration - 50); }).observe({ type: 'longtask', buffered: true });
        });
        const url = `${origin}${prefix}${route}`;
        const start = Date.now();
        const response = await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30_000 });
        if (isHomeFixture) {
          await page.locator('main .weekly-home h1').waitFor({ timeout: 12_000 });
          if (await page.locator('main .consumer-state').count()) throw new Error(`${profile}: signed-in Home fixture remained in a loading or error state`);
        } else {
          await page.locator('main h1, main .consumer-state h2, main .consumer-state p').first().waitFor({ timeout: 12_000 }).catch(() => {});
        }
        if (route.startsWith('/games/')) {
          await page.waitForFunction(() => !document.querySelector('main')?.textContent?.includes('Loading matchup details…'), { timeout: 12_000 }).catch(() => {});
        }
        const routeReadyMs = Date.now() - start;
        await page.waitForTimeout(1800);
        const data = await page.evaluate(() => {
          const resources = performance.getEntriesByType('resource');
          const scripts = resources.filter(e => new URL(e.name).pathname.includes('/assets/') && new URL(e.name).pathname.endsWith('.js'));
          const navigation = performance.getEntriesByType('navigation')[0];
          return {
            heading: document.querySelector('main h1, main .consumer-state h2, main .consumer-state p')?.textContent?.trim().slice(0, 100) ?? null,
            lcpMs: Math.round(window.__perf.lcp), cls: Number(window.__perf.cls.toFixed(4)),
            longTaskBlockingMs: Math.round(window.__perf.longTasks),
            domContentLoadedMs: Math.round(navigation.domContentLoadedEventEnd),
            jsRequests: scripts.length,
            jsTransferKiB: Math.round(scripts.reduce((sum, e) => sum + e.transferSize, 0) / 1024),
            assets: scripts.map(e => new URL(e.name).pathname.split('/').pop()),
            chartLoaded: Boolean(document.querySelector('[data-section="pregame-team-comparison"] .recharts-wrapper, [data-section="line-movement"] .recharts-wrapper')),
            comparisonUnavailable: Boolean(document.querySelector('[data-section="pregame-team-comparison"] [role="status"]')),
            movementUnavailable: Boolean(document.querySelector('[data-section="line-movement"] .movement-empty')),
          };
        });
        if (settings.isMobile && route !== '/games') await page.getByRole('button', { name: 'Open navigation' }).click();
        const link = route === '/games'
          ? page.getByRole('link', { name: /^Open .* details$/ }).first()
          : page.locator(`${settings.isMobile ? '#consumer-mobile-navigation' : 'nav[aria-label="Primary navigation"]'} a[href$="/games"]`).first();
        let interactionMs = null;
        if (await link.isVisible().catch(() => false)) {
          const clickStart = Date.now();
          await link.click();
          await page.waitForURL(url => route === '/games'
            ? url.pathname.startsWith(`${prefix}/games/`)
            : url.pathname === `${prefix}/games`, { timeout: 10_000 });
          interactionMs = Date.now() - clickStart;
        }
        if (route === `/games/${encodeURIComponent(sparseGameId)}` && (
          data.chartLoaded || !data.comparisonUnavailable || !data.movementUnavailable
          || data.assets.some(asset => /^(generateCategoricalChart|PregameComparisonPlot|LineMovementPlot|LineChart)-/.test(asset))
        )) {
          throw new Error('Sparse Game Detail must show both unavailable states without downloading chart code or rendering a chart.');
        }
        results.push({ profile, route, scenario: isHomeFixture ? 'signed-in-weekly-home-component-fixture' : 'anonymous-production-route', httpStatus: response?.status(), routeReadyMs, interactionMs, ...data });
        await context.close();
      }
      const boundary = await browser.newPage();
      await boundary.goto(`${origin}${prefix}/admin`, { waitUntil: 'domcontentloaded' });
      await boundary.waitForTimeout(700);
      if (await boundary.locator('.app-shell').count()) throw new Error('Admin workspace appeared for an anonymous visitor.');
      await boundary.goto(`${origin}${prefix}/sign-in`, { waitUntil: 'domcontentloaded' });
      if (await boundary.locator('.app-shell').count()) throw new Error('Sign-in route exposed the admin workspace.');
      await boundary.close();
    }
    const assets = await Promise.all((await readdir(resolve(root, 'dist/public/assets'))).filter(x => x.endsWith('.js')).map(async name => ({ name, kib: Math.round((await stat(resolve(root, 'dist/public/assets', name))).size / 1024) })));
    const report = { basePath: base, budgets, profiles, results, largestJsAssets: assets.sort((a, b) => b.kib - a.kib).slice(0, 12) };
    if (process.env.PERF_OUTPUT) await writeFile(process.env.PERF_OUTPUT, JSON.stringify(report, null, 2) + '\n');
    console.log(JSON.stringify(report, null, 2));
    if (process.env.PERF_ENFORCE === '1') {
      const violations = results.filter(r => r.httpStatus !== 200 || !r.heading || /loading|checking access|unavailable/i.test(r.heading) || r.interactionMs === null || r.routeReadyMs > budgets[r.profile].routeReadyMs || r.lcpMs > budgets[r.profile].lcpMs || r.interactionMs > budgets[r.profile].interactionMs || r.cls > budgets[r.profile].cls || r.jsTransferKiB > budgets[r.profile].initialJsKiB);
      if (violations.length) throw new Error(`Performance budget exceeded: ${violations.map(r => `${r.profile} ${r.route}`).join(', ')}`);
    }
  } finally { await browser.close(); }
} finally { try { process.kill(-server.pid, 'SIGTERM'); } catch { /* Already exited. */ } }