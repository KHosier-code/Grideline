import { and, asc, desc, eq, gt, gte, inArray, isNotNull, lte } from "drizzle-orm";
import { Router, type IRouter } from "express";
import {
  db,
  gamesTable,
  nflversePlayerIdentitiesTable,
  playerGameStatsTable,
  snapCountsTable,
  pregameTeamFeaturesTable,
  predictionSnapshotsTable,
  sportsbookOddsTable,
  teamsTable,
  weatherForecastSnapshotsTable,
  modelTrainingRunsTable,
} from "@workspace/db";
import {
  gameSpecificSnapshot,
  getLatestValidPredictionSnapshots,
  getPredictionPerformance,
} from "../lib/live-predictions";
import { nflverseTeamCandidates, normalizeTeamId } from "../lib/personnel-context-derivation";
import { buildConsumerMatchupBoard } from "../lib/consumer-matchups";
import {
  buildConsumerConfidence,
  cutoffSafeRevisions,
  normalizeModelConfidence,
  projectionRevisionStability,
  snapshotDataConfidence,
  startersResolvedFromEvidence,
} from "../lib/confidence-framework";
import { verifyArtifactIntegrity } from "../lib/modeling";
import retained2025Baseline from "../../../../reports/gridline-2025-market-baseline.json" with { type: "json" };
import { persistConfidenceMethodology, persistConfidenceResults } from "../lib/confidence-persistence";

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

export const USAGE_METRICS = ["snapShare", "targets", "targetShare", "receptions", "receivingYards", "carries", "rushingYards", "totalTd", "yardsPerTarget", "yardsPerCarry"] as const;
export const UNSUPPORTED_USAGE_METRICS = ["redZoneTouches", "redZoneTargets", "explosiveRate"] as const;
type UsageMetric = typeof USAGE_METRICS[number];
type UsageRow = {
  playerId: string; playerName: string; position: string | null; teamId: string | null;
  gameId: string; season: number; week: number; seasonType: string;
  targets: number | null; receptions: number | null; receivingYards: number | null;
  carries: number | null; rushingYards: number | null; rushingTds: number | null; receivingTds: number | null;
};
type UsageSnap = { playerId: string; gameId: string; offensePct: number | null };

export function buildUsageSnapPlayerAliases(rows: Array<{ gsisId: string; pfrId: string | null }>) {
  const aliases = new Map<string, string>();
  for (const row of rows) {
    if (row.pfrId && !aliases.has(row.pfrId)) aliases.set(row.pfrId, row.gsisId);
  }
  return aliases;
}

async function usageSnapPlayerAliases(statPlayerIds: string[]) {
  const uniqueIds = [...new Set(statPlayerIds)];
  if (!uniqueIds.length) return new Map<string, string>();
  const rows = await db.select({
    gsisId: nflversePlayerIdentitiesTable.gsisId,
    pfrId: nflversePlayerIdentitiesTable.pfrId,
  }).from(nflversePlayerIdentitiesTable)
    .where(and(
      inArray(nflversePlayerIdentitiesTable.gsisId, uniqueIds),
      isNotNull(nflversePlayerIdentitiesTable.pfrId),
    ))
    .orderBy(desc(nflversePlayerIdentitiesTable.observedAt));
  return buildUsageSnapPlayerAliases(rows);
}

export function filterUsagePlayers<T extends { teamId: string | null; position: string | null }>(
  players: T[],
  team?: string,
  position?: string,
) {
  return players.filter((player) =>
    ["QB", "RB", "WR", "TE"].includes(player.position?.toUpperCase() ?? "")
    && (!team || player.teamId === team)
    && (!position || player.position?.toUpperCase() === position.toUpperCase()));
}

export function eligibleUsageGames<T extends { gameId: string; season: number; kickoffTime: Date | null }>(
  games: T[],
  season: number,
  cutoff: Date,
  excludedGameId?: string,
) {
  return [...games]
    .filter((game) =>
      game.gameId !== excludedGameId
      && game.season === season
      && game.kickoffTime !== null
      && game.kickoffTime < cutoff)
    .sort((left, right) =>
      left.kickoffTime!.getTime() - right.kickoffTime!.getTime()
      || left.gameId.localeCompare(right.gameId));
}

export function buildUsageTeamMappings(teams: Array<{ teamId: string; abbreviation: string }>) {
  const abbreviationToTeamId = new Map(teams.map((team) => [team.abbreviation.toUpperCase(), team.teamId]));
  const scheduleToAbbreviation = new Map(teams.map((team) => [team.teamId, team.abbreviation.toUpperCase()]));
  const sourceToAbbreviation = new Map<string, string>();
  for (const team of teams) {
    for (const source of nflverseTeamCandidates(team.abbreviation)) sourceToAbbreviation.set(source, team.abbreviation.toUpperCase());
  }
  const canonical = (source: string | null | undefined) => {
    if (!source) return null;
    const normalized = sourceToAbbreviation.get(source.trim().toUpperCase());
    if (normalized) return normalized;
    return scheduleToAbbreviation.get(normalizeTeamId(source, abbreviationToTeamId)) ?? source.trim().toUpperCase();
  };
  return { abbreviationToTeamId, scheduleToAbbreviation, sourceToAbbreviation, canonical };
}

