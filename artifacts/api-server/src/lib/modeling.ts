import { and, asc, eq } from "drizzle-orm";
import {
  db,
  pregameTeamFeaturesTable,
  teamGameStatsTable,
  sportsbookOddsTable,
  modelTrainingRunsTable,
  type PregameFeatureValues,
} from "@workspace/db";
import { PREGAME_FEATURE_VERSION } from "./features";

export type Algorithm = "linear_regression" | "logistic_regression" | "random_forest" | "gradient_boosting";
export type Family = "spread" | "moneyline" | "totals";
export type SamplePolicy = "include_low_sample" | "exclude_low_sample";
export type Example = {
  gameId: string;
  season: number;
  week: number;
  kickoffTime: Date;
  x: number[];
  lowSample: boolean;
  qbConfidence: number;
  margin: number;
  total: number;
  homeWin: number;
};
export type MatrixModel = {
  predict: (x: number[]) => number;
  importance: Record<string, number>;
};

const TEST_SEASONS = [2022, 2023, 2024, 2025, 2026];
const FEATURE_PREFIXES = ["season_to_date", "last_8", "last_5", "last_3"];
const MAX_FEATURES = 24;

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
  return { train: transform(safeTrain), test: transform(safeTest) };
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
  };
}
function calibration(actual: number[], predicted: number[]) {
  const buckets = [
    { label: "50-54%", min: 0.5, max: 0.55 },
    { label: "55-59%", min: 0.55, max: 0.6 },
    { label: "60-64%", min: 0.6, max: 0.65 },
    { label: "65-69%", min: 0.65, max: 0.7 },
    { label: "70%+", min: 0.7, max: 1.01 },
  ];
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

export async function loadExamples(featureVersion: string) {
  const rows = await db.select().from(pregameTeamFeaturesTable).where(eq(pregameTeamFeaturesTable.featureVersion, featureVersion));
  const stats = await db.select({ gameId: teamGameStatsTable.gameId, teamId: teamGameStatsTable.teamId, teamScore: teamGameStatsTable.teamScore, opponentScore: teamGameStatsTable.opponentScore }).from(teamGameStatsTable);
  const scoreByTeamGame = new Map(stats.map((row) => [`${row.gameId}:${row.teamId}`, row]));
  const names = sourceFeatureNames(rows);
  const grouped = new Map<string, typeof rows>();
  for (const row of rows) grouped.set(row.gameId, [...(grouped.get(row.gameId) ?? []), row]);
  const examples: Example[] = [];
  for (const gameRows of grouped.values()) {
    const home = gameRows.find((row) => row.isHome);
    const away = gameRows.find((row) => !row.isHome);
    if (!home || !away) continue;
    const homeScore = scoreByTeamGame.get(`${home.gameId}:${home.teamId}`)?.teamScore;
    const awayScore = scoreByTeamGame.get(`${away.gameId}:${away.teamId}`)?.teamScore;
    if (homeScore === null || homeScore === undefined || awayScore === null || awayScore === undefined) continue;
    const features = names.map((name) => {
      const homeValue = home.features[name];
      const awayValue = away.features[name];
      return typeof homeValue === "number" && Number.isFinite(homeValue) && typeof awayValue === "number" && Number.isFinite(awayValue) ? homeValue - awayValue : 0;
    });
    const homeQb = typeof home.features["qb_data_confidence"] === "number" && Number.isFinite(home.features["qb_data_confidence"]) ? home.features["qb_data_confidence"] : 0;
    const awayQb = typeof away.features["qb_data_confidence"] === "number" && Number.isFinite(away.features["qb_data_confidence"]) ? away.features["qb_data_confidence"] : 0;
    examples.push({
      gameId: home.gameId,
      season: home.season,
      week: home.week,
      kickoffTime: home.kickoffTime,
    x: [...features, home.lowSample ? 1 : 0, away.lowSample ? 1 : 0, homeQb - awayQb],
      lowSample: home.lowSample || away.lowSample,
      qbConfidence: (homeQb + awayQb) / 2,
      margin: homeScore - awayScore,
      total: homeScore + awayScore,
      homeWin: homeScore > awayScore ? 1 : 0,
    });
  }
  return { examples, names: [...names, "home_low_sample", "away_low_sample", "qb_confidence_difference"] };
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

export async function trainPhase4Models(featureVersion = PREGAME_FEATURE_VERSION) {
  const { examples, names } = await loadExamples(featureVersion);
  const availableSeasons = TEST_SEASONS.filter((season) => examples.some((example) => example.season === season));
  const runs: Array<typeof modelTrainingRunsTable.$inferInsert> = [];
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
            runs.push({
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
              notes: "Chronological walk-forward evaluation with a controlled recency-weighting challenger variant. No automatic promotion. Betting performance is unavailable unless a legitimate pre-prediction sportsbook line exists.",
            });
          }
        }
      }
    }
  }
  for (let index = 0; index < runs.length; index += 200) await db.insert(modelTrainingRunsTable).values(runs.slice(index, index + 200));
  return { featureVersion, examples: examples.length, runsCreated: runs.length, testSeasons: availableSeasons, bettingEvaluation: { status: "unavailable", reason: "Historical DraftKings/FanDuel snapshots are insufficient for a complete pre-prediction market evaluation; no lines were fabricated." } };
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
    const key = `${run.family}:${run.algorithm}:${run.testSeason}:${run.samplePolicy}:${run.recencyWeighting}`;
    const previous = latest.get(key);
    if (!previous || run.trainedAt > previous.trainedAt) latest.set(key, run);
  }
  const current = [...latest.values()];
  const recommendation = (family: Family) => {
    const candidates = current.filter((run) => run.family === family && run.testSeason < 2026);
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