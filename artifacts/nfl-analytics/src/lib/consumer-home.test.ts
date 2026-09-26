import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { ConsumerGame } from '@workspace/api-client-react';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { Router } from 'wouter';
import { homeProjection, homeSpread, nextHomeSlate, weeklyHomePick } from './consumer-home.ts';
import { ConsumerProjectionEvidence } from '../components/ConsumerProjectionEvidence.tsx';
import { VisitorHomeContent } from '../pages/consumer/VisitorHomeContent.tsx';
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

const official = { ...game, prediction: { ...game.prediction!,
  officialFinalPrediction: true, homeWinProbability: 0.7, awayWinProbability: 0.3 } } as ConsumerGame;

test('weekly pick selects strongest official winner only from next upcoming slate', () => {
  const strongest = { ...official, gameId: 'strong', kickoffTime: '2026-09-27T19:00:00Z',
    prediction: { ...official.prediction!, homeWinProbability: 0.1, awayWinProbability: 0.9 } } as ConsumerGame;
  const nextWeek = { ...official, gameId: 'next', week: 4, kickoffTime: '2026-10-02T12:00:00Z',
    prediction: { ...official.prediction!, homeWinProbability: 0.99, awayWinProbability: 0.01 } } as ConsumerGame;
  assert.deepEqual(weeklyHomePick([nextWeek, official, strongest], now), { teamName: 'Away' });
  assert.deepEqual(weeklyHomePick([official, strongest, nextWeek].reverse(), now), { teamName: 'Away' });
  assert.equal(weeklyHomePick([nextWeek, { ...official, prediction: null }], now), null);
  assert.equal(weeklyHomePick([official], Date.parse(official.kickoffTime!)), null);
  assert.equal(weeklyHomePick([], now), null);
});

test('weekly pick rejects outlooks, completed games, invalid timestamps and malformed probabilities', () => {
  const invalid = [
    { ...official, prediction: { ...official.prediction!, officialFinalPrediction: false } },
    { ...official, finalScore: { home: 0, away: 0 } },
    { ...official, gameState: 'final' },
    { ...official, prediction: { ...official.prediction!, predictionTimestamp: official.kickoffTime } },
    { ...official, prediction: { ...official.prediction!, predictionTimestamp: 'not a date' } },
    { ...official, prediction: { ...official.prediction!, predictionTimestamp: new Date(now + 1).toISOString() } },
    ...[[0.5, 0.5], [NaN, 0.4], [Infinity, 0], [-0.1, 1.1], [0.7, 0.7], [null, 0.5]]
      .map(([home, away]) => ({ ...official, prediction: { ...official.prediction!,
        homeWinProbability: home, awayWinProbability: away } })),
  ] as ConsumerGame[];
  for (const candidate of invalid) assert.equal(weeklyHomePick([candidate], now), null);
  assert.deepEqual(weeklyHomePick([invalid[0], official], now), { teamName: 'Home' });
});

test('equal winner strengths break ties by kickoff then game ID, independent of input order', () => {
  const early = { ...official, gameId: 'z', kickoffTime: '2026-09-27T16:00:00Z',
    matchup: { ...official.matchup, home: { ...official.matchup.home, name: 'Early' } } };
  const firstId = { ...early, gameId: 'a',
    matchup: { ...early.matchup, home: { ...early.matchup.home, name: 'First ID' } } };
  for (const input of [[official, early, firstId], [firstId, official, early]])
    assert.deepEqual(weeklyHomePick(input, now), { teamName: 'First ID' });
});

test('visitor Home renders only its pick or concise states, never signed-in Home evidence', () => {
  const staticLocation = () => ['/', () => {}] as [string, (path: string) => void];
  const renderVisitor = (props: Parameters<typeof VisitorHomeContent>[0]) =>
    renderToStaticMarkup(createElement(Router, { hook: staticLocation },
      createElement(VisitorHomeContent, props)));
  for (const [state, expected] of [['ready', 'Home'], ['loading', 'Loading this week'], ['error', 'Pick unavailable right now']] as const) {
    const html = renderVisitor({ games: [official], now, state });
    assert.match(html, new RegExp(expected));
    assert.match(html, /Pick of the week/);
    assert.doesNotMatch(html, /weekly-list|weekly-intro|weekly-status|ch-feature|Saved projection|Upcoming schedule|Persisted feed status|Home spread evidence|weekly-evidence|consumer-source-health/);
    if (state !== 'ready') assert.doesNotMatch(html, /weekly-pick-team/);
  }
  const missing = renderVisitor({ games: [game], now, state: 'ready' });
  assert.match(missing, /A pick is unavailable/);
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

test('Game Detail renders a recovered historical official projection without changing its saved status', () => {
  const historical = { ...game, kickoffTime: '2026-09-01T17:00:00Z', gameState: 'final',
    prediction: { ...game.prediction!, officialFinalPrediction: true,
      projectedHomeScore: 24, projectedAwayScore: 20, projectedMargin: 4, projectedTotal: 44,
      homeWinProbability: 0.6, awayWinProbability: 0.4 },
    dataConfidence: { label: 'Standard', score: 0.8, reason: null },
    finalScore: { home: 21, away: 17 },
  } as unknown as Parameters<typeof ConsumerProjectionEvidence>[0]['game'];
  const detail = renderToStaticMarkup(createElement(ConsumerProjectionEvidence, { game: historical }));
  assert.match(detail, /Verified official pregame prediction, frozen before kickoff/);
  assert.match(detail, /20.0 – 24.0/);
  assert.match(detail, /Verified final score/);
  const missing = renderToStaticMarkup(createElement(ConsumerProjectionEvidence, {
    game: { ...historical, prediction: null, availability: { prediction: 'No verified snapshot', market: null } },
  }));
  assert.match(missing, /No eligible saved projection/);
  assert.doesNotMatch(missing, /Verified official pregame prediction/);
});