export function usageCompositeIdentity(row: { season: number; seasonType: string; week: number; teamId: string | null; opponentTeamId: string | null; playerId: string }) {
  return `${row.season}:${row.seasonType.toUpperCase()}:${row.week}:${row.teamId ?? ""}:${row.opponentTeamId ?? ""}:${row.playerId}`;
}

export function usageMatchupIdentity(row: { season: number; week: number; teamId: string | null; opponentTeamId: string | null }) {
  return `${row.season}:${row.week}:${row.teamId ?? ""}:${row.opponentTeamId ?? ""}`;
}

export function deterministicSourceGameId(row: { season: number; seasonType: string; week: number; teamId: string; opponentTeamId: string }) {
  return `source:${row.season}:${row.seasonType.toUpperCase()}:${row.week}:${row.teamId}:${row.opponentTeamId}`;
}

export function compareUsageGameChronology(left: { seasonType: string; week: number }, right: { seasonType: string; week: number }) {
  const type = (value: string) => value.toUpperCase() === "REG" ? 0 : 1;
  return type(left.seasonType) - type(right.seasonType) || left.week - right.week;
}

const metric = (value: number | null, reason: string | null = null) => ({
  value: value !== null && Number.isFinite(value) ? value : null,
  available: value !== null && Number.isFinite(value),
  reason,
});

