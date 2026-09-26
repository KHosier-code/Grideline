import { createHash } from "node:crypto";

export const PLAYER_TD_MODEL_VERSION = "gridline-player-td-classification-v2";

export const PLAYER_TD_MODEL_CONFIG = {
  trainingSeasons: [2021, 2022, 2023],
  primaryCalibration: { season: 2024, firstWeek: 1, lastWeek: 9 },
  fallbackCalibration: { season: 2023, firstWeek: 10, lastWeek: 18 },
  evaluationPeriods: [{ season: 2024, firstWeek: 10 }, { season: 2025, firstWeek: 1 }],
  minimumPriorAppearances: 3,
  redZone: 20,
  ridgePenalty: 1.5,
  calibrationRidgePenalty: 0.01,
  predictionCutoff: "strictly before target kickoff; target game excluded by identity",
  labelDefinition: "all positions: rushing or receiving TD; passing TDs are never a player-scoring TD; both scoring components must be observed",
  featureTransform: "standardized continuous values, explicit missing indicators, ridge logistic fitted by deterministic L-BFGS with Armijo backtracking",
  calendarDatePolicy: "seasons through 2024 use calendar-date boundaries; date-only boundaries are midnight UTC and same-day evidence is withheld",
  redZoneAuditNote: "no verified 2021-25 zone-20 facts means unavailable features; only joined valid coverage contributes",
} as const;

export type PlayerTdPosition = "QB" | "RB" | "WR" | "TE";

/** Rows are assumed to have been supplied by a final-game-only adapter. */
export type PlayerTdGame = {
  playerId: string;
  playerName: string;
  position: PlayerTdPosition;
  team: string;
  opponent: string;
  season: number;
  week: number;
  gameId: string;
  kickoff: Date;
  /** Older seasons may use a conservative team-game calendar-date boundary. */
  kickoffTimeSource?: "scheduledKickoff" | "calendarDateBoundary";
  targets: number | null;
  carries: number | null;
  rushingTds: number | null;
  receivingTds: number | null;
  passingTds: number | null;
};

export type PlayerTdTeamGame = {
  team: string;
  opponent: string;
  season: number;
  week: number;
  gameId: string;
  kickoff: Date;
  kickoffTimeSource?: "scheduledKickoff" | "calendarDateBoundary";
  score: number | null;
  defensiveEpa: number | null;
};

/**
 * A fact only conveys zero when the adapter verified joined PBP coverage and
 * the player's appearance. An absent/unverified fact is unavailable, not zero.
 */
export type PlayerTdRedZoneFact = {
  playerId: string;
  team: string;
  opponent: string;
  season: number;
  week: number;
  gameId: string;
  zone: 20;
  targets: number;
  carries: number;
  validJoinedCoverage: boolean;
};

export type PlayerTdExample = {
  playerId: string;
  playerName: string;
  position: PlayerTdPosition;
  team: string;
  opponent: string;
  season: number;
  week: number;
  gameId: string;
  kickoff: string;
  label: 0 | 1;
  priorAppearances: number;
  featureValues: Record<string, number | null>;
};

export type PlayerTdMetricSet = {
  count: number;
  positives: number;
  brierScore: number | null;
  logLoss: number | null;
  auc: number | null;
  reliability: Array<{ bin: number; count: number; meanPrediction: number; observedRate: number }>;
};

export type PlayerTdEvaluationReport = {
  version: string;
  config: typeof PLAYER_TD_MODEL_CONFIG;
  inputHash: string;
  fittingHash: string;
  fitting: {
    trainingExamples: number;
    calibrationExamples: number;
    calibrationSource: "2024-first-half" | "2023-later-weeks" | "unavailable";
    calibrationFit: "main-training-model" | "early-2023-fold" | "unavailable";
    calibrationFitNote: string;
    includedFeatures: string[];
    excludedFeatureFamilies: string[];
    redZoneTrainingCoveredAppearances: number;
    calibrationPositiveLabels: number;
    calibrationNegativeLabels: number;
    calibrationMetrics: PlayerTdMetricSet;
    ablationPlatt: Record<string, { intercept: number; slope: number } | null>;
    fittedModel: { intercept: number; coefficients: Record<string, number>; featureMeans: Record<string, number>; featureScales: Record<string, number> };
    platt: { intercept: number; slope: number } | null;
  };
  cohorts: {
    excludedDuplicatePlayerRows: number;
    excludedDuplicateTeamGames: number;
    excludedDuplicateRedZoneFacts: number;
    excludedUnlabeledRows: number;
    excludedInsufficientHistory: number;
    training: number;
    calibration: number;
    evaluation: number;
    evaluationRedZoneCoveredAppearances: number;
    evaluationRedZoneUnavailableAppearances: number;
  };
  metrics: {
    model: PlayerTdMetricSet;
    baselines: Record<"position" | "player" | "teamOpponent", PlayerTdMetricSet>;
    ablations: Record<"withoutUsage" | "withoutRedZone" | "withoutDefense" | "withoutScoringContext", PlayerTdMetricSet>;
  };
  predictions: Array<{
    playerId: string;
    playerName: string;
    position: PlayerTdPosition;
    team: string;
    opponent: string;
    season: number;
    week: number;
    gameId: string;
    label: 0 | 1;
    probability: number;
    baselineProbabilities: Record<"position" | "player" | "teamOpponent", number>;
    ablationProbabilities: Record<"withoutUsage" | "withoutRedZone" | "withoutDefense" | "withoutScoringContext", number>;
    featureValues: Record<string, number | null>;
  }>;
};

export type PlayerTdEvaluationInput = {
  players: PlayerTdGame[];
  teamGames: PlayerTdTeamGame[];
  redZoneFacts: PlayerTdRedZoneFact[];
};

export type PlayerTdCandidate = {
  playerId: string;
  playerName: string;
  position: PlayerTdPosition;
  team: string;
  opponent: string;
  season: number;
  week: number;
  gameId: string;
  kickoff: Date;
  kickoffTimeSource?: "scheduledKickoff" | "calendarDateBoundary";
};

export type PlayerTdFrozenCandidateScore = {
  version: typeof PLAYER_TD_MODEL_VERSION;
  inputHash: string;
  playerId: string;
  playerName: string;
  position: PlayerTdPosition;
  team: string;
  opponent: string;
  season: number;
  week: number;
  gameId: string;
  probability: number;
  featureValues: Record<string, number | null>;
};

const FEATURE_GROUPS = {
  usage: ["targetsMean3", "carriesMean3", "targetTrend", "carryTrend", "wr1Role"],
  redZone: ["rzTargetShare", "rzCarryShare", "rzCoverage"],
  defense: ["defenseEpa", "opponentWr1TdRate", "opponentWr1Samples", "opponentOtherWrTdRate", "opponentOtherWrSamples"],
  scoringContext: ["teamScoreMean3", "opponentScoreMean3", "priorTdRate", "priorTdCount"],
} as const;
const FEATURE_NAMES = Object.values(FEATURE_GROUPS).flat();
const EPSILON = 1e-9;

