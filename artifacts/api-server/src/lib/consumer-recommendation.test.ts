import assert from "node:assert/strict";
import test from "node:test";
import { consumerRecommendation } from "./consumer-recommendation";
import type { ConsumerSourceHealth } from "./consumer-source-health";

const now = new Date("2026-09-20T16:00:00Z");
const observed = new Date("2026-09-20T15:55:00Z");
const source = {
  status: "healthy" as const,
  lastAttemptAt: observed.toISOString(), lastSuccessAt: observed.toISOString(),
  sourceTimestamp: observed.toISOString(), lastAttemptStatus: "success",
  message: null, staleAfterMinutes: 15,
};
const health: ConsumerSourceHealth = { status: "healthy", sources: {
  schedule: source, odds: source, players: source, injuries: source,
} };
const quote = (sportsbook: string, market: string, selection: string, point: number | null, price = -110) =>
  ({ sportsbook, market, selection, point, price, capturedAt: observed });
const quotes = ["DraftKings", "FanDuel"].flatMap((book) => [
  quote(book, "spread", "HME", -3), quote(book, "spread", "AWY", 3),
  quote(book, "total", "Over", 44), quote(book, "total", "Under", 44),
  quote(book, "moneyline", "HME", null, -150), quote(book, "moneyline", "AWY", null, 130),
]);
const comparisons = (["spread", "total", "moneyline"] as const).map((market) =>
  ({ market, state: "available" as const, modelValue: 1 }));
const input = { gameState: "pregame" as const, kickoffTime: new Date("2026-09-20T17:00:00Z"),
  now, sourceHealth: health, homeAbbreviation: "HME", awayAbbreviation: "AWY", rows: quotes, comparisons,
  verifiedAt: observed };

test("the exact kickoff closes current recommendations, without deleting saved projections", () => {
  assert.equal(consumerRecommendation(input).status, "healthy");
  const result = consumerRecommendation({ ...input, now: input.kickoffTime });
  assert.equal(result.status, "historical");
  assert.deepEqual(result.markets, { spread: false, total: false, moneyline: false });
});

test("a final game with a cached market quote cannot become a current recommendation", () => {
  assert.equal(consumerRecommendation({ ...input, gameState: "final" }).status, "historical");
});

test("a stale required feed suppresses each market even if price rows are fresh", () => {
  const staleHealth: ConsumerSourceHealth = { ...health, sources: {
    ...health.sources, odds: { ...source, status: "stale" },
  } };
  const result = consumerRecommendation({ ...input, sourceHealth: staleHealth });
  assert.equal(result.status, "stale");
  assert.equal(result.markets.moneyline, false);
});

test("missing moneyline price suppresses moneyline only", () => {
  const result = consumerRecommendation({ ...input, rows: quotes.filter((row) =>
    !(row.sportsbook === "FanDuel" && row.market === "moneyline" && row.selection === "AWY")) });
  assert.equal(result.status, "partial");
  assert.deepEqual(result.markets, { spread: true, total: true, moneyline: false });
});

test("latest invalid price cannot be bypassed by an older quote", () => {
  const rows = [...quotes, { ...quote("FanDuel", "moneyline", "AWY", null, 0), capturedAt: now }];
  assert.equal(consumerRecommendation({ ...input, rows }).markets.moneyline, false);
});

test("an unchanged quote remains eligible only when a complete game observation recently reverified it", () => {
  const oldRows = quotes.map((row) => ({ ...row, capturedAt: new Date("2026-09-20T12:00:00Z") }));
  assert.equal(consumerRecommendation({ ...input, rows: oldRows }).status, "healthy");
  assert.equal(consumerRecommendation({
    ...input,
    rows: oldRows,
    verifiedAt: new Date("2026-09-20T15:40:00Z"),
  }).status, "unavailable");
});