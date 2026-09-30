/**
 * Sportsbook price helpers. A book's two sides add up to more than 100%
 * (the vig), so a single price overstates that side's chance. Removing the
 * vig proportionally gives the market's fair probability.
 */
export const impliedProbability = (american: number) =>
  american < 0 ? -american / (-american + 100) : 100 / (american + 100);

/** Fair chances for two sides of one market, vig removed proportionally. */
export function devig(priceA: number, priceB: number): [number, number] {
  const a = impliedProbability(priceA);
  const b = impliedProbability(priceB);
  return [a / (a + b), b / (a + b)];
}

/**
 * Typical anytime-TD hold at DraftKings and FanDuel. Only one side (Yes) is
 * captured, so it can't be removed exactly; this is an average estimate.
 */
export const TD_PROP_HOLD = 0.2;

/** Book's anytime-TD chance with the estimated vig taken out. */
export const tdFairProbability = (american: number) => impliedProbability(american) / (1 + TD_PROP_HOLD);
