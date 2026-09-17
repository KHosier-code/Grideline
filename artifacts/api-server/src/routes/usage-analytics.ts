import { Router, type IRouter } from "express";
import { getAuth } from "@clerk/express";
import { and, count, desc, eq, gte, sql } from "drizzle-orm";
import type { AnyPgColumn } from "drizzle-orm/pg-core";
import {
  CaptureUsageAnalyticsEventBody,
  GetUsageAnalyticsSummaryResponse,
} from "@workspace/api-zod";
import { db, usageAnalyticsEventsTable } from "@workspace/db";
import { requireAdmin } from "../middlewares/admin";

const router: IRouter = Router();
const PERIOD_DAYS = 7;
type UsageAnalyticsEventInput = ReturnType<typeof CaptureUsageAnalyticsEventBody.parse>;

const allowedValues = {
  filter: new Set(["team", "position", "window", "game"]),
  direction: new Set(["asc", "desc"]),
  action: new Set(["expand", "collapse"]),
  position: new Set(["QB", "RB", "WR", "TE", "unknown"]),
  trend: new Set(["up", "down", "flat", "unavailable"]),
  coverage: new Set(["complete", "partial"]),
  window: new Set(["last3", "last5", "last8", "season"]),
  sortColumn: new Set(["name", "snapShare", "targets", "receptions", "receivingYards", "carries", "rushingYards", "totalTd", "trend"]),
  team: new Set(["all", "ARI", "ATL", "BAL", "BUF", "CAR", "CHI", "CIN", "CLE", "DAL", "DEN", "DET", "GB", "HOU", "IND", "JAX", "KC", "LV", "LAC", "LAR", "MIA", "MIN", "NE", "NO", "NYG", "NYJ", "PHI", "PIT", "SEA", "SF", "TB", "TEN", "WAS"]),
  filterPosition: new Set(["all", "QB", "RB", "WR", "TE"]),
  filterWindow: new Set(["all", "last3", "last5", "last8", "season"]),
  filterGame: new Set(["all", "specific_game"]),
};

export function eventIsCoherent(event: UsageAnalyticsEventInput): boolean {
  if (event.eventName === "usage_filter_changed") {
    if (!event.filter || !allowedValues.filter.has(event.filter) || !event.value) return false;
    if (event.filter === "team") return allowedValues.team.has(event.value);
    if (event.filter === "position") return allowedValues.filterPosition.has(event.value);
    if (event.filter === "window") return allowedValues.filterWindow.has(event.value);
    return allowedValues.filterGame.has(event.value);
  }
  if (event.eventName === "usage_sort_changed") {
    return Boolean(
      event.column && allowedValues.sortColumn.has(event.column)
      && event.direction && allowedValues.direction.has(event.direction),
    );
  }
  if (event.eventName === "usage_row_toggled") {
    return Boolean(
      event.action && allowedValues.action.has(event.action)
      && event.position && allowedValues.position.has(event.position)
      && event.trend && allowedValues.trend.has(event.trend)
      && event.coverage && allowedValues.coverage.has(event.coverage)
      && event.window && allowedValues.window.has(event.window),
    );
  }
  return event.eventName === "usage_filters_reset"
    && typeof event.hadTeam === "boolean"
    && typeof event.hadPosition === "boolean"
    && typeof event.hadGame === "boolean"
    && Boolean(event.window && allowedValues.window.has(event.window));
}

export function parseUsageAnalyticsEvent(input: unknown): UsageAnalyticsEventInput | null {
  const parsed = CaptureUsageAnalyticsEventBody.safeParse(input);
  return parsed.success && eventIsCoherent(parsed.data) ? parsed.data : null;
}

