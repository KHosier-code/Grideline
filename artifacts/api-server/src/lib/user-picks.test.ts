import assert from "node:assert/strict";
import test from "node:test";
import { gradeUserPick, pickUnits, quoteForPick, userPickRecord, validSide } from "./user-picks";

const quote = (point: number | null, price: number) => ({ sportsbook: "draftkings", point, price });
const market = {
  spread: quote(-3.5, -110), awaySpread: quote(3.5, -105),
  moneyline: quote(null, -180), awayMoneyline: quote(null, 150),
  total: quote(47.5, -112), under: quote(47.5, -108),
};

test("sides must match the market", () => {
  assert.equal(validSide("total", "over"), true);
  assert.equal(validSide("total", "home"), false);
  assert.equal(validSide("spread", "under"), false);
  assert.equal(validSide("moneyline", "away"), true);
});

test("a pick locks the picked side's line and price", () => {
  assert.deepEqual(quoteForPick(market, "spread", "home"), { line: -3.5, price: -110, sportsbook: "draftkings" });
  assert.deepEqual(quoteForPick(market, "spread", "away"), { line: 3.5, price: -105, sportsbook: "draftkings" });
  assert.deepEqual(quoteForPick(market, "moneyline", "away"), { line: null, price: 150, sportsbook: "draftkings" });
  assert.deepEqual(quoteForPick(market, "total", "under"), { line: 47.5, price: -108, sportsbook: "draftkings" });
  // Missing other side: flip the home line, no price.
  assert.deepEqual(quoteForPick({ ...market, awaySpread: null }, "spread", "away"), { line: 3.5, price: null, sportsbook: "draftkings" });
  assert.equal(quoteForPick({ ...market, spread: null }, "spread", "home"), null);
  assert.equal(quoteForPick({ ...market, total: null }, "total", "over"), null);
});

test("grading: winners, covers, pushes and totals", () => {
  const final = { home: 24, away: 21 };
  assert.equal(gradeUserPick({ market: "moneyline", side: "home", line: null }, final), "win");
  assert.equal(gradeUserPick({ market: "spread", side: "home", line: -3.5 }, final), "loss");
  assert.equal(gradeUserPick({ market: "spread", side: "away", line: 3.5 }, final), "win");
  assert.equal(gradeUserPick({ market: "spread", side: "home", line: -3 }, final), "push");
  assert.equal(gradeUserPick({ market: "total", side: "under", line: 47.5 }, final), "win");
  assert.equal(gradeUserPick({ market: "total", side: "over", line: 45 }, final), "push");
  assert.equal(gradeUserPick({ market: "moneyline", side: "away", line: null }, { home: 20, away: 20 }), "push");
  assert.equal(gradeUserPick({ market: "spread", side: "home", line: -3 }, null), null);
});

test("units use the locked price, -110 for a missing spread price", () => {
  assert.equal(pickUnits("win", "moneyline", 150), 1.5);
  assert.equal(Math.round(pickUnits("win", "spread", null)! * 1000) / 1000, 0.909);
  assert.equal(pickUnits("loss", "total", -110), -1);
  assert.equal(pickUnits("push", "spread", -110), 0);
  assert.equal(pickUnits("win", "moneyline", null), null);
});

test("record splits by market and week, newest week first", () => {
  const record = userPickRecord([
    { season: 2026, week: 3, market: "spread", result: "win", units: 0.91 },
    { season: 2026, week: 3, market: "total", result: "loss", units: -1 },
    { season: 2026, week: 4, market: "moneyline", result: "push", units: 0 },
    { season: 2026, week: 4, market: "spread", result: null, units: 0 },
  ]);
  assert.deepEqual(record.overall, { wins: 1, losses: 1, pushes: 1, pending: 1, units: -0.09 });
  assert.equal(record.byMarket.spread.wins, 1);
  assert.equal(record.byMarket.spread.pending, 1);
  assert.deepEqual(record.byWeek.map((week) => week.week), [4, 3]);
});
