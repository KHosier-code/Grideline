import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { ConsumerGame, ConsumerGameProjection } from '@workspace/api-client-react';
import { buildGameView, consistentHomeWin, currentWeek, lineGap, lineText, vegasLineText, type GameView } from './pick-sheet.ts';

const quote = (point: number | null, price: number) => ({ sportsbook: 'DraftKings', selection: 'X', point, price, capturedAt: '2026-09-29T18:00:00Z' });
function game(overrides: { gameId?: string; week?: number; kickoffTime?: string; finalScore?: { home: number; away: number } | null; homeLine?: number } = {}): ConsumerGame {
  return {
    gameId: overrides.gameId ?? 'g1', season: 2026, week: overrides.week ?? 4, kickoffTime: overrides.kickoffTime ?? '2026-10-02T00:15:00Z',
    gameStatus: 'STATUS_SCHEDULED', gameState: 'pregame', venue: null,
    matchup: { home: { name: 'Buffalo Bills', abbreviation: 'BUF', logoUrl: null }, away: { name: 'New England Patriots', abbreviation: 'NE', logoUrl: null } },
    finalScore: overrides.finalScore ?? null,
    market: { spread: quote(overrides.homeLine ?? -7, -110), moneyline: quote(null, -300), awayMoneyline: quote(null, 240), total: quote(48.5, -110),
      evidence: { available: true, capturedAt: null, message: null } },
  } as unknown as ConsumerGame;
}
const qb = (name: string) => ({ name, value: 0.05, listed: true, newStarter: false });
const projection: ConsumerGameProjection = {
  gameId: 'g1', nflverseGameId: '2026_04_NE_BUF', homeTeam: 'BUF', awayTeam: 'NE', kickoff: '2026-10-04T17:00:00Z',
  projectedMargin: 7.8, projectedTotal: 48.8, homeWinProbability: 0.76, homeQb: qb('Josh Allen'), awayQb: qb('Drake Maye'),
  factors: { qbEdge: 0.06, teamEdge: 0.1, passEdge: 0.1, rushEdge: 0.02, restDiff: 0, neutralSite: false }, projectedAt: '2026-09-30T00:00:00Z',
};

test('QB model projection splits into scores', () => {
  const view = buildGameView(game(), projection);
  assert.equal(view.projection?.home.toFixed(1), '28.3');
  assert.equal(view.projection?.away.toFixed(1), '20.5');
  assert.equal(view.projection?.homeQb?.name, 'Josh Allen');
  assert.deepEqual(view.winner, { side: 'home', probability: 0.76 });
  assert.equal(view.vegas.favorite, 'home');
});

test('a game without a QB model row is projection pending', () => {
  const view = buildGameView(game());
  assert.equal(view.projection, null);
  assert.equal(view.winner, null);
  assert.equal(view.result, null);
  assert.deepEqual(view.market, { homeMargin: 7, total: 48.5, source: 'sportsbook' });
});

test('grades the projected winner once final', () => {
  assert.equal(buildGameView(game({ finalScore: { home: 20, away: 24 } }), projection).result, 'loss');
  assert.equal(buildGameView(game({ finalScore: { home: 31, away: 10 } }), projection).result, 'win');
  assert.equal(buildGameView(game({ finalScore: { home: 17, away: 17 } }), projection).result, 'push');
});

test('line text rounds to the half point and names the favorite', () => {
  assert.equal(lineText(7.8, 'BUF', 'NE'), 'BUF -8');
  assert.equal(lineText(-3.3, 'BUF', 'NE'), 'NE -3.5');
  assert.equal(lineText(0.1, 'BUF', 'NE'), 'Pick’em');
  assert.equal(vegasLineText(-7, 'BUF', 'NE'), 'BUF -7');
  assert.equal(vegasLineText(2.5, 'CLE', 'PIT'), 'PIT -2.5');
});

test('current week keeps finished games from the same week', () => {
  const now = Date.parse('2026-10-03T12:00:00Z');
  const games = [
    game({ gameId: 'thu', kickoffTime: '2026-10-02T00:15:00Z', finalScore: { home: 20, away: 17 } }),
    game({ gameId: 'sun', kickoffTime: '2026-10-04T17:00:00Z' }),
    game({ gameId: 'next', week: 5, kickoffTime: '2026-10-11T17:00:00Z' }),
  ];
  assert.deepEqual(currentWeek(games, now)?.games.map(item => item.gameId), ['thu', 'sun']);
});

test('the market line prefers a sportsbook capture and falls back to the consensus line', () => {
  assert.deepEqual(buildGameView(game({ homeLine: -7 }), projection).market, { homeMargin: 7, total: 48.5, source: 'sportsbook' });
  const noBook = { ...game(), market: null } as unknown as ConsumerGame;
  assert.deepEqual(buildGameView(noBook, { ...projection, marketMargin: 6.5, marketTotal: 47.5 }).market,
    { homeMargin: 6.5, total: 47.5, source: 'consensus' });
  assert.equal(buildGameView(noBook, projection).market, null);
});

test('lineGap measures the Gridline vs book gap and movement toward Gridline', () => {
  const view = (margin: number, homeLine: number) => ({
    projection: { margin }, vegas: { homeLine },
  }) as unknown as GameView;
  // Gridline home by 6, book home -3: Gridline likes home by 3 more. Opened -2, so moved 1 toward home.
  assert.deepEqual(lineGap(view(6, -3), -2), { points: 3, side: 'home', moved: 1 });
  // Gridline away by 1, book home -3: likes away by 4. Line went -3 from -4: 1 toward away.
  assert.deepEqual(lineGap(view(-1, -3), -4), { points: 4, side: 'away', moved: 1 });
  assert.equal(lineGap(view(3, -3), null)?.side, null);
  assert.equal(lineGap(view(3, -3.5), null)?.moved, null);
});

test('a near-even game never shows its projected winner under 50%', () => {
  assert.equal(consistentHomeWin(-0.1, 0.52), 0.5);
  assert.equal(consistentHomeWin(0, 0.6), 0.5);
  assert.equal(consistentHomeWin(3, 0.6), 0.6);
  assert.equal(consistentHomeWin(-3, 0.4), 0.4);
});
