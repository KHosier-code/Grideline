import { Router, type IRouter, type Request, type Response } from "express";
import {
  GetDashboardSummaryResponse,
  GetDataHealthResponse,
  GetSleeperIdentityReportResponse,
} from "@workspace/api-zod";
import { fetchSchedule, getEspnHealth, logEspnFailure } from "../lib/espn";
import { getNflverseHealth } from "../lib/nflverse";
import { resolveCurrentSeasonWeek } from "../lib/season";
import { getAvailabilityHealth } from "../lib/availability";
import { getSleeperHealth } from "../lib/sleeper";
import {
  getSleeperIdentityHealth,
  getSleeperIdentityReport,
} from "../lib/sleeper-identity";
import { getOddsApiHealth } from "../lib/odds";
import { getScheduleHealth } from "../lib/schedule";
import { getSchedulerHealth } from "../lib/scheduler";
import { getPregameFeatureHealth } from "../lib/features";
import { getRecentScheduledRuns } from "../lib/sync-runs";
import { nextFeedUpdate } from "../lib/feed-schedule";
import { getFeedGameDays } from "../lib/feed-game-days";
import { getProductionModelStatus } from "../lib/live-predictions";
import { weatherHealth } from "../lib/weather";
import { requireAdmin } from "../middlewares/admin";
import { getModelArtifactImmutabilityStatus } from "../lib/phase61-release";
import { getUsageAnalyticsRetentionHealth } from "../lib/usage-analytics-retention";
import { logger } from "../lib/logger";
import { withDatabaseQueryCancellation } from "../lib/db";

type DataHealthDependencies = {
  getEspnHealth: typeof getEspnHealth;
  getScheduleHealth: typeof getScheduleHealth;
  getNflverseHealth: typeof getNflverseHealth;
  getAvailabilityHealth: typeof getAvailabilityHealth;
  getSleeperHealth: typeof getSleeperHealth;
  getSleeperIdentityHealth: typeof getSleeperIdentityHealth;
  getRecentScheduledRuns: typeof getRecentScheduledRuns;
  getOddsApiHealth: typeof getOddsApiHealth;
  getSchedulerHealth: typeof getSchedulerHealth;
  getPregameFeatureHealth: typeof getPregameFeatureHealth;
  getModelArtifactImmutabilityStatus: typeof getModelArtifactImmutabilityStatus;
  getUsageAnalyticsRetentionHealth: typeof getUsageAnalyticsRetentionHealth;
  getFeedGameDays: typeof getFeedGameDays;
  nextFeedUpdate: typeof nextFeedUpdate;
  weatherHealth: typeof weatherHealth;
};

const defaultDataHealthDependencies: DataHealthDependencies = {
  getEspnHealth,
  getScheduleHealth,
  getNflverseHealth,
  getAvailabilityHealth,
  getSleeperHealth,
  getSleeperIdentityHealth,
  getRecentScheduledRuns,
  getOddsApiHealth,
  getSchedulerHealth,
  getPregameFeatureHealth,
  getModelArtifactImmutabilityStatus,
  getUsageAnalyticsRetentionHealth,
  getFeedGameDays,
  nextFeedUpdate,
  weatherHealth,
};

export const DATA_HEALTH_ROUTE_TIMEOUT_MS = 5_000;

type DataHealthHandlerOptions = {
  timeoutMs?: number;
};

type HealthCheckResult<T> = {
  value: T;
  unavailable: boolean;
};

function boundedHealthCheck<T>(
  label: string,
  operation: () => T | PromiseLike<T>,
  fallback: T,
  deadline: number,
  signal?: AbortSignal,
): Promise<HealthCheckResult<T>> {
  const remaining = deadline - Date.now();
  if (remaining <= 0) {
    logger.warn(
      { label },
      "Admin data-health check exceeded the shared route budget",
    );
    return Promise.resolve({ value: fallback, unavailable: true });
  }

  let timeout: ReturnType<typeof setTimeout> | undefined;
  const timedOut = new Promise<HealthCheckResult<T>>((resolve) => {
    timeout = setTimeout(() => {
      logger.warn({ label }, "Admin data-health check timed out");
      resolve({ value: fallback, unavailable: true });
    }, remaining);
  });
  const completed = Promise.resolve()
    .then(() =>
      signal ? withDatabaseQueryCancellation(signal, operation) : operation(),
    )
    .then(
      (value) => ({ value, unavailable: false }),
      (error) => {
        logger.warn({ error, label }, "Admin data-health check failed");
        return { value: fallback, unavailable: true };
      },
    );

  return Promise.race([completed, timedOut]).finally(() => {
    if (timeout) clearTimeout(timeout);
  });
}

