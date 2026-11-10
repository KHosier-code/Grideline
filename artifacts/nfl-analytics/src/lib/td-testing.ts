/**
 * The touchdown model's long-run test, quoted wherever the site states a
 * tested hit rate. From research/algo-sweep (td_backtest.py): walk-forward,
 * each season predicted by a model trained only on earlier seasons, 2021
 * through week 3 of 2026, five-seed averaged model.
 *
 * The model's own `evaluation.topTenHitRate` (about 60%) covers only the
 * 2025–2026 holdout, so it is not used as a headline.
 */
export const TD_TEST = {
  span: '2021 through week 3 of 2026',
  short: '2021–2026',
  topTen: { hits: 491, picks: 930, rate: 0.528 },
  topFive: { hits: 254, picks: 465, rate: 0.546 },
  /**
   * Top-10 picks averaged about −167 at DraftKings/FanDuel this season, which
   * needs 167 / 267 = 62.5% to break even.
   */
  topTenTypicalPrice: '−167',
  topTenBreakEven: 0.625,
} as const;

export const pctText = (value: number, digits = 1) => `${(value * 100).toFixed(digits)}%`;
