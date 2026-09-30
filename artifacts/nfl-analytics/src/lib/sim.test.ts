import assert from 'node:assert/strict';
import test from 'node:test';
import { homeWinChance, normalCdf, outcomeCounts, simulateMargins, toCounts } from './sim.ts';

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
