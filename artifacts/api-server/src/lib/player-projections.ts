import { createHash } from "node:crypto";
import { NFLVERSE_TEAM_ALIASES } from "./personnel-context-derivation";

export const PLAYER_PROJECTION_VERSION = "gridline-player-projection-historical-v1";
export const PLAYER_PROJECTION_CONFIG = {
  trainingSeasons: [2021, 2022, 2023],
  evaluationSeason: 2024,
  minimumPriorAppearances: 3,
  priorWindows: [3, 5, 8],
  ridgePenalty: 2,
  predictionCutoff: "one millisecond before the available game-time boundary; date-only fallbacks exclude all same-day evidence",
  sourceTimeLimitation: "Game-time ordering uses scheduled kickoffs when available; otherwise same-day evidence is withheld using a calendar-date boundary. Archived source-publication timestamps were not verified.",
} as const;

export type PlayerProjectionFamily =
  | "qbPassingYards"
  | "rbRushingYards"
  | "receiverReceivingYards"
  | "receiverReceptions";

export type PlayerProjectionObservation = {
  playerId: string;
  playerName: string;
  position: string;
  season: number;
  week: number;
  seasonType: string;
  gameId: string;
  kickoffTime: Date;
  gameDate?: Date;
  scheduleTimeSource?: "scheduledKickoff" | "calendarDateBoundary";
  team: string;
  opponent: string;
  homeAway: "home" | "away";
  passingYards: number | null;
  rushingYards: number | null;
  receivingYards: number | null;
  receptions: number | null;
  passAttempts: number | null;
  carries: number | null;
  targets: number | null;
};

export type PlayerProjectionTeamGame = {
  season: number;
  week: number;
  gameId: string;
  kickoffTime: Date;
  team: string;
  opponent: string;
  passRate: number | null;
  defensiveEpaAllowedPerPlay: number | null;
};

export type PlayerProjectionSourceStat = Omit<
  PlayerProjectionObservation,
  "gameId" | "kickoffTime" | "team" | "opponent" | "homeAway"
> & {
  teamId: string | null;
  opponentTeamId: string | null;
};

export type PlayerProjectionScheduleGame = {
  gameId: string;
  season: number;
  week: number;
  kickoffTime: Date | null;
  gameDate: Date | null;
  status: string;
  homeTeamId: string;
  awayTeamId: string;
  finalHomeScore: number | null;
  finalAwayScore: number | null;
  sourceTimeMode?: "scheduledKickoff" | "calendarDateBoundary";
};

export type PlayerProjectionTeam = { teamId: string; abbreviation: string };

export type PlayerProjectionRawTeamGame = {
  season: number;
  week: number;
  gameId: string;
  teamId: string;
  opponentTeamId: string;
  passAttempts: number | null;
  rushAttempts: number | null;
  defensiveEpaAllowedPerPlay: number | null;
  gameDate?: Date | string | null;
  isHome?: boolean | null;
};

type FamilyDefinition = {
  position: string[];
  target: keyof Pick<
    PlayerProjectionObservation,
    "passingYards" | "rushingYards" | "receivingYards" | "receptions"
  >;
  volume: keyof Pick<PlayerProjectionObservation, "passAttempts" | "carries" | "targets">;
  label: string;
};

export const PLAYER_PROJECTION_FAMILIES: Record<PlayerProjectionFamily, FamilyDefinition> = {
  qbPassingYards: { position: ["QB"], target: "passingYards", volume: "passAttempts", label: "QB passing yards" },
  rbRushingYards: { position: ["RB"], target: "rushingYards", volume: "carries", label: "RB rushing yards" },
  receiverReceivingYards: { position: ["WR", "TE"], target: "receivingYards", volume: "targets", label: "WR/TE receiving yards" },
  receiverReceptions: { position: ["WR", "TE"], target: "receptions", volume: "targets", label: "WR/TE receptions" },
};

const CONTINUOUS_FEATURES = [
  "priorLast3TargetMean",
  "priorLast5TargetMean",
  "priorLast8TargetMean",
  "seasonToDateTargetMean",
  "priorLast3VolumeMean",
  "priorLast8VolumeMean",
  "priorLast3Efficiency",
  "priorLast8Efficiency",
  "teamSeasonPassRate",
  "opponentSeasonDefensiveEpaAllowed",
  "teamRestDays",
] as const;

type FeatureValues = Record<(typeof CONTINUOUS_FEATURES)[number], number | null>;

type ProjectionExample = {
  observation: PlayerProjectionObservation;
  family: PlayerProjectionFamily;
  actual: number;
  volume: number | null;
  priorAppearanceCount: number;
  priorAppearanceCutoff: string;
  featureValues: FeatureValues;
  missingFeatureNames: string[];
  last3Games: number;
  last5Games: number;
  last8Games: number;
};

