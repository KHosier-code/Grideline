// Run with `node --test artifacts/nfl-analytics/tests/home.browser.test.mjs`
// against the running web workflow. Uses Chromium's DevTools protocol so the
// release check needs no separate browser-testing package or browser download.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const origin = process.env.HOME_BROWSER_URL
  ?? (process.env.REPLIT_DEV_DOMAIN ? `https://${process.env.REPLIT_DEV_DOMAIN}` : 'http://localhost:80');
const kickoff = new Date(Date.now() + 14 * 86400_000).toISOString();
const season = new Date().getUTCFullYear() + 1;
const health = {
  status: 'available',
  sources: Object.fromEntries(['schedule', 'injuries', 'odds', 'players'].map(name =>
    [name, { status: 'available', lastAttemptAt: null, lastSuccessAt: null,
      sourceTimestamp: null, lastAttemptStatus: null, message: null, staleAfterMinutes: 60 }])),
};
const game = (gameId, away, home) => ({
  gameId, season, week: 1, kickoffTime: kickoff, gameStatus: 'Scheduled', gameState: 'pregame',
  venue: null, matchup: { away: { teamId: away, abbreviation: away, name: `${away} Away` },
    home: { teamId: home, abbreviation: home, name: `${home} Home` } },
  finalScore: null, prediction: null, market: {}, marketBoard: { comparisons: [] },
  recommendation: { status: 'partial', reason: 'No eligible evidence', markets: { spread: false, total: false, moneyline: false } },
  dataConfidence: { label: 'Limited', score: 0, reason: 'Synthetic test only' },
  confidence: { markets: [] }, availability: { prediction: 'No eligible saved prediction', market: null },
});
const games = [game('home-test-one', 'AWY', 'HOM'), game('home-test-two', 'VIS', 'LOC')];
const pastGame = {
  ...games[0], kickoffTime: new Date(Date.now() - 14 * 86400_000).toISOString(),
  gameStatus: 'Final', gameState: 'final', finalScore: { away: 17, home: 20 },
};
let dashboardGames = games;
let detail = {
  ...games[0], weather: null, movement: { available: false, streams: [], message: 'No observations',
    completeness: { status: 'complete', returnedObservations: 0, totalObservations: 0 } },
  context: { teams: [], message: 'No confirmed depth', projectedMatchups: [],
    modelPersonnelLimitation: { active: false, recommendationSuppressed: false, reason: null } },
  keyPlayers: [], matchupBoard: { status: 'unavailable', sourceCutoff: new Date().toISOString(),
    assessments: [], summary: [], sources: [], completeness: { supportedCategories: 0, totalCategories: 0 } },
  sourceHealth: health, analysis: { drivers: [], availability: { weather: 'Weather unavailable' } },
};

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
async function until(fn, message, timeout = 20_000) {
  const deadline = Date.now() + timeout;
  let last;
  while (Date.now() < deadline) {
    try {
      const result = await fn();
      if (result) return result;
    } catch (error) { last = error; }
    await sleep(100);
  }
  throw new Error(`Timed out: ${message}${last ? ` (${last.message})` : ''}`);
}

class Cdp {
  constructor(url) {
    this.ws = new WebSocket(url);
    this.nextId = 0;
    this.pending = new Map();
    this.events = new Map();
    this.ws.addEventListener('message', ({ data }) => {
      const message = JSON.parse(data);
      if (message.id) {
        const pending = this.pending.get(message.id);
        this.pending.delete(message.id);
        if (message.error) pending.reject(new Error(message.error.message));
        else pending.resolve(message.result);
      } else if (message.method) {
        for (const listener of this.events.get(message.method) ?? []) listener(message.params);
      }
    });
  }
  async ready() {
    if (this.ws.readyState === WebSocket.OPEN) return;
    await new Promise((resolve, reject) => {
      this.ws.addEventListener('open', resolve, { once: true });
      this.ws.addEventListener('error', reject, { once: true });
    });
  }
  send(method, params = {}) {
    const id = ++this.nextId;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.ws.send(JSON.stringify({ id, method, params }));
    });
  }
  on(method, listener) {
    this.events.set(method, [...(this.events.get(method) ?? []), listener]);
  }
  async evaluate(expression) {
    const { result, exceptionDetails } = await this.send('Runtime.evaluate', {
      expression, returnByValue: true, awaitPromise: true,
    });
    if (exceptionDetails) throw new Error(exceptionDetails.text);
    return result.value;
  }
  async key(key) {
    const code = key === ' ' ? 'Space' : key;
    const virtualKeyCode = key === ' ' ? 32 : 13;
    await this.send('Input.dispatchKeyEvent', { type: 'rawKeyDown', key, code, windowsVirtualKeyCode: virtualKeyCode, nativeVirtualKeyCode: virtualKeyCode });
    await this.send('Input.dispatchKeyEvent', { type: 'char', text: key === ' ' ? ' ' : '\r', key, code, windowsVirtualKeyCode: virtualKeyCode });
    await this.send('Input.dispatchKeyEvent', { type: 'keyUp', key, code, windowsVirtualKeyCode: virtualKeyCode });
  }
  close() { this.ws.close(); }
}

