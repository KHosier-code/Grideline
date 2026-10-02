import { test } from 'node:test';
import assert from 'node:assert/strict';
import { officialResult, readSlate } from './consumer-board.ts';

test('explicit URL requires a complete valid season/week and survives refetch selection', () => {
  assert.deepEqual(readSlate('?season=2026&week=20'), { season: 2026, week: 20 });
  assert.deepEqual(readSlate('?week=1&season=2025'), { season: 2025, week: 1 });
  for (const search of ['', '?week=1', '?season=2026', '?season=2026&week=23', '?season=2026&week=abc']) {
    assert.equal(readSlate(search), null);
  }
});

test('scores are results only with official final state', () => {
  assert.equal(officialResult({ gameState: 'live', finalScore: { home: 0, away: 0 } }), null);
  assert.deepEqual(officialResult({ gameState: 'final', finalScore: { home: 27, away: 20 } }), { home: 27, away: 20 });
});
