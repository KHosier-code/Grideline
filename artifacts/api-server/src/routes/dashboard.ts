import { Router, type IRouter } from "express";
import { GetDashboardSummaryResponse, GetDataHealthResponse } from "@workspace/api-zod";
import { fetchSchedule, getEspnHealth, logEspnFailure } from "../lib/espn";
import { getNflverseHealth } from "../lib/nflverse";
import { getCurrentSeasonWeek } from "../lib/season";

const router: IRouter = Router();

router.get("/dashboard/summary", async (req, res): Promise<void> => {
  const { season, week } = getCurrentSeasonWeek();
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
  const current = getCurrentSeasonWeek();
  try {
    await fetchSchedule(current.season, current.week);
  } catch (error) {
    logEspnFailure(error);
    req.log.warn({ error }, "Data health could not refresh ESPN");
  }
  const espn = getEspnHealth();
  const nflverse = getNflverseHealth();
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
        provider: "injuries-depth",
        label: "Injuries & depth charts",
        status: "stale",
        detail: "Historical snapshot tables are ready; the first scheduled sync is pending.",
        lastUpdated: null,
        nextUpdate: null,
        requestsToday: 0,
        requestsThisMonth: 0,
        remainingQuota: "ESPN adapter planned",
      },
    ]),
  );
});

export default router;