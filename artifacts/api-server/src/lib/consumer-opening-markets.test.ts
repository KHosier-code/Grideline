import assert from "node:assert/strict";
import test from "node:test";
import { selectFirstRequestMarkets } from "./consumer-opening-markets";

const observedAt = new Date("2026-09-25T12:00:00Z");
const saved = [
  { market: "moneyline", selection: "HOM", point: null, price: -130 },
  { market: "moneyline", selection: "AWY", point: null, price: 120 },
  { market: "spread", selection: "HOM", point: -3, price: -110 },
  { market: "spread", selection: "AWY", point: 3, price: -110 },
];
const decision = {
  status: "locked", sportsbook: "DraftKings", quotes: saved,
  requestedAt: new Date("2026-09-25T11:59:00Z"), observedAt,
  kickoffTime: new Date("2026-09-28T00:00:00Z"),
};
const history = [
  ...saved.map((row) => ({ ...row, sportsbook: "DraftKings", capturedAt: observedAt, sourceTimestamp: null })),
  { sportsbook: "DraftKings", market: "total", selection: "Over", point: 44, price: -110, capturedAt: observedAt, sourceTimestamp: null },
  { sportsbook: "DraftKings", market: "total", selection: "Under", point: 44, price: -110, capturedAt: observedAt, sourceTimestamp: null },
  ...[
    { market: "moneyline", selection: "HOM", point: null, price: -120 },
    { market: "moneyline", selection: "AWY", point: null, price: 110 },
    { market: "spread", selection: "HOM", point: -2.5, price: -115 },
    { market: "spread", selection: "AWY", point: 2.5, price: -105 },
    { market: "total", selection: "Over", point: 43.5, price: -115 },
    { market: "total", selection: "Under", point: 43.5, price: -105 },
  ].map((row) => ({ ...row, sportsbook: "FanDuel", capturedAt: observedAt, sourceTimestamp: null })),
];

test("chooses a customer-favorable first-request quote independently per market", () => {
  const selected = selectFirstRequestMarkets(decision, history, "HOM", "AWY", 0.65, 47);
  assert.equal(selected.moneyline?.sportsbook, "FanDuel");
  assert.equal(selected.moneyline?.price, -120);
  assert.equal(selected.spread?.sportsbook, "FanDuel");
  assert.equal(selected.spread?.point, -2.5);
  assert.equal(selected.total?.sportsbook, "FanDuel");
  assert.equal(selected.total?.point, 43.5);
  const under = selectFirstRequestMarkets(decision, history, "HOM", "AWY", 0.35, 39);
  assert.equal(under.moneyline?.selection, "AWY");
  assert.equal(under.total?.point, 44);
});

test("does not call later or unverified quotes an initial line", () => {
  const later = { ...history[0]!, price: +150, capturedAt: new Date("2026-09-26T12:00:00Z") };
  const selected = selectFirstRequestMarkets(decision, [...history, later], "HOM", "AWY", 0.65, 47);
  assert.equal(selected.moneyline?.price, -120);
  assert.equal(selectFirstRequestMarkets({ ...decision, status: "legacy_unattributed" }, history, "HOM", "AWY", 0.65, 47).capturedAt, null);
  assert.equal(selectFirstRequestMarkets({ ...decision, quotes: [{ ...saved[0]!, price: -150 }, ...saved.slice(1)] }, history, "HOM", "AWY", 0.65, 47).capturedAt, null);
  const lateSource = history.map((row) => row.market === "total"
    ? { ...row, sourceTimestamp: new Date("2026-09-26T12:00:00Z") } : row);
  assert.equal(selectFirstRequestMarkets(decision, lateSource, "HOM", "AWY", 0.65, 47).total, null);
});

test("never invents a selection when a projection or complete total is absent", () => {
  const noTotal = history.filter((row) => row.market !== "total");
  assert.equal(selectFirstRequestMarkets(decision, noTotal, "HOM", "AWY", 0.65, 47).total, null);
  assert.equal(selectFirstRequestMarkets(decision, history, "HOM", "AWY", null, null).moneyline, null);
  assert.equal(selectFirstRequestMarkets(decision, history, "HOM", "AWY", null, null).total, null);
});