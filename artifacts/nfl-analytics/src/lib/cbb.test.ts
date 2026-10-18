import test from 'node:test';
import assert from 'node:assert/strict';
import { favorite, formatRecord, formatSpread, gamesByDay, modelHomeSpread, seasonLabel, winRate, type CbbGame } from './cbb.ts';

const game = (id: string, tip: string, homeMargin = 5): CbbGame => ({
  id, tip, neutral: false, home: { id: 'H', rank: 10, apRank: null }, away: { id: 'A', rank: 50, apRank: null },
  model: { homeMargin, total: 140, homeWinProb: 0.66, homePoints: 72.5, awayPoints: 67.5, possessions: 68 },
  line: null, pick: null,
});

test('spreads, records and season labels', () => {
  assert.deepEqual([-4.5, 3, 0, 0.2, -7.24, null].map(formatSpread), ['−4.5', '+3', 'PK', 'PK', '−7', '—']);
  assert.equal(seasonLabel(2027), '2026-27');
  assert.equal(formatRecord({ wins: 12, losses: 9, pushes: 1, units: 0 }), '12-9-1');
  assert.equal(formatRecord({ wins: 3, losses: 2, pushes: 0, units: 0 }), '3-2');
  assert.equal(winRate({ wins: 0, losses: 0, pushes: 2, units: 0 }), null);
  assert.equal(winRate({ wins: 3, losses: 1, pushes: 0, units: 0 }), 0.75);
});

test('our line and the favorite read from the home side', () => {
  const g = game('1', '2026-11-10T00:00:00Z', 6.2);
  assert.equal(modelHomeSpread(g), -6.2);
  assert.deepEqual(favorite(-6.2, g), { team: 'H', points: 6.2 });
  assert.deepEqual(favorite(3.5, g), { team: 'A', points: 3.5 });
  assert.equal(favorite(null, g), null);
});

test('games group by Eastern-time day, late tips stay on their night', () => {
  const now = new Date('2026-11-10T15:00:00Z'); // 10 AM ET Tuesday
  const days = gamesByDay([
    game('late', '2026-11-11T03:30:00Z'), // 10:30 PM ET Tuesday
    game('early', '2026-11-10T17:00:00Z'),
    game('next', '2026-11-11T23:00:00Z'),
  ], now);
  assert.deepEqual(days.map(day => [day.label, day.games.map(g => g.id)]), [['Today', ['early', 'late']], ['Tomorrow', ['next']]]);
});
