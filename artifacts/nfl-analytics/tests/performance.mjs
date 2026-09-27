// Run after `node tests/build-performance.mjs`. The app entry is the ordinary
// production bundle; the separately optimized fixture uses the real Home
// component and API. The account-shell variant measures shared navigation and
// fixture-only account controls, but intentionally does not measure Clerk.
import { chromium } from '@playwright/test';
import { spawn } from 'node:child_process';
import { readdir, stat, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fixtureExpected, fixtureVersion, homePerformanceResponse } from './home-performance-api.mjs';
import { isSparseGameDetail } from './performance-sparse-evidence.mjs';

const root = resolve(import.meta.dirname, '..');
const base = process.env.BASE_PATH ?? '/';
const prefix = base === '/' ? '' : `/${base.split('/').filter(Boolean).join('/')}`;
const port = Number(process.env.PERF_PORT ?? 5198);
const origin = `http://127.0.0.1:${port}`;
const routes = process.env.PERF_ACCOUNT_ONLY === '1'
  ? ['/tests/performance-home.html?shell=account']
  : ['/', '/tests/performance-home.html', '/tests/performance-home.html?shell=account', '/games', '/games/perf-not-a-real-game', '/performance'];
const apiMode = process.env.PERF_API === 'fixture' ? 'fixture' : 'live';
if (process.env.PERF_API && !['fixture', 'live'].includes(process.env.PERF_API)) throw new Error('PERF_API must be fixture or live');
if (apiMode === 'fixture' && process.env.PERF_ACCOUNT_ONLY === '1') throw new Error('PERF_API=fixture cannot be combined with PERF_ACCOUNT_ONLY=1');
if (apiMode === 'fixture') routes.splice(0, routes.length, '/tests/performance-home.html');
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
        if (routes[index] === '/games/perf-not-a-real-game') {
          const dashboardResponse = await fetch('http://localhost:80/api/consumer/dashboard');
          if (!dashboardResponse.ok) throw new Error(`Consumer API unavailable (${dashboardResponse.status}); start the API workflow before measuring.`);
          const dashboard = await dashboardResponse.json();
          for (const candidate of dashboard.games ?? []) {
            if (!candidate.gameId || candidate.prediction) continue;
            const detailResponse = await fetch(`http://localhost:80/api/consumer/games/${encodeURIComponent(candidate.gameId)}`);
            if (!detailResponse.ok) throw new Error(`Game Detail unavailable (${detailResponse.status}).`);
            const detail = await detailResponse.json();
             if (isSparseGameDetail(detail)) {
              sparseGameId = candidate.gameId;
              break;
            }
          }
          if (!sparseGameId) throw new Error('Consumer dashboard has no genuinely sparse Game Detail with an unavailable saved projection.');
          routes[index] = `/games/${encodeURIComponent(sparseGameId)}`;
        }
        const route = routes[index];
        const isHomeFixture = route === '/tests/performance-home.html';
        const isAccountFixture = route === '/tests/performance-home.html?shell=account';
        const context = await browser.newContext({ viewport: settings.viewport, isMobile: settings.isMobile, deviceScaleFactor: settings.deviceScaleFactor });
         const unexpectedRequests = [];
         if (apiMode === 'fixture') await context.route('**/api/**', async route => {
           const body = homePerformanceResponse(route.request().url());
           if (!body || route.request().method() !== 'GET') {
             unexpectedRequests.push(`${route.request().method()} ${route.request().url()}`);
             await route.abort();
             return;
           }
           await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });
         });
        const page = await context.newPage();
         if (apiMode === 'live') await page.route('**/api/**', async route => {
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
        if (isHomeFixture || isAccountFixture) {
          await page.locator('main .weekly-home h1').waitFor({ timeout: 12_000 });
          if (await page.locator('main .consumer-state').count()) throw new Error(`${profile}: Home fixture remained in a loading or error state`);
          if (apiMode === 'fixture') {
            try {
              await page.locator('[data-section="pregame-team-comparison"] .recharts-wrapper').waitFor({ timeout: 12_000 });
              await page.locator('.ct-trend-chart .recharts-wrapper').waitFor({ timeout: 12_000 });
            } catch (error) {
              throw new Error(`Fixture chart readiness failed: ${await page.locator('main').innerText()} | unexpected API: ${unexpectedRequests.join(', ')}`, { cause: error });
            }
            const heading = await page.locator('main .weekly-home h1').textContent();
            const cards = await page.locator('.weekly-card').count();
            if (unexpectedRequests.length || heading !== fixtureExpected.heading || cards !== fixtureExpected.cards
              || await page.locator('.ch-trend-state, .ch-trend-skeleton').count()) {
              throw new Error(`Fixture Home did not render expected slate and both charts: ${heading}, ${cards} cards; unexpected API: ${unexpectedRequests.join(', ')}`);
            }
          }
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
          };
        });
        let accountActionMs = null;
        if (isAccountFixture) {
          const actionStart = Date.now();
          if (settings.isMobile) {
            await page.getByRole('button', { name: 'Open navigation' }).click();
            await page.locator('#consumer-mobile-navigation').getByRole('button', { name: 'Manage account' }).click();
          } else {
            await page.getByRole('button', { name: 'Fixture account control' }).click();
          }
          await page.getByTestId('fixture-account-panel').waitFor();
          accountActionMs = Date.now() - actionStart;
          // No mock login is installed: this link must reach the real anonymous
          // saved-games route, where private data remains inaccessible.
        }
        if (unexpectedRequests.length) throw new Error(`Unexpected fixture API requests: ${unexpectedRequests.join(', ')}`);
         if (route === `/games/${encodeURIComponent(sparseGameId)}`) {
           // Inspect the original detail before the navigation check below.
           // The disclosures intentionally defer their content; opening them
           // after cold-load measurement must still avoid both chart bundles.
           await page.getByTestId('game-initial-markets').waitFor();
           await page.getByTestId('disclosure-matchups').locator('summary').click();
           await page.locator('[data-section="line-movement"] .movement-empty').waitFor();
           await page.locator('[data-section="pregame-team-comparison"] [role="status"]').waitFor();
           const sparseEvidence = await page.evaluate(() => {
             const assets = performance.getEntriesByType('resource')
               .filter(e => new URL(e.name).pathname.endsWith('.js'))
               .map(e => new URL(e.name).pathname.split('/').pop());
             return {
               chartLoaded: Boolean(document.querySelector('[data-section="pregame-team-comparison"] .recharts-wrapper, [data-section="line-movement"] .recharts-wrapper')),
               comparisonUnavailable: Boolean(document.querySelector('[data-section="pregame-team-comparison"] [role="status"]')),
               movementUnavailable: Boolean(document.querySelector('[data-section="line-movement"] .movement-empty')),
               chartAssets: assets.filter(asset => /^(generateCategoricalChart|PregameComparisonPlot|LineMovementPlot|LineChart)-/.test(asset)),
             };
           });
           if (sparseEvidence.chartLoaded || !sparseEvidence.comparisonUnavailable
             || !sparseEvidence.movementUnavailable || sparseEvidence.chartAssets.length) {
             throw new Error(`Sparse Game Detail rendered chart evidence unexpectedly: ${JSON.stringify(sparseEvidence)}`);
           }
         }
        if (settings.isMobile && route !== '/games') await page.getByRole('button', { name: 'Open navigation' }).click();
        const link = route === '/games'
          ? page.getByRole('link', { name: /^Open .* details$/ }).first()
          : page.locator(`${settings.isMobile ? '#consumer-mobile-navigation' : 'nav[aria-label="Primary navigation"]'} a[href$="${isAccountFixture ? '/saved-games' : '/games'}"]`).first();
        let interactionMs = null;
        if (await link.isVisible().catch(() => false)) {
          const clickStart = Date.now();
          await link.click();
          await page.waitForURL(url => route === '/games'
            ? url.pathname.startsWith(`${prefix}/games/`)
            : url.pathname === `${prefix}${isAccountFixture ? '/saved-games' : '/games'}`, { timeout: 10_000 });
          interactionMs = Date.now() - clickStart;
        }
        if (isAccountFixture) {
          // Wouter changes the fixture URL in place. Reload at the destination
          // to check the ordinary production app's anonymous access boundary.
          await page.reload({ waitUntil: 'domcontentloaded' });
          await page.getByTestId('status-saved-games-signed-out').waitFor({ timeout: 12_000 });
          if (await page.getByTestId('list-saved-games').count()) throw new Error('Account fixture exposed private saved games.');
        }
        results.push({ profile, route, scenario: isAccountFixture ? 'unauthenticated-account-shell-visual-fixture' : isHomeFixture ? 'signed-in-weekly-home-component-fixture' : 'anonymous-production-route', httpStatus: response?.status(), routeReadyMs, interactionMs, accountActionMs, ...data });
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
     const report = { apiMode, fixtureVersion: apiMode === 'fixture' ? fixtureVersion : null, basePath: base, budgets, profiles, results, largestJsAssets: assets.sort((a, b) => b.kib - a.kib).slice(0, 12) };
    if (process.env.PERF_OUTPUT) await writeFile(process.env.PERF_OUTPUT, JSON.stringify(report, null, 2) + '\n');
    console.log(JSON.stringify(report, null, 2));
    if (process.env.PERF_ENFORCE === '1') {
      const violations = results.filter(r => r.httpStatus !== 200 || !r.heading || /loading|checking access|unavailable/i.test(r.heading) || r.interactionMs === null || r.routeReadyMs > budgets[r.profile].routeReadyMs || r.lcpMs > budgets[r.profile].lcpMs || r.interactionMs > budgets[r.profile].interactionMs || r.cls > budgets[r.profile].cls || r.jsTransferKiB > budgets[r.profile].initialJsKiB);
      if (violations.length) throw new Error(`Performance budget exceeded: ${violations.map(r => `${r.profile} ${r.route}`).join(', ')}`);
    }
  } finally { await browser.close(); }
} finally { try { process.kill(-server.pid, 'SIGTERM'); } catch { /* Already exited. */ } }