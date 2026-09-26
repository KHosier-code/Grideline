import { randomUUID } from "node:crypto";
import {
  and,
  asc,
  desc,
  eq,
  isNull,
  lte,
  lt,
  or,
  sql,
} from "drizzle-orm";
import {
  dataSyncRunsTable,
  db,
  gamesTable,
  oddsApiRequestsTable,
  predictionSnapshotsTable,
  schedulerJobsTable,
} from "@workspace/db";
import { syncEspnInjuries } from "./availability";
import { sleeperSyncIntervalMs, syncSleeperPlayers } from "./sleeper";
import { refreshSleeperIdentityMappings } from "./sleeper-identity";
import { refreshPlayerIdentityCrosswalk, syncNflversePlayers } from "./nflverse-players";
import { syncNflverseHistory } from "./nflverse";
import { rebuildPregameFeatures } from "./features";
import { rebuildPregamePersonnelContextFeatures } from "./personnel-context";
import {
  captureOddsSnapshots,
  oddsCaptureIntervalMinutes,
  oddsCaptureQuotaDecision,
  oddsCaptureRequestCount,
} from "./odds";
import { syncEspnScheduleCoverage } from "./schedule";
import { freezeOfficialFinalPredictions, generateLivePredictions, generateWeeklyLearningReport, gradeCompletedPredictions } from "./live-predictions";
import { trainPhase4Models } from "./modeling";
import { logger } from "./logger";
import { captureConfidenceResults } from "./confidence-capture";

export const FOOTBALL_TIMEZONE = "America/New_York";
const LOCK_TTL_MS = 2 * 60 * 60 * 1000;
const TICK_MS = 60 * 1000;
const SCHEDULE_INTERVAL_MS = 30 * 60 * 1000;
const PERSONNEL_CONTEXT_INTERVAL_MS = 30 * 60 * 1000;
const FEATURE_REPAIR_INTERVAL_MS = 30 * 60 * 1000;
const ADAPTIVE_ODDS_CADENCE = "adaptive: established weekly cadence >6h; 12m 6-1h; 5m final hour when quota-safe";
export const SCHEDULER_OVERDUE_GRACE_MS = 2 * TICK_MS;
export const REPEATED_FAILURE_THRESHOLD = 3;
export const CONFIDENCE_CAPTURE_OFFSETS = [
  { key: "24h", minutes: 24 * 60 },
  { key: "6h", minutes: 6 * 60 },
  { key: "75m", minutes: 75 },
] as const;

type SchedulerHealthJob = {
  jobKey: string;
  enabled: boolean;
  nextRunAt: Date | null;
  lockOwner: string | null;
  lockUntil: Date | null;
};

type SchedulerHealthRun = {
  jobKey: string | null;
  status: string;
};

export type SchedulerAlert = {
  code: "overdue" | "overdue_locked" | "expired_lock" | "last_run_failed" | "repeated_failures";
  severity: "warning" | "critical";
  jobKey: string;
  detail: string;
  overdueByMs?: number;
  consecutiveFailures?: number;
  lockUntil?: string | null;
};

export function classifySchedulerAlerts(
  jobs: SchedulerHealthJob[],
  runs: SchedulerHealthRun[],
  now = new Date(),
): SchedulerAlert[] {
  const alerts: SchedulerAlert[] = [];
  const runsByJob = new Map<string, SchedulerHealthRun[]>();
  for (const run of runs) {
    if (!run.jobKey) continue;
    const jobRuns = runsByJob.get(run.jobKey) ?? [];
    jobRuns.push(run);
    runsByJob.set(run.jobKey, jobRuns);
  }

  for (const job of jobs) {
    const jobRuns = runsByJob.get(job.jobKey) ?? [];
    let consecutiveFailures = 0;
    for (const run of jobRuns) {
      if (run.status !== "failed") break;
      consecutiveFailures += 1;
    }
    if (consecutiveFailures >= REPEATED_FAILURE_THRESHOLD) {
      alerts.push({
        code: "repeated_failures",
        severity: "critical",
        jobKey: job.jobKey,
        detail: `The job has failed ${consecutiveFailures} consecutive times.`,
        consecutiveFailures,
      });
    } else if (jobRuns[0]?.status === "failed") {
      alerts.push({
        code: "last_run_failed",
        severity: "warning",
        jobKey: job.jobKey,
        detail: "The most recent scheduled run failed.",
        consecutiveFailures: 1,
      });
    }
    if (!job.enabled) continue;
    const overdueByMs = job.nextRunAt ? now.getTime() - job.nextRunAt.getTime() : 0;
    const hasLock = Boolean(job.lockOwner || job.lockUntil);
    const lockIsExpired = Boolean(job.lockUntil && job.lockUntil.getTime() <= now.getTime());

    if (lockIsExpired) {
      alerts.push({
        code: "expired_lock",
        severity: "critical",
        jobKey: job.jobKey,
        detail: "The scheduler lease expired without being cleared.",
        lockUntil: job.lockUntil?.toISOString() ?? null,
      });
    }
    if (job.nextRunAt && overdueByMs > SCHEDULER_OVERDUE_GRACE_MS) {
      alerts.push({
        code: hasLock && !lockIsExpired ? "overdue_locked" : "overdue",
        severity: lockIsExpired ? "critical" : "warning",
        jobKey: job.jobKey,
        detail: hasLock && !lockIsExpired
          ? "The job remains locked after its scheduled time."
          : "The enabled job has not advanced past its scheduled time.",
        overdueByMs,
        lockUntil: job.lockUntil?.toISOString() ?? null,
      });
    }

  }
  return alerts.sort((left, right) =>
    (left.severity === right.severity ? 0 : left.severity === "critical" ? -1 : 1)
    || left.jobKey.localeCompare(right.jobKey)
    || left.code.localeCompare(right.code));
}

type WeeklyDefinition = {
  jobKey: string;
  provider: string;
  kind: string;
  cadence: string;
  weekday: number;
  hour: number;
  minute: number;
};

/**
 * These are deliberately concrete weekly slots. Dynamic Sunday/Monday slots
 * are calculated from persisted kickoff times below, not from a fixed UTC
 * offset, so the schedule remains correct over DST.
 */
export const ODDS_WEEKLY_SLOTS: WeeklyDefinition[] = [
  { jobKey: "odds-tuesday", provider: "odds-api", kind: "odds", cadence: "weekly Tue 10:00 ET", weekday: 2, hour: 10, minute: 0 },
  { jobKey: "odds-thursday", provider: "odds-api", kind: "odds", cadence: "weekly Thu 10:00 ET", weekday: 4, hour: 10, minute: 0 },
  { jobKey: "odds-saturday", provider: "odds-api", kind: "odds", cadence: "weekly Sat 10:00 ET", weekday: 6, hour: 10, minute: 0 },
  { jobKey: "odds-sunday-morning", provider: "odds-api", kind: "odds", cadence: "weekly Sun 08:00 ET", weekday: 0, hour: 8, minute: 0 },
  { jobKey: "odds-sunday-late-morning", provider: "odds-api", kind: "odds", cadence: "weekly Sun 11:00 ET", weekday: 0, hour: 11, minute: 0 },
  { jobKey: "odds-sunday-final", provider: "odds-api", kind: "odds-dynamic", cadence: "weekly Sun 45m before earliest Sunday kickoff", weekday: 0, hour: 0, minute: 0 },
  { jobKey: "odds-monday-final", provider: "odds-api", kind: "odds-dynamic", cadence: "weekly Mon 45m before MNF", weekday: 1, hour: 0, minute: 0 },
];

export const INJURY_WEEKLY_SLOTS: WeeklyDefinition[] = [
  { jobKey: "injury-tuesday", provider: "espn-injuries", kind: "injury", cadence: "weekly Tue 10:00 ET", weekday: 2, hour: 10, minute: 0 },
  { jobKey: "injury-wednesday", provider: "espn-injuries", kind: "injury", cadence: "weekly Wed 12:00 ET", weekday: 3, hour: 12, minute: 0 },
  { jobKey: "injury-thursday-morning", provider: "espn-injuries", kind: "injury", cadence: "weekly Thu 09:00 ET", weekday: 4, hour: 9, minute: 0 },
  { jobKey: "injury-thursday-afternoon", provider: "espn-injuries", kind: "injury", cadence: "weekly Thu 15:00 ET", weekday: 4, hour: 15, minute: 0 },
  { jobKey: "injury-friday-morning", provider: "espn-injuries", kind: "injury", cadence: "weekly Fri 09:00 ET", weekday: 5, hour: 9, minute: 0 },
  { jobKey: "injury-friday-afternoon", provider: "espn-injuries", kind: "injury", cadence: "weekly Fri 15:00 ET", weekday: 5, hour: 15, minute: 0 },
  { jobKey: "injury-saturday", provider: "espn-injuries", kind: "injury", cadence: "weekly Sat 12:00 ET", weekday: 6, hour: 12, minute: 0 },
  { jobKey: "injury-sunday-morning", provider: "espn-injuries", kind: "injury", cadence: "weekly Sun 08:00 ET", weekday: 0, hour: 8, minute: 0 },
  { jobKey: "injury-sunday-late-morning", provider: "espn-injuries", kind: "injury", cadence: "weekly Sun 11:00 ET", weekday: 0, hour: 11, minute: 0 },
  { jobKey: "injury-monday-final", provider: "espn-injuries", kind: "injury-dynamic", cadence: "weekly Mon 75m before MNF", weekday: 1, hour: 0, minute: 0 },
];

