import assert from 'node:assert/strict';
import test from 'node:test';
import { devig, impliedProbability, tdFairProbability } from './market.ts';

test('implied probability includes the vig', () => {
  assert.equal(impliedProbability(-110).toFixed(4), '0.5238');
  assert.equal(impliedProbability(200).toFixed(4), '0.3333');
});

test('devig makes the two sides sum to one', () => {
  const [home, away] = devig(-110, -110);
  assert.equal(home, 0.5);
  assert.equal(away, 0.5);
  const [fav, dog] = devig(-300, 250);
  assert.ok(Math.abs(fav + dog - 1) < 1e-12);
  assert.ok(fav < impliedProbability(-300));
});

test('TD fair probability is below the raw implied chance', () => {
  assert.ok(tdFairProbability(150) < impliedProbability(150));
});
