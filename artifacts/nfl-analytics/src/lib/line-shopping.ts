import type { ConsumerBookLines } from '@workspace/api-client-react';

/**
 * Line shopping: the better number for each bet across DraftKings and
 * FanDuel. Half a point near 3 or 7 matters more than any edge our models
 * have shown, so the board shows where each side is cheapest.
 *
 * Spreads are the team's own line (negative = favored). A higher line is
 * better for that team's bettor (+3.5 beats +3, -2.5 beats -3); at the same
 * number the better price wins. Overs want a lower total, unders a higher one.
 */
export type BetKey = 'homeSpread' | 'awaySpread' | 'over' | 'under' | 'homeMoneyline' | 'awayMoneyline';
export type BookOffer = { sportsbook: string; point: number | null; price: number };
export type Best = { key: BetKey; best: BookOffer; others: BookOffer[]; differs: boolean };

const offers = (books: ConsumerBookLines[], key: BetKey): BookOffer[] => books.flatMap((book): BookOffer[] => {
  const value = book[key];
  if (value === null || value === undefined) return [];
  return typeof value === 'number' ? [{ sportsbook: book.sportsbook, point: null, price: value }]
    : [{ sportsbook: book.sportsbook, point: value.point, price: value.price }];
});

/** Payout per 1 staked; higher is better for the bettor. */
const payout = (american: number) => (american > 0 ? american / 100 : 100 / -american);

/** Positive when `a` is the better bet than `b`. */
export function compareOffers(key: BetKey, a: BookOffer, b: BookOffer) {
  if (a.point !== null && b.point !== null && a.point !== b.point) {
    const better = key === 'over' ? b.point - a.point : a.point - b.point;
    return better;
  }
  return payout(a.price) - payout(b.price);
}

export function bestOffer(books: ConsumerBookLines[], key: BetKey): Best | null {
  const list = offers(books, key);
  if (!list.length) return null;
  const sorted = [...list].sort((a, b) => compareOffers(key, b, a));
  const best = sorted[0];
  return { key, best, others: sorted.slice(1), differs: sorted.slice(1).some(other => compareOffers(key, best, other) > 0) };
}

/** The best spread and total offers, and whether the two books disagree on any of them. */
export function shopLines(books: ConsumerBookLines[]) {
  const keys: BetKey[] = ['awaySpread', 'homeSpread', 'over', 'under', 'awayMoneyline', 'homeMoneyline'];
  const best = Object.fromEntries(keys.map(key => [key, bestOffer(books, key)])) as Record<BetKey, Best | null>;
  return { best, books: books.length, differs: keys.some(key => best[key]?.differs) };
}

export const bookShort = (name: string) => (name === 'DraftKings' ? 'DK' : name === 'FanDuel' ? 'FD' : name);
export const priceText = (value: number) => (value > 0 ? `+${value}` : String(value));
export const pointText = (value: number) => (value === 0 ? 'PK' : `${value > 0 ? '+' : ''}${value}`);