export const PREDICTION_WEEKLY_SLOTS: WeeklyDefinition[] = [
  { jobKey: "predictions-tuesday", provider: "gridline-model", kind: "prediction", cadence: "weekly Tue 11:00 ET", weekday: 2, hour: 11, minute: 0 },
  { jobKey: "predictions-thursday", provider: "gridline-model", kind: "prediction", cadence: "weekly Thu 12:00 ET", weekday: 4, hour: 12, minute: 0 },
  { jobKey: "predictions-friday", provider: "gridline-model", kind: "prediction", cadence: "weekly Fri 12:00 ET", weekday: 5, hour: 12, minute: 0 },
  { jobKey: "predictions-saturday", provider: "gridline-model", kind: "prediction", cadence: "weekly Sat 12:00 ET", weekday: 6, hour: 12, minute: 0 },
  { jobKey: "predictions-sunday", provider: "gridline-model", kind: "prediction", cadence: "weekly Sun 11:00 ET", weekday: 0, hour: 11, minute: 0 },
  { jobKey: "predictions-grade", provider: "gridline-model", kind: "prediction-grade", cadence: "weekly Mon 05:00 ET", weekday: 1, hour: 5, minute: 0 },
  { jobKey: "models-challenger-weekly", provider: "gridline-model", kind: "model-challenger", cadence: "weekly Tue 04:30 ET after completed games", weekday: 2, hour: 4, minute: 30 },
];

// Odds are deliberately not fixed weekly slots: the paid feed follows the
// nearest persisted kickoff and the quota admission policy below.
const ALL_WEEKLY_SLOTS = [...INJURY_WEEKLY_SLOTS, ...PREDICTION_WEEKLY_SLOTS];

function lockExpired(lockUntil: Date | null, now: Date) {
  return !lockUntil || lockUntil.getTime() <= now.getTime();
}

export function shouldRecoverMissedOccurrence(
  nextRunAt: Date | null,
  lockUntil: Date | null,
  now: Date,
) {
  return Boolean(nextRunAt && nextRunAt.getTime() <= now.getTime() && lockExpired(lockUntil, now));
}

export function shouldRearmDynamicOccurrence(
  candidate: Date,
  existingNextRunAt: Date | null,
  lastRunAt: Date | null,
  now: Date,
) {
  return candidate.getTime() > now.getTime() &&
    (!lastRunAt || candidate.getTime() > lastRunAt.getTime()) &&
    (!existingNextRunAt || Math.abs(existingNextRunAt.getTime() - candidate.getTime()) > 60_000);
}

export type SundayKickoffWindow = {
  key: string;
  bucket: "early" | "late" | "snf";
  kickoffTime: Date;
  gameIds: string[];
};

function sundayKickoffBucket(kickoffTime: Date) {
  const hour = timeParts(kickoffTime).hour;
  return hour < 15 ? "early" as const : hour < 19 ? "late" as const : "snf" as const;
}

export function groupSundayKickoffWindows(
  games: Array<{ gameId: string; kickoffTime: Date }>,
): SundayKickoffWindow[] {
  const grouped = new Map<string, SundayKickoffWindow>();
  for (const game of games) {
    const local = timeParts(game.kickoffTime);
    if (local.weekday !== 0) continue;
    const bucket = sundayKickoffBucket(game.kickoffTime);
    const key = `injury-sunday-window-${local.year}-${String(local.month).padStart(2, "0")}-${String(local.day).padStart(2, "0")}-${bucket}`;
    const existing = grouped.get(key);
    if (!existing) {
      grouped.set(key, { key, bucket, kickoffTime: game.kickoffTime, gameIds: [game.gameId] });
    } else {
      existing.kickoffTime = new Date(Math.min(existing.kickoffTime.getTime(), game.kickoffTime.getTime()));
      existing.gameIds.push(game.gameId);
    }
  }
  return [...grouped.values()].sort((left, right) => left.kickoffTime.getTime() - right.kickoffTime.getTime());
}

export function confidenceCaptureOccurrences(gameId: string, kickoffTime: Date) {
  return CONFIDENCE_CAPTURE_OFFSETS.map((offset) => ({
    jobKey: `confidence-${offset.key}-${gameId}`,
    offsetKey: offset.key,
    scheduledFor: new Date(kickoffTime.getTime() - offset.minutes * 60_000),
  }));
}

export function canonicalPredictionOccurrence(gameId: string, kickoffTime: Date) {
  return {
    jobKey: `prediction-canonical-${gameId}`,
    scheduledFor: new Date(kickoffTime.getTime() - 30 * 60_000),
    cutoffMinutes: 30,
  };
}

/** A freeze is a one-shot tied to its game, never a recurring interval. */
export function freezeGameId(job: { kind: string; jobKey: string }): string | null {
  const prefix = job.kind === "prediction-freeze" ? "prediction-freeze-"
    : job.kind === "prediction-canonical" ? "prediction-canonical-" : "";
  return prefix && job.jobKey.startsWith(prefix) && job.jobKey.length > prefix.length
    ? job.jobKey.slice(prefix.length) : null;
}

export function expiredFreezeReason(
  job: { kind: string; jobKey: string; nextRunAt: Date | null },
  kickoff: Date | null,
  now: Date,
): string | null {
  if (job.kind !== "prediction-freeze" && job.kind !== "prediction-canonical") return null;
  if (!freezeGameId(job)) return "Invalid freeze game key; no late lock was attempted.";
  if (!kickoff) return "Freeze game or authoritative kickoff is missing; no late lock was attempted.";
  if (kickoff <= now) return "Authoritative kickoff elapsed; historical freeze retired without a late lock.";
  if (!job.nextRunAt || job.nextRunAt <= now) {
    return "Freeze occurrence elapsed while the worker was stopped; no catch-up lock was attempted.";
  }
  return null;
}

export function lateClaimedFreezeReason(
  job: { kind: string; jobKey: string; nextRunAt: Date | null },
  kickoff: Date | null,
  now: Date,
) {
  if (!freezeGameId(job)) return "Invalid freeze game key; no late lock was attempted.";
  if (!kickoff || kickoff <= now) return "Authoritative kickoff elapsed or is missing; no late lock was attempted.";
  if (!job.nextRunAt || now.getTime() - job.nextRunAt.getTime() > SCHEDULER_OVERDUE_GRACE_MS)
    return "Freeze occurrence missed its allowed claim window; no late lock was attempted.";
  return null;
}

export function shouldRetireFlexedConfidenceOccurrence(
  existingNextRunAt: Date | null,
  recalculatedOccurrence: Date,
  now: Date,
) {
  return recalculatedOccurrence.getTime() <= now.getTime()
    && Boolean(existingNextRunAt)
    && Math.abs(existingNextRunAt!.getTime() - recalculatedOccurrence.getTime()) > 60_000;
}

function confidenceGameId(jobKey: string) {
  for (const offset of CONFIDENCE_CAPTURE_OFFSETS) {
    const prefix = `confidence-${offset.key}-`;
    if (jobKey.startsWith(prefix)) return jobKey.slice(prefix.length);
  }
  return null;
}

let timer: NodeJS.Timeout | null = null;
let schedulerStartedAt: Date | null = null;
let tickInFlight: Promise<void> | null = null;

type TimeParts = {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  weekday: number;
};

function timeParts(date: Date, timezone = FOOTBALL_TIMEZONE): TimeParts {
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    year: "numeric",
    month: "numeric",
    day: "numeric",
    hour: "numeric",
    minute: "numeric",
    hourCycle: "h23",
    weekday: "short",
  });
  const values = Object.fromEntries(formatter.formatToParts(date).map((part) => [part.type, part.value]));
  const weekday = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(values.weekday);
  return {
    year: Number(values.year),
    month: Number(values.month),
    day: Number(values.day),
    hour: Number(values.hour),
    minute: Number(values.minute),
    weekday: weekday < 0 ? 0 : weekday,
  };
}

/**
 * Convert a wall-clock football time to UTC by asking Intl for the actual
 * offset. This handles both EST/EDT and avoids a hand-written DST table.
 */