export type PlayerProjectionPrediction = {
  family: PlayerProjectionFamily;
  playerId: string;
  player: string;
  position: string;
  team: string;
  opponent: string;
  season: number;
  week: number;
  gameId: string;
  kickoffTime: string | null;
  gameDate: string;
  calculationTimestamp: string;
  cutoffBasis: "scheduled_kickoff" | "calendar_date_boundary";
  projectedStatistic: number;
  actualStatistic: number;
  last3Baseline: number;
  last5Baseline: number | null;
  seasonToDateBaseline: number | null;
  modelVersion: string;
  historicalSampleQuality: {
    priorAppearances: number;
    last3Games: number;
    last5Games: number;
    last8Games: number;
    label: "low" | "moderate" | "high";
    availableFeatureCount: number;
    totalFeatureCount: number;
  };
  missingDataWarnings: string[];
  featureValues: FeatureValues;
};

export type PlayerProjectionMetric = {
  sampleSize: number;
  meanAbsoluteError: number | null;
  meanAbsoluteError95CI: [number, number] | null;
  rootMeanSquaredError: number | null;
  rootMeanSquaredError95CI: [number, number] | null;
  meanBias: number | null;
  meanBias95CI: [number, number] | null;
};

export type PlayerProjectionBaselineComparison = {
  baseline: PlayerProjectionMetric;
  modelOnSameCohort: PlayerProjectionMetric;
};

export type PlayerProjectionFamilyReport = {
  label: string;
  trainingSamples: number;
  evaluationCandidates: number;
  evaluationCandidatePlayers: number;
  eligiblePredictions: number;
  eligiblePlayers: number;
  predictionAvailability: number | null;
  minimumPriorAppearances: number;
  modelVersion: string;
  fittedArtifact: {
    featureNames: string[];
    standardizedMeans: number[];
    standardizedScales: number[];
    coefficients: number[];
    ridgePenalty: number;
    trainingExamplesSha256: string;
    trainingUsageVolumeTertiles: [number | null, number | null];
  };
  metrics: PlayerProjectionMetric;
  baselines: {
    last3AppearanceMean: PlayerProjectionBaselineComparison;
    last5AppearanceMean: PlayerProjectionBaselineComparison;
    seasonToDateMean: PlayerProjectionBaselineComparison;
  };
  usageStrata: Array<{
    band: "low" | "medium" | "high";
    trainingVolumeRange: [number | null, number | null];
    sampleSize: number;
    modelMae: number | null;
    last3BaselineMae: number | null;
  }>;
};

export type PlayerProjectionReport = {
  version: typeof PLAYER_PROJECTION_VERSION;
  evaluationKind: "historical_simulation";
  generatedAt: string;
  config: typeof PLAYER_PROJECTION_CONFIG;
  provenance: {
    databaseScope: "development";
    sourceDatasets: string[];
    rawPlayerStatRows: number;
    reconciledPlayerGameRows: number;
    teamGameRows: number;
    scheduleGames: number;
    scheduleTimeMode: "schedule_kickoff" | "calendar_date_boundary" | "team_game_calendar_date_fallback";
    matchedScheduleGames: number;
    unmatchedPlayerStatRows: number;
    excludedNonFinalScheduleRows: number;
    excludedUnmatchedOrAmbiguousPlayerRows: number;
    seasonCoverage: Record<string, number>;
    checksumSha256: string;
    historicalTimestampCaveat: string;
  };
  modelMethod: {
    name: string;
    description: string;
    featureNames: string[];
    baselineDefinitions: Record<string, string>;
    limitations: string[];
  };
  families: Record<PlayerProjectionFamily, PlayerProjectionFamilyReport>;
  predictions: PlayerProjectionPrediction[];
};

export function canonicalProjectionTeam(value: string | null | undefined): string | null {
  const normalized = value?.trim().toUpperCase();
  if (!normalized) return null;
  return NFLVERSE_TEAM_ALIASES[normalized] ?? normalized;
}

function finiteNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function scheduleKey(season: number, week: number, team: string, opponent: string) {
  return `${season}:${week}:${team}:${opponent}`;
}

