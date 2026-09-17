import assert from "node:assert/strict";
import test from "node:test";
import { getUsageAnalyticsSummary, parseUsageAnalyticsEvent } from "./usage-analytics";

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
  assert.equal(parseUsageAnalyticsEvent({
    eventName: "usage_filter_changed",
    filter: "team",
    value: "BUF",
    column: "targets",
  }), null);
  assert.equal(parseUsageAnalyticsEvent({
    eventName: "usage_sort_changed",
    column: "targets",
    direction: "desc",
    value: "unexpected",
  }), null);
  assert.equal(parseUsageAnalyticsEvent({
    eventName: "usage_filters_reset",
    hadTeam: true,
    hadPosition: false,
    hadGame: false,
    window: "season",
    value: "unexpected",
  }), null);
  assert.equal(parseUsageAnalyticsEvent({
    eventName: "usage_filter_changed",
    filter: "team",
    value: "x".repeat(33),
  }), null);
});

function fakeDatabase(results: unknown[]) {
  const whereConditions: unknown[] = [];
  let resultIndex = 0;
  const select = () => {
    const result = results[resultIndex++];
    const query: Record<string, unknown> = {
      from: () => query,
      where: (condition: unknown) => {
        whereConditions.push(condition);
        return query;
      },
      groupBy: () => query,
      orderBy: () => query,
      then: (resolve: (value: unknown) => unknown, reject: (reason: unknown) => unknown) =>
        Promise.resolve(result).then(resolve, reject),
    };
    return query;
  };
  return { database: { select } as never, whereConditions };
}

test("summary preserves filters, sorts, all expansion dimensions, resets, and cutoff", async () => {
  const periodEnd = new Date("2026-09-17T12:00:00.000Z");
  const { database, whereConditions } = fakeDatabase([
    [{ count: 12 }],
    [
      { label: "team", choice: "BUF", count: 4 },
      { label: "window", choice: "last5", count: 2 },
    ],
    [{ label: "targets", choice: "desc", count: 3 }],
    [{ label: "WR", count: 5 }],
    [{ label: "up", count: 3 }],
    [{ label: "complete", count: 4 }],
    [{ label: "last5", count: 5 }],
    [{ count: 2 }],
  ]);

  const summary = await getUsageAnalyticsSummary(database, periodEnd);

  assert.deepEqual(summary, {
    periodStart: new Date("2026-09-10T12:00:00.000Z"),
    periodEnd,
    periodDays: 7,
    totalEvents: 12,
    filterChanges: [
      { label: "team", choice: "BUF", count: 4 },
      { label: "window", choice: "last5", count: 2 },
    ],
    sortChoices: [{ label: "targets", choice: "desc", count: 3 }],
    expansionsByPosition: [{ label: "WR", count: 5 }],
    expansionsByTrend: [{ label: "up", count: 3 }],
    expansionsByCoverage: [{ label: "complete", count: 4 }],
    expansionsByWindow: [{ label: "last5", count: 5 }],
    resets: 2,
  });
  assert.equal(whereConditions.length, 8);
});

test("summary returns empty groups and zero totals when there is no activity", async () => {
  const periodEnd = new Date("2026-09-17T12:00:00.000Z");
  const { database } = fakeDatabase([
    [{ count: 0 }], [], [], [], [], [], [], [{ count: 0 }],
  ]);

  assert.deepEqual(await getUsageAnalyticsSummary(database, periodEnd), {
    periodStart: new Date("2026-09-10T12:00:00.000Z"),
    periodEnd,
    periodDays: 7,
    totalEvents: 0,
    filterChanges: [],
    sortChoices: [],
    expansionsByPosition: [],
    expansionsByTrend: [],
    expansionsByCoverage: [],
    expansionsByWindow: [],
    resets: 0,
  });
});

test("the route source protects capture and report access", async () => {
  const { readFile } = await import("node:fs/promises");
  const source = await readFile(new URL("./usage-analytics.ts", import.meta.url), "utf8");
  assert.match(source, /if \(!getAuth\(req\)\.userId\)/);
  assert.match(source, /router\.get\("\/admin\/usage-analytics", requireAdmin/);
  assert.match(source, /eq\(usageAnalyticsEventsTable\.action, "expand"\)/);
  assert.match(source, /gte\(usageAnalyticsEventsTable\.createdAt, periodStart\)/);
});