import { Router, type IRouter } from "express";
import { getAuth } from "@clerk/express";
import { and, count, desc, eq, gte, sql } from "drizzle-orm";
import type { AnyPgColumn } from "drizzle-orm/pg-core";
import {
  CaptureUsageAnalyticsEventBody,
  GetUsageAnalyticsSummaryQueryParams,
  GetUsageAnalyticsSummaryResponse,
} from "@workspace/api-zod";
import { db, usageAnalyticsEventsTable } from "@workspace/db";
import { requireAdmin } from "../middlewares/admin";

const router: IRouter = Router();
const PERIOD_DAYS_BY_KEY = {
  "7d": 7,
  "14d": 14,
  "30d": 30,
} as const;
const DEFAULT_PERIOD = "7d";
const DAY_IN_MS = 24 * 60 * 60 * 1000;
type UsageAnalyticsPeriod = keyof typeof PERIOD_DAYS_BY_KEY;
type UsageAnalyticsEventInput = ReturnType<typeof CaptureUsageAnalyticsEventBody.parse>;

const allowedValues = {
  filter: new Set(["team", "position", "window", "game"]),
  direction: new Set(["asc", "desc"]),
  action: new Set(["expand", "collapse"]),
  position: new Set(["QB", "RB", "WR", "TE", "unknown"]),
  trend: new Set(["up", "down", "flat", "unavailable"]),
  coverage: new Set(["complete", "partial"]),
  window: new Set(["last3", "last5", "last8", "season"]),
  sortColumn: new Set(["name", "primaryVolume", "primaryYards", "snapShare", "targets", "receptions", "receivingYards", "carries", "rushingYards", "totalTd", "trend"]),
  team: new Set(["all", "ARI", "ATL", "BAL", "BUF", "CAR", "CHI", "CIN", "CLE", "DAL", "DEN", "DET", "GB", "HOU", "IND", "JAX", "KC", "LV", "LAC", "LAR", "MIA", "MIN", "NE", "NO", "NYG", "NYJ", "PHI", "PIT", "SEA", "SF", "TB", "TEN", "WAS"]),
  filterPosition: new Set(["all", "QB", "RB", "WR", "TE"]),
  filterWindow: new Set(["all", "last3", "last5", "last8", "season"]),
  filterGame: new Set(["all", "specific_game"]),
};

function allowedKeysForEvent(eventName: unknown): readonly string[] | null {
  switch (eventName) {
    case "usage_filter_changed":
      return ["eventName", "filter", "value"];
    case "usage_sort_changed":
      return ["eventName", "column", "direction"];
    case "usage_row_toggled":
      return ["eventName", "action", "position", "trend", "coverage", "window"];
    case "usage_filters_reset":
      return ["eventName", "hadTeam", "hadPosition", "hadGame", "window"];
    default:
      return null;
  }
}

function hasOnlyAllowedEventKeys(input: unknown): boolean {
  if (!input || typeof input !== "object" || Array.isArray(input)) return false;
  const rawEvent = input as Record<string, unknown>;
  const allowedKeys = allowedKeysForEvent(rawEvent.eventName);
  return allowedKeys !== null
    && Object.keys(rawEvent).every((key) => allowedKeys.includes(key));
}

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
  if (!hasOnlyAllowedEventKeys(input)) return null;
  const parsed = CaptureUsageAnalyticsEventBody.safeParse(input);
  return parsed.success && eventIsCoherent(parsed.data) ? parsed.data : null;
}

type UsageAnalyticsDatabase = typeof db;