export function reconcilePlayerProjectionRows(input: {
  stats: PlayerProjectionSourceStat[];
  schedule: PlayerProjectionScheduleGame[];
  teams: PlayerProjectionTeam[];
}) {
  const abbreviationByTeamId = new Map(input.teams.map((team) => [team.teamId, canonicalProjectionTeam(team.abbreviation)]));
  const gamesByKey = new Map<string, PlayerProjectionScheduleGame[]>();
  let excludedNonFinalScheduleRows = 0;
  for (const game of input.schedule) {
    const finalStatus = /final|complete/i.test(game.status)
      || (game.finalHomeScore !== null && game.finalAwayScore !== null);
    if (!finalStatus) {
      excludedNonFinalScheduleRows += 1;
      continue;
    }
    const home = abbreviationByTeamId.get(game.homeTeamId);
    const away = abbreviationByTeamId.get(game.awayTeamId);
    if (!home || !away) continue;
    for (const [team, opponent] of [[home, away], [away, home]] as const) {
      const key = scheduleKey(game.season, game.week, team, opponent);
      gamesByKey.set(key, [...(gamesByKey.get(key) ?? []), game]);
    }
  }

  const rows: PlayerProjectionObservation[] = [];
  let unmatchedOrAmbiguousRows = 0;
  for (const stat of input.stats) {
    const team = canonicalProjectionTeam(stat.teamId);
    const opponent = canonicalProjectionTeam(stat.opponentTeamId);
    if (!team || !opponent) {
      unmatchedOrAmbiguousRows += 1;
      continue;
    }
    const matches = gamesByKey.get(scheduleKey(stat.season, stat.week, team, opponent)) ?? [];
    if (matches.length !== 1) {
      unmatchedOrAmbiguousRows += 1;
      continue;
    }
    const game = matches[0]!;
    const kickoffTime = game.kickoffTime ?? game.gameDate;
    if (!kickoffTime || !Number.isFinite(kickoffTime.getTime())) {
      unmatchedOrAmbiguousRows += 1;
      continue;
    }
    rows.push({
      playerId: stat.playerId,
      playerName: stat.playerName,
      position: stat.position.toUpperCase(),
      season: stat.season,
      week: stat.week,
      seasonType: stat.seasonType,
      gameId: game.gameId,
      kickoffTime,
      gameDate: game.gameDate ?? kickoffTime,
      scheduleTimeSource: game.kickoffTime ? "scheduledKickoff" : "calendarDateBoundary",
      team,
      opponent,
      homeAway: abbreviationByTeamId.get(game.homeTeamId) === team ? "home" : "away",
      passingYards: finiteNumber(stat.passingYards),
      rushingYards: finiteNumber(stat.rushingYards),
      receivingYards: finiteNumber(stat.receivingYards),
      receptions: finiteNumber(stat.receptions),
      passAttempts: finiteNumber(stat.passAttempts),
      carries: finiteNumber(stat.carries),
      targets: finiteNumber(stat.targets),
    });
  }

  const duplicateKeys = new Set<string>();
  const observedKeys = new Set<string>();
  for (const row of rows) {
    const identity = `${row.playerId}:${row.season}:${row.week}:${row.team}:${row.opponent}:${row.gameId}`;
    if (observedKeys.has(identity)) duplicateKeys.add(identity);
    observedKeys.add(identity);
  }
  const uniqueRows = rows.filter((row) =>
    !duplicateKeys.has(`${row.playerId}:${row.season}:${row.week}:${row.team}:${row.opponent}:${row.gameId}`));
  unmatchedOrAmbiguousRows += rows.length - uniqueRows.length;

  return {
    rows: uniqueRows.sort(compareObservations),
    excludedNonFinalScheduleRows,
    excludedUnmatchedOrAmbiguousPlayerRows: unmatchedOrAmbiguousRows,
  };
}

export function reconcilePlayerProjectionTeamGames(input: {
  teamGames: PlayerProjectionRawTeamGame[];
  schedule: PlayerProjectionScheduleGame[];
  teams: PlayerProjectionTeam[];
}): PlayerProjectionTeamGame[] {
  const abbreviationByTeamId = new Map(input.teams.map((team) => [team.teamId, canonicalProjectionTeam(team.abbreviation)]));
  const gameByMatchup = new Map<string, PlayerProjectionScheduleGame[]>();
  for (const game of input.schedule) {
    const finalStatus = /final|complete/i.test(game.status)
      || (game.finalHomeScore !== null && game.finalAwayScore !== null);
    if (!finalStatus) continue;
    const home = abbreviationByTeamId.get(game.homeTeamId);
    const away = abbreviationByTeamId.get(game.awayTeamId);
    if (!home || !away) continue;
    for (const [team, opponent] of [[home, away], [away, home]] as const) {
      const key = scheduleKey(game.season, game.week, team, opponent);
      gameByMatchup.set(key, [...(gameByMatchup.get(key) ?? []), game]);
    }
  }
  const result: PlayerProjectionTeamGame[] = [];
  for (const source of input.teamGames) {
    const team = canonicalProjectionTeam(source.teamId);
    const opponent = canonicalProjectionTeam(source.opponentTeamId);
    if (!team || !opponent) continue;
    const matches = gameByMatchup.get(scheduleKey(source.season, source.week, team, opponent)) ?? [];
    if (matches.length !== 1) continue;
    const game = matches[0]!;
    const kickoffTime = game.kickoffTime ?? game.gameDate;
    if (!kickoffTime) continue;
    const attempts = finiteNumber(source.passAttempts);
    const rushes = finiteNumber(source.rushAttempts);
    const total = (attempts ?? 0) + (rushes ?? 0);
    result.push({
      season: source.season,
      week: source.week,
      gameId: game.gameId,
      kickoffTime,
      team,
      opponent,
      passRate: total > 0 && attempts !== null ? attempts / total : null,
      defensiveEpaAllowedPerPlay: finiteNumber(source.defensiveEpaAllowedPerPlay),
    });
  }
  return result.sort((a, b) => a.kickoffTime.getTime() - b.kickoffTime.getTime() || a.gameId.localeCompare(b.gameId) || a.team.localeCompare(b.team));
}

