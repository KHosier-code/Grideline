import assert from 'node:assert/strict';
import { test } from 'node:test';
import { documentForPath, injectMetadata, sitemapPages } from '../metadata.mjs';

test('public routes have distinct crawler-visible metadata', async () => {
  for (const [path, fragment] of [['/', 'Touchdown Picks'], ['/games', 'Projections and Lines'], ['/methodology', 'How Probable Makes Its Picks'], ['/performance', 'Model Performance'], ['/receipts', 'NFL Pick Receipts']]) {
    // Before the college launch; the home page's title changes after it (tested below).
    const result = await documentForPath(path, { now: Date.parse('2026-11-15T12:00:00Z') });
    assert.equal(result.status, 200);
    assert.match(result.tags, new RegExp(fragment));
    assert.match(result.tags, /name="robots" content="index, follow"/);
    assert.match(result.tags, new RegExp(`rel="canonical" href="https://probablesports.com${path}"`));
    // Home and TD pages preview this week's picks card; the rest use the brand image.
    assert.match(result.tags, path === '/' ? /og:image.*td-card.png/ : /og:image.*probable-share.png/);
    assert.match(injectMetadata('<!-- GRIDLINE_META -->', result), /<title>/);
  }
});

test('private routes and unverified games are not promoted', async () => {
  for (const path of ['/admin/settings', '/sign-in', '/props', '/games/invalid%2Fid']) {
    const result = await documentForPath(path);
    assert.match(result.tags, /noindex, nofollow/);
    assert.doesNotMatch(result.tags, /rel="canonical"/);
  }
});

test('game identity comes from API, not the URL or unavailable projections', async () => {
  const originalFetch = globalThis.fetch;
  try {
    globalThis.fetch = async () => new Response(JSON.stringify({
      gameId: 'game-1',
      matchup: { away: { name: 'Away Team' }, home: { name: 'Home Team' } },
    }), { status: 200 });
    const found = await documentForPath('/games/game-1');
    assert.match(found.tags, /Away Team at Home Team/);
    assert.doesNotMatch(found.tags, /guaranteed|winning pick/i);
    globalThis.fetch = async () => new Response('', { status: 404 });
    const missing = await documentForPath('/games/missing');
    assert.equal(missing.status, 404);
    assert.match(missing.tags, /noindex, nofollow/);
    globalThis.fetch = async () => { throw new Error('offline'); };
    const offline = await documentForPath('/games/game-1');
    assert.equal(offline.status, 503);
    assert.match(offline.tags, /noindex, nofollow/);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
test('college basketball pages are indexed only from the launch date', async () => {
  const before = Date.parse('2026-11-30T12:00:00Z');
  const after = Date.parse('2026-12-01T12:00:00Z');
  for (const path of ['/cbb', '/cbb/ratings', '/cbb/record', '/cbb/how-it-works']) {
    assert.match((await documentForPath(path, { now: before })).tags, /noindex, nofollow/);
    const launched = await documentForPath(path, { now: after });
    assert.match(launched.tags, /College Basketball/);
    assert.match(launched.tags, /name="robots" content="index, follow"/);
  }
  assert.ok(!sitemapPages(before).some(path => path.startsWith('/cbb')));
  assert.ok(sitemapPages(after).includes('/cbb'));
  assert.ok(sitemapPages(before).includes('/receipts'));
  assert.match((await documentForPath('/', { now: before })).tags, /<title>Probable \| Free NFL Touchdown Picks/);
  assert.match((await documentForPath('/', { now: after })).tags, /NFL and College Basketball/);
  // NFL pages keep working through the launch.
  for (const now of [before, after]) {
    for (const path of ['/nfl', '/touchdowns', '/games', '/performance']) assert.match((await documentForPath(path, { now })).tags, /index, follow/);
  }
});