function finite(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function canonical(value: string): string {
  return value.trim().toUpperCase();
}

function identity(row: { playerId: string; gameId: string }) {
  return `${row.playerId}\u0000${row.gameId}`;
}

function teamGameIdentity(row: { gameId: string; team: string }) {
  return `${row.gameId}\u0000${canonical(row.team)}`;
}

function compareGames(a: PlayerTdGame, b: PlayerTdGame) {
  return a.kickoff.getTime() - b.kickoff.getTime()
    || a.season - b.season || a.week - b.week || a.gameId.localeCompare(b.gameId)
    || a.playerId.localeCompare(b.playerId);
}

function dateBoundary(value: Date) {
  return Date.UTC(value.getUTCFullYear(), value.getUTCMonth(), value.getUTCDate());
}

function isCalendarBoundary(value: { kickoff: Date; season?: number; kickoffTimeSource?: "scheduledKickoff" | "calendarDateBoundary" }) {
  return (value.season !== undefined && value.season <= 2024)
    || value.kickoffTimeSource === "calendarDateBoundary"
    || (value.kickoffTimeSource !== "scheduledKickoff" && value.kickoff.getTime() === dateBoundary(value.kickoff));
}

function isStrictlyPreKickoff(
  row: { kickoff: Date; season?: number; kickoffTimeSource?: "scheduledKickoff" | "calendarDateBoundary" },
  target: { kickoff: Date; season?: number; kickoffTimeSource?: "scheduledKickoff" | "calendarDateBoundary" },
) {
  if (!(row.kickoff instanceof Date) || !(target.kickoff instanceof Date)
    || !Number.isFinite(row.kickoff.getTime()) || !Number.isFinite(target.kickoff.getTime())) return false;
  const rowIsBoundary = isCalendarBoundary(row);
  const targetIsBoundary = isCalendarBoundary(target);
  const rowTime = rowIsBoundary ? dateBoundary(row.kickoff) : row.kickoff.getTime();
  const targetTime = targetIsBoundary ? dateBoundary(target.kickoff) : target.kickoff.getTime();
  if (rowTime >= targetTime) return false;
  if (rowIsBoundary
    && dateBoundary(row.kickoff) === dateBoundary(target.kickoff)) return false;
  return true;
}

function deduplicate<T>(rows: T[], keyOf: (row: T) => string) {
  const counts = new Map<string, number>();
  for (const row of rows) counts.set(keyOf(row), (counts.get(keyOf(row)) ?? 0) + 1);
  const duplicateKeys = new Set([...counts].filter(([, count]) => count > 1).map(([key]) => key));
  return {
    rows: rows.filter((row) => !duplicateKeys.has(keyOf(row))),
    excluded: rows.filter((row) => duplicateKeys.has(keyOf(row))).length,
  };
}

function rowLabel(row: PlayerTdGame): 0 | 1 | null {
  const components = [row.rushingTds, row.receivingTds];
  if (components.some((value) => !finite(value) || value < 0)) return null;
  return components.some((value) => value! > 0) ? 1 : 0;
}

function average(values: Array<number | null | undefined>): number | null {
  const observed = values.filter(finite);
  return observed.length ? observed.reduce((sum, value) => sum + value, 0) / observed.length : null;
}

function sum(values: Array<number | null | undefined>): number | null {
  const observed = values.filter(finite);
  return observed.length ? observed.reduce((total, value) => total + value, 0) : null;
}

function clippedProbability(value: number) {
  return Math.max(1e-6, Math.min(1 - 1e-6, value));
}

function stableHash(input: PlayerTdEvaluationInput) {
  const normalize = <T extends object>(rows: T[]) =>
    [...rows].map((row) => JSON.stringify(row, (_key, value) =>
      value instanceof Date ? value.toISOString() : value))
      .sort();
  return createHash("sha256").update(JSON.stringify({
    players: normalize(input.players),
    teamGames: normalize(input.teamGames),
    redZoneFacts: normalize(input.redZoneFacts),
    version: PLAYER_TD_MODEL_VERSION,
    config: PLAYER_TD_MODEL_CONFIG,
  })).digest("hex");
}

export function hashPlayerTdInputs(input: PlayerTdEvaluationInput): string {
  return stableHash(input);
}

export function hashPlayerTdFittedReport(report: Pick<PlayerTdEvaluationReport, "version" | "config" | "inputHash" | "fitting">) {
  return createHash("sha256").update(JSON.stringify({
    version: report.version,
    config: report.config,
    inputHash: report.inputHash,
    fitting: report.fitting,
  })).digest("hex");
}

function rowsBefore<T extends { kickoff: Date; gameId: string }, U extends { kickoff: Date; gameId: string }>(rows: T[], target: U) {
  return rows.filter((row) => row.gameId !== target.gameId && isStrictlyPreKickoff(row, target));
}

function precomputeWr1Roles(games: PlayerTdGame[]) {
  type TeamGameGroup = { season: number; gameId: string; kickoff: Date; kickoffTimeSource?: PlayerTdGame["kickoffTimeSource"]; rows: PlayerTdGame[] };
  const groupsByTeamSeason = new Map<string, TeamGameGroup[]>();
  const groupByGame = new Map<string, TeamGameGroup>();
  for (const row of games) {
    if (row.position !== "WR") continue;
    const groupKey = `${row.season}\u0000${canonical(row.team)}\u0000${row.gameId}`;
    let group = groupByGame.get(groupKey);
    if (!group) {
      group = { season: row.season, gameId: row.gameId, kickoff: row.kickoff, kickoffTimeSource: row.kickoffTimeSource, rows: [] };
      groupByGame.set(groupKey, group);
      const teamSeason = `${row.season}\u0000${canonical(row.team)}`;
      groupsByTeamSeason.set(teamSeason, [...(groupsByTeamSeason.get(teamSeason) ?? []), group]);
    }
    group.rows.push(row);
  }

  const roles = new Map<string, boolean | null>();
  for (const groups of groupsByTeamSeason.values()) {
    const byDate = new Map<number, TeamGameGroup[]>();
    for (const group of groups) {
      const date = dateBoundary(group.kickoff);
      byDate.set(date, [...(byDate.get(date) ?? []), group]);
    }
    const priorTargets = new Map<string, number>();
    for (const date of [...byDate.keys()].sort((a, b) => a - b)) {
      const dayGroups = byDate.get(date)!;
      const scheduledSoFar = new Map<string, number>();
      const assignRoles = (group: TeamGameGroup, eligibleTargets: Map<string, number>) => {
        const wrRanking = [...eligibleTargets].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
        const wr1Id = wrRanking[0]?.[0];
        for (const row of group.rows) {
          roles.set(identity(row), finite(row.targets) && wr1Id !== undefined
            ? row.playerId === wr1Id : null);
        }
      };
      const scheduledGroups = new Map<number, TeamGameGroup[]>();
      for (const group of dayGroups) {
        if (isCalendarBoundary(group)) {
          assignRoles(group, new Map(priorTargets));
        } else {
          const time = group.kickoff.getTime();
          scheduledGroups.set(time, [...(scheduledGroups.get(time) ?? []), group]);
        }
      }
      for (const time of [...scheduledGroups.keys()].sort((a, b) => a - b)) {
        const eligibleTargets = new Map(priorTargets);
        for (const [playerId, targets] of scheduledSoFar) {
          eligibleTargets.set(playerId, (eligibleTargets.get(playerId) ?? 0) + targets);
        }
        const simultaneous = scheduledGroups.get(time)!;
        for (const group of simultaneous) assignRoles(group, eligibleTargets);
        for (const group of simultaneous) for (const row of group.rows) {
          if (finite(row.targets)) {
            scheduledSoFar.set(row.playerId, (scheduledSoFar.get(row.playerId) ?? 0) + row.targets);
          }
        }
      }
      // Every game on the day becomes available to future calendar dates.
      for (const group of dayGroups) for (const row of group.rows) {
        if (finite(row.targets)) priorTargets.set(row.playerId, (priorTargets.get(row.playerId) ?? 0) + row.targets);
      }
    }
  }
  return roles;
}

type WrDefenseEvent = { row: PlayerTdGame; role: boolean; label: 0 | 1 };

function historicalWrScoringRates(
  target: PlayerTdCandidate,
  against: WrDefenseEvent[],
): { wr1Rate: number | null; wr1Samples: number; otherRate: number | null; otherSamples: number } {
  let wr1Td = 0; let wr1Samples = 0; let otherTd = 0; let otherSamples = 0;
  for (const event of against) {
    if (event.row.gameId === target.gameId || !isStrictlyPreKickoff(event.row, target)) continue;
    if (event.role) { wr1Samples += 1; wr1Td += event.label; }
    else { otherSamples += 1; otherTd += event.label; }
  }
  return {
    wr1Rate: wr1Samples ? wr1Td / wr1Samples : null,
    wr1Samples,
    otherRate: otherSamples ? otherTd / otherSamples : null,
    otherSamples,
  };
}

function featuresFor(
  target: PlayerTdCandidate,
  playerHistory: PlayerTdGame[],
  ownTeamGames: PlayerTdTeamGame[],
  opponentTeamGames: PlayerTdTeamGame[],
  playerRedFacts: PlayerTdRedZoneFact[],
  defenseEvents: WrDefenseEvent[],
  wrRoles: Map<string, boolean | null>,
  defenseRatesCache: Map<string, ReturnType<typeof historicalWrScoringRates>>,
  wrRoleOverride?: boolean | null,
) {
  const prior = rowsBefore(playerHistory, target)
    .filter((row) => row.playerId === target.playerId)
    .sort(compareGames);
  const latest = prior.slice(-3);
  const beforeLatest = prior.slice(-6, -3);
  const priorLabels = prior.map(rowLabel);
  const cleanLabels = priorLabels.filter((label): label is 0 | 1 => label !== null);
  const ownTeamPrior = rowsBefore(ownTeamGames, target).sort((a, b) => a.kickoff.getTime() - b.kickoff.getTime());
  const opponentPrior = rowsBefore(opponentTeamGames, target).sort((a, b) => a.kickoff.getTime() - b.kickoff.getTime());
  const ownScores = ownTeamPrior.slice(-3).map((row) => row.score);
  const oppScores = opponentPrior.slice(-3).map((row) => row.score);
  const opponentDefenseEpa = opponentPrior.slice(-5).map((row) => row.defensiveEpa);

  const priorKeys = new Set(prior.map(identity));
  const validRed = playerRedFacts.filter((fact) => fact.zone === 20 && fact.validJoinedCoverage
    && canonical(fact.team) === canonical(target.team)
    && priorKeys.has(identity(fact)));
  const rzByGame = new Map<string, PlayerTdRedZoneFact>();
  for (const fact of validRed) rzByGame.set(fact.gameId, fact);
  const coverage = prior.filter((row) => rzByGame.has(row.gameId));
  const rzTargets = sum(coverage.map((row) => rzByGame.get(row.gameId)!.targets));
  const rzCarries = sum(coverage.map((row) => rzByGame.get(row.gameId)!.carries));
  const coveredTargets = sum(coverage.map((row) => row.targets));
  const coveredCarries = sum(coverage.map((row) => row.carries));
  const role = target.position === "WR"
    ? wrRoleOverride === undefined ? wrRoles.get(identity(target)) ?? null : wrRoleOverride
    : null;
  const defenseCacheKey = `${target.gameId}\u0000${canonical(target.team)}\u0000${canonical(target.opponent)}`;
  let defenseRates = defenseRatesCache.get(defenseCacheKey);
  if (!defenseRates) {
    defenseRates = historicalWrScoringRates(target, defenseEvents);
    defenseRatesCache.set(defenseCacheKey, defenseRates);
  }

  return {
    targetsMean3: average(latest.map((row) => row.targets)),
    carriesMean3: average(latest.map((row) => row.carries)),
    targetTrend: average(latest.map((row) => row.targets)) !== null && average(beforeLatest.map((row) => row.targets)) !== null
      ? average(latest.map((row) => row.targets))! - average(beforeLatest.map((row) => row.targets))! : null,
    carryTrend: average(latest.map((row) => row.carries)) !== null && average(beforeLatest.map((row) => row.carries)) !== null
      ? average(latest.map((row) => row.carries))! - average(beforeLatest.map((row) => row.carries))! : null,
    wr1Role: role === null ? null : Number(role),
    rzTargetShare: rzTargets !== null && coveredTargets !== null && coveredTargets > 0 ? rzTargets / coveredTargets : null,
    rzCarryShare: rzCarries !== null && coveredCarries !== null && coveredCarries > 0 ? rzCarries / coveredCarries : null,
    rzCoverage: coverage.length ? coverage.length / prior.length : null,
    defenseEpa: average(opponentDefenseEpa),
    opponentWr1TdRate: defenseRates.wr1Rate,
    opponentWr1Samples: defenseRates.wr1Samples,
    opponentOtherWrTdRate: defenseRates.otherRate,
    opponentOtherWrSamples: defenseRates.otherSamples,
    teamScoreMean3: average(ownScores),
    opponentScoreMean3: average(oppScores),
    priorTdRate: cleanLabels.length ? cleanLabels.reduce((total: number, label) => total + label, 0) / cleanLabels.length : null,
    priorTdCount: cleanLabels.length ? cleanLabels.reduce((total: number, label) => total + label, 0) : null,
  };
}

type FeatureContext = {
  validGames: PlayerTdGame[];
  gamesByPlayer: Map<string, PlayerTdGame[]>;
  teamGamesByTeam: Map<string, PlayerTdTeamGame[]>;
  redFactsByPlayer: Map<string, PlayerTdRedZoneFact[]>;
  wrRoles: Map<string, boolean | null>;
  defenseEventsByTeam: Map<string, WrDefenseEvent[]>;
  defenseRatesCache: Map<string, ReturnType<typeof historicalWrScoringRates>>;
};

function appendToMap<T>(map: Map<string, T[]>, key: string, value: T) {
  const rows = map.get(key);
  if (rows) rows.push(value);
  else map.set(key, [value]);
}

function createFeatureContext(input: PlayerTdEvaluationInput) {
  const uniquePlayers = deduplicate<PlayerTdGame>(input.players, identity);
  const validGames = uniquePlayers.rows.filter((row) =>
    row.playerId.trim() && row.gameId.trim() && row.playerName.trim()
    && ["QB", "RB", "WR", "TE"].includes(row.position)
    && row.kickoff instanceof Date && Number.isFinite(row.kickoff.getTime()));
  const uniqueTeamGames = deduplicate<PlayerTdTeamGame>(input.teamGames, teamGameIdentity);
  const validTeamGames = uniqueTeamGames.rows.filter((row) => row.gameId.trim()
    && row.kickoff instanceof Date && Number.isFinite(row.kickoff.getTime()));
  const uniqueRedFacts = deduplicate(input.redZoneFacts, (fact) =>
    `${fact.gameId}\u0000${fact.playerId}\u0000${canonical(fact.team)}\u0000${fact.zone}`);
  const playerGameByIdentity = new Map(validGames.map((row) => [identity(row), row]));
  const validFacts = uniqueRedFacts.rows.filter((fact) => {
    const game = playerGameByIdentity.get(identity(fact));
    return fact.zone === 20 && fact.validJoinedCoverage
      && finite(fact.targets) && fact.targets >= 0 && finite(fact.carries) && fact.carries >= 0
      && game !== undefined && fact.season === game.season && fact.week === game.week
      && canonical(fact.team) === canonical(game.team)
      && canonical(fact.opponent) === canonical(game.opponent);
  });
  const gamesByPlayer = new Map<string, PlayerTdGame[]>();
  for (const row of validGames) appendToMap(gamesByPlayer, row.playerId, row);
  const teamGamesByTeam = new Map<string, PlayerTdTeamGame[]>();
  for (const row of validTeamGames) appendToMap(teamGamesByTeam, canonical(row.team), row);
  const redFactsByPlayer = new Map<string, PlayerTdRedZoneFact[]>();
  for (const fact of validFacts) appendToMap(redFactsByPlayer, fact.playerId, fact);
  const wrRoles = precomputeWr1Roles(validGames);
  const defenseEventsByTeam = new Map<string, WrDefenseEvent[]>();
  for (const row of validGames) {
    if (row.position !== "WR") continue;
    const role = wrRoles.get(identity(row));
    const label = rowLabel(row);
    if (role === null || role === undefined || label === null) continue;
    appendToMap(defenseEventsByTeam, canonical(row.opponent), { row, role, label });
  }
  return {
    context: {
      validGames,
      gamesByPlayer,
      teamGamesByTeam,
      redFactsByPlayer,
      wrRoles,
      defenseEventsByTeam,
      defenseRatesCache: new Map<string, ReturnType<typeof historicalWrScoringRates>>(),
    } satisfies FeatureContext,
    exclusions: {
      excludedDuplicatePlayerRows: uniquePlayers.excluded,
      excludedDuplicateTeamGames: uniqueTeamGames.excluded,
      excludedDuplicateRedZoneFacts: uniqueRedFacts.excluded,
    },
  };
}

function candidateWr1Role(candidate: PlayerTdCandidate, history: PlayerTdGame[]): boolean | null {
  if (candidate.position !== "WR") return null;
  const targets = new Map<string, number>();
  for (const row of history) {
    if (row.position !== "WR" || row.season !== candidate.season
      || canonical(row.team) !== canonical(candidate.team)
      || !isStrictlyPreKickoff(row, candidate) || !finite(row.targets)) continue;
    targets.set(row.playerId, (targets.get(row.playerId) ?? 0) + row.targets);
  }
  if (!targets.has(candidate.playerId) || !targets.size) return null;
  const ranked = [...targets].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  return ranked[0]?.[0] === candidate.playerId;
}

export function preparePlayerTdExamples(input: PlayerTdEvaluationInput) {
  const { context, exclusions } = createFeatureContext(input);
  const { validGames, gamesByPlayer, teamGamesByTeam, redFactsByPlayer, wrRoles, defenseEventsByTeam, defenseRatesCache } = context;
  const examples: PlayerTdExample[] = [];
  let excludedUnlabeledRows = 0;
  let excludedInsufficientHistory = 0;
  for (const target of validGames.sort(compareGames)) {
    const label = rowLabel(target);
    if (label === null) { excludedUnlabeledRows += 1; continue; }
    const playerHistory = gamesByPlayer.get(target.playerId) ?? [];
    const priorAppearances = rowsBefore(playerHistory, target).length;
    if (priorAppearances < PLAYER_TD_MODEL_CONFIG.minimumPriorAppearances) {
      excludedInsufficientHistory += 1;
      continue;
    }
    examples.push({
      playerId: target.playerId,
      playerName: target.playerName,
      position: target.position,
      team: canonical(target.team),
      opponent: canonical(target.opponent),
      season: target.season,
      week: target.week,
      gameId: target.gameId,
      kickoff: target.kickoff.toISOString(),
      label,
      priorAppearances,
      featureValues: featuresFor(
        target,
        playerHistory,
        teamGamesByTeam.get(canonical(target.team)) ?? [],
        teamGamesByTeam.get(canonical(target.opponent)) ?? [],
        redFactsByPlayer.get(target.playerId) ?? [],
        defenseEventsByTeam.get(canonical(target.opponent)) ?? [],
        wrRoles,
        defenseRatesCache,
      ),
    });
  }
  return {
    examples,
    exclusions: {
      ...exclusions,
      excludedUnlabeledRows,
      excludedInsufficientHistory,
    },
  };
}

type FittedLogistic = {
  intercept: number;
  coefficients: Record<string, number>;
  featureMeans: Record<string, number>;
  featureScales: Record<string, number>;
  features: string[];
};

function sigmoid(value: number) {
  if (value > 35) return 1 - EPSILON;
  if (value < -35) return EPSILON;
  return 1 / (1 + Math.exp(-value));
}

function fitLogistic(examples: PlayerTdExample[], features: string[], ridge: number): FittedLogistic {
  const means: Record<string, number> = {};
  const scales: Record<string, number> = {};
  for (const feature of features) {
    const observed = examples.map((example) => example.featureValues[feature]).filter(finite);
    means[feature] = observed.length ? observed.reduce((a, b) => a + b, 0) / observed.length : 0;
    const variance = observed.length ? observed.reduce((total, value) => total + (value - means[feature]!) ** 2, 0) / observed.length : 0;
    scales[feature] = Math.sqrt(variance) || 1;
  }
  // Each feature carries its explicit missingness indicator; no missing value
  // is silently interpreted as zero.
  const dimensions = features.flatMap((name) => [`value:${name}`, `missing:${name}`]);
  const vector = (example: PlayerTdExample) => dimensions.map((dimension) => {
    const [kind, name] = dimension.split(":") as ["value" | "missing", string];
    const value = example.featureValues[name];
    return kind === "missing" ? (finite(value) ? 0 : 1)
      : finite(value) ? (value - means[name]!) / scales[name]! : 0;
  });
  const design = examples.map((example) => [1, ...vector(example)]);
  const weights = Array(dimensions.length + 1).fill(0) as number[];
  let prevalence = examples.length ? examples.reduce((total, example) => total + example.label, 0) / examples.length : 0.5;
  prevalence = Math.max(0.001, Math.min(0.999, prevalence));
  weights[0] = Math.log(prevalence / (1 - prevalence));
  const regularization = examples.length ? ridge / examples.length : ridge;
  const objectiveAndGradient = (candidate: number[]) => {
    const gradient = Array(candidate.length).fill(0) as number[];
    let loss = 0;
    for (let rowIndex = 0; rowIndex < examples.length; rowIndex += 1) {
      const example = examples[rowIndex]!;
      const x = design[rowIndex]!;
      const score = x.reduce((total, value, index) => total + value * candidate[index]!, 0);
      loss += Math.max(score, 0) - example.label * score + Math.log1p(Math.exp(-Math.abs(score)));
      const residual = sigmoid(score) - example.label;
      for (let i = 0; i < candidate.length; i += 1) gradient[i]! += residual * x[i]!;
    }
    const divisor = Math.max(1, examples.length);
    loss /= divisor;
    for (let i = 0; i < candidate.length; i += 1) {
      gradient[i]! /= divisor;
      if (i > 0) {
        loss += 0.5 * regularization * candidate[i]! ** 2;
        gradient[i]! += regularization * candidate[i]!;
      }
    }
    return { loss, gradient };
  };
  // L-BFGS with Armijo backtracking minimizes the batch objective monotonically.
  // This avoids the unstable simultaneous diagonal-Newton updates previously
  // used for correlated workload, role, and scoring-context features.
  const history: Array<{ s: number[]; y: number[]; rho: number }> = [];
  let current = objectiveAndGradient(weights);
  for (let iteration = 0; iteration < 120; iteration += 1) {
    const gradientNorm = Math.max(...current.gradient.map(Math.abs));
    if (gradientNorm < 1e-7) break;
    let direction = [...current.gradient];
    const alphas: number[] = [];
    for (let index = history.length - 1; index >= 0; index -= 1) {
      const pair = history[index]!;
      const alpha = pair.rho * pair.s.reduce((total, value, i) => total + value * direction[i]!, 0);
      alphas[index] = alpha;
      direction = direction.map((value, i) => value - alpha * pair.y[i]!);
    }
    if (history.length) {
      const latest = history[history.length - 1]!;
      const sy = latest.s.reduce((total, value, i) => total + value * latest.y[i]!, 0);
      const yy = latest.y.reduce((total, value) => total + value * value, 0);
      const scale = yy > 0 ? sy / yy : 1;
      direction = direction.map((value) => value * scale);
    }
    for (let index = 0; index < history.length; index += 1) {
      const pair = history[index]!;
      const beta = pair.rho * pair.y.reduce((total, value, i) => total + value * direction[i]!, 0);
      direction = direction.map((value, i) => value + pair.s[i]! * (alphas[index]! - beta));
    }
    direction = direction.map((value) => -value);
    let directionalDerivative = current.gradient.reduce((total, value, i) => total + value * direction[i]!, 0);
    if (!Number.isFinite(directionalDerivative) || directionalDerivative >= 0) {
      direction = current.gradient.map((value) => -value);
      directionalDerivative = -current.gradient.reduce((total, value) => total + value * value, 0);
    }
    let step = 1;
    let nextWeights: number[] | null = null;
    let next = current;
    for (let attempt = 0; attempt < 30; attempt += 1) {
      const candidate = weights.map((value, i) => value + step * direction[i]!);
      const candidateResult = objectiveAndGradient(candidate);
      if (Number.isFinite(candidateResult.loss)
        && candidateResult.loss <= current.loss + 1e-4 * step * directionalDerivative) {
        nextWeights = candidate;
        next = candidateResult;
        break;
      }
      step *= 0.5;
    }
    if (!nextWeights) break;
    const s = nextWeights.map((value, i) => value - weights[i]!);
    const y = next.gradient.map((value, i) => value - current.gradient[i]!);
    const curvature = s.reduce((total, value, i) => total + value * y[i]!, 0);
    if (curvature > 1e-12) {
      history.push({ s, y, rho: 1 / curvature });
      if (history.length > 10) history.shift();
    }
    for (let i = 0; i < weights.length; i += 1) weights[i] = nextWeights[i]!;
    current = next;
    if (Math.max(...s.map(Math.abs)) < 1e-8) break;
  }
  const coefficients: Record<string, number> = {};
  dimensions.forEach((dimension, index) => { coefficients[dimension] = weights[index + 1]!; });
  return { intercept: weights[0]!, coefficients, featureMeans: means, featureScales: scales, features };
}

function predict(model: FittedLogistic, example: Pick<PlayerTdExample, "featureValues">) {
  let score = model.intercept;
  for (const feature of model.features) {
    const value = example.featureValues[feature];
    const standardized = finite(value) ? (value - model.featureMeans[feature]!) / model.featureScales[feature]! : 0;
    score += standardized * model.coefficients[`value:${feature}`]!;
    if (!finite(value)) score += model.coefficients[`missing:${feature}`]!;
  }
  return sigmoid(score);
}

function fitPlatt(rows: Array<{ score: number; label: 0 | 1 }>): { intercept: number; slope: number } | null {
  if (rows.length < 10 || new Set(rows.map((row) => row.label)).size < 2) return null;
  let intercept = 0;
  let slope = 1;
  const objective = (a: number, b: number) => rows.reduce((total, row) => {
    const score = a + b * row.score;
    return total + Math.max(score, 0) - row.label * score + Math.log1p(Math.exp(-Math.abs(score)));
  }, 0) + 0.5 * PLAYER_TD_MODEL_CONFIG.calibrationRidgePenalty * (a * a + b * b);
  for (let iteration = 0; iteration < 100; iteration += 1) {
    let g0 = 0; let g1 = 0; let h00 = 1e-6; let h01 = 0; let h11 = 1e-6;
    for (const row of rows) {
      const p = sigmoid(intercept + slope * row.score);
      const residual = p - row.label;
      const curvature = Math.max(1e-6, p * (1 - p));
      g0 += residual; g1 += residual * row.score;
      h00 += curvature; h01 += curvature * row.score; h11 += curvature * row.score ** 2;
    }
    g0 += PLAYER_TD_MODEL_CONFIG.calibrationRidgePenalty * intercept;
    g1 += PLAYER_TD_MODEL_CONFIG.calibrationRidgePenalty * slope;
    h00 += PLAYER_TD_MODEL_CONFIG.calibrationRidgePenalty;
    h11 += PLAYER_TD_MODEL_CONFIG.calibrationRidgePenalty;
    const determinant = h00 * h11 - h01 * h01;
    if (Math.abs(determinant) < 1e-12) break;
    let d0 = (h11 * g0 - h01 * g1) / determinant;
    let d1 = (h00 * g1 - h01 * g0) / determinant;
    const maxStep = Math.max(Math.abs(d0), Math.abs(d1));
    if (maxStep > 5) { d0 *= 5 / maxStep; d1 *= 5 / maxStep; }
    const directionalDerivative = g0 * d0 + g1 * d1;
    const currentObjective = objective(intercept, slope);
    let step = 1;
    let accepted = false;
    for (let attempt = 0; attempt < 30; attempt += 1) {
      if (objective(intercept - step * d0, slope - step * d1)
        <= currentObjective - 1e-4 * step * directionalDerivative) {
        intercept -= step * d0;
        slope -= step * d1;
        accepted = true;
        break;
      }
      step *= 0.5;
    }
    if (!accepted || (Math.abs(step * d0) + Math.abs(step * d1) < 1e-7)) break;
  }
  return { intercept, slope };
}

function metricSet(rows: Array<{ label: 0 | 1; probability: number }>): PlayerTdMetricSet {
  if (!rows.length) return { count: 0, positives: 0, brierScore: null, logLoss: null, auc: null, reliability: [] };
  const brier = rows.reduce((total, row) => total + (row.probability - row.label) ** 2, 0) / rows.length;
  const logLoss = rows.reduce((total, row) => {
    const p = clippedProbability(row.probability);
    return total - row.label * Math.log(p) - (1 - row.label) * Math.log(1 - p);
  }, 0) / rows.length;
  const positives = rows.filter((row) => row.label === 1).length;
  const negatives = rows.length - positives;
  let concordant = 0;
  let ties = 0;
  if (positives && negatives) {
    const pos = rows.filter((row) => row.label === 1);
    const neg = rows.filter((row) => row.label === 0);
    for (const positive of pos) for (const negative of neg) {
      if (positive.probability > negative.probability) concordant += 1;
      else if (positive.probability === negative.probability) ties += 1;
    }
  }
  const bins = Array.from({ length: 10 }, (_, bin) => {
    const values = rows.filter((row) => Math.min(9, Math.floor(row.probability * 10)) === bin);
    return values.length ? {
      bin,
      count: values.length,
      meanPrediction: values.reduce((total, row) => total + row.probability, 0) / values.length,
      observedRate: values.reduce((total, row) => total + row.label, 0) / values.length,
    } : null;
  }).filter((bin): bin is NonNullable<typeof bin> => bin !== null);
  return {
    count: rows.length, positives, brierScore: brier, logLoss,
    auc: positives && negatives ? (concordant + ties / 2) / (positives * negatives) : null,
    reliability: bins,
  };
}

function smoothedRate(rows: PlayerTdExample[]) {
  const positives = rows.reduce((total, row) => total + row.label, 0);
  return (positives + 1) / (rows.length + 2);
}

export function runTdEvaluation(input: PlayerTdEvaluationInput): PlayerTdEvaluationReport {
  const prepared = preparePlayerTdExamples(input);
  const examples = prepared.examples;
  const training = examples.filter((row) => (PLAYER_TD_MODEL_CONFIG.trainingSeasons as readonly number[]).includes(row.season));
  let calibration = examples.filter((row) => row.season === 2024 && row.week <= 9);
  let calibrationSource: PlayerTdEvaluationReport["fitting"]["calibrationSource"] = "2024-first-half";
  if (calibration.length < 10 || new Set(calibration.map((row) => row.label)).size < 2) {
    calibration = examples.filter((row) => row.season === 2023 && row.week >= 10);
    calibrationSource = calibration.length >= 10 && new Set(calibration.map((row) => row.label)).size > 1
      ? "2023-later-weeks" : "unavailable";
  }
  const evaluation = examples.filter((row) => row.season === 2024 && row.week >= 10 || row.season >= 2025);
  const redZoneTrainingCoveredAppearances = training.filter((row) =>
    row.featureValues.rzCoverage !== null && row.featureValues.rzCoverage > 0).length;
  const excludedFeatureFamilies = redZoneTrainingCoveredAppearances ? [] : ["redZone"];
  const activeFeatures = FEATURE_NAMES.filter((feature) =>
    redZoneTrainingCoveredAppearances || !(FEATURE_GROUPS.redZone as readonly string[]).includes(feature));
  const model = fitLogistic(training, activeFeatures, PLAYER_TD_MODEL_CONFIG.ridgePenalty);
  const calibrationTraining = calibrationSource === "2023-later-weeks"
    ? training.filter((row) => row.season < 2023 || (row.season === 2023 && row.week < 10))
    : training;
  const calibrationModel = calibrationSource === "2023-later-weeks"
    ? fitLogistic(calibrationTraining, activeFeatures, PLAYER_TD_MODEL_CONFIG.ridgePenalty)
    : model;
  const calibratorFor = (fittedModel: FittedLogistic) => calibrationSource === "unavailable" ? null
    : fitPlatt(calibration.map((row) => {
      const raw = clippedProbability(predict(fittedModel, row));
      return { score: Math.log(raw / (1 - raw)), label: row.label };
    }));
  const platt = calibratorFor(calibrationModel);
  const calibrationFit: PlayerTdEvaluationReport["fitting"]["calibrationFit"] = platt === null
    ? "unavailable" : calibrationSource === "2023-later-weeks" ? "early-2023-fold" : "main-training-model";

  const trainByPosition = new Map<string, PlayerTdExample[]>();
  const trainByPlayer = new Map<string, PlayerTdExample[]>();
  const trainByTeamOpponent = new Map<string, PlayerTdExample[]>();
  const add = (map: Map<string, PlayerTdExample[]>, key: string, row: PlayerTdExample) =>
    map.set(key, [...(map.get(key) ?? []), row]);
  for (const row of training) {
    add(trainByPosition, row.position, row);
    add(trainByPlayer, `${row.position}:${row.playerId}`, row);
    add(trainByTeamOpponent, `${row.team}:${row.opponent}`, row);
  }
  const without = (group: keyof typeof FEATURE_GROUPS) => {
    const omitted = new Set<string>(FEATURE_GROUPS[group]);
    return fitLogistic(training, activeFeatures.filter((feature) => !omitted.has(feature)), PLAYER_TD_MODEL_CONFIG.ridgePenalty);
  };
  const withoutForCalibration = (group: keyof typeof FEATURE_GROUPS) => {
    const omitted = new Set<string>(FEATURE_GROUPS[group]);
    return fitLogistic(calibrationTraining, activeFeatures.filter((feature) => !omitted.has(feature)), PLAYER_TD_MODEL_CONFIG.ridgePenalty);
  };
  const ablatedModels = {
    withoutUsage: without("usage"),
    withoutRedZone: without("redZone"),
    withoutDefense: without("defense"),
    withoutScoringContext: without("scoringContext"),
  };
  const calibrationAblatedModels = calibrationSource === "2023-later-weeks"
    ? {
      withoutUsage: withoutForCalibration("usage"),
      withoutRedZone: withoutForCalibration("redZone"),
      withoutDefense: withoutForCalibration("defense"),
      withoutScoringContext: withoutForCalibration("scoringContext"),
    }
    : ablatedModels;
  const ablationPlatt = {
    withoutUsage: calibratorFor(calibrationAblatedModels.withoutUsage),
    withoutRedZone: calibratorFor(calibrationAblatedModels.withoutRedZone),
    withoutDefense: calibratorFor(calibrationAblatedModels.withoutDefense),
    withoutScoringContext: calibratorFor(calibrationAblatedModels.withoutScoringContext),
  };
  const calibrate = (probability: number, parameters: { intercept: number; slope: number } | null) => {
    if (!parameters) return probability;
    const raw = clippedProbability(probability);
    return sigmoid(parameters.intercept + parameters.slope * Math.log(raw / (1 - raw)));
  };
  const calibrationMetricRows = calibration.map((row) => ({
    label: row.label,
    probability: calibrate(predict(calibrationModel, row), platt),
  }));
  const calibrationMetrics = metricSet(calibrationMetricRows);
  const predictions = evaluation.map((row) => {
    const baselineProbabilities = {
      position: smoothedRate(trainByPosition.get(row.position) ?? training),
      player: smoothedRate(trainByPlayer.get(`${row.position}:${row.playerId}`) ?? trainByPosition.get(row.position) ?? training),
      teamOpponent: smoothedRate(trainByTeamOpponent.get(`${row.team}:${row.opponent}`) ?? trainByPosition.get(row.position) ?? training),
    };
    const ablationProbabilities = {
      withoutUsage: calibrate(predict(ablatedModels.withoutUsage, row), ablationPlatt.withoutUsage),
      withoutRedZone: calibrate(predict(ablatedModels.withoutRedZone, row), ablationPlatt.withoutRedZone),
      withoutDefense: calibrate(predict(ablatedModels.withoutDefense, row), ablationPlatt.withoutDefense),
      withoutScoringContext: calibrate(predict(ablatedModels.withoutScoringContext, row), ablationPlatt.withoutScoringContext),
    };
    return {
      playerId: row.playerId,
      playerName: row.playerName,
      position: row.position,
      team: row.team,
      opponent: row.opponent,
      season: row.season,
      week: row.week,
      gameId: row.gameId,
      label: row.label,
      probability: calibrate(predict(model, row), platt),
      baselineProbabilities,
      ablationProbabilities,
      featureValues: row.featureValues,
    };
  });
  const metricsFor = (probability: (row: (typeof predictions)[number]) => number) =>
    metricSet(predictions.map((row) => ({ label: row.label, probability: probability(row) })));
  const coefficients: Record<string, number> = {};
  for (const [key, value] of Object.entries(model.coefficients)) coefficients[key] = value;
  const inputHash = stableHash(input);
  const fitting: PlayerTdEvaluationReport["fitting"] = {
    trainingExamples: training.length,
    calibrationExamples: calibration.length,
    calibrationSource,
    calibrationFit,
    calibrationFitNote: calibrationSource === "2023-later-weeks"
      ? "Calibration scores use a separate model trained on 2021-22 and 2023 weeks 1-9; the final evaluation model refits on all 2021-23 training rows, including the fallback calibration period."
      : calibrationSource === "2024-first-half"
        ? "Calibration scores are generated by the model frozen on 2021-23 training data; 2024 first-half labels are excluded from model fitting."
        : "Calibration was unavailable because no chronological calibration cohort met minimum size and class requirements.",
    includedFeatures: activeFeatures,
    excludedFeatureFamilies,
    redZoneTrainingCoveredAppearances,
    calibrationPositiveLabels: calibration.filter((row) => row.label === 1).length,
    calibrationNegativeLabels: calibration.filter((row) => row.label === 0).length,
    calibrationMetrics,
    ablationPlatt,
    fittedModel: { intercept: model.intercept, coefficients, featureMeans: model.featureMeans, featureScales: model.featureScales },
    platt,
  };
  const fittingHash = hashPlayerTdFittedReport({
    version: PLAYER_TD_MODEL_VERSION, config: PLAYER_TD_MODEL_CONFIG, inputHash, fitting,
  });

  return {
    version: PLAYER_TD_MODEL_VERSION,
    config: PLAYER_TD_MODEL_CONFIG,
    inputHash,
    fittingHash,
    fitting,
    cohorts: {
      ...prepared.exclusions,
      training: training.length,
      calibration: calibration.length,
      evaluation: evaluation.length,
      evaluationRedZoneCoveredAppearances: evaluation.filter((row) =>
        row.featureValues.rzCoverage !== null && row.featureValues.rzCoverage > 0).length,
      evaluationRedZoneUnavailableAppearances: evaluation.filter((row) =>
        row.featureValues.rzCoverage === null || row.featureValues.rzCoverage === 0).length,
    },
    metrics: {
      model: metricsFor((row) => row.probability),
      baselines: {
        position: metricsFor((row) => row.baselineProbabilities.position),
        player: metricsFor((row) => row.baselineProbabilities.player),
        teamOpponent: metricsFor((row) => row.baselineProbabilities.teamOpponent),
      },
      ablations: {
        withoutUsage: metricsFor((row) => row.ablationProbabilities.withoutUsage),
        withoutRedZone: metricsFor((row) => row.ablationProbabilities.withoutRedZone),
        withoutDefense: metricsFor((row) => row.ablationProbabilities.withoutDefense),
        withoutScoringContext: metricsFor((row) => row.ablationProbabilities.withoutScoringContext),
      },
    },
    predictions,
  };
}

function validateFrozenScoringContract(
  history: PlayerTdEvaluationInput,
  candidate: PlayerTdCandidate,
  frozenReport: PlayerTdEvaluationReport,
) {
  if (frozenReport.version !== PLAYER_TD_MODEL_VERSION) {
    throw new Error(`Unsupported frozen player-TD model version: ${frozenReport.version}`);
  }
  if (JSON.stringify(frozenReport.config) !== JSON.stringify(PLAYER_TD_MODEL_CONFIG)) {
    throw new Error("Frozen player-TD model configuration does not match this feature schema");
  }
  const actualHash = hashPlayerTdInputs(history);
  if (frozenReport.inputHash !== actualHash) {
    throw new Error("Frozen player-TD report input hash does not match the supplied historical input");
  }
  if (frozenReport.fittingHash !== hashPlayerTdFittedReport(frozenReport)) {
    throw new Error("Frozen player-TD fitted parameters or calibration hash is invalid");
  }
  if (!frozenReport.fitting.platt || frozenReport.fitting.calibrationFit === "unavailable"
    || frozenReport.fitting.calibrationExamples < 10
    || frozenReport.fitting.calibrationPositiveLabels < 1
    || frozenReport.fitting.calibrationNegativeLabels < 1
    || frozenReport.fitting.calibrationMetrics.count !== frozenReport.fitting.calibrationExamples
    || !finite(frozenReport.fitting.calibrationMetrics.brierScore)
    || !finite(frozenReport.fitting.calibrationMetrics.logLoss)) {
    throw new Error("Frozen player-TD report has no valid fitted calibration");
  }
  const featureSet = new Set(frozenReport.fitting.includedFeatures);
  const expectedFeatures = FEATURE_NAMES.filter((feature) =>
    featureSet.has(feature) && !(frozenReport.fitting.excludedFeatureFamilies.includes("redZone")
      && (FEATURE_GROUPS.redZone as readonly string[]).includes(feature)));
  if (featureSet.size !== frozenReport.fitting.includedFeatures.length
    || expectedFeatures.length !== featureSet.size
    || expectedFeatures.some((feature, index) => feature !== frozenReport.fitting.includedFeatures[index])) {
    throw new Error("Frozen player-TD feature schema is invalid");
  }
  const fitted = frozenReport.fitting.fittedModel;
  if (!finite(fitted.intercept) || frozenReport.fitting.trainingExamples < 1
    || !finite(frozenReport.fitting.platt.intercept) || !finite(frozenReport.fitting.platt.slope)) {
    throw new Error("Frozen player-TD fitted parameters are invalid");
  }
  const expectedCoefficientKeys = expectedFeatures.flatMap((feature) => [`value:${feature}`, `missing:${feature}`]);
  if (expectedCoefficientKeys.some((key) => !finite(fitted.coefficients[key]))
    || Object.keys(fitted.coefficients).length !== expectedCoefficientKeys.length
    || expectedFeatures.some((feature) => !finite(fitted.featureMeans[feature])
      || !finite(fitted.featureScales[feature]) || fitted.featureScales[feature]! <= 0)) {
    throw new Error("Frozen player-TD model parameters do not match its feature schema");
  }
  if (!candidate.playerId.trim() || !candidate.playerName.trim() || !candidate.gameId.trim()
    || !canonical(candidate.team) || !canonical(candidate.opponent)
    || !["QB", "RB", "WR", "TE"].includes(candidate.position)
    || !(candidate.kickoff instanceof Date) || !Number.isFinite(candidate.kickoff.getTime())) {
    throw new Error("Upcoming player-TD candidate identity, position, team, or kickoff is invalid");
  }
  const historicalRows = [...history.players, ...history.teamGames];
  if (historicalRows.some((row) => row.gameId === candidate.gameId)) {
    throw new Error("Candidate game ID is already present in historical input; target-game leakage rejected");
  }
  if (historicalRows.some((row) => !isStrictlyPreKickoff(row, candidate))) {
    throw new Error("Historical input contains same-day or post-kickoff evidence for this candidate");
  }
  if (history.redZoneFacts.some((fact) => fact.gameId === candidate.gameId)) {
    throw new Error("Candidate red-zone facts are present in historical input; target-game leakage rejected");
  }
}

/**
 * Scores a target-label-free upcoming candidate only against the exact frozen
 * historical input used to produce the report. It returns evidence/probability
 * only; callers remain responsible for all authorization and safety gates.
 */
export function scoreUpcomingPlayerTdCandidate(input: {
  history: PlayerTdEvaluationInput;
  candidate: PlayerTdCandidate;
  frozenReport: PlayerTdEvaluationReport;
}): PlayerTdFrozenCandidateScore {
  const { history, candidate, frozenReport } = input;
  validateFrozenScoringContract(history, candidate, frozenReport);
  const { context } = createFeatureContext(history);
  const playerHistory = context.gamesByPlayer.get(candidate.playerId) ?? [];
  const priorAppearances = rowsBefore(playerHistory, candidate).length;
  if (priorAppearances < PLAYER_TD_MODEL_CONFIG.minimumPriorAppearances) {
    throw new Error(`Candidate has only ${priorAppearances} strictly pre-kickoff appearances; minimum is ${PLAYER_TD_MODEL_CONFIG.minimumPriorAppearances}`);
  }
  const featureValues = featuresFor(
    candidate,
    playerHistory,
    context.teamGamesByTeam.get(canonical(candidate.team)) ?? [],
    context.teamGamesByTeam.get(canonical(candidate.opponent)) ?? [],
    context.redFactsByPlayer.get(candidate.playerId) ?? [],
    context.defenseEventsByTeam.get(canonical(candidate.opponent)) ?? [],
    context.wrRoles,
    context.defenseRatesCache,
    candidateWr1Role(candidate, context.validGames),
  );
  const fitted = frozenReport.fitting.fittedModel;
  const model: FittedLogistic = {
    ...fitted,
    features: frozenReport.fitting.includedFeatures,
  };
  const rawProbability = clippedProbability(predict(model, { featureValues }));
  const calibration = frozenReport.fitting.platt!;
  const calibratedProbability = sigmoid(
    calibration.intercept + calibration.slope * Math.log(rawProbability / (1 - rawProbability)),
  );
  return {
    version: PLAYER_TD_MODEL_VERSION,
    inputHash: frozenReport.inputHash,
    playerId: candidate.playerId,
    playerName: candidate.playerName,
    position: candidate.position,
    team: canonical(candidate.team),
    opponent: canonical(candidate.opponent),
    season: candidate.season,
    week: candidate.week,
    gameId: candidate.gameId,
    probability: calibratedProbability,
    featureValues,
  };
}

export const runPlayerTdEvaluation = runTdEvaluation;