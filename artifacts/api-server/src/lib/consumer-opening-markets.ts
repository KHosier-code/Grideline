type Quote = {
  sportsbook: string;
  market: string;
  selection: string;
  point: number | null;
  price: number;
  capturedAt: Date;
  sourceTimestamp: Date | null;
};

type Decision = {
  status: string;
  sportsbook: string | null;
  requestedAt: Date;
  observedAt: Date;
  kickoffTime: Date;
  quotes: Array<{ market: string; selection: string; point: number | null; price: number }> | null;
};

const validPrice = (price: number) => Number.isInteger(price) && (price <= -100 || price >= 100);
const publicQuote = (quote: Quote) => ({
  sportsbook: quote.sportsbook,
  selection: quote.selection,
  point: quote.point,
  price: quote.price,
  capturedAt: quote.capturedAt.toISOString(),
});

/** This is a view of the locked first request, never a recovery of a later quote. */
export function selectFirstRequestMarkets(
  decision: Decision | undefined,
  history: Quote[],
  home: string,
  away: string,
  homeProbability: number | null,
  projectedTotal: number | null,
) {
  const empty = { capturedAt: null, moneyline: null, spread: null, total: null };
  if (!decision || decision.status !== "locked" || !decision.sportsbook || !decision.quotes || decision.quotes.length !== 4
    || !home || !away || home === away || decision.requestedAt > decision.observedAt
    || decision.observedAt >= decision.kickoffTime) return empty;
  const first = history.filter((row) => row.capturedAt.getTime() === decision.observedAt.getTime()
    && (!row.sourceTimestamp || row.sourceTimestamp <= decision.observedAt)
    && ["DraftKings", "FanDuel"].includes(row.sportsbook) && validPrice(row.price)
    && (row.point === null || Number.isFinite(row.point)));
  // The immutable lock must still be supported by its saved first-observation quotes.
  if (!decision.quotes.every((saved) => first.some((row) =>
    row.sportsbook === decision.sportsbook && row.market === saved.market && row.selection === saved.selection
    && row.point === saved.point && row.price === saved.price))) return empty;

  const validBook = (book: string, market: "moneyline" | "spread" | "total") => {
    const sides = market === "total" ? ["Over", "Under"] : [home, away];
    const rows = sides.map((side) => first.filter((row) =>
      row.sportsbook === book && row.market === market && row.selection.toLowerCase() === side.toLowerCase()));
    if (rows.some((side) => side.length !== 1)) return null;
    if (market === "moneyline") return rows[0]![0]!.point === null && rows[1]![0]!.point === null ? rows.flat() : null;
    if (rows.some((side) => side[0]!.point === null)) return null;
    const a = rows[0]![0]!.point!;
    const b = rows[1]![0]!.point!;
    return market === "spread"
      ? Math.abs(a + b) < 1e-6 ? rows.flat() : null
      : Math.abs(a - b) < 1e-6 ? rows.flat() : null;
  };
  const available = (market: "moneyline" | "spread" | "total") =>
    ["DraftKings", "FanDuel"].flatMap((book) => validBook(book, market) ?? []);
  const winner = homeProbability === null || !Number.isFinite(homeProbability) || homeProbability === 0.5
    ? null : homeProbability > 0.5 ? home : away;
  const moneyline = available("moneyline").filter((row) => row.selection === winner)
    .sort((a, b) => b.price - a.price || a.sportsbook.localeCompare(b.sportsbook))[0];
  // A market favorite is the side whose saved first-request spread is negative.
  const initialFavorite = decision.quotes.find((row) => row.market === "spread" && row.point !== null && row.point < 0)?.selection;
  const spread = initialFavorite ? available("spread").filter((row) => row.selection === initialFavorite && row.point! < 0)
    .sort((a, b) => b.point! - a.point! || b.price - a.price || a.sportsbook.localeCompare(b.sportsbook))[0] : undefined;
  const totals = available("total");
  const reference = totals.length ? totals.reduce((sum, row) => sum + row.point!, 0) / totals.length : null;
  const direction = projectedTotal === null || !Number.isFinite(projectedTotal) || reference === null || projectedTotal === reference
    ? null : projectedTotal > reference ? "over" : "under";
  const total = direction ? totals.filter((row) => row.selection.toLowerCase() === direction)
    .sort((a, b) => (direction === "over" ? a.point! - b.point! : b.point! - a.point!)
      || b.price - a.price || a.sportsbook.localeCompare(b.sportsbook))[0] : undefined;
  return {
    capturedAt: decision.observedAt.toISOString(),
    moneyline: moneyline ? publicQuote(moneyline) : null,
    spread: spread ? publicQuote(spread) : null,
    total: total ? publicQuote(total) : null,
  };
}