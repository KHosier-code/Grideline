import { test } from 'node:test';
import assert from 'node:assert/strict';
import { eligibleMarkets, marketBlocker, officialResult, readSlate } from './consumer-board.ts';
import type { ConsumerGame } from '@workspace/api-client-react';

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

test('market labels retain independent gates and meaningful blockers', () => {
  const now = Date.parse('2026-09-25T12:00:00Z');
  const comparisons = (['spread', 'total', 'moneyline'] as const).map((market) => ({
    market, state: market === 'spread' ? 'available' : market === 'total' ? 'stale' : 'absent',
    modelValue: 3,
  }));
  const game = {
    kickoffTime: '2026-09-26T12:00:00Z', gameState: 'pregame',
    marketBoard: { comparisons },
    recommendation: { status: 'partial', reason: 'One or more markets lack fresh complete pairs', markets: { spread: true, total: false, moneyline: false } },
  } as ConsumerGame;
  assert.deepEqual(eligibleMarkets(game, now).map((item) => item.market), ['spread']);
  assert.equal(marketBlocker(game, comparisons[1] as ConsumerGame['marketBoard']['comparisons'][number], now), 'Market observation stale');
  assert.equal(marketBlocker(game, comparisons[2] as ConsumerGame['marketBoard']['comparisons'][number], now), 'No market observation');
  assert.deepEqual(eligibleMarkets({ ...game, recommendation: { ...game.recommendation, markets: { spread: false, total: false, moneyline: false } } } as ConsumerGame, now), []);
  assert.equal(marketBlocker({ ...game, recommendation: { ...game.recommendation, status: 'stale' } } as ConsumerGame, comparisons[0] as ConsumerGame['marketBoard']['comparisons'][number], now), 'Schedule or odds feed stale');
  assert.deepEqual(eligibleMarkets({ ...game, gameState: 'live' } as ConsumerGame, now), []);
});