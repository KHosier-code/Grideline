import { and, asc, desc, eq, gt, inArray } from "drizzle-orm";
import { Router, type IRouter } from "express";
import {
  db,
  gamesTable,
  predictionSnapshotsTable,
  teamsTable,
  weatherForecastSnapshotsTable,
} from "@workspace/db";
import {
  getLatestValidPredictionSnapshots,
  getPredictionPerformance,
} from "../lib/live-predictions";

const router: IRouter = Router();
const MAX_CONSUMER_GAMES = 100;

type ConsumerFilters = { season?: number; week?: number; gameId?: string };

function safeNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function confidence(snapshot: typeof predictionSnapshotsTable.$inferSelect | undefined) {
  if (!snapshot) return { label: "Updating", score: null, reason: "Prediction data is being refreshed" };
  if (snapshot.lowSample) return { label: "Limited", score: safeNumber(snapshot.qbConfidence), reason: "Limited historical sample" };
  if (typeof snapshot.qbConfidence === "number" && snapshot.qbConfidence < 0.75) {
    return { label: "Moderate", score: snapshot.qbConfidence, reason: "Player information temporarily unavailable" };
  }
  return { label: "Standard", score: safeNumber(snapshot.qbConfidence), reason: null };
}

function market(snapshot: typeof predictionSnapshotsTable.$inferSelect | undefined) {
  const markets = (snapshot?.marketSnapshot as Record<string, any> | undefined)?.markets;
  const quote = (name: "spread" | "moneyline" | "total") => {
    const value = markets?.[name]?.bestAvailable;
    if (!value || typeof value !== "object") return null;
    const point = safeNumber(value.point);
    const price = safeNumber(value.price);
    return typeof value.sportsbook === "string" && price !== null
      ? { sportsbook: value.sportsbook, point, price, capturedAt: typeof value.capturedAt === "string" ? value.capturedAt : null }
      : null;
  };
  return { spread: quote("spread"), moneyline: quote("moneyline"), total: quote("total") };
}

async function consumerGames(filters: ConsumerFilters = {}) {
  const conditions = [
    filters.season === undefined ? undefined : eq(gamesTable.season, filters.season),
    filters.week === undefined ? undefined : eq(gamesTable.week, filters.week),
    filters.gameId === undefined ? undefined : eq(gamesTable.gameId, filters.gameId),
    filters.season === undefined && filters.week === undefined && filters.gameId === undefined
      ? gt(gamesTable.kickoffTime, new Date())
      : undefined,
  ].filter((condition): condition is NonNullable<typeof condition> => Boolean(condition));
  const games = await db.select().from(gamesTable)
    .where(conditions.length ? and(...conditions) : undefined)
    .orderBy(asc(gamesTable.kickoffTime), asc(gamesTable.gameId))
    .limit(MAX_CONSUMER_GAMES);
  const teamIds = [...new Set(games.flatMap((game) => [game.homeTeamId, game.awayTeamId]))];
  const [teams, snapshots] = await Promise.all([
    teamIds.length ? db.select().from(teamsTable).where(inArray(teamsTable.teamId, teamIds)) : [],
    getLatestValidPredictionSnapshots(games.map((game) => game.gameId)),
  ]);
  const teamsById = new Map(teams.map((team) => [team.teamId, team]));
  return games.map((game) => {
    const snapshot = snapshots.get(game.gameId);
    const home = teamsById.get(game.homeTeamId);
    const away = teamsById.get(game.awayTeamId);
    return {
      gameId: game.gameId,
      season: game.season,
      week: game.week,
      kickoffTime: game.kickoffTime?.toISOString() ?? null,
      gameStatus: game.gameStatus,
      venue: game.stadium,
      matchup: {
        home: { name: home?.teamName ?? "Team unavailable", abbreviation: home?.abbreviation ?? "—", logoUrl: home?.logoUrl ?? null },
        away: { name: away?.teamName ?? "Team unavailable", abbreviation: away?.abbreviation ?? "—", logoUrl: away?.logoUrl ?? null },
      },
      finalScore: game.finalHomeScore === null || game.finalAwayScore === null
        ? null : { home: game.finalHomeScore, away: game.finalAwayScore },
      prediction: snapshot ? {
        modelLabel: "Gridline Production Model",
        projectedHomeScore: safeNumber(snapshot.projectedHomeScore),
        projectedAwayScore: safeNumber(snapshot.projectedAwayScore),
        projectedMargin: safeNumber(snapshot.projectedMargin),
        projectedTotal: safeNumber(snapshot.projectedTotal),
        homeWinProbability: safeNumber(snapshot.homeWinProbability),
        awayWinProbability: safeNumber(snapshot.awayWinProbability),
      } : null,
      market: market(snapshot),
      dataConfidence: confidence(snapshot),
      availability: {
        prediction: snapshot ? null : "Prediction data is being refreshed",
        market: snapshot && (market(snapshot).spread || market(snapshot).moneyline || market(snapshot).total) ? null : "Sportsbook line updating",
      },
    };
  });
}

router.get("/consumer/dashboard", async (_req, res): Promise<void> => {
  try {
    const games = await consumerGames();
    res.json({ status: games.length ? "available" : "unavailable", games, note: "Persisted snapshots only; this endpoint never starts model computation or data synchronization." });
  } catch (error) {
    _req.log.error({ error }, "Consumer dashboard read failed");
    res.status(503).json({ error: "Prediction data is being refreshed", code: "consumer_data_unavailable" });
  }
});

router.get("/consumer/games", async (req, res): Promise<void> => {
  const parseNumber = (value: unknown) => typeof value === "string" && /^\d+$/.test(value) ? Number(value) : undefined;
  const season = parseNumber(req.query.season);
  const week = parseNumber(req.query.week);
  if ((req.query.season !== undefined && (season === undefined || season < 2020)) || (req.query.week !== undefined && (week === undefined || week < 1 || week > 22))) {
    res.status(400).json({ error: "Choose a valid season and week.", code: "invalid_request" });
    return;
  }
  try {
    const games = await consumerGames({ season, week });
    res.json({ status: games.length ? "available" : "unavailable", games });
  } catch (error) {
    req.log.error({ error }, "Consumer games read failed");
    res.status(503).json({ error: "Prediction data is being refreshed", code: "consumer_data_unavailable" });
  }
});

router.get("/consumer/games/:gameId", async (req, res): Promise<void> => {
  try {
    const game = (await consumerGames({ gameId: req.params.gameId }))[0];
    if (!game) {
      res.status(404).json({ error: "This game is not available.", code: "game_not_found" });
      return;
    }
    const weather = await db.select().from(weatherForecastSnapshotsTable)
      .where(eq(weatherForecastSnapshotsTable.gameId, game.gameId))
      .orderBy(desc(weatherForecastSnapshotsTable.fetchedAt))
      .limit(1);
    const forecast = weather[0];
    res.json({
      ...game,
      weather: forecast ? {
        summary: forecast.weatherSummary,
        temperature: safeNumber(forecast.temperature),
        sustainedWind: safeNumber(forecast.sustainedWind),
        precipitationProbability: safeNumber(forecast.precipitationProbability),
        validTime: forecast.validTime.toISOString(),
      } : null,
      analysis: {
        drivers: [],
        availability: {
          weather: forecast ? null : "Weather not yet available",
          personnel: "Player information temporarily unavailable",
        },
      },
    });
  } catch (error) {
    req.log.error({ error }, "Consumer game detail read failed");
    res.status(503).json({ error: "Prediction data is being refreshed", code: "consumer_data_unavailable" });
  }
});

function consumerPerformancePayload(performance: Awaited<ReturnType<typeof getPredictionPerformance>>) {
  return {
    status: performance.status === "measured" ? "available" : "unavailable",
    officialPredictions: performance.officialPredictions,
    gradedPredictions: performance.gradedPredictions,
    byFamily: performance.byFamily,
    breakdowns: {
      season: performance.breakdowns.season,
      week: performance.breakdowns.week,
      confidence: performance.breakdowns.sampleQuality,
      edge: performance.breakdowns.edge,
    },
    note: "Winner accuracy, projection error, ATS/O/U results, and CLV are separate measures. Market outcomes appear only where legitimate evidence exists.",
  };
}

router.get("/consumer/performance", async (req, res): Promise<void> => {
  try {
    res.json(consumerPerformancePayload(await getPredictionPerformance()));
  } catch (error) {
    req.log.error({ error }, "Consumer performance read failed");
    res.status(503).json({ error: "Performance data is being refreshed", code: "consumer_data_unavailable" });
  }
});

router.get("/consumer/trends", async (req, res): Promise<void> => {
  try {
    const performance = consumerPerformancePayload(await getPredictionPerformance());
    res.json({
      status: performance.status,
      byWeek: performance.breakdowns.week,
      byConfidence: performance.breakdowns.confidence,
      byEdge: performance.breakdowns.edge,
      note: "Trends are derived from persisted, graded official predictions only.",
    });
  } catch (error) {
    req.log.error({ error }, "Consumer trends read failed");
    res.status(503).json({ error: "Trend data is being refreshed", code: "consumer_data_unavailable" });
  }
});

router.get("/consumer/props", (_req, res): void => {
  res.json({ status: "unavailable", message: "Player information temporarily unavailable", available: false });
});

export default router;