function healthCheckUnavailable(label: string) {
  return `The ${label} health check did not complete within the admin route budget; status is unavailable.`;
}

const router: IRouter = Router();

router.get(
  "/dashboard/summary",
  requireAdmin,
  async (req, res): Promise<void> => {
    const { season, week } = await resolveCurrentSeasonWeek();
    const modelStatus = await getProductionModelStatus();
    let gamesThisWeek = 0;
    try {
      gamesThisWeek = (await fetchSchedule(season, week)).length;
    } catch (error) {
      logEspnFailure(error);
      req.log.warn({ error }, "Dashboard could not refresh the live schedule");
    }

    res.json(
      GetDashboardSummaryResponse.parse({
        season,
        currentWeek: week,
        gamesThisWeek,
        modelStatus,
        ats: { record: "—", winRate: null, units: null, roi: null },
        moneyline: { record: "—", winRate: null, units: null, roi: null },
        totals: { record: "—", winRate: null, units: null, roi: null },
        averageClv: null,
        topEdges: [],
      }),
    );
  },
);

export function createDataHealthHandler(
  overrides: Partial<DataHealthDependencies> = {},
  options: DataHealthHandlerOptions = {},
) {
  const dependencies = { ...defaultDataHealthDependencies, ...overrides };
  return async (_req: Request, res: Response): Promise<void> => {
    const timeoutMs = options.timeoutMs ?? DATA_HEALTH_ROUTE_TIMEOUT_MS;
    const deadline = Date.now() + timeoutMs;
    const routeAbort = new AbortController();
    const routeAbortTimer = setTimeout(() => routeAbort.abort(), timeoutMs);
    try {
      const now = new Date();
      const bounded = <T>(
        label: string,
        operation: () => T | PromiseLike<T>,
        fallback: T,
      ): Promise<HealthCheckResult<T>> =>
        boundedHealthCheck(
          label,
          operation,
          fallback,
          deadline,
          routeAbort.signal,
        );
    const espn = dependencies.getEspnHealth();
    const scheduleCheck = bounded(
      "ESPN schedule health",
      dependencies.getScheduleHealth,
      {
        records: 0,
        unfinished: 0,
        lastUpdated: null,
        latestRun: null,
        runs: [],
      } as Awaited<ReturnType<typeof getScheduleHealth>>,
    );
    const nflverseCheck = bounded(
      "NFLverse health",
      dependencies.getNflverseHealth,
      {
        status: "stale",
        detail: healthCheckUnavailable("NFLverse"),
        lastUpdated: null,
        requestsToday: 0,
        requestsThisMonth: 0,
        remainingQuota: "Health check unavailable",
        metadata: {
          seasonsLoaded: 0,
          gamesLoaded: 0,
          teamGameRows: 0,
          playerGameRows: 0,
          snapCountRows: 0,
          historicalDepthRows: 0,
          failures: [],
        },
      } as Awaited<ReturnType<typeof getNflverseHealth>>,
    );
    const availabilityCheck = bounded(
      "ESPN availability health",
      dependencies.getAvailabilityHealth,
      {
        injury: {
          records: 0,
          lastUpdated: null,
          failure: null,
          failureAt: null,
        },
        depth: { records: 0, teams: 0, lastUpdated: null, failures: [] },
        runs: [],
      } as Awaited<ReturnType<typeof getAvailabilityHealth>>,
    );
    const sleeperCheck = bounded(
      "Sleeper health",
      dependencies.getSleeperHealth,
      {
        status: "unavailable",
        lastUpdated: null,
        staleAgeMs: null,
        snapshotCount: 0,
        lastCapturedAt: null,
        playerCount: 0,
        teamCount: 0,
        depthOrderCount: 0,
        lastAttempted: new Date(0).toISOString(),
        latestFailure: healthCheckUnavailable("Sleeper"),
        recentFailureCount: 0,
        latestMetadata: {},
        cadenceHours: 24,
      } as Awaited<ReturnType<typeof getSleeperHealth>>,
    );
    const sleeperIdentityCheck = bounded(
      "Sleeper identity mapping health",
      dependencies.getSleeperIdentityHealth,
      {
        status: "unavailable",
        mappingVersion: null,
        latestAttemptMappingVersion: null,
        mappingRunId: null,
        sourceSnapshotId: null,
        lastUpdated: null,
        lastAttempted: null,
        staleAgeMs: null,
        latestFailure: healthCheckUnavailable("Sleeper identity mapping"),
        recentFailureCount: 0,
        durationMs: null,
        metadata: {},
      } as Awaited<ReturnType<typeof getSleeperIdentityHealth>>,
    );
    const scheduledInjuryRunsCheck = bounded(
      "scheduled injury runs",
      () => dependencies.getRecentScheduledRuns("scheduled:injuries"),
      [],
    );
    const scheduledNflverseRunsCheck = bounded(
      "scheduled NFLverse runs",
      () => dependencies.getRecentScheduledRuns("scheduled:nflverse"),
      [],
    );
    const scheduledWeatherRunsCheck = bounded(
      "scheduled weather runs",
      () => dependencies.getRecentScheduledRuns("scheduled:weather"),
      [],
    );
    const oddsCheck = bounded(
      "Odds API health",
      dependencies.getOddsApiHealth,
      {
        status: "unavailable",
        detail: healthCheckUnavailable("Odds API"),
        lastUpdated: null,
        requestsToday: 0,
        requestsThisMonth: 0,
        remainingQuota: null,
        metadata: {},
      } as Awaited<ReturnType<typeof getOddsApiHealth>>,
    );
    const schedulerCheck = bounded(
      "scheduler health",
      dependencies.getSchedulerHealth,
      {
        status: "warning",
        checkedAt: now.toISOString(),
        alerts: [],
        activeInThisProcess: false,
        processRole: "api",
        persistentWorkerExpected: true,
        processStartedAt: null,
        timezone: "UTC",
        alwaysOnServiceRequired: true,
        note: healthCheckUnavailable("scheduler"),
        jobs: [],
        runs: [],
      } as Awaited<ReturnType<typeof getSchedulerHealth>>,
    );
    const featuresCheck = bounded(
      "pregame feature health",
      dependencies.getPregameFeatureHealth,
      {
        featureVersion: "unavailable",
        definition: {},
        rows: 0,
        games: 0,
        lowSampleRows: 0,
        latestGeneratedAt: null,
      } as Awaited<ReturnType<typeof getPregameFeatureHealth>>,
    );
    const modelImmutabilityCheck = bounded(
      "model artifact immutability health",
      dependencies.getModelArtifactImmutabilityStatus,
      {
        status: "application_only",
        mechanism: "unavailable",
        applicationUpdateDeleteBlocked: false,
        productionFittingBlocked: false,
        databaseTriggerActive: false,
        databaseTriggerSupport: "unavailable",
        verification: "unavailable",
        note: healthCheckUnavailable("model artifact immutability"),
      } as Awaited<ReturnType<typeof getModelArtifactImmutabilityStatus>>,
    );
    const usageAnalyticsRetentionCheck = bounded(
      "Usage Lab retention health",
      dependencies.getUsageAnalyticsRetentionHealth,
      {
        retentionDays: 0,
        cleanupIntervalHours: 24,
        nextCleanupAt: null,
        cleanupState: "pending",
        status: "pending",
        lastAttemptAt: null,
        lastAttemptStatus: null,
        consecutiveFailures: 0,
        firstFailureAt: null,
        lastSuccessfulAt: null,
        lastSuccessfulDeletedEvents: null,
        lastSuccessfulBatches: null,
        lastSuccessfulCutoff: null,
        latestError: healthCheckUnavailable("Usage Lab retention"),
        latestErrorAt: null,
        alert: null,
        workerOwned: true,
      } as Awaited<ReturnType<typeof getUsageAnalyticsRetentionHealth>>,
    );
    const gameDaysCheck = bounded(
      "ESPN game calendar",
      () => dependencies.getFeedGameDays(now, { signal: routeAbort.signal }),
      new Set<string>(),
    );
    const weatherCheck = bounded(
      "NWS weather health",
      dependencies.weatherHealth,
      {
        source: "unavailable",
        cost: "unavailable",
        userAgentConfigured: false,
        lastRun: null,
      } as Awaited<ReturnType<typeof weatherHealth>>,
    );

    const [
      scheduleResult,
      nflverseResult,
      availabilityResult,
      sleeperResult,
      sleeperIdentityResult,
      scheduledInjuryRunsResult,
      scheduledNflverseRunsResult,
      scheduledWeatherRunsResult,
      oddsResult,
      schedulerResult,
      featuresResult,
      modelImmutabilityResult,
      usageAnalyticsRetentionResult,
      gameDaysResult,
      weatherResult,
    ] = await Promise.all([
      scheduleCheck,
      nflverseCheck,
      availabilityCheck,
      sleeperCheck,
      sleeperIdentityCheck,
      scheduledInjuryRunsCheck,
      scheduledNflverseRunsCheck,
      scheduledWeatherRunsCheck,
      oddsCheck,
      schedulerCheck,
      featuresCheck,
      modelImmutabilityCheck,
      usageAnalyticsRetentionCheck,
      gameDaysCheck,
      weatherCheck,
    ]);
    const schedule = scheduleResult.value;
    const nflverse = nflverseResult.value;
    const availability = availabilityResult.value;
    const sleeper = sleeperResult.value;
    const sleeperIdentity = sleeperIdentityResult.value;
    const scheduledInjuryRuns = scheduledInjuryRunsResult.value;
    const scheduledNflverseRuns = scheduledNflverseRunsResult.value;
    const scheduledWeatherRuns = scheduledWeatherRunsResult.value;
    const odds = oddsResult.value;
    const scheduler = schedulerResult.value;
    const features = featuresResult.value;
    const modelImmutability = modelImmutabilityResult.value;
    const usageAnalyticsRetention = usageAnalyticsRetentionResult.value;
    const gameDays = gameDaysResult.value;
    const weather = weatherResult.value;
    const schedulerJob = (provider: string) =>
      scheduler.jobs
        .filter((job) => job.provider === provider && job.enabled)
        .sort((left, right) =>
          (left.nextRunAt ?? "").localeCompare(right.nextRunAt ?? ""),
        )[0];
    const scheduleJob = schedulerJob("espn-schedule");
    const oddsJob = schedulerJob("odds-api");
    const injuryNextUpdate =
      dependencies
        .nextFeedUpdate("injuries", now, scheduledInjuryRuns, gameDays)
        ?.toISOString() ?? null;
    const nflverseNextUpdate =
      dependencies
        .nextFeedUpdate("nflverse", now, scheduledNflverseRuns)
        ?.toISOString() ?? null;
    const weatherNextUpdate =
      dependencies
        .nextFeedUpdate("weather", now, scheduledWeatherRuns)
        ?.toISOString() ?? null;
    const month = now.getUTCMonth() + 1;
    const latestFailedScheduledInjuryRun = scheduledInjuryRuns.find(
      (run) => run.status === "failed",
    );
    const nativeFailureAt = availability.injury.failureAt
      ? new Date(availability.injury.failureAt)
      : null;
    const scheduledFailureAt = latestFailedScheduledInjuryRun
      ? (latestFailedScheduledInjuryRun.completedAt ??
        latestFailedScheduledInjuryRun.startedAt)
      : null;
    const latestFailureAt =
      scheduledFailureAt && nativeFailureAt
        ? scheduledFailureAt >= nativeFailureAt
          ? scheduledFailureAt
          : nativeFailureAt
        : (scheduledFailureAt ?? nativeFailureAt);
    const lastSuccessfulInjuryAt = availability.injury.lastUpdated
      ? new Date(availability.injury.lastUpdated)
      : null;
    const latestFailureIsCurrent = Boolean(
      latestFailureAt &&
      (!lastSuccessfulInjuryAt || latestFailureAt >= lastSuccessfulInjuryAt),
    );
    const maxInjuryAge =
      (month >= 3 && month <= 7 ? 8 * 24 : 30) * 60 * 60 * 1000;
    const injuryIsFresh = Boolean(
      lastSuccessfulInjuryAt &&
      now.getTime() - lastSuccessfulInjuryAt.getTime() <= maxInjuryAge,
    );
    const latestFailureMessage =
      (scheduledFailureAt &&
      nativeFailureAt &&
      nativeFailureAt > scheduledFailureAt
        ? availability.injury.failure
        : (latestFailedScheduledInjuryRun?.error ??
          availability.injury.failure)) ??
      (latestFailureAt ? "Injury synchronization failed." : null);
    const injuryCheckUnavailable =
      availabilityResult.unavailable ||
      scheduledInjuryRunsResult.unavailable ||
      gameDaysResult.unavailable;
    const injuryStatus = injuryCheckUnavailable
      ? "unavailable"
      : latestFailureIsCurrent
        ? availability.injury.records > 0
          ? "stale"
          : "unavailable"
        : injuryIsFresh
          ? "current"
          : "stale";
    const injuryDetail =
      latestFailureMessage && latestFailureIsCurrent
        ? latestFailureMessage
        : latestFailureMessage
          ? `Latest failed attempt: ${latestFailureMessage}`
          : availability.injury.records > 0
            ? `${availability.injury.records} immutable injury snapshots captured.`
            : lastSuccessfulInjuryAt
              ? "The latest injury synchronization completed successfully with no reported injuries."
              : "The first injury synchronization is pending.";
      res.json(
        GetDataHealthResponse.parse([
        {
          provider: "model-artifact-immutability",
          label: "Model artifact immutability",
          status: modelImmutabilityResult.unavailable
            ? "unavailable"
            : ["application_only", "database_and_application"].includes(
                  modelImmutability.status,
                )
              ? "current"
              : "unavailable",
          detail: modelImmutabilityResult.unavailable
            ? healthCheckUnavailable("model artifact immutability")
            : modelImmutability.note,
          lastUpdated: now,
          nextUpdate: null,
          requestsToday: 0,
          requestsThisMonth: 0,
          remainingQuota: null,
          metadata: {
            ...modelImmutability,
            ...(modelImmutabilityResult.unavailable
              ? { healthCheck: "failed" }
              : {}),
          },
        },
        {
          provider: "scheduler",
          label: "Recurring synchronization",
          status: schedulerResult.unavailable
            ? "unavailable"
            : scheduler.status === "healthy"
              ? "current"
              : "stale",
          detail: schedulerResult.unavailable
            ? healthCheckUnavailable("scheduler")
            : scheduler.alerts.length > 0
              ? `${scheduler.alerts.length} durable worker scheduler alert${scheduler.alerts.length === 1 ? "" : "s"} detected. This API process only reports persisted state.`
              : scheduler.activeInThisProcess
                ? "The durable worker scheduler is active in this process. Persisted locks prevent duplicate work."
                : "This API process is healthy but does not own recurring work; persisted durable worker state has no backlog alerts.",
          lastUpdated: scheduler.processStartedAt,
          nextUpdate:
            scheduler.jobs
              .map((job) => job.nextRunAt)
              .filter((value): value is string => Boolean(value))
              .sort()[0] ?? null,
          requestsToday: 0,
          requestsThisMonth: 0,
          remainingQuota: null,
          metadata: {
            timezone: scheduler.timezone,
            activeInThisProcess: scheduler.activeInThisProcess,
            processRole: scheduler.processRole,
            persistentWorkerExpected: scheduler.persistentWorkerExpected,
            alwaysOnServiceRequired: scheduler.alwaysOnServiceRequired,
            schedulerStatus: scheduler.status,
            checkedAt: scheduler.checkedAt,
            alerts: scheduler.alerts,
            jobs: scheduler.jobs,
            recentRuns: scheduler.runs.slice(0, 40),
            note: scheduler.note,
            ...(schedulerResult.unavailable ? { healthCheck: "failed" } : {}),
          },
        },
        {
          provider: "usage-analytics-retention",
          label: "Usage Lab analytics retention",
          status: usageAnalyticsRetentionResult.unavailable
            ? "unavailable"
            : usageAnalyticsRetention.alert
              ? "unavailable"
              : usageAnalyticsRetention.cleanupState === "overdue"
                ? "stale"
                : usageAnalyticsRetention.status === "healthy"
                  ? "current"
                  : usageAnalyticsRetention.status === "failed"
                    ? "unavailable"
                    : "stale",
          detail: usageAnalyticsRetentionResult.unavailable
            ? healthCheckUnavailable("Usage Lab retention")
            : usageAnalyticsRetention.alert
              ? `${usageAnalyticsRetention.alert.title}: ${usageAnalyticsRetention.alert.detail}${usageAnalyticsRetention.cleanupState === "overdue" ? ` The next cleanup was due by ${usageAnalyticsRetention.nextCleanupAt?.toISOString() ?? "an unknown time"}.` : ""}`
              : usageAnalyticsRetention.cleanupState === "overdue"
                ? `The Usage Lab retention cleanup is overdue; the worker was expected to attempt it by ${usageAnalyticsRetention.nextCleanupAt?.toISOString() ?? "an unknown time"}.`
                : usageAnalyticsRetention.status === "failed"
                  ? `The latest Usage Lab retention cleanup failed: ${usageAnalyticsRetention.latestError ?? "error details unavailable"}.`
                  : usageAnalyticsRetention.status === "healthy"
                    ? usageAnalyticsRetention.lastSuccessfulDeletedEvents === 0
                      ? "The latest Usage Lab retention cleanup completed successfully; no expired rows were found."
                      : `The latest Usage Lab retention cleanup completed successfully and deleted ${usageAnalyticsRetention.lastSuccessfulDeletedEvents} expired row${usageAnalyticsRetention.lastSuccessfulDeletedEvents === 1 ? "" : "s"}.`
                    : "The first Usage Lab retention cleanup is pending.",
          schedule: "Every 24 hours; worker-owned",
          retryPolicy:
            "A failed cleanup is recorded and retried on the next daily tick.",
          lastUpdated: usageAnalyticsRetention.lastAttemptAt,
          nextUpdate: usageAnalyticsRetention.nextCleanupAt,
          requestsToday: 0,
          requestsThisMonth: 0,
          remainingQuota: "Local database",
          metadata: {
            ...usageAnalyticsRetention,
            ...(usageAnalyticsRetentionResult.unavailable
              ? { healthCheck: "failed" }
              : {}),
          },
        },
        {
          provider: "espn",
          label: "ESPN schedule & teams",
          status: scheduleResult.unavailable
            ? "unavailable"
            : schedule.latestRun?.status === "success"
              ? "current"
              : schedule.latestRun?.status === "partial"
                ? "stale"
                : schedule.latestRun?.status === "failed"
                  ? "unavailable"
                  : espn.lastSuccessfulRequest
                    ? "current"
                    : "unavailable",
          detail: scheduleResult.unavailable
            ? healthCheckUnavailable("ESPN schedule")
            : schedule.latestRun
              ? `${schedule.records} persisted games; ${schedule.unfinished} unfinished windows remain refreshable.`
              : espn.lastSuccessfulRequest
                ? "Live schedule and team feed is responding."
                : "No successful schedule synchronization yet.",
          lastUpdated:
            schedule.lastUpdated ??
            espn.lastSuccessfulRequest?.toISOString() ??
            null,
          nextUpdate: scheduleJob?.nextRunAt ?? null,
          requestsToday: espn.requestsToday,
          requestsThisMonth: espn.requestsThisMonth,
          remainingQuota: "Public endpoint",
          metadata: {
            records: schedule.records,
            unfinished: schedule.unfinished,
            lastRun: schedule.latestRun,
            recentRuns: schedule.runs,
            timezone: scheduler.timezone,
            ...(scheduleResult.unavailable ? { healthCheck: "failed" } : {}),
          },
        },
        {
          provider: "nflverse",
          label: "NFLverse historical data",
          status:
            nflverseResult.unavailable ||
            scheduledNflverseRunsResult.unavailable
              ? "unavailable"
              : nflverse.status,
          detail:
            nflverseResult.unavailable ||
            scheduledNflverseRunsResult.unavailable
              ? healthCheckUnavailable("NFLverse")
              : nflverse.detail,
          schedule:
            "Tuesday at 2:00 PM ET; Wednesday at 2:00 PM ET during the season.",
          retryPolicy: "Up to 3 retries after 5, 15, and 45 minutes.",
          lastUpdated: nflverse.lastUpdated,
          nextUpdate: nflverseNextUpdate,
          requestsToday: nflverse.requestsToday,
          requestsThisMonth: nflverse.requestsThisMonth,
          remainingQuota: nflverse.remainingQuota,
          scheduledRuns: scheduledNflverseRuns,
          metadata: {
            ...nflverse.metadata,
            lastRun:
              scheduler.runs.find((run) => run.provider === "nflverse") ?? null,
            recentRuns: scheduler.runs
              .filter((run) => run.provider === "nflverse")
              .slice(0, 20),
            scheduledRuns: scheduledNflverseRuns,
            timezone: scheduler.timezone,
            ...(nflverseResult.unavailable ||
            scheduledNflverseRunsResult.unavailable
              ? { healthCheck: "failed" }
              : {}),
          },
        },
        {
          provider: "odds-api",
          label: "The Odds API",
          status: oddsResult.unavailable ? "unavailable" : odds.status,
          detail: oddsResult.unavailable
            ? healthCheckUnavailable("Odds API")
            : odds.detail,
          lastUpdated: odds.lastUpdated,
          nextUpdate: oddsJob?.nextRunAt ?? null,
          requestsToday: odds.requestsToday,
          requestsThisMonth: odds.requestsThisMonth,
          remainingQuota: odds.remainingQuota,
          metadata: {
            ...odds.metadata,
            scheduledLastRun:
              scheduler.runs.find((run) => run.provider === "odds-api") ?? null,
            scheduledRuns: scheduler.runs
              .filter((run) => run.provider === "odds-api")
              .slice(0, 20),
            timezone: scheduler.timezone,
            ...(oddsResult.unavailable ? { healthCheck: "failed" } : {}),
          },
        },
        {
          provider: "pregame-features",
          label: "Historical pregame features",
          status: featuresResult.unavailable
            ? "unavailable"
            : features.rows > 0
              ? "current"
              : "stale",
          detail: featuresResult.unavailable
            ? healthCheckUnavailable("pregame features")
            : features.rows > 0
              ? `${features.rows} versioned team/game rows; ${features.lowSampleRows} low-sample observations flagged.`
              : "Feature generation has not completed yet.",
          lastUpdated: features.latestGeneratedAt,
          nextUpdate: null,
          requestsToday: 0,
          requestsThisMonth: 0,
          remainingQuota: "Local database",
          metadata: {
            ...features,
            ...(featuresResult.unavailable ? { healthCheck: "failed" } : {}),
          },
        },
        {
          provider: "nws-weather",
          label: "National Weather Service forecasts",
          status:
            weatherResult.unavailable || scheduledWeatherRunsResult.unavailable
              ? "unavailable"
              : weather.lastRun?.status === "success"
                ? "current"
                : weather.lastRun
                  ? "stale"
                  : "unavailable",
          detail:
            weatherResult.unavailable || scheduledWeatherRunsResult.unavailable
              ? healthCheckUnavailable("NWS weather")
              : (weather.lastRun?.error ??
                "U.S. stadium forecasts use keyless api.weather.gov data; indoor games record no outdoor conditions."),
          schedule: "Every 6 hours during active season.",
          retryPolicy:
            "Up to 4 persisted attempts with 5, 15, and 45 minute backoff.",
          lastUpdated: weather.lastRun?.completedAt ?? null,
          nextUpdate: weatherNextUpdate,
          requestsToday: 0,
          requestsThisMonth: 0,
          remainingQuota: "Free keyless API; reasonable rate limits",
          scheduledRuns: scheduledWeatherRuns,
          metadata: {
            ...weather,
            ...(weatherResult.unavailable ||
            scheduledWeatherRunsResult.unavailable
              ? { healthCheck: "failed" }
              : {}),
          },
        },
        {
          provider: "espn-injuries",
          label: "ESPN injuries",
          status: injuryStatus,
          detail: injuryDetail,
          schedule:
            "Every 3 hours on NFL game days; twice daily on other active-season days; weekly during the offseason.",
          retryPolicy: "Up to 3 retries after 5, 15, and 45 minutes.",
          lastUpdated: availability.injury.lastUpdated,
          nextUpdate: injuryNextUpdate,
          requestsToday: 0,
          requestsThisMonth: 0,
          remainingQuota: "Public endpoint",
          scheduledRuns: scheduledInjuryRuns,
          metadata: {
            records: availability.injury.records,
            failures: availability.injury.failure
              ? [availability.injury.failure]
              : [],
            lastRun:
              scheduler.runs.find((run) => run.provider === "espn-injuries") ??
              null,
            scheduledRuns: scheduledInjuryRuns,
            timezone: scheduler.timezone,
            ...(injuryCheckUnavailable ? { healthCheck: "failed" } : {}),
          },
        },
        {
          provider: "espn-depth-charts",
          label: "ESPN depth charts",
          status: availabilityResult.unavailable
            ? "unavailable"
            : availability.depth.teams > 0
              ? "current"
              : availability.depth.failures.length
                ? "unavailable"
                : "stale",
          detail:
            availability.depth.teams > 0
              ? `${availability.depth.teams} teams updated; ${availability.depth.records} historical rows retained.`
              : availability.depth.failures.length
                ? `No structured rows captured; ${availability.depth.failures.length} team failures recorded.`
                : "The first depth-chart synchronization is pending.",
          lastUpdated: availability.depth.lastUpdated,
          nextUpdate: null,
          requestsToday: 0,
          requestsThisMonth: 0,
          remainingQuota: "Public endpoint",
          metadata: {
            teamsUpdated: availability.depth.teams,
            records: availability.depth.records,
            failures: availability.depth.failures,
            recentRuns: availability.runs.filter(
              (run) => run.provider === "espn-depth-charts",
            ),
            timezone: scheduler.timezone,
            ...(availabilityResult.unavailable
              ? { healthCheck: "failed" }
              : {}),
          },
        },
        {
          provider: "sleeper-players",
          label: "Sleeper NFL player snapshots",
          status: sleeperResult.unavailable ? "unavailable" : sleeper.status,
          detail: sleeperResult.unavailable
            ? healthCheckUnavailable("Sleeper")
            : sleeper.latestFailure && sleeper.status !== "current"
              ? sleeper.latestFailure
              : `${sleeper.snapshotCount} immutable rows; latest successful cycle received ${sleeper.playerCount} players across ${sleeper.teamCount} teams, with ${sleeper.depthOrderCount} depth-order values.`,
          schedule: `Every ${sleeper.cadenceHours} hours; worker-owned`,
          retryPolicy: "Up to 3 bounded attempts with a 30-second timeout.",
          lastUpdated: sleeper.lastUpdated,
          nextUpdate:
            scheduler.jobs.find((job) => job.jobKey === "sleeper-players")
              ?.nextRunAt ?? null,
          requestsToday: 0,
          requestsThisMonth: 0,
          remainingQuota: "Public endpoint",
          metadata: {
            ...sleeper,
            workerOwned: true,
            rawPayloadsExposed: false,
            scheduler:
              scheduler.jobs.find((job) => job.jobKey === "sleeper-players") ??
              null,
            ...(sleeperResult.unavailable ? { healthCheck: "failed" } : {}),
          },
        },
        {
          provider: "sleeper-identity-mapping",
          label: "Sleeper identity mapping",
          status: sleeperIdentityResult.unavailable
            ? "unavailable"
            : sleeperIdentity.status,
          detail: sleeperIdentityResult.unavailable
            ? healthCheckUnavailable("Sleeper identity mapping")
            : sleeperIdentity.latestFailure &&
                sleeperIdentity.status !== "current"
              ? sleeperIdentity.latestFailure
              : `${sleeperIdentity.metadata.suitabilityVerdict ?? "Mapping suitability is not available."} ` +
                `${sleeperIdentity.metadata.mappedCount ?? 0} of ${sleeperIdentity.metadata.totalSleeperRows ?? 0} rows mapped; ` +
                `current-team ${sleeperIdentity.metadata.currentTeamMappingPercentage ?? 0}%; ` +
                `depth-order ${sleeperIdentity.metadata.depthOrder && typeof sleeperIdentity.metadata.depthOrder === "object" && "percentage" in sleeperIdentity.metadata.depthOrder ? sleeperIdentity.metadata.depthOrder.percentage : 0}%; ` +
                `depth-order-1 ${sleeperIdentity.metadata.depthOrderOne && typeof sleeperIdentity.metadata.depthOrderOne === "object" && "percentage" in sleeperIdentity.metadata.depthOrderOne ? sleeperIdentity.metadata.depthOrderOne.percentage : 0}%; ` +
                `QB1 ${sleeperIdentity.metadata.qb1 && typeof sleeperIdentity.metadata.qb1 === "object" && "percentage" in sleeperIdentity.metadata.qb1 ? sleeperIdentity.metadata.qb1.percentage : 0}%.`,
          schedule: "After each successful Sleeper snapshot; worker-owned",
          retryPolicy:
            "Runs independently after snapshot capture; failures do not invalidate snapshots.",
          lastUpdated: sleeperIdentity.lastUpdated,
          nextUpdate: null,
          requestsToday: 0,
          requestsThisMonth: 0,
          remainingQuota: "Local database",
          metadata: {
            ...sleeperIdentity,
            workerOwned: true,
            rawPayloadsExposed: false,
            ...(sleeperIdentityResult.unavailable
              ? { healthCheck: "failed" }
              : {}),
          },
        },
        ]),
      );
    } finally {
      clearTimeout(routeAbortTimer);
    }
  };
}

router.get("/data-health", requireAdmin, createDataHealthHandler());

router.get(
  "/admin/sleeper-identity-report",
  requireAdmin,
  async (_req, res): Promise<void> => {
    res.json(
      GetSleeperIdentityReportResponse.parse(await getSleeperIdentityReport()),
    );
  },
);

export default router;
