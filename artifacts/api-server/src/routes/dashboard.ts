import { Router, type IRouter } from "express";
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
import { getSleeperIdentityHealth, getSleeperIdentityReport } from "../lib/sleeper-identity";
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

const router: IRouter = Router();

router.get("/dashboard/summary", requireAdmin, async (req, res): Promise<void> => {
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
});

router.get("/data-health", requireAdmin, async (req, res): Promise<void> => {
  const espn = getEspnHealth();
  const schedule = await getScheduleHealth();
  const nflverse = await getNflverseHealth();
  const availability = await getAvailabilityHealth();
  const sleeper = await getSleeperHealth();
  const sleeperIdentity = await getSleeperIdentityHealth();

  const [scheduledInjuryRuns, scheduledNflverseRuns, scheduledWeatherRuns] = await Promise.all([
    getRecentScheduledRuns("scheduled:injuries"),
    getRecentScheduledRuns("scheduled:nflverse"),
    getRecentScheduledRuns("scheduled:weather"),
  ]);
  const odds = await getOddsApiHealth();
  const scheduler = await getSchedulerHealth();
  const features = await getPregameFeatureHealth();
  const modelImmutability = await getModelArtifactImmutabilityStatus();
  const usageAnalyticsRetention = await getUsageAnalyticsRetentionHealth();
  const schedulerJob = (provider: string) =>
    scheduler.jobs
      .filter((job) => job.provider === provider && job.enabled)
      .sort((left, right) => (left.nextRunAt ?? "").localeCompare(right.nextRunAt ?? ""))[0];
  const scheduleJob = schedulerJob("espn-schedule");
  const oddsJob = schedulerJob("odds-api");
  const now = new Date();
  const gameDays = await getFeedGameDays(now);
  const injuryNextUpdate = nextFeedUpdate("injuries", now, scheduledInjuryRuns, gameDays)?.toISOString() ?? null;
  const nflverseNextUpdate = nextFeedUpdate("nflverse", now, scheduledNflverseRuns)?.toISOString() ?? null;
  const weatherNextUpdate = nextFeedUpdate("weather", now, scheduledWeatherRuns)?.toISOString() ?? null;
  const weather = await weatherHealth();
  const month = now.getUTCMonth() + 1;
  const latestFailedScheduledInjuryRun = scheduledInjuryRuns.find((run) => run.status === "failed");
  const nativeFailureAt = availability.injury.failureAt ? new Date(availability.injury.failureAt) : null;
  const scheduledFailureAt = latestFailedScheduledInjuryRun
    ? latestFailedScheduledInjuryRun.completedAt ?? latestFailedScheduledInjuryRun.startedAt
    : null;
  const latestFailureAt = scheduledFailureAt && nativeFailureAt
    ? scheduledFailureAt >= nativeFailureAt ? scheduledFailureAt : nativeFailureAt
    : scheduledFailureAt ?? nativeFailureAt;
  const lastSuccessfulInjuryAt = availability.injury.lastUpdated ? new Date(availability.injury.lastUpdated) : null;
  const latestFailureIsCurrent = Boolean(
    latestFailureAt
    && (!lastSuccessfulInjuryAt || latestFailureAt >= lastSuccessfulInjuryAt),
  );
  const maxInjuryAge = (month >= 3 && month <= 7 ? 8 * 24 : 30) * 60 * 60 * 1000;
  const injuryIsFresh = Boolean(
    lastSuccessfulInjuryAt
    && now.getTime() - lastSuccessfulInjuryAt.getTime() <= maxInjuryAge,
  );
  const latestFailureMessage = (scheduledFailureAt && nativeFailureAt && nativeFailureAt > scheduledFailureAt
    ? availability.injury.failure
    : latestFailedScheduledInjuryRun?.error ?? availability.injury.failure)
    ?? (latestFailureAt ? "Injury synchronization failed." : null);
  const injuryStatus = latestFailureIsCurrent
    ? availability.injury.records > 0 ? "stale" : "unavailable"
    : injuryIsFresh ? "current" : "stale";
  const injuryDetail = latestFailureMessage && latestFailureIsCurrent
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
        status: ["application_only", "database_and_application"].includes(modelImmutability.status) ? "current" : "unavailable",
        detail: modelImmutability.note,
        lastUpdated: now,
        nextUpdate: null,
        requestsToday: 0,
        requestsThisMonth: 0,
        remainingQuota: null,
        metadata: modelImmutability,
      },
      {
        provider: "scheduler",
        label: "Recurring synchronization",
        status: scheduler.status === "healthy" ? "current" : "stale",
        detail: scheduler.alerts.length > 0
          ? `${scheduler.alerts.length} durable worker scheduler alert${scheduler.alerts.length === 1 ? "" : "s"} detected. This API process only reports persisted state.`
          : scheduler.activeInThisProcess
            ? "The durable worker scheduler is active in this process. Persisted locks prevent duplicate work."
            : "This API process is healthy but does not own recurring work; persisted durable worker state has no backlog alerts.",
        lastUpdated: scheduler.processStartedAt,
        nextUpdate: scheduler.jobs
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
        },
      },
      {
        provider: "usage-analytics-retention",
        label: "Usage Lab analytics retention",
        status: usageAnalyticsRetention.status === "healthy"
          ? "current"
          : usageAnalyticsRetention.status === "failed"
            ? "unavailable"
            : "stale",
        detail: usageAnalyticsRetention.status === "failed"
          ? `The latest Usage Lab retention cleanup failed: ${usageAnalyticsRetention.latestError ?? "error details unavailable"}.`
          : usageAnalyticsRetention.status === "healthy"
            ? usageAnalyticsRetention.lastSuccessfulDeletedEvents === 0
              ? "The latest Usage Lab retention cleanup completed successfully; no expired rows were found."
              : `The latest Usage Lab retention cleanup completed successfully and deleted ${usageAnalyticsRetention.lastSuccessfulDeletedEvents} expired row${usageAnalyticsRetention.lastSuccessfulDeletedEvents === 1 ? "" : "s"}.`
            : "The first Usage Lab retention cleanup is pending.",
        schedule: "Every 24 hours; worker-owned",
        retryPolicy: "A failed cleanup is recorded and retried on the next daily tick.",
        lastUpdated: usageAnalyticsRetention.lastAttemptAt,
        nextUpdate: null,
        requestsToday: 0,
        requestsThisMonth: 0,
        remainingQuota: "Local database",
        metadata: usageAnalyticsRetention,
      },
      {
        provider: "espn",
        label: "ESPN schedule & teams",
        status: schedule.latestRun?.status === "success"
          ? "current"
          : schedule.latestRun?.status === "partial"
            ? "stale"
            : schedule.latestRun?.status === "failed"
              ? "unavailable"
              : espn.lastSuccessfulRequest
                ? "current"
                : "unavailable",
        detail: schedule.latestRun
          ? `${schedule.records} persisted games; ${schedule.unfinished} unfinished windows remain refreshable.`
          : espn.lastSuccessfulRequest
            ? "Live schedule and team feed is responding."
            : "No successful schedule synchronization yet.",
        lastUpdated: schedule.lastUpdated ?? espn.lastSuccessfulRequest?.toISOString() ?? null,
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
        },
      },
      {
        provider: "nflverse",
        label: "NFLverse historical data",
        status: nflverse.status,
        detail: nflverse.detail,
        schedule: "Tuesday at 2:00 PM ET; Wednesday at 2:00 PM ET during the season.",
        retryPolicy: "Up to 3 retries after 5, 15, and 45 minutes.",
        lastUpdated: nflverse.lastUpdated,
        nextUpdate: nflverseNextUpdate,
        requestsToday: nflverse.requestsToday,
        requestsThisMonth: nflverse.requestsThisMonth,
        remainingQuota: nflverse.remainingQuota,
        scheduledRuns: scheduledNflverseRuns,
        metadata: {
          ...nflverse.metadata,
          lastRun: scheduler.runs.find((run) => run.provider === "nflverse") ?? null,
          recentRuns: scheduler.runs.filter((run) => run.provider === "nflverse").slice(0, 20),
          scheduledRuns: scheduledNflverseRuns,
          timezone: scheduler.timezone,
        },
      },
      {
        provider: "odds-api",
        label: "The Odds API",
        status: odds.status,
        detail: odds.detail,
        lastUpdated: odds.lastUpdated,
        nextUpdate: oddsJob?.nextRunAt ?? null,
        requestsToday: odds.requestsToday,
        requestsThisMonth: odds.requestsThisMonth,
        remainingQuota: odds.remainingQuota,
        metadata: {
          ...odds.metadata,
          scheduledLastRun: scheduler.runs.find((run) => run.provider === "odds-api") ?? null,
          scheduledRuns: scheduler.runs.filter((run) => run.provider === "odds-api").slice(0, 20),
          timezone: scheduler.timezone,
        },
      },
      {
        provider: "pregame-features",
        label: "Historical pregame features",
        status: features.rows > 0 ? "current" : "stale",
        detail: features.rows > 0
          ? `${features.rows} versioned team/game rows; ${features.lowSampleRows} low-sample observations flagged.`
          : "Feature generation has not completed yet.",
        lastUpdated: features.latestGeneratedAt,
        nextUpdate: null,
        requestsToday: 0,
        requestsThisMonth: 0,
        remainingQuota: "Local database",
        metadata: features,
      },
      {
        provider: "nws-weather",
        label: "National Weather Service forecasts",
        status: weather.lastRun?.status === "success" ? "current" : weather.lastRun ? "stale" : "unavailable",
        detail: weather.lastRun?.error ?? "U.S. stadium forecasts use keyless api.weather.gov data; indoor games record no outdoor conditions.",
        schedule: "Every 6 hours during active season.",
        retryPolicy: "Up to 4 persisted attempts with 5, 15, and 45 minute backoff.",
        lastUpdated: weather.lastRun?.completedAt ?? null,
        nextUpdate: weatherNextUpdate,
        requestsToday: 0,
        requestsThisMonth: 0,
        remainingQuota: "Free keyless API; reasonable rate limits",
        scheduledRuns: scheduledWeatherRuns,
        metadata: weather,
      },
      {
        provider: "espn-injuries",
        label: "ESPN injuries",
        status: injuryStatus,
        detail: injuryDetail,
        schedule: "Every 3 hours on NFL game days; twice daily on other active-season days; weekly during the offseason.",
        retryPolicy: "Up to 3 retries after 5, 15, and 45 minutes.",
        lastUpdated: availability.injury.lastUpdated,
        nextUpdate: injuryNextUpdate,
        requestsToday: 0,
        requestsThisMonth: 0,
        remainingQuota: "Public endpoint",
        scheduledRuns: scheduledInjuryRuns,
        metadata: {
          records: availability.injury.records,
          failures: availability.injury.failure ? [availability.injury.failure] : [],
          lastRun: scheduler.runs.find((run) => run.provider === "espn-injuries") ?? null,
          scheduledRuns: scheduledInjuryRuns,
          timezone: scheduler.timezone,
        },
      },
      {
        provider: "espn-depth-charts",
        label: "ESPN depth charts",
        status: availability.depth.teams > 0 ? "current" : availability.depth.failures.length ? "unavailable" : "stale",
        detail: availability.depth.teams > 0
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
          recentRuns: availability.runs.filter((run) => run.provider === "espn-depth-charts"),
          timezone: scheduler.timezone,
        },
      },
      {
        provider: "sleeper-players",
        label: "Sleeper NFL player snapshots",
        status: sleeper.status,
        detail: sleeper.latestFailure && sleeper.status !== "current"
          ? sleeper.latestFailure
          : `${sleeper.snapshotCount} immutable rows; latest successful cycle received ${sleeper.playerCount} players across ${sleeper.teamCount} teams, with ${sleeper.depthOrderCount} depth-order values.`,
        schedule: `Every ${sleeper.cadenceHours} hours; worker-owned`,
        retryPolicy: "Up to 3 bounded attempts with a 30-second timeout.",
        lastUpdated: sleeper.lastUpdated,
        nextUpdate: scheduler.jobs.find((job) => job.jobKey === "sleeper-players")?.nextRunAt ?? null,
        requestsToday: 0,
        requestsThisMonth: 0,
        remainingQuota: "Public endpoint",
        metadata: {
          ...sleeper,
          workerOwned: true,
          rawPayloadsExposed: false,
          scheduler: scheduler.jobs.find((job) => job.jobKey === "sleeper-players") ?? null,
        },
      },
      {
        provider: "sleeper-identity-mapping",
        label: "Sleeper identity mapping",
        status: sleeperIdentity.status,
        detail: sleeperIdentity.latestFailure && sleeperIdentity.status !== "current"
          ? sleeperIdentity.latestFailure
          : `${sleeperIdentity.metadata.suitabilityVerdict ?? "Mapping suitability is not available."} `
            + `${sleeperIdentity.metadata.mappedCount ?? 0} of ${sleeperIdentity.metadata.totalSleeperRows ?? 0} rows mapped; `
            + `current-team ${sleeperIdentity.metadata.currentTeamMappingPercentage ?? 0}%; `
            + `depth-order ${sleeperIdentity.metadata.depthOrder && typeof sleeperIdentity.metadata.depthOrder === "object" && "percentage" in sleeperIdentity.metadata.depthOrder ? sleeperIdentity.metadata.depthOrder.percentage : 0}%; `
            + `depth-order-1 ${sleeperIdentity.metadata.depthOrderOne && typeof sleeperIdentity.metadata.depthOrderOne === "object" && "percentage" in sleeperIdentity.metadata.depthOrderOne ? sleeperIdentity.metadata.depthOrderOne.percentage : 0}%; `
            + `QB1 ${sleeperIdentity.metadata.qb1 && typeof sleeperIdentity.metadata.qb1 === "object" && "percentage" in sleeperIdentity.metadata.qb1 ? sleeperIdentity.metadata.qb1.percentage : 0}%.`,
        schedule: "After each successful Sleeper snapshot; worker-owned",
        retryPolicy: "Runs independently after snapshot capture; failures do not invalidate snapshots.",
        lastUpdated: sleeperIdentity.lastUpdated,
        nextUpdate: null,
        requestsToday: 0,
        requestsThisMonth: 0,
        remainingQuota: "Local database",
        metadata: {
          ...sleeperIdentity,
          workerOwned: true,
          rawPayloadsExposed: false,
        },
      },
    ]),
  );
});

router.get("/admin/sleeper-identity-report", requireAdmin, async (_req, res): Promise<void> => {
  res.json(GetSleeperIdentityReportResponse.parse(await getSleeperIdentityReport()));
});

export default router;