export function zonedTimeToUtc(
  local: { year: number; month: number; day: number; hour: number; minute: number },
  timezone = FOOTBALL_TIMEZONE,
) {
  let guess = Date.UTC(local.year, local.month - 1, local.day, local.hour, local.minute);
  for (let iteration = 0; iteration < 3; iteration += 1) {
    const actual = timeParts(new Date(guess), timezone);
    const asUtc = Date.UTC(actual.year, actual.month - 1, actual.day, actual.hour, actual.minute);
    guess += Date.UTC(local.year, local.month - 1, local.day, local.hour, local.minute) - asUtc;
  }
  return new Date(guess);
}

function localDateWithOffset(date: Date, days: number) {
  const local = timeParts(date);
  const midnight = new Date(Date.UTC(local.year, local.month - 1, local.day + days));
  return {
    year: midnight.getUTCFullYear(),
    month: midnight.getUTCMonth() + 1,
    day: midnight.getUTCDate(),
  };
}

export function nextWeeklyOccurrence(
  now: Date,
  weekday: number,
  hour: number,
  minute: number,
  timezone = FOOTBALL_TIMEZONE,
) {
  const local = timeParts(now, timezone);
  for (let offset = 0; offset <= 8; offset += 1) {
    const date = localDateWithOffset(now, offset);
    const candidate = zonedTimeToUtc({ ...date, hour, minute }, timezone);
    const candidateWeekday = timeParts(candidate, timezone).weekday;
    if (candidateWeekday === weekday && candidate.getTime() > now.getTime()) return candidate;
  }
  throw new Error("Unable to calculate the next weekly scheduler occurrence");
}

function nextIntervalOccurrence(now: Date) {
  return new Date(now.getTime() + SCHEDULE_INTERVAL_MS);
}

function isFinishedStatus(status: string) {
  const normalized = status.toLowerCase();
  return normalized.includes("final") ||
    normalized.includes("completed") ||
    normalized.includes("postponed") ||
    normalized.includes("canceled");
}

async function nextKickoffOccurrence(now: Date, weekday: number, offsetMinutes: number) {
  // A dynamic slot is only meaningful if the corresponding weekday is
  // represented in the persisted schedule. Find the first matching game.
  const rows = await db
    .select({ kickoffTime: gamesTable.kickoffTime, gameStatus: gamesTable.gameStatus })
    .from(gamesTable)
    .where(and(
      sql`${gamesTable.kickoffTime} is not null`,
      sql`${gamesTable.kickoffTime} > ${now}`,
    ))
    .orderBy(asc(gamesTable.kickoffTime));
  for (const row of rows) {
    if (!row.kickoffTime || isFinishedStatus(row.gameStatus)) continue;
    if (timeParts(row.kickoffTime).weekday !== weekday) continue;
    const candidate = new Date(row.kickoffTime.getTime() - offsetMinutes * 60_000);
    if (candidate.getTime() > now.getTime()) return candidate;
  }
  // Keep a missed dynamic slot from becoming a startup catch-up call.
  return nextWeeklyOccurrence(now, weekday, weekday === 0 ? 8 : 18, 0);
}

async function nextOccurrence(definition: WeeklyDefinition, now: Date) {
  if (definition.kind === "odds-dynamic") {
    return nextKickoffOccurrence(now, definition.weekday, 45);
  }
  if (definition.kind === "injury-dynamic") {
    return nextKickoffOccurrence(now, definition.weekday, 75);
  }
  return nextWeeklyOccurrence(now, definition.weekday, definition.hour, definition.minute);
}

async function recordSchedulerSkip(
  provider: string,
  jobKey: string,
  scheduledFor: Date | null,
  skipReason: string,
) {
  await db.insert(dataSyncRunsTable).values({
    provider,
    status: "skipped",
    jobKey,
    scheduledFor,
    completedAt: new Date(),
    skipReason,
    errorMessage: skipReason,
    metadata: { skipReason, scheduler: true },
  });
}

async function ensureWeeklyJobs(now: Date) {
  for (const definition of ALL_WEEKLY_SLOTS) {
    const nextRunAt = await nextOccurrence(definition, now);
    const [existing] = await db
      .select()
      .from(schedulerJobsTable)
      .where(eq(schedulerJobsTable.jobKey, definition.jobKey))
      .limit(1);
    if (!existing) {
      await db.insert(schedulerJobsTable).values({
        jobKey: definition.jobKey,
        provider: definition.provider,
        kind: definition.kind,
        timezone: FOOTBALL_TIMEZONE,
        cadence: definition.cadence,
        nextRunAt,
      });
      continue;
    }
    if (
      (definition.kind === "odds-dynamic" || definition.kind === "injury-dynamic") &&
      lockExpired(existing.lockUntil, now) &&
      existing.nextRunAt &&
      shouldRearmDynamicOccurrence(nextRunAt, existing.nextRunAt, existing.lastRunAt, now)
    ) {
      if (existing.enabled && existing.nextRunAt <= now) {
        await recordSchedulerSkip(existing.provider, existing.jobKey, existing.nextRunAt,
          "Missed kickoff-relative slot retired during startup reconciliation; no catch-up request was made.");
      }
      await db.update(schedulerJobsTable)
        .set({
          nextRunAt, updatedAt: now,
          lastScheduledAt: existing.nextRunAt <= now ? existing.nextRunAt : existing.lastScheduledAt,
          lastStatus: existing.nextRunAt <= now ? "skipped" : existing.lastStatus,
          lastError: "Kickoff-relative slot recalculated from the latest persisted schedule.",
        })
        .where(eq(schedulerJobsTable.jobKey, existing.jobKey));
      continue;
    }
  }
}

async function ensureScheduleJob(now: Date) {
  const [existing] = await db
    .select()
    .from(schedulerJobsTable)
    .where(eq(schedulerJobsTable.jobKey, "espn-schedule"))
    .limit(1);
  const nextRunAt = existing?.nextRunAt && existing.nextRunAt.getTime() > now.getTime()
    ? existing.nextRunAt
    : existing
      ? nextIntervalOccurrence(now)
      : new Date(now.getTime() + TICK_MS);
  if (!existing) {
    await db.insert(schedulerJobsTable).values({
      jobKey: "espn-schedule",
      provider: "espn-schedule",
      kind: "schedule",
      timezone: FOOTBALL_TIMEZONE,
      cadence: "every 30 minutes; current + 2 future and unfinished prior",
      nextRunAt,
    });
  }
}

async function ensureAdaptiveOddsJob(now: Date) {
  const jobKey = "odds-adaptive";
  const [existing] = await db.select().from(schedulerJobsTable)
    .where(eq(schedulerJobsTable.jobKey, jobKey)).limit(1);
  const calculatedNextRunAt = await nextAdaptiveOddsOccurrence(now);
  const update = existing
    ? adaptiveOddsJobReconciliation(existing, calculatedNextRunAt, now)
    : null;
  const nextRunAt = existing && !update ? existing.nextRunAt : calculatedNextRunAt;
  // Retire the former fixed weekly paid-feed rows. Their history remains
  // intact, but only this durable adaptive owner may issue future requests.
  const legacyJobs = await db.select({ jobKey: schedulerJobsTable.jobKey })
    .from(schedulerJobsTable)
    .where(and(eq(schedulerJobsTable.provider, "odds-api"), sql`${schedulerJobsTable.jobKey} <> ${jobKey}`));
  for (const legacy of legacyJobs) {
    await db.update(schedulerJobsTable).set({
      enabled: false,
      nextRunAt: null,
      lastStatus: "skipped",
      lastError: "Retired in favor of the quota-safe adaptive odds worker.",
      updatedAt: now,
    }).where(eq(schedulerJobsTable.jobKey, legacy.jobKey));
  }
  if (!existing) {
    await db.insert(schedulerJobsTable).values({
      jobKey,
      provider: "odds-api",
      kind: "odds-adaptive",
      timezone: FOOTBALL_TIMEZONE,
      cadence: ADAPTIVE_ODDS_CADENCE,
      nextRunAt,
    });
  } else if (update) {
    // The nearest game can be inserted, flexed, or replaced while this
    // durable owner is idle. Persist the recalculation, including null -> a
    // real occurrence after a schedule reappears. Never move a leased row.
    await db.update(schedulerJobsTable)
      .set({
        ...update,
        updatedAt: now,
        lastError: calculatedNextRunAt
          ? "Adaptive odds occurrence recalculated from the latest persisted schedule."
          : "No unfinished future game exists; adaptive odds remains armed without a paid occurrence.",
      })
      .where(eq(schedulerJobsTable.jobKey, jobKey));
  }
}