export function buildPlayerProjectionScheduleFromTeamGames(input: {
  teamGames: PlayerProjectionRawTeamGame[];
  teams: PlayerProjectionTeam[];
}): PlayerProjectionScheduleGame[] {
  const teamIdByCanonicalAbbreviation = new Map(
    input.teams.map((team) => [canonicalProjectionTeam(team.abbreviation), team.teamId]),
  );
  const grouped = new Map<string, PlayerProjectionRawTeamGame[]>();
  for (const row of input.teamGames) {
    const key = `${row.season}:${row.week}:${row.gameId}`;
    grouped.set(key, [...(grouped.get(key) ?? []), row]);
  }
  const schedule: PlayerProjectionScheduleGame[] = [];
  for (const [key, rows] of grouped) {
    const homeRow = rows.find((row) => row.isHome === true);
    const awayRow = rows.find((row) => row.isHome === false);
    const anchor = homeRow ?? rows[0];
    if (!anchor) continue;
    const homeTeam = canonicalProjectionTeam(homeRow?.teamId ?? (awayRow ? awayRow.opponentTeamId : null));
    const awayTeam = canonicalProjectionTeam(homeRow?.opponentTeamId ?? awayRow?.teamId ?? null);
    const homeTeamId = homeTeam ? teamIdByCanonicalAbbreviation.get(homeTeam) : undefined;
    const awayTeamId = awayTeam ? teamIdByCanonicalAbbreviation.get(awayTeam) : undefined;
    if (!homeTeamId || !awayTeamId) continue;
    const rawDate = anchor.gameDate;
    const dateText = rawDate instanceof Date
      ? rawDate.toISOString().slice(0, 10)
      : typeof rawDate === "string" ? rawDate.slice(0, 10) : null;
    if (!dateText || !/^\d{4}-\d{2}-\d{2}$/.test(dateText)) continue;
    const gameDate = new Date(`${dateText}T00:00:00.000Z`);
    if (!Number.isFinite(gameDate.getTime())) continue;
    const [season, week, ...gameIdParts] = key.split(":");
    schedule.push({
      gameId: gameIdParts.join(":"),
      season: Number(season),
      week: Number(week),
      kickoffTime: null,
      gameDate,
      status: "Final",
      homeTeamId,
      awayTeamId,
      finalHomeScore: null,
      finalAwayScore: null,
      sourceTimeMode: "calendarDateBoundary",
    });
  }
  return schedule.sort((a, b) =>
    (a.gameDate?.getTime() ?? 0) - (b.gameDate?.getTime() ?? 0) || a.gameId.localeCompare(b.gameId));
}

function compareObservations(a: PlayerProjectionObservation, b: PlayerProjectionObservation) {
  return a.kickoffTime.getTime() - b.kickoffTime.getTime()
    || a.gameId.localeCompare(b.gameId)
    || a.playerId.localeCompare(b.playerId)
    || a.team.localeCompare(b.team);
}

function average(values: Array<number | null | undefined>): number | null {
  const finite = values.filter((value): value is number => typeof value === "number" && Number.isFinite(value));
  return finite.length ? finite.reduce((sum, value) => sum + value, 0) / finite.length : null;
}

function targetOf(row: PlayerProjectionObservation, family: PlayerProjectionFamily) {
  return finiteNumber(row[PLAYER_PROJECTION_FAMILIES[family].target]);
}

function volumeOf(row: PlayerProjectionObservation, family: PlayerProjectionFamily) {
  return finiteNumber(row[PLAYER_PROJECTION_FAMILIES[family].volume]);
}

