import test from "node:test";
import assert from "node:assert/strict";
import { trendLabel, usageChartData } from "./consumer-usage.ts";

test("usage chart transformation preserves unavailable values", () => {
  assert.deepEqual(usageChartData([
    { week: 1, metrics: { targets: { value: 4 }, carries: { value: null } } },
    { week: 2, metrics: { targets: { value: 0 }, carries: { value: 3 } } },
  ]), [
    { name: "W1", targets: 4, carries: undefined },
    { name: "W2", targets: 0, carries: 3 },
  ]);
});

test("usage trend labels distinguish flat from unavailable", () => {
  assert.equal(trendLabel("flat"), "— Flat");
  assert.equal(trendLabel("unavailable"), "— Trend unavailable");
});