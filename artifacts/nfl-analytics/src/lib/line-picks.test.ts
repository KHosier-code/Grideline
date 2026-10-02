import assert from 'node:assert/strict';
import test from 'node:test';
import type { GameView } from './pick-sheet.ts';
import { linePickLabel, linePickRecord, rankLinePicks, spreadPick, spreadResult, totalPick, totalResult } from './line-picks.ts';

const view = (gameId: string, margin: number, total: number, homeLine: number | null, vegasTotal: number | null, final?: { home: number; away: number }) => ({
  game: { gameId, matchup: { home: { abbreviation: 'KC' }, away: { abbreviation: 'BUF' } }, finalScore: final ?? null },
  projection: { home: 0, away: 0, margin, total, homeWin: 0.5, homeQb: null, awayQb: null },
  vegas: { homeLine, total: vegasTotal, favorite: null },
}) as unknown as GameView;

test('spread pick takes the side our margin likes against the book', () => {
  // KC -3 at the book, we have KC by 6: KC -3 by 3 points.
  const pick = spreadPick(view('a', 6, 48, -3, 47.5))!;
  assert.equal(pick.side, 'home');
  assert.equal(pick.line, -3);
  assert.equal(pick.edge, 3);
  assert.equal(linePickLabel(pick), 'KC -3');
  // KC -7 at the book, we have KC by 2: BUF +7.
  const dog = spreadPick(view('b', 2, 48, -7, 47.5))!;
  assert.equal(dog.side, 'away');
  assert.equal(linePickLabel(dog), 'BUF +7');
  assert.equal(dog.edge, 5);
});

test('no pick without a line, a projection or a gap', () => {
  assert.equal(spreadPick(view('a', 3, 48, null, 47)), null);
  assert.equal(spreadPick(view('a', 3, 48, -3, 47)), null);
  assert.equal(totalPick(view('a', 3, 47, -3, null)), null);
});

test('grading covers, pushes and totals', () => {
  assert.equal(spreadResult(7, -3, 'home'), 'win');
  assert.equal(spreadResult(3, -3, 'home'), 'push');
  assert.equal(spreadResult(2, -3, 'away'), 'win');
  assert.equal(totalResult(50, 47.5, 'over'), 'win');
  assert.equal(totalResult(44, 44, 'under'), 'push');
  const graded = totalPick(view('a', 3, 44, -3, 47.5, { home: 24, away: 17 }))!;
  assert.equal(graded.side, 'under');
  assert.equal(graded.result, 'win');
  assert.equal(linePickLabel(graded), 'Under 47.5');
});

test('ranking gives the biggest gap the most points; record counts results', () => {
  const picks = [spreadPick(view('a', 4, 48, -3, 47))!, spreadPick(view('b', 9, 48, -3, 47, { home: 30, away: 20 }))!];
  const ranked = rankLinePicks(picks);
  assert.deepEqual(ranked.map(item => [item.pick.view.game.gameId, item.points]), [['b', 2], ['a', 1]]);
  assert.deepEqual(linePickRecord(picks), { wins: 1, losses: 0, pushes: 0 });
});