/** Pure, deterministic usage aggregation. Inputs must already be cutoff-safe. */
export function aggregatePlayerUsage(
  rows: UsageRow[],
  snaps: UsageSnap[],
  requestedGames: number,
  window: "last3" | "last5" | "last8" | "season",
  requestedGamesByTeam?: Map<string, number>,
  orderedGameIdsByTeam?: Map<string, string[]>,
) {
  const byPlayer = new Map<string, UsageRow[]>();
  for (const row of rows) {
    const key = `${row.playerId}:${row.teamId ?? "unknown"}`;
    byPlayer.set(key, [...(byPlayer.get(key) ?? []), row]);
  }
  const snapMap = new Map(snaps.map((row) => [`${row.playerId}:${row.gameId}`, row.offensePct]));
  const unsupported = Object.fromEntries(UNSUPPORTED_USAGE_METRICS.map((name) => [name, false]));
  return [...byPlayer.entries()].map(([, history]) => {
    const playerId = history[0].playerId;
    const teamIds = orderedGameIdsByTeam?.get(history[0]?.teamId ?? "");
    const selectedIds = teamIds ? (window === "season" ? teamIds : teamIds.slice(-Number(window.replace("last", "")))) : null;
    const order = selectedIds ? new Map(selectedIds.map((id, index) => [id, index])) : undefined;
    const ordered = [...history].sort((a, b) => (order?.get(a.gameId) ?? 0) - (order?.get(b.gameId) ?? 0));
    const selected = selectedIds ? ordered.filter((row) => order?.has(row.gameId)) : (window === "season" ? ordered : ordered.slice(-Number(window.replace("last", ""))));
    const sum = (key: keyof UsageRow) => {
      const values = selected.map((r) => r[key]).filter((v): v is number => typeof v === "number" && Number.isFinite(v));
      return values.length ? values.reduce((a, b) => a + b, 0) : null;
    };
    const snapValues = selected.map((r) => snapMap.get(`${r.playerId}:${r.gameId}`)).filter((v): v is number => typeof v === "number" && Number.isFinite(v));
    const targets = sum("targets");
    const teamTargetRows = rows.filter((r) => r.teamId === ordered[0].teamId && selected.some((s) => s.gameId === r.gameId));
    const teamTargets = teamTargetRows.length
      ? teamTargetRows.reduce((total, row) => total + (row.targets ?? 0), 0)
      : null;
    const receivingYards = sum("receivingYards");
    const carries = sum("carries");
    const rushingYards = sum("rushingYards");
    const values: Record<string, ReturnType<typeof metric>> = {
      snapShare: metric(snapValues.length ? snapValues.reduce((a, b) => a + b, 0) / snapValues.length : null, snapValues.length ? null : "Snap share unavailable"),
      targets: metric(targets), targetShare: metric(targets !== null && teamTargets !== null && teamTargets > 0 ? targets / teamTargets : null, teamTargets && teamTargets > 0 ? null : "Team target denominator unavailable"),
      receptions: metric(sum("receptions")), receivingYards: metric(receivingYards),
      carries: metric(carries), rushingYards: metric(rushingYards),
      totalTd: metric(sum("rushingTds") === null && sum("receivingTds") === null ? null : (sum("rushingTds") ?? 0) + (sum("receivingTds") ?? 0)),
      yardsPerTarget: metric(targets && targets > 0 && receivingYards !== null ? receivingYards / targets : null, targets && targets > 0 ? null : "Targets denominator unavailable"),
      yardsPerCarry: metric(carries && carries > 0 && rushingYards !== null ? rushingYards / carries : null, carries && carries > 0 ? null : "Carries denominator unavailable"),
      ...Object.fromEntries(UNSUPPORTED_USAGE_METRICS.map((name) => [name, metric(null, "Persisted source does not support this metric")])),
    };
    const gameSeries = selected.map((r) => {
      const gameTeamRows = rows.filter((candidate) => candidate.teamId === r.teamId && candidate.gameId === r.gameId);
      const gameTargets = gameTeamRows.reduce((total, candidate) => total + (candidate.targets ?? 0), 0);
      const td = r.rushingTds === null && r.receivingTds === null
        ? null : (r.rushingTds ?? 0) + (r.receivingTds ?? 0);
      const targetShare = r.targets !== null && gameTargets > 0 ? r.targets / gameTargets : null;
      const ypt = r.targets !== null && r.targets > 0 && r.receivingYards !== null ? r.receivingYards / r.targets : null;
      const ypc = r.carries !== null && r.carries > 0 && r.rushingYards !== null ? r.rushingYards / r.carries : null;
      return {
      gameId: r.gameId, season: r.season, week: r.week, seasonType: r.seasonType,
      metrics: Object.fromEntries([...USAGE_METRICS, ...UNSUPPORTED_USAGE_METRICS].map((name) => {
        const values: Record<string, number | null> = {
          snapShare: snapMap.get(`${r.playerId}:${r.gameId}`) ?? null, targets: r.targets,
          targetShare, receptions: r.receptions, receivingYards: r.receivingYards,
          carries: r.carries, rushingYards: r.rushingYards, totalTd: td,
          yardsPerTarget: ypt, yardsPerCarry: ypc,
        };
        return [name, UNSUPPORTED_USAGE_METRICS.includes(name as typeof UNSUPPORTED_USAGE_METRICS[number])
          ? metric(null, "Persisted source does not support this metric") : metric(values[name] ?? null,
            name === "targetShare" && gameTargets === 0 ? "Team target denominator unavailable" :
            name === "yardsPerTarget" && (!r.targets || r.targets <= 0) ? "Targets denominator unavailable" :
            name === "yardsPerCarry" && (!r.carries || r.carries <= 0) ? "Carries denominator unavailable" : null)];
      })),
      };
    });
    const trendMetric = (name: "targets" | "snapShare") => {
      const values = gameSeries.map((g) => g.metrics[name].value).filter((v): v is number => v !== null);
      return values.length >= 2 ? values.at(-1)! - values[0]! : null;
    };
    const delta = trendMetric("targets") ?? trendMetric("snapShare");
    const teamRequestedGames = requestedGamesByTeam?.get(ordered[0].teamId ?? "") ?? requestedGames;
    const playerRequestedGames = selectedIds?.length ?? (window === "season"
      ? teamRequestedGames
      : Math.min(teamRequestedGames, Number(window.replace("last", ""))));
    return {
      playerId, playerName: ordered[0].playerName, position: ordered[0].position, teamId: ordered[0].teamId,
      aggregate: values, games: gameSeries,
      trend: delta === null ? "unavailable" : delta > 0 ? "up" : delta < 0 ? "down" : "flat",
      metricAvailability: Object.fromEntries([...USAGE_METRICS, ...UNSUPPORTED_USAGE_METRICS].map((name) => [name, Boolean(values[name]?.available)])),
      sourceCoverage: {
        requestedGames: playerRequestedGames,
        includedGames: selected.length,
        partialReasons: selected.length < playerRequestedGames
          ? ["Some requested games have no persisted player-game record"] : [],
      },
    };
  });
}

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
      currentQuotes: currentByBook.map((row) => quoteFromMovement(row, spec.market, home)),
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
    qb?: { starterCertainty?: unknown; starterChange?: unknown; projectedStarter?: unknown };
    injuries?: Record<string, { impactScore?: unknown }>;
    injuryPlayers?: unknown[];
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
      qbEvidenceAvailable: Boolean(team?.qb?.projectedStarter),
      personnelCompleteness: safeNumber(team?.personnelCompleteness),
      offenseInjuryImpact: safeNumber(team?.injuries?.offense?.impactScore),
      defenseInjuryImpact: safeNumber(team?.injuries?.defense?.impactScore),
      injuryEvidenceAvailable: Array.isArray(team?.injuryPlayers) && team.injuryPlayers.length > 0,
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

