import assert from 'node:assert/strict';
import test from 'node:test';
import { contrarianOptions, expectedPoints, ratingWinChance, survivorOptions, type PoolPick } from './pool-strategy.ts';

const pick = (gameId: string, chance: number, points: number, modelDisagrees = false, locked = false): PoolPick =>
  ({ gameId, team: `F${gameId}`, opponent: `D${gameId}`, chance, points, modelDisagrees, locked });

test('expected points weight each pick by its chance', () => {
  assert.equal(expectedPoints([pick('a', 0.8, 2), pick('b', 0.5, 1)]), 2.1);
});

test('contrarian options put model upset leans first, then the cheapest flips', () => {
  const options = contrarianOptions([
    pick('a', 0.9, 16), pick('b', 0.55, 3), pick('c', 0.52, 1), pick('d', 0.6, 5, true), pick('e', 0.51, 2, false, true),
  ]);
  assert.deepEqual(options.map(option => option.gameId), ['d', 'c', 'b']);
  assert.equal(options[1].cost.toFixed(2), '0.04');
  assert.equal(options[0].upset, 'Dd');
});

test('rating win chance favors the better team and the home side', () => {
  const ratings = new Map([['GB', 5], ['CHI', -2]]);
  const home = ratingWinChance(ratings, { week: 6, home: 'GB', away: 'CHI' }, 'GB')!;
  const away = ratingWinChance(ratings, { week: 6, home: 'CHI', away: 'GB' }, 'GB')!;
  assert.ok(home > away && away > 0.5);
  assert.equal(ratingWinChance(ratings, { week: 6, home: 'GB', away: 'NYJ' }, 'GB'), null);
});

test('survivor options skip used teams and locked games and flag better later weeks', () => {
  const ratings = new Map([['BUF', 7], ['MIA', -1], ['NE', -6], ['KC', 4], ['LV', -5]]);
  const options = survivorOptions(
    [{ home: 'BUF', away: 'MIA', homeWin: 0.7, locked: false }, { home: 'KC', away: 'LV', homeWin: 0.8, locked: true }],
    [{ week: 6, home: 'BUF', away: 'NE' }],
    ratings,
    new Set(['MIA']),
  );
  assert.deepEqual(options.map(option => option.team), ['BUF']);
  assert.equal(options[0].bestLater?.week, 6);
  assert.equal(options[0].bestLater?.opponent, 'NE');
});