export async function getUsageAnalyticsSummary(
  database: UsageAnalyticsDatabase = db,
  periodKey: UsageAnalyticsPeriod = DEFAULT_PERIOD,
  periodEnd = new Date(),
) {
  const periodDays = PERIOD_DAYS_BY_KEY[periodKey];
  const periodStart = new Date(Date.UTC(
    periodEnd.getUTCFullYear(),
    periodEnd.getUTCMonth(),
    periodEnd.getUTCDate() - periodDays + 1,
  ));
  const inPeriod = gte(usageAnalyticsEventsTable.createdAt, periodStart);
  const expansions = and(
    inPeriod,
    eq(usageAnalyticsEventsTable.eventName, "usage_row_toggled"),
    eq(usageAnalyticsEventsTable.action, "expand"),
  );
  const day = sql<string>`to_char(${usageAnalyticsEventsTable.createdAt} AT TIME ZONE 'UTC', 'YYYY-MM-DD')`;

  const groupCounts = async (
    column: AnyPgColumn,
  ) => database.select({ label: column, count: count() })
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
    dailyRows,
  ] = await Promise.all([
    database.select({ count: count() }).from(usageAnalyticsEventsTable).where(inPeriod),
    database.select({
      label: usageAnalyticsEventsTable.filter,
      choice: usageAnalyticsEventsTable.value,
      count: count(),
    }).from(usageAnalyticsEventsTable)
      .where(and(inPeriod, eq(usageAnalyticsEventsTable.eventName, "usage_filter_changed")))
      .groupBy(usageAnalyticsEventsTable.filter, usageAnalyticsEventsTable.value)
      .orderBy(desc(count())),
    database.select({
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
    database.select({ count: count() }).from(usageAnalyticsEventsTable)
      .where(and(inPeriod, eq(usageAnalyticsEventsTable.eventName, "usage_filters_reset"))),
    database.select({
      date: day,
      eventCount: sql<number>`count(*)::int`,
      rowExpansionCount: sql<number>`count(*) filter (where ${usageAnalyticsEventsTable.eventName} = 'usage_row_toggled' and ${usageAnalyticsEventsTable.action} = 'expand')::int`,
    }).from(usageAnalyticsEventsTable)
      .where(inPeriod)
      .groupBy(day)
      .orderBy(day),
  ]);

  const counts = (rows: Array<{ label: string | null; count: number }>) =>
    rows.filter((row): row is { label: string; count: number } => row.label !== null);
  const choices = (rows: Array<{ label: string | null; choice: string | null; count: number }>) =>
    rows.filter((row): row is { label: string; choice: string; count: number } => row.label !== null && row.choice !== null);
  const observedDays = new Map(dailyRows.map((row) => [row.date, row]));
  const dailyTrends = Array.from({ length: periodDays }, (_, index) => {
    const date = new Date(periodStart.getTime() + index * DAY_IN_MS).toISOString().slice(0, 10);
    const row = observedDays.get(date);
    return {
      date,
      eventCount: row?.eventCount ?? 0,
      rowExpansionCount: row?.rowExpansionCount ?? 0,
    };
  });
  const daysWithActivity = dailyTrends.filter((row) => row.eventCount > 0).length;
  const collectionStatus = totals[0]?.count
    ? daysWithActivity === periodDays ? "complete" : "partial"
    : "empty";

  return GetUsageAnalyticsSummaryResponse.parse({
    periodStart,
    periodEnd,
    periodDays,
    collectionStatus,
    daysWithActivity,
    dailyTrends,
    totalEvents: totals[0]?.count ?? 0,
    filterChanges: choices(filterChanges),
    sortChoices: choices(sortChoices),
    expansionsByPosition: counts(expansionsByPosition),
    expansionsByTrend: counts(expansionsByTrend),
    expansionsByCoverage: counts(expansionsByCoverage),
    expansionsByWindow: counts(expansionsByWindow),
    resets: resets[0]?.count ?? 0,
  });
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

router.get("/admin/usage-analytics", requireAdmin, async (req, res): Promise<void> => {
  const parsedParams = GetUsageAnalyticsSummaryQueryParams.safeParse(req.query);
  if (!parsedParams.success) {
    res.status(400).json({ error: parsedParams.error.message });
    return;
  }
  const summary = await getUsageAnalyticsSummary(db, parsedParams.data.period);
  res.json({
    ...summary,
    dailyTrends: summary.dailyTrends.map((row) => ({
      ...row,
      date: row.date.toISOString().slice(0, 10),
    })),
  });
});

export default router;