function featuresFor(input: {
  current: PlayerProjectionObservation;
  history: PlayerProjectionObservation[];
  family: PlayerProjectionFamily;
  teamGames: PlayerProjectionTeamGame[];
}): ProjectionExample | null {
  const { current, family } = input;
  const definition = PLAYER_PROJECTION_FAMILIES[family];
  if (!definition.position.includes(current.position)) return null;
  const actual = targetOf(current, family);
  if (actual === null) return null;
  const cutoff = current.kickoffTime.getTime();
  const history = input.history
    .filter((row) => row.playerId === current.playerId && row.kickoffTime.getTime() < cutoff
      && definition.position.includes(row.position) && targetOf(row, family) !== null)
    .sort(compareObservations);
  if (history.length < PLAYER_PROJECTION_CONFIG.minimumPriorAppearances) return null;

  const last3 = history.slice(-3);
  const last5 = history.slice(-5);
  const last8 = history.slice(-8);
  const seasonToDate = history.filter((row) => row.season === current.season);
  const targetRows = (rows: PlayerProjectionObservation[]) => rows.map((row) => targetOf(row, family));
  const volumeRows = (rows: PlayerProjectionObservation[]) => rows.map((row) => volumeOf(row, family));
  const targetLast3 = average(targetRows(last3));
  const targetLast5 = average(targetRows(last5));
  const targetLast8 = average(targetRows(last8));
  const volumeLast3 = average(volumeRows(last3));
  const volumeLast8 = average(volumeRows(last8));
  const allTeamGames = input.teamGames.filter((row) =>
    row.kickoffTime.getTime() < cutoff && row.season === current.season);
  const currentTeamGames = allTeamGames.filter((row) => row.team === current.team);
  const opponentTeamGames = allTeamGames.filter((row) => row.team === current.opponent);
  const priorTeamGame = currentTeamGames.sort((a, b) => b.kickoffTime.getTime() - a.kickoffTime.getTime())[0];
  const restDays = priorTeamGame
    ? (cutoff - priorTeamGame.kickoffTime.getTime()) / 86_400_000
    : null;
  const raw: FeatureValues = {
    priorLast3TargetMean: targetLast3,
    priorLast5TargetMean: last5.length >= 5 ? targetLast5 : null,
    priorLast8TargetMean: last8.length >= 8 ? targetLast8 : null,
    seasonToDateTargetMean: average(targetRows(seasonToDate)),
    priorLast3VolumeMean: volumeLast3,
    priorLast8VolumeMean: last8.length >= 8 ? volumeLast8 : null,
    priorLast3Efficiency: volumeLast3 !== null && volumeLast3 > 0 && targetLast3 !== null ? targetLast3 / volumeLast3 : null,
    priorLast8Efficiency: volumeLast8 !== null && volumeLast8 > 0 && targetLast8 !== null ? targetLast8 / volumeLast8 : null,
    teamSeasonPassRate: average(currentTeamGames.map((row) => row.passRate)),
    opponentSeasonDefensiveEpaAllowed: average(opponentTeamGames.map((row) => row.defensiveEpaAllowedPerPlay)),
    teamRestDays: restDays,
  };
  const missingFeatureNames = CONTINUOUS_FEATURES.filter((name) => raw[name] === null);
  return {
    observation: current,
    family,
    actual,
    volume: volumeLast3,
    priorAppearanceCount: history.length,
    priorAppearanceCutoff: new Date(cutoff - 1).toISOString(),
    featureValues: raw,
    missingFeatureNames: [...missingFeatureNames],
    last3Games: last3.length,
    last5Games: last5.length,
    last8Games: last8.length,
  };
}

function finiteValues(example: ProjectionExample): Array<number | null> {
  return CONTINUOUS_FEATURES.map((name) => example.featureValues[name]);
}

function quantile(values: number[], fraction: number): number | null {
  const ordered = values.filter(Number.isFinite).sort((a, b) => a - b);
  if (!ordered.length) return null;
  return ordered[Math.min(ordered.length - 1, Math.floor((ordered.length - 1) * fraction))]!;
}

function fitRidge(examples: ProjectionExample[], family: PlayerProjectionFamily) {
  if (!examples.length) throw new Error(`No training examples are eligible for ${family}`);
  const columns = CONTINUOUS_FEATURES.length;
  const means = Array.from({ length: columns }, (_, column) =>
    average(examples.map((example) => finiteValues(example)[column])) ?? 0);
  const scales = Array.from({ length: columns }, (_, column) => {
    const values = examples.map((example) => finiteValues(example)[column]).filter((value): value is number => value !== null);
    const mean = means[column]!;
    const variance = values.length ? average(values.map((value) => (value - mean) ** 2)) ?? 0 : 0;
    return Math.sqrt(variance) || 1;
  });
  const dimension = 1 + columns * 2;
  const matrix = Array.from({ length: dimension }, () => Array(dimension).fill(0));
  const vector = Array(dimension).fill(0);
  for (const example of examples) {
    const raw = finiteValues(example);
    const row = [1];
    for (let column = 0; column < columns; column += 1) {
      const value = raw[column];
      row.push(value === null ? 0 : (value - means[column]!) / scales[column]!);
      row.push(value === null ? 1 : 0);
    }
    for (let i = 0; i < dimension; i += 1) {
      vector[i] += row[i]! * example.actual;
      for (let j = 0; j < dimension; j += 1) matrix[i]![j] += row[i]! * row[j]!;
    }
  }
  for (let i = 1; i < dimension; i += 1) matrix[i]![i] += PLAYER_PROJECTION_CONFIG.ridgePenalty;
  const coefficients = solveLinearSystem(matrix, vector);
  const usageVolumes = examples.map((example) => example.volume).filter((value): value is number => value !== null);
  const trainingExamplesSha256 = hash(JSON.stringify(examples.map((example) => ({
    playerId: example.observation.playerId,
    gameId: example.observation.gameId,
    season: example.observation.season,
    actual: example.actual,
    featureValues: example.featureValues,
  }))));
  return {
    modelVersion: `${PLAYER_PROJECTION_VERSION}-${family}-${trainingExamplesSha256.slice(0, 16)}`,
    featureNames: ["intercept", ...CONTINUOUS_FEATURES.flatMap((name) => [`${name}:z`, `${name}:missing`])],
    means,
    scales,
    coefficients,
    trainingExamplesSha256,
    usageThresholds: [quantile(usageVolumes, 1 / 3), quantile(usageVolumes, 2 / 3)] as [number | null, number | null],
  };
}

