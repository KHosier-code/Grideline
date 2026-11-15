import test from 'node:test';
import assert from 'node:assert/strict';
import { crowdMistakes, poolSizeLabel, poolsLocked, sheetRows, sheetScore, sheetText, winPct, type BowlsReport, type BowlTeam } from './bowls';

const team = (name: string, crowdConfidence: number, crowdStraight = crowdConfidence): BowlTeam => ({
  id: name, abbr: name.slice(0, 3).toUpperCase(), name, logo: null, color: null, rank: null, record: null,
  home: false, moneyline: null, crowdConfidence, crowdStraight,
});

const report: BowlsReport = {
  season: 2026, generatedAt: '2026-12-07T12:00:00Z', firstKickoff: '2026-12-12T16:00:00Z',
  poolSizes: [10, 25, 50, 100, 250], poolTypes: ['casual', 'mixed', 'sharp'], scorings: ['confidence', 'straight'],
  crowd: { confidence: { available: true, entries: 100000 }, straight: { available: true, entries: 500000 } },
  games: [
    { id: 'a', bowl: 'Early Bowl', kickoff: '2026-12-12T16:00:00Z', status: 'complete', winA: 0.7, lineSource: 'ESPN', winner: 0,
      teams: [team('Ohio', 0.4), team('Miami', 0.6)] },
    { id: 'b', bowl: 'Late Bowl', kickoff: '2026-12-30T20:00:00Z', status: 'open', winA: 0.45, lineSource: 'ESPN', winner: null,
      teams: [team('Utah', 0.5), team('Iowa', 0.5)] },
  ],
  sheets: {
    'confidence-25-mixed': { picks: [0, 0], points: [2, 1], win: 0.31, chalkWin: 0.3, fair: 1 / 26, tuned: true },
    'straight-25-mixed': { picks: [0, 1], points: [1, 1], win: 0.2, chalkWin: 0.19, fair: 1 / 26, tuned: true },
  },
};

test('confidence sheets list the most points first, with upsets and crowd misses marked', () => {
  const rows = sheetRows(report, 'confidence', 25, 'mixed');
  assert.deepEqual(rows.map(row => [row.game.bowl, row.pick.name, row.points]), [['Early Bowl', 'Ohio', 2], ['Late Bowl', 'Utah', 1]]);
  assert.equal(rows[0].crowdMisses, true);   // Ohio is a 70% favorite, but only 40% picked them
  assert.equal(rows[0].result, 'win');
  assert.equal(rows[1].upset, true);         // Utah is a 45% underdog
  assert.ok(Math.abs(rows[1].chance - 0.45) < 1e-9);
  assert.deepEqual(sheetScore(rows), { games: 1, wins: 1, points: 2, possible: 2 });
  assert.match(sheetText(rows, 'confidence'), /Early Bowl: Ohio \(2\)\nLate Bowl: Utah \(1\)$/);
});

test('one-point sheets are in date order, and a missing sheet is empty', () => {
  assert.deepEqual(sheetRows(report, 'straight', 25, 'mixed').map(row => row.pick.name), ['Ohio', 'Iowa']);
  assert.deepEqual(sheetRows(report, 'straight', 250, 'sharp'), []);
  assert.doesNotMatch(sheetText(sheetRows(report, 'straight', 25, 'mixed'), 'straight'), /\(1\)/);
});

test('games the crowd gets wrong are those where most players back the underdog', () => {
  const mistakes = crowdMistakes(report, 'confidence');
  assert.deepEqual(mistakes.map(m => [m.favorite.name, Math.round(m.gap * 100)]), [['Ohio', 30]]);
});

test('labels and lock time', () => {
  assert.equal(poolSizeLabel(25, report.poolSizes), 'about 25 people');
  assert.equal(poolSizeLabel(250, report.poolSizes), '250+ people');
  assert.equal(winPct(0.312), '31%');
  assert.equal(winPct(0.052), '5.2%');
  assert.equal(winPct(0.0002), 'under 0.1%');
  assert.equal(poolsLocked(report, Date.parse('2026-12-12T15:59:00Z')), false);
  assert.equal(poolsLocked(report, Date.parse('2026-12-12T16:00:00Z')), true);
});
