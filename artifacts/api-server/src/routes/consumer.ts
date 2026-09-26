import { and, asc, count, desc, eq, gt, gte, inArray, isNotNull, lt, lte, or, sql } from "drizzle-orm";
import { getAuth } from "@clerk/express";
import { Router, type IRouter, type NextFunction, type Request, type Response } from "express";
import {
  db,
  gamesTable,
  nflversePlayerIdentitiesTable,
  playerGameStatsTable,
  redZonePlayerGameFactsTable,
  redZoneTeamGameFactsTable,
  snapCountsTable,
  pregameTeamFeaturesTable,
  predictionSnapshotsTable,
  sportsbookOddsTable,
  teamsTable,
  weatherForecastSnapshotsTable,
  modelTrainingRunsTable,
  playersTable,
  oddsApiRequestsTable,
  oddsEventAuditsTable,
  savedGamesTable,
} from "@workspace/db";
import {
  gameSpecificSnapshot,
  getHistoricalOfficialPredictionSnapshots,
  getLatestValidPredictionSnapshots,
  getSnapshotIneligibilityReasons,
  snapshotUnavailableMessages,
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
import { getCurrentGamePersonnel } from "../lib/current-personnel";
import type { InterpretedTeamDepth } from "../lib/current-personnel-derivation";
import { authoritativeFinalRegularSeasonGame, buildTeamRecords, consumerFinalScore, gameStatusVocabulary, interpretNflGameState, NFL_STATUS_VOCABULARY, SUPPORTED_GAME_STATUS_PATTERNS, verifyTeamRecords } from "../lib/game-state";
import { getConsumerSourceHealth } from "../lib/consumer-source-health";
import { consumerRecommendation } from "../lib/consumer-recommendation";
import { selectConsumerSlateSummaries } from "../lib/consumer-schedule-selection";
import { readInitialWeeklyPick } from "../lib/initial-line-picks";
import { isRedZoneFeatureEnabled } from "../lib/red-zone-feature-flag";
import { buildDefenseVsPosition, defaultDefenseSeason, readDefenseInputs, readMatchupDefenseInputs, WINDOWS } from "../lib/defense-vs-position";
import { attachQualifiedScoringTdProbability, buildPlayerPositionMatchup } from "../lib/player-position-matchup";
import { readDevelopmentPlayerTdForecastReadiness } from "../lib/player-td-forecast-readiness";
import { GetConsumerPlayerPositionMatchupResponse } from "@workspace/api-zod";
import { GetConsumerScheduleSelectionResponse, ListSavedGameIdsResponse, ListSavedGamesResponse, SaveConsumerGameParams, RemoveSavedConsumerGameParams } from "@workspace/api-zod";
import { classifyPlayerEligibility } from "../lib/consumer-player-eligibility";
import { consumerVerifiedImages, playerHeadshot } from "../lib/verified-imagery";
import {
  completeGameMarketObservation,
  consumerMarketFreshnessMinutes,
} from "../lib/consumer-market-freshness";
import {
  cutoffSafeRedZoneGames,
  coveredRedZoneWindow,
  groupRedZoneAppearancesByPlayerTeam,
  hasPlayerStatAppearance,
  RED_ZONE_VALUES,
  redZoneCoveragePeriodLabel,
  redZonePlayerFactForAppearance,
  redZoneShare,
} from "../lib/red-zone-opportunities";
export { consumerFinalScore } from "../lib/game-state";
export { verifyTeamRecords } from "../lib/game-state";

const router: IRouter = Router();
export function redZoneFeatureGate(_req: Request, res: Response, next: NextFunction): void {
  if (!isRedZoneFeatureEnabled()) {
    res.status(503).json({
      error: "Red-zone opportunities are temporarily unavailable",
      code: "red_zone_unavailable",
    });
    return;
  }
  next();
}
export const MAX_CONSUMER_GAMES = 100;
export const MAX_CONSUMER_MOVEMENT_ROWS = 200;
export const MAX_CONSUMER_SNAPSHOT_ROWS = MAX_CONSUMER_GAMES;
export const MAX_CONSUMER_PERFORMANCE_ROWS = 5_000;
export function consumerProjection(snapshot: typeof predictionSnapshotsTable.$inferSelect | undefined) {
  return snapshot ? {
    modelLabel: "Gridline Production Model",
    officialFinalPrediction: snapshot.officialFinalPrediction,
    predictionTimestamp: snapshot.predictionTimestamp.toISOString(),
    projectedHomeScore: safeNumber(snapshot.projectedHomeScore),
    projectedAwayScore: safeNumber(snapshot.projectedAwayScore),
    projectedMargin: safeNumber(snapshot.projectedMargin),
    projectedTotal: safeNumber(snapshot.projectedTotal),
    homeWinProbability: safeNumber(snapshot.homeWinProbability),
    awayWinProbability: safeNumber(snapshot.awayWinProbability),
  } : null;
}
const SUPPORTED_CONSUMER_BOOKS = new Set(["DraftKings", "FanDuel"]);
const SUPPORTED_CONSUMER_MARKETS = new Set(["spread", "total", "moneyline"]);
const PERSONNEL_CONTEXT_VERSION = "pregame-v4-personnel-context";

type ConsumerFilters = { season?: number; week?: number; gameId?: string; gameIds?: string[]; asOf?: Date };

export const USAGE_METRICS = ["snapShare", "attempts", "completions", "passingYards", "passingTds", "targets", "targetShare", "receptions", "receivingYards", "receivingTds", "carries", "rushingYards", "totalTd", "yardsPerTarget", "yardsPerCarry"] as const;
export const UNSUPPORTED_USAGE_METRICS = ["redZoneTouches", "redZoneTargets", "explosiveRate"] as const;
type UsageMetric = typeof USAGE_METRICS[number];
type UsageRow = {
  playerId: string; playerName: string; position: string | null; teamId: string | null;
  gameId: string; season: number; week: number; seasonType: string;
  attempts?: number | null; completions?: number | null; passingYards?: number | null; passingTds?: number | null;
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

export function eligibleUsageRows<T extends { season: number; gameId: string }>(
  rows: T[],
  season: number,
  eligibleGameIds: Set<string>,
  allowSourceChronology: boolean,
) {
  return rows.filter((row) =>
    row.season === season && (allowSourceChronology || eligibleGameIds.has(row.gameId)));
}

export function eligibleUsageGames<T extends { gameId: string; season: number; kickoffTime: Date | null; gameStatus?: string }>(
  games: T[],
  season: number,
  cutoff: Date,
  excludedGameId?: string,
) {
  return [...games]
    .filter((game) =>
      game.gameId !== excludedGameId
      && game.season === season
      && (game.gameStatus === undefined || game.gameStatus === "STATUS_FINAL")
      && game.kickoffTime !== null
      && game.kickoffTime < cutoff)
    .sort((left, right) =>
      left.kickoffTime!.getTime() - right.kickoffTime!.getTime()
      || left.gameId.localeCompare(right.gameId));
}

export function usageSeasonAtCutoff(cutoff: Date) {
  return cutoff.getUTCMonth() < 2 ? cutoff.getUTCFullYear() - 1 : cutoff.getUTCFullYear();
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

type UsageScheduleGame = { season: number; week: number; homeTeamId: string; awayTeamId: string };
type UsageTeamMaps = ReturnType<typeof buildUsageTeamMappings>;

/** Source game IDs differ from schedule IDs (and snap IDs). Match exact eligible
 * team/opponent/week identities in SQL so a same-week future game cannot leak. */
export function usageSourceGameKeys(games: UsageScheduleGame[], maps: UsageTeamMaps, teamFilter?: string) {
  const keys = new Map<string, { week: number; team: string; opponent: string }>();
  for (const game of games) {
    const home = maps.scheduleToAbbreviation.get(game.homeTeamId);
    const away = maps.scheduleToAbbreviation.get(game.awayTeamId);
    if (!home || !away) continue;
    for (const [team, opponent] of [[home, away], [away, home]]) {
      if (teamFilter && team !== teamFilter) continue;
      for (const sourceTeam of nflverseTeamCandidates(team)) {
        for (const sourceOpponent of nflverseTeamCandidates(opponent)) {
          keys.set(`${game.week}:${sourceTeam}:${sourceOpponent}`, {
            week: game.week, team: sourceTeam, opponent: sourceOpponent,
          });
        }
      }
    }
  }
  return [...keys.values()];
}

function usageSourceGameCondition(
  table: typeof playerGameStatsTable | typeof snapCountsTable,
  keys: ReturnType<typeof usageSourceGameKeys>,
  includeMissingOpponent = false,
) {
  if (!keys.length) return sql`false`;
  // Row-value IN is parameterized; the composite season/team/week/opponent index
  // can serve each game key without reading unrelated weeks or matchups.
  const exact = sql`(${table.week}, ${table.teamId}, ${table.opponentTeamId}) in
    (${sql.join(keys.map((key) => sql`(${key.week}, ${key.team}, ${key.opponent})`), sql`, `)})`;
  if (!includeMissingOpponent) return exact;
  // Game Detail historically accepts player-game rows without an opponent ID
  // when the team's schedule week still identifies the game.
  const teamWeeks = new Map(keys.map((key) => [`${key.week}:${key.team}`, key]));
  return sql`(${exact} or (${table.opponentTeamId} is null and
    (${table.week}, ${table.teamId}) in
    (${sql.join([...teamWeeks.values()].map((key) => sql`(${key.week}, ${key.team})`), sql`, `)})))`;
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
  const teamGameTargets = new Map<string, number>();
  for (const row of rows) {
    const key = `${row.teamId}:${row.gameId}`;
    teamGameTargets.set(key, (teamGameTargets.get(key) ?? 0) + (row.targets ?? 0));
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
    const selectedTeamGames = new Set(selected.map((row) => `${row.teamId}:${row.gameId}`));
    const teamTargets = selectedTeamGames.size
      ? [...selectedTeamGames].reduce((total, key) => total + (teamGameTargets.get(key) ?? 0), 0)
      : null;
    const receivingYards = sum("receivingYards");
    const carries = sum("carries");
    const rushingYards = sum("rushingYards");
    const values: Record<string, ReturnType<typeof metric>> = {
      snapShare: metric(snapValues.length ? snapValues.reduce((a, b) => a + b, 0) / snapValues.length : null, snapValues.length ? null : "Snap share unavailable"),
      attempts: metric(sum("attempts")), completions: metric(sum("completions")),
      passingYards: metric(sum("passingYards")), passingTds: metric(sum("passingTds")),
      targets: metric(targets), targetShare: metric(targets !== null && teamTargets !== null && teamTargets > 0 ? targets / teamTargets : null, teamTargets && teamTargets > 0 ? null : "Team target denominator unavailable"),
      receptions: metric(sum("receptions")), receivingYards: metric(receivingYards), receivingTds: metric(sum("receivingTds")),
      carries: metric(carries), rushingYards: metric(rushingYards),
      totalTd: metric(["passingTds", "rushingTds", "receivingTds"].every((key) => sum(key as keyof UsageRow) === null)
        ? null : (sum("passingTds") ?? 0) + (sum("rushingTds") ?? 0) + (sum("receivingTds") ?? 0)),
      yardsPerTarget: metric(targets && targets > 0 && receivingYards !== null ? receivingYards / targets : null, targets && targets > 0 ? null : "Targets denominator unavailable"),
      yardsPerCarry: metric(carries && carries > 0 && rushingYards !== null ? rushingYards / carries : null, carries && carries > 0 ? null : "Carries denominator unavailable"),
      ...Object.fromEntries(UNSUPPORTED_USAGE_METRICS.map((name) => [name, metric(null, "Persisted source does not support this metric")])),
    };
    const gameSeries = selected.map((r) => {
      const gameTargets = teamGameTargets.get(`${r.teamId}:${r.gameId}`) ?? 0;
      const td = r.passingTds == null && r.rushingTds === null && r.receivingTds === null
        ? null : (r.passingTds ?? 0) + (r.rushingTds ?? 0) + (r.receivingTds ?? 0);
      const targetShare = r.targets !== null && gameTargets > 0 ? r.targets / gameTargets : null;
      const ypt = r.targets !== null && r.targets > 0 && r.receivingYards !== null ? r.receivingYards / r.targets : null;
      const ypc = r.carries !== null && r.carries > 0 && r.rushingYards !== null ? r.rushingYards / r.carries : null;
      return {
      gameId: r.gameId, season: r.season, week: r.week, seasonType: r.seasonType,
      metrics: Object.fromEntries([...USAGE_METRICS, ...UNSUPPORTED_USAGE_METRICS].map((name) => {
        const values: Record<string, number | null> = {
          snapShare: snapMap.get(`${r.playerId}:${r.gameId}`) ?? null, targets: r.targets,
          attempts: r.attempts ?? null, completions: r.completions ?? null,
          passingYards: r.passingYards ?? null, passingTds: r.passingTds ?? null,
          targetShare, receptions: r.receptions, receivingYards: r.receivingYards, receivingTds: r.receivingTds,
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
    const trendMetric = (name: "targets" | "snapShare" | "passingYards") => {
      const values = gameSeries.map((g) => g.metrics[name].value).filter((v): v is number => v !== null);
      return values.length >= 2 ? values.at(-1)! - values[0]! : null;
    };
    const delta = ordered[0].position?.toUpperCase() === "QB"
      ? trendMetric("passingYards") ?? trendMetric("snapShare")
      : trendMetric("targets") ?? trendMetric("snapShare");
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

/** Pick a representative skill-position core before filling remaining Game Detail cards. */
export function rankRecentKeyPlayers<T extends {
  playerId: string; teamId: string | null; position: string | null;
  aggregate: Record<string, { value: number | null }>;
}>(players: T[], teamId: string): T[] {
  const candidates = filterUsagePlayers(players, teamId);
  const touches = (player: T) => (player.aggregate.targets?.value ?? 0) + (player.aggregate.carries?.value ?? 0);
  const compare = (a: T, b: T) =>
    touches(b) - touches(a)
    || (b.aggregate.snapShare?.value ?? -1) - (a.aggregate.snapShare?.value ?? -1)
    || a.playerId.localeCompare(b.playerId);
  const selected: T[] = [];
  for (const position of ["QB", "RB", "WR", "TE"]) {
    const ranked = candidates.filter((player) => player.position?.toUpperCase() === position)
      .sort(position === "QB"
        ? (a, b) => (b.aggregate.snapShare?.value ?? -1) - (a.aggregate.snapShare?.value ?? -1) || compare(a, b)
        : compare);
    if (ranked[0]) selected.push(ranked[0]);
  }
  const ids = new Set(selected.map((player) => player.playerId));
  return [...selected, ...candidates.filter((player) => !ids.has(player.playerId)).sort(compare)].slice(0, 5);
}

export function safeNumber(value: unknown): number | null {
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
  verifiedAt: Date | null = null,
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
    const staleAfterMinutes = kickoffTime
      ? consumerMarketFreshnessMinutes(kickoffTime, cutoff, spec.market)
      : 0;
    const effectiveObservationAt = verifiedAt && verifiedAt <= cutoff ? verifiedAt : null;
    const stale = Boolean(selected && (!effectiveObservationAt
      || cutoff.getTime() - effectiveObservationAt.getTime() > staleAfterMinutes * 60_000));
    const observationAgeMinutes = selected
      ? Math.max(0, (cutoff.getTime() - selected.capturedAt.getTime()) / 60_000)
      : null;
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
      observationAgeMinutes,
      freshnessLabel: selected
        ? stale
          ? `Stale — last observed ${selected.capturedAt.toISOString()}`
          : `Updated ${Math.round(observationAgeMinutes ?? 0)} min ago`
        : "No observation",
    };
  });
  const available = comparisons.filter((item) => item.state === "available").length;
  const stale = comparisons.filter((item) => item.state === "stale").length;
  return {
    status: available === 3 ? "available" as const
      : available > 0 ? "partial" as const
      : stale > 0 ? "stale" as const
      : "absent" as const,
        staleAfterMinutes: kickoffTime
          ? Math.min(...comparisons.map((comparison) =>
              consumerMarketFreshnessMinutes(kickoffTime, cutoff, comparison.market)))
          : 0,
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

export function serializeMovement(rows: MovementRow[], kickoffTime?: Date | null, now = new Date()) {
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
      const eligible = kickoffTime && kickoffTime.getTime() <= now.getTime()
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
  sourceCutoff?: unknown;
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
      lineupSlot?: unknown;
      dataFreshness?: unknown;
      snapshotTimestamp?: unknown;
    }>;
    qb?: { starterCertainty?: unknown; starterChange?: unknown; projectedStarter?: unknown };
    injuries?: Record<string, { impactScore?: unknown }>;
    injuryPlayers?: Array<{
      playerId?: unknown;
      playerName?: unknown;
      position?: unknown;
      injury?: unknown;
      designation?: unknown;
      gameStatus?: unknown;
      practiceStatus?: unknown;
      snapshotTimestamp?: unknown;
      unavailableReasons?: unknown;
    }>;
    personnelCompleteness?: unknown;
  }>;
};

type SerializedContext = {
  available: boolean;
  dataConfidence: number | null;
  teams: Array<{
    side: "home" | "away";
    name: string;
    abbreviation: string;
    qbCertainty: number | null;
    qbChange: boolean | null;
    qbEvidenceAvailable: boolean;
    personnelCompleteness: number | null;
    offenseInjuryImpact: number | null;
    defenseInjuryImpact: number | null;
    injuryEvidenceAvailable: boolean;
    injuryReportStatus: "available" | "partial" | "unavailable";
    expectedQb: {
      name: string | null;
      status: "available" | "unconfirmed" | "unavailable";
      availability: "available" | "questionable" | "unavailable" | "unknown";
      confidence: number | null;
      asOf: string | null;
      confirmed: boolean;
    };
    currentOffenseRoles: {
      runningBackCommittee: { status: "confirmed" | "unconfirmed"; players: CurrentRoleEntry[] };
      primaryTe: { name: string | null; availability: "available" | "questionable" | "unavailable" | "unknown"; confidence: number | null; asOf: string | null; confirmed: boolean };
      wr1: { name: string | null; availability: "available" | "questionable" | "unavailable" | "unknown"; confidence: number | null; asOf: string | null; confirmed: boolean };
      wr2: { name: string | null; availability: "available" | "questionable" | "unavailable" | "unknown"; confidence: number | null; asOf: string | null; confirmed: boolean };
    };
    defensiveGroupings: {
      front: Array<{ name: string; position: string; role: string | null; confidence: number | null; availability: "available" | "questionable" | "unavailable" | "unknown"; asOf: string | null; confirmed: boolean }>;
      linebackers: Array<{ name: string; position: string; role: string | null; confidence: number | null; availability: "available" | "questionable" | "unavailable" | "unknown"; asOf: string | null; confirmed: boolean }>;
      corners: Array<{ name: string; position: string; role: string | null; confidence: number | null; availability: "available" | "questionable" | "unavailable" | "unknown"; asOf: string | null; confirmed: boolean }>;
      safeties: Array<{ name: string; position: string; role: string | null; confidence: number | null; availability: "available" | "questionable" | "unavailable" | "unknown"; asOf: string | null; confirmed: boolean }>;
    };
    injuries: Array<{
      name: string; position: string | null; injury: string | null; gameStatus: string | null;
      practiceStatus: string | null; asOf: string | null; sourceLabel: "ESPN injury report";
    }>;
    asOf: string | null;
    depthFreshness: "current" | "stale" | "partial" | "unavailable";
    depth: Array<{
      name: string; position: string; unit: "offense" | "defense"; depthRank: number | null;
      role: "published_starter" | "published_backup" | "projected_starter" | "uncertain";
      sourceLabel: "Published depth" | "Projected from recent participation" | "Evidence uncertain";
      recentSnapShare: number | null; injuryStatus: string | null; practiceStatus: string | null;
      starterConfidence: number | null; evidenceSummary: string | null; lineupSlot: string | null;
      freshness: "fresh" | "stale" | "unavailable"; asOf: string | null;
    }>;
  }>;
  drivers: string[];
  projectedMatchups: [];
  matchupMessage: string;
  message: string | null;
  modelPersonnelLimitation: { active: boolean; reason: string | null; recommendationSuppressed: boolean };
};

type CurrentRoleEntry = {
  name: string | null;
  availability: "available" | "questionable" | "unavailable" | "unknown";
  confidence: number | null;
  asOf: string | null;
  confirmed: boolean;
};

const emptyCurrentRole = (): CurrentRoleEntry => ({
  name: null, availability: "unknown", confidence: null, asOf: null, confirmed: false,
});

function currentRoleEntry(
  player: InterpretedTeamDepth["depth"]["offense"][number] | undefined,
  team: InterpretedTeamDepth,
): CurrentRoleEntry {
  if (!player) return emptyCurrentRole();
  const status = player.injuryState.gameStatus ?? player.injuryState.practiceStatus
    ?? player.injuryState.sleeperStatus ?? player.injuryState.sleeperInjuryStatus ?? "";
  const availability = /out|inactive|injured reserve|\bir\b|suspend|physically unable/i.test(status)
    ? "unavailable" as const
    : /questionable|limited|doubtful|day.to.day/i.test(status) ? "questionable" as const
      : /active|available|full|healthy|probable/i.test(status) ? "available" as const : "unknown" as const;
  const evidenceAsOf = player.providerEvidence.map((item) => item.capturedAt).filter((value): value is string => Boolean(value)).sort().at(-1) ?? null;
  const confirmed = team.freshness === "current"
    && player.sourceClassification !== "inferred"
    && availability !== "unavailable"
    && !player.conflicts.some((conflict) => conflict.severity === "blocking");
  return {
    name: player.playerName,
    availability,
    confidence: player.confidence,
    asOf: player.injuryState.asOf ?? evidenceAsOf ?? team.asOf,
    confirmed,
  };
}

function currentDefenseEntry(
  player: InterpretedTeamDepth["depth"]["defense"][number],
  team: InterpretedTeamDepth,
) {
  const entry = currentRoleEntry(player, team);
  return {
    ...entry,
    name: entry.name ?? "Player name unconfirmed",
    position: player.position ?? "Unknown",
    role: player.role,
  };
}

function savedPersonnelQbId(
  evidence: unknown,
  side: "home" | "away",
  teamId: string,
  opponentId: string,
  predictionTimestamp: Date,
  kickoffTime: Date | null,
) {
  if (!evidence || typeof evidence !== "object") return null;
  const rows = (evidence as Record<string, unknown>).rows;
  if (!Array.isArray(rows) || rows.length !== 2) return null;
  const row = rows.find((candidate) => candidate && typeof candidate === "object"
    && (candidate as Record<string, unknown>).isHome === (side === "home"));
  if (!row || typeof row !== "object") return null;
  const input = row as Record<string, unknown>;
  if (input.teamId !== teamId || input.opponentTeamId !== opponentId) return null;
  const sourceCutoff = typeof input.sourceCutoff === "string" ? Date.parse(input.sourceCutoff) : NaN;
  const generatedAt = typeof input.generatedAt === "string" ? Date.parse(input.generatedAt) : NaN;
  if (!Number.isFinite(sourceCutoff) || !Number.isFinite(generatedAt)
    || sourceCutoff > predictionTimestamp.getTime() || generatedAt > predictionTimestamp.getTime()
    || (kickoffTime && sourceCutoff >= kickoffTime.getTime())) return null;
  const selectedAudit = input.selectedAudit;
  if (!selectedAudit || typeof selectedAudit !== "object") return null;
  const context = (selectedAudit as Record<string, unknown>)._personnel_context;
  if (!context || typeof context !== "object") return null;
  const teams = (context as Record<string, unknown>).teams;
  if (!teams || typeof teams !== "object") return null;
  const team = (teams as Record<string, unknown>)[side];
  if (!team || typeof team !== "object") return null;
  const qb = (team as Record<string, unknown>).qb;
  if (!qb || typeof qb !== "object") return null;
  const starter = (qb as Record<string, unknown>).projectedStarter;
  if (!starter || typeof starter !== "object") return null;
  const playerId = (starter as Record<string, unknown>).playerId;
  return typeof playerId === "string" && playerId.trim() ? playerId : null;
}

export function currentModelPersonnelLimitation(input: {
  savedInputSourceEvidence: unknown;
  predictionTimestamp: Date | null;
  kickoffTime: Date | null;
  homeTeamId: string;
  awayTeamId: string;
  current: { home: InterpretedTeamDepth | null; away: InterpretedTeamDepth | null } | null;
  historical?: { home: InterpretedTeamDepth | null; away: InterpretedTeamDepth | null } | null;
}) {
  const unchanged = { active: false, reason: null as string | null, recommendationSuppressed: false };
  if (!input.predictionTimestamp || !input.current) return unchanged;
  const unmodeledSides: string[] = [];
  for (const side of ["home", "away"] as const) {
    const team = input.current[side];
    const historicalTeam = input.historical?.[side];
    const opponentId = side === "home" ? input.awayTeamId : input.homeTeamId;
    const teamId = side === "home" ? input.homeTeamId : input.awayTeamId;
    const expected = team?.qbStarter;
    const expectedPlayer = expected?.status === "available"
      && expected.player?.sourceClassification !== "inferred"
      && !expected.player?.conflicts?.some((conflict) => conflict.severity === "blocking")
      ? expected.player : null;
    const savedId = savedPersonnelQbId(
      input.savedInputSourceEvidence, side, teamId, opponentId, input.predictionTimestamp, input.kickoffTime,
    );
    if (savedId && team?.freshness === "current" && expectedPlayer?.playerId && savedId !== expectedPlayer.playerId) {
      return {
        active: true,
        reason: `The supported ${side === "home" ? "home" : "away"} expected quarterback differs from the quarterback identity stored with this saved prediction. The saved projection is unchanged; an official recommendation is withheld.`,
        recommendationSuppressed: true,
      };
    }
    const historicalQb = historicalTeam?.freshness === "current"
      && historicalTeam.qbStarter.status === "available"
      && historicalTeam.qbStarter.player?.rank === 1
      && historicalTeam.qbStarter.player.sourceClassification !== "inferred"
      && !historicalTeam.qbStarter.player.conflicts?.some((conflict) => conflict.severity === "blocking")
      ? historicalTeam.qbStarter.player : null;
    const currentEvidenceAfterPrediction = expectedPlayer?.providerEvidence?.some((item) => {
      const capturedAt = item.capturedAt ? Date.parse(item.capturedAt) : NaN;
      return Number.isFinite(capturedAt) && capturedAt > input.predictionTimestamp!.getTime()
        && (!input.kickoffTime || capturedAt < input.kickoffTime.getTime());
    });
    const historicalCutoffSafe = historicalTeam?.asOf
      ? Date.parse(historicalTeam.asOf) <= input.predictionTimestamp.getTime() : false;
    if (!savedId && team?.freshness === "current" && expectedPlayer?.rank === 1
      && expectedPlayer.playerId && historicalQb?.rank === 1 && historicalQb.playerId
      && historicalQb.playerId !== expectedPlayer.playerId && historicalCutoffSafe
      && currentEvidenceAfterPrediction) {
      return {
        active: true,
        reason: `Cutoff-safe personnel evidence confirms the ${side} QB1 changed after this prediction, but the saved model input does not retain a named quarterback identity. The saved projection is unchanged; an official recommendation is withheld.`,
        recommendationSuppressed: true,
      };
    }
    if (!savedId && team) unmodeledSides.push(side);
  }
  if (unmodeledSides.length) {
    return {
      active: true,
      reason: `The saved model input does not retain a named quarterback identity for the ${unmodeledSides.join(" and ")} side${unmodeledSides.length === 1 ? "" : "s"}; a modeled-QB comparison cannot be confirmed. No player identity is inferred from numeric QB-confidence features.`,
      recommendationSuppressed: false,
    };
  }
  return unchanged;
}

export function applyModelPersonnelLimitationToRecommendation<
  T extends {
    status: "healthy" | "partial" | "stale" | "unavailable" | "historical";
    reason: string | null;
    markets: { spread: boolean; total: boolean; moneyline: boolean };
  },
>(recommendation: T, limitation: { active: boolean; reason: string | null; recommendationSuppressed: boolean }) {
  if (!limitation.active || !limitation.recommendationSuppressed) return recommendation;
  return {
    ...recommendation,
    status: "unavailable" as const,
    reason: limitation.reason,
    markets: { spread: false, total: false, moneyline: false },
  };
}

export function serializeContext(
  context: PersistedContext | null,
  homeTeamId: string,
  awayTeamId: string,
): SerializedContext {
  if (!context) {
    return {
      available: false,
      dataConfidence: null,
      teams: [],
      drivers: [],
      projectedMatchups: [],
      matchupMessage: "Matchup projection not yet available.",
      message: "Player information temporarily unavailable",
      modelPersonnelLimitation: { active: false, reason: null, recommendationSuppressed: false },
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
        lineupSlot: typeof player.lineupSlot === "string" ? player.lineupSlot : null,
        freshness: ["fresh", "stale", "unavailable"].includes(String(player.dataFreshness))
          ? player.dataFreshness as "fresh" | "stale" | "unavailable"
          : "unavailable" as const,
        asOf: typeof player.snapshotTimestamp === "string" ? player.snapshotTimestamp : null,
      }];
    });
    const injuries = (team?.injuryPlayers ?? []).slice(0, 25).flatMap((player) => {
      if (typeof player.playerName !== "string") return [];
      return [{
        name: player.playerName,
        position: typeof player.position === "string" ? player.position : null,
        injury: typeof player.injury === "string" ? player.injury : null,
        gameStatus: typeof player.gameStatus === "string" ? player.gameStatus : null,
        practiceStatus: typeof player.practiceStatus === "string" ? player.practiceStatus : null,
        asOf: typeof player.snapshotTimestamp === "string" ? player.snapshotTimestamp : null,
        sourceLabel: "ESPN injury report" as const,
      }];
    });
    const injuryReportStatus = !Array.isArray(team?.injuryPlayers) || team.injuryPlayers.length === 0
      ? "unavailable" as const
      : injuries.length < team.injuryPlayers.length || injuries.some((player) =>
        !player.position || !player.injury || !player.gameStatus || !player.practiceStatus || !player.asOf)
        ? "partial" as const
        : "available" as const;
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
      injuryReportStatus,
      injuries,
      expectedQb: {
        name: null, status: "unconfirmed" as const, availability: "unknown" as const,
        confidence: safeNumber(team?.qb?.starterCertainty),
        asOf: typeof context.sourceCutoff === "string" ? context.sourceCutoff : null, confirmed: false,
      },
      currentOffenseRoles: {
        runningBackCommittee: { status: "unconfirmed" as const, players: [] },
        primaryTe: emptyCurrentRole(), wr1: emptyCurrentRole(), wr2: emptyCurrentRole(),
      },
      defensiveGroupings: { front: [], linebackers: [], corners: [], safeties: [] },
      asOf: typeof context.sourceCutoff === "string" ? context.sourceCutoff : null,
      depthFreshness: depth.length === 0 ? "unavailable" as const
        : depth.some((player) => player.freshness === "stale") ? "stale" as const
        : depth.some((player) => player.freshness === "unavailable") ? "partial" as const
        : "current" as const,
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
    modelPersonnelLimitation: { active: false, reason: null, recommendationSuppressed: false },
  };
}

export function applyCurrentPersonnelToConsumerContext(
  context: SerializedContext,
  current: { asOf: string; teams: { home: InterpretedTeamDepth | null; away: InterpretedTeamDepth | null } } | null,
): SerializedContext {
  if (!current) return {
    ...context,
    teams: context.teams.map((team) => ({
      ...team, depth: [], injuries: [], depthFreshness: "unavailable" as const,
      injuryReportStatus: "unavailable" as const,
    })),
  };
  const baseTeams = context.teams.length ? context.teams : (["home", "away"] as const).map((side) => {
    const source = current.teams[side];
    return {
      side,
      name: source?.teamName ?? "Team unavailable",
      abbreviation: source?.abbreviation ?? "—",
      expectedQb: { name: null, status: "unconfirmed" as const, availability: "unknown" as const, confidence: null, asOf: current.asOf, confirmed: false },
      currentOffenseRoles: {
        runningBackCommittee: { status: "unconfirmed" as const, players: [] },
        primaryTe: emptyCurrentRole(), wr1: emptyCurrentRole(), wr2: emptyCurrentRole(),
      },
      defensiveGroupings: { front: [], linebackers: [], corners: [], safeties: [] },
      qbCertainty: null,
      qbChange: null,
      qbEvidenceAvailable: false,
      personnelCompleteness: null,
      offenseInjuryImpact: null,
      defenseInjuryImpact: null,
      injuryEvidenceAvailable: false,
      injuryReportStatus: "unavailable" as const,
      injuries: [],
      asOf: current.asOf,
      depthFreshness: "unavailable" as const,
      depth: [],
    };
  });
  const currentAvailable = Object.values(current.teams).some((team) =>
    Boolean(team && (team.depth.offense.length || team.depth.defense.length || team.injuryReport.length)));
  return {
    ...context,
    available: context.available || currentAvailable,
    message: context.message && !currentAvailable ? context.message : null,
    teams: baseTeams.map((team) => {
      const source = current.teams[team.side];
      if (!source) return {
        ...team, expectedQb: {
          name: null, status: "unconfirmed" as const, availability: "unknown" as const,
          confidence: null, asOf: current.asOf, confirmed: false,
        },
        currentOffenseRoles: {
          runningBackCommittee: { status: "unconfirmed" as const, players: [] },
          primaryTe: emptyCurrentRole(), wr1: emptyCurrentRole(), wr2: emptyCurrentRole(),
        },
        defensiveGroupings: { front: [], linebackers: [], corners: [], safeties: [] },
        depth: [], injuries: [], depthFreshness: "unavailable" as const,
        injuryReportStatus: "unavailable" as const, asOf: current.asOf,
      };
      const players = [...source.depth.offense, ...source.depth.defense]
        .filter((player) => player.starter || (player.rank ?? 99) <= 2)
        .slice(0, 30);
      const depth = players.map((player) => {
        const published = player.sourceClassification === "official" || player.sourceClassification === "published_secondary";
        const offense = ["QB", "RB", "FB", "WR", "TE", "OL", "OT", "T", "LT", "RT", "G", "LG", "RG", "C"]
          .includes(player.position ?? "");
        const role = published
          ? player.rank === 1 ? "published_starter" as const : "published_backup" as const
          : player.rank === 1 ? "projected_starter" as const : "uncertain" as const;
        const normalizedRole = player.role?.toUpperCase() ?? null;
        return {
          name: player.playerName ?? "Player name unavailable",
          position: player.position ?? "Unknown",
          unit: offense ? "offense" as const : "defense" as const,
          depthRank: player.rank,
          role,
          sourceLabel: published ? "Published depth" as const
            : player.sourceClassification === "inferred" ? "Projected from recent participation" as const
            : "Evidence uncertain" as const,
          recentSnapShare: player.recentSnapShare,
          injuryStatus: player.injuryState.gameStatus,
          practiceStatus: player.injuryState.practiceStatus,
          starterConfidence: player.confidence,
          evidenceSummary: player.explanation[0] ?? null,
          lineupSlot: player.position === "WR" && ["LWR", "RWR", "SWR"].includes(normalizedRole ?? "")
            ? normalizedRole : player.position,
          freshness: source.freshness === "current" ? "fresh" as const
            : source.freshness === "stale" ? "stale" as const : "unavailable" as const,
          asOf: player.providerEvidence.map((evidence) => evidence.capturedAt).filter(Boolean).sort().at(-1) ?? null,
        };
      });
      const injuries = source.injuryReport.flatMap((injury) => {
        if (!injury.playerName) return [];
        return [{
          name: injury.playerName,
          position: injury.position,
          injury: injury.injury,
          gameStatus: injury.gameStatus,
          practiceStatus: injury.practiceStatus,
          asOf: injury.asOf,
          sourceLabel: "ESPN injury report" as const,
        }];
      });
      const injuryReportStatus = source.injuryReport.length === 0 ? "unavailable" as const
        : injuries.length < source.injuryReport.length ? "partial" as const
        : injuries.some((player) =>
          !player.position || !player.injury || !player.gameStatus || !player.practiceStatus || !player.asOf)
          ? "partial" as const : "available" as const;
      const qbPlayer = source.qbStarter.player;
      const qbRoleStatus = !qbPlayer ? "unconfirmed" as const
        : source.qbStarter.status !== "available" || currentRoleEntry(qbPlayer, source).availability === "unavailable"
          ? "unavailable" as const : "available" as const;
      const confirmedQbRoleStatus = source.freshness !== "current" && qbRoleStatus === "available"
        ? "unconfirmed" as const : qbRoleStatus;
      const qbAvailability = qbPlayer ? currentRoleEntry(qbPlayer, source).availability : "unknown" as const;
      const runningBackCandidates = source.depth.offense
        .filter((player) => player.position === "RB" && (player.rank ?? 99) <= 2)
        .sort((a, b) => (a.rank ?? 99) - (b.rank ?? 99)
          || (b.recentSnapShare ?? -1) - (a.recentSnapShare ?? -1)
          || a.playerId.localeCompare(b.playerId))
        .filter((player) => currentRoleEntry(player, source).availability !== "unavailable");
      const leadBack = runningBackCandidates[0];
      const committeeBacks = leadBack ? runningBackCandidates.slice(1, 3).filter((player) =>
        player.rank === 1 || (
          leadBack.recentSnapShare !== null && player.recentSnapShare !== null
          && leadBack.recentSnapShare >= 0.25 && player.recentSnapShare >= 0.25
          && player.recentSnapShare >= leadBack.recentSnapShare * 0.55
        )) : [];
      const runningBacks = [leadBack, ...committeeBacks]
        .filter((player): player is NonNullable<typeof player> => Boolean(player))
        .map((player) => currentRoleEntry(player, source));
      const receivers = source.depth.offense.filter((player) => player.position === "WR")
        .sort((a, b) => (a.rank ?? 99) - (b.rank ?? 99)
          || (b.recentSnapShare ?? -1) - (a.recentSnapShare ?? -1)
          || a.playerId.localeCompare(b.playerId));
      const primaryTe = source.depth.offense.find((player) => player.position === "TE" && (player.rank ?? 99) <= 1);
      const defensive = source.depth.defense;
      const group = (predicate: (position: string) => boolean) => defensive
        .filter((player) => predicate(player.position ?? ""))
        .sort((a, b) => (a.rank ?? 99) - (b.rank ?? 99) || a.playerId.localeCompare(b.playerId))
        .map((player) => currentDefenseEntry(player, source));
      return {
        ...team,
        name: source.teamName ?? team.name,
        abbreviation: source.abbreviation ?? team.abbreviation,
        expectedQb: {
          name: qbPlayer?.playerName ?? null,
          status: confirmedQbRoleStatus,
          availability: qbAvailability,
          confidence: qbPlayer ? source.qbStarter.confidence : null,
          asOf: qbPlayer ? currentRoleEntry(qbPlayer, source).asOf : source.asOf,
          confirmed: Boolean(qbPlayer && confirmedQbRoleStatus === "available" && currentRoleEntry(qbPlayer, source).confirmed),
        },
        currentOffenseRoles: {
          runningBackCommittee: {
            status: runningBacks.some((player) => player.confirmed) ? "confirmed" as const : "unconfirmed" as const,
            players: runningBacks,
          },
          primaryTe: currentRoleEntry(primaryTe, source),
          wr1: currentRoleEntry(receivers[0], source),
          wr2: currentRoleEntry(receivers[1], source),
        },
        defensiveGroupings: {
          front: group((position) => ["DL", "DE", "DT", "NT", "EDGE"].includes(position)),
          linebackers: group((position) => ["LB", "ILB", "OLB", "MLB"].includes(position)),
          corners: group((position) => ["CB"].includes(position)),
          safeties: group((position) => ["S", "FS", "SS"].includes(position)),
        },
        asOf: source.asOf,
        depthFreshness: source.freshness === "current" ? "current" as const
          : source.freshness === "stale" ? "stale" as const : "unavailable" as const,
        depth,
        injuries,
        injuryEvidenceAvailable: injuries.length > 0,
        injuryReportStatus,
      };
    }),
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

export async function consumerGames(
  filters: ConsumerFilters = {},
  persistConfidence = false,
  historicalLoader: typeof getHistoricalOfficialPredictionSnapshots = getHistoricalOfficialPredictionSnapshots,
) {
  const asOf = filters.asOf ?? new Date();
  const sourceHealth = await getConsumerSourceHealth(asOf);
  const conditions = [
    filters.season === undefined ? undefined : eq(gamesTable.season, filters.season),
    filters.week === undefined ? undefined : eq(gamesTable.week, filters.week),
    filters.gameId === undefined ? undefined : eq(gamesTable.gameId, filters.gameId),
    filters.gameIds === undefined ? undefined : inArray(gamesTable.gameId, filters.gameIds),
    filters.season === undefined && filters.week === undefined && filters.gameId === undefined && filters.gameIds === undefined
      ? gt(gamesTable.kickoffTime, asOf)
      : undefined,
  ].filter((condition): condition is NonNullable<typeof condition> => Boolean(condition));
  const queriedGames = await db.select().from(gamesTable)
    .where(conditions.length ? and(...conditions) : undefined)
    .orderBy(asc(gamesTable.kickoffTime), asc(gamesTable.gameId))
    .limit(MAX_CONSUMER_GAMES);
  const games = filters.season === undefined && filters.week === undefined && filters.gameId === undefined && filters.gameIds === undefined
    ? queriedGames.filter((game) => ["scheduled", "pregame"].includes(interpretNflGameState(game, asOf)))
    : queriedGames;
  const teamIds = [...new Set(games.flatMap((game) => [game.homeTeamId, game.awayTeamId]))];
  const recordSeason = filters.season ?? games[0]?.season;
  const recordWeek = filters.week ?? games[0]?.week;
  const [teams, snapshots, marketRows, modelRuns, snapshotHistory, marketAudits] = await Promise.all([
    teamIds.length ? db.select().from(teamsTable).where(inArray(teamsTable.teamId, teamIds)) : [],
    getLatestValidPredictionSnapshots(games.map((game) => game.gameId), {
      preKickoffOnly: true,
      authoritativeGameKickoff: true,
      maxRows: MAX_CONSUMER_SNAPSHOT_ROWS,
      cutoffAt: asOf,
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
      .where(and(inArray(predictionSnapshotsTable.gameId, games.map((game) => game.gameId)), lte(predictionSnapshotsTable.predictionTimestamp, asOf)))
      .orderBy(asc(predictionSnapshotsTable.predictionTimestamp), asc(predictionSnapshotsTable.id)) : [],
    games.length ? db.selectDistinctOn([oddsEventAuditsTable.matchedGridlineGameId], {
      gameId: oddsEventAuditsTable.matchedGridlineGameId,
      auditedAt: oddsEventAuditsTable.auditedAt,
      outcome: oddsEventAuditsTable.outcome,
      observationsReceived: oddsEventAuditsTable.observationsReceived,
      rejectedObservations: oddsEventAuditsTable.rejectedObservations,
    }).from(oddsEventAuditsTable)
      .innerJoin(oddsApiRequestsTable, eq(oddsApiRequestsTable.id, oddsEventAuditsTable.requestId))
      .where(and(
        inArray(oddsEventAuditsTable.matchedGridlineGameId, games.map((game) => game.gameId)),
        eq(oddsApiRequestsTable.status, "success"),
        lte(oddsEventAuditsTable.auditedAt, asOf),
      ))
      .orderBy(
        oddsEventAuditsTable.matchedGridlineGameId,
        desc(oddsEventAuditsTable.auditedAt),
        desc(oddsEventAuditsTable.id),
      ) : [],
  ]);
  // Only final games without an active-model selection can recover their
  // already-frozen official prediction. Current-model selections always win.
  const historical = await historicalLoader(
    games.filter((game) => game.kickoffTime && game.kickoffTime <= asOf
      && interpretNflGameState(game, asOf) === "final" && !snapshots.has(game.gameId))
      .map((game) => game.gameId),
    asOf,
  );
  for (const [gameId, snapshot] of historical) snapshots.set(gameId, snapshot);
  const recordTeams = recordSeason === undefined ? [] : await db.select({
    teamId: teamsTable.teamId,
    abbreviation: teamsTable.abbreviation,
    teamName: teamsTable.teamName,
  }).from(teamsTable);
  const recordGames = recordSeason === undefined ? [] : await db.select({
    homeTeamId: gamesTable.homeTeamId,
    awayTeamId: gamesTable.awayTeamId,
    week: gamesTable.week,
    gameStatus: gamesTable.gameStatus,
    kickoffTime: gamesTable.kickoffTime,
    finalHomeScore: gamesTable.finalHomeScore,
    finalAwayScore: gamesTable.finalAwayScore,
  }).from(gamesTable).where(and(
    eq(gamesTable.season, recordSeason),
    recordWeek === undefined ? undefined : lt(gamesTable.week, recordWeek),
  ));
  const verifiedArtifacts = new Map(modelRuns.filter((run) => verifyArtifactIntegrity(run).valid).map((run) => [run.modelVersion, true]));
  const predictionReasons = await getSnapshotIneligibilityReasons(
    snapshotHistory,
    games.filter((game) => !snapshots.has(game.gameId)),
    asOf,
  );
  const teamsById = new Map(teams.map((team) => [team.teamId, team]));
  const imagery = consumerVerifiedImages(teams.map(team => ({
    teamId: team.teamId, abbreviation: team.abbreviation, name: team.teamName,
  })));
  const latestMarketAuditByGame = new Map(
    marketAudits.flatMap((audit) => audit.gameId ? [[audit.gameId, audit] as const] : []),
  );
  let persistedConfidenceResults = 0;
  if (persistConfidence) await persistConfidenceMethodology();
  const results = await Promise.all(games.map(async (game) => {
    const gameState = interpretNflGameState(game, asOf);
    const snapshot = gameSpecificSnapshot(game.gameId, snapshots);
    const home = teamsById.get(game.homeTeamId);
    const away = teamsById.get(game.awayTeamId);
    const consumerHome = home ? { teamId: home.teamId, name: home.teamName, abbreviation: home.abbreviation } : undefined;
    const market = consumerMarket(snapshot, consumerHome);
    const latestMarketAudit = latestMarketAuditByGame.get(game.gameId);
    const marketVerifiedAt = latestMarketAudit && completeGameMarketObservation(latestMarketAudit)
      ? latestMarketAudit.auditedAt
      : null;
    const marketBoard = buildConsumerMarketBoard(
      snapshot,
      marketRows.filter((row) => row.gameId === game.gameId),
      consumerHome,
      game.kickoffTime,
      asOf,
      marketVerifiedAt,
    );
    const recommendation = consumerRecommendation({
      gameState, kickoffTime: game.kickoffTime, now: asOf, sourceHealth,
      homeAbbreviation: home?.abbreviation ?? "", homeName: home?.teamName,
      awayAbbreviation: away?.abbreviation ?? "", awayName: away?.teamName,
      rows: marketRows.filter((row) => row.gameId === game.gameId),
      comparisons: marketBoard.comparisons,
      verifiedAt: marketVerifiedAt,
    });
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
      calculatedAt: asOf,
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
      gameState,
      venue: game.stadium,
      matchup: {
        home: { name: home?.teamName ?? "Team unavailable", abbreviation: home?.abbreviation ?? "—", logoUrl: imagery?.teams.logos.get(game.homeTeamId) ?? null },
        away: { name: away?.teamName ?? "Team unavailable", abbreviation: away?.abbreviation ?? "—", logoUrl: imagery?.teams.logos.get(game.awayTeamId) ?? null },
      },
      finalScore: consumerFinalScore(game, asOf),
      prediction: consumerProjection(snapshot),
      market,
      marketBoard,
      recommendation,
      dataConfidence,
      confidence: calculatedConfidence,
      availability: {
        prediction: snapshot ? null : snapshotUnavailableMessages[predictionReasons.get(game.gameId) ?? "missing_eligible_snapshot"],
        predictionReason: snapshot ? null : predictionReasons.get(game.gameId) ?? "missing_eligible_snapshot",
        market: market.evidence.available ? null : "No eligible saved sportsbook line is available.",
      },
    };
  }));
  const teamRecords = buildTeamRecords(recordTeams, recordGames, asOf);
  const completedPriorGames = recordGames.filter((game) => authoritativeFinalRegularSeasonGame(game, asOf)).length;
  return Object.assign(results, {
    sourceHealth,
    persistedConfidenceResults,
    teamRecords,
    recordVerification: verifyTeamRecords(teamRecords, { targetWeek: recordWeek, completedPriorGames }),
  });
}

router.get("/consumer/dashboard", async (_req, res): Promise<void> => {
  try {
    const [games, initialWeeklyPick] = await Promise.all([consumerGames(), readInitialWeeklyPick()]);
    res.set("Cache-Control", "no-store");
    res.json({ status: games.length ? "available" : "unavailable", games, initialWeeklyPick, sourceHealth: games.sourceHealth, note: "Persisted snapshots only; this endpoint never starts model computation or data synchronization." });
  } catch (error) {
    _req.log.error({ error }, "Consumer dashboard read failed");
    res.status(503).json({ error: "Prediction data is being refreshed", code: "consumer_data_unavailable" });
  }
});

export function consumerScheduleSummaryQuery(now: Date) {
    // Match interpretNflGameState: terminal states win over in-progress states,
    // and a non-terminal game past kickoff is live regardless of its status.
    const status = sql`lower(btrim(regexp_replace(${gamesTable.gameStatus}, '[_-]+', ' ', 'g')))`;
    const matches = (rules: ReadonlyArray<{ includes: readonly string[]; exact: readonly string[] }>) =>
      sql`(${sql.join(rules.flatMap((rule) => [
        ...rule.includes.map((fragment) => sql`strpos(${status}, ${fragment}) > 0`),
        ...rule.exact.map((value) => sql`${status} = ${value}`),
      ]), sql` or `)})`;
    const terminal = matches([
      NFL_STATUS_VOCABULARY.postponed,
      NFL_STATUS_VOCABULARY.cancelled,
      NFL_STATUS_VOCABULARY.final,
    ]);
    const explicitlyLive = matches([NFL_STATUS_VOCABULARY.live]);
    return db.select({
      season: gamesTable.season,
      week: gamesTable.week,
      first: sql<string>`min(${gamesTable.kickoffTime})`.as("first"),
      last: sql<string>`max(${gamesTable.kickoffTime})`.as("last"),
      live: sql<boolean>`bool_or(${gamesTable.kickoffTime} <= ${now}
        and ${gamesTable.kickoffTime} >= ${new Date(now.getTime() - 8 * 60 * 60_000)}
        and not ${terminal})`.as("live"),
      upcoming: sql<boolean>`bool_or(${gamesTable.kickoffTime} > ${now}
        and not ${terminal} and not ${explicitlyLive})`.as("upcoming"),
    }).from(gamesTable)
      .where(isNotNull(gamesTable.kickoffTime))
      .groupBy(gamesTable.season, gamesTable.week);
}

export function unfamiliarGameStatusesQuery() {
  const status = sql`lower(btrim(regexp_replace(${gamesTable.gameStatus}, '[_-]+', ' ', 'g')))`;
  const known = sql`(${status} ~ ${SUPPORTED_GAME_STATUS_PATTERNS.scheduled}
    or ${status} ~ ${SUPPORTED_GAME_STATUS_PATTERNS.terminal}
    or ${status} ~ ${SUPPORTED_GAME_STATUS_PATTERNS.live})`;
  return db.select({
    season: sql<number>`max(${gamesTable.season})`.as("season"),
    week: sql<number>`max(${gamesTable.week})`.as("week"),
    gameStatus: gamesTable.gameStatus,
    total: sql<string>`sum(count(*)) over()`.as("total"),
  }).from(gamesTable)
    .where(sql`not coalesce(${known}, false)`)
    .groupBy(gamesTable.gameStatus)
    .orderBy(sql`max(${gamesTable.season}) desc`)
    .limit(5);
}

router.get("/consumer/schedule-selection", async (req, res): Promise<void> => {
  try {
    const schedule = await consumerScheduleSummaryQuery(new Date());
    try {
      const warning = unfamiliarStatusWarning(await unfamiliarGameStatusesQuery());
      if (warning && Date.now() - lastUnfamiliarStatusWarning >= 5 * 60_000) {
        req.log.warn({ warning }, "Unfamiliar persisted game statuses need Games selector review");
        lastUnfamiliarStatusWarning = Date.now();
      }
    } catch {
      req.log.error("Persisted game status audit failed; review schedule status vocabulary");
    }
    res.set("Cache-Control", "no-store");
    // Raw Drizzle aggregates are returned as strings, despite a timestamp column.
    res.json(GetConsumerScheduleSelectionResponse.parse(selectConsumerSlateSummaries(schedule.map((slate) => ({
      ...slate,
      first: new Date(slate.first),
      last: new Date(slate.last),
    })))));
  } catch (error) {
    req.log.error({ error }, "Consumer schedule selection read failed");
    res.status(503).json({ error: "Schedule evidence unavailable", code: "consumer_data_unavailable" });
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
    res.set("Cache-Control", "no-store");
    res.json({
      ...summary,
      games,
      sourceHealth: games.sourceHealth,
      teamRecords: games.teamRecords,
      recordVerification: games.recordVerification,
    });
  } catch (error) {
    req.log.error({ error }, "Consumer games read failed");
    res.status(503).json({ error: "Prediction data is being refreshed", code: "consumer_data_unavailable" });
  }
});

// Saved rows identify matchups; projection and market evidence is always read fresh.
function savedGameUser(req: Request, res: Response): string | null {
  const userId = getAuth(req).userId;
  if (!userId) res.status(401).json({ error: "Sign in to save games." });
  return userId;
}

router.get("/consumer/saved-games/ids", async (req, res): Promise<void> => {
  const userId = savedGameUser(req, res);
  if (!userId) return;
  try {
    const rows = await db.select({ gameId: savedGamesTable.gameId }).from(savedGamesTable)
      .where(eq(savedGamesTable.userId, userId)).orderBy(desc(savedGamesTable.createdAt), desc(savedGamesTable.gameId));
    res.set("Cache-Control", "private, no-store");
    res.json(ListSavedGameIdsResponse.parse(rows.map((row) => row.gameId)));
  } catch (error) {
    req.log.error({ error }, "Saved game IDs read failed");
    res.status(503).json({ error: "Saved games are temporarily unavailable.", code: "consumer_data_unavailable" });
  }
});

router.get("/consumer/saved-games", async (req, res): Promise<void> => {
  const userId = savedGameUser(req, res);
  if (!userId) return;
  try {
    const rows = await db.select({ gameId: savedGamesTable.gameId }).from(savedGamesTable)
      .where(eq(savedGamesTable.userId, userId)).orderBy(desc(savedGamesTable.createdAt), desc(savedGamesTable.gameId));
    const ids = rows.map((row) => row.gameId);
    const games = ids.length ? await consumerGames({ gameIds: ids }) : [];
    const byId = new Map(games.map((game) => [game.gameId, game]));
    res.set("Cache-Control", "private, no-store");
    res.json(ListSavedGamesResponse.parse(ids.flatMap((id) => {
      const game = byId.get(id);
      return game ? [game] : [];
    })));
  } catch (error) {
    req.log.error({ error }, "Saved games read failed");
    res.status(503).json({ error: "Saved games are temporarily unavailable.", code: "consumer_data_unavailable" });
  }
});

router.put("/consumer/saved-games/:gameId", async (req, res): Promise<void> => {
  const userId = savedGameUser(req, res);
  if (!userId) return;
  const parsed = SaveConsumerGameParams.safeParse(req.params);
  if (!parsed.success || !parsed.data.gameId.trim() || parsed.data.gameId.length > 256) {
    res.status(400).json({ error: "Invalid game ID.", code: "invalid_request" });
    return;
  }
  const gameId = parsed.data.gameId;
  const [game] = await db.select({ gameId: gamesTable.gameId }).from(gamesTable).where(eq(gamesTable.gameId, gameId));
  if (!game) {
    res.status(404).json({ error: "This game is not available.", code: "game_not_found" });
    return;
  }
  const atLimit = await db.transaction(async (tx) => {
    await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${userId}))`);
    const [existing] = await tx.select({ gameId: savedGamesTable.gameId }).from(savedGamesTable)
      .where(and(eq(savedGamesTable.userId, userId), eq(savedGamesTable.gameId, gameId)));
    if (existing) return false;
    const [{ total }] = await tx.select({ total: count() }).from(savedGamesTable).where(eq(savedGamesTable.userId, userId));
    if (total >= MAX_CONSUMER_GAMES) return true;
    await tx.insert(savedGamesTable).values({ userId, gameId }).onConflictDoNothing();
    return false;
  });
  if (atLimit) {
    res.status(409).json({ error: "You can save up to 100 games. Remove one before adding another." });
    return;
  }
  res.sendStatus(204);
});

router.delete("/consumer/saved-games/:gameId", async (req, res): Promise<void> => {
  const userId = savedGameUser(req, res);
  if (!userId) return;
  const parsed = RemoveSavedConsumerGameParams.safeParse(req.params);
  if (!parsed.success || !parsed.data.gameId.trim() || parsed.data.gameId.length > 256) {
    res.status(400).json({ error: "Invalid game ID.", code: "invalid_request" });
    return;
  }
  await db.delete(savedGamesTable).where(and(eq(savedGamesTable.userId, userId), eq(savedGamesTable.gameId, parsed.data.gameId)));
  res.sendStatus(204);
});

export function consumerGameDetailHandler(loadGames: typeof consumerGames = consumerGames) {
  return async (req: Request, res: Response): Promise<void> => {
  try {
    const gameId = Array.isArray(req.params.gameId) ? req.params.gameId[0] : req.params.gameId;
    const gameResults = await loadGames({ gameId });
    const game = gameResults[0];
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
    const imagery = consumerVerifiedImages(detailTeamRows.map(team => ({
      teamId: team.teamId, abbreviation: team.abbreviation,
      name: team.teamId === gameRow.homeTeamId ? game.matchup.home.name
        : team.teamId === gameRow.awayTeamId ? game.matchup.away.name : "",
    })));
    const detailTeamMaps = buildUsageTeamMappings(detailTeamRows);
    const detailSourceTeams = [gameRow.homeTeamId, gameRow.awayTeamId]
      .map((id) => detailTeamMaps.scheduleToAbbreviation.get(id))
      .flatMap((abbr) => abbr ? nflverseTeamCandidates(abbr) : []);
    const recentGames = await db.select({
      gameId: gamesTable.gameId, season: gamesTable.season, week: gamesTable.week,
      kickoffTime: gamesTable.kickoffTime, gameStatus: gamesTable.gameStatus,
      homeTeamId: gamesTable.homeTeamId, awayTeamId: gamesTable.awayTeamId,
    }).from(gamesTable).where(and(
      eq(gamesTable.season, game.season),
      lt(gamesTable.kickoffTime, sourceCutoff),
      eq(gamesTable.gameStatus, "STATUS_FINAL"),
      or(
        inArray(gamesTable.homeTeamId, [gameRow.homeTeamId, gameRow.awayTeamId]),
        inArray(gamesTable.awayTeamId, [gameRow.homeTeamId, gameRow.awayTeamId]),
      ),
    ));
    const eligibleRecentGames = eligibleUsageGames(recentGames, game.season, sourceCutoff, game.gameId);
    const detailKeys = usageSourceGameKeys(eligibleRecentGames, detailTeamMaps);
    const [weather, contextRows, movementRows, recentStats, recentSnaps, currentPersonnel, predictionEvidenceRows] = await Promise.all([
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
      detailKeys.length ? db.select().from(playerGameStatsTable)
        .where(and(
          inArray(playerGameStatsTable.teamId, detailSourceTeams),
          eq(playerGameStatsTable.season, game.season),
          usageSourceGameCondition(playerGameStatsTable, detailKeys, true),
        )) : Promise.resolve([]),
      detailKeys.length ? db.select({
        playerId: snapCountsTable.playerId, season: snapCountsTable.season, week: snapCountsTable.week,
        teamId: snapCountsTable.teamId, opponentTeamId: snapCountsTable.opponentTeamId, offensePct: snapCountsTable.offensePct,
      }).from(snapCountsTable)
        .where(and(
          eq(snapCountsTable.season, game.season),
          inArray(snapCountsTable.teamId, detailSourceTeams),
          usageSourceGameCondition(snapCountsTable, detailKeys, true),
        )) : Promise.resolve([]),
      getCurrentGamePersonnel(game.gameId, sourceCutoff),
      db.select({
        predictionTimestamp: predictionSnapshotsTable.predictionTimestamp,
        projectedHomeScore: predictionSnapshotsTable.projectedHomeScore,
        projectedAwayScore: predictionSnapshotsTable.projectedAwayScore,
        projectedMargin: predictionSnapshotsTable.projectedMargin,
        projectedTotal: predictionSnapshotsTable.projectedTotal,
        homeWinProbability: predictionSnapshotsTable.homeWinProbability,
        inputSourceEvidence: predictionSnapshotsTable.inputSourceEvidence,
      }).from(predictionSnapshotsTable)
        .where(and(
          eq(predictionSnapshotsTable.gameId, game.gameId),
          lte(predictionSnapshotsTable.predictionTimestamp, sourceCutoff),
        ))
        .orderBy(desc(predictionSnapshotsTable.predictionTimestamp), desc(predictionSnapshotsTable.id))
        .limit(20),
    ]);
    const forecast = weather[0];
    const context = contextRows
      .map((row) => (row.featureAudit as Record<string, unknown> | undefined)?._personnel_context)
      .find(Boolean) as PersistedContext | undefined;
    const finalizedContext = applyCurrentPersonnelToConsumerContext(
      serializeContext(context ?? null, gameRow?.homeTeamId ?? "", gameRow?.awayTeamId ?? ""),
      currentPersonnel,
    );
    const savedPrediction = game.prediction
      && game.prediction.projectedHomeScore !== null
      && game.prediction.projectedAwayScore !== null
      && game.prediction.projectedMargin !== null
      && game.prediction.projectedTotal !== null
      && game.prediction.homeWinProbability !== null
      ? predictionEvidenceRows.find((row) =>
        safeNumber(row.projectedHomeScore) === game.prediction?.projectedHomeScore
        && safeNumber(row.projectedAwayScore) === game.prediction?.projectedAwayScore
        && safeNumber(row.projectedMargin) === game.prediction?.projectedMargin
        && safeNumber(row.projectedTotal) === game.prediction?.projectedTotal
        && safeNumber(row.homeWinProbability) === game.prediction?.homeWinProbability)
      : undefined;
    const historicalPersonnel = savedPrediction
      ? await getCurrentGamePersonnel(game.gameId, savedPrediction.predictionTimestamp)
      : null;
    const modelPersonnelLimitation = currentModelPersonnelLimitation({
      savedInputSourceEvidence: savedPrediction?.inputSourceEvidence,
      predictionTimestamp: savedPrediction?.predictionTimestamp ?? null,
      kickoffTime: kickoff,
      homeTeamId: gameRow?.homeTeamId ?? "",
      awayTeamId: gameRow?.awayTeamId ?? "",
      current: currentPersonnel?.teams ?? null,
      historical: historicalPersonnel?.teams ?? null,
    });
    finalizedContext.modelPersonnelLimitation = {
      active: modelPersonnelLimitation.active,
      reason: modelPersonnelLimitation.reason,
      recommendationSuppressed: modelPersonnelLimitation.recommendationSuppressed,
    };
    const recommendation = applyModelPersonnelLimitationToRecommendation(
      game.recommendation, modelPersonnelLimitation,
    );
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
    const detailHome = detailTeamMaps.scheduleToAbbreviation.get(gameRow.homeTeamId) ?? gameRow.homeTeamId;
    const detailAway = detailTeamMaps.scheduleToAbbreviation.get(gameRow.awayTeamId) ?? gameRow.awayTeamId;
    const rosterRows = recent.length
      ? await db.select({
        playerId: playersTable.playerId, activeStatus: playersTable.activeStatus,
        sourceUpdatedAt: playersTable.sourceUpdatedAt,
      }).from(playersTable).where(inArray(playersTable.playerId, recent.map((player) => player.playerId)))
      : [];
    const rosterById = new Map(rosterRows.map((player) => [player.playerId, player]));
    const eligiblePlayers = recent
      .map((player) => {
         const contextTeams = finalizedContext.teams;
        const team = contextTeams.find((candidate) => candidate.side === (player.teamId === detailHome ? "home" : "away"))
          ;
        const personnel = team?.depth.find((candidate) => candidate.name.toLowerCase() === player.playerName.toLowerCase());
         const injury = team?.injuries.find((candidate) => candidate.name.toLowerCase() === player.playerName.toLowerCase());
         const roster = rosterById.get(player.playerId);
         const eligibility = classifyPlayerEligibility({
           gameState: game.gameState,
           injuryStatus: injury?.gameStatus ?? personnel?.injuryStatus,
           rosterStatus: roster?.activeStatus,
           statusAsOf: gameResults.sourceHealth.sources.players.status === "stale"
             || gameResults.sourceHealth.sources.players.status === "unavailable"
             || gameResults.sourceHealth.sources.injuries.status === "stale"
             ? null : injury?.asOf ? new Date(injury.asOf) : roster?.sourceUpdatedAt ?? (personnel?.asOf ? new Date(personnel.asOf) : null),
           maxAgeMs: 48 * 60 * 60_000,
         });
        return {
          playerId: player.playerId, name: player.playerName, teamId: player.teamId ?? "",
          position: player.position, recentUsage: Object.fromEntries(Object.entries(player.aggregate)
            .map(([name, value]) => [name, value.value])),
          currentPersonnel: {
            depthRank: personnel?.depthRank ?? null, injuryStatus: personnel?.injuryStatus ?? null,
            source: personnel ? "cutoff-safe pregame personnel context" : "Current personnel evidence unavailable",
          },
           eligibility,
        };
      })
      .filter((player) => game.gameState === "pregame" || game.gameState === "scheduled"
        ? player.eligibility.status !== "ineligible"
        : true);
    const eligibleById = new Map(eligiblePlayers.map((player) => [`${player.teamId}:${player.playerId}`, player]));
    const keyPlayers = [detailAway, detailHome]
      .flatMap((teamId) => rankRecentKeyPlayers(
        recent.filter((player) => eligibleById.has(`${player.teamId}:${player.playerId}`)), teamId,
      ))
      .map((player) => ({
        ...eligibleById.get(`${player.teamId}:${player.playerId}`)!,
        headshotUrl: game.season === 2026
          ? (imagery ? playerHeadshot(player.playerId, imagery.players) : null) : null,
      }));
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
    res.set("Cache-Control", "no-store");
    res.json({
      ...game,
      recommendation,
      sourceHealth: gameResults.sourceHealth,
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
  };
}

router.get("/consumer/games/:gameId", consumerGameDetailHandler());

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

router.get("/consumer/defense-vs-position", async (req, res): Promise<void> => {
  const season = typeof req.query.season === "string" ? Number(req.query.season) : undefined;
  const window = typeof req.query.window === "string" ? req.query.window : "season";
  const gameId = typeof req.query.game === "string" ? req.query.game : undefined;
  if ((season !== undefined && (!Number.isInteger(season) || season < 2000 || season > 2100))
    || !WINDOWS.includes(window as typeof WINDOWS[number])
    || (req.query.game !== undefined && (!gameId || gameId.length > 128))) {
    res.status(400).json({ error: "Choose a valid season, game and window.", code: "invalid_request" });
    return;
  }
  try {
    const cutoffGame = gameId
      ? await db.select().from(gamesTable).where(eq(gamesTable.gameId, gameId)).limit(1)
      : [];
    if (gameId && (!cutoffGame[0]?.kickoffTime || (season !== undefined && season !== cutoffGame[0].season))) {
      res.status(400).json({ error: "Unknown game cutoff or mismatched season.", code: "invalid_request" });
      return;
    }
    const effectiveSeason = season ?? cutoffGame[0]?.season ?? defaultDefenseSeason();
    const cutoff = cutoffGame[0]?.kickoffTime ?? new Date();
    res.json(buildDefenseVsPosition(
      await readDefenseInputs(effectiveSeason, cutoff), effectiveSeason, cutoff, gameId,
      window as typeof WINDOWS[number],
    ));
  } catch (error) {
    req.log.error({ error }, "Consumer defense vs position read failed");
    res.status(503).json({ error: "Defensive history is being refreshed", code: "consumer_data_unavailable" });
  }
});

router.get("/consumer/player-position-matchup", async (req, res): Promise<void> => {
  const gameId = typeof req.query.game === "string" ? req.query.game : "";
  const playerId = typeof req.query.player === "string" ? req.query.player : undefined;
  const position = req.query.position;
  const window = req.query.window ?? "last5";
  if (!gameId || gameId.length > 128 || (req.query.player !== undefined && (!playerId || playerId.length > 128))
    || typeof position !== "string" || !["QB", "RB", "WR", "TE"].includes(position)
    || !WINDOWS.includes(window as typeof WINDOWS[number])) {
    res.status(400).json({ error: "Choose a valid upcoming game, position, player and window.", code: "invalid_request" });
    return;
  }
  try {
    const [game] = await db.select().from(gamesTable).where(eq(gamesTable.gameId, gameId)).limit(1);
    const now = new Date();
    if (!game || !game.kickoffTime || game.kickoffTime <= now || game.week < 1 || game.week > 18
      || !/scheduled|pregame/i.test(game.gameStatus)) {
      res.status(400).json({ error: "A verified upcoming regular-season game is required.", code: "invalid_request" });
      return;
    }
    const result = buildPlayerPositionMatchup(await readMatchupDefenseInputs(
      game.season, game.kickoffTime, game.homeTeamId, game.awayTeamId),
      game, now, position as "QB" | "RB" | "WR" | "TE", window as typeof WINDOWS[number], playerId);
    if (!result) {
      res.status(400).json({ error: "Matchup identities could not be verified.", code: "invalid_request" });
      return;
    }
    if (result.selected && process.env.NODE_ENV === "development" && !process.env.REPLIT_DEPLOYMENT) {
      try {
        attachQualifiedScoringTdProbability(result, await readDevelopmentPlayerTdForecastReadiness(now));
      } catch (error) {
        req.log.warn({ error }, "Separate TD forecast gate unavailable; probability withheld");
      }
    }
    res.json(GetConsumerPlayerPositionMatchupResponse.parse(result));
  } catch (error) {
    req.log.error({ error }, "Player-position matchup read failed");
    res.status(503).json({ error: "Player-position matchup unavailable", code: "consumer_data_unavailable" });
  }
});

router.get("/consumer/red-zone-opportunities", redZoneFeatureGate, async (req, res): Promise<void> => {
  const rawSeason = typeof req.query.season === "string" ? Number(req.query.season) : undefined;
  const rawTeam = typeof req.query.team === "string" ? req.query.team : undefined;
  const position = typeof req.query.position === "string" ? req.query.position.toUpperCase() : undefined;
  const rawZone = typeof req.query.zone === "string" ? Number(req.query.zone) : undefined;
  const rawPeriod = typeof req.query.period === "string" ? req.query.period : undefined;
  const gameId = typeof req.query.game === "string" ? req.query.game : undefined;
  if ((rawSeason !== undefined && (!Number.isInteger(rawSeason) || rawSeason < 2000 || rawSeason > 2100))
    || (position && !["QB", "RB", "WR", "TE"].includes(position))
    || (rawZone !== undefined && !RED_ZONE_VALUES.includes(rawZone as typeof RED_ZONE_VALUES[number]))
    || (rawPeriod !== undefined && !["season", "last3"].includes(rawPeriod))) {
    res.status(400).json({ error: "Choose a valid season, team, position, zone, period, and game filter.", code: "invalid_request" });
    return;
  }
  const period: "season" | "last3" = rawPeriod === "last3" ? "last3" : "season";
  try {
    const teams = await db.select({ teamId: teamsTable.teamId, abbreviation: teamsTable.abbreviation }).from(teamsTable);
    const teamMaps = buildUsageTeamMappings(teams);
    const canonicalTeam = rawTeam ? teamMaps.canonical(rawTeam) : undefined;
    if (rawTeam && !canonicalTeam) {
      res.status(400).json({ error: "Unknown team filter.", code: "invalid_request" });
      return;
    }
    const cutoffGame = gameId
      ? await db.select().from(gamesTable).where(eq(gamesTable.gameId, gameId)).limit(1)
      : [];
    if (gameId && !cutoffGame[0]) {
      res.status(400).json({ error: "Unknown game cutoff.", code: "invalid_request" });
      return;
    }
    const cutoff = cutoffGame[0]?.kickoffTime ?? new Date();
    const season = rawSeason ?? cutoffGame[0]?.season ?? usageSeasonAtCutoff(cutoff);
    if (cutoffGame[0] && cutoffGame[0].season !== season) {
      res.status(400).json({ error: "The requested season does not match the game cutoff.", code: "invalid_request" });
      return;
    }
    const scheduleRows = await db.select().from(gamesTable).where(and(
      eq(gamesTable.season, season),
      lte(gamesTable.kickoffTime, cutoff),
    ));
    const completed = cutoffSafeRedZoneGames(scheduleRows, season, cutoff, gameId);
    const eligibleGameIds = completed.map((entry) => entry.gameId);
    const eligibleSet = new Set(eligibleGameIds);
    const [playerFacts, teamFacts] = eligibleGameIds.length
      ? await Promise.all([
          db.select().from(redZonePlayerGameFactsTable).where(and(
            eq(redZonePlayerGameFactsTable.season, season),
            eq(redZonePlayerGameFactsTable.seasonType, "REG"),
            inArray(redZonePlayerGameFactsTable.gameId, eligibleGameIds),
          )),
          db.select().from(redZoneTeamGameFactsTable).where(and(
            eq(redZoneTeamGameFactsTable.season, season),
            eq(redZoneTeamGameFactsTable.seasonType, "REG"),
            inArray(redZoneTeamGameFactsTable.gameId, eligibleGameIds),
          )),
        ])
      : [[], []];
    const applicableTeams = canonicalTeam
      ? completed.filter((entry) =>
        teamMaps.scheduleToAbbreviation.get(entry.homeTeamId) === canonicalTeam
        || teamMaps.scheduleToAbbreviation.get(entry.awayTeamId) === canonicalTeam)
      : completed;
    const applicableGameIds = new Set(applicableTeams.map((entry) => entry.gameId));
    const expectedTeamGames = applicableTeams.flatMap((entry) => {
      const home = teamMaps.scheduleToAbbreviation.get(entry.homeTeamId);
      const away = teamMaps.scheduleToAbbreviation.get(entry.awayTeamId);
      return [home, away]
        .filter((team): team is string => Boolean(team) && (!canonicalTeam || team === canonicalTeam))
        .map((team) => ({ gameId: entry.gameId, team }));
    });
    const teamDenominators = new Map(teamFacts.map((fact) => [
      `${fact.gameId}:${fact.teamId}:${fact.zone}`,
      { targets: fact.targets, carries: fact.carries },
    ]));
    const coveredTeamGameKeys = new Set(expectedTeamGames.flatMap(({ gameId, team }) =>
      RED_ZONE_VALUES.every((zone) => teamDenominators.has(`${gameId}:${team}:${zone}`))
        ? [`${gameId}:${team}`]
        : []));
    const missingGames = [...new Set(expectedTeamGames
      .filter((entry) => !coveredTeamGameKeys.has(`${entry.gameId}:${entry.team}`))
      .map((entry) => entry.gameId))];
    const coveredGameIds = new Set(expectedTeamGames.map((entry) => entry.gameId)
      .filter((id) => {
        const gameTeams = expectedTeamGames.filter((entry) => entry.gameId === id);
        return gameTeams.length === (canonicalTeam ? 1 : 2)
          && gameTeams.every((entry) => coveredTeamGameKeys.has(`${entry.gameId}:${entry.team}`));
      }));
    const coveredSchedules = applicableTeams
      .filter((entry) => coveredGameIds.has(entry.gameId))
      .sort((a, b) => a.kickoffTime!.getTime() - b.kickoffTime!.getTime()
        || a.gameId.localeCompare(b.gameId));
    const weeksForGames = (gameIds: Set<string>) => [...new Set(applicableTeams
      .filter((entry) => gameIds.has(entry.gameId))
      .map((entry) => entry.week))].sort((a, b) => a - b);
    const coveredWeeks = weeksForGames(coveredGameIds);
    const missingWeeks = weeksForGames(new Set(missingGames));
    const coveragePeriod = redZoneCoveragePeriodLabel(coveredWeeks, missingWeeks);
    const coveragePartialReasons = missingWeeks.length ? [coveragePeriod] : [];
    const firstCoveredKickoff = coveredSchedules[0]?.kickoffTime?.toISOString() ?? null;
    const lastCoveredKickoff = coveredSchedules.at(-1)?.kickoffTime?.toISOString() ?? null;
    const scheduleById = new Map(completed.map((entry) => [entry.gameId, entry]));
    const scheduleGameByMatchup = new Map<string, string>();
    for (const entry of completed) {
      const home = teamMaps.scheduleToAbbreviation.get(entry.homeTeamId);
      const away = teamMaps.scheduleToAbbreviation.get(entry.awayTeamId);
      if (home && away) {
        scheduleGameByMatchup.set(`${entry.week}:${home}:${away}`, entry.gameId);
        scheduleGameByMatchup.set(`${entry.week}:${away}:${home}`, entry.gameId);
      }
    }
    const statsAppearances = await db.select({
      playerId: playerGameStatsTable.playerId,
      playerName: playerGameStatsTable.playerName,
      position: playerGameStatsTable.position,
      completions: playerGameStatsTable.completions,
      attempts: playerGameStatsTable.attempts,
      passingYards: playerGameStatsTable.passingYards,
      passingTds: playerGameStatsTable.passingTds,
      carries: playerGameStatsTable.carries,
      rushingYards: playerGameStatsTable.rushingYards,
      rushingTds: playerGameStatsTable.rushingTds,
      targets: playerGameStatsTable.targets,
      receptions: playerGameStatsTable.receptions,
      receivingYards: playerGameStatsTable.receivingYards,
      receivingTds: playerGameStatsTable.receivingTds,
      week: playerGameStatsTable.week,
      seasonType: playerGameStatsTable.seasonType,
      teamId: playerGameStatsTable.teamId,
      opponentTeamId: playerGameStatsTable.opponentTeamId,
    }).from(playerGameStatsTable).where(eq(playerGameStatsTable.season, season));
    const snapSources = [...new Set(teams.flatMap((entry) => nflverseTeamCandidates(entry.abbreviation)))];
    const rawSnapRows = snapSources.length ? await db.select({
      playerId: snapCountsTable.playerId,
      playerName: snapCountsTable.playerName,
      position: snapCountsTable.position,
      week: snapCountsTable.week,
      teamId: snapCountsTable.teamId,
      opponentTeamId: snapCountsTable.opponentTeamId,
      offenseSnaps: snapCountsTable.offenseSnaps,
      offensePct: snapCountsTable.offensePct,
    }).from(snapCountsTable).where(and(
      eq(snapCountsTable.season, season),
      inArray(snapCountsTable.teamId, snapSources),
    )) : [];
    const snapPfrIds = [...new Set(rawSnapRows.map((snap) => snap.playerId))];
    const snapIdentities = snapPfrIds.length ? await db.select({
      gsisId: nflversePlayerIdentitiesTable.gsisId,
      pfrId: nflversePlayerIdentitiesTable.pfrId,
    }).from(nflversePlayerIdentitiesTable)
      .where(inArray(nflversePlayerIdentitiesTable.pfrId, snapPfrIds))
      .orderBy(desc(nflversePlayerIdentitiesTable.observedAt)) : [];
    const gsisByPfr = new Map<string, string>();
    for (const identity of snapIdentities) {
      if (identity.pfrId && !gsisByPfr.has(identity.pfrId)) gsisByPfr.set(identity.pfrId, identity.gsisId);
    }
    const snapByPlayerGame = new Map<string, { offenseSnaps: number | null; offensePct: number | null }>();
    const appearancesByPlayer = new Map<string, Array<{
      playerId: string; gameId: string; kickoffTime: Date; week: number; teamId: string;
    }>>();
    const sourcePositionByPlayer = new Map<string, string | null>();
    const sourceNameByPlayer = new Map<string, string>();
    const addAppearance = (playerId: string | null, gameId: string | undefined, teamId: string | null, week: number) => {
      if (!playerId || !gameId || !teamId) return;
      const schedule = scheduleById.get(gameId);
      if (!schedule?.kickoffTime) return;
      const appearances = appearancesByPlayer.get(playerId) ?? [];
      if (!appearances.some((entry) => entry.gameId === gameId && entry.teamId === teamId)) {
        appearances.push({ playerId, gameId, kickoffTime: schedule.kickoffTime, week, teamId });
      }
      appearancesByPlayer.set(playerId, appearances);
    };
    for (const row of statsAppearances) {
      if (row.seasonType.toUpperCase() !== "REG" || !hasPlayerStatAppearance(row)) continue;
      const team = teamMaps.canonical(row.teamId);
      const opponent = teamMaps.canonical(row.opponentTeamId);
      const matchedGameId = team && opponent ? scheduleGameByMatchup.get(`${row.week}:${team}:${opponent}`) : undefined;
      addAppearance(row.playerId, matchedGameId, team, row.week);
      if (row.position) sourcePositionByPlayer.set(row.playerId, row.position);
      if (row.playerName) sourceNameByPlayer.set(row.playerId, row.playerName);
    }
    for (const snap of rawSnapRows) {
      if ((snap.offenseSnaps ?? 0) <= 0) continue;
      const team = teamMaps.canonical(snap.teamId);
      const opponent = teamMaps.canonical(snap.opponentTeamId);
      const matchedGameId = team && opponent ? scheduleGameByMatchup.get(`${snap.week}:${team}:${opponent}`) : undefined;
      const playerId = gsisByPfr.get(snap.playerId);
      addAppearance(playerId ?? null, matchedGameId, team, snap.week);
      if (playerId) {
        snapByPlayerGame.set(`${playerId}:${matchedGameId}`, {
          offenseSnaps: snap.offenseSnaps,
          offensePct: snap.offensePct,
        });
        if (snap.position && !sourcePositionByPlayer.has(playerId)) sourcePositionByPlayer.set(playerId, snap.position);
        if (snap.playerName && !sourceNameByPlayer.has(playerId)) sourceNameByPlayer.set(playerId, snap.playerName);
      }
    }
    for (const fact of playerFacts) {
      if (!eligibleSet.has(fact.gameId)) continue;
      addAppearance(fact.playerId, fact.gameId, fact.teamId, fact.week);
      if (fact.position && !sourcePositionByPlayer.has(fact.playerId)) sourcePositionByPlayer.set(fact.playerId, fact.position);
      if (fact.playerName && !sourceNameByPlayer.has(fact.playerId)) sourceNameByPlayer.set(fact.playerId, fact.playerName);
    }
    const positionMatches = (playerId: string) => {
      return !position || sourcePositionByPlayer.get(playerId)?.toUpperCase() === position;
    };
    const appearanceRows = [...appearancesByPlayer.values()].flat();
    const playerTeamGroups = groupRedZoneAppearancesByPlayerTeam(
      appearanceRows.filter((appearance) => positionMatches(appearance.playerId)),
      period,
      canonicalTeam ?? undefined,
    );
    const playerTeamGroupsByKey = new Map(playerTeamGroups.map((group) => [group.key, group]));
    const playerIds = [...new Set(playerTeamGroups.map((group) => group.playerId))];
    const filteredFacts = playerFacts.filter((fact) =>
      applicableGameIds.has(fact.gameId)
      && (!canonicalTeam || fact.teamId === canonicalTeam)
      && positionMatches(fact.playerId));
    const grouped = new Map<string, typeof filteredFacts>();
    for (const fact of filteredFacts) {
      const key = `${fact.playerId}:${fact.teamId}`;
      const selected = playerTeamGroupsByKey.get(key)?.appearances;
      if (!selected?.some((appearance) => appearance.gameId === fact.gameId)) continue;
      grouped.set(key, [...(grouped.get(key) ?? []), fact]);
    }
    const metadata = playerIds.length ? await db.select({
      playerId: playersTable.playerId, name: playersTable.name, position: playersTable.position,
    }).from(playersTable).where(inArray(playersTable.playerId, playerIds)) : [];
    const metadataById = new Map(metadata.map((row) => [row.playerId, row]));
    const latestIngestedAt = [...playerFacts, ...teamFacts]
      .map((row) => row.ingestedAt).filter((value): value is Date => value instanceof Date)
      .sort((a, b) => b.getTime() - a.getTime())[0] ?? null;
    const playerFactFor = (
      playerId: string,
      appearance: { gameId: string; teamId: string },
      zone: number,
      facts: typeof playerFacts,
    ) => {
      const snap = snapByPlayerGame.get(`${playerId}:${appearance.gameId}`);
      const denominator = teamDenominators.get(`${appearance.gameId}:${appearance.teamId}:${zone}`);
      return redZonePlayerFactForAppearance(
        facts,
        appearance,
        zone,
        snap?.offenseSnaps !== null && snap?.offenseSnaps !== undefined && snap.offenseSnaps > 0,
        Boolean(denominator),
      );
    };
    const metricZones = rawZone === undefined ? RED_ZONE_VALUES : [rawZone as 20 | 10 | 5];
    const players = playerTeamGroups.map(({ key, playerId, teamId, appearances: selectedAppearances }) => {
      const playerEvidenceFacts = playerFacts.filter((fact) =>
        fact.playerId === playerId && fact.teamId === teamId && applicableGameIds.has(fact.gameId));
      const playerCoveredTeamGameKeys = new Set(selectedAppearances.filter((appearance) =>
        coveredTeamGameKeys.has(`${appearance.gameId}:${appearance.teamId}`)
        && metricZones.every((zone) =>
          Boolean(playerFactFor(playerId, appearance, zone, playerEvidenceFacts))))
        .map((appearance) => `${appearance.gameId}:${appearance.teamId}`));
      const sourceWindow = coveredRedZoneWindow(selectedAppearances, playerCoveredTeamGameKeys);
      const coveredAppearances = sourceWindow.included;
      const facts = grouped.get(key) ?? [];
      const chronologicalFacts = [...facts].sort((a, b) =>
        (scheduleById.get(a.gameId)?.kickoffTime?.getTime() ?? 0)
        - (scheduleById.get(b.gameId)?.kickoffTime?.getTime() ?? 0)
        || a.gameId.localeCompare(b.gameId)
        || a.zone - b.zone
        || a.teamId.localeCompare(b.teamId));
      const zones = metricZones.map((zone) => {
        const rows = coveredAppearances.map((appearance) =>
          playerFactFor(playerId, appearance, zone, chronologicalFacts));
        const completePlayerEvidence = rows.length > 0 && rows.every(Boolean);
        const denominators = coveredAppearances.map((appearance) =>
          teamDenominators.get(`${appearance.gameId}:${appearance.teamId}:${zone}`));
        const targets = completePlayerEvidence
          ? rows.reduce((total, row) => total + row!.targets, 0) : null;
        const carries = completePlayerEvidence
          ? rows.reduce((total, row) => total + row!.carries, 0) : null;
        const receivingTouchdowns = completePlayerEvidence
          ? rows.reduce((total, row) => total + row!.receivingTouchdowns, 0) : null;
        const rushingTouchdowns = completePlayerEvidence
          ? rows.reduce((total, row) => total + row!.rushingTouchdowns, 0) : null;
        const teamTargets = coveredAppearances.length > 0 && denominators.every(Boolean)
          ? denominators.reduce((total, denominator) => total + denominator!.targets, 0) : null;
        const teamCarries = coveredAppearances.length > 0 && denominators.every(Boolean)
          ? denominators.reduce((total, denominator) => total + denominator!.carries, 0) : null;
        return {
          zone, targets, carries, receivingTouchdowns, rushingTouchdowns,
          teamTargets, teamCarries,
          targetShare: redZoneShare(targets, teamTargets),
          carryShare: redZoneShare(carries, teamCarries),
        };
      });
      const selectedGames = coveredAppearances.map((appearance) => appearance.gameId);
      const snapHistory = selectedGames.map((selectedGameId) =>
        snapByPlayerGame.get(`${playerId}:${selectedGameId}`)).filter((snap): snap is NonNullable<typeof snap> => Boolean(snap));
      const playerStatus = coveredAppearances.length === 0
        ? "unavailable"
        : sourceWindow.missingGames.length > 0 ? "partial" : "available";
      const name = sourceNameByPlayer.get(playerId) ?? chronologicalFacts.find((fact) => fact.playerName)?.playerName
        ?? metadataById.get(playerId)?.name ?? playerId;
      return {
        playerId,
        playerName: name,
        position: chronologicalFacts.find((fact) => fact.position)?.position
          ?? sourcePositionByPlayer.get(playerId) ?? metadataById.get(playerId)?.position ?? null,
        teamId,
        gamesPlayed: selectedGames.length,
        status: playerStatus,
        reason: sourceWindow.missingGames.length > 0 || coveredAppearances.length === 0
          ? redZoneCoveragePeriodLabel(
              sourceWindow.coveredWeeks,
              sourceWindow.missingWeeks,
              "Verified player opportunity evidence",
            )
          : null,
        offenseSnaps: snapHistory.some((snap) => snap.offenseSnaps !== null)
          ? snapHistory.reduce((total, snap) => total + (snap.offenseSnaps ?? 0), 0) : null,
        offensePct: snapHistory.some((snap) => snap.offensePct !== null)
          ? snapHistory.reduce((total, snap) => total + (snap.offensePct ?? 0), 0)
            / snapHistory.filter((snap) => snap.offensePct !== null).length
          : null,
        snapGames: snapHistory.length,
        sourceCoverage: {
          requestedGames: sourceWindow.requestedGames,
          includedGames: sourceWindow.includedGames,
          missingGames: sourceWindow.missingGames,
          coveredWeeks: sourceWindow.coveredWeeks,
          missingWeeks: sourceWindow.missingWeeks,
          firstCoveredKickoff: sourceWindow.firstCoveredKickoff,
          lastCoveredKickoff: sourceWindow.lastCoveredKickoff,
        },
        games: coveredAppearances.map((appearance) => {
          const selectedGameId = appearance.gameId;
          const game = scheduleById.get(selectedGameId);
          const gameRows = facts.filter((fact) => fact.gameId === selectedGameId
            && fact.teamId === appearance.teamId);
          return {
            gameId: selectedGameId,
            week: gameRows[0]?.week ?? appearance.week ?? game?.week ?? null,
            teamId: appearance.teamId,
            offenseSnaps: snapByPlayerGame.get(`${playerId}:${selectedGameId}`)?.offenseSnaps ?? null,
            offensePct: snapByPlayerGame.get(`${playerId}:${selectedGameId}`)?.offensePct ?? null,
            zones: metricZones.map((zone) => {
              const fact = playerFactFor(playerId, appearance, zone, gameRows);
              const denominator = teamDenominators.get(`${selectedGameId}:${appearance.teamId}:${zone}`);
              return {
                zone,
                targets: fact?.targets ?? null,
                carries: fact?.carries ?? null,
                receivingTouchdowns: fact?.receivingTouchdowns ?? null,
                rushingTouchdowns: fact?.rushingTouchdowns ?? null,
                teamTargets: denominator?.targets ?? null,
                teamCarries: denominator?.carries ?? null,
                targetShare: fact ? redZoneShare(fact.targets, denominator?.targets) : null,
                carryShare: fact ? redZoneShare(fact.carries, denominator?.carries) : null,
              };
            }),
          };
        }).sort((a, b) => a.week! - b.week! || a.gameId.localeCompare(b.gameId)),
        zones,
      };
    }).sort((a, b) => a.playerName.localeCompare(b.playerName)
      || a.teamId.localeCompare(b.teamId) || a.playerId.localeCompare(b.playerId));
    const expectedGames = new Set(expectedTeamGames.map((entry) => entry.gameId)).size;
    const coveredGames = coveredGameIds.size;
    const status = coveredGames === 0 ? "unavailable" : missingGames.length ? "partial" : "available";
    res.json({
      status,
      season,
      seasonType: "REG",
      period,
      zone: rawZone ?? null,
      source: "nflverse play-by-play",
      sourceUpdatedAt: null,
      ingestedAt: latestIngestedAt?.toISOString() ?? null,
      coverage: {
        status,
        completedGames: expectedGames,
        gamesWithPbp: coveredGames,
        missingGames,
        coveredWeeks,
        missingWeeks,
        firstCoveredKickoff,
        lastCoveredKickoff,
        partialReasons: coveragePartialReasons,
        note: "Zero opportunities are observed only for players identified by credited PBP participation, weekly player statistics, or a verified positive-offense-snap GSIS/PFR identity in a completed PBP game. Missing PBP evidence leaves that appearance unavailable. Attempts without a credited receiver or rusher ID are excluded from player counts and team denominators.",
      },
      players,
    });
  } catch (error) {
    req.log.error({ error }, "Consumer red-zone opportunities read failed");
    res.status(503).json({ error: "Red-zone opportunity data is being refreshed", code: "consumer_data_unavailable" });
  }
});

router.get("/consumer/player-usage-games", async (req, res): Promise<void> => {
  const season = usageSeasonAtCutoff(new Date());
  try {
    const games = await db.select({
      gameId: gamesTable.gameId,
      season: gamesTable.season,
      week: gamesTable.week,
      kickoffTime: gamesTable.kickoffTime,
      homeTeamId: gamesTable.homeTeamId,
      awayTeamId: gamesTable.awayTeamId,
    }).from(gamesTable)
      .where(eq(gamesTable.season, season))
      .orderBy(desc(gamesTable.week), desc(gamesTable.kickoffTime), asc(gamesTable.gameId));
    const teamIds = [...new Set(games.flatMap((game) => [game.homeTeamId, game.awayTeamId]))];
    const teams = teamIds.length
      ? await db.select({
          teamId: teamsTable.teamId,
          abbreviation: teamsTable.abbreviation,
        }).from(teamsTable).where(inArray(teamsTable.teamId, teamIds))
      : [];
    const abbreviationById = new Map(teams.map((team) => [team.teamId, team.abbreviation]));
    const contexts = games.flatMap((game) => {
      const home = abbreviationById.get(game.homeTeamId);
      const away = abbreviationById.get(game.awayTeamId);
      return home && away ? [{
        gameId: game.gameId,
        season: game.season,
        week: game.week,
        kickoffTime: game.kickoffTime?.toISOString() ?? null,
        matchup: { home, away },
      }] : [];
    });
    res.json({ status: contexts.length ? "available" : "absent", season, games: contexts });
  } catch (error) {
    req.log.error({ error }, "Consumer player usage games read failed");
    res.status(503).json({ error: "Schedule data is being refreshed", code: "consumer_data_unavailable" });
  }
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
    const applicableSeason = matchup[0]?.season ?? usageSeasonAtCutoff(cutoff);
    const selectedGames = await db.select({
      gameId: gamesTable.gameId, season: gamesTable.season, week: gamesTable.week,
      kickoffTime: gamesTable.kickoffTime, gameStatus: gamesTable.gameStatus,
      homeTeamId: gamesTable.homeTeamId, awayTeamId: gamesTable.awayTeamId,
    }).from(gamesTable)
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
    const sourceCandidates = canonicalFilter
      ? nflverseTeamCandidates(canonicalFilter)
      : matchup[0]
        ? [matchup[0].homeTeamId, matchup[0].awayTeamId].flatMap((id) => {
          const abbreviation = teamMaps.scheduleToAbbreviation.get(id);
          return abbreviation ? nflverseTeamCandidates(abbreviation) : [];
        })
        : [];
    const usesSourceChronology = !matchup[0] && selectedGames.length === 0;
    const sourceKeys = usageSourceGameKeys(eligibleGames, teamMaps)
      .filter((key) => !sourceCandidates.length || sourceCandidates.includes(key.team));
    const readSource = usesSourceChronology || sourceKeys.length > 0;
    const statRows = readSource ? await db.select().from(playerGameStatsTable)
      .where(and(
        eq(playerGameStatsTable.season, applicableSeason),
        sourceCandidates.length ? inArray(playerGameStatsTable.teamId, sourceCandidates) : undefined,
        usesSourceChronology ? undefined : usageSourceGameCondition(playerGameStatsTable, sourceKeys),
      )) : [];
    const rawSnaps = statRows.length ? await db.select({
      playerId: snapCountsTable.playerId, season: snapCountsTable.season, week: snapCountsTable.week,
      teamId: snapCountsTable.teamId, opponentTeamId: snapCountsTable.opponentTeamId, offensePct: snapCountsTable.offensePct,
    }).from(snapCountsTable).where(and(
      eq(snapCountsTable.season, applicableSeason),
      sourceCandidates.length ? inArray(snapCountsTable.teamId, sourceCandidates) : undefined,
      usesSourceChronology ? undefined : usageSourceGameCondition(snapCountsTable, sourceKeys),
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
    const verifiedUsageRows = eligibleUsageRows(
      usageRows,
      applicableSeason,
      new Set(eligibleGames.map((eligible) => eligible.gameId)),
      usesSourceChronology,
    );
    const verifiedPlayerIds = new Set(verifiedUsageRows.map((row) => row.playerId));
    const verifiedSnapRows = snapRows.filter((row) => verifiedPlayerIds.has(row.playerId));
    const players = aggregatePlayerUsage(verifiedUsageRows, verifiedSnapRows, eligibleGames.length, window as "last3" | "last5" | "last8" | "season", teamSchedules, orderedGameIdsByTeam)
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
      season: applicableSeason,
      players,
      availableTeams: teamRows
        .map((row) => ({ teamId: row.teamId, abbreviation: row.abbreviation.toUpperCase() }))
        .sort((left, right) => left.abbreviation.localeCompare(right.abbreviation)),
      filters: { team: canonicalFilter ?? null, position: position ?? null, game: game ?? null, window },
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

let lastUnfamiliarStatusWarning = 0;

export function unfamiliarStatusWarning(rows: Array<{ season: number; week: number; gameStatus: string | null; total: string }>) {
  if (!rows.length) return null;
  return {
    count: Number(rows[0].total),
    examples: rows.map((row) => ({
      season: row.season,
      week: row.week,
      // Provider values are untrusted: no raw payload or unbounded string enters logs.
      status: (row.gameStatus ?? "").slice(0, 48).replace(/[^a-zA-Z0-9 _-]/g, "?") || "(empty)",
      classification: gameStatusVocabulary(row.gameStatus),
    })),
    action: "Review persisted schedule status vocabulary and Games selector eligibility before changing the consumer fallback.",
  };
}
