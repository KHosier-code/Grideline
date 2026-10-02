type Quote = {
  sportsbook: string;
  market: string;
  selection: string;
  point: number | null;
  price: number;
  capturedAt: Date;
  sourceTimestamp: Date | null;
};

const validPrice = (price: number) => Number.isInteger(price) && (price <= -100 || price >= 100);
const publicQuote = (quote: Quote) => ({
  sportsbook: quote.sportsbook,
  selection: quote.selection,
  point: quote.point,
  price: quote.price,
  capturedAt: quote.capturedAt.toISOString(),
});

/** Opening lines from the first capture saved for a game. */
export function firstSavedMarkets(history: Quote[]) {
  const empty = { capturedAt: null, moneyline: null, spread: null, total: null };
  const rows = history.filter((row) => ["DraftKings", "FanDuel"].includes(row.sportsbook) && validPrice(row.price));
  if (!rows.length) return empty;
  const firstAt = Math.min(...rows.map((row) => row.capturedAt.getTime()));
  const first = rows.filter((row) => row.capturedAt.getTime() === firstAt)
    .sort((a, b) => a.sportsbook.localeCompare(b.sportsbook)); // DraftKings before FanDuel
  const spread = first.find((row) => row.market === "spread" && row.point !== null && row.point < 0)
    ?? first.find((row) => row.market === "spread" && row.point !== null);
  const moneyline = first.find((row) => row.market === "moneyline" && row.price < 0)
    ?? first.find((row) => row.market === "moneyline");
  const total = first.find((row) => row.market === "total" && row.selection.toLowerCase() === "over" && row.point !== null);
  return {
    capturedAt: new Date(firstAt).toISOString(),
    moneyline: moneyline ? publicQuote(moneyline) : null,
    spread: spread ? publicQuote(spread) : null,
    total: total ? publicQuote(total) : null,
  };
}
