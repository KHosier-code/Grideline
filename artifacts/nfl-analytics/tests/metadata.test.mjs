import assert from 'node:assert/strict';
import { test } from 'node:test';
import { documentForPath, injectMetadata } from '../metadata.mjs';

test('public routes have distinct crawler-visible metadata', async () => {
  for (const [path, fragment] of [['/', 'Touchdown Picks'], ['/games', 'Projections and Lines'], ['/methodology', 'How Probable Makes Its Picks'], ['/performance', 'Model Performance']]) {
    const result = await documentForPath(path);
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
  const { CBB_LAUNCH_AT, CBB_PUBLIC_PATHS } = await import('../../../lib/sports-launch.mjs');
  const realNow = Date.now;
  try {
    Date.now = () => Date.parse(CBB_LAUNCH_AT) - 1;
    for (const path of CBB_PUBLIC_PATHS) {
      const before = await documentForPath(path);
      assert.match(before.tags, /noindex, nofollow/);
      assert.doesNotMatch(before.tags, /College Basketball/);
    }
    Date.now = () => Date.parse(CBB_LAUNCH_AT);
    for (const path of CBB_PUBLIC_PATHS) {
      const after = await documentForPath(path);
      assert.equal(after.status, 200);
      assert.match(after.tags, /College Basketball/);
      assert.match(after.tags, /index, follow/);
      assert.match(after.tags, new RegExp(`rel="canonical" href="https://probablesports.com${path}"`));
    }
  } finally {
    Date.now = realNow;
  }
});