export function adaptiveOddsJobReconciliation(
  existing: {
    enabled: boolean;
    nextRunAt: Date | null;
    lockUntil: Date | null;
    cadence: string;
  },
  calculatedNextRunAt: Date | null,
  now: Date,
) {
  if (existing.lockUntil && existing.lockUntil > now) return null;
  const cadenceChanged = existing.cadence !== ADAPTIVE_ODDS_CADENCE;
  // Never move a due occurrence forward during the worker's ensure pass; it
  // must remain claimable. A later kickoff can tolerate this one earlier
  // baseline observation, then normal post-run calculation follows the flex.
  if (existing.enabled && existing.nextRunAt && existing.nextRunAt <= now) {
    return cadenceChanged
      ? { enabled: true, nextRunAt: existing.nextRunAt, cadence: ADAPTIVE_ODDS_CADENCE }
      : null;
  }
  const shouldReplaceOccurrence = !existing.enabled
    || !existing.nextRunAt
    || calculatedNextRunAt === null
    || calculatedNextRunAt < existing.nextRunAt;
  if (!shouldReplaceOccurrence && !cadenceChanged) return null;
  return {
    enabled: true,
    nextRunAt: shouldReplaceOccurrence ? calculatedNextRunAt : existing.nextRunAt,
    cadence: ADAPTIVE_ODDS_CADENCE,
  };
}

async function nextAdaptiveOddsOccurrence(now: Date): Promise<Date | null> {
  const upcomingGames = await db.select({ kickoffTime: gamesTable.kickoffTime })
    .from(gamesTable)
    .where(and(
      sql`${gamesTable.kickoffTime} is not null`,
      sql`${gamesTable.kickoffTime} > ${now}`,
      sql`lower(${gamesTable.gameStatus}) not like '%final%' and lower(${gamesTable.gameStatus}) not like '%completed%' and lower(${gamesTable.gameStatus}) not like '%postponed%' and lower(${gamesTable.gameStatus}) not like '%canceled%'`,
    ))
    .orderBy(asc(gamesTable.kickoffTime))
    .limit(20);
  const [upcoming] = upcomingGames;
  if (!upcoming?.kickoffTime) return null;
  const hours = (upcoming.kickoffTime.getTime() - now.getTime()) / 3_600_000;
  if (hours > 6) {
    // Preserve the established low-frequency paid-feed cadence. The adaptive
    // owner only takes over inside the six-hour game window.
    const upcomingWeekdays = new Set(
      upcomingGames
        .filter((game): game is typeof game & { kickoffTime: Date } => Boolean(game.kickoffTime))
        .map((game) => timeParts(game.kickoffTime).weekday),
    );
    const candidates = await Promise.all(
      ODDS_WEEKLY_SLOTS
        .filter((definition) => definition.kind !== "odds-dynamic" || upcomingWeekdays.has(definition.weekday))
        .map((definition) => nextOccurrence(definition, now)),
    );
    const windowStart = new Date(upcoming.kickoffTime.getTime() - 6 * 3_600_000);
    return [...candidates, windowStart]
      .filter((candidate) => candidate > now)
      .sort((left, right) => left.getTime() - right.getTime())[0] ?? null;
  }
  return new Date(now.getTime() + oddsCaptureIntervalMinutes(hours) * 60_000);
}

async function ensureNflverseJob(now: Date) {
  const [existing] = await db
    .select()
    .from(schedulerJobsTable)
    .where(eq(schedulerJobsTable.jobKey, "nflverse-completed-window"))
    .limit(1);
  const nextRunAt = existing?.nextRunAt && existing.nextRunAt.getTime() > now.getTime()
    ? existing.nextRunAt
    : nextWeeklyOccurrence(now, 2, 4, 0);
  if (!existing) {
    await db.insert(schedulerJobsTable).values({
      jobKey: "nflverse-completed-window",
      provider: "nflverse",
      kind: "nflverse",
      timezone: FOOTBALL_TIMEZONE,
      cadence: "weekly Tue 04:00 ET after completed game windows",
      nextRunAt,
    });
  }
}

async function ensureSleeperJob(now: Date) {
  const jobKey = "sleeper-players";
  const [existing] = await db.select().from(schedulerJobsTable)
    .where(eq(schedulerJobsTable.jobKey, jobKey)).limit(1);
  const neverRun = Boolean(existing && !existing.lastRunAt && !existing.lastScheduledAt);
  const rearmSkippedInitialRun = Boolean(neverRun && existing?.lastStatus === "skipped");
  const initialRunAt = new Date(now.getTime() + TICK_MS);
  const nextRunAt = !existing || rearmSkippedInitialRun
    ? initialRunAt
    : existing?.nextRunAt && existing.nextRunAt.getTime() > now.getTime()
      ? existing.nextRunAt
      : now;
  if (!existing) {
    await db.insert(schedulerJobsTable).values({
      jobKey,
      provider: "sleeper-players",
      kind: "sleeper-players",
      timezone: FOOTBALL_TIMEZONE,
      cadence: `every ${sleeperSyncIntervalMs() / (60 * 60 * 1000)} hours`,
      nextRunAt,
    });
  } else if (
    rearmSkippedInitialRun
    || existing.cadence !== `every ${sleeperSyncIntervalMs() / (60 * 60 * 1000)} hours`
  ) {
    await db.update(schedulerJobsTable).set({
      cadence: `every ${sleeperSyncIntervalMs() / (60 * 60 * 1000)} hours`,
      ...(rearmSkippedInitialRun
        ? { nextRunAt, lastStatus: "pending", lastError: null }
        : {}),
      updatedAt: now,
    }).where(eq(schedulerJobsTable.jobKey, jobKey));
  }
}

async function ensurePersonnelContextJob(now: Date) {
  const jobKey = "pregame-v4-personnel-context";
  const [existing] = await db
    .select()
    .from(schedulerJobsTable)
    .where(eq(schedulerJobsTable.jobKey, jobKey))
    .limit(1);
  const nextRunAt = existing?.nextRunAt && existing.nextRunAt.getTime() > now.getTime()
    ? existing.nextRunAt
    : existing
      ? new Date(now.getTime() + PERSONNEL_CONTEXT_INTERVAL_MS)
      : new Date(now.getTime() + TICK_MS);
  if (!existing) {
    await db.insert(schedulerJobsTable).values({
      jobKey,
      provider: "phase7-personnel-context",
      kind: "personnel-context",
      timezone: FOOTBALL_TIMEZONE,
      cadence: "every 30 minutes for games still before kickoff",
      nextRunAt,
    });
  }
}

async function ensurePregameFeatureRepairJob(now: Date) {
  const jobKey = "pregame-v3-future-repair";
  const [existing] = await db
    .select()
    .from(schedulerJobsTable)
    .where(eq(schedulerJobsTable.jobKey, jobKey))
    .limit(1);
  const nextRunAt = existing?.nextRunAt && existing.nextRunAt.getTime() > now.getTime()
    ? existing.nextRunAt
    : new Date(now.getTime() + TICK_MS);
  if (!existing) {
    await db.insert(schedulerJobsTable).values({
      jobKey,
      provider: "pregame-features",
      kind: "pregame-feature-repair",
      timezone: FOOTBALL_TIMEZONE,
      cadence: "every 30 minutes for games still before kickoff",
      nextRunAt,
    });
  }
}

