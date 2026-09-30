import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { ConsumerGame } from '@workspace/api-client-react';
import { TOTAL_PICKS_ENABLED, analyzeGame, biggestEdges, currentWeek, signed } from './pick-sheet.ts';

const quote = (point: number | null, price: number) => ({ sportsbook: 'DraftKings', selection: 'X', point, price, capturedAt: '2026-09-29T18:00:00Z' });
function game(overrides: Partial<ConsumerGame> & { margin?: number; total?: number; homeLine?: number; totalLine?: number; homeMl?: number; awayMl?: number }): ConsumerGame {
  const margin = overrides.margin ?? 1.7;
  const total = overrides.total ?? 44.5;
  return {
    gameId: overrides.gameId ?? 'g1', season: 2026, week: overrides.week ?? 4, kickoffTime: overrides.kickoffTime ?? '2026-10-02T00:15:00Z',
    gameStatus: 'STATUS_SCHEDULED', gameState: 'pregame', venue: null,
    matchup: { home: { name: 'Cleveland Browns', abbreviation: 'CLE', logoUrl: null }, away: { name: 'Pittsburgh Steelers', abbreviation: 'PIT', logoUrl: null } },
    finalScore: overrides.finalScore ?? null,
    prediction: { modelLabel: 'Gridline Production Model', projectedHomeScore: (total + margin) / 2, projectedAwayScore: (total - margin) / 2,
      projectedMargin: margin, projectedTotal: total, homeWinProbability: margin > 0 ? 0.55 : 0.45, awayWinProbability: margin > 0 ? 0.45 : 0.55 },
    market: {
      spread: overrides.homeLine === undefined ? quote(2.5, 100) : quote(overrides.homeLine, -110),
      moneyline: quote(null, overrides.homeMl ?? 124),
      awayMoneyline: overrides.awayMl === undefined ? quote(null, -148) : quote(null, overrides.awayMl),
      total: quote(overrides.totalLine ?? 38.5, -105),
      evidence: { available: true, capturedAt: null, message: null },
    },
  } as unknown as ConsumerGame;
}

test('home underdog projected to win: CLE +2.5 with a 4.2-point edge, Over 38.5 by 6', () => {
  const picks = analyzeGame(game({}));
  assert.equal(picks.winner?.side, 'home');
  assert.equal(picks.spread?.side, 'home');
  assert.equal(picks.spread?.line, 2.5);
  assert.equal(picks.spread?.edge.toFixed(1), '4.2');
  assert.equal(picks.spread?.strength, 'strong');
  if (TOTAL_PICKS_ENABLED) {
    assert.equal(picks.total?.side, 'Over');
    assert.equal(picks.total?.edge.toFixed(1), '6.0');
  } else {
    assert.equal(picks.total, null);
  }
  assert.equal(picks.moneyline?.price, 124);
  // +124 implies 44.6%; we give CLE 55%.
  assert.equal(picks.moneyline?.edge?.toFixed(3), (0.55 - 100 / 224).toFixed(3));
});

test('home favorite by less than the line: take the away team and its points', () => {
  const picks = analyzeGame(game({ margin: 3, homeLine: -6.5, totalLine: 41.5, total: 40 }));
  assert.equal(picks.spread?.side, 'away');
  assert.equal(picks.spread?.line, 6.5);
  assert.equal(picks.spread?.edge, 3.5);
  assert.equal(picks.total?.side, TOTAL_PICKS_ENABLED ? 'Under' : undefined);
  assert.equal(picks.winner?.side, 'home');
});

test('away winner uses the away moneyline', () => {
  const picks = analyzeGame(game({ margin: -4, homeLine: 3, awayMl: -160 }));
  assert.equal(picks.winner?.side, 'away');
  assert.equal(picks.moneyline?.price, -160);
});

test('on the line means no pick; no projection means no picks', () => {
  assert.equal(analyzeGame(game({ margin: 3, homeLine: -3 })).spread, null);
  const blank = { ...game({}), prediction: null } as ConsumerGame;
  const picks = analyzeGame(blank);
  assert.equal(picks.projection, null);
  assert.equal(picks.spread, null);
  assert.equal(picks.winner, null);
});

test('current week keeps finished games from the same week and edges skip them', () => {
  const now = Date.parse('2026-10-03T12:00:00Z');
  const games = [
    game({ gameId: 'thu', kickoffTime: '2026-10-02T00:15:00Z', finalScore: { home: 20, away: 17 } }),
    game({ gameId: 'sun', kickoffTime: '2026-10-04T17:00:00Z', margin: -2, homeLine: -7 }),
    game({ gameId: 'next', week: 5, kickoffTime: '2026-10-11T17:00:00Z' }),
  ];
  const week = currentWeek(games, now);
  assert.deepEqual(week?.games.map(item => item.gameId), ['thu', 'sun']);
  const edges = biggestEdges(week!.games.map(analyzeGame), now);
  assert.ok(edges.every(edge => edge.picks.game.gameId === 'sun'));
  assert.equal(edges[0].kind, 'spread');
  // Home favored by 7 but projected to lose by 2: a 9-point disagreement.
  assert.equal(edges[0].edge, 9);
});

test('signed numbers', () => {
  assert.equal(signed(2.5), '+2.5');
  assert.equal(signed(-3), '-3');
  assert.equal(signed(0), 'PK');
});
