import assert from 'node:assert/strict';
import test from 'node:test';
import { addLeg, fairAmerican, gameKeyFor, lineLegs, quoteParlay, simulateParlay, toAmerican, toDecimal, type ParlayLeg } from './parlay.ts';

const leg = (id: string, gameKey: string, probability: number, bookPrice: number | null = null): ParlayLeg =>
  ({ id, kind: 'winner', team: 'BUF', gameKey, label: id, detail: '', probability, bookPrice, kickoff: null });

test('odds conversions round-trip', () => {
  assert.equal(toDecimal(150), 2.5);
  assert.equal(toDecimal(-200), 1.5);
  assert.equal(toAmerican(2.5), 150);
  assert.equal(toAmerican(1.5), -200);
  assert.equal(fairAmerican(0.5), 100);
  assert.equal(fairAmerican(0.2), 400);
});

test('a parlay multiplies independent legs and prices the book parlay', () => {
  const quote = quoteParlay([leg('a', 'BUF-NE', 0.5, 100), leg('b', 'BAL-TEN', 0.8, -400)]);
  assert.equal(quote.probability, 0.4);
  assert.equal(quote.fairOdds, 150);
  assert.equal(quote.bookOdds, 150);          // 2.0 x 1.25 = 2.5
  assert.equal(quote.expectedOnTen, 0);       // fair price: break even
  assert.equal(quote.sameGame, false);
  assert.equal(quoteParlay([leg('a', 'x', 0.5, 100), leg('b', 'y', 0.5, null)]).bookOdds, null);
});

test('one leg per game: adding from the same game replaces, re-adding removes', () => {
  let legs = addLeg([], leg('a', 'BUF-NE', 0.7));
  legs = addLeg(legs, leg('b', 'BUF-NE', 0.3));
  assert.deepEqual(legs.map(item => item.id), ['b']);
  assert.deepEqual(addLeg(legs, leg('b', 'BUF-NE', 0.3)), []);
});

test('team pair keys ignore order and aliases, and simulations replay', () => {
  assert.equal(gameKeyFor('WSH', 'IND'), gameKeyFor('IND', 'WAS'));
  const legs = [leg('a', 'x', 0.6), leg('b', 'y', 0.5)];
  assert.deepEqual(simulateParlay(legs, 9), simulateParlay(legs, 9));
  const hits = simulateParlay(legs, 3, 20_000).filter(run => run.hit).length / 20_000;
  assert.ok(Math.abs(hits - 0.3) < 0.02, `hit rate ${hits}`);
});

test('spread and total legs come from the book lines with the cut removed', () => {
  const { spreads, totals } = lineLegs('BUF', 'NE', {
    spread: { point: -7, price: -120 }, awaySpread: { point: 7, price: 100 },
    total: { point: 48.5, price: -110 }, under: { point: 48.5, price: -110 },
  }, null);
  assert.deepEqual(spreads.map(item => item.label), ['BUF -7', 'NE +7']);
  assert.deepEqual(totals.map(item => item.label), ['Over 48.5', 'Under 48.5']);
  assert.ok(Math.abs(spreads[0].probability - 0.5217) < 0.001, `${spreads[0].probability}`);
  assert.ok(Math.abs(spreads[0].probability + spreads[1].probability - 1) < 1e-9);
  assert.equal(totals[0].probability, 0.5);
  assert.deepEqual([spreads[1].bookPrice, totals[1].bookPrice], [100, -110]);
  assert.equal(new Set([...spreads, ...totals].map(item => item.gameKey)).size, 1);
});

test('a missing or mismatched other side falls back to a typical hold and is left unpriced', () => {
  const { spreads, totals } = lineLegs('BUF', 'NE', {
    spread: { point: -7, price: -110 }, awaySpread: { point: 6.5, price: -110 }, total: { point: 48.5, price: -110 }, under: null,
  }, null);
  assert.ok(Math.abs(spreads[0].probability - 0.5) < 0.001);
  assert.deepEqual([spreads[1].bookPrice, totals[1].bookPrice], [null, null]);
  assert.deepEqual(lineLegs('BUF', 'NE', { spread: { point: null, price: -110 }, total: null }, null), { spreads: [], totals: [] });
});