router.post("/analytics/usage-event", async (req, res): Promise<void> => {
  if (!getAuth(req).userId) {
    res.status(401).json({ error: "Authentication required." });
    return;
  }
  const event = parseUsageAnalyticsEvent(req.body);
  if (!event) {
    res.status(400).json({ error: "Invalid Usage Lab analytics event." });
    return;
  }

  await db.insert(usageAnalyticsEventsTable).values({
    eventName: event.eventName,
    filter: event.filter,
    value: event.value,
    column: event.column,
    direction: event.direction,
    action: event.action,
    position: event.position,
    trend: event.trend,
    coverage: event.coverage,
    window: event.window,
    hadTeam: event.hadTeam,
    hadPosition: event.hadPosition,
    hadGame: event.hadGame,
  });
  res.status(204).end();
});

router.get("/admin/usage-analytics", requireAdmin, async (_req, res): Promise<void> => {
  const periodEnd = new Date();
  const periodStart = new Date(periodEnd.getTime() - PERIOD_DAYS * 24 * 60 * 60 * 1000);
  const inPeriod = gte(usageAnalyticsEventsTable.createdAt, periodStart);
  const expansions = and(
    inPeriod,
    eq(usageAnalyticsEventsTable.eventName, "usage_row_toggled"),
    eq(usageAnalyticsEventsTable.action, "expand"),
  );

  const groupCounts = async (
    column: AnyPgColumn,
  ) => db.select({ label: column, count: count() })
    .from(usageAnalyticsEventsTable)
    .where(and(expansions, sql`${column} is not null`))
    .groupBy(column)
    .orderBy(desc(count()));

  const [
    totals,
    filterChanges,
    sortChoices,
    expansionsByPosition,
    expansionsByTrend,
    expansionsByCoverage,
    expansionsByWindow,
    resets,
  ] = await Promise.all([
    db.select({ count: count() }).from(usageAnalyticsEventsTable).where(inPeriod),
    db.select({
      label: usageAnalyticsEventsTable.filter,
      choice: usageAnalyticsEventsTable.value,
      count: count(),
    }).from(usageAnalyticsEventsTable)
      .where(and(inPeriod, eq(usageAnalyticsEventsTable.eventName, "usage_filter_changed")))
      .groupBy(usageAnalyticsEventsTable.filter, usageAnalyticsEventsTable.value)
      .orderBy(desc(count())),
    db.select({
      label: usageAnalyticsEventsTable.column,
      choice: usageAnalyticsEventsTable.direction,
      count: count(),
    }).from(usageAnalyticsEventsTable)
      .where(and(inPeriod, eq(usageAnalyticsEventsTable.eventName, "usage_sort_changed")))
      .groupBy(usageAnalyticsEventsTable.column, usageAnalyticsEventsTable.direction)
      .orderBy(desc(count())),
    groupCounts(usageAnalyticsEventsTable.position),
    groupCounts(usageAnalyticsEventsTable.trend),
    groupCounts(usageAnalyticsEventsTable.coverage),
    groupCounts(usageAnalyticsEventsTable.window),
    db.select({ count: count() }).from(usageAnalyticsEventsTable)
      .where(and(inPeriod, eq(usageAnalyticsEventsTable.eventName, "usage_filters_reset"))),
  ]);

  const counts = (rows: Array<{ label: string | null; count: number }>) =>
    rows.filter((row): row is { label: string; count: number } => row.label !== null);
  const choices = (rows: Array<{ label: string | null; choice: string | null; count: number }>) =>
    rows.filter((row): row is { label: string; choice: string; count: number } => row.label !== null && row.choice !== null);

  res.json(GetUsageAnalyticsSummaryResponse.parse({
    periodStart,
    periodEnd,
    periodDays: PERIOD_DAYS,
    totalEvents: totals[0]?.count ?? 0,
    filterChanges: choices(filterChanges),
    sortChoices: choices(sortChoices),
    expansionsByPosition: counts(expansionsByPosition),
    expansionsByTrend: counts(expansionsByTrend),
    expansionsByCoverage: counts(expansionsByCoverage),
    expansionsByWindow: counts(expansionsByWindow),
    resets: resets[0]?.count ?? 0,
  }));
});

export default router;