async function ensureKickoffJobs(now: Date) {
  const games = await db
    .select({ gameId: gamesTable.gameId, kickoffTime: gamesTable.kickoffTime, gameStatus: gamesTable.gameStatus })
    .from(gamesTable)
    .where(and(
      sql`${gamesTable.kickoffTime} is not null`,
      sql`${gamesTable.kickoffTime} > ${now}`,
    ));
  const windows = groupSundayKickoffWindows(
    games.filter((game): game is typeof game & { kickoffTime: Date } =>
      Boolean(game.kickoffTime) && !isFinishedStatus(game.gameStatus),
    ).map((game) => ({ gameId: game.gameId, kickoffTime: game.kickoffTime })),
  );
  const activeKeys = new Set(windows.map((window) => window.key));

  // Older builds created one job per Sunday game (or one global Sunday-final
  // job). Disable any such stale rows before creating the deduped windows.
  const oldJobs = await db
    .select()
    .from(schedulerJobsTable)
    .where(and(
      eq(schedulerJobsTable.enabled, true),
      or(
        eq(schedulerJobsTable.kind, "injury-kickoff"),
        eq(schedulerJobsTable.jobKey, "injury-sunday-final"),
      ),
    ));
  for (const job of oldJobs) {
    if (activeKeys.has(job.jobKey)) continue;
    if (job.nextRunAt && job.nextRunAt <= now) {
      await recordSchedulerSkip(job.provider, job.jobKey, job.nextRunAt,
        "Expired legacy kickoff injury window retired during startup reconciliation; no catch-up request was made.");
    }
    await db.update(schedulerJobsTable)
      .set({
        enabled: false,
        nextRunAt: null,
        lastScheduledAt: job.nextRunAt,
        lastStatus: job.nextRunAt && job.nextRunAt <= now ? "skipped" : job.lastStatus,
        lastError: "Replaced by deduped Sunday kickoff-window injury jobs.",
        updatedAt: now,
      })
      .where(eq(schedulerJobsTable.jobKey, job.jobKey));
  }

  for (const window of windows) {
    const nextRunAt = new Date(window.kickoffTime.getTime() - 75 * 60_000);
    const [existing] = await db
      .select()
      .from(schedulerJobsTable)
      .where(eq(schedulerJobsTable.jobKey, window.key))
      .limit(1);
    if (!existing) {
      await db.insert(schedulerJobsTable).values({
        jobKey: window.key,
        provider: "espn-injuries",
        kind: "injury-kickoff",
        timezone: FOOTBALL_TIMEZONE,
        cadence: `one full-feed refresh 75m before ${window.bucket} Sunday kickoff (${window.gameIds.join(",")})`,
        nextRunAt: nextRunAt.getTime() > now.getTime() ? nextRunAt : null,
        enabled: nextRunAt.getTime() > now.getTime(),
      });
      continue;
    }
    // A one-shot window is disabled after execution. A later flex within the
    // same named window may rearm it, but an already-consumed occurrence is
    // never replayed at its old time.
    if (
      !existing.enabled &&
      existing.lastRunAt &&
      nextRunAt.getTime() > now.getTime() &&
      nextRunAt.getTime() > existing.lastRunAt.getTime()
    ) {
      await db.update(schedulerJobsTable)
        .set({
          enabled: true,
          nextRunAt,
          lastError: "Rearmed after a future kickoff flex within this Sunday window.",
          updatedAt: now,
        })
        .where(eq(schedulerJobsTable.jobKey, window.key));
    } else if (
      existing.enabled &&
      existing.nextRunAt &&
      nextRunAt.getTime() > now.getTime() &&
      Math.abs(existing.nextRunAt.getTime() - nextRunAt.getTime()) > 60_000
    ) {
      await db.update(schedulerJobsTable)
        .set({ nextRunAt, updatedAt: now, lastError: "Kickoff window recalculated from the latest persisted schedule." })
        .where(eq(schedulerJobsTable.jobKey, window.key));
    }
  }
  const futureGames = games.filter((game): game is typeof game & { kickoffTime: Date } =>
    Boolean(game.kickoffTime) && !isFinishedStatus(game.gameStatus),
  );
  for (const game of futureGames) {
    const occurrence = canonicalPredictionOccurrence(game.gameId, game.kickoffTime);
    const jobKey = occurrence.jobKey;
    const canonicalAt = occurrence.scheduledFor;
    const [official] = await db.select({ id: predictionSnapshotsTable.id })
      .from(predictionSnapshotsTable)
      .where(and(
        eq(predictionSnapshotsTable.gameId, game.gameId),
        eq(predictionSnapshotsTable.officialFinalPrediction, true),
      )).limit(1);
    const missedRunAt = canonicalAt > now ? canonicalAt : null;
    const [existing] = await db.select().from(schedulerJobsTable)
      .where(eq(schedulerJobsTable.jobKey, jobKey)).limit(1);
    if (!existing) {
      await db.insert(schedulerJobsTable).values({
        jobKey,
        provider: "gridline-model",
        kind: "prediction-canonical",
        timezone: FOOTBALL_TIMEZONE,
        cadence: `one-shot canonical model + market evidence at 30m before kickoff (${game.gameId})`,
        nextRunAt: official ? null : missedRunAt,
        enabled: !official && Boolean(missedRunAt),
      });
    } else if (!official && missedRunAt && (
      !existing.enabled
      || !existing.nextRunAt
      || (!existing.lastRunAt && Math.abs(existing.nextRunAt.getTime() - canonicalAt.getTime()) > 60_000)
    )) {
      await db.update(schedulerJobsTable).set({
        nextRunAt: missedRunAt,
        enabled: true,
        updatedAt: now,
      }).where(eq(schedulerJobsTable.jobKey, jobKey));
    } else if (official && existing.enabled) {
      await db.update(schedulerJobsTable).set({
        nextRunAt: null,
        enabled: false,
        updatedAt: now,
      }).where(eq(schedulerJobsTable.jobKey, jobKey));
    }
    for (const occurrence of confidenceCaptureOccurrences(game.gameId, game.kickoffTime)) {
      const [confidenceJob] = await db.select().from(schedulerJobsTable)
        .where(eq(schedulerJobsTable.jobKey, occurrence.jobKey)).limit(1);
      if (!confidenceJob) {
        const future = occurrence.scheduledFor.getTime() > now.getTime();
        const skipReason = "Confidence capture window elapsed before it could be scheduled; no catch-up calculation was made.";
        await db.insert(schedulerJobsTable).values({
          jobKey: occurrence.jobKey,
          provider: "gridline-confidence",
          kind: "confidence-capture",
          timezone: FOOTBALL_TIMEZONE,
          cadence: `one-shot confidence capture ${occurrence.offsetKey} before kickoff (${game.gameId})`,
          nextRunAt: future ? occurrence.scheduledFor : null,
          enabled: future,
          lastScheduledAt: future ? null : occurrence.scheduledFor,
          lastStatus: future ? "pending" : "skipped",
          lastError: future ? null : skipReason,
        });
        if (!future) await recordSchedulerSkip("gridline-confidence", occurrence.jobKey, occurrence.scheduledFor, skipReason);
      } else if (
        occurrence.scheduledFor.getTime() > now.getTime()
        && !confidenceJob.enabled
        && (!confidenceJob.lastRunAt || occurrence.scheduledFor.getTime() > confidenceJob.lastRunAt.getTime())
      ) {
        await db.update(schedulerJobsTable).set({
          enabled: true,
          nextRunAt: occurrence.scheduledFor,
          lastStatus: "pending",
          lastError: "Confidence capture rearmed after kickoff moved later.",
          updatedAt: now,
        }).where(eq(schedulerJobsTable.jobKey, occurrence.jobKey));
      } else if (
        occurrence.scheduledFor.getTime() > now.getTime()
        &&
        confidenceJob.enabled
        && confidenceJob.nextRunAt
        && Math.abs(confidenceJob.nextRunAt.getTime() - occurrence.scheduledFor.getTime()) > 60_000
      ) {
        await db.update(schedulerJobsTable).set({
          nextRunAt: occurrence.scheduledFor,
          updatedAt: now,
          lastError: "Confidence capture recalculated from the latest persisted kickoff.",
        }).where(eq(schedulerJobsTable.jobKey, occurrence.jobKey));
      } else if (
        confidenceJob.enabled
        && shouldRetireFlexedConfidenceOccurrence(confidenceJob.nextRunAt, occurrence.scheduledFor, now)
      ) {
        const skipReason = "Kickoff moved earlier and this confidence capture window has elapsed; no catch-up calculation was made.";
        await recordSchedulerSkip("gridline-confidence", occurrence.jobKey, occurrence.scheduledFor, skipReason);
        await db.update(schedulerJobsTable).set({
          enabled: false,
          nextRunAt: null,
          lastScheduledAt: occurrence.scheduledFor,
          lastRunAt: now,
          lastStatus: "skipped",
          lastError: skipReason,
          updatedAt: now,
        }).where(eq(schedulerJobsTable.jobKey, occurrence.jobKey));
      }
    }
  }
}

async function recoverMissedJobs(now: Date) {
  const recoveryOwner = `startup:${randomUUID()}`;
  const missed = await db
    .update(schedulerJobsTable)
    .set({
      lockOwner: recoveryOwner,
      lockAcquiredAt: now,
      lockUntil: new Date(now.getTime() + LOCK_TTL_MS),
      updatedAt: now,
    })
    .where(and(
      eq(schedulerJobsTable.enabled, true),
      lte(schedulerJobsTable.nextRunAt, now),
      or(isNull(schedulerJobsTable.lockUntil), lt(schedulerJobsTable.lockUntil, now)),
    ))
    .returning();
  for (const job of missed) {
    const freezeId = freezeGameId(job);
    const [freezeGame] = freezeId
      ? await db.select({ kickoffTime: gamesTable.kickoffTime }).from(gamesTable)
        .where(eq(gamesTable.gameId, freezeId)).limit(1)
      : [];
    const freezeReason = expiredFreezeReason(job, freezeGame?.kickoffTime ?? null, now);
    const definition = ALL_WEEKLY_SLOTS.find((item) => item.jobKey === job.jobKey);
    const nextRunAt = job.kind === "schedule"
      ? nextIntervalOccurrence(now)
      : job.kind === "nflverse"
        ? nextWeeklyOccurrence(now, 2, 4, 0)
        : job.kind === "odds-adaptive"
          ? await nextAdaptiveOddsOccurrence(now)
        : definition
          ? await nextOccurrence(definition, now)
          : nextIntervalOccurrence(now);
    const skipReason = freezeReason ?? "Missed while the scheduler process was stopped; no catch-up request was made.";
    await recordSchedulerSkip(job.provider, job.jobKey, job.nextRunAt, skipReason);
    await db.update(schedulerJobsTable)
      .set({
        nextRunAt: freezeReason || job.kind === "injury-kickoff" || job.kind === "confidence-capture" ? null : nextRunAt,
        enabled: !(freezeReason || job.kind === "injury-kickoff" || job.kind === "confidence-capture"),
        lastScheduledAt: job.nextRunAt,
        lastRunAt: now,
        lastStatus: "skipped",
        lastError: skipReason,
        lastResult: freezeReason ? { freezeDisposition: "expired_without_lock", gameId: freezeId, onTime: false } : job.lastResult,
        lockOwner: null,
        lockAcquiredAt: null,
        lockUntil: null,
      })
      .where(and(eq(schedulerJobsTable.jobKey, job.jobKey), eq(schedulerJobsTable.lockOwner, recoveryOwner)));
  }
}

