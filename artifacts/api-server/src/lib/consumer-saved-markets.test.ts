import assert from "node:assert/strict";
import test from "node:test";
import { firstSavedMarkets } from "./consumer-opening-markets";
import { latestSavedMarket } from "../routes/consumer";

const row = (sportsbook: string, market: string, selection: string, point: number | null, price: number, minute: number) => ({
  sportsbook, market, selection, point, price, capturedAt: new Date(Date.UTC(2026, 8, 29, 14, minute)), sourceTimestamp: null,
});
const home = { teamId: "2", name: "Buffalo Bills", abbreviation: "BUF" };

test("current market uses the newest saved quote per book and side", () => {
  const rows = [
    row("DraftKings", "spread", "BUF", -6.5, -110, 0), row("DraftKings", "spread", "NE", 6.5, -110, 0),
    row("DraftKings", "spread", "BUF", -7, -110, 30), row("DraftKings", "spread", "NE", 7, -110, 30),
    row("DraftKings", "moneyline", "BUF", -300, -300, 30), row("DraftKings", "moneyline", "NE", 240, 240, 30),
    row("DraftKings", "total", "Over", 48.5, -110, 30), row("DraftKings", "total", "Under", 48.5, -110, 30),
  ];
  const market = latestSavedMarket(rows, home);
  assert.equal(market.spread?.point, -7);
  assert.equal(market.total?.point, 48.5);
  assert.equal(market.awayMoneyline?.price, 240);
  assert.equal(market.evidence.available, true);
  assert.equal(latestSavedMarket([], home).evidence.available, false);
});

test("opening markets come from the first saved capture", () => {
  const rows = [
    row("FanDuel", "spread", "BUF", -6, -110, 0), row("DraftKings", "spread", "BUF", -6.5, -110, 0),
    row("DraftKings", "spread", "NE", 6.5, -110, 0), row("DraftKings", "total", "Over", 47.5, -110, 0),
    row("DraftKings", "spread", "BUF", -7, -110, 30),
  ];
  const open = firstSavedMarkets(rows);
  assert.equal(open.spread?.point, -6.5);
  assert.equal(open.spread?.sportsbook, "DraftKings");
  assert.equal(open.total?.point, 47.5);
  assert.equal(firstSavedMarkets([]).capturedAt, null);
});