test('weekly Home disclosure, focus, and contextual Game Detail in both themes at desktop and mobile widths', { timeout: 120_000 }, async () => {
  const dir = await mkdtemp(join(tmpdir(), 'gridline-home-browser-'));
  const browser = spawn(process.env.CHROMIUM_PATH ?? '/repl/tools/bin/chromium', [
    '--headless', '--no-sandbox', '--disable-dev-shm-usage', '--remote-debugging-port=0',
    `--user-data-dir=${dir}`, '--no-first-run', '--no-default-browser-check', 'about:blank',
  ], { stdio: 'ignore' });
  let cdp;
  try {
    const port = await until(async () => {
      const line = (await readFile(join(dir, 'DevToolsActivePort'), 'utf8')).split('\n')[0];
      return Number(line) || null;
    }, 'Chromium debugging port');
    const target = await until(async () =>
      (await (await fetch(`http://127.0.0.1:${port}/json/list`)).json())
        .find(page => page.type === 'page' && page.url === 'about:blank'),
    'blank browser tab');
    cdp = new Cdp(target.webSocketDebuggerUrl);
    await cdp.ready();
    await cdp.send('Page.enable');
    await cdp.send('Runtime.enable');
    await cdp.send('Emulation.setTimezoneOverride', { timezoneId: 'UTC' });
    // Only intercept consumer data; the actual React app, routing, and CSS run in Chromium.
    await cdp.send('Fetch.enable', { patterns: [{ urlPattern: '*://*/api/consumer/*', requestStage: 'Request' }] });
    const failures = [];
    const evidenceRequests = [];
    cdp.on('Fetch.requestPaused', ({ requestId, request }) => {
      const path = new URL(request.url).pathname;
      const isEvidence = /defense-vs-position|player-position-matchup|player-usage|red-zone/.test(path);
      if (isEvidence) evidenceRequests.push(path);
      const body = path === '/api/consumer/dashboard'
        ? { status: 'available', games: dashboardGames, note: 'Synthetic browser test', sourceHealth: health }
        : path === '/api/consumer/schedule-selection'
        ? { selection: { season, week: 1 }, reason: 'past' }
        : path === '/api/consumer/games'
        ? { status: 'available', games: [pastGame], sourceHealth: health,
          coverage: { games: 1, gamesWithComparison: 0 },
          teamRecords: [], recordVerification: { complete: true, discrepancies: [] } }
        : path === `/api/consumer/games/${games[0].gameId}` ? detail : null;
      const action = isEvidence
        ? cdp.send('Fetch.fulfillRequest', { requestId, responseCode: 503,
          responseHeaders: [{ name: 'Content-Type', value: 'application/json' }],
          body: Buffer.from('{"message":"Source unavailable"}').toString('base64') })
        : body
        ? cdp.send('Fetch.fulfillRequest', { requestId, responseCode: 200,
          responseHeaders: [{ name: 'Content-Type', value: 'application/json' }],
          body: Buffer.from(JSON.stringify(body)).toString('base64') })
        : cdp.send('Fetch.continueRequest', { requestId });
      action.catch(error => failures.push(error));
    });

    for (const width of [1280, 390]) {
      await cdp.send('Emulation.setDeviceMetricsOverride', { width, height: 850, deviceScaleFactor: 1, mobile: width < 600 });
      for (const theme of ['dark', 'light']) {
        await cdp.send('Page.bringToFront');
        await cdp.send('Page.navigate', { url: `${origin}/tests/home.html` });
        await until(() => cdp.evaluate('document.querySelectorAll(".weekly-card-toggle").length === 2'), `two Home cards at ${width}px in ${theme}`);
        await cdp.send('Page.bringToFront');
        const current = await cdp.evaluate('document.documentElement.classList.contains("dark") ? "dark" : "light"');
        if (current !== theme) {
          await cdp.evaluate('document.querySelector(".consumer-account .theme-toggle").click()');
          await until(() => cdp.evaluate('document.documentElement.classList.contains("dark")') .then(isDark => (isDark ? 'dark' : 'light') === theme), `switch to ${theme}`);
        }
        assert.equal(await cdp.evaluate('document.querySelectorAll(".weekly-evidence").length'), 0);
        // A preceding keyboard input puts Chromium in keyboard modality; focusing
        // the actual button then checks the computed :focus-visible outline.
        await cdp.key('Tab');
        await cdp.evaluate('document.querySelectorAll(".weekly-card-toggle")[0].focus()');
        await cdp.evaluate(`window.__homeKeys = []; document.addEventListener('keydown', e => window.__homeKeys.push(e.key), { once: true })`);
        assert.deepEqual(await cdp.evaluate(`(() => {
          const button = document.querySelectorAll('.weekly-card-toggle')[0];
          const style = getComputedStyle(button);
          return [document.activeElement === button, button.matches(':focus-visible'), style.outlineStyle, style.outlineWidth];
        })()`), [true, true, 'solid', '2px'], `${theme} ${width}px focus ring`);
        await cdp.key('Enter');
        await until(() => cdp.evaluate('document.querySelectorAll(".weekly-evidence").length === 1'), 'Enter opens first card');
        assert.equal(await cdp.evaluate('document.querySelectorAll(".weekly-card-toggle")[0].getAttribute("aria-expanded")'), 'true');
        assert.equal(await cdp.evaluate(`document.getElementById(document.querySelectorAll('.weekly-card-toggle')[0].getAttribute('aria-controls')) !== null`), true);
        await cdp.key(' ');
        await until(() => cdp.evaluate('document.querySelectorAll(".weekly-evidence").length === 0'), 'Space closes first card');
        await cdp.evaluate('document.querySelectorAll(".weekly-card-toggle")[1].focus()');
        await cdp.key(' ');
        await until(() => cdp.evaluate('document.querySelectorAll(".weekly-evidence").length === 1 && document.querySelectorAll(".weekly-card-toggle")[1].getAttribute("aria-expanded") === "true"'), 'Space opens second card');
        await cdp.evaluate('document.querySelectorAll(".weekly-card-toggle")[0].focus()');
        await cdp.key('Enter');
        await until(() => cdp.evaluate('document.querySelectorAll(".weekly-evidence").length === 1 && document.querySelectorAll(".weekly-card-toggle")[0].getAttribute("aria-expanded") === "true"'), 'Enter switches open card');
        assert.equal(await cdp.evaluate('document.querySelectorAll(".weekly-card-toggle")[1].getAttribute("aria-expanded")'), 'false');
        const href = await cdp.evaluate('document.querySelector(".weekly-evidence .weekly-detail-link").getAttribute("href")');
        assert.equal(href, `/games/home-test-one?season=${season}&week=1`);
        evidenceRequests.length = 0;
        await cdp.evaluate('document.querySelector(".weekly-evidence .weekly-detail-link").focus()');
        assert.deepEqual(await cdp.evaluate(`(() => {
          const link = document.querySelector('.weekly-evidence .weekly-detail-link');
          const style = getComputedStyle(link);
          return [document.activeElement === link, link.matches(':focus-visible'), style.outlineStyle, style.outlineWidth];
        })()`), [true, true, 'solid', '2px'], `${theme} ${width}px detail link focus ring`);
        await cdp.key('Enter');
        await until(() => cdp.evaluate(`location.pathname === '/games/home-test-one' && !!document.querySelector('[data-testid="premium-hero"]')`), 'Game Detail loads after navigation');
        assert.equal(await cdp.evaluate('location.search'), `?season=${season}&week=1`);
        assert.equal(await cdp.evaluate('document.querySelector(".premium-teams").textContent.includes("AWY")'), true);
        assert.deepEqual(await cdp.evaluate(`(() => {
          const root = document.querySelector('.consumer-detail');
          return [...root.querySelectorAll('[data-section]')].filter(node => !node.closest('details'))
            .map(node => node.dataset.section);
        })()`), ['game-header', 'gridline-projection', 'matchup-insights'], 'primary hierarchy');
        assert.equal(await cdp.evaluate('document.querySelector(".detail-insights").textContent.includes("No sufficiently supported")'), true);
        assert.equal(await cdp.evaluate('document.querySelector(".detail-primary").textContent.includes("No current market comparison is eligible")'), true);
        assert.equal(await cdp.evaluate('document.querySelectorAll(".detail-disclosure:not([open])").length'), 4);
        assert.equal(await cdp.evaluate('document.querySelector("[data-testid=disclosure-personnel] [data-section]")'), null, 'hidden personnel is not mounted');
        assert.equal(await cdp.evaluate('document.querySelector("[data-testid=disclosure-matchups] [data-section]")'), null, 'hidden matchup charts are not mounted');
        assert.deepEqual(evidenceRequests, [], 'first view must not fetch hidden evidence');
        assert.equal(await cdp.evaluate(`performance.getEntriesByType('resource').some(entry => /(?:LineMovementPlot|PregameComparisonPlot)/.test(entry.name))`), false, 'first view must not load hidden chart chunks');
        await cdp.evaluate('document.querySelector("[data-testid=disclosure-personnel] > summary").click()');
        await until(() => evidenceRequests.includes('/api/consumer/defense-vs-position')
          && evidenceRequests.includes('/api/consumer/player-position-matchup'), 'personnel requests start on open');
        await until(() => cdp.evaluate('document.querySelector("[data-testid=button-retry-defense]") !== null'), 'defensive history error offers retry');
        const defenseRequests = evidenceRequests.filter(path => path === '/api/consumer/defense-vs-position').length;
        await cdp.evaluate('document.querySelector("[data-testid=button-retry-defense]").click()');
        await until(() => evidenceRequests.filter(path => path === '/api/consumer/defense-vs-position').length > defenseRequests, 'defensive history retry starts a new request');
        await cdp.evaluate('document.querySelector("[data-testid=disclosure-personnel] > summary").click()');
        await until(() => cdp.evaluate('!document.querySelector("[data-testid=disclosure-personnel]").open'), 'personnel disclosure closes');
        assert.equal(await cdp.evaluate('document.querySelector("[data-testid=section-defense-vs-position]") !== null'), true, 'personnel stays mounted after collapse');
        assert.equal(await cdp.evaluate('document.documentElement.scrollWidth <= innerWidth + 1'), true, 'no horizontal overflow');
        await cdp.key('Tab');
        await cdp.evaluate('document.querySelector("[data-testid=disclosure-sources] > summary").focus()');
        await cdp.key('Enter');
        await until(() => cdp.evaluate('document.querySelector("[data-testid=disclosure-sources]").open'), 'source disclosure opens by Enter');
        await until(() => cdp.evaluate('document.querySelector("[data-testid=disclosure-sources] .consumer-source-health") !== null'), 'source content mounts on open');
        await cdp.key(' ');
        await until(() => cdp.evaluate('!document.querySelector("[data-testid=disclosure-sources]").open'), 'source disclosure closes by Space');
        assert.equal(await cdp.evaluate('document.querySelector("[data-testid=disclosure-sources] .consumer-source-health") !== null'), true, 'loaded source content remains mounted after collapse');
        await cdp.key('Enter');
        await until(() => cdp.evaluate('document.querySelector("[data-testid=disclosure-sources]").open'), 'source disclosure reopens');
        assert.equal(await cdp.evaluate('document.querySelector("[data-testid=disclosure-sources] .consumer-source-health") !== null'), true);
        detail = {
          ...detail,
          matchupBoard: {
            ...detail.matchupBoard, status: 'partial', completeness: { supportedCategories: 1, totalCategories: 2 },
            sources: ['Recorded games'], summary: [{ category: 'passing', edge: 'home', label: 'HOM', title: 'Passing edge',
              evidence: 'Two-team sample', caveat: 'Partial coverage' }],
            assessments: [
              { category: 'passing', edge: 'home', edgeLabel: 'Home', title: 'Passing', confidence: 'medium',
                coverage: '1/2 games covered', explanation: 'Partial observed sample.', limitations: ['One game missing'],
                metrics: [{ label: 'Pass rate', homeValue: 0.5, awayValue: 0.3, unit: 'rate' },
                  { label: 'Unavailable metric', homeValue: null, awayValue: null, unit: 'rate' }] },
              { category: 'rushing', edge: 'insufficient', edgeLabel: 'Unavailable', title: 'Rushing', confidence: 'unavailable',
                coverage: '0/2 games covered', explanation: 'No observed values.', limitations: [],
                metrics: [{ label: 'Rush rate', homeValue: null, awayValue: null, unit: 'rate' }] },
            ],
          },
        };
        await cdp.send('Page.navigate', { url: `${origin}/games/home-test-one?season=${season}&week=1` });
        await until(() => cdp.evaluate('document.querySelector(".detail-insights article")?.textContent.includes("Passing edge")'), 'supported insight');
        assert.equal(await cdp.evaluate('document.querySelectorAll(".detail-insights article").length'), 1);
        await cdp.evaluate('document.querySelector("[data-testid=disclosure-matchups] > summary").focus()');
        await cdp.key('Enter');
        await until(() => cdp.evaluate('document.querySelector("[data-testid=disclosure-matchups]").open'), 'matchup disclosure opens');
        await until(() => cdp.evaluate('document.querySelector(".matchup-assessment summary")?.textContent.includes("1/2 games covered")'), 'matchup content mounts on open');
        assert.equal(await cdp.evaluate('document.querySelector(".detail-zero-coverage") !== null'), true);
        detail = { ...detail, matchupBoard: { ...detail.matchupBoard, status: 'unavailable', summary: [], assessments: [],
          completeness: { supportedCategories: 0, totalCategories: 0 } } };
        assert.deepEqual(failures, [], 'no intercepted request failures');
      }
      dashboardGames = [];
      await cdp.send('Page.navigate', { url: `${origin}/tests/home.html` });
      await until(() => cdp.evaluate('document.querySelector(".weekly-intro h1")?.textContent === "No upcoming slate in the saved schedule"'), `empty Home at ${width}px`);
      assert.equal(await cdp.evaluate('document.querySelector(".weekly-intro p:not(.consumer-eyebrow)")?.textContent.includes("No future games are available here.")'), true);
      assert.equal(await cdp.evaluate('document.querySelector(".consumer-section-heading h2")?.textContent'), 'No upcoming games');
      assert.equal(await cdp.evaluate('document.body.innerText.includes("The schedule has no future pregame matchups right now.")'), true);
      assert.equal(await cdp.evaluate('document.querySelectorAll(".weekly-card-toggle, .weekly-home .consumer-matchup-feature").length'), 0, 'no invented upcoming matchup');
      assert.equal(await cdp.evaluate('document.querySelectorAll(".consumer-section-heading a").length'), 1);
      assert.deepEqual(await cdp.evaluate(`(() => {
        const link = document.querySelector('.consumer-section-heading a');
        return [link.textContent.trim(), link.getAttribute('href')];
      })()`), ['Browse all games', '/games']);
      await cdp.evaluate('document.querySelector(".consumer-section-heading a").click()');
      await until(() => cdp.evaluate('location.pathname === "/games" && document.querySelector(".terminal-title")?.textContent === "Gridline market board"'), `Games route at ${width}px`);
      await until(() => cdp.evaluate('document.querySelector(".board-game")?.getAttribute("aria-label") === "AWY at HOM"'), `synthetic past game at ${width}px`);
      assert.equal(await cdp.evaluate('document.body.innerText.includes("Past slate · No upcoming games")'), true);
      assert.deepEqual(failures, [], 'no intercepted request failures');
      dashboardGames = games;
    }
  } catch (error) {
    if (cdp) {
      console.error('Browser state:', await cdp.evaluate(`({ url: location.href, hasFocus: document.hasFocus(), keys: window.__homeKeys, focus: document.activeElement?.outerHTML?.slice(0, 300), expanded: [...document.querySelectorAll('.weekly-card-toggle')].map(b => b.getAttribute('aria-expanded')), body: document.body.innerText.slice(0, 400) })`).catch(() => 'unavailable'));
    }
    throw error;
  } finally {
    cdp?.close();
    browser.kill();
    await until(() => rm(dir, { recursive: true, force: true }).then(() => true).catch(() => false), 'remove browser profile');
  }
});