/** Startup preparation only. No timer, claim, provider or retention path is entered. */
export async function rehearseDataSchedulerStartup(now: Date) {
  if (!Number.isFinite(now.getTime())) throw new Error("Rehearsal clock must be valid");
  await prepareJobs(now);
  await recoverMissedJobs(now);
}

async function prepareJobs(now: Date) {
  // A database row left in `running` after a process crash must not look like
  // an active success forever. The lock TTL bounds recovery so a healthy
  // long-running free feed still has time to finish.
  await db.update(dataSyncRunsTable)
    .set({
      status: "failed",
      completedAt: now,
      errorMessage: "Process stopped before completion; recovered on scheduler startup.",
    })
    .where(and(
      eq(dataSyncRunsTable.status, "running"),
      lt(dataSyncRunsTable.startedAt, new Date(now.getTime() - LOCK_TTL_MS)),
    ));
  await ensureWeeklyJobs(now);
  await ensureAdaptiveOddsJob(now);
  await ensureScheduleJob(now);
  await ensureNflverseJob(now);
  await ensureSleeperJob(now);
  await ensurePregameFeatureRepairJob(now);
  await ensurePersonnelContextJob(now);
  await ensureKickoffJobs(now);
}

async function claimDueJob(now: Date) {
  const owner = randomUUID();
  return db.transaction(async (tx) => {
    // Select exactly one candidate while holding the row lock. The previous
    // UPDATE-without-a-limit could update every due job, then execute only
    // the first returned row while silently locking the rest.
    const candidates = await tx.execute(sql`
      with candidate as (
        select job_key
        from scheduler_jobs
        where enabled = true
          and next_run_at <= ${now}
          and (lock_until is null or lock_until < ${now})
        order by next_run_at asc, job_key asc
        for update skip locked
        limit 1
      )
      select job_key from candidate
    `) as unknown as { rows: Array<{ job_key: string }> };
    const candidate = candidates.rows[0];
    if (!candidate) return null;
    const [job] = await tx
      .update(schedulerJobsTable)
      .set({
        lockOwner: owner,
        lockAcquiredAt: now,
        lockUntil: new Date(now.getTime() + LOCK_TTL_MS),
        lastScheduledAt: sql`${schedulerJobsTable.nextRunAt}`,
        updatedAt: now,
      })
      .where(eq(schedulerJobsTable.jobKey, candidate.job_key))
      .returning();
    return job ? { ...job, owner } : null;
  });
}

function resultMetadata(value: unknown) {
  return JSON.parse(JSON.stringify(value, (_key, item) => item instanceof Date ? item.toISOString() : item)) as Record<string, unknown>;
}

