import assert from 'node:assert/strict';
import test from 'node:test';
import type { ConsumerGame } from '@workspace/api-client-react';
import { defenseLine, matchupTone, nextGames, playerMatchup } from './dvp-matchups.ts';
import type { DefenseLine, UsageReport } from './usage-report.ts';

const line = (pprRank: number): DefenseLine => ({
  games: 3, pprPerGame: 40 - pprRank, pprRank, vsAverage: (16 - pprRank) / 50,
  yardsPerGame: 200, yardsRank: pprRank, tdsPerGame: 1, tdsRank: pprRank,
  receptionsPerGame: 12, receptionsRank: pprRank, targetsPerGame: 18, targetsRank: pprRank,
  redZoneOppsPerGame: 3, redZoneOppsRank: pprRank,
});

const report = {
  defenses: [
    { team: 'LA', season: { WR: line(2), RB: line(30), QB: line(16), TE: line(9) }, last4: {} },
    { team: 'KC', season: { WR: line(27), RB: line(5) }, last4: {} },
  ],
} as unknown as UsageReport;

const game = (gameId: string, home: string, away: string, kickoff: string, final = false) => ({
  gameId, week: 4, kickoffTime: kickoff,
  matchup: { home: { abbreviation: home }, away: { abbreviation: away } },
  finalScore: final ? { home: 20, away: 17 } : null,
}) as unknown as ConsumerGame;

test('top quarter is favorable, bottom quarter tough', () => {
  assert.equal(matchupTone(1), 'favorable');
  assert.equal(matchupTone(8), 'favorable');
  assert.equal(matchupTone(9), 'neutral');
  assert.equal(matchupTone(24), 'neutral');
  assert.equal(matchupTone(25), 'tough');
  assert.equal(matchupTone(32), 'tough');
  assert.equal(matchupTone(null), null);
});

test('ESPN codes find nflverse defenses', () => {
  assert.equal(defenseLine(report, 'LAR', 'WR')?.pprRank, 2);
  assert.equal(defenseLine(report, 'KC', 'QB'), null);
});

test('next game skips finished and started games', () => {
  const now = Date.parse('2026-10-02T12:00:00Z');
  const next = nextGames([
    game('old', 'KC', 'BUF', '2026-09-28T17:00:00Z', true),
    game('later', 'BUF', 'KC', '2026-10-12T17:00:00Z'),
    game('soon', 'LAR', 'BUF', '2026-10-05T20:00:00Z'),
  ], now);
  assert.equal(next.get('BUF')?.gameId, 'soon');
  assert.equal(next.get('BUF')?.opponent, 'LAR');
  assert.equal(next.get('BUF')?.home, false);
  assert.equal(next.get('LA')?.home, true);
  assert.equal(next.get('KC')?.gameId, 'later');
});

test('player matchup uses the opponent defense for their position', () => {
  const next = nextGames([game('g', 'LAR', 'BUF', '2026-10-05T20:00:00Z')], 0);
  assert.equal(playerMatchup(report, next, 'BUF', 'WR')?.tone, 'favorable');
  assert.equal(playerMatchup(report, next, 'BUF', 'RB')?.tone, 'tough');
  assert.equal(playerMatchup(report, next, 'NYJ', 'WR'), null);
});
