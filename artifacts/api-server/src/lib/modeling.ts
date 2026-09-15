import { and, asc, count, desc, eq, inArray, lt } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import {
  db,
  modelEvaluationPredictionsTable,
  pregameTeamFeaturesTable,
  teamGameStatsTable,
  sportsbookOddsTable,
  teamsTable,
  modelTrainingRunsTable,
  playerGameStatsTable,
  type PregameFeatureValues,
} from "@workspace/db";
import { createHash } from "node:crypto";
import { PREGAME_FEATURE_VERSION } from "./features";
import { NFLVERSE_TEAM_ALIASES, normalizeTeamId } from "./personnel-context-derivation";

export type Algorithm = "linear_regression" | "logistic_regression" | "random_forest" | "gradient_boosting";
export type Family = "spread" | "moneyline" | "totals";
export type SamplePolicy = "include_low_sample" | "exclude_low_sample";
export type ProductionCandidateValidation = {
  valid: boolean;
  failures: string[];
  trainingCutoff: string | null;
};
export type Example = {
  gameId: string;
  season: number;
  week: number;
  kickoffTime: Date;
  x: number[];
  lowSample: boolean;
  qbConfidence: number;
  homeTeamId: string;
  awayTeamId: string;
  homeTeamAbbreviation: string;
  awayTeamAbbreviation: string;
  homeFeatureSourceCutoff: Date;
  awayFeatureSourceCutoff: Date;
  actualHomeScore: number;
  actualAwayScore: number;
  gameStage: string;
  margin: number;
  total: number;
  homeWin: number;
};
export type MatrixModel = {
  predict: (x: number[]) => number;
  importance: Record<string, number>;
  artifact: CoreModelArtifact;
};
type CoreModelArtifact =
  | { kind: "linear"; coefficients: number[] }
  | { kind: "logistic"; coefficients: number[] }
  | { kind: "forest"; trees: Node[] }
  | { kind: "boosting"; base: number; trees: Array<{ tree: Node; weight: number }>; classification: boolean };
export type FittedModelArtifact = {
  version: 1;
  algorithm: Algorithm;
  centers: number[];
  scales: number[];
  model: CoreModelArtifact;
};

const TEST_SEASONS = [2022, 2023, 2024, 2025, 2026];
const FEATURE_PREFIXES = ["season_to_date", "last_8", "last_5", "last_3"];
const MAX_FEATURES = 24;
export const PHASE6_SOURCE_FEATURE_NAMES = [
  "last_3.defensive_success_rate", "last_3.epa_per_play", "last_3.explosive_pass_rate", "last_3.explosive_rush_rate",
  "last_3.offensive_success_rate", "last_3.red_zone_touchdown_rate", "last_3.turnover_rate", "last_3.yards_per_play",
  "last_5.defensive_success_rate", "last_5.epa_per_play", "last_5.explosive_pass_rate", "last_5.explosive_rush_rate",
  "last_5.offensive_success_rate", "last_5.red_zone_touchdown_rate", "last_5.turnover_rate", "last_5.yards_per_play",
  "last_8.defensive_success_rate", "last_8.epa_per_play", "last_8.explosive_pass_rate", "last_8.explosive_rush_rate",
  "last_8.offensive_success_rate", "last_8.red_zone_touchdown_rate", "last_8.turnover_rate", "last_8.yards_per_play",
] as const;
export const PHASE6_VECTOR_FEATURE_NAMES = [
  ...PHASE6_SOURCE_FEATURE_NAMES,
  "home_low_sample",
  "away_low_sample",
  "qb_confidence_difference",
] as const;
export function vectorSchemaFingerprint(names: readonly string[]) {
  return createHash("sha256").update(JSON.stringify(names)).digest("hex");
}
export const PHASE6_VECTOR_SCHEMA_FINGERPRINT = vectorSchemaFingerprint(PHASE6_VECTOR_FEATURE_NAMES);
const SUPPORTED_ALGORITHMS: Record<Family, readonly Algorithm[]> = {
  spread: ["linear_regression", "random_forest", "gradient_boosting"],
  moneyline: ["logistic_regression", "random_forest", "gradient_boosting"],
  totals: ["linear_regression", "random_forest", "gradient_boosting"],
};
const PHASE6_ALGORITHMS: Record<Family, Algorithm> = {
  spread: "linear_regression",
  moneyline: "logistic_regression",
  totals: "gradient_boosting",
};
const PHASE6_SAMPLE_POLICIES: Record<Family, SamplePolicy> = {
  spread: "include_low_sample",
  moneyline: "include_low_sample",
  totals: "exclude_low_sample",
};
const PHASE6_TRAINING_SEASONS = [2021, 2022, 2023, 2024, 2025];

export function validateProductionCandidate(
  run: typeof modelTrainingRunsTable.$inferSelect,
): ProductionCandidateValidation {
  const failures: string[] = [];
  const family = run.family as Family;
  const algorithm = run.algorithm as Algorithm;
  const seasons = Array.isArray(run.trainingSeasons) ? run.trainingSeasons : [];
  const sortedSeasons = [...seasons].sort((left, right) => left - right);
  const uniqueSeasons = [...new Set(sortedSeasons)];
  const trainingCutoff = uniqueSeasons.length ? `through-${Math.max(...uniqueSeasons)}` : null;

  if (!Object.hasOwn(SUPPORTED_ALGORITHMS, family)) {
    failures.push(`family "${run.family}" is not supported for production`);
  } else if (!SUPPORTED_ALGORITHMS[family].includes(algorithm)) {
    failures.push(`algorithm "${run.algorithm}" is not supported for the ${run.family} family`);
  }
  if (run.featureVersion !== PREGAME_FEATURE_VERSION) {
    failures.push(`feature version "${run.featureVersion}" does not match ${PREGAME_FEATURE_VERSION}`);
  }
  if (JSON.stringify(run.vectorFeatureNames) !== JSON.stringify(PHASE6_VECTOR_FEATURE_NAMES) ||
      run.vectorSchemaFingerprint !== PHASE6_VECTOR_SCHEMA_FINGERPRINT) {
    failures.push("the ordered Phase 6 vector schema or fingerprint does not match the trained production contract");
  }
  if (!isFittedModelArtifact(run.modelArtifact, PHASE6_VECTOR_FEATURE_NAMES.length)) {
    failures.push("the candidate does not contain an immutable fitted model artifact");
  }
  if (!seasons.length || seasons.some((season) => !Number.isInteger(season) || season < 2021 || season > 2025) || uniqueSeasons.length !== seasons.length) {
    failures.push("training seasons must be unique integer seasons from 2021 through 2025");
  }
  if (run.sampleSize <= 0) failures.push("the candidate must contain at least one training row");

  if (run.status === "refit_candidate") {
    if (!run.modelVersion.startsWith("phase6-refit-")) failures.push("refit candidates must use a phase6-refit model version");
    if (Object.hasOwn(PHASE6_ALGORITHMS, family) && algorithm !== PHASE6_ALGORITHMS[family]) {
      failures.push(`Phase 6 ${family} refits must use ${PHASE6_ALGORITHMS[family]}`);
    }
    if (Object.hasOwn(PHASE6_SAMPLE_POLICIES, family) && run.samplePolicy !== PHASE6_SAMPLE_POLICIES[family]) {
      failures.push(`Phase 6 ${family} refits must use ${PHASE6_SAMPLE_POLICIES[family]}`);
    }
    if (run.recencyWeighting !== "none") failures.push("Phase 6 refits must not use recency weighting");
    if (run.testSeason !== 2025) failures.push("Phase 6 refits must use 2025 as the validation cutoff");
    if (JSON.stringify(sortedSeasons) !== JSON.stringify(PHASE6_TRAINING_SEASONS)) {
      failures.push("Phase 6 refits must be trained on exactly 2021 through 2025");
    }
    if (run.metrics?.outputValidation !== "finite") failures.push("Phase 6 refit output validation must be finite");
  } else if (run.status === "challenger") {
    if (!run.modelVersion.startsWith("phase4-")) failures.push("supported challengers must use a phase4 model version");
    if (!Number.isInteger(run.testSeason) || run.testSeason < 2022 || run.testSeason > 2025) {
      failures.push("supported challengers must have a historical test season from 2022 through 2025");
    }
    if (Number.isInteger(run.testSeason) && uniqueSeasons.some((season) => season >= run.testSeason)) {
      failures.push("challenger training seasons must precede the test season");
    }
  } else {
    failures.push(`status "${run.status}" is not eligible for production promotion`);
  }

  return { valid: failures.length === 0, failures, trainingCutoff };
}