function solveLinearSystem(matrix: number[][], vector: number[]): number[] {
  const size = vector.length;
  const rows = matrix.map((row, index) => [...row, vector[index]!]);
  for (let column = 0; column < size; column += 1) {
    let pivot = column;
    for (let row = column + 1; row < size; row += 1) {
      if (Math.abs(rows[row]![column]!) > Math.abs(rows[pivot]![column]!)) pivot = row;
    }
    if (Math.abs(rows[pivot]![column]!) < 1e-12) throw new Error("Player projection regression is numerically singular");
    [rows[pivot], rows[column]] = [rows[column]!, rows[pivot]!];
    const divisor = rows[column]![column]!;
    for (let index = column; index <= size; index += 1) rows[column]![index] /= divisor;
    for (let row = 0; row < size; row += 1) {
      if (row === column) continue;
      const factor = rows[row]![column]!;
      for (let index = column; index <= size; index += 1) rows[row]![index] -= factor * rows[column]![index]!;
    }
  }
  return rows.map((row) => row[size]!);
}

function predict(example: ProjectionExample, model: ReturnType<typeof fitRidge>) {
  const raw = finiteValues(example);
  let value = model.coefficients[0]!;
  for (let column = 0; column < raw.length; column += 1) {
    const feature = raw[column];
    value += model.coefficients[1 + column * 2]!
      * (feature === null ? 0 : (feature - model.means[column]!) / model.scales[column]!);
    value += model.coefficients[2 + column * 2]! * (feature === null ? 1 : 0);
  }
  return Math.max(0, value);
}

function confidenceLabel(count: number): "low" | "moderate" | "high" {
  if (count >= 12) return "high";
  if (count >= 6) return "moderate";
  return "low";
}

function metrics(rows: Array<{ actual: number; predicted: number }>): PlayerProjectionMetric {
  if (!rows.length) {
    return {
      sampleSize: 0,
      meanAbsoluteError: null,
      meanAbsoluteError95CI: null,
      rootMeanSquaredError: null,
      rootMeanSquaredError95CI: null,
      meanBias: null,
      meanBias95CI: null,
    };
  }
  const errors = rows.map((row) => row.predicted - row.actual);
  const absoluteErrors = errors.map(Math.abs);
  const squaredErrors = errors.map((error) => error * error);
  const meanError = (values: number[]) => values.reduce((sum, value) => sum + value, 0) / values.length;
  const interval = (values: number[]): [number, number] | null => {
    if (values.length < 2) return null;
    const mean = meanError(values);
    const variance = values.reduce((sum, value) => sum + (value - mean) ** 2, 0) / (values.length - 1);
    const margin = 1.96 * Math.sqrt(variance / values.length);
    return [mean - margin, mean + margin];
  };
  const mae = meanError(absoluteErrors);
  const mse = meanError(squaredErrors);
  const squaredErrorInterval = interval(squaredErrors);
  return {
    sampleSize: rows.length,
    meanAbsoluteError: mae,
    meanAbsoluteError95CI: interval(absoluteErrors),
    rootMeanSquaredError: Math.sqrt(mse),
    rootMeanSquaredError95CI: squaredErrorInterval
      ? [Math.sqrt(Math.max(0, squaredErrorInterval[0])), Math.sqrt(Math.max(0, squaredErrorInterval[1]))]
      : null,
    meanBias: meanError(errors),
    meanBias95CI: interval(errors),
  };
}

function usageBand(volume: number | null, thresholds: [number | null, number | null]) {
  if (volume === null) return null;
  if (thresholds[0] === null || thresholds[1] === null) return "medium" as const;
  if (volume <= thresholds[0]) return "low" as const;
  if (volume <= thresholds[1]) return "medium" as const;
  return "high" as const;
}

function stableValue(value: unknown): unknown {
  if (value instanceof Date) return value.toISOString();
  if (Array.isArray(value)) return value.map(stableValue);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([key, nested]) => [key, stableValue(nested)]));
  }
  return value;
}