export async function consumerGames(filters: ConsumerFilters = {}, persistConfidence = false) {
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
  const [teams, snapshots, marketRows, modelRuns, snapshotHistory] = await Promise.all([
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
    db.select().from(modelTrainingRunsTable),
    games.length ? db.select().from(predictionSnapshotsTable)
      .where(and(inArray(predictionSnapshotsTable.gameId, games.map((game) => game.gameId)), lte(predictionSnapshotsTable.predictionTimestamp, new Date())))
      .orderBy(asc(predictionSnapshotsTable.predictionTimestamp), asc(predictionSnapshotsTable.id)) : [],
  ]);
  const verifiedArtifacts = new Map(modelRuns.filter((run) => verifyArtifactIntegrity(run).valid).map((run) => [run.modelVersion, true]));
  const teamsById = new Map(teams.map((team) => [team.teamId, team]));
  let persistedConfidenceResults = 0;
  if (persistConfidence) await persistConfidenceMethodology();
  const results = await Promise.all(games.map(async (game) => {
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
    const dataConfidence = confidence(snapshot);
    const confidenceData = snapshot ? snapshotDataConfidence({
      qbConfidence: snapshot.qbConfidence,
      lowSample: snapshot.lowSample,
      inputFeatureCount: snapshot.inputFeatureCount,
      inputMissingFeatureCount: snapshot.inputMissingFeatureCount,
    }) : { score: null, acceptable: false };
    const reportModels = retained2025Baseline.models as Array<Record<string, unknown>>;
    const revisions = cutoffSafeRevisions(
      snapshotHistory.filter((row) => row.gameId === game.gameId),
      snapshot?.predictionTimestamp,
      game.kickoffTime,
    );
    const historicalFor = (market: "spread" | "moneyline" | "total", difference: number | null) => {
      const family = market === "total" ? "totals" : market;
      const model = reportModels.find((item) => item.family === family);
      const marketEvidence = model?.market as Record<string, unknown> | undefined;
      const buckets = Array.isArray(marketEvidence?.edgeBuckets)
        ? marketEvidence.edgeBuckets as Array<Record<string, unknown>>
        : [];
      const magnitude = difference === null ? null : Math.abs(difference);
      const bucketLabel = magnitude === null ? null
        : magnitude < 1 ? "<1"
          : magnitude < 2 ? "1-1.99"
            : magnitude < 3 ? "2-2.99"
              : magnitude < 5 ? "3-4.99" : "5+";
      const bucket = buckets.find((item) => item.bucket === bucketLabel);
      const gradedSampleSize = typeof bucket?.gradedSampleSize === "number" ? bucket.gradedSampleSize : 0;
      return {
        status: gradedSampleSize >= 30 ? "measured_recorded_evidence" : "insufficient",
        source: "nflverse/nfldata games.csv",
        designation: "source_designated_recorded",
        bucket: bucketLabel,
        sampleSize: typeof bucket?.sampleSize === "number" ? bucket.sampleSize : 0,
        gradedSampleSize,
        winRate: typeof bucket?.winRate === "number" ? bucket.winRate : null,
        confidenceInterval95: bucket?.confidenceInterval95 ?? { low: null, high: null },
        note: market === "moneyline"
          ? "The retained baseline has recorded prices but no edge buckets for moneyline; evidence is insufficient."
          : "Recorded-line comparison only; not a verified close, CLV, profitability result, or universal threshold.",
      };
    };
    const comparisonFor = (market: "spread" | "moneyline" | "total") =>
      marketBoard.comparisons.find((comparison) => comparison.market === market);
    const retainedErrorScore = (market: "spread" | "moneyline" | "total") => {
      const family = market === "total" ? "totals" : market;
      const model = reportModels.find((item) => item.family === family);
      const metrics = model?.metrics as Record<string, unknown> | undefined;
      if (market === "moneyline") {
        const brier = typeof metrics?.brierScore === "number" ? metrics.brierScore : null;
        return brier === null ? null : Math.max(0, Math.min(100, (0.35 - brier) / 0.25 * 100));
      }
      return normalizeModelConfidence(typeof metrics?.mae === "number" ? metrics.mae : null);
    };
    const modelScores = Object.fromEntries((["spread", "moneyline", "total"] as const).map((confidenceMarket) => {
      const stability = projectionRevisionStability(confidenceMarket, revisions);
      const error = retainedErrorScore(confidenceMarket);
      return [confidenceMarket, stability === null || error === null ? null : (stability + error) / 2];
    }));
    const calculatedConfidence = buildConsumerConfidence({
      snapshot: snapshot ? {
        snapshotKey: snapshot.snapshotKey,
        predictionTimestamp: snapshot.predictionTimestamp,
        qbConfidence: snapshot.qbConfidence,
        inputFeatureCount: snapshot.inputFeatureCount,
        inputMissingFeatureCount: snapshot.inputMissingFeatureCount,
        lowSample: snapshot.lowSample,
        spreadModelVersion: snapshot.spreadModelVersion,
        moneylineModelVersion: snapshot.moneylineModelVersion,
        totalsModelVersion: snapshot.totalsModelVersion,
        verifiedArtifacts: {
          spread: Boolean(snapshot.spreadModelVersion && verifiedArtifacts.get(snapshot.spreadModelVersion)),
          moneyline: Boolean(snapshot.moneylineModelVersion && verifiedArtifacts.get(snapshot.moneylineModelVersion)),
          total: Boolean(snapshot.totalsModelVersion && verifiedArtifacts.get(snapshot.totalsModelVersion)),
        },
      } : undefined,
      dataConfidence: { score: confidenceData.score },
      dataAcceptable: confidenceData.acceptable,
      comparisons: marketBoard.comparisons.map((comparison) => ({
        market: comparison.market === "total" ? "total" as const : comparison.market,
        difference: comparison.difference,
        state: comparison.state,
        currentQuotes: comparison.currentQuotes,
      })),
      startersResolved: startersResolvedFromEvidence(snapshot?.inputSourceEvidence),
      modelScores,
      historical: {
        spread: historicalFor("spread", comparisonFor("spread")?.difference ?? null),
        moneyline: historicalFor("moneyline", comparisonFor("moneyline")?.difference ?? null),
        total: historicalFor("total", comparisonFor("total")?.difference ?? null),
      },
    });
    if (persistConfidence && snapshot) {
      const auditInputs = Object.fromEntries((["spread", "moneyline", "total"] as const).map((confidenceMarket) => {
        const comparison = comparisonFor(confidenceMarket);
        const family = confidenceMarket === "total" ? "totals" : confidenceMarket;
        const retainedModel = reportModels.find((item) => item.family === family);
        return [confidenceMarket, {
          snapshot: {
            predictionTimestamp: snapshot.predictionTimestamp.toISOString(),
            lowSample: snapshot.lowSample,
            qbConfidence: snapshot.qbConfidence,
            inputFeatureCount: snapshot.inputFeatureCount,
            inputMissingFeatureCount: snapshot.inputMissingFeatureCount,
            modelVersion: confidenceMarket === "spread" ? snapshot.spreadModelVersion
              : confidenceMarket === "moneyline" ? snapshot.moneylineModelVersion
                : snapshot.totalsModelVersion,
          },
          quotes: comparison?.currentQuotes ?? [],
          revisions: revisions.map((revision) => ({
            predictionTimestamp: revision.predictionTimestamp.toISOString(),
            projectedMargin: revision.projectedMargin,
            projectedTotal: revision.projectedTotal,
            homeWinProbability: revision.homeWinProbability,
          })),
          retainedBaseline: {
            evaluationRunId: retained2025Baseline.evaluationRunId,
            family,
            metrics: retainedModel?.metrics ?? null,
            historical: calculatedConfidence.markets.find((result) => result.market === confidenceMarket)?.evidence.historical ?? null,
          },
        }];
      }));
      const persisted = await persistConfidenceResults(snapshot.snapshotKey, calculatedConfidence.markets, auditInputs);
      persistedConfidenceResults += persisted.inserted;
    }
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
      dataConfidence,
      confidence: calculatedConfidence,
      availability: {
        prediction: snapshot ? null : "Prediction pending — incomplete model inputs",
        market: market.evidence.available ? null : "Sportsbook line updating",
      },
    };
  }));
  return Object.assign(results, { persistedConfidenceResults });
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
      ? new Date(Math.min(Date.now(), new Date(game.kickoffTime).getTime() - 1))
      : new Date();
    const kickoff = game.kickoffTime ? new Date(game.kickoffTime) : null;
    const [gameRow] = await db.select({
      homeTeamId: gamesTable.homeTeamId, awayTeamId: gamesTable.awayTeamId,
    }).from(gamesTable).where(eq(gamesTable.gameId, game.gameId)).limit(1);
    const detailTeamRows = await db.select({ teamId: teamsTable.teamId, abbreviation: teamsTable.abbreviation }).from(teamsTable);
    const detailTeamMaps = buildUsageTeamMappings(detailTeamRows);
    const detailSourceTeams = [gameRow.homeTeamId, gameRow.awayTeamId]
      .map((id) => detailTeamMaps.scheduleToAbbreviation.get(id))
      .flatMap((abbr) => abbr ? nflverseTeamCandidates(abbr) : []);
    const [weather, contextRows, movementRows, recentStats, recentSnaps, recentGames] = await Promise.all([
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
        teamId: pregameTeamFeaturesTable.teamId,
        features: pregameTeamFeaturesTable.features,
        sampleCounts: pregameTeamFeaturesTable.sampleCounts,
        featureAudit: pregameTeamFeaturesTable.featureAudit,
        sourceCutoff: pregameTeamFeaturesTable.sourceCutoff,
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
      db.select().from(playerGameStatsTable)
        .where(and(
          inArray(playerGameStatsTable.teamId, detailSourceTeams),
          eq(playerGameStatsTable.season, game.season),
        )),
      db.select({
        playerId: snapCountsTable.playerId, season: snapCountsTable.season, week: snapCountsTable.week,
        teamId: snapCountsTable.teamId, opponentTeamId: snapCountsTable.opponentTeamId, offensePct: snapCountsTable.offensePct,
      }).from(snapCountsTable)
        .where(and(
          eq(snapCountsTable.season, game.season),
          inArray(snapCountsTable.teamId, detailSourceTeams),
        )),
      db.select({ gameId: gamesTable.gameId, season: gamesTable.season, week: gamesTable.week, kickoffTime: gamesTable.kickoffTime, homeTeamId: gamesTable.homeTeamId, awayTeamId: gamesTable.awayTeamId })
        .from(gamesTable).where(eq(gamesTable.season, game.season)),
    ]);
    const forecast = weather[0];
    const context = contextRows
      .map((row) => (row.featureAudit as Record<string, unknown> | undefined)?._personnel_context)
      .find(Boolean) as PersistedContext | undefined;
    const finalizedContext = serializeContext(context ?? null, gameRow?.homeTeamId ?? "", gameRow?.awayTeamId ?? "");
    const eligibleRecentGames = eligibleUsageGames(recentGames, game.season, sourceCutoff, game.gameId)
      .filter((candidate) => candidate.homeTeamId === gameRow.homeTeamId || candidate.homeTeamId === gameRow.awayTeamId
        || candidate.awayTeamId === gameRow.homeTeamId || candidate.awayTeamId === gameRow.awayTeamId);
    const recentIds = new Set(eligibleRecentGames.map((candidate) => candidate.gameId));
    const recentMatchups = new Map<string, string>();
    const recentRows: UsageRow[] = recentStats.flatMap((row) => {
      const canonicalTeam = detailTeamMaps.canonical(row.teamId);
      const matching = eligibleRecentGames.find((candidate) => candidate.season === row.season && candidate.week === row.week
        && (detailTeamMaps.scheduleToAbbreviation.get(candidate.homeTeamId) === canonicalTeam
          || detailTeamMaps.scheduleToAbbreviation.get(candidate.awayTeamId) === canonicalTeam));
      if (!matching || !recentIds.has(matching.gameId) || !canonicalTeam) return [];
      const canonicalOpponent = detailTeamMaps.canonical(row.opponentTeamId);
      recentMatchups.set(usageMatchupIdentity({
        season: row.season, week: row.week, teamId: canonicalTeam, opponentTeamId: canonicalOpponent,
      }), matching.gameId);
      return [{ ...row, gameId: matching.gameId, teamId: canonicalTeam }];
    });
    const recentTeamIds = new Map<string, string[]>();
    for (const candidate of eligibleRecentGames) {
      const home = detailTeamMaps.scheduleToAbbreviation.get(candidate.homeTeamId) ?? candidate.homeTeamId;
      const away = detailTeamMaps.scheduleToAbbreviation.get(candidate.awayTeamId) ?? candidate.awayTeamId;
      recentTeamIds.set(home, [...(recentTeamIds.get(home) ?? []), candidate.gameId]);
      recentTeamIds.set(away, [...(recentTeamIds.get(away) ?? []), candidate.gameId]);
    }
    const detailSnapAliases = await usageSnapPlayerAliases(recentRows.map((row) => row.playerId));
    const resolvedSnaps = recentSnaps.flatMap((snap) => {
      const team = detailTeamMaps.canonical(snap.teamId);
      const opponent = detailTeamMaps.canonical(snap.opponentTeamId);
      const gameId = recentMatchups.get(usageMatchupIdentity({
        season: snap.season, week: snap.week, teamId: team, opponentTeamId: opponent,
      }));
      const playerId = detailSnapAliases.get(snap.playerId) ?? snap.playerId;
      return gameId ? [{ playerId, gameId, offensePct: snap.offensePct }] : [];
    });
    const recent = aggregatePlayerUsage(recentRows, resolvedSnaps, 5, "last5",
      new Map([...recentTeamIds].map(([teamId, ids]) => [teamId, ids.length])),
      recentTeamIds);
    const rankRecent = (teamId: string) => recent
      .filter((player) => player.teamId === teamId)
      .sort((a, b) => (b.aggregate.snapShare.value ?? 0) - (a.aggregate.snapShare.value ?? 0)
        || (b.aggregate.targets.value ?? 0) - (a.aggregate.targets.value ?? 0)
        || (b.aggregate.carries.value ?? 0) - (a.aggregate.carries.value ?? 0))
      .slice(0, 5);
    const detailHome = detailTeamMaps.scheduleToAbbreviation.get(gameRow.homeTeamId) ?? gameRow.homeTeamId;
    const detailAway = detailTeamMaps.scheduleToAbbreviation.get(gameRow.awayTeamId) ?? gameRow.awayTeamId;
    const keyPlayers = [detailAway, detailHome]
      .flatMap(rankRecent)
      .map((player) => {
        const contextTeams = (finalizedContext as { teams: Array<{ side: "home" | "away"; depth: Array<{ name: string; depthRank: number | null; injuryStatus: string | null }> }> }).teams;
        const team = contextTeams.find((candidate) => candidate.side === (player.teamId === detailHome ? "home" : "away"))
          ;
        const personnel = team?.depth.find((candidate) => candidate.name.toLowerCase() === player.playerName.toLowerCase());
        return {
          playerId: player.playerId, name: player.playerName, teamId: player.teamId ?? "",
          position: player.position, recentUsage: Object.fromEntries(Object.entries(player.aggregate)
            .map(([name, value]) => [name, value.value])),
          currentPersonnel: {
            depthRank: personnel?.depthRank ?? null, injuryStatus: personnel?.injuryStatus ?? null,
            source: personnel ? "cutoff-safe pregame personnel context" : "Current personnel evidence unavailable",
          },
        };
      });
    const movement = serializeMovement(movementRows, kickoff);
    const teamEvidence = (teamId: string) => {
      const row = contextRows.find((candidate) => candidate.teamId === teamId);
      return row ? { features: row.features, sampleCounts: row.sampleCounts } : null;
    };
    const matchupBoard = buildConsumerMatchupBoard({
      homeEvidence: teamEvidence(gameRow.homeTeamId),
      awayEvidence: teamEvidence(gameRow.awayTeamId),
      personnelTeams: finalizedContext.teams,
      homeName: game.matchup.home.abbreviation,
      awayName: game.matchup.away.abbreviation,
      sourceCutoff,
    });
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
      keyPlayers,
      matchupBoard,
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

