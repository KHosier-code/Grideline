/**
 * Grading for users' own moneyline, spread and over/under picks.
 *
 * Conventions match the consumer market: `spread.point` is the HOME line
 * (negative when home is favored) and `awaySpread` is the same book's away
 * side; `moneyline` is the home price and `awayMoneyline` the away price.
 */
export type UserPickMarket = "moneyline" | "spread" | "total";
export type UserPickSide = "home" | "away" | "over" | "under";
export type UserPickResult = "win" | "loss" | "push";

export const USER_PICK_MARKETS: UserPickMarket[] = ["moneyline", "spread", "total"];

type Quote = { sportsbook: string; point: number | null; price: number } | null | undefined;
export type PickMarketQuotes = {
  spread: Quote; awaySpread?: Quote; moneyline: Quote; awayMoneyline?: Quote; total: Quote; under?: Quote;
};

export function validSide(market: UserPickMarket, side: string): side is UserPickSide {
  return market === "total" ? side === "over" || side === "under" : side === "home" || side === "away";
}

/**
 * The number a pick is locked at: the picked side's line and price from the
 * latest captured quote. A side whose price wasn't saved still takes the line
 * (spread: the home line flipped; under: the over's total) without a price.
 */
export function quoteForPick(market: PickMarketQuotes, pick: UserPickMarket, side: UserPickSide) {
  const finite = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value);
  if (pick === "moneyline") {
    // Without a saved price the pick is still graded on the winner, just not in units.
    const quote = side === "home" ? market.moneyline : market.awayMoneyline;
    return { line: null, price: quote && finite(quote.price) ? quote.price : null, sportsbook: quote?.sportsbook ?? null };
  }
  if (pick === "spread") {
    const home = market.spread;
    if (!home || !finite(home.point)) return null;
    if (side === "home") return { line: home.point, price: finite(home.price) ? home.price : null, sportsbook: home.sportsbook };
    const away = market.awaySpread;
    if (away && finite(away.point) && away.point === -home.point) return { line: away.point, price: away.price, sportsbook: away.sportsbook };
    return { line: -home.point, price: null, sportsbook: home.sportsbook };
  }
  const over = market.total;
  if (!over || !finite(over.point)) return null;
  if (side === "over") return { line: over.point, price: finite(over.price) ? over.price : null, sportsbook: over.sportsbook };
  const under = market.under;
  if (under && finite(under.point) && under.point === over.point) return { line: under.point, price: under.price, sportsbook: under.sportsbook };
  return { line: over.point, price: null, sportsbook: over.sportsbook };
}

export function gradeUserPick(
  pick: { market: UserPickMarket; side: UserPickSide; line: number | null },
  final: { home: number; away: number } | null,
): UserPickResult | null {
  if (!final) return null;
  if (pick.market === "moneyline") {
    if (final.home === final.away) return "push";
    return (final.home > final.away) === (pick.side === "home") ? "win" : "loss";
  }
  if (pick.line === null) return null;
  if (pick.market === "spread") {
    const margin = pick.side === "home" ? final.home - final.away : final.away - final.home;
    const cover = margin + pick.line;
    return cover === 0 ? "push" : cover > 0 ? "win" : "loss";
  }
  const points = final.home + final.away;
  if (points === pick.line) return "push";
  return (points > pick.line) === (pick.side === "over") ? "win" : "loss";
}

/** Profit in units for a 1-unit stake; -110 when a spread/total price wasn't saved. */
export function pickUnits(result: UserPickResult | null, market: UserPickMarket, price: number | null) {
  if (result === null || result === "push") return 0;
  if (result === "loss") return -1;
  const american = price ?? (market === "moneyline" ? null : -110);
  if (american === null) return null;
  return american > 0 ? american / 100 : 100 / -american;
}

export type RecordLine = { wins: number; losses: number; pushes: number; pending: number; units: number };
const emptyLine = (): RecordLine => ({ wins: 0, losses: 0, pushes: 0, pending: 0, units: 0 });

function add(line: RecordLine, result: UserPickResult | null, units: number | null) {
  if (result === "win") line.wins += 1;
  else if (result === "loss") line.losses += 1;
  else if (result === "push") line.pushes += 1;
  else line.pending += 1;
  if (units !== null) line.units = Math.round((line.units + units) * 100) / 100;
}

export function userPickRecord(picks: Array<{ season: number; week: number; market: UserPickMarket; result: UserPickResult | null; units: number | null }>) {
  const overall = emptyLine();
  const byMarket = { moneyline: emptyLine(), spread: emptyLine(), total: emptyLine() };
  const weeks = new Map<string, RecordLine & { season: number; week: number }>();
  for (const pick of picks) {
    add(overall, pick.result, pick.units);
    add(byMarket[pick.market], pick.result, pick.units);
    const key = `${pick.season}-${pick.week}`;
    if (!weeks.has(key)) weeks.set(key, { season: pick.season, week: pick.week, ...emptyLine() });
    add(weeks.get(key)!, pick.result, pick.units);
  }
  const byWeek = [...weeks.values()].sort((a, b) => b.season - a.season || b.week - a.week);
  return { overall, byMarket, byWeek };
}