export function hash(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

export function runPlayerProjectionEvaluation(input: {
  observations: PlayerProjectionObservation[];
  teamGames: PlayerProjectionTeamGame[];
  provenance: Omit<PlayerProjectionReport["provenance"], "checksumSha256" | "historicalTimestampCaveat"> & {
    checksumSha256?: string;
  };
  generatedAt?: Date;
}): PlayerProjectionReport {
  const observations = [...input.observations].sort(compareObservations);
  if (observations.some((row) => row.season < 2021 || row.season > 2024 || row.seasonType.toUpperCase() !== "REG")) {
    throw new Error("Player projection input must contain only 2021–2024 regular-season rows");
  }
  const modelReports = {} as Record<PlayerProjectionFamily, PlayerProjectionFamilyReport>;
  const predictions: PlayerProjectionPrediction[] = [];
  const families = Object.keys(PLAYER_PROJECTION_FAMILIES) as PlayerProjectionFamily[];
  for (const family of families) {
    const examples: ProjectionExample[] = [];
    const countsByPlayer = new Map<string, PlayerProjectionObservation[]>();
    for (const observation of observations) {
      const definition = PLAYER_PROJECTION_FAMILIES[family];
      if (!definition.position.includes(observation.position) || targetOf(observation, family) === null) continue;
      const playerHistory = countsByPlayer.get(observation.playerId) ?? [];
      const example = featuresFor({ current: observation, history: playerHistory, family, teamGames: input.teamGames });
      countsByPlayer.set(observation.playerId, [...playerHistory, observation]);
      if (example) examples.push(example);
    }
    const training = examples.filter((example) =>
      example.observation.season >= PLAYER_PROJECTION_CONFIG.trainingSeasons[0]
      && example.observation.season <= PLAYER_PROJECTION_CONFIG.trainingSeasons.at(-1)!);
    const evaluation = examples.filter((example) => example.observation.season === PLAYER_PROJECTION_CONFIG.evaluationSeason);
    const candidateCount = observations.filter((row) =>
      row.season === PLAYER_PROJECTION_CONFIG.evaluationSeason
      && PLAYER_PROJECTION_FAMILIES[family].position.includes(row.position)
      && targetOf(row, family) !== null).length;
    const candidatePlayers = new Set(observations.filter((row) =>
      row.season === PLAYER_PROJECTION_CONFIG.evaluationSeason
      && PLAYER_PROJECTION_FAMILIES[family].position.includes(row.position)
      && targetOf(row, family) !== null).map((row) => row.playerId)).size;
    const model = fitRidge(training, family);
    const modelPredictions = evaluation.map((example) => ({ example, prediction: predict(example, model) }));
    const modelMetrics = metrics(modelPredictions.map(({ example, prediction }) => ({ actual: example.actual, predicted: prediction })));
    const compareBaseline = (
      eligible: typeof modelPredictions,
      value: (example: ProjectionExample) => number | null,
    ): PlayerProjectionBaselineComparison => {
      const rows = eligible.flatMap(({ example, prediction }) => {
        const baselinePrediction = value(example);
        return baselinePrediction === null ? [] : [{
          actual: example.actual,
          modelPrediction: prediction,
          baselinePrediction: Math.max(0, baselinePrediction),
        }];
      });
      return {
        baseline: metrics(rows.map(({ actual, baselinePrediction }) => ({ actual, predicted: baselinePrediction }))),
        modelOnSameCohort: metrics(rows.map(({ actual, modelPrediction }) => ({ actual, predicted: modelPrediction }))),
      };
    };
    const last3Comparison = compareBaseline(modelPredictions, (example) => example.featureValues.priorLast3TargetMean);
    const last5Comparison = compareBaseline(modelPredictions, (example) => example.featureValues.priorLast5TargetMean);
    const seasonComparison = compareBaseline(modelPredictions, (example) => example.featureValues.seasonToDateTargetMean);
    const strata = (["low", "medium", "high"] as const).map((band) => {
      const group = modelPredictions.filter(({ example }) => usageBand(example.volume, model.usageThresholds) === band);
      const baselineGroup = group.map(({ example }) => ({
        actual: example.actual,
        predicted: Math.max(0, example.featureValues.priorLast3TargetMean ?? 0),
      }));
      return {
        band,
        trainingVolumeRange: band === "low"
          ? [null, model.usageThresholds[0]] as [number | null, number | null]
          : band === "medium"
            ? [model.usageThresholds[0], model.usageThresholds[1]] as [number | null, number | null]
            : [model.usageThresholds[1], null] as [number | null, number | null],
        sampleSize: group.length,
        modelMae: metrics(group.map(({ example, prediction }) => ({ actual: example.actual, predicted: prediction }))).meanAbsoluteError,
        last3BaselineMae: metrics(baselineGroup).meanAbsoluteError,
      };
    });
    modelReports[family] = {
      label: PLAYER_PROJECTION_FAMILIES[family].label,
      trainingSamples: training.length,
      evaluationCandidates: candidateCount,
      evaluationCandidatePlayers: candidatePlayers,
      eligiblePredictions: evaluation.length,
      eligiblePlayers: new Set(evaluation.map((example) => example.observation.playerId)).size,
      predictionAvailability: candidateCount ? evaluation.length / candidateCount : null,
      minimumPriorAppearances: PLAYER_PROJECTION_CONFIG.minimumPriorAppearances,
      modelVersion: model.modelVersion,
      fittedArtifact: {
        featureNames: model.featureNames,
        standardizedMeans: model.means,
        standardizedScales: model.scales,
        coefficients: model.coefficients,
        ridgePenalty: PLAYER_PROJECTION_CONFIG.ridgePenalty,
        trainingExamplesSha256: model.trainingExamplesSha256,
        trainingUsageVolumeTertiles: model.usageThresholds,
      },
      metrics: modelMetrics,
      baselines: {
        last3AppearanceMean: last3Comparison,
        last5AppearanceMean: last5Comparison,
        seasonToDateMean: seasonComparison,
      },
      usageStrata: strata,
    };
    for (const { example, prediction } of modelPredictions) {
      const observation = example.observation;
      const missingDataWarnings = [...example.missingFeatureNames.map((name) => `Feature unavailable before cutoff: ${name}`)];
      if (example.priorAppearanceCount < 8) missingDataWarnings.push(`Only ${example.priorAppearanceCount} prior appearances; last-eight form is incomplete.`);
      if (example.featureValues.teamSeasonPassRate === null) missingDataWarnings.push("No prior team pass-rate data was available.");
      if (example.featureValues.opponentSeasonDefensiveEpaAllowed === null) missingDataWarnings.push("No prior opponent defensive-efficiency data was available.");
      predictions.push({
        family,
        playerId: observation.playerId,
        player: observation.playerName,
        position: observation.position,
        team: observation.team,
        opponent: observation.opponent,
        season: observation.season,
        week: observation.week,
        gameId: observation.gameId,
        kickoffTime: observation.scheduleTimeSource === "calendarDateBoundary" ? null : observation.kickoffTime.toISOString(),
        gameDate: (observation.gameDate ?? observation.kickoffTime).toISOString(),
        calculationTimestamp: example.priorAppearanceCutoff,
        cutoffBasis: observation.scheduleTimeSource === "calendarDateBoundary"
          ? "calendar_date_boundary"
          : "scheduled_kickoff",
        projectedStatistic: prediction,
        actualStatistic: example.actual,
        last3Baseline: Math.max(0, example.featureValues.priorLast3TargetMean ?? 0),
        last5Baseline: example.featureValues.priorLast5TargetMean === null ? null : Math.max(0, example.featureValues.priorLast5TargetMean),
        seasonToDateBaseline: example.featureValues.seasonToDateTargetMean === null ? null : Math.max(0, example.featureValues.seasonToDateTargetMean),
        modelVersion: model.modelVersion,
        historicalSampleQuality: {
          priorAppearances: example.priorAppearanceCount,
          last3Games: example.last3Games,
          last5Games: example.last5Games,
          last8Games: example.last8Games,
          label: confidenceLabel(example.priorAppearanceCount),
          availableFeatureCount: CONTINUOUS_FEATURES.length - example.missingFeatureNames.length,
          totalFeatureCount: CONTINUOUS_FEATURES.length,
        },
        missingDataWarnings,
        featureValues: example.featureValues,
      });
    }
  }
  predictions.sort((a, b) =>
    a.gameDate.localeCompare(b.gameDate)
      || (a.kickoffTime ?? "").localeCompare(b.kickoffTime ?? "")
      || a.family.localeCompare(b.family)
      || a.playerId.localeCompare(b.playerId));
  const checksumMaterial = {
    observations: observations.map(stableValue),
    teamGames: input.teamGames.map(stableValue),
    config: PLAYER_PROJECTION_CONFIG,
  };
  return {
    version: PLAYER_PROJECTION_VERSION,
    evaluationKind: "historical_simulation",
    generatedAt: (input.generatedAt ?? new Date()).toISOString(),
    config: PLAYER_PROJECTION_CONFIG,
    provenance: {
      ...input.provenance,
      checksumSha256: input.provenance.checksumSha256 ?? hash(JSON.stringify(checksumMaterial)),
      historicalTimestampCaveat: PLAYER_PROJECTION_CONFIG.sourceTimeLimitation,
    },
    modelMethod: {
      name: "Regularized linear regression with chronological lagged features",
      description: "Four independently fitted ridge regressions using only player, team, and opponent observations before each available target-game time boundary. Where only game dates exist, all target-day observations are excluded. Models do not include player IDs, target-game outcomes, sportsbook lines, or future rows.",
      featureNames: ["intercept", ...CONTINUOUS_FEATURES.flatMap((name) => [`${name}:z`, `${name}:missing`])],
      baselineDefinitions: {
        last3AppearanceMean: "Mean target statistic over the player's last 3 prior appearances; baseline and model metrics use the same eligible evaluation rows.",
        last5AppearanceMean: "Mean over the player's last 5 prior appearances; baseline and model metrics use the same rows where all five prior appearances exist.",
        seasonToDateMean: "Mean target statistic over prior appearances in the same season; baseline and model metrics use the same rows where the player has a same-season prior appearance.",
      },
      limitations: [
        "2024 outputs are historical simulations, not live or future-game predictions.",
        "The source extract's original publication timestamp is not independently archived; only game-time chronology is enforced.",
        "Player game rows represent recorded stat lines; unrecorded non-appearances are not synthesized as zero outcomes.",
        "No player identity features are fitted, and career history is grouped by source GSIS player ID.",
        "Prediction intervals and betting profitability are not inferred from these point-forecast metrics.",
        "Team and opponent context is omitted at a row when matching pregame team-game evidence is unavailable.",
      ],
    },
    families: modelReports,
    predictions,
  };
}