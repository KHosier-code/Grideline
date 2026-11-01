import test from 'node:test';
import assert from 'node:assert/strict';
import { nextStart, nflRecordText, topCbbPicks } from './home-sports.ts';
import type { CbbGame } from './cbb.ts';

const game = (id: string, tip: string, edge: number | null): CbbGame => ({
  id, tip, neutral: false, home: { id: 'H', rank: 1, apRank: null }, away: { id: 'A', rank: 2, apRank: null },
  model: { homeMargin: 5, total: 140, homeWinProb: 0.66, homePoints: 72, awayPoints: 67, possessions: 68 },
  line: null, pick: edge === null ? null : { side: 'home', team: 'H', line: -3, edge },
});

test('next start shows only on game days, in Eastern time', () => {
  const noon = Date.parse('2026-11-01T12:00:00-05:00');
  const times = ['2026-11-01T13:00:00-05:00', '2026-11-01T16:25:00-05:00', '2026-11-02T20:15:00-05:00'];
  assert.equal(nextStart(times, noon, 'kickoff'), 'First kickoff 1:00 PM ET');
  assert.equal(nextStart(times, Date.parse('2026-11-01T14:00:00-05:00'), 'kickoff'), 'Next kickoff 4:25 PM ET');
  assert.equal(nextStart(times, Date.parse('2026-11-01T21:00:00-05:00'), 'kickoff'), null);
  assert.equal(nextStart(['2026-11-03T18:30:00-05:00'], noon, 'tip'), null);
  // A 9 PM ET tip is still "today" though it's the next day in UTC.
  assert.equal(nextStart(['2026-11-01T21:00:00-05:00'], noon, 'tip'), 'First tip 9:00 PM ET');
});

test('home shows only the top three college picks by gap, upcoming only', () => {
  const now = Date.parse('2026-11-10T12:00:00Z');
  const games = [
    game('a', '2026-11-10T23:00:00Z', 2.5), game('b', '2026-11-10T23:00:00Z', 6),
    game('c', '2026-11-10T23:00:00Z', null), game('d', '2026-11-10T10:00:00Z', 9),
    game('e', '2026-11-11T00:00:00Z', 4), game('f', '2026-11-11T01:00:00Z', 3),
  ];
  assert.deepEqual(topCbbPicks(games, now).map(item => item.id), ['b', 'e', 'f']);
});

test('NFL early-line record reads as W-L with units at -110', () => {
  assert.equal(nflRecordText({ wins: 9, losses: 6, pushes: 0 }), '9-6, +2.4 units');
  assert.equal(nflRecordText({ wins: 2, losses: 4, pushes: 1 }), '2-4-1, −2.4 units');
  assert.equal(nflRecordText({ wins: 0, losses: 0, pushes: 0 }), 'no picks graded yet');
  assert.equal(nflRecordText(undefined), 'no picks graded yet');
});