async function runClaimedJob(job: typeof schedulerJobsTable.$inferSelect & { owner: string }) {
  const scheduledFor = job.lastScheduledAt;
  let result: unknown;
  let status = "success";
  let errorMessage: string | null = null;
  let disable = false;
  let nflverseWindow: string | null = null;
  let nflverseCheckpointed = false;
  try {
    if (job.kind === "schedule") {
      result = await syncEspnScheduleCoverage({ jobKey: job.jobKey, scheduledFor: scheduledFor ?? undefined });
    } else if (job.kind === "injury" || job.kind === "injury-dynamic" || job.kind === "injury-kickoff") {
      const dynamicInjuryDay = job.jobKey === "injury-monday-final" ? 1 : null;
      let applicable = true;
      if (dynamicInjuryDay !== null) {
        const upcomingDynamicGames = await db
          .select({ kickoffTime: gamesTable.kickoffTime })
          .from(gamesTable)
          .where(and(
            sql`${gamesTable.kickoffTime} is not null`,
            sql`${gamesTable.kickoffTime} > now()`,
            sql`lower(${gamesTable.gameStatus}) not like '%final%' and lower(${gamesTable.gameStatus}) not like '%completed%' and lower(${gamesTable.gameStatus}) not like '%postponed%' and lower(${gamesTable.gameStatus}) not like '%canceled%'`,
          ));
        applicable = upcomingDynamicGames.some((game) => game.kickoffTime && timeParts(game.kickoffTime).weekday === dynamicInjuryDay);
      }
      if (!applicable) {
        const skipReason = "No applicable future Monday game for this kickoff-relative injury slot.";
        await recordSchedulerSkip(job.provider, job.jobKey, scheduledFor, skipReason);
        result = { status: "skipped", skipReason };
      } else {
        result = await syncEspnInjuries({ jobKey: job.jobKey, scheduledFor: scheduledFor ?? undefined });
      }
      disable = job.kind === "injury-kickoff";
    } else if (job.kind === "odds" || job.kind === "odds-dynamic" || job.kind === "odds-adaptive") {
      const [oddsRun] = await db.insert(dataSyncRunsTable).values({
        provider: "odds-api",
        status: "running",
        jobKey: job.jobKey,
        scheduledFor,
      }).returning({ id: dataSyncRunsTable.id });
      try {
        const dynamicDay = job.jobKey === "odds-sunday-final" ? 0 : job.jobKey === "odds-monday-final" ? 1 : null;
        let applicable = true;
        if (dynamicDay !== null) {
          const upcoming = await db
            .select({ kickoffTime: gamesTable.kickoffTime })
            .from(gamesTable)
            .where(and(
              sql`${gamesTable.kickoffTime} is not null`,
              sql`${gamesTable.kickoffTime} > now()`,
              sql`lower(${gamesTable.gameStatus}) not like '%final%' and lower(${gamesTable.gameStatus}) not like '%completed%' and lower(${gamesTable.gameStatus}) not like '%postponed%' and lower(${gamesTable.gameStatus}) not like '%canceled%'`,
            ));
          applicable = upcoming.some((game) => game.kickoffTime && timeParts(game.kickoffTime).weekday === dynamicDay);
        }
        if (job.kind === "odds-adaptive") {
          const [nextGame] = await db.select({ kickoffTime: gamesTable.kickoffTime })
            .from(gamesTable)
            .where(and(
              sql`${gamesTable.kickoffTime} is not null`,
              sql`${gamesTable.kickoffTime} > now()`,
              sql`lower(${gamesTable.gameStatus}) not like '%final%' and lower(${gamesTable.gameStatus}) not like '%completed%' and lower(${gamesTable.gameStatus}) not like '%postponed%' and lower(${gamesTable.gameStatus}) not like '%canceled%'`,
            ))
            .orderBy(asc(gamesTable.kickoffTime))
            .limit(1);
          if (!nextGame?.kickoffTime) {
            const skipReason = "No upcoming unfinished game; the Odds API was not called.";
            await recordSchedulerSkip(job.provider, job.jobKey, scheduledFor, skipReason);
            result = { status: "skipped", skipReason };
          } else {
          const [latestRequest] = await db.select({ creditsRemaining: oddsApiRequestsTable.creditsRemaining })
            .from(oddsApiRequestsTable)
            .orderBy(desc(oddsApiRequestsTable.requestedAt), desc(oddsApiRequestsTable.id))
            .limit(1);
          const hoursUntilKickoff = (nextGame.kickoffTime.getTime() - Date.now()) / 3_600_000;
          const requiredRequestCount = hoursUntilKickoff <= 6
            ? oddsCaptureRequestCount(hoursUntilKickoff)
            : 1;
          const quota = oddsCaptureQuotaDecision(
            latestRequest?.creditsRemaining ?? null,
            undefined,
            requiredRequestCount,
          );
          if (!quota.safe) {
            const skipReason = quota.reason ?? "Quota policy blocked this paid capture.";
            await recordSchedulerSkip(job.provider, job.jobKey, scheduledFor, skipReason);
            result = { status: "skipped", skipReason, quota };
          } else {
            result = await captureOddsSnapshots({ jobKey: job.jobKey, scheduledFor: scheduledFor ?? undefined });
          }
          }
        } else if (!applicable) {
          const skipReason = "No applicable future game for this kickoff-relative slot; the Odds API was not called.";
          await recordSchedulerSkip(job.provider, job.jobKey, scheduledFor, skipReason);
          result = { status: "skipped", skipReason };
        } else {
          result = await captureOddsSnapshots({ jobKey: job.jobKey, scheduledFor: scheduledFor ?? undefined });
        }
        const oddsResult = result as { status?: string; snapshotsCreated?: number; error?: string | null; skipReason?: string | null };
        status = oddsResult.status ?? "success";
        await db.update(dataSyncRunsTable).set({
          status,
          recordsProcessed: oddsResult.snapshotsCreated ?? 0,
          errorMessage: oddsResult.error ?? null,
          skipReason: oddsResult.skipReason ?? null,
          completedAt: new Date(),
          metadata: resultMetadata(result),
        }).where(eq(dataSyncRunsTable.id, oddsRun.id));
      } catch (error) {
        await db.update(dataSyncRunsTable).set({
          status: "failed",
          errorMessage: error instanceof Error ? error.message : String(error),
          completedAt: new Date(),
        }).where(eq(dataSyncRunsTable.id, oddsRun.id));
        throw error;
      }
    } else if (job.kind === "nflverse") {
      const [completed] = await db
        .select({ season: gamesTable.season, week: gamesTable.week })
        .from(gamesTable)
        .where(and(
          sql`(lower(${gamesTable.gameStatus}) like '%final%' or lower(${gamesTable.gameStatus}) like '%completed%')`,
          sql`${gamesTable.kickoffTime} is not null`,
          sql`${gamesTable.kickoffTime} < now()`,
        ))
        .orderBy(desc(gamesTable.season), desc(gamesTable.kickoffTime))
        .limit(1);
      if (!completed) {
        status = "skipped";
        const reason = "No completed game window is persisted; NFLverse was not requested.";
        await recordSchedulerSkip(job.provider, job.jobKey, scheduledFor, reason);
        result = { status, skipReason: reason };
      } else {
        nflverseWindow = `${completed.season}:${completed.week}`;
        const priorCheckpoint = (job.lastResult as { checkpointedCompletedWindow?: string | null } | null)?.checkpointedCompletedWindow;
        if (priorCheckpoint === nflverseWindow) {
          status = "skipped";
          nflverseCheckpointed = true;
          const reason = `NFLverse window ${nflverseWindow} was already refreshed successfully; no upstream request was made.`;
          await recordSchedulerSkip(job.provider, job.jobKey, scheduledFor, reason);
          result = { status, skipReason: reason, completedWindow: nflverseWindow, checkpointedCompletedWindow: priorCheckpoint };
        } else {
          result = await syncNflverseHistory([completed.season], {
            jobKey: job.jobKey,
            scheduledFor: scheduledFor ?? undefined,
            refresh: true,
            completedWindow: nflverseWindow,
          });
        }
        if (
          (result as { status?: string; handledMissingSeason?: boolean } | null)?.status === "success" ||
          (result as { handledMissingSeason?: boolean } | null)?.handledMissingSeason === true
        ) {
          nflverseCheckpointed = true;
          const featureResult = await rebuildPregameFeatures(undefined, new Date(), { futureOnly: true });
          result = {
            ...(resultMetadata(result) as Record<string, unknown>),
            pregameFeatures: featureResult,
          };
        }
      }
    } else if (job.kind === "sleeper-players") {
      result = await syncSleeperPlayers({
        jobKey: job.jobKey,
        scheduledFor: scheduledFor ?? undefined,
      });
      const snapshotId = (result as { snapshotId?: string } | null)?.snapshotId;
      const sourceCapturedAt = (result as { sourceCapturedAt?: string } | null)?.sourceCapturedAt;
      if (snapshotId && sourceCapturedAt) {
        try {
          const identityImport = await syncNflversePlayers();
          const crosswalk = await refreshPlayerIdentityCrosswalk(new Date(sourceCapturedAt));
          const identity = await refreshSleeperIdentityMappings({
            sourceSnapshotId: snapshotId,
            sourceCapturedAt: new Date(sourceCapturedAt),
            jobKey: job.jobKey,
            scheduledFor: scheduledFor ?? undefined,
          });
          result = {
            ...(resultMetadata(result) as Record<string, unknown>),
            identityImport,
            crosswalk,
            identityMapping: identity,
          };
        } catch (error) {
          // Mapping is advisory evidence and must not turn a successful
          // Sleeper snapshot capture into a failed provider sync.
          logger.error({ error, snapshotId }, "Sleeper identity mapping failed after snapshot sync");
          result = {
            ...(resultMetadata(result) as Record<string, unknown>),
            identityMapping: { status: "failed", error: "Sleeper identity mapping failed." },
          };
        }
      }
    } else if (job.kind === "personnel-context") {
      result = await rebuildPregamePersonnelContextFeatures();
    } else if (job.kind === "pregame-feature-repair") {
      result = await rebuildPregameFeatures(undefined, new Date(), { futureOnly: true });
    } else if (job.kind === "prediction") {
      result = await generateLivePredictions();
    } else if (job.kind === "prediction-grade") {
      result = await gradeCompletedPredictions();
      const completed = await db
        .select({ season: gamesTable.season, week: gamesTable.week })
        .from(gamesTable)
        .where(and(
          sql`${gamesTable.kickoffTime} is not null`,
          sql`${gamesTable.kickoffTime} < now()`,
          sql`(lower(${gamesTable.gameStatus}) like '%final%' or lower(${gamesTable.gameStatus}) like '%completed%')`,
        ))
        .orderBy(desc(gamesTable.kickoffTime))
        .limit(1);
      if (completed[0]) {
        const report = await generateWeeklyLearningReport(completed[0].season, completed[0].week);
        result = { ...(result as Record<string, unknown>), report: { season: report.season, week: report.week } };
      }
    } else if (job.kind === "prediction-freeze" || job.kind === "prediction-canonical") {
      const canonicalGameId = freezeGameId(job);
      const priorCutoff = (job.lastResult as { canonicalCutoffAt?: string } | null)?.canonicalCutoffAt;
      const [canonicalGame] = canonicalGameId
        ? await db.select({ kickoffTime: gamesTable.kickoffTime }).from(gamesTable)
          .where(eq(gamesTable.gameId, canonicalGameId)).limit(1)
        : [];
      const lateReason = lateClaimedFreezeReason(
        { ...job, nextRunAt: scheduledFor }, canonicalGame?.kickoffTime ?? null, new Date(),
      );
      if (lateReason) {
        status = "skipped";
        disable = true;
        result = { status, skipReason: lateReason, gameId: canonicalGameId, onTime: false };
        await recordSchedulerSkip(job.provider, job.jobKey, scheduledFor, lateReason);
      } else {
      const persistedCutoff = priorCutoff ? new Date(priorCutoff) : null;
      const currentKickoffCutoff = canonicalGame?.kickoffTime
        ? new Date(canonicalGame.kickoffTime.getTime() - 30 * 60_000)
        : null;
      // A later kickoff never moves the evidence boundary forward after the
      // first attempt. An earlier flex can only tighten it, preventing any
      // observation from the newly post-kickoff period from becoming eligible.
      const cutoffOverride = persistedCutoff && Number.isFinite(persistedCutoff.getTime())
        ? currentKickoffCutoff && currentKickoffCutoff < persistedCutoff
          ? currentKickoffCutoff
          : persistedCutoff
        : currentKickoffCutoff ?? undefined;
      result = await freezeOfficialFinalPredictions(new Date(), {
        gameId: canonicalGameId!,
        cutoffOverride: cutoffOverride && Number.isFinite(cutoffOverride.getTime()) ? cutoffOverride : undefined,
      });
      // Missing/stale market evidence is a recoverable condition. Keep the
      // occurrence enabled and retry; only an actually frozen snapshot ends
      // this one-shot lifecycle.
      disable = job.kind === "prediction-freeze"
        || (result as { frozen?: number }).frozen! > 0;
      }
    } else if (job.kind === "confidence-capture") {
      disable = true;
      const [captureRun] = await db.insert(dataSyncRunsTable).values({
        provider: "gridline-confidence",
        status: "running",
        jobKey: job.jobKey,
        scheduledFor,
      }).returning({ id: dataSyncRunsTable.id });
      try {
        const gameId = confidenceGameId(job.jobKey);
        if (!gameId) throw new Error("Confidence capture job has an invalid game identifier.");
        const [game] = await db.select({
          kickoffTime: gamesTable.kickoffTime,
          gameStatus: gamesTable.gameStatus,
        }).from(gamesTable).where(eq(gamesTable.gameId, gameId)).limit(1);
        if (!scheduledFor || !game?.kickoffTime || game.kickoffTime.getTime() <= Date.now() || isFinishedStatus(game.gameStatus)) {
          status = "skipped";
          const skipReason = "Game is missing, finished, or no longer before kickoff; confidence was not calculated.";
          result = { status, skipReason, gameId };
        } else {
          result = await captureConfidenceResults({ gameId, asOf: scheduledFor });
          if ((result as { validSnapshotsEvaluated?: number }).validSnapshotsEvaluated === 0) {
            result = {
              ...(result as Record<string, unknown>),
              status: "skipped",
              skipReason: "No valid production prediction snapshot existed at the scheduled confidence boundary.",
            };
          }
        }
        const captureResult = result as {
          status?: string;
          marketResultsPersisted?: number;
          skipReason?: string;
        };
        status = captureResult.status ?? status;
        await db.update(dataSyncRunsTable).set({
          status,
          recordsProcessed: captureResult.marketResultsPersisted ?? 0,
          skipReason: captureResult.skipReason ?? null,
          completedAt: new Date(),
          metadata: resultMetadata(result),
        }).where(eq(dataSyncRunsTable.id, captureRun.id));
      } catch (error) {
        await db.update(dataSyncRunsTable).set({
          status: "failed",
          errorMessage: error instanceof Error ? error.message : String(error),
          completedAt: new Date(),
        }).where(eq(dataSyncRunsTable.id, captureRun.id));
        throw error;
      }
    } else if (job.kind === "model-challenger") {
      if (process.env.NODE_ENV === "development" || process.env.NODE_ENV === "test") {
        result = await trainPhase4Models();
      } else {
        status = "skipped";
        const reason = "Automatic model fitting is disabled outside an explicit development/test process.";
        await recordSchedulerSkip(job.provider, job.jobKey, scheduledFor, reason);
        result = { status, skipReason: reason };
      }
    } else {
      status = "skipped";
      const reason = `Unknown scheduler job kind "${job.kind}".`;
      await recordSchedulerSkip(job.provider, job.jobKey, scheduledFor, reason);
      result = { status, skipReason: reason };
    }
    const resultStatus = (result as { status?: string } | null)?.status;
    if (resultStatus) status = resultStatus;
  } catch (error) {
    status = "failed";
    errorMessage = error instanceof Error ? error.message : String(error);
    logger.error({ error, jobKey: job.jobKey }, "Recurring synchronization job failed");
  }

  const now = new Date();
  const definition = ALL_WEEKLY_SLOTS.find((item) => item.jobKey === job.jobKey);
  let nextRunAt: Date | null = null;
  if (!disable && job.kind !== "injury-kickoff" && job.kind !== "confidence-capture") {
    nextRunAt = job.kind === "schedule"
      ? nextIntervalOccurrence(now)
      : job.kind === "nflverse"
        ? nextWeeklyOccurrence(now, 2, 4, 0)
        : job.kind === "personnel-context"
          ? new Date(now.getTime() + PERSONNEL_CONTEXT_INTERVAL_MS)
        : job.kind === "pregame-feature-repair"
          ? new Date(now.getTime() + FEATURE_REPAIR_INTERVAL_MS)
        : job.kind === "sleeper-players"
          ? new Date(now.getTime() + sleeperSyncIntervalMs())
        : job.kind === "odds-adaptive"
          ? await nextAdaptiveOddsOccurrence(now)
        : definition
          ? await nextOccurrence(definition, now)
          : nextIntervalOccurrence(now);
  }
  const storedResult = result
    ? {
      ...resultMetadata(result),
      ...(job.kind === "nflverse" && nflverseWindow
        ? {
          checkpointedCompletedWindow: nflverseCheckpointed ? nflverseWindow : null,
        }
        : {}),
    }
    : null;
  await db.update(schedulerJobsTable)
    .set({
      enabled: disable ? false : true,
      nextRunAt,
      lastRunAt: now,
      lastStatus: status,
      lastError: errorMessage ?? ((result as { error?: string | null } | null)?.error ?? null),
      lastResult: storedResult,
      lockOwner: null,
      lockAcquiredAt: null,
      lockUntil: null,
      updatedAt: now,
    })
    .where(and(eq(schedulerJobsTable.jobKey, job.jobKey), eq(schedulerJobsTable.lockOwner, job.owner)));
}

