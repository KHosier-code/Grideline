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
  for (const column of ["primaryVolume", "primaryYards"]) {
    assert.ok(parseUsageAnalyticsEvent({ eventName: "usage_sort_changed", column, direction: "asc" }));
  }
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

test("summary preserves aggregates, daily trends, and the selected cutoff", async () => {
  const periodEnd = new Date("2026-09-17T12:00:00.000Z");
  const { database, whereConditions } = fakeDatabase([
    [{ count: 12 }],
    [{ label: "team", choice: "BUF", count: 4 }],
    [{ label: "targets", choice: "desc", count: 3 }],
    [{ label: "WR", count: 5 }],
    [{ label: "up", count: 3 }],
    [{ label: "complete", count: 4 }],
    [{ label: "last5", count: 5 }],
    [{ count: 2 }],
    [
      { date: "2026-09-11", eventCount: 5, rowExpansionCount: 2 },
      { date: "2026-09-17", eventCount: 7, rowExpansionCount: 3 },
    ],
  ]);

  const summary = await getUsageAnalyticsSummary(database, "7d", periodEnd);

  assert.equal(summary.periodStart.toISOString(), "2026-09-11T00:00:00.000Z");
  assert.equal(summary.periodDays, 7);
  assert.equal(summary.collectionStatus, "partial");
  assert.equal(summary.daysWithActivity, 2);
  assert.equal(summary.dailyTrends[0]?.eventCount, 5);
  assert.equal(summary.dailyTrends[6]?.rowExpansionCount, 3);
  assert.equal(summary.totalEvents, 12);
  assert.deepEqual(summary.filterChanges, [{ label: "team", choice: "BUF", count: 4 }]);
  assert.deepEqual(summary.expansionsByPosition, [{ label: "WR", count: 5 }]);
  assert.equal(summary.resets, 2);
  assert.equal(whereConditions.length, 9);
});

test("summary identifies an empty period and returns zero-filled days", async () => {
  const periodEnd = new Date("2026-09-17T12:00:00.000Z");
  const { database } = fakeDatabase([
    [{ count: 0 }], [], [], [], [], [], [], [{ count: 0 }], [],
  ]);

  const summary = await getUsageAnalyticsSummary(database, "14d", periodEnd);
  assert.equal(summary.periodDays, 14);
  assert.equal(summary.collectionStatus, "empty");
  assert.equal(summary.daysWithActivity, 0);
  assert.equal(summary.dailyTrends.length, 14);
  assert.ok(summary.dailyTrends.every((row) => row.eventCount === 0 && row.rowExpansionCount === 0));
});

test("the route source protects capture and report access", async () => {
  const { readFile } = await import("node:fs/promises");
  const source = await readFile(new URL("./usage-analytics.ts", import.meta.url), "utf8");
  assert.match(source, /if \(!getAuth\(req\)\.userId\)/);
  assert.match(source, /router\.get\("\/admin\/usage-analytics", requireAdmin/);
  assert.match(source, /GetUsageAnalyticsSummaryQueryParams\.safeParse\(req\.query\)/);
  assert.match(source, /collectionStatus/);
  assert.match(source, /rowExpansionCount/);
  assert.match(source, /hasOnlyAllowedEventKeys/);
});