export function mean(values: number[]) {
  return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0;
}
function sigmoid(value: number) {
  return 1 / (1 + Math.exp(-Math.max(-30, Math.min(30, value))));
}
function clamp(value: number, min = 0.001, max = 0.999) {
  return Math.max(min, Math.min(max, value));
}
function rmse(actual: number[], predicted: number[]) {
  return Math.sqrt(mean(actual.map((value, index) => (value - predicted[index]) ** 2)));
}
function mae(actual: number[], predicted: number[]) {
  return mean(actual.map((value, index) => Math.abs(value - predicted[index])));
}
function brier(actual: number[], predicted: number[]) {
  return mean(actual.map((value, index) => (predicted[index] - value) ** 2));
}
function logLoss(actual: number[], predicted: number[]) {
  return -mean(actual.map((value, index) => value * Math.log(clamp(predicted[index])) + (1 - value) * Math.log(clamp(1 - predicted[index]))));
}
export function standardize(train: number[][], test: number[][]) {
  const width = train[0]?.length ?? 0;
  const normalizeRow = (row: number[]) => Array.from(
    { length: width },
    (_, column) => Number.isFinite(row[column]) ? row[column] : 0,
  );
  const safeTrain = train.map(normalizeRow);
  const safeTest = test.map(normalizeRow);
  const centers = Array.from({ length: width }, (_, column) => mean(safeTrain.map((row) => row[column])));
  const scales = centers.map((center, column) => {
    const variance = mean(safeTrain.map((row) => (row[column] - center) ** 2));
    return variance > 1e-9 ? Math.sqrt(variance) : 1;
  });
  const transform = (rows: number[][]) => rows.map((row) => row.map((value, column) => (value - centers[column]) / scales[column]));
  return { train: transform(safeTrain), test: transform(safeTest), centers, scales };
}
function solve(matrix: number[][], target: number[]) {
  const size = target.length;
  const a = matrix.map((row, index) => [...row, target[index]]);
  for (let column = 0; column < size; column += 1) {
    let pivot = column;
    for (let row = column + 1; row < size; row += 1) if (Math.abs(a[row][column]) > Math.abs(a[pivot][column])) pivot = row;
    [a[column], a[pivot]] = [a[pivot], a[column]];
    const divisor = Math.abs(a[column][column]) < 1e-10 ? 1e-10 : a[column][column];
    for (let item = column; item <= size; item += 1) a[column][item] /= divisor;
    for (let row = 0; row < size; row += 1) {
      if (row === column) continue;
      const factor = a[row][column];
      for (let item = column; item <= size; item += 1) a[row][item] -= factor * a[column][item];
    }
  }
  return a.map((row) => row[size]);
}
function ridge(train: number[][], target: number[], lambda: number): MatrixModel {
  const width = train[0]?.length ?? 0;
  const matrix = Array.from({ length: width + 1 }, (_, row) => Array.from({ length: width + 1 }, (_, column) => {
    const value = mean(train.map((item) => (row === 0 ? 1 : item[row - 1]) * (column === 0 ? 1 : item[column - 1])));
    return row === column && row > 0 ? value + lambda : value;
  }));
  const vector = Array.from({ length: width + 1 }, (_, row) => mean(train.map((item, index) => (row === 0 ? 1 : item[row - 1]) * target[index])));
  const coefficients = solve(matrix, vector).map((value) => Number.isFinite(value) ? Math.max(-1000, Math.min(1000, value)) : 0);
  return {
    predict: (row) => coefficients[0] + row.reduce((sum, value, index) => sum + value * coefficients[index + 1], 0),
    importance: Object.fromEntries(coefficients.slice(1).map((value, index) => [`${index}`, Math.abs(value)])),
    artifact: { kind: "linear", coefficients },
  };
}
function logistic(train: number[][], target: number[]): MatrixModel {
  const width = train[0]?.length ?? 0;
  const coefficients = Array(width + 1).fill(0);
  for (let epoch = 0; epoch < 350; epoch += 1) {
    const gradient = Array(width + 1).fill(0);
    train.forEach((row, index) => {
      const prediction = sigmoid(coefficients[0] + row.reduce((sum, value, column) => sum + value * coefficients[column + 1], 0));
      const error = prediction - target[index];
      gradient[0] += error;
      row.forEach((value, column) => { gradient[column + 1] += error * value + 0.02 * coefficients[column + 1]; });
    });
    const rate = 0.08 / Math.max(1, train.length);
    gradient.forEach((value, index) => {
      const next = coefficients[index] - rate * value;
      coefficients[index] = Number.isFinite(next) ? Math.max(-30, Math.min(30, next)) : 0;
    });
  }
  return {
    predict: (row) => sigmoid(coefficients[0] + row.reduce((sum, value, index) => sum + value * coefficients[index + 1], 0)),
    importance: Object.fromEntries(coefficients.slice(1).map((value, index) => [`${index}`, Math.abs(value)])),
    artifact: { kind: "logistic", coefficients },
  };
}