async function tick() {
  if (tickInFlight) return tickInFlight;
  tickInFlight = (async () => {
    const now = new Date();
    await prepareJobs(now);
    // Claim one at a time so free-tier odds and free feeds never fan out
    // into a catch-up burst after a slow process resumes.
    for (let count = 0; count < 10; count += 1) {
      const job = await claimDueJob(new Date());
      if (!job) break;
      await runClaimedJob(job);
    }
  })()
    .catch((error) => logger.error({ error }, "Recurring scheduler tick failed"))
    .finally(() => {
      tickInFlight = null;
    });
  return tickInFlight;
}

export async function startDataScheduler(options: {
  environment?: { GRIDLINE_SCHEDULER_WORKER?: string };
  prepare?: typeof prepareJobs;
  recover?: typeof recoverMissedJobs;
} = {}) {
  if (!schedulerProcessOwnsRecurringJobs(options.environment)) {
    logger.info("Recurring data scheduler is worker-owned; API process will not start it");
    return;
  }
  if (timer) return;
  try {
    const startupNow = new Date();
    await (options.prepare ?? prepareJobs)(startupNow);
    await (options.recover ?? recoverMissedJobs)(startupNow);
    timer = setInterval(() => {
      void tick();
    }, TICK_MS);
    timer.unref?.();
    schedulerStartedAt = startupNow;
    logger.info({ timezone: FOOTBALL_TIMEZONE }, "Recurring data scheduler started");
  } catch (error) {
    stopDataScheduler();
    logger.error({ error }, "Recurring data scheduler could not initialize");
    throw error;
  }
}

export function schedulerProcessOwnsRecurringJobs(
  environment: { GRIDLINE_SCHEDULER_WORKER?: string } = process.env,
) {
  return environment.GRIDLINE_SCHEDULER_WORKER === "1";
}

export function stopDataScheduler() {
  if (timer) clearInterval(timer);
  timer = null;
  schedulerStartedAt = null;
}

export async function getSchedulerHealth() {
  const checkedAt = new Date();
  const jobs = await db
    .select()
    .from(schedulerJobsTable)
    .orderBy(asc(schedulerJobsTable.provider), asc(schedulerJobsTable.jobKey));
  const runs = await db
    .select()
    .from(dataSyncRunsTable)
    .orderBy(desc(dataSyncRunsTable.startedAt), desc(dataSyncRunsTable.id))
    .limit(100);
  const alerts = classifySchedulerAlerts(jobs, runs, checkedAt);
  return {
    status: alerts.some((alert) => alert.severity === "critical")
      ? "critical"
      : alerts.length > 0
        ? "warning"
        : "healthy",
    checkedAt: checkedAt.toISOString(),
    alerts,
    activeInThisProcess: Boolean(timer),
    processRole: process.env.GRIDLINE_SCHEDULER_WORKER === "1" ? "persistent_worker" : "api",
    persistentWorkerExpected: true,
    processStartedAt: schedulerStartedAt?.toISOString() ?? null,
    timezone: FOOTBALL_TIMEZONE,
    alwaysOnServiceRequired: true,
    note: "Critical recurring jobs run in the separate Gridline data worker workflow. The API can be inactive without stopping scheduled work. If the worker stops, database leases prevent duplicate work and missed paid sportsbook jobs are not burst-caught-up.",
    jobs: jobs.map((job) => ({
      jobKey: job.jobKey,
      provider: job.provider,
      kind: job.kind,
      cadence: job.cadence,
      timezone: job.timezone,
      enabled: job.enabled,
      nextRunAt: job.nextRunAt?.toISOString() ?? null,
      lastScheduledAt: job.lastScheduledAt?.toISOString() ?? null,
      lastRunAt: job.lastRunAt?.toISOString() ?? null,
      lastStatus: job.lastStatus,
      lastError: job.lastError,
      locked: Boolean(job.lockUntil && job.lockUntil.getTime() > Date.now()),
      lockOwner: job.lockOwner,
      lockAcquiredAt: job.lockAcquiredAt?.toISOString() ?? null,
      lockUntil: job.lockUntil?.toISOString() ?? null,
    })),
    runs: runs.map((run) => ({
      id: run.id,
      provider: run.provider,
      jobKey: run.jobKey,
      status: run.status,
      scheduledFor: run.scheduledFor?.toISOString() ?? null,
      startedAt: run.startedAt.toISOString(),
      completedAt: run.completedAt?.toISOString() ?? null,
      recordsProcessed: run.recordsProcessed,
      skipReason: run.skipReason,
      errorMessage: run.errorMessage,
      metadata: run.metadata,
    })),
  };
}
