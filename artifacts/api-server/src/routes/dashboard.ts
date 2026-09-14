import { Router, type IRouter } from "express";
import { GetDashboardSummaryResponse, GetDataHealthResponse } from "@workspace/api-zod";
import { fetchSchedule, getEspnHealth, logEspnFailure } from "../lib/espn";
import { getNflverseHealth } from "../lib/nflverse";
import { resolveCurrentSeasonWeek } from "../lib/season";
import { getAvailabilityHealth } from "../lib/availability";

const router: IRouter = Router();

router.get("/dashboard/summary", async (req, res): Promise<void> => {
  const { season, week } = await resolveCurrentSeasonWeek();
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
      modelStatus: "not_trained",
      ats: { record: "—", winRate: null, units: null, roi: null },
      moneyline: { record: "—", winRate: null, units: null, roi: null },
      totals: { record: "—", winRate: null, units: null, roi: null },
      averageClv: null,
      topEdges: [],
    }),
  );
});

router.get("/data-health", async (req, res): Promise<void> => {
  const current = await resolveCurrentSeasonWeek();
  try {
    await fetchSchedule(current.season, current.week);
  } catch (error) {
    logEspnFailure(error);
    req.log.warn({ error }, "Data health could not refresh ESPN");
  }
  const espn = getEspnHealth();
  const nflverse = await getNflverseHealth();
  const availability = await getAvailabilityHealth();
  const oddsConfigured = Boolean(process.env.ODDS_API_KEY);
  res.json(
    GetDataHealthResponse.parse([
      {
        provider: "espn",
        label: "ESPN schedule & teams",
        status: espn.lastSuccessfulRequest ? "current" : "unavailable",
        detail: espn.lastSuccessfulRequest
          ? "Live schedule and team feed is responding."
          : "No successful live request yet.",
        lastUpdated: espn.lastSuccessfulRequest?.toISOString() ?? null,
        nextUpdate: null,
        requestsToday: espn.requestsToday,
        requestsThisMonth: espn.requestsThisMonth,
        remainingQuota: "Public endpoint",
      },
      {
        provider: "nflverse",
        label: "NFLverse historical data",
        status: nflverse.status,
        detail: nflverse.detail,
        lastUpdated: nflverse.lastUpdated,
        nextUpdate: null,
        requestsToday: nflverse.requestsToday,
        requestsThisMonth: nflverse.requestsThisMonth,
        remainingQuota: nflverse.remainingQuota,
        metadata: nflverse.metadata,
      },
      {
        provider: "odds-api",
        label: "The Odds API",
        status: oddsConfigured ? "stale" : "not_configured",
        detail: oddsConfigured
          ? "Secret is configured; sportsbook snapshot adapter is next."
          : "Add ODDS_API_KEY in Secrets to enable DraftKings and FanDuel snapshots.",
        lastUpdated: null,
        nextUpdate: null,
        requestsToday: 0,
        requestsThisMonth: 0,
        remainingQuota: null,
      },
      {
        provider: "espn-injuries",
        label: "ESPN injuries",
        status: availability.injury.records > 0 ? "current" : availability.injury.failure ? "unavailable" : "stale",
        detail: availability.injury.records > 0
          ? `${availability.injury.records} immutable injury snapshots captured.`
          : availability.injury.failure ?? "The first injury synchronization is pending.",
        lastUpdated: availability.injury.lastUpdated,
        nextUpdate: null,
        requestsToday: 0,
        requestsThisMonth: 0,
        remainingQuota: "Public endpoint",
        metadata: { records: availability.injury.records, failures: availability.injury.failure ? [availability.injury.failure] : [] },
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
        metadata: { teamsUpdated: availability.depth.teams, records: availability.depth.records, failures: availability.depth.failures },
      },
    ]),
  );
});

export default router;