router.get("/consumer/player-usage", async (req, res): Promise<void> => {
  const team = typeof req.query.team === "string" ? req.query.team : undefined;
  const position = typeof req.query.position === "string" ? req.query.position.toUpperCase() : undefined;
  const game = typeof req.query.game === "string" ? req.query.game : undefined;
  const window = typeof req.query.window === "string" ? req.query.window : "last5";
  if ((position && !["QB", "RB", "WR", "TE"].includes(position))
    || !["last3", "last5", "last8", "season"].includes(window)) {
    res.status(400).json({ error: "Choose a valid position and usage window.", code: "invalid_request" });
    return;
  }
  try {
    const teamRows = await db.select({ teamId: teamsTable.teamId, abbreviation: teamsTable.abbreviation }).from(teamsTable);
    const teamMaps = buildUsageTeamMappings(teamRows);
    const canonicalFilter = team ? teamMaps.canonical(team) : undefined;
    const matchup = game ? await db.select().from(gamesTable).where(eq(gamesTable.gameId, game)).limit(1) : [];
    if (game && !matchup[0]) {
      res.status(400).json({ error: "Unknown game filter.", code: "invalid_request" });
      return;
    }
    const cutoff = matchup[0]?.kickoffTime ?? new Date();
    const latestStatSeason = matchup[0]?.season ?? (await db.select({ season: playerGameStatsTable.season })
      .from(playerGameStatsTable).orderBy(desc(playerGameStatsTable.season)).limit(1))[0]?.season ?? 0;
    const applicableSeason = matchup[0]?.season ?? latestStatSeason;
    const selectedGames = await db.select().from(gamesTable)
      .where(and(eq(gamesTable.season, applicableSeason), lte(gamesTable.kickoffTime, cutoff)))
      .orderBy(asc(gamesTable.season), asc(gamesTable.week), asc(gamesTable.gameId));
    const eligibleGames = eligibleUsageGames(selectedGames, applicableSeason, cutoff, game);
    const gameKeys = new Map<string, string>();
    for (const g of eligibleGames) {
      const home = teamMaps.scheduleToAbbreviation.get(g.homeTeamId) ?? g.homeTeamId;
      const away = teamMaps.scheduleToAbbreviation.get(g.awayTeamId) ?? g.awayTeamId;
      gameKeys.set(`${g.season}:${g.week}:${home}:${away}`, g.gameId);
      gameKeys.set(`${g.season}:${g.week}:${away}:${home}`, g.gameId);
    }
    const seasons = [applicableSeason];
    const sourceCandidates = canonicalFilter
      ? nflverseTeamCandidates(canonicalFilter)
      : matchup[0]
        ? [matchup[0].homeTeamId, matchup[0].awayTeamId].flatMap((id) => {
          const abbreviation = teamMaps.scheduleToAbbreviation.get(id);
          return abbreviation ? nflverseTeamCandidates(abbreviation) : [];
        })
        : [];
    const statRows = seasons.length ? await db.select().from(playerGameStatsTable)
      .where(and(inArray(playerGameStatsTable.season, seasons), sourceCandidates.length ? inArray(playerGameStatsTable.teamId, sourceCandidates) : undefined)) : [];
    const rawSnaps = statRows.length ? await db.select({
      playerId: snapCountsTable.playerId, season: snapCountsTable.season, week: snapCountsTable.week,
      teamId: snapCountsTable.teamId, opponentTeamId: snapCountsTable.opponentTeamId, offensePct: snapCountsTable.offensePct,
    }).from(snapCountsTable).where(and(
      eq(snapCountsTable.season, applicableSeason),
      sourceCandidates.length ? inArray(snapCountsTable.teamId, sourceCandidates) : undefined,
    )) : [];
    const sourceGameIds = new Map<string, string>();
    const usageRows: UsageRow[] = statRows.flatMap((row) => {
      const canonicalTeam = teamMaps.canonical(row.teamId);
      const canonicalOpponent = teamMaps.canonical(row.opponentTeamId);
      if (!canonicalTeam || !canonicalOpponent) return [];
      if (canonicalFilter && canonicalTeam !== canonicalFilter) return [];
      if (matchup[0] && canonicalTeam !== teamMaps.scheduleToAbbreviation.get(matchup[0].homeTeamId)
        && canonicalTeam !== teamMaps.scheduleToAbbreviation.get(matchup[0].awayTeamId)) return [];
      const gameId = row.teamId && row.opponentTeamId
        ? gameKeys.get(`${row.season}:${row.week}:${canonicalTeam}:${canonicalOpponent}`) : undefined;
      const resolvedId = gameId ?? deterministicSourceGameId({
        season: row.season, seasonType: row.seasonType, week: row.week,
        teamId: canonicalTeam ?? row.teamId, opponentTeamId: canonicalOpponent ?? row.opponentTeamId ?? "",
      });
      sourceGameIds.set(usageMatchupIdentity({
        season: row.season, week: row.week, teamId: canonicalTeam, opponentTeamId: canonicalOpponent,
      }), resolvedId);
      if (matchup[0] && !gameId) return [];
      return [{ ...row, gameId: resolvedId, playerId: row.playerId, playerName: row.playerName, position: row.position, teamId: canonicalTeam }];
    });
    const snapPlayerAliases = await usageSnapPlayerAliases(usageRows.map((row) => row.playerId));
    const snapRows = rawSnaps.flatMap((snap) => {
      const team = teamMaps.canonical(snap.teamId);
      const opponent = teamMaps.canonical(snap.opponentTeamId);
      const resolved = sourceGameIds.get(usageMatchupIdentity({
        season: snap.season, week: snap.week, teamId: team, opponentTeamId: opponent,
      }));
      const playerId = snapPlayerAliases.get(snap.playerId) ?? snap.playerId;
      return resolved ? [{ playerId, gameId: resolved, offensePct: snap.offensePct }] : [];
    });
    const teamSchedules = new Map<string, number>();
    const orderedGameIdsByTeam = new Map<string, string[]>();
    for (const eligible of eligibleGames) {
      const home = teamMaps.scheduleToAbbreviation.get(eligible.homeTeamId) ?? eligible.homeTeamId;
      const away = teamMaps.scheduleToAbbreviation.get(eligible.awayTeamId) ?? eligible.awayTeamId;
      teamSchedules.set(home, (teamSchedules.get(home) ?? 0) + 1);
      teamSchedules.set(away, (teamSchedules.get(away) ?? 0) + 1);
      orderedGameIdsByTeam.set(home, [...(orderedGameIdsByTeam.get(home) ?? []), eligible.gameId]);
      orderedGameIdsByTeam.set(away, [...(orderedGameIdsByTeam.get(away) ?? []), eligible.gameId]);
    }
    const usesSourceChronology = !matchup[0] && eligibleGames.length === 0;
    if (usesSourceChronology) {
      const sourceGames = new Map<string, { teamId: string; gameId: string; seasonType: string; week: number }>();
      for (const row of usageRows) sourceGames.set(`${row.teamId}:${row.gameId}`, {
        teamId: row.teamId ?? "", gameId: row.gameId, seasonType: row.seasonType, week: row.week,
      });
      const grouped = new Map<string, Array<{ gameId: string; seasonType: string; week: number }>>();
      for (const source of sourceGames.values()) grouped.set(source.teamId, [...(grouped.get(source.teamId) ?? []), source]);
      for (const [teamId, games] of grouped) {
        const ordered = games.sort(compareUsageGameChronology).map((entry) => entry.gameId);
        orderedGameIdsByTeam.set(teamId, [...new Set(ordered)]);
        teamSchedules.set(teamId, new Set(ordered).size);
      }
    }
    const players = aggregatePlayerUsage(usageRows, snapRows, eligibleGames.length, window as "last3" | "last5" | "last8" | "season", teamSchedules, orderedGameIdsByTeam)
      .filter((player) => filterUsagePlayers([player], canonicalFilter ?? undefined, position).length > 0);
    const fallbackScheduleGames = canonicalFilter
      ? teamSchedules.get(canonicalFilter) ?? 0
      : Math.max(0, ...teamSchedules.values());
    const requestedGames = window === "season"
      ? fallbackScheduleGames
      : Math.min(fallbackScheduleGames, Number(window.replace("last", "")));
    const sourceCoverage = {
      requestedGames: players.length ? Math.max(...players.map((p) => p.sourceCoverage.requestedGames)) : requestedGames,
      includedGames: players.length ? Math.max(...players.map((p) => p.sourceCoverage.includedGames)) : 0,
      partialReasons: [
        ...(!eligibleGames.length && !usageRows.length ? ["No completed games are available for the requested cutoff"] : []),
        ...(usesSourceChronology && usageRows.length
          ? ["Schedule kickoff coverage is unavailable; source game chronology uses season type and week"] : []),
        ...(!players.length && (eligibleGames.length || usageRows.length) ? ["No persisted player-game records match the requested filters"] : []),
        ...(players.some((p) => p.sourceCoverage.partialReasons.length) ? ["Player histories are sparse relative to the requested window"] : []),
        ...(players.some((p) => !p.metricAvailability.snapShare) ? ["Snap coverage is incomplete for some players"] : []),
        ...(players.some((p) => !p.metricAvailability.targetShare) ? ["Team target denominators are unavailable for some players"] : []),
      ],
    };
    res.json({
      status: players.length ? (sourceCoverage.partialReasons.length ? "partial" : "available") : "unavailable",
      players,
      filters: { team: team ?? null, position: position ?? null, game: game ?? null, window },
      metricAvailability: Object.fromEntries([...USAGE_METRICS, ...UNSUPPORTED_USAGE_METRICS]
        .map((name) => [name, players.some((p) => p.metricAvailability[name])])),
      sourceCoverage,
    });
  } catch (error) {
    req.log.error({ error }, "Consumer player usage read failed");
    res.status(503).json({ error: "Player usage data is being refreshed", code: "consumer_data_unavailable" });
  }
});

export default router;
