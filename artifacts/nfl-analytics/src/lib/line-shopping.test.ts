import assert from 'node:assert/strict';
import test from 'node:test';
import type { ConsumerBookLines } from '@workspace/api-client-react';
import { bestOffer, shopLines } from './line-shopping.ts';

const book = (sportsbook: string, home: number, homePrice: number, total: number, overPrice: number, underPrice = -110): ConsumerBookLines => ({
  sportsbook, capturedAt: '2026-10-01T14:07:00Z',
  homeSpread: { point: home, price: homePrice }, awaySpread: { point: -home, price: -110 },
  homeMoneyline: -150, awayMoneyline: 130,
  over: { point: total, price: overPrice }, under: { point: total, price: underPrice },
});

test('a better number beats a better price on spreads', () => {
  const books = [book('DraftKings', -3, -105, 44.5, -110), book('FanDuel', -2.5, -120, 44.5, -110)];
  const home = bestOffer(books, 'homeSpread')!;
  assert.equal(home.best.sportsbook, 'FanDuel'); // -2.5 is better for the home bettor than -3
  assert.equal(home.differs, true);
  const away = bestOffer(books, 'awaySpread')!;
  assert.equal(away.best.sportsbook, 'DraftKings'); // +3 beats +2.5
});

test('same number: the better price wins; overs want the lower total', () => {
  const books = [book('DraftKings', -3, -115, 44.5, -110, -110), book('FanDuel', -3, -105, 45, -110, -110)];
  assert.equal(bestOffer(books, 'homeSpread')!.best.sportsbook, 'FanDuel');
  assert.equal(bestOffer(books, 'over')!.best.sportsbook, 'DraftKings');
  assert.equal(bestOffer(books, 'under')!.best.sportsbook, 'FanDuel');
});

test('identical books are not flagged as different', () => {
  const books = [book('DraftKings', -3, -110, 44.5, -110), book('FanDuel', -3, -110, 44.5, -110)];
  assert.equal(shopLines(books).differs, false);
  assert.equal(shopLines([]).best.homeSpread, null);
});