type Node = { feature?: number; threshold?: number; value: number; left?: Node; right?: Node };
function fitTree(rows: number[][], target: number[], classification: boolean, depth: number, importance: number[]): Node {
  const value = mean(target);
  if (depth <= 0 || rows.length < 12 || new Set(target).size === 1) return { value } as Node;
  let best: { score: number; feature: number; threshold: number; left: number[]; right: number[] } | null = null;
  const width = rows[0]?.length ?? 0;
  for (let feature = 0; feature < width; feature += 1) {
    const threshold = mean(rows.map((row) => row[feature]));
    for (const candidateThreshold of [threshold]) {
      const left = rows.map((row, index) => row[feature] <= candidateThreshold ? index : -1).filter((index) => index >= 0);
      const right = rows.map((row, index) => row[feature] > candidateThreshold ? index : -1).filter((index) => index >= 0);
      if (left.length < 5 || right.length < 5) continue;
      const score = (indices: number[]) => {
        const bucket = indices.map((index) => target[index]);
        return bucket.reduce((sum, item) => sum + (item - mean(bucket)) ** 2, 0);
      };
      const candidateScore = score(left) + score(right);
      if (!best || candidateScore < best.score) best = { score: candidateScore, feature, threshold: candidateThreshold, left, right };
    }
  }
  if (!best) return { value } as Node;
  importance[best.feature] += 1;
  return {
    feature: best.feature,
    threshold: best.threshold,
    value,
    left: fitTree(best.left.map((index) => rows[index]), best.left.map((index) => target[index]), classification, depth - 1, importance),
    right: fitTree(best.right.map((index) => rows[index]), best.right.map((index) => target[index]), classification, depth - 1, importance),
  };
}
function predictTree(node: Node, row: number[]): number {
  if (node.feature === undefined || !node.left || !node.right) return node.value;
  return predictTree(row[node.feature] <= (node.threshold ?? 0) ? node.left : node.right, row);
}
function forest(train: number[][], target: number[], classification: boolean): MatrixModel {
  const trees: Node[] = [];
  const importance = Array(train[0]?.length ?? 0).fill(0);
  let seed = 17;
  for (let tree = 0; tree < 4; tree += 1) {
    const rows: number[][] = [];
    const values: number[] = [];
    for (let index = 0; index < train.length; index += 1) {
      seed = (seed * 9301 + 49297) % 233280;
      const pick = Math.floor((seed / 233280) * train.length);
      rows.push(train[pick]);
      values.push(target[pick]);
    }
    trees.push(fitTree(rows, values, classification, 2, importance));
  }
  return {
    predict: (row) => mean(trees.map((tree) => predictTree(tree, row))),
    importance: Object.fromEntries(importance.map((value, index) => [`${index}`, value])),
    artifact: { kind: "forest", trees },
  };
}
function boosting(train: number[][], target: number[], classification: boolean): MatrixModel {
  const base = classification ? mean(target) : mean(target);
  let prediction = target.map(() => base);
  const trees: Array<{ tree: Node; weight: number }> = [];
  const importance = Array(train[0]?.length ?? 0).fill(0);
  for (let round = 0; round < 8; round += 1) {
    const residual = target.map((value, index) => value - prediction[index]);
    const tree = fitTree(train, residual, classification, 2, importance);
    const weight = 0.08;
    trees.push({ tree, weight });
    prediction = prediction.map((value, index) => value + weight * predictTree(tree, train[index]));
  }
  return {
    predict: (row) => {
      const value = base + trees.reduce((sum, item) => sum + item.weight * predictTree(item.tree, row), 0);
      return classification ? clamp(value) : value;
    },
    importance: Object.fromEntries(importance.map((value, index) => [`${index}`, value])),
    artifact: { kind: "boosting", base, trees, classification },
  };
}

export function isFittedModelArtifact(value: unknown, width: number): value is FittedModelArtifact {
  if (!value || typeof value !== "object") return false;
  const artifact = value as Partial<FittedModelArtifact>;
  const nodeValid = (node: unknown): node is Node => {
    if (!node || typeof node !== "object") return false;
    const candidate = node as Node;
    if (!Number.isFinite(candidate.value)) return false;
    if (candidate.feature === undefined) return true;
    return Number.isInteger(candidate.feature)
      && candidate.feature >= 0
      && candidate.feature < width
      && Number.isFinite(candidate.threshold)
      && nodeValid(candidate.left)
      && nodeValid(candidate.right);
  };
  const model = artifact.model;
  const modelValid = Boolean(model && (
    ((model.kind === "linear" || model.kind === "logistic")
      && Array.isArray(model.coefficients)
      && model.coefficients.length === width + 1
      && model.coefficients.every(Number.isFinite))
    || (model.kind === "forest" && Array.isArray(model.trees) && model.trees.length > 0 && model.trees.every(nodeValid))
    || (model.kind === "boosting"
      && Number.isFinite(model.base)
      && typeof model.classification === "boolean"
      && Array.isArray(model.trees)
      && model.trees.length > 0
      && model.trees.every((item) => Number.isFinite(item.weight) && nodeValid(item.tree)))
  ));
  const algorithmMatches = Boolean(model && (
    (artifact.algorithm === "linear_regression" && model.kind === "linear")
    || (artifact.algorithm === "logistic_regression" && model.kind === "logistic")
    || (artifact.algorithm === "random_forest" && model.kind === "forest")
    || (artifact.algorithm === "gradient_boosting" && model.kind === "boosting")
  ));
  return artifact.version === 1
    && typeof artifact.algorithm === "string"
    && Array.isArray(artifact.centers)
    && artifact.centers.length === width
    && artifact.centers.every(Number.isFinite)
    && Array.isArray(artifact.scales)
    && artifact.scales.length === width
    && artifact.scales.every((scale) => Number.isFinite(scale) && scale > 0)
    && modelValid
    && algorithmMatches;
}

