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
export const CONSUMER_MARKET_STALE_MINUTES = 30;
const SUPPORTED_CONSUMER_BOOKS = new Set(["DraftKings", "FanDuel"]);
const SUPPORTED_CONSUMER_MARKETS = new Set(["spread", "total", "moneyline"]);
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

const normalizeSelection = (value: unknown) => typeof value === "string"
  ? value.toLowerCase().replace(/[^a-z0-9]/g, "")
  : "";

function isHomeSelection(selection: unknown, home?: ConsumerHomeTeam) {
  if (!home) return false;
  const value = normalizeSelection(selection);
  return [home.teamId, home.name, home.abbreviation].some((candidate) => {
    const normalized = normalizeSelection(candidate);
    return normalized.length > 2 && (value.includes(normalized) || normalized.includes(value));
  });
}

function validAmericanOdds(value: unknown): value is number {
  return typeof value === "number"
    && Number.isInteger(value)
    && (value <= -100 || value >= 100);
}

export function americanOddsImpliedProbability(value: unknown): number | null {
  if (!validAmericanOdds(value)) return null;
  return value < 0 ? Math.abs(value) / (Math.abs(value) + 100) : 100 / (value + 100);
}

export function consumerMarket(
  snapshot: typeof predictionSnapshotsTable.$inferSelect | undefined,
  home?: ConsumerHomeTeam,
) {
  const markets = (snapshot?.marketSnapshot as Record<string, any> | undefined)?.markets;
  const quote = (name: "spread" | "moneyline" | "total") => {
    const quotes = Array.isArray(markets?.[name]?.quotes) ? markets[name].quotes : [];
    const isCanonical = (value: Record<string, unknown>) => name === "total"
      ? normalizeSelection(value.selection).includes("over")
      : isHomeSelection(value.selection, home);
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

type BoardPrediction = Pick<typeof predictionSnapshotsTable.$inferSelect,
  "projectedMargin" | "projectedTotal" | "homeWinProbability" | "predictionTimestamp">;

const quoteFromMovement = (row: MovementRow, market: "spread" | "total" | "moneyline", home?: ConsumerHomeTeam) => ({
  sportsbook: row.sportsbook,
  selection: market === "total" ? "Over" : home?.abbreviation ?? "Home",
  point: safeNumber(row.point),
  price: row.price,
  capturedAt: row.capturedAt.toISOString(),
});

export function buildConsumerMarketBoard(
  snapshot: BoardPrediction | undefined,
  rows: MovementRow[],
  home: ConsumerHomeTeam | undefined,
  kickoffTime: Date | null,
  now = new Date(),
) {
  const cutoff = kickoffTime && kickoffTime.getTime() < now.getTime() ? kickoffTime : now;
  const eligible = rows.filter((row) =>
    SUPPORTED_CONSUMER_BOOKS.has(row.sportsbook)
    && SUPPORTED_CONSUMER_MARKETS.has(row.market)
    && row.capturedAt.getTime() <= cutoff.getTime());
  const specs = [
    { market: "spread" as const, label: "Home spread", modelValue: safeNumber(snapshot?.projectedMargin), unit: "points" as const },
    { market: "total" as const, label: "Game total", modelValue: safeNumber(snapshot?.projectedTotal), unit: "points" as const },
    { market: "moneyline" as const, label: "Home moneyline", modelValue: safeNumber(snapshot?.homeWinProbability), unit: "probability_points" as const },
  ];
  const comparisons = specs.map((spec) => {
    const canonical = eligible.filter((row) =>
      row.market === spec.market
      && validAmericanOdds(row.price)
      && (spec.market === "moneyline" || safeNumber(row.point) !== null)
      && (spec.market === "total"
        ? normalizeSelection(row.selection).includes("over")
        : isHomeSelection(row.selection, home)));
    const currentByBook = ["DraftKings", "FanDuel"].flatMap((sportsbook) => {
      const stream = canonical.filter((row) => row.sportsbook === sportsbook);
      return stream.length ? [stream[stream.length - 1]] : [];
    });
    const ranked = [...currentByBook].sort((left, right) => {
      if (spec.market === "spread" && left.point !== right.point) return (right.point ?? -Infinity) - (left.point ?? -Infinity);
      if (spec.market === "total" && left.point !== right.point) return (left.point ?? Infinity) - (right.point ?? Infinity);
      if (left.price !== right.price) return right.price - left.price;
      return left.sportsbook.localeCompare(right.sportsbook);
    });
    const selected = ranked[0];
    const first = selected
      ? canonical.find((row) => row.sportsbook === selected.sportsbook)
      : undefined;
    const marketValue = selected
      ? spec.market === "moneyline" ? americanOddsImpliedProbability(selected.price) : safeNumber(selected.point)
      : null;
    const difference = spec.modelValue !== null && marketValue !== null
      ? spec.market === "spread"
        ? spec.modelValue + marketValue
        : (spec.modelValue - marketValue) * (spec.market === "moneyline" ? 100 : 1)
      : null;
    const stale = Boolean(selected
      && cutoff.getTime() - selected.capturedAt.getTime() > CONSUMER_MARKET_STALE_MINUTES * 60_000);
    return {
      market: spec.market,
      label: spec.label,
      state: selected ? stale ? "stale" as const : "available" as const : "absent" as const,
      modelValue: spec.modelValue,
      marketValue,
      difference,
      differenceUnit: spec.unit,
      selectedQuote: selected ? quoteFromMovement(selected, spec.market, home) : null,
      firstObserved: first ? quoteFromMovement(first, spec.market, home) : null,
      current: selected ? quoteFromMovement(selected, spec.market, home) : null,
      modelTimestamp: snapshot?.predictionTimestamp.toISOString() ?? null,
      marketTimestamp: selected?.capturedAt.toISOString() ?? null,
    };
  });
  const available = comparisons.filter((item) => item.state === "available").length;
  const stale = comparisons.filter((item) => item.state === "stale").length;
  return {
    status: available === 3 ? "available" as const
      : available > 0 ? "partial" as const
      : stale > 0 ? "stale" as const
      : "absent" as const,
    staleAfterMinutes: CONSUMER_MARKET_STALE_MINUTES,
    selectionRule: "Best means the most favorable canonical line point, then the higher American price when points match; exact ties prefer DraftKings.",
    comparisons,
  };
}

export function summarizeConsumerMarketBoards(games: Array<{ marketBoard: ReturnType<typeof buildConsumerMarketBoard> }>) {
  const statuses = games.map((game) => game.marketBoard.status);
  const coveredBy = (sportsbook: string) => games.filter((game) =>
    game.marketBoard.comparisons.some((comparison) => comparison.selectedQuote?.sportsbook === sportsbook)).length;
  return {
    status: !games.length ? "absent" as const
      : statuses.every((value) => value === "available") ? "available" as const
      : statuses.some((value) => value === "available" || value === "partial") ? "partial" as const
      : statuses.some((value) => value === "stale") ? "stale" as const
      : "absent" as const,
    coverage: {
      games: games.length,
      gamesWithComparison: games.filter((game) => game.marketBoard.status !== "absent").length,
      DraftKings: coveredBy("DraftKings"),
      FanDuel: coveredBy("FanDuel"),
    },
  };
}

export function serializeMovement(rows: MovementRow[], kickoffTime?: Date | null) {
  const supportedRows = rows.filter((row) =>
    SUPPORTED_CONSUMER_BOOKS.has(row.sportsbook) && SUPPORTED_CONSUMER_MARKETS.has(row.market));
  const allOrdered = [...supportedRows].sort((left, right) =>
    left.capturedAt.getTime() - right.capturedAt.getTime()
    || left.sportsbook.localeCompare(right.sportsbook)
    || left.market.localeCompare(right.market)
    || left.selection.localeCompare(right.selection));
  const retainedRows = new Set(allOrdered.slice(-MAX_CONSUMER_MOVEMENT_ROWS));
  const streams = new Map<string, MovementRow[]>();
  for (const row of allOrdered) {
    const key = `${row.sportsbook}:${row.market}:${row.selection}`;
    streams.set(key, [...(streams.get(key) ?? []), row]);
  }
  const quote = (row: MovementRow) => ({
    point: safeNumber(row.point),
    price: row.price,
    capturedAt: row.capturedAt.toISOString(),
  });
  const serializedStreams = [...streams.values()]
    .map((stream) => {
      const first = stream[0];
      const current = stream[stream.length - 1];
      const retained = stream.filter((row) => retainedRows.has(row));
      const eligible = kickoffTime
        ? stream.filter((row) => row.capturedAt.getTime() <= kickoffTime.getTime())
        : [];
      return {
        sportsbook: current.sportsbook,
        market: current.market,
        selection: current.selection,
        firstObserved: quote(first),
        current: quote(current),
        finalPreKickoff: eligible.length ? quote(eligible[eligible.length - 1]) : null,
        observations: retained.map(quote),
      };
    })
    .sort((left, right) =>
      left.market.localeCompare(right.market)
      || left.sportsbook.localeCompare(right.sportsbook)
      || left.selection.localeCompare(right.selection));
  const returnedObservations = serializedStreams.reduce((count, stream) => count + stream.observations.length, 0);
  const truncated = allOrdered.length > MAX_CONSUMER_MOVEMENT_ROWS;
  return {
    available: serializedStreams.length > 0,
    streams: serializedStreams,
    completeness: {
      status: truncated ? "truncated" as const : "complete" as const,
      maximumObservations: MAX_CONSUMER_MOVEMENT_ROWS,
      totalObservations: allOrdered.length,
      returnedObservations,
      omittedObservations: allOrdered.length - returnedObservations,
    },
    message: serializedStreams.length ? null : "Line history is not yet available for DraftKings or FanDuel",
  };
}

type PersistedContext = {
  dataConfidence?: { overall?: unknown };
  teams?: Record<string, {
    teamName?: unknown;
    abbreviation?: unknown;
    starters?: Array<{
      playerName?: unknown;
      position?: unknown;
      unit?: unknown;
      estimatedDepthPosition?: unknown;
      classification?: unknown;
      confidence?: unknown;
      recentSnapShare?: unknown;
      injuryStatus?: { gameStatus?: unknown; practiceStatus?: unknown };
      recentStarterEvidence?: unknown;
      evidence?: unknown;
      unavailableReason?: unknown;
    }>;
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
      projectedMatchups: [],
      matchupMessage: "Matchup projection not yet available.",
      message: "Player information temporarily unavailable",
    };
  }
  const teams = [
    { side: "home" as const, teamId: homeTeamId },
    { side: "away" as const, teamId: awayTeamId },
  ].map(({ side, teamId }) => {
    const team = context.teams?.[teamId];
    const depth = (team?.starters ?? []).slice(0, 30).flatMap((player) => {
      if (typeof player.playerName !== "string" || typeof player.position !== "string") return [];
      const position = player.position.toUpperCase();
      const offense = ["QB", "RB", "FB", "WR", "TE", "OL", "OT", "T", "LT", "RT", "G", "LG", "RG", "C"].includes(position);
      const defense = ["DL", "DE", "DT", "NT", "EDGE", "LB", "ILB", "OLB", "MLB", "CB", "S", "FS", "SS", "DB"].includes(position);
      if (!offense && !defense) return [];
      const depthRank = safeNumber(player.estimatedDepthPosition);
      const published = player.classification === "official" || player.classification === "published_secondary";
      const role = published
        ? depthRank === 1 ? "published_starter" as const : "published_backup" as const
        : depthRank === 1 ? "projected_starter" as const : "uncertain" as const;
      const evidence = Array.isArray(player.recentStarterEvidence) && player.recentStarterEvidence.every((item) => typeof item === "string")
        ? player.recentStarterEvidence
        : Array.isArray(player.evidence) && player.evidence.every((item) => typeof item === "string") ? player.evidence : [];
      return [{
        name: player.playerName,
        position,
        unit: offense ? "offense" as const : "defense" as const,
        depthRank: depthRank === null ? null : Math.max(1, Math.round(depthRank)),
        role,
        sourceLabel: published ? "Published depth" as const : player.classification === "inferred" ? "Projected from recent participation" as const : "Evidence uncertain" as const,
        recentSnapShare: safeNumber(player.recentSnapShare),
        injuryStatus: typeof player.injuryStatus?.gameStatus === "string" ? player.injuryStatus.gameStatus : null,
        practiceStatus: typeof player.injuryStatus?.practiceStatus === "string" ? player.injuryStatus.practiceStatus : null,
        starterConfidence: safeNumber(player.confidence),
        evidenceSummary: evidence[0] ?? (typeof player.unavailableReason === "string" ? player.unavailableReason : null),
      }];
    });
    return {
      side,
      name: typeof team?.teamName === "string" ? team.teamName : side === "home" ? "Home team" : "Away team",
      abbreviation: typeof team?.abbreviation === "string" ? team.abbreviation : side === "home" ? "HOME" : "AWAY",
      qbCertainty: safeNumber(team?.qb?.starterCertainty),
      qbChange: typeof team?.qb?.starterChange === "boolean" ? team.qb.starterChange : null,
      personnelCompleteness: safeNumber(team?.personnelCompleteness),
      offenseInjuryImpact: safeNumber(team?.injuries?.offense?.impactScore),
      defenseInjuryImpact: safeNumber(team?.injuries?.defense?.impactScore),
      depth,
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
    projectedMatchups: [],
    matchupMessage: "Matchup projection not yet available.",
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
  const [teams, snapshots, marketRows] = await Promise.all([
    teamIds.length ? db.select().from(teamsTable).where(inArray(teamsTable.teamId, teamIds)) : [],
    getLatestValidPredictionSnapshots(games.map((game) => game.gameId), {
      preKickoffOnly: true,
      authoritativeGameKickoff: true,
      maxRows: MAX_CONSUMER_SNAPSHOT_ROWS,
    }),
    (games.length ? db.select({
      gameId: sportsbookOddsTable.gameId,
      sportsbook: sportsbookOddsTable.sportsbook,
      market: sportsbookOddsTable.market,
      selection: sportsbookOddsTable.selection,
      point: sportsbookOddsTable.point,
      price: sportsbookOddsTable.price,
      capturedAt: sportsbookOddsTable.capturedAt,
    }).from(sportsbookOddsTable)
      .where(and(
        inArray(sportsbookOddsTable.gameId, games.map((game) => game.gameId)),
        inArray(sportsbookOddsTable.sportsbook, ["DraftKings", "FanDuel"]),
        inArray(sportsbookOddsTable.market, ["spread", "total", "moneyline"]),
      ))
      .orderBy(asc(sportsbookOddsTable.capturedAt), asc(sportsbookOddsTable.id)) : []) as Promise<Array<MovementRow & { gameId: string }>>,
  ]);
  const teamsById = new Map(teams.map((team) => [team.teamId, team]));
  return games.map((game) => {
    const snapshot = gameSpecificSnapshot(game.gameId, snapshots);
    const home = teamsById.get(game.homeTeamId);
    const away = teamsById.get(game.awayTeamId);
    const consumerHome = home ? { teamId: home.teamId, name: home.teamName, abbreviation: home.abbreviation } : undefined;
    const market = consumerMarket(snapshot, consumerHome);
    const marketBoard = buildConsumerMarketBoard(
      snapshot,
      marketRows.filter((row) => row.gameId === game.gameId),
      consumerHome,
      game.kickoffTime,
    );
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
      market,
      marketBoard,
      dataConfidence: confidence(snapshot),
      availability: {
        prediction: snapshot ? null : "Prediction pending — incomplete model inputs",
        market: market.evidence.available ? null : "Sportsbook line updating",
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
    const summary = summarizeConsumerMarketBoards(games);
    res.json({
      ...summary,
      games,
    });
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
          inArray(sportsbookOddsTable.sportsbook, ["DraftKings", "FanDuel"]),
          inArray(sportsbookOddsTable.market, ["spread", "total", "moneyline"]),
        ))
        .orderBy(asc(sportsbookOddsTable.capturedAt), asc(sportsbookOddsTable.id)),
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
    const movement = serializeMovement(movementRows, kickoff);
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