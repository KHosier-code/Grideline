import { and, asc, desc, eq, gt, gte, inArray, lte } from "drizzle-orm";
import { Router, type IRouter } from "express";
import {
  db,
  gamesTable,
  pregameTeamFeaturesTable,
  predictionSnapshotsTable,
  sportsbookOddsTable,
  teamsTable,
  weatherForecastSnapshotsTable,
} from "@workspace/db";
import {
  gameSpecificSnapshot,
  getLatestValidPredictionSnapshots,
  getPredictionPerformance,
} from "../lib/live-predictions";

const router: IRouter = Router();
export const MAX_CONSUMER_GAMES = 100;
export const MAX_CONSUMER_MOVEMENT_ROWS = 200;
export const MAX_CONSUMER_SNAPSHOT_ROWS = MAX_CONSUMER_GAMES;
export const MAX_CONSUMER_PERFORMANCE_ROWS = 5_000;
const MAX_CONSUMER_MOVEMENTS = 24;
const PERSONNEL_CONTEXT_VERSION = "pregame-v4-personnel-context";

type ConsumerFilters = { season?: number; week?: number; gameId?: string };

export function safeNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

export function consumerFinalScore(game: Pick<typeof gamesTable.$inferSelect, "gameStatus" | "finalHomeScore" | "finalAwayScore">) {
  const status = (game.gameStatus ?? "").toLowerCase();
  const completed = status.includes("final") || status.includes("completed");
  return completed && game.finalHomeScore !== null && game.finalAwayScore !== null
    ? { home: game.finalHomeScore, away: game.finalAwayScore }
    : null;
}

function confidence(snapshot: typeof predictionSnapshotsTable.$inferSelect | undefined) {
  if (!snapshot) return { label: "Updating", score: null, reason: "Prediction data is being refreshed" };
  if (snapshot.lowSample) return { label: "Limited", score: safeNumber(snapshot.qbConfidence), reason: "Limited historical sample" };
  if (typeof snapshot.qbConfidence === "number" && snapshot.qbConfidence < 0.75) {
    return { label: "Moderate", score: snapshot.qbConfidence, reason: "Player information temporarily unavailable" };
  }
  return { label: "Standard", score: safeNumber(snapshot.qbConfidence), reason: null };
}

type ConsumerHomeTeam = { teamId: string; name: string; abbreviation: string };

export function consumerMarket(
  snapshot: typeof predictionSnapshotsTable.$inferSelect | undefined,
  home?: ConsumerHomeTeam,
) {
  const markets = (snapshot?.marketSnapshot as Record<string, any> | undefined)?.markets;
  const quote = (name: "spread" | "moneyline" | "total") => {
    const quotes = Array.isArray(markets?.[name]?.quotes) ? markets[name].quotes : [];
    const normalize = (value: unknown) => typeof value === "string"
      ? value.toLowerCase().replace(/[^a-z0-9]/g, "")
      : "";
    const isHome = (selection: unknown) => {
      if (!home) return false;
      const value = normalize(selection);
      return [home.teamId, home.name, home.abbreviation].some((candidate) => {
        const normalized = normalize(candidate);
        return normalized.length > 2 && (value.includes(normalized) || normalized.includes(value));
      });
    };
    const isCanonical = (value: Record<string, unknown>) => name === "total"
      ? normalize(value.selection).includes("over")
      : isHome(value.selection);
    const value = ["DraftKings", "FanDuel"]
      .flatMap((sportsbook) => quotes.filter((item: unknown) =>
        Boolean(item)
        && typeof item === "object"
        && (item as Record<string, unknown>).sportsbook === sportsbook))
      .find((item: Record<string, unknown>) => isCanonical(item));
    if (!value || typeof value !== "object") return null;
    const point = safeNumber(value.point);
    const price = safeNumber(value.price);
    return typeof value.sportsbook === "string" && price !== null
      ? {
          sportsbook: value.sportsbook,
          selection: name === "total" ? "Over" : home?.abbreviation ?? "Home",
          point,
          price,
          capturedAt: typeof value.capturedAt === "string" ? value.capturedAt : null,
        }
      : null;
  };
  const spread = quote("spread");
  const moneyline = quote("moneyline");
  const total = quote("total");
  const captured = [spread, moneyline, total]
    .map((item) => item?.capturedAt)
    .filter((value): value is string => Boolean(value))
    .sort()
    .at(-1) ?? null;
  return {
    spread,
    moneyline,
    total,
    evidence: {
      available: Boolean(spread || moneyline || total),
      capturedAt: captured,
      message: spread || moneyline || total ? null : "Sportsbook line updating",
    },
  };
}

