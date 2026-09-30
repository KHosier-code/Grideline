import assert from 'node:assert/strict';
import test from 'node:test';
import { capturedText, homeWinChance, normalCdf, outcomeCounts, simulateMargins, toCounts, winRange } from './sim.ts';

test('normal CDF matches known values', () => {
  assert.ok(Math.abs(normalCdf(0) - 0.5) < 1e-7);
  assert.ok(Math.abs(normalCdf(1) - 0.841345) < 1e-5);
  assert.ok(Math.abs(normalCdf(-1.96) - 0.024998) < 1e-5);
});

test('a 3-point favorite wins about 60 of 100, a pick-em 50', () => {
  assert.equal(Math.round(homeWinChance(3) * 100), 60);
  assert.equal(Math.round(homeWinChance(0) * 100), 50);
  assert.equal(Math.round(homeWinChance(-10) * 100), 20);
});

test('counts always add to 100 and follow the favorite', () => {
  assert.deepEqual(toCounts([1 / 3, 1 / 3, 1 / 3]), [34, 33, 33]);
  const outcomes = outcomeCounts(7);
  assert.equal(outcomes.reduce((sum, item) => sum + item.count, 0), 100);
  const home = outcomes.filter(item => item.side === 'home').reduce((sum, item) => sum + item.count, 0);
  assert.equal(home, Math.round(homeWinChance(7) * 100));
});

test('simulated runs are replayable, tie-free and centered on the expectation', () => {
  assert.deepEqual(simulateMargins(4, 42), simulateMargins(4, 42));
  const many = simulateMargins(4, 7, 20_000);
  assert.ok(!many.includes(0));
  const mean = many.reduce((sum, value) => sum + value, 0) / many.length;
  assert.ok(Math.abs(mean - 4) < 0.4, `mean ${mean}`);
});

test('the normal range holds about 95% of runs', () => {
  assert.deepEqual(winRange(0.8), { low: 72, high: 88 });
  assert.deepEqual(winRange(0.5), { low: 40, high: 60 });
  assert.deepEqual(winRange(1), { low: 100, high: 100 });
  const range = winRange(homeWinChance(7));
  let inside = 0;
  for (let seed = 1; seed <= 2_000; seed += 1) {
    const wins = simulateMargins(7, seed).filter(margin => margin > 0).length;
    if (wins >= range.low && wins <= range.high) inside += 1;
  }
  assert.ok(inside / 2_000 > 0.93 && inside / 2_000 < 0.98, `inside ${inside}`);
});

test('capture times read as a short date, and bad input reads as nothing', () => {
  assert.match(capturedText('2026-09-30T12:00:00Z') ?? '', /^as of Sep 30, /);
  assert.equal(capturedText(null), null);
  assert.equal(capturedText('not a date'), null);
});