export function predictFittedModelArtifact(artifact: FittedModelArtifact, row: number[]) {
  if (!isFittedModelArtifact(artifact, row.length) || !row.every(Number.isFinite)) return null;
  const scaled = row.map((value, index) => (value - artifact.centers[index]) / artifact.scales[index]);
  const model = artifact.model;
  let value: number;
  if (model.kind === "linear") {
    value = model.coefficients[0] + scaled.reduce((sum, item, index) => sum + item * model.coefficients[index + 1], 0);
  } else if (model.kind === "logistic") {
    value = sigmoid(model.coefficients[0] + scaled.reduce((sum, item, index) => sum + item * model.coefficients[index + 1], 0));
  } else if (model.kind === "forest") {
    value = mean(model.trees.map((tree) => predictTree(tree, scaled)));
  } else {
    const raw = model.base + model.trees.reduce((sum, item) => sum + item.weight * predictTree(item.tree, scaled), 0);
    value = model.classification ? clamp(raw) : raw;
  }
  return Number.isFinite(value) ? value : null;
}
function calibration(actual: number[], predicted: number[]) {
  const buckets = Array.from({ length: 10 }, (_, index) => ({
    label: `${index * 10}-${index === 9 ? 100 : index * 10 + 9}%`,
    min: index / 10,
    max: index === 9 ? 1.01 : (index + 1) / 10,
  }));
  return buckets.map((bucket) => {
    const items = predicted.map((value, index) => ({ value, actual: actual[index] })).filter((item) => item.value >= bucket.min && item.value < bucket.max);
    return { bucket: bucket.label, predictedProbability: items.length ? mean(items.map((item) => item.value)) : null, actualRate: items.length ? mean(items.map((item) => item.actual)) : null, predictions: items.length };
  });
}
function normalizeImportance(values: Record<string, number>, names: string[]) {
  const total = Object.values(values).reduce((sum, value) => sum + value, 0) || 1;
  return Object.fromEntries(Object.entries(values).map(([key, value]) => [names[Number(key)] ?? key, value / total]));
}
export function modelFor(algorithm: Algorithm, train: number[][], target: number[], classification: boolean) {
  if (algorithm === "linear_regression") return ridge(train, target, 1);
  if (algorithm === "logistic_regression") return logistic(train, target);
  if (algorithm === "random_forest") return forest(train, target, classification);
  return boosting(train, target, classification);
}
export function sourceFeatureNames(rows: Array<{ features: PregameFeatureValues }>) {
  const counts = new Map<string, number>();
  for (const row of rows) for (const [key, value] of Object.entries(row.features)) {
    if (FEATURE_PREFIXES.some((prefix) => key.startsWith(`${prefix}.`)) && typeof value === "number" && Number.isFinite(value)) counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return [...counts.entries()].filter(([, count]) => count >= 25).sort((left, right) => right[1] - left[1]).slice(0, MAX_FEATURES).map(([key]) => key).sort();
}

export function trainingVectorForRows(
  home: { features: PregameFeatureValues; lowSample: boolean },
  away: { features: PregameFeatureValues; lowSample: boolean },
  names: readonly string[] = PHASE6_SOURCE_FEATURE_NAMES,
) {
  const differences: number[] = [];
  for (const name of names) {
    const homeValue = home.features[name];
    const awayValue = away.features[name];
    if (typeof homeValue !== "number" || !Number.isFinite(homeValue) ||
        typeof awayValue !== "number" || !Number.isFinite(awayValue)) return null;
    differences.push(homeValue - awayValue);
  }
  const homeQb = home.features.qb_data_confidence;
  const awayQb = away.features.qb_data_confidence;
  if (typeof homeQb !== "number" || !Number.isFinite(homeQb) ||
      typeof awayQb !== "number" || !Number.isFinite(awayQb)) return null;
  return [...differences, home.lowSample ? 1 : 0, away.lowSample ? 1 : 0, homeQb - awayQb];
}

export async function loadExamples(featureVersion: string) {
  const rows = await db.select().from(pregameTeamFeaturesTable).where(eq(pregameTeamFeaturesTable.featureVersion, featureVersion));
  const [stats, gameStages, teams] = await Promise.all([
    db.select({ gameId: teamGameStatsTable.gameId, teamId: teamGameStatsTable.teamId, teamScore: teamGameStatsTable.teamScore, opponentScore: teamGameStatsTable.opponentScore }).from(teamGameStatsTable),
    db.selectDistinct({
      season: playerGameStatsTable.season,
      week: playerGameStatsTable.week,
      teamId: playerGameStatsTable.teamId,
      opponentTeamId: playerGameStatsTable.opponentTeamId,
      seasonType: playerGameStatsTable.seasonType,
    }).from(playerGameStatsTable),
    db.select({ teamId: teamsTable.teamId, abbreviation: teamsTable.abbreviation }).from(teamsTable),
  ]);
  const abbreviationByTeamId = new Map(teams.map((team) => [team.teamId, team.abbreviation]));
  const teamByAbbreviation = new Map(teams.map((team) => [team.abbreviation.toUpperCase(), team.teamId]));
  for (const [source, canonical] of Object.entries(NFLVERSE_TEAM_ALIASES)) {
    const teamId = teamByAbbreviation.get(canonical)
      ?? (canonical === "WAS" ? teamByAbbreviation.get("WSH") : undefined);
    if (teamId) teamByAbbreviation.set(source, teamId);
  }
  const scoreByTeamGame = new Map(stats.map((row) => [
    `${row.gameId}:${normalizeTeamId(row.teamId, teamByAbbreviation)}`,
    row,
  ]));
  const stageByMatchup = new Map(gameStages.map((row) => [
    `${row.season}:${row.week}:${row.teamId ?? ""}:${row.opponentTeamId ?? ""}`,
    row.seasonType,
  ]));
  const names = [...PHASE6_SOURCE_FEATURE_NAMES];
  const grouped = new Map<string, typeof rows>();
  for (const row of rows) grouped.set(row.gameId, [...(grouped.get(row.gameId) ?? []), row]);
  const examples: Example[] = [];
  let skippedIncompleteInputs = 0;
  for (const gameRows of grouped.values()) {
    const home = gameRows.find((row) => row.isHome);
    const away = gameRows.find((row) => !row.isHome);
    if (!home || !away) continue;
    const homeScore = scoreByTeamGame.get(`${home.gameId}:${home.teamId}`)?.teamScore;
    const awayScore = scoreByTeamGame.get(`${away.gameId}:${away.teamId}`)?.teamScore;
    if (homeScore === null || homeScore === undefined || awayScore === null || awayScore === undefined) continue;
    const vector = trainingVectorForRows(home, away, names);
    if (!vector) {
      skippedIncompleteInputs += 1;
      continue;
    }
    const homeQb = home.features.qb_data_confidence as number;
    const awayQb = away.features.qb_data_confidence as number;
    examples.push({
      gameId: home.gameId,
      season: home.season,
      week: home.week,
      kickoffTime: home.kickoffTime,
      x: vector,
      lowSample: home.lowSample || away.lowSample,
      qbConfidence: (homeQb + awayQb) / 2,
      homeTeamId: home.teamId,
      awayTeamId: away.teamId,
      homeTeamAbbreviation: abbreviationByTeamId.get(home.teamId) ?? home.teamId,
      awayTeamAbbreviation: abbreviationByTeamId.get(away.teamId) ?? away.teamId,
      homeFeatureSourceCutoff: home.sourceCutoff,
      awayFeatureSourceCutoff: away.sourceCutoff,
      actualHomeScore: homeScore,
      actualAwayScore: awayScore,
      gameStage: stageByMatchup.get(`${home.season}:${home.week}:${home.teamId}:${home.opponentTeamId}`) ?? "unknown",
      margin: homeScore - awayScore,
      total: homeScore + awayScore,
      homeWin: homeScore > awayScore ? 1 : 0,
    });
  }
  return {
    examples,
    names: [...PHASE6_VECTOR_FEATURE_NAMES],
    diagnostics: { skippedIncompleteInputs },
  };
}

function buildMetrics(family: Family, actual: number[], predicted: number[], examples: Example[]) {
  if (family === "moneyline") {
    const accuracy = mean(actual.map((value, index) => (predicted[index] >= 0.5 ? 1 : 0) === value ? 1 : 0));
    return { accuracy, logLoss: logLoss(actual, predicted), brierScore: brier(actual, predicted), calibration: calibration(actual, predicted), sampleSize: actual.length };
  }
  return { mae: mae(actual, predicted), rmse: rmse(actual, predicted), sampleSize: actual.length, lowQbMae: mae(actual.filter((_, index) => examples[index].qbConfidence < 0.75), predicted.filter((_, index) => examples[index].qbConfidence < 0.75)), highQbMae: mae(actual.filter((_, index) => examples[index].qbConfidence >= 0.75), predicted.filter((_, index) => examples[index].qbConfidence >= 0.75)) };
}

function applyRecencyWeighting(rows: Example[], weighting: string) {
  if (weighting === "none" || !rows.length) return rows;
  const latestSeason = Math.max(...rows.map((row) => row.season));
  const multiplier = weighting === "recent_2x" ? 2 : 1.5;
  const recent = rows.filter((row) => row.season === latestSeason);
  return [...rows, ...recent.slice(0, Math.ceil(recent.length * (multiplier - 1)))];
}

type ModelEvaluationBundle = {
  run: typeof modelTrainingRunsTable.$inferInsert;
  evidence: Array<typeof modelEvaluationPredictionsTable.$inferInsert>;
};

type MarketEvidenceItem = {
  sportsbook: string;
  market: string;
  selection: string;
  point: number | null;
  price: number;
  observedAt: string;
};

function assertMarketEvidence(
  items: MarketEvidenceItem[] | null | undefined,
  earliest: Date | null,
  latest: Date,
  label: string,
) {
  for (const item of items ?? []) {
    const observedAt = new Date(item.observedAt);
    if (!item.sportsbook || !item.market || !item.selection || !Number.isInteger(item.price)
      || !Number.isFinite(observedAt.getTime())
      || (earliest ? observedAt < earliest : observedAt >= latest)
      || observedAt >= latest) {
      throw new Error(`Invalid ${label} market evidence`);
    }
  }
}

export function assertCompleteModelEvaluationBundle(bundle: ModelEvaluationBundle) {
  if (bundle.evidence.length !== bundle.run.sampleSize) {
    throw new Error(
      `Incomplete model evaluation evidence for ${bundle.run.modelVersion}: expected ${bundle.run.sampleSize}, received ${bundle.evidence.length}`,
    );
  }
  const gameIds = new Set(bundle.evidence.map((row) => row.gameId));
  if (gameIds.size !== bundle.evidence.length) {
    throw new Error(`Duplicate game evidence for ${bundle.run.modelVersion}`);
  }
  if (bundle.evidence.some((row) => row.modelVersion !== bundle.run.modelVersion)) {
    throw new Error(`Mismatched game evidence for ${bundle.run.modelVersion}`);
  }
  const runSeasons = JSON.stringify([...(bundle.run.trainingSeasons ?? [])].sort());
  const evaluationRunIds = new Set(bundle.evidence.map((row) => row.evaluationRunId));
  if (evaluationRunIds.size !== 1 || !bundle.evidence[0]?.evaluationRunId) {
    throw new Error(`Inconsistent evaluation run identity for ${bundle.run.modelVersion}`);
  }
  for (const row of bundle.evidence) {
    if (!row.evaluationRunId || !row.homeTeamId || !row.awayTeamId || row.homeTeamId === row.awayTeamId) {
      throw new Error(`Incomplete game identity evidence for ${bundle.run.modelVersion}`);
    }
    if (row.family !== bundle.run.family || row.algorithm !== bundle.run.algorithm
      || row.featureVersion !== bundle.run.featureVersion || row.testSeason !== bundle.run.testSeason
      || JSON.stringify([...(row.trainingSeasons ?? [])].sort()) !== runSeasons) {
      throw new Error(`Inconsistent run provenance for ${bundle.run.modelVersion}`);
    }
    const kickoff = new Date(row.kickoffTime);
    const cutoff = new Date(row.predictionCutoff);
    const homeCutoff = new Date(row.homeFeatureSourceCutoff);
    const awayCutoff = new Date(row.awayFeatureSourceCutoff);
    if (!(homeCutoff < cutoff) || !(awayCutoff < cutoff) || cutoff > kickoff) {
      throw new Error(`Invalid evidence chronology for ${bundle.run.modelVersion}`);
    }
    if (row.actualMargin !== row.actualHomeScore - row.actualAwayScore
      || row.actualTotal !== row.actualHomeScore + row.actualAwayScore
      || row.actualHomeWin !== (row.actualHomeScore > row.actualAwayScore ? 1 : 0)) {
      throw new Error(`Inconsistent outcome evidence for ${bundle.run.modelVersion}`);
    }
    if ((row.family === "spread" && row.projectedMargin == null)
      || (row.family === "totals" && row.projectedTotal == null)
      || (row.family === "moneyline"
        && (row.projectedHomeWinProbability == null || row.projectedAwayWinProbability == null))) {
      throw new Error(`Incomplete projection evidence for ${bundle.run.modelVersion}`);
    }
    if (row.family === "moneyline"
      && (row.projectedHomeWinProbability! < 0 || row.projectedHomeWinProbability! > 1
        || row.projectedAwayWinProbability! < 0 || row.projectedAwayWinProbability! > 1
        || Math.abs(row.projectedHomeWinProbability! + row.projectedAwayWinProbability! - 1) > 1e-9)) {
      throw new Error(`Invalid probability projection evidence for ${bundle.run.modelVersion}`);
    }
    if (row.marketObservedAt && !["home", "away", "over", "under"].includes(row.marketSide ?? "")) {
      throw new Error(`Missing canonical market side for ${bundle.run.modelVersion}`);
    }
    assertMarketEvidence(row.marketEvidence as MarketEvidenceItem[] | null, null, cutoff, "prediction-time");
    assertMarketEvidence(row.closingMarketEvidence as MarketEvidenceItem[] | null, cutoff, kickoff, "closing");
  }
}

export async function persistModelEvaluationBundles(bundles: ModelEvaluationBundle[]) {
  for (const bundle of bundles) assertCompleteModelEvaluationBundle(bundle);
  const evaluationRunIds = new Set(bundles.map((bundle) => bundle.evidence[0]?.evaluationRunId));
  if (evaluationRunIds.size > 1) {
    throw new Error("Evaluation bundles must share one evaluation run identity");
  }
  await db.transaction(async (tx) => {
    for (const bundle of bundles) {
      await tx.insert(modelTrainingRunsTable).values(bundle.run);
      for (let index = 0; index < bundle.evidence.length; index += 500) {
        await tx.insert(modelEvaluationPredictionsTable).values(bundle.evidence.slice(index, index + 500));
      }
    }
  });
}

export async function trainPhase4Models(featureVersion = PREGAME_FEATURE_VERSION) {
  const { examples, names } = await loadExamples(featureVersion);
  const evaluatedGameIds = [...new Set(examples.filter((example) => TEST_SEASONS.includes(example.season)).map((example) => example.gameId))];
  const historicalOdds = evaluatedGameIds.length
    ? await db.select().from(sportsbookOddsTable)
      .where(inArray(sportsbookOddsTable.gameId, evaluatedGameIds))
      .orderBy(asc(sportsbookOddsTable.capturedAt), asc(sportsbookOddsTable.id))
    : [];
  const oddsByGame = new Map<string, typeof historicalOdds>();
  for (const quote of historicalOdds) {
    const quotes = oddsByGame.get(quote.gameId);
    if (quotes) quotes.push(quote);
    else oddsByGame.set(quote.gameId, [quote]);
  }
  const availableSeasons = TEST_SEASONS.filter((season) => examples.some((example) => example.season === season));
  const evaluationRunId = `phase4-evaluation-${randomUUID()}`;
  const runs: ModelEvaluationBundle[] = [];
  const families: Array<{ family: Family; algorithms: Algorithm[]; target: (example: Example) => number; classification: boolean }> = [
    { family: "spread", algorithms: ["linear_regression", "random_forest", "gradient_boosting"], target: (example) => example.margin, classification: false },
    { family: "moneyline", algorithms: ["logistic_regression", "random_forest", "gradient_boosting"], target: (example) => example.homeWin, classification: true },
    { family: "totals", algorithms: ["linear_regression", "random_forest", "gradient_boosting"], target: (example) => example.total, classification: false },
  ];
  for (const testSeason of availableSeasons) {
    const trainingSeasons = [...new Set(examples.filter((example) => example.season < testSeason).map((example) => example.season))].sort();
    if (!trainingSeasons.length) continue;
    for (const samplePolicy of ["include_low_sample", "exclude_low_sample"] as SamplePolicy[]) {
      const trainRows = examples.filter((example) => trainingSeasons.includes(example.season) && (samplePolicy === "include_low_sample" || !example.lowSample));
      const testRows = examples.filter((example) => example.season === testSeason && (samplePolicy === "include_low_sample" || !example.lowSample));
      if (trainRows.length < 20 || testRows.length < 5) continue;
      const scaled = standardize(trainRows.map((row) => row.x), testRows.map((row) => row.x));
      for (const config of families) {
        for (const algorithm of config.algorithms) {
          for (const recencyWeighting of ["none", "recent_1.5x", "recent_2x"]) {
            const weightedTrainRows = applyRecencyWeighting(trainRows, recencyWeighting);
            const weightedScaled = standardize(weightedTrainRows.map((row) => row.x), testRows.map((row) => row.x));
            const target = weightedTrainRows.map(config.target);
            const actual = testRows.map(config.target);
            const model = modelFor(algorithm, weightedScaled.train, target, config.classification);
            const predicted = weightedScaled.test.map((row) => config.classification ? clamp(model.predict(row)) : model.predict(row));
            const metrics = buildMetrics(config.family, actual, predicted, testRows);
            const modelVersion = `phase4-${config.family}-${algorithm}-${testSeason}-${samplePolicy}-${recencyWeighting}-${Date.now()}-${runs.length}`;
            const trainingCutoff = `through-${Math.max(...trainingSeasons)}`;
            const run = {
              modelVersion,
              family: config.family,
              algorithm,
              featureVersion,
              trainingSeasons,
              testSeason,
              samplePolicy,
              recencyWeighting,
              status: "challenger",
              sampleSize: testRows.length,
              metrics,
              calibration: (config.classification ? calibration(actual, predicted) : { status: "not_applicable" }) as unknown as Record<string, unknown>,
              featureImportance: normalizeImportance(model.importance, names),
              vectorFeatureNames: [...PHASE6_VECTOR_FEATURE_NAMES],
              vectorSchemaFingerprint: PHASE6_VECTOR_SCHEMA_FINGERPRINT,
              modelArtifact: {
                version: 1,
                algorithm,
                centers: weightedScaled.centers,
                scales: weightedScaled.scales,
                model: model.artifact,
              } satisfies FittedModelArtifact,
              notes: "Chronological walk-forward evaluation with a controlled recency-weighting challenger variant. No automatic promotion. Betting performance is unavailable unless a legitimate pre-prediction sportsbook line exists.",
            } satisfies typeof modelTrainingRunsTable.$inferInsert;
            const evidence = testRows.map((example, index) => {
              const marketName = config.family === "totals" ? "total" : config.family;
              const gameQuotes = oddsByGame.get(example.gameId) ?? [];
              const predictionCutoff = new Date(Math.max(
                example.homeFeatureSourceCutoff.getTime(),
                example.awayFeatureSourceCutoff.getTime(),
              ) + 1);
              const quote = gameQuotes
                .filter((candidate) => candidate.market === marketName && candidate.capturedAt < predictionCutoff)
                .at(-1);
              const marketSide = !quote ? null
                : quote.market === "total"
                  ? quote.selection.toLowerCase() === "over" ? "over" : quote.selection.toLowerCase() === "under" ? "under" : null
                  : quote.selection.toUpperCase() === example.homeTeamAbbreviation.toUpperCase() ? "home"
                    : quote.selection.toUpperCase() === example.awayTeamAbbreviation.toUpperCase() ? "away"
                      : null;
              const latestEvidenceBetween = (after: Date | null, cutoff: Date) => {
                const latest = new Map<string, typeof gameQuotes[number]>();
                for (const candidate of gameQuotes) {
                  if (candidate.capturedAt >= cutoff || (after && candidate.capturedAt < after)) continue;
                  const key = `${candidate.sportsbook}:${candidate.market}:${candidate.selection}`;
                  latest.set(key, candidate);
                }
                return [...latest.values()].map((candidate) => ({
                  sportsbook: candidate.sportsbook,
                  market: candidate.market,
                  selection: candidate.selection,
                  point: candidate.point,
                  price: candidate.price,
                  observedAt: candidate.capturedAt.toISOString(),
                }));
              };
              return {
                evaluationRunId,
                modelVersion,
                family: config.family,
                algorithm,
                featureVersion,
                testSeason,
                week: example.week,
                evaluationStage: "season_holdout",
                gameId: example.gameId,
                kickoffTime: example.kickoffTime,
                predictionCutoff,
                trainingSeasons,
                trainingCutoff,
                gameStage: example.gameStage,
                homeTeamId: example.homeTeamId,
                awayTeamId: example.awayTeamId,
                homeFeatureSourceCutoff: example.homeFeatureSourceCutoff,
                awayFeatureSourceCutoff: example.awayFeatureSourceCutoff,
                lowSample: example.lowSample,
                predictedValue: predicted[index],
                actualValue: actual[index],
                actualHomeScore: example.actualHomeScore,
                actualAwayScore: example.actualAwayScore,
                actualMargin: example.margin,
                actualTotal: example.total,
                actualHomeWin: example.homeWin,
                projectedHomeWinProbability: config.family === "moneyline" ? predicted[index] : null,
                projectedAwayWinProbability: config.family === "moneyline" ? 1 - predicted[index] : null,
                projectedMargin: config.family === "spread" ? predicted[index] : null,
                projectedTotal: config.family === "totals" ? predicted[index] : null,
                marketSportsbook: quote?.sportsbook ?? null,
                marketName: quote?.market ?? null,
                marketSelection: quote?.selection ?? null,
                marketSide,
                marketPoint: quote?.point ?? null,
                marketPrice: quote?.price ?? null,
                marketObservedAt: quote?.capturedAt ?? null,
                marketEvidence: latestEvidenceBetween(null, predictionCutoff),
                closingMarketEvidence: latestEvidenceBetween(predictionCutoff, example.kickoffTime),
              };
            });
            runs.push({ run, evidence });
          }
        }
      }
    }
  }
  await persistModelEvaluationBundles(runs);
  return { featureVersion, examples: examples.length, runsCreated: runs.length, testSeasons: availableSeasons, bettingEvaluation: { status: "unavailable", reason: "Historical DraftKings/FanDuel snapshots are insufficient for a complete pre-prediction market evaluation; no lines were fabricated." } };
}

export type EvaluationAuditFilters = {
  evaluationRunId?: string;
  modelVersion?: string;
  family?: Family;
  testSeason?: number;
  week?: number;
  gameId?: string;
  limit?: number;
  cursor?: number;
};

export async function getModelEvaluationAudit(filters: EvaluationAuditFilters = {}, maximumLimit = 1000) {
  const baseConditions = [
    filters.evaluationRunId ? eq(modelEvaluationPredictionsTable.evaluationRunId, filters.evaluationRunId) : undefined,
    filters.modelVersion ? eq(modelEvaluationPredictionsTable.modelVersion, filters.modelVersion) : undefined,
    filters.family ? eq(modelEvaluationPredictionsTable.family, filters.family) : undefined,
    filters.testSeason ? eq(modelEvaluationPredictionsTable.testSeason, filters.testSeason) : undefined,
    filters.week ? eq(modelEvaluationPredictionsTable.week, filters.week) : undefined,
    filters.gameId ? eq(modelEvaluationPredictionsTable.gameId, filters.gameId) : undefined,
  ].filter((condition): condition is NonNullable<typeof condition> => Boolean(condition));
  const conditions = filters.cursor
    ? [...baseConditions, lt(modelEvaluationPredictionsTable.id, filters.cursor)]
    : baseConditions;
  const limit = Math.max(1, Math.min(maximumLimit, Math.floor(filters.limit ?? 250)));
  const [rows, totalResult] = await Promise.all([
    db.select().from(modelEvaluationPredictionsTable)
    .where(conditions.length ? and(...conditions) : undefined)
    .orderBy(desc(modelEvaluationPredictionsTable.id))
    .limit(limit + 1),
    db.select({ value: count() }).from(modelEvaluationPredictionsTable)
      .where(baseConditions.length ? and(...baseConditions) : undefined),
  ]);
  const hasMore = rows.length > limit;
  const page = rows.slice(0, limit);
  return {
    status: page.length ? "measured" : "unavailable",
    rows: page,
    total: totalResult[0]?.value ?? 0,
    hasMore,
    nextCursor: hasMore ? page.at(-1)?.id ?? null : null,
    immutable: true,
    readOnly: true,
    note: page.length
      ? "Stored evaluation-time evidence only. This read did not train, refit, generate, promote, or change a production model."
      : "No game-level evidence is stored for the requested run. Legacy aggregate runs, including existing 2025 results, are not backfilled or reconstructed.",
  };
}

type EvaluationEvidenceRow = typeof modelEvaluationPredictionsTable.$inferSelect;

export function summarizeModelEvaluationEvidence(rows: EvaluationEvidenceRow[]) {
  const byModel = new Map<string, EvaluationEvidenceRow[]>();
  for (const row of rows) byModel.set(row.modelVersion, [...(byModel.get(row.modelVersion) ?? []), row]);
  const models = [...byModel.entries()].map(([modelVersion, values]) => {
    const family = values[0].family as Family;
    const errors = values.map((row) => row.predictedValue - row.actualValue);
    const summary = family === "moneyline"
      ? {
          accuracy: mean(values.map((row) => (row.predictedValue >= 0.5 ? 1 : 0) === row.actualValue ? 1 : 0)),
          brierScore: brier(values.map((row) => row.actualValue), values.map((row) => row.predictedValue)),
          logLoss: logLoss(values.map((row) => row.actualValue), values.map((row) => row.predictedValue)),
          calibration: calibration(values.map((row) => row.actualValue), values.map((row) => row.predictedValue)),
        }
      : { mae: mean(errors.map(Math.abs)), rmse: Math.sqrt(mean(errors.map((value) => value ** 2))) };
    const edgeRows = values.flatMap((row) => {
      if (family === "moneyline" || row.marketPoint == null || !row.marketSide) return [];
      let edge: number | null = null;
      if (family === "spread") {
        if (row.marketSide === "home") edge = row.predictedValue + row.marketPoint;
        if (row.marketSide === "away") edge = row.marketPoint - row.predictedValue;
      } else {
        if (row.marketSide === "over") edge = row.predictedValue - row.marketPoint;
        if (row.marketSide === "under") edge = row.marketPoint - row.predictedValue;
      }
      return edge == null ? [] : [{ edge, error: Math.abs(row.predictedValue - row.actualValue) }];
    });
    const edgeBuckets = [
      { label: "0-2", min: 0, max: 2 },
      { label: "2-5", min: 2, max: 5 },
      { label: "5+", min: 5, max: Number.POSITIVE_INFINITY },
    ].map((bucket) => {
      const bucketRows = edgeRows.filter((row) => Math.abs(row.edge) >= bucket.min && Math.abs(row.edge) < bucket.max);
      return {
        bucket: bucket.label,
        sampleSize: bucketRows.length,
        meanAbsoluteError: bucketRows.length ? mean(bucketRows.map((row) => row.error)) : null,
      };
    });
    return {
      modelVersion,
      family,
      sampleSize: values.length,
      ...summary,
      edgeAnalysis: edgeRows.length
        ? { status: "measured", sampleSize: edgeRows.length, meanAbsoluteError: mean(edgeRows.map((row) => row.error)), meanEdge: mean(edgeRows.map((row) => row.edge)), buckets: edgeBuckets }
        : { status: "unavailable", reason: "No legitimate prediction-time market evidence supports edge analysis." },
    };
  });
  const cumulative = [...byModel.entries()].flatMap(([modelVersion, values]) => {
    const ordered = [...values].sort((a, b) => a.testSeason - b.testSeason || a.week - b.week || a.gameId.localeCompare(b.gameId));
    return ordered.map((row, index) => ({
      testSeason: row.testSeason,
      week: row.week,
      gameId: row.gameId,
      modelVersion,
      sampleSize: index + 1,
      metric: row.family === "moneyline" ? "brierScore" : "meanAbsoluteError",
      score: mean(ordered.slice(0, index + 1).map((item) => row.family === "moneyline"
        ? (item.predictedValue - item.actualValue) ** 2
        : Math.abs(item.predictedValue - item.actualValue))),
    }));
  });
  const comparisons = [...byModel.entries()].flatMap(([leftVersion, leftRows], leftIndex, entries) =>
    entries.slice(leftIndex + 1).flatMap(([rightVersion, rightRows]) => {
      if (leftRows[0].family !== rightRows[0].family) return [];
      const rightByGame = new Map(rightRows.map((row) => [row.gameId, row]));
      const paired = leftRows.flatMap((left) => {
        const right = rightByGame.get(left.gameId);
        return right ? [{ left, right }] : [];
      });
      if (!paired.length) return [];
      const probability = leftRows[0].family === "moneyline";
      const leftErrors = paired.map(({ left }) => probability
        ? (left.predictedValue - left.actualValue) ** 2
        : Math.abs(left.predictedValue - left.actualValue));
      const rightErrors = paired.map(({ right }) => probability
        ? (right.predictedValue - right.actualValue) ** 2
        : Math.abs(right.predictedValue - right.actualValue));
      return [{
        family: leftRows[0].family,
        metric: probability ? "brierScore" : "meanAbsoluteError",
        leftModelVersion: leftVersion,
        rightModelVersion: rightVersion,
        pairedSampleSize: paired.length,
        leftScore: mean(leftErrors),
        rightScore: mean(rightErrors),
        scoreDelta: mean(leftErrors) - mean(rightErrors),
      }];
    }),
  );
  return {
    status: rows.length ? "measured" : "unavailable",
    sampleSize: rows.length,
    models,
    cumulative,
    comparison: comparisons.length
      ? { status: "measured", pairs: comparisons }
      : { status: "unavailable", reason: "At least two same-family retained model runs with overlapping games are required." },
  };
}

export async function getModelEvaluationReport(filters: EvaluationAuditFilters = {}) {
  const reportRowLimit = 10_000;
  const audit = await getModelEvaluationAudit({ ...filters, cursor: undefined, limit: reportRowLimit }, reportRowLimit);
  if (audit.total > reportRowLimit) throw new Error("Evaluation report exceeds the 10000-row bound; narrow the season, week, game, run, family, or model filters.");
  return { filters, ...summarizeModelEvaluationEvidence(audit.rows) };
}

export async function refitPhase6ProductionModels(featureVersion = PREGAME_FEATURE_VERSION) {
  const { examples, names } = await loadExamples(featureVersion);
  const trainingSeasons = [...new Set(examples.map((example) => example.season).filter((season) => season >= 2021 && season <= 2025))].sort();
  const forwardSeasonsPresent = [...new Set(examples.map((example) => example.season).filter((season) => season >= 2026))].sort();
  const selected: Array<{ family: Family; algorithm: Algorithm; samplePolicy: SamplePolicy; target: (example: Example) => number; classification: boolean }> = [
    { family: "spread", algorithm: "linear_regression", samplePolicy: "include_low_sample", target: (example) => example.margin, classification: false },
    { family: "moneyline", algorithm: "logistic_regression", samplePolicy: "include_low_sample", target: (example) => example.homeWin, classification: true },
    { family: "totals", algorithm: "gradient_boosting", samplePolicy: "exclude_low_sample", target: (example) => example.total, classification: false },
  ];
  const runs: Array<typeof modelTrainingRunsTable.$inferInsert> = [];
  for (const config of selected) {
    const rows = examples.filter((example) =>
      trainingSeasons.includes(example.season) &&
      (config.samplePolicy === "include_low_sample" || !example.lowSample),
    );
    if (rows.length < 20) continue;
    const scaled = standardize(rows.map((row) => row.x), rows.map((row) => row.x));
    const model = modelFor(config.algorithm, scaled.train, rows.map(config.target), config.classification);
    const trainingPredictions = scaled.test.map((row) => model.predict(row));
    const finiteOutputs = trainingPredictions.every(Number.isFinite);
    if (!finiteOutputs) continue;
    const modelVersion = `phase6-refit-${config.family}-${config.algorithm}-through-2025-${Date.now()}-${runs.length}`;
    runs.push({
      modelVersion,
      family: config.family,
      algorithm: config.algorithm,
      featureVersion,
      trainingSeasons,
      testSeason: 2025,
      samplePolicy: config.samplePolicy,
      recencyWeighting: "none",
      status: "refit_candidate",
      sampleSize: rows.length,
      metrics: {
        status: "training_only",
        trainingSampleSize: rows.length,
        outputValidation: finiteOutputs ? "finite" : "failed",
        forwardSeasonsExcluded: forwardSeasonsPresent,
      },
      calibration: config.classification ? { status: "training_only", note: "No 2026 outcomes were used for refit or calibration." } : { status: "not_applicable" },
      featureImportance: normalizeImportance(model.importance, names),
      vectorFeatureNames: [...PHASE6_VECTOR_FEATURE_NAMES],
      vectorSchemaFingerprint: PHASE6_VECTOR_SCHEMA_FINGERPRINT,
      modelArtifact: {
        version: 1,
        algorithm: config.algorithm,
        centers: scaled.centers,
        scales: scaled.scales,
        model: model.artifact,
      } satisfies FittedModelArtifact,
      notes: "Phase 6 production refit of the unchanged selected Phase 4 algorithm using legitimate 2021-2025 data only. 2026 remains forward/out-of-sample. Administrator promotion required.",
    });
  }
  for (let index = 0; index < runs.length; index += 200) await db.insert(modelTrainingRunsTable).values(runs.slice(index, index + 200));
  return {
    featureVersion,
    trainingSeasons,
    forwardSeasonsExcluded: forwardSeasonsPresent,
    runsCreated: runs.length,
    candidates: runs.map((run) => ({ modelVersion: run.modelVersion, family: run.family, algorithm: run.algorithm, samplePolicy: run.samplePolicy, trainingSeasons: run.trainingSeasons, status: run.status })),
    promotion: { required: true, automatic: false },
  };
}

export async function getPhase4ModelLab() {
  const runs = await db.select().from(modelTrainingRunsTable).orderBy(asc(modelTrainingRunsTable.family), asc(modelTrainingRunsTable.testSeason), asc(modelTrainingRunsTable.algorithm));
  const latest = new Map<string, typeof runs[number]>();
  for (const run of runs) {
    const key = `${run.family}:${run.algorithm}:${run.testSeason}:${run.samplePolicy}:${run.recencyWeighting}:${run.status}`;
    const previous = latest.get(key);
    if (!previous || run.trainedAt > previous.trainedAt) latest.set(key, run);
  }
  const current = [...latest.values()];
  const recommendation = (family: Family) => {
    const candidates = current.filter((run) => run.family === family && run.status === "challenger" && run.testSeason < 2026);
    const groups = new Map<string, typeof candidates>();
    for (const run of candidates) {
      const key = `${run.algorithm}:${run.samplePolicy}:${run.recencyWeighting}`;
      groups.set(key, [...(groups.get(key) ?? []), run]);
    }
    const aggregates = [...groups.values()].filter((group) => group.length >= 3).map((group) => {
      const representative = group[group.length - 1];
      const averageMetric = (key: string) => mean(group.map((run) => Number(run.metrics[key] ?? Number.POSITIVE_INFINITY)));
      return {
        ...representative,
        testSeason: null,
        trainingSeasons: [...new Set(group.flatMap((run) => run.trainingSeasons))].sort(),
        sampleSize: group.reduce((sum, run) => sum + run.sampleSize, 0),
        testSeasons: group.map((run) => run.testSeason).sort(),
        metrics: family === "moneyline"
          ? { accuracy: averageMetric("accuracy"), logLoss: averageMetric("logLoss"), brierScore: averageMetric("brierScore"), sampleSize: group.reduce((sum, run) => sum + run.sampleSize, 0) }
          : { mae: averageMetric("mae"), rmse: averageMetric("rmse"), sampleSize: group.reduce((sum, run) => sum + run.sampleSize, 0) },
        notes: `${group.length}-season historical average across test seasons ${group.map((run) => run.testSeason).join(", ")}. The current season is displayed separately and is not used for candidate selection.`,
      };
    });
    if (!aggregates.length) return null;
    const score = (run: (typeof aggregates)[number]) => family === "moneyline"
      ? Number(run.metrics.logLoss ?? Number.POSITIVE_INFINITY)
      : Number(run.metrics.mae ?? Number.POSITIVE_INFINITY);
    return aggregates.reduce((best, run) => score(run) < score(best) ? run : best);
  };
  return {
    featureVersion: PREGAME_FEATURE_VERSION,
    runs: current,
    recommendations: {
      spread: recommendation("spread"),
      moneyline: recommendation("moneyline"),
      totals: recommendation("totals"),
    },
    promotion: { automatic: false, status: "challenger_only", note: "No candidate is active until explicitly promoted by an administrator." },
    refitCandidates: current.filter((run) => run.status === "refit_candidate").map((run) => ({
      modelVersion: run.modelVersion,
      family: run.family,
      algorithm: run.algorithm,
      samplePolicy: run.samplePolicy,
      trainingSeasons: run.trainingSeasons,
      trainingCutoff: run.trainingSeasons.length ? `through-${Math.max(...run.trainingSeasons)}` : "unavailable",
      sampleSize: run.sampleSize,
      notes: run.notes,
    })),
    marketEvaluation: { status: "unavailable", reason: "Complete legitimate historical sportsbook lines are not available; ATS/Over-Under betting performance is not inferred." },
  };
}