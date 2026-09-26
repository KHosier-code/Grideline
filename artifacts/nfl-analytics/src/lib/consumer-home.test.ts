import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { ConsumerGame } from '@workspace/api-client-react';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { homeProjection, homeSpread, nextHomeSlate } from './consumer-home.ts';
import { ConsumerProjectionEvidence } from '../components/ConsumerProjectionEvidence.tsx';
import synthetic from '../../../../test-fixtures/synthetic-week3-consumer.json' with { type: 'json' };

const now = Date.parse('2026-09-25T12:00:00Z');
const game = {
  gameId: 'one', season: 2026, week: 3, kickoffTime: '2026-09-27T17:00:00Z', gameState: 'pregame',
  matchup: { home: { name: 'Home', abbreviation: 'HOM' }, away: { name: 'Away', abbreviation: 'AWY' } },
  prediction: { projectedMargin: 2, officialFinalPrediction: false, predictionTimestamp: '2026-09-25T11:00:00Z' },
  availability: { prediction: null },
  recommendation: { status: 'healthy', reason: null, markets: { spread: true, total: false, moneyline: false } },
  marketBoard: { comparisons: [{ market: 'spread', state: 'available', modelValue: 2, marketValue: -3, difference: -1,
    differenceUnit: 'points', selectedQuote: { point: -3, price: -110, sportsbook: 'DraftKings', selection: 'HOM', capturedAt: '2026-09-25T11:00:00Z' } }] },
} as ConsumerGame;

test('next slate contains only the first future season and week, without inventing a current week', () => {
  const next = { ...game, gameId: 'two', week: 4, kickoffTime: '2026-10-02T12:00:00Z' };
  assert.deepEqual(nextHomeSlate([next, game], now)?.games.map(item => item.gameId), ['one']);
  assert.equal(nextHomeSlate([{ ...game, kickoffTime: '2026-09-24T12:00:00Z' }], now), null);
  assert.equal(nextHomeSlate([], now), null);
});

test('snapshot provenance stays distinct from absence and official freeze', () => {
  assert.match(homeProjection(game).label, /not an official/);
  assert.match(homeProjection({ ...game, prediction: { ...game.prediction!, officialFinalPrediction: true } }).label, /Verified official.*frozen/);
  assert.match(homeProjection({ ...game, prediction: null, availability: { prediction: 'Old model versions', market: null } }).detail, /Old model versions/);
});

test('spread needs fresh eligible consistent evidence, not merely a visible quote', () => {
  assert.equal(homeSpread(game, now).comparison?.difference, -1);
  const blocked = (state: 'stale' | 'absent') => ({ ...game, marketBoard: { comparisons: [{ ...game.marketBoard.comparisons[0], state, selectedQuote: state === 'absent' ? null : game.marketBoard.comparisons[0].selectedQuote }] } } as ConsumerGame);
  assert.match(homeSpread(blocked('stale'), now).reason, /stale/i);
  assert.match(homeSpread(blocked('absent'), now).reason, /No saved odds/);
  assert.match(homeSpread({ ...blocked('absent'), recommendation: { ...game.recommendation, status: 'stale' } } as ConsumerGame, now).reason, /No saved odds.*feeds stale/);
  assert.match(homeSpread({ ...game, recommendation: { ...game.recommendation, status: 'stale' } } as ConsumerGame, now).reason, /feed stale/i);
  assert.equal(homeSpread({ ...game, recommendation: { ...game.recommendation, status: 'partial', markets: { ...game.recommendation.markets, spread: false } } } as ConsumerGame, now).comparison, null);
  assert.equal(homeSpread({ ...game, prediction: null } as ConsumerGame, now).comparison, null);
  assert.equal(homeSpread({ ...game, marketBoard: { comparisons: [{ ...game.marketBoard.comparisons[0], difference: 100 }] } } as ConsumerGame, now).comparison, null);
});

test('SYNTHETIC Week 3 API fixture renders a saved outlook in Home and Game Detail, not a real pick', () => {
  // The quote/score is an in-memory presentation fixture, never a provider observation.
  assert.equal(synthetic.synthetic, true);
  const saved = { ...game, gameId: synthetic.gameId, kickoffTime: synthetic.kickoff,
    matchup: { home: synthetic.home, away: synthetic.away }, prediction: {
    ...game.prediction!, predictionTimestamp: synthetic.savedAt,
    projectedAwayScore: synthetic.projectedAwayScore, projectedHomeScore: synthetic.projectedHomeScore,
    projectedMargin: synthetic.projectedMargin, projectedTotal: synthetic.projectedTotal, awayWinProbability: 0.4, homeWinProbability: 0.6,
  }, dataConfidence: { label: 'Limited', score: 0.5, reason: 'Fixture evidence only' },
    marketBoard: { comparisons: [{ ...game.marketBoard.comparisons[0], modelValue: synthetic.projectedMargin,
      marketValue: synthetic.homeSpreadPoint, difference: synthetic.projectedMargin + synthetic.homeSpreadPoint,
      selectedQuote: { point: synthetic.homeSpreadPoint, price: synthetic.spreadPrice,
        sportsbook: synthetic.books[0], selection: synthetic.home.abbreviation, capturedAt: synthetic.quoteAt } }] },
    finalScore: null,
  } as ConsumerGame;
  assert.match(homeProjection(saved).label, /Saved model outlook · not an official/);
  assert.equal(homeSpread(saved, Date.parse(synthetic.now)).comparison?.difference, 1);
  const detail = renderToStaticMarkup(createElement(ConsumerProjectionEvidence, { game: saved as any }));
  assert.match(detail, /Saved model projection, not a verified official pregame prediction/);
  assert.match(detail, /20.0 – 24.0/);
});