type MovementRow = Pick<typeof sportsbookOddsTable.$inferSelect,
  "sportsbook" | "market" | "selection" | "point" | "price" | "capturedAt">;

export function serializeMovement(rows: MovementRow[]) {
  const retainedRows = [...rows]
    .sort((left, right) => right.capturedAt.getTime() - left.capturedAt.getTime())
    .slice(0, MAX_CONSUMER_MOVEMENT_ROWS);
  const ordered = retainedRows.sort((left, right) =>
    left.capturedAt.getTime() - right.capturedAt.getTime()
    || left.sportsbook.localeCompare(right.sportsbook)
    || left.market.localeCompare(right.market)
    || left.selection.localeCompare(right.selection));
  const streams = new Map<string, MovementRow[]>();
  for (const row of ordered) {
    const key = `${row.sportsbook}:${row.market}:${row.selection}`;
    streams.set(key, [...(streams.get(key) ?? []), row]);
  }
  const movements = [...streams.values()]
    .filter((stream) => stream.length > 1)
    .map((stream) => {
      const first = stream[0];
      const current = stream[stream.length - 1];
      return {
        sportsbook: current.sportsbook,
        market: current.market,
        selection: current.selection,
        earliestRetained: {
          point: safeNumber(first.point),
          price: first.price,
          capturedAt: first.capturedAt.toISOString(),
        },
        current: {
          point: safeNumber(current.point),
          price: current.price,
          capturedAt: current.capturedAt.toISOString(),
        },
        pointChange: first.point === null || current.point === null ? null : current.point - first.point,
        priceChange: current.price - first.price,
        observationsInWindow: stream.length,
      };
    })
    .sort((left, right) => right.current.capturedAt.localeCompare(left.current.capturedAt))
    .slice(0, MAX_CONSUMER_MOVEMENTS);
  return {
    available: movements.length > 0,
    movements,
    window: {
      maximumRows: MAX_CONSUMER_MOVEMENT_ROWS,
      truncated: rows.length > MAX_CONSUMER_MOVEMENT_ROWS,
    },
    message: movements.length ? null : "Line movement is not yet available",
  };
}

type PersistedContext = {
  dataConfidence?: { overall?: unknown };
  teams?: Record<string, {
    qb?: { starterCertainty?: unknown; starterChange?: unknown };
    injuries?: Record<string, { impactScore?: unknown }>;
    personnelCompleteness?: unknown;
  }>;
};

export function serializeContext(context: PersistedContext | null, homeTeamId: string, awayTeamId: string) {
  if (!context) {
    return {
      available: false,
      dataConfidence: null,
      teams: [],
      drivers: [],
      message: "Player information temporarily unavailable",
    };
  }
  const teams = [
    { side: "home" as const, teamId: homeTeamId },
    { side: "away" as const, teamId: awayTeamId },
  ].map(({ side, teamId }) => {
    const team = context.teams?.[teamId];
    return {
      side,
      qbCertainty: safeNumber(team?.qb?.starterCertainty),
      qbChange: typeof team?.qb?.starterChange === "boolean" ? team.qb.starterChange : null,
      personnelCompleteness: safeNumber(team?.personnelCompleteness),
      offenseInjuryImpact: safeNumber(team?.injuries?.offense?.impactScore),
      defenseInjuryImpact: safeNumber(team?.injuries?.defense?.impactScore),
    };
  });
  const drivers = teams.flatMap((team) => [
    ...(team.qbChange === true ? [`${team.side === "home" ? "Home" : "Away"} quarterback change is supported by persisted pregame evidence.`] : []),
    ...(team.offenseInjuryImpact !== null && team.offenseInjuryImpact >= 25
      ? [`${team.side === "home" ? "Home" : "Away"} offense has elevated injury impact.`] : []),
    ...(team.defenseInjuryImpact !== null && team.defenseInjuryImpact >= 25
      ? [`${team.side === "home" ? "Home" : "Away"} defense has elevated injury impact.`] : []),
  ]).slice(0, 4);
  return {
    available: true,
    dataConfidence: safeNumber(context.dataConfidence?.overall),
    teams,
    drivers,
    message: null,
  };
}

export function serializePerformance(performance: Awaited<ReturnType<typeof getPredictionPerformance>>) {
  const metric = (value: unknown) => safeNumber(value);
  const family = (value: Record<string, unknown>) => ({
    predictions: typeof value.predictions === "number" ? value.predictions : 0,
    mae: metric(value.mae),
    rmse: metric(value.rmse),
    accuracy: metric(value.accuracy),
    brier: metric(value.brier),
    logLoss: metric(value.logLoss),
    avgClv: metric(value.avgClv),
  });
  const breakdown = (items: Array<Record<string, unknown>>) => items.map((item) => ({
    group: typeof item.group === "string" ? item.group : "unavailable",
    predictions: typeof item.predictions === "number" ? item.predictions : 0,
    spreadMae: metric(item.spreadMae),
    totalsMae: metric(item.totalsMae),
    moneylineAccuracy: metric(item.moneylineAccuracy),
    avgClv: metric(item.avgClv),
  }));
  return {
    status: performance.status === "measured" ? "available" as const : "unavailable" as const,
    officialPredictions: performance.officialPredictions,
    gradedPredictions: performance.gradedPredictions,
    byFamily: {
      spread: family(performance.byFamily.spread),
      moneyline: family(performance.byFamily.moneyline),
      totals: family(performance.byFamily.totals),
    },
    breakdowns: {
      season: breakdown(performance.breakdowns.season),
      week: breakdown(performance.breakdowns.week),
      confidence: breakdown(performance.breakdowns.sampleQuality),
      edge: breakdown(performance.breakdowns.edge),
    },
    window: {
      maximumOfficialPredictions: MAX_CONSUMER_PERFORMANCE_ROWS,
      truncated: performance.windowTruncated,
    },
    note: "Winner accuracy, projection error, ATS/O/U results, and CLV are separate measures. Market outcomes appear only where legitimate evidence exists.",
  };
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
    getLatestValidPredictionSnapshots(games.map((game) => game.gameId), {
      preKickoffOnly: true,
      authoritativeGameKickoff: true,
      maxRows: MAX_CONSUMER_SNAPSHOT_ROWS,
    }),
  ]);
  const teamsById = new Map(teams.map((team) => [team.teamId, team]));
  return games.map((game) => {
    const snapshot = gameSpecificSnapshot(game.gameId, snapshots);
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
      finalScore: consumerFinalScore(game),
      prediction: snapshot ? {
        modelLabel: "Gridline Production Model",
        projectedHomeScore: safeNumber(snapshot.projectedHomeScore),
        projectedAwayScore: safeNumber(snapshot.projectedAwayScore),
        projectedMargin: safeNumber(snapshot.projectedMargin),
        projectedTotal: safeNumber(snapshot.projectedTotal),
        homeWinProbability: safeNumber(snapshot.homeWinProbability),
        awayWinProbability: safeNumber(snapshot.awayWinProbability),
      } : null,
      market: consumerMarket(snapshot, home ? { teamId: home.teamId, name: home.teamName, abbreviation: home.abbreviation } : undefined),
      dataConfidence: confidence(snapshot),
      availability: {
        prediction: snapshot ? null : "Prediction pending — incomplete model inputs",
        market: consumerMarket(snapshot, home ? { teamId: home.teamId, name: home.teamName, abbreviation: home.abbreviation } : undefined).evidence.available ? null : "Sportsbook line updating",
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
    const sourceCutoff = game.kickoffTime
      ? new Date(Math.min(Date.now(), new Date(game.kickoffTime).getTime()))
      : new Date();
    const kickoff = game.kickoffTime ? new Date(game.kickoffTime) : null;
    const [weather, contextRows, movementRows] = await Promise.all([
      db.select().from(weatherForecastSnapshotsTable)
        .where(and(
          eq(weatherForecastSnapshotsTable.gameId, game.gameId),
          lte(weatherForecastSnapshotsTable.fetchedAt, sourceCutoff),
          kickoff ? gte(weatherForecastSnapshotsTable.validTime, new Date(kickoff.getTime() - 12 * 60 * 60 * 1000)) : undefined,
          kickoff ? lte(weatherForecastSnapshotsTable.validTime, new Date(kickoff.getTime() + 12 * 60 * 60 * 1000)) : undefined,
        ))
        .orderBy(desc(weatherForecastSnapshotsTable.fetchedAt), desc(weatherForecastSnapshotsTable.id))
        .limit(1),
      db.select({
        featureAudit: pregameTeamFeaturesTable.featureAudit,
      }).from(pregameTeamFeaturesTable)
        .where(and(
          eq(pregameTeamFeaturesTable.gameId, game.gameId),
          eq(pregameTeamFeaturesTable.featureVersion, PERSONNEL_CONTEXT_VERSION),
          lte(pregameTeamFeaturesTable.sourceCutoff, sourceCutoff),
        ))
        .orderBy(desc(pregameTeamFeaturesTable.generatedAt))
        .limit(2),
      db.select({
        sportsbook: sportsbookOddsTable.sportsbook,
        market: sportsbookOddsTable.market,
        selection: sportsbookOddsTable.selection,
        point: sportsbookOddsTable.point,
        price: sportsbookOddsTable.price,
        capturedAt: sportsbookOddsTable.capturedAt,
      }).from(sportsbookOddsTable)
        .where(and(
          eq(sportsbookOddsTable.gameId, game.gameId),
          lte(sportsbookOddsTable.capturedAt, sourceCutoff),
        ))
        .orderBy(desc(sportsbookOddsTable.capturedAt), desc(sportsbookOddsTable.id))
        .limit(MAX_CONSUMER_MOVEMENT_ROWS + 1),
    ]);
    const forecast = weather[0];
    const context = (contextRows[0]?.featureAudit as Record<string, unknown> | undefined)
      ?._personnel_context as PersistedContext | undefined;
    // Team IDs are used only to locate persisted context and are never serialized.
    const [gameRow] = await db.select({
      homeTeamId: gamesTable.homeTeamId,
      awayTeamId: gamesTable.awayTeamId,
    }).from(gamesTable).where(eq(gamesTable.gameId, game.gameId)).limit(1);
    const finalizedContext = serializeContext(context ?? null, gameRow?.homeTeamId ?? "", gameRow?.awayTeamId ?? "");
    const movement = serializeMovement(movementRows);
    res.json({
      ...game,
      weather: forecast ? {
        available: true,
        summary: forecast.weatherSummary,
        temperature: safeNumber(forecast.temperature),
        sustainedWind: safeNumber(forecast.sustainedWind),
        windGust: safeNumber(forecast.windGust),
        precipitationProbability: safeNumber(forecast.precipitationProbability),
        precipitationType: forecast.precipitationType,
        humidity: safeNumber(forecast.humidity),
        indoorOutdoor: forecast.indoorOutdoor,
        roofStatus: forecast.roofStatus,
        validTime: forecast.validTime.toISOString(),
        message: null,
      } : {
        available: false,
        summary: null,
        temperature: null,
        sustainedWind: null,
        windGust: null,
        precipitationProbability: null,
        precipitationType: null,
        humidity: null,
        indoorOutdoor: null,
        roofStatus: null,
        validTime: null,
        message: "Weather not yet available",
      },
      movement,
      context: finalizedContext,
      analysis: {
        drivers: finalizedContext.drivers,
        availability: {
          weather: forecast ? null : "Weather not yet available",
          personnel: finalizedContext.message,
          movement: movement.available ? null : movement.message,
        },
      },
    });
  } catch (error) {
    req.log.error({ error }, "Consumer game detail read failed");
    res.status(503).json({ error: "Prediction data is being refreshed", code: "consumer_data_unavailable" });
  }
});

router.get("/consumer/performance", async (req, res): Promise<void> => {
  try {
    res.json(serializePerformance(await getPredictionPerformance(MAX_CONSUMER_PERFORMANCE_ROWS)));
  } catch (error) {
    req.log.error({ error }, "Consumer performance read failed");
    res.status(503).json({ error: "Performance data is being refreshed", code: "consumer_data_unavailable" });
  }
});

router.get("/consumer/trends", async (req, res): Promise<void> => {
  try {
    const performance = serializePerformance(await getPredictionPerformance(MAX_CONSUMER_PERFORMANCE_ROWS));
    res.json({
      status: performance.status,
      byWeek: performance.breakdowns.week,
      byConfidence: performance.breakdowns.confidence,
      byEdge: performance.breakdowns.edge,
      window: performance.window,
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