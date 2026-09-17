import assert from "node:assert/strict";
import test from "node:test";
import { parseUsageAnalyticsEvent } from "./usage-analytics";

test("accepts each bounded Usage Lab event shape", () => {
  assert.ok(parseUsageAnalyticsEvent({
    eventName: "usage_filter_changed",
    filter: "team",
    value: "BUF",
  }));
  assert.ok(parseUsageAnalyticsEvent({
    eventName: "usage_sort_changed",
    column: "targets",
    direction: "desc",
  }));
  assert.ok(parseUsageAnalyticsEvent({
    eventName: "usage_row_toggled",
    action: "expand",
    position: "WR",
    trend: "up",
    coverage: "complete",
    window: "last5",
  }));
  assert.ok(parseUsageAnalyticsEvent({
    eventName: "usage_filters_reset",
    hadTeam: true,
    hadPosition: false,
    hadGame: false,
    window: "last5",
  }));
});

test("rejects arbitrary analytics dimensions and incomplete payloads", () => {
  assert.equal(parseUsageAnalyticsEvent({
    eventName: "usage_filter_changed",
    filter: "team",
    value: "free-form value",
  }), null);
  assert.equal(parseUsageAnalyticsEvent({
    eventName: "usage_sort_changed",
    column: "playerEmail",
    direction: "asc",
  }), null);
  assert.equal(parseUsageAnalyticsEvent({
    eventName: "usage_row_toggled",
    action: "expand",
    position: "WR",
  }), null);
});

test("the route source protects capture and report access", async () => {
  const { readFile } = await import("node:fs/promises");
  const source = await readFile(new URL("./usage-analytics.ts", import.meta.url), "utf8");
  assert.match(source, /if \(!getAuth\(req\)\.userId\)/);
  assert.match(source, /router\.get\("\/admin\/usage-analytics", requireAdmin/);
});