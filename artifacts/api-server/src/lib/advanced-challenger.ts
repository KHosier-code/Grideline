import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { db, marketBaselineEventsTable, marketBaselineQuotesTable, marketBaselineRunsTable, modelEvaluationPredictionsTable, pregameTeamFeaturesTable } from "@workspace/db";
import { eq, desc } from "drizzle-orm";
import {
  loadExamples,
  mean,
  modelFor,
  standardize,
  type Algorithm,
  type Example,
  type Family,
} from "./modeling";
import { MARKET_EDGE_BUCKETS, americanOddsProfit, settleSpread, settleTotal, matchHistoricalMarketGame, parseNflDataMarketCsv, qualify2025MarketSource, sourceFingerprint, type HistoricalMarketQuote } from "./market-baseline";
import { fetch2025MarketSource } from "./market-baseline-run";
import { assertModelFittingAllowed } from "./model-runtime-policy";
import {
  buildCurrentComparableBaselineCandidate,
  verifyComparableBaselineOrThrow,
} from "./shadow-baseline-manifest";

export const ADVANCED_CHALLENGER_VERSION = "advanced-challenger-v1";
export const ADVANCED_TRAINING_SEASONS = [2021, 2022, 2023, 2024] as const;
export const ADVANCED_TEST_SEASON = 2025;
export const ADVANCED_EXCLUDED_SEASONS = [2026] as const;
export const ADVANCED_FEATURE_FAMILIES = [
  "team_form", "opponent_adjustment", "early_down", "qb_context", "explosives",
  "sacks", "pace", "red_zone", "schedule", "personnel", "market",
] as const;
export type AdvancedFeatureFamily = typeof ADVANCED_FEATURE_FAMILIES[number];
export type ChallengerConcept = "independent_football" | "market_residual";
export type ChallengerVerdict = "MATERIAL IMPROVEMENT" | "NO MATERIAL IMPROVEMENT" | "WORSE THAN BASELINE";
export type AdvancedAlgorithm = Algorithm | "elastic_net";

export type AdvancedRow = Example & {
  featureNames?: string[];
  sourceFeatureNames?: string[];
  featureFamilies?: AdvancedFeatureFamily[];
  marketQuotes?: HistoricalMarketQuote[];
  featureCutoff?: Date;
  coverage?: Record<string, number>;
};

export function selectLockedBaselinePredictions(
  rows: Array<{ family: string; modelVersion: string; testSeason: number; gameId: string; predictedValue: number }>,
  versions: Partial<Record<Family, string>>,
) {
  const result = new Map<Family, Record<string, number>>();
  for (const family of ["spread", "moneyline", "totals"] as Family[]) {
    const version = versions[family];
    if (!version) continue;
    const selected = rows.filter((row) => row.family === family && row.modelVersion === version && row.testSeason === 2025);
    const values: Record<string, number> = {};
    let valid = true;
    for (const row of selected) {
      if (!Number.isFinite(row.predictedValue) || values[row.gameId] !== undefined) { valid = false; break; }
      values[row.gameId] = row.predictedValue;
    }
    if (valid && selected.length) result.set(family, values);
  }
  return result;
}

export function applyReferenceAvailability<T extends Record<string, unknown>>(
  model: T,
  input: { hasPairedPredictions: boolean; aggregateSourceComparable: boolean },
) {
  if (input.hasPairedPredictions || input.aggregateSourceComparable) return model;
  return {
    ...model,
    verdict: "NO MATERIAL IMPROVEMENT" as const,
    verdictStatus: "non_comparable_reference_source_drift",
    verdictExplanation: "The current qualified source fingerprint differs from the retained Phase 6.1 baseline source, so no comparative improvement claim is made.",
    comparisonMode: "non_comparable_aggregate",
  };
}

export const ADVANCED_POLICY = {
  version: ADVANCED_CHALLENGER_VERSION,
  trainingSeasons: [...ADVANCED_TRAINING_SEASONS],
  testSeason: ADVANCED_TEST_SEASON,
  excludedSeasons: [...ADVANCED_EXCLUDED_SEASONS],
  chronology: "All features and market evidence must be strictly before kickoff; no future season is eligible.",
  concepts: {
    independent_football: "Uses reconstructable football evidence only. Market and present-day personnel evidence are unavailable.",
    market_residual: "Uses source-designated recorded market evidence as a separate residual model. It is not a closing-line, CLV, or production model.",
  },
  unsupportedFamilies: {
    personnel: "unavailable: no point-in-time personnel evidence is imputed by this runner",
    market: "unavailable to independent concept; available only to residual concept when source-designated recorded quotes are complete",
  },
  edgeBuckets: MARKET_EDGE_BUCKETS.map((bucket) => bucket.label),
  verdictRule: "At least 30 paired holdout rows and a full descriptive 95% interval beyond 1% of baseline primary error are required.",
} as const;

const FAMILY_FOR_METRIC = (name: string): AdvancedFeatureFamily => {
  if (name.includes("opponent_adjusted")) return "opponent_adjustment";
  if (name.includes("early_down")) return "early_down";
  if (name.startsWith("qb.")) return "qb_context";
  if (name.includes("explosive")) return "explosives";
  if (name.includes("sack")) return "sacks";
  if (name.includes("seconds_per_play")) return "pace";
  if (name.includes("red_zone")) return "red_zone";
  return "team_form";
};

/** Builds paired home-minus-away vectors from cutoff-safe persisted features. */
export async function loadAdvancedRows(featureVersion = "pregame-v3", suppliedExamples?: Example[]): Promise<AdvancedRow[]> {
  const [{ examples }, featureRows] = await Promise.all([
    suppliedExamples ? Promise.resolve({ examples: suppliedExamples }) : loadExamples(featureVersion),
    db.select().from(pregameTeamFeaturesTable).where(eq(pregameTeamFeaturesTable.featureVersion, featureVersion)),
  ]);
  const byGame = new Map<string, typeof featureRows>();
  for (const feature of featureRows) byGame.set(feature.gameId, [...(byGame.get(feature.gameId) ?? []), feature]);
  return examples.filter((row) => row.season >= 2021 && row.season <= 2025).flatMap((row) => {
    const paired = byGame.get(row.gameId) ?? [];
    const home = paired.find((item) => item.isHome);
    const away = paired.find((item) => !item.isHome);
    if (!home || !away) return [];
    const names = [...new Set([...Object.keys(home.features), ...Object.keys(away.features)])]
      .filter((name) => !name.startsWith("market.") && !/personnel|injury|depth|starter/i.test(name)).sort();
    const values: number[] = [];
    const coverage: Record<string, number> = {};
    for (const name of names) {
      const left = home.features[name], right = away.features[name];
      const available = typeof left === "number" && Number.isFinite(left) && typeof right === "number" && Number.isFinite(right);
      values.push(available ? left - right : 0);
      coverage[`${name}.available`] = available ? 1 : 0;
      values.push(available ? 1 : 0);
    }
    const featureNames = names.flatMap((name) => {
      const family = FAMILY_FOR_METRIC(name);
      return [`${family}.${name}`, `${family}.${name}.available`];
    });
    const prior = featureRows.filter((item) => item.kickoffTime < row.kickoffTime && (item.teamId === home.teamId || item.teamId === away.teamId))
      .sort((a, b) => b.kickoffTime.getTime() - a.kickoffTime.getTime());
    const previousByTeam = new Map<string, Date>();
    for (const item of prior) if (!previousByTeam.has(item.teamId)) previousByTeam.set(item.teamId, item.kickoffTime);
    const homeRest = previousByTeam.get(home.teamId) ? (home.kickoffTime.getTime() - previousByTeam.get(home.teamId)!.getTime()) / 86400000 : null;
    const awayRest = previousByTeam.get(away.teamId) ? (away.kickoffTime.getTime() - previousByTeam.get(away.teamId)!.getTime()) / 86400000 : null;
    const scheduleValues = [home.isHome ? 1 : 0, homeRest !== null && awayRest !== null ? homeRest - awayRest : 0, homeRest !== null && awayRest !== null ? 1 : 0];
    values.push(...scheduleValues);
    featureNames.push("schedule.home_indicator", "schedule.rest_days_difference", "schedule.available");
    return [{ ...row, x: values, featureNames, featureFamilies: [...new Set(names.map(FAMILY_FOR_METRIC)), "schedule"], sourceFeatureNames: names, featureCutoff: new Date(Math.min(home.sourceCutoff.getTime(), away.sourceCutoff.getTime())), coverage }];
  });
}

export function canonicalAdvancedJson(value: unknown): string {
  if (value instanceof Date) return JSON.stringify(value.toISOString());
  if (Array.isArray(value)) return `[${value.map(canonicalAdvancedJson).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value as Record<string, unknown>).sort().map((key) =>
      `${JSON.stringify(key)}:${canonicalAdvancedJson((value as Record<string, unknown>)[key])}`).join(",")}}`;
  }
  return JSON.stringify(value) ?? "null";
}
function hash(value: unknown) {
  return createHash("sha256").update(canonicalAdvancedJson(value)).digest("hex");
}
function clamp(value: number) { return Math.max(0.001, Math.min(0.999, value)); }
function wilson(wins: number, trials: number) {
  if (!trials) return { low: null, high: null };
  const z = 1.959963984540054, p = wins / trials, denominator = 1 + z ** 2 / trials;
  const center = (p + z ** 2 / (2 * trials)) / denominator;
  const margin = z * Math.sqrt((p * (1 - p) + z ** 2 / (4 * trials)) / trials) / denominator;
  return { low: Math.max(0, center - margin), high: Math.min(1, center + margin) };
}
function interval(values: number[]) {
  if (!values.length) return { sampleSize: 0, mean: null, low: null, high: null };
  const average = mean(values);
  if (values.length < 2) return { sampleSize: 1, mean: average, low: null, high: null };
  const variance = values.reduce((sum, value) => sum + (value - average) ** 2, 0) / (values.length - 1);
  const margin = 1.96 * Math.sqrt(variance / values.length);
  return { sampleSize: values.length, mean: average, low: average - margin, high: average + margin };
}

function solve(matrix: number[][], target: number[]) {
  const size = target.length, a = matrix.map((row, index) => [...row, target[index]]);
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
/** Deterministic coordinate-descent elastic net; lambda is precommitted, never tuned on holdout. */
export function fitElasticNet(train: number[][], target: number[], classification = false) {
  const width = train[0]?.length ?? 0, coefficients = Array(width + 1).fill(0);
  const alpha = 0.5, lambda = 0.05, rate = 0.04 / Math.max(1, train.length);
  for (let epoch = 0; epoch < 450; epoch += 1) {
    const gradient = Array(width + 1).fill(0);
    train.forEach((row, index) => {
      const raw = coefficients[0] + row.reduce((sum, value, column) => sum + value * coefficients[column + 1], 0);
      const prediction = classification ? 1 / (1 + Math.exp(-Math.max(-30, Math.min(30, raw)))) : raw;
      const error = prediction - target[index];
      gradient[0] += error;
      row.forEach((value, column) => { gradient[column + 1] += error * value + lambda * (1 - alpha) * coefficients[column + 1]; });
    });
    gradient.forEach((value, index) => {
      if (!index) coefficients[index] -= rate * value;
      else {
        const raw = coefficients[index] - rate * value;
        const shrink = rate * lambda * alpha;
        coefficients[index] = Math.sign(raw) * Math.max(0, Math.abs(raw) - shrink);
      }
      coefficients[index] = Math.max(-1000, Math.min(1000, coefficients[index]));
    });
  }
  return {
    predict: (row: number[]) => {
      const raw = coefficients[0] + row.reduce((sum, value, index) => sum + value * coefficients[index + 1], 0);
      return classification ? clamp(1 / (1 + Math.exp(-Math.max(-30, Math.min(30, raw))))) : raw;
    },
    coefficients,
  };
}

function target(row: AdvancedRow, family: Family) { return family === "spread" ? row.margin : family === "totals" ? row.total : row.homeWin; }
function metrics(family: Family, rows: AdvancedRow[], predictions: number[]) {
  const actual = rows.map((row) => target(row, family));
  if (family === "moneyline") {
    return {
      sampleSize: rows.length,
      accuracy: rows.length ? mean(actual.map((value, index) => (predictions[index] >= 0.5 ? 1 : 0) === value ? 1 : 0)) : null,
      brierScore: rows.length ? mean(actual.map((value, index) => (predictions[index] - value) ** 2)) : null,
      logLoss: rows.length ? -mean(actual.map((value, index) => value * Math.log(clamp(predictions[index])) + (1 - value) * Math.log(clamp(1 - predictions[index])))) : null,
    };
  }
  const errors = predictions.map((value, index) => value - actual[index]);
  return { sampleSize: rows.length, mae: errors.length ? mean(errors.map(Math.abs)) : null, rmse: errors.length ? Math.sqrt(mean(errors.map((value) => value ** 2))) : null };
}

function marketBenchmark(family: Family, rows: AdvancedRow[]) {
  const predictions = rows.flatMap((row) => {
    const quotes = row.marketQuotes ?? [];
    if (family === "spread") { const quote = quotes.find((item) => item.family === "spread" && item.side === "home"); return quote?.point == null ? [] : [{ row, prediction: -quote.point }]; }
    if (family === "totals") { const quote = quotes.find((item) => item.family === "totals" && item.side === "over"); return quote?.point == null ? [] : [{ row, prediction: quote.point }]; }
    const home = quotes.find((item) => item.family === "moneyline" && item.side === "home"), away = quotes.find((item) => item.family === "moneyline" && item.side === "away");
    const implied = (price: number | null) => price === null ? null : price > 0 ? 100 / (price + 100) : -price / (-price + 100);
    const h = implied(home?.price ?? null), a = implied(away?.price ?? null);
    return h === null || a === null ? [] : [{ row, prediction: h / (h + a) }];
  });
  return { designation: "source-designated recorded; not verified closing", ...metrics(family, predictions.map((item) => item.row), predictions.map((item) => item.prediction)) };
}

export function marketEvidenceSummary(family: Family, rows: AdvancedRow[], predictions: number[]) {
  const buckets = family === "moneyline"
    ? [{ label: "<2pp", min: 0, max: 0.02 }, { label: "2-4.99pp", min: 0.02, max: 0.05 }, { label: "5-9.99pp", min: 0.05, max: 0.1 }, { label: ">=10pp", min: 0.1, max: Number.POSITIVE_INFINITY }]
    : MARKET_EDGE_BUCKETS;
  const selections = rows.flatMap((row, index) => {
    const quotes = (row.marketQuotes ?? []).filter((quote) => quote.family === family);
    const home = quotes.find((quote) => quote.side === "home"), away = quotes.find((quote) => quote.side === "away");
    const over = quotes.find((quote) => quote.side === "over"), under = quotes.find((quote) => quote.side === "under");
    const implied = (price: number | null) => price === null || price === 0 ? null : price > 0 ? 100 / (price + 100) : -price / (-price + 100);
    const hp = implied(home?.price ?? null), ap = implied(away?.price ?? null);
    const marketExpected = family === "spread" ? (home?.point == null ? null : -home.point)
      : family === "totals" ? (over?.point ?? null) : hp === null || ap === null ? null : hp / (hp + ap);
    if (marketExpected === null) return [];
    const edge = predictions[index] - marketExpected;
    const side = family === "spread" ? (edge >= 0 ? "home" : "away") : family === "totals" ? (edge >= 0 ? "over" : "under") : edge >= 0 ? "home" : "away";
    const selected = side === "home" ? home : side === "away" ? away : side === "over" ? over : under;
    if (!selected || (family !== "moneyline" && selected.point === null)) return [];
    const settlement = family === "spread"
      ? settleSpread(row.margin, selected.point, side as "home" | "away")
      : family === "totals" ? settleTotal(row.total, selected.point, side as "over" | "under")
        : (side === "home" ? row.homeWin === 1 : row.homeWin === 0) ? "win" : "loss";
    const profit = americanOddsProfit(selected.price);
    return [{ edge, settlement, side, price: selected.price, profit }];
  });
  return buckets.map((bucket) => {
    const bucketRows = selections.filter((item) => Math.abs(item.edge) >= bucket.min && Math.abs(item.edge) < bucket.max);
    const graded = bucketRows.filter((item) => item.settlement === "win" || item.settlement === "loss");
    const wins = graded.filter((item) => item.settlement === "win").length;
    const returns = bucketRows.flatMap((item) => item.profit === null ? [] : [item.settlement === "win" ? item.profit : item.settlement === "push" ? 0 : -1]);
    return {
      bucket: bucket.label, sampleSize: bucketRows.length, gradedSampleSize: graded.length, wins,
      losses: graded.length - wins, winRate: graded.length ? wins / graded.length : null,
      confidenceInterval95: wilson(wins, graded.length),
      return: returns.length === bucketRows.length && returns.length ? { status: "available", units: returns.reduce((a, b) => a + b, 0), roi: mean(returns) } : { status: "unavailable", reason: "A complete valid recorded price is required; no closing-line or CLV claim is made." },
    };
  });
}

export function overallMarketSummary(family: Family, rows: AdvancedRow[], predictions: number[]) {
  const buckets = marketEvidenceSummary(family, rows, predictions);
  const activeBuckets = buckets.filter((bucket) => bucket.sampleSize > 0);
  const wins = buckets.reduce((sum, bucket) => sum + bucket.wins, 0);
  const losses = buckets.reduce((sum, bucket) => sum + bucket.losses, 0);
  const pushes = buckets.reduce((sum, bucket) => sum + (bucket.sampleSize - bucket.gradedSampleSize), 0);
  const decided = wins + losses;
  const betCount = activeBuckets.reduce((sum, bucket) => sum + bucket.sampleSize, 0);
  const priceSupported = activeBuckets.length > 0 && activeBuckets.every((bucket) => bucket.return.status === "available");
  const returnUnits = priceSupported
    ? activeBuckets.reduce((sum, bucket) => sum + (bucket.return.units ?? 0), 0)
    : null;
  const p = decided ? wins / decided : 0;
  const z = 1.959963984540054, denominator = 1 + z * z / Math.max(1, decided);
  const center = (p + z * z / (2 * Math.max(1, decided))) / denominator;
  const margin = decided ? z * Math.sqrt((p * (1 - p) + z * z / (4 * decided)) / decided) / denominator : 0;
  return {
    label: family === "spread" ? "ATS" : family === "totals" ? "O/U" : "selected moneyline side",
    wins,
    losses,
    pushes,
    decided,
    winPercentage: decided ? p : null,
    wilson95: decided ? { low: Math.max(0, center - margin), high: Math.min(1, center + margin) } : { low: null, high: null },
    return: priceSupported
      ? { status: "available", betCount, units: returnUnits, roi: betCount ? returnUnits! / betCount : null }
      : { status: "unavailable", reason: "Complete valid recorded prices are required for every selected side." },
  };
}

function ablations(rows: AdvancedRow[], names: string[]) {
  return ADVANCED_FEATURE_FAMILIES.map((family) => {
    if (family === "personnel" || family === "market") return { family, status: "unavailable", sampleSize: 0, reason: family === "personnel" ? ADVANCED_POLICY.unsupportedFamilies.personnel : "market information is prohibited in the independent concept" };
    const available = rows.filter((row) => (row.featureFamilies ?? []).includes(family)).length;
    const featureCount = names.filter((name) => name.startsWith(`${family}.`)).length;
    return { family, status: available && featureCount ? "measured" : "unavailable", sampleSize: available, featureCount, pairedMetricDelta: null, reason: available && featureCount ? "Leave-family-out refits are reported only when both full and reduced vectors have complete chronological coverage." : "No source-backed feature columns were available at the historical cutoff." };
  });
}

export function evaluateLeaveFamilyOut(input: {
  family: Family; rows: AdvancedRow[]; featureNames: string[]; algorithm: AdvancedAlgorithm;
}) {
  const training = input.rows.filter((row) => ADVANCED_TRAINING_SEASONS.includes(row.season as never));
  const holdout = input.rows.filter((row) => row.season === ADVANCED_TEST_SEASON);
  const fit = (names: string[]) => {
    const vector = (row: AdvancedRow) => names.map((name) => {
      const index = row.featureNames?.indexOf(name) ?? -1;
      return index >= 0 && Number.isFinite(row.x[index]) ? row.x[index] : 0;
    });
    const scaled = standardize(training.map(vector), holdout.map(vector));
    const model = input.algorithm === "elastic_net"
      ? fitElasticNet(scaled.train, training.map((row) => target(row, input.family)), input.family === "moneyline")
      : modelFor(input.algorithm, scaled.train, training.map((row) => target(row, input.family)), input.family === "moneyline");
    return scaled.test.map((row) => input.family === "moneyline" ? clamp(model.predict(row)) : model.predict(row));
  };
  const full = fit(input.featureNames);
  return ADVANCED_FEATURE_FAMILIES.map((family) => {
    const kept = input.featureNames.filter((name) => !name.startsWith(`${family}.`));
    if (kept.length === input.featureNames.length) return { family, status: "unavailable", sampleSize: 0, pairedMetricDelta: null };
    const reduced = fit(kept);
    const fullMetric = metrics(input.family, holdout, full), reducedMetric = metrics(input.family, holdout, reduced);
    const key = input.family === "moneyline" ? "logLoss" : "mae";
    const delta = typeof fullMetric[key] === "number" && typeof reducedMetric[key] === "number"
      ? (reducedMetric[key] as number) - (fullMetric[key] as number) : null;
    return { family, status: "measured", sampleSize: holdout.length, pairedMetricDelta: delta, fullMetric, leaveFamilyOutMetric: reducedMetric };
  });
}

export function assertAdvancedIsolation(input: { concept: ChallengerConcept; rows: AdvancedRow[]; trainingSeasons?: number[]; testSeason?: number }) {
  const trainingSeasons = input.trainingSeasons ?? [...ADVANCED_TRAINING_SEASONS];
  const testSeason = input.testSeason ?? ADVANCED_TEST_SEASON;
  if (trainingSeasons.some((season) => season < 2021 || season >= testSeason) || testSeason !== 2025) throw new Error("Advanced challenger requires 2021-2024 training and 2025-only holdout");
  if (input.rows.some((row) => row.season > 2025)) throw new Error("Forward-season evidence, including 2026, is excluded");
  if (input.rows.some((row) => !row.featureCutoff || !(row.featureCutoff < row.kickoffTime)
    || !(row.homeFeatureSourceCutoff < row.kickoffTime) || !(row.awayFeatureSourceCutoff < row.kickoffTime))) throw new Error("Advanced feature evidence must have complete cutoffs strictly before kickoff");
  if (input.rows.some((row) => (row.marketQuotes ?? []).some((quote) => (quote.observedAt && !(quote.observedAt < row.kickoffTime)) || (quote.sourceTimestamp && !(quote.sourceTimestamp < row.kickoffTime))))) throw new Error("Timestamped market evidence must be strictly pre-kickoff");
  if (input.concept === "independent_football" && input.rows.some((row) => (row.featureNames ?? []).some((name) => /market|odds|personnel|depth|injury|starter|closing/i.test(name)))) throw new Error("Independent challenger cannot contain market or present-day personnel features");
  if (input.concept === "market_residual" && input.rows.some((row) => (row.marketQuotes ?? []).some((quote) => quote.sourceDesignation !== "source_designated_recorded"))) throw new Error("Market residual requires source-designated recorded evidence");
}

export function evaluateAdvancedChallenger(input: {
  concept: ChallengerConcept;
  family: Family;
  algorithm: AdvancedAlgorithm;
  rows: AdvancedRow[];
  featureNames: string[];
  baselinePredictions?: Record<string, number>;
  referenceMetrics?: { mae?: number; logLoss?: number; sampleSize?: number };
}) {
  assertAdvancedIsolation(input);
  const rows = [...input.rows].sort((left, right) => left.kickoffTime.getTime() - right.kickoffTime.getTime() || left.gameId.localeCompare(right.gameId));
  const training = rows.filter((row) => ADVANCED_TRAINING_SEASONS.includes(row.season as never));
  const eligibleHoldout = rows.filter((row) => row.season === ADVANCED_TEST_SEASON && (input.concept === "independent_football" || (row.marketQuotes ?? []).some((quote) => quote.family === input.family)));
  const pairedIds = input.baselinePredictions ? new Set(Object.keys(input.baselinePredictions)) : null;
  const retainedReferenceUniverse = input.referenceMetrics
    ? eligibleHoldout.filter((row) =>
        (row.marketQuotes ?? []).some((quote) => quote.family === input.family)
        && (input.family !== "totals" || !row.lowSample))
    : eligibleHoldout;
  const holdout = pairedIds
    ? retainedReferenceUniverse.filter((row) => pairedIds.has(row.gameId))
    : retainedReferenceUniverse;
  const quotePoint = (row: AdvancedRow) => row.marketQuotes?.find((quote) => quote.family === input.family && quote.side === (input.family === "totals" ? "over" : "home") && quote.point !== null)?.point ?? null;
  const quoteHomeProbability = (row: AdvancedRow) => {
    const prices = (["home", "away"] as const).map((side) => row.marketQuotes?.find((quote) => quote.family === "moneyline" && quote.side === side)?.price);
    const implied = (price: number | null | undefined) => price == null || price === 0 ? null : price > 0 ? 100 / (price + 100) : -price / (-price + 100);
    const h = implied(prices[0]), a = implied(prices[1]);
    return h === null || a === null ? null : h / (h + a);
  };
  if (input.concept === "market_residual" && training.some((row) => input.family === "moneyline" ? quoteHomeProbability(row) === null : quotePoint(row) === null)) {
    throw new Error(`${input.family} market residual is unavailable: source-designated recorded training quotes are required for every 2021-2024 training row`);
  }
  const trainTarget = (row: AdvancedRow) => {
    if (input.concept !== "market_residual") return target(row, input.family);
    if (input.family === "moneyline") {
      const p = quoteHomeProbability(row)!;
      const observed = target(row, input.family) ? 0.999 : 0.001;
      return Math.log(observed / (1 - observed)) - Math.log(p / (1 - p));
    }
    return target(row, input.family) - (input.family === "spread" ? -quotePoint(row)! : quotePoint(row)!);
  };
  const vectors = (row: AdvancedRow) => input.featureNames.map((name) => {
    const index = row.featureNames?.indexOf(name) ?? -1;
    return index >= 0 && Number.isFinite(row.x[index]) ? row.x[index] : 0;
  });
  if (!training.length || !holdout.length) throw new Error(`${input.concept} ${input.family} has no eligible chronological training/holdout rows`);
  const scaled = standardize(training.map(vectors), holdout.map(vectors));
  const classification = input.family === "moneyline" && input.concept !== "market_residual";
  const model = input.algorithm === "elastic_net"
    ? fitElasticNet(scaled.train, training.map(trainTarget), classification)
    : modelFor(input.algorithm, scaled.train, training.map(trainTarget), classification);
  const predictions = scaled.test.map((row, index) => {
    const estimate = model.predict(row);
    if (input.concept === "market_residual" && input.family !== "moneyline") return estimate + (input.family === "spread" ? -(quotePoint(holdout[index]) ?? 0) : (quotePoint(holdout[index]) ?? 0));
    if (input.concept === "market_residual" && input.family === "moneyline") {
      const p = quoteHomeProbability(holdout[index])!;
      return clamp(1 / (1 + Math.exp(-(Math.log(p / (1 - p)) + estimate))));
    }
    return input.family === "moneyline" ? clamp(estimate) : estimate;
  });
  const modelParameters = "coefficients" in model
    ? { kind: "elastic_net", coefficients: [...model.coefficients] }
    : { ...model.artifact };
  const evidenceRow = (row: AdvancedRow, prediction?: number) => ({
    gameId: row.gameId,
    season: row.season,
    week: row.week,
    kickoffTime: row.kickoffTime.toISOString(),
    featureCutoff: row.featureCutoff!.toISOString(),
    homeFeatureSourceCutoff: row.homeFeatureSourceCutoff.toISOString(),
    awayFeatureSourceCutoff: row.awayFeatureSourceCutoff.toISOString(),
    featureVector: vectors(row),
    target: trainTarget(row),
    ...(prediction === undefined ? {} : { prediction }),
    ...(input.baselinePredictions?.[row.gameId] === undefined
      ? {}
      : { baselinePrediction: input.baselinePredictions[row.gameId] }),
    featureCoverage: row.coverage ?? null,
    marketEvidence: (row.marketQuotes ?? [])
      .filter((quote) => quote.family === input.family)
      .map((quote) => ({
        source: quote.source,
        sourceFile: quote.sourceFile,
        sourceGameId: quote.sourceGameId,
        family: quote.family,
        side: quote.side,
        point: quote.point,
        price: quote.price,
        sourceDesignation: quote.sourceDesignation,
        sportsbook: quote.sportsbook,
        observedAt: quote.observedAt?.toISOString() ?? null,
        sourceTimestamp: quote.sourceTimestamp?.toISOString() ?? null,
      })),
  });
  const evaluationEvidence = {
    featureNames: [...input.featureNames],
    standardization: { centers: [...scaled.centers], scales: [...scaled.scales] },
    fittedModel: { algorithm: input.algorithm, classification, parameters: modelParameters },
    trainingRows: training.map((row) => evidenceRow(row)),
    holdoutRows: holdout.map((row, index) => evidenceRow(row, predictions[index])),
  };
  const result = metrics(input.family, holdout, predictions);
  const baseline = input.baselinePredictions ? metrics(input.family, holdout, holdout.map((row) => input.baselinePredictions![row.gameId]!))
    : input.referenceMetrics ? { sampleSize: input.referenceMetrics.sampleSize ?? holdout.length, mae: input.referenceMetrics.mae ?? null, logLoss: input.referenceMetrics.logLoss ?? null } : null;
  const primary = input.family === "moneyline" ? "logLoss" : "mae";
  const deltas = baseline && input.baselinePredictions ? holdout.map((row, index) => {
    const base = input.baselinePredictions![row.gameId]!;
    const challenger = predictions[index];
    return input.family === "moneyline"
      ? -(row.homeWin * Math.log(clamp(challenger)) + (1 - row.homeWin) * Math.log(clamp(1 - challenger))) + (row.homeWin * Math.log(clamp(base)) + (1 - row.homeWin) * Math.log(clamp(1 - base)))
      : Math.abs(challenger - target(row, input.family)) - Math.abs(base - target(row, input.family));
  }) : [];
  const change = interval(deltas), threshold = typeof baseline?.[primary] === "number" ? Math.abs(baseline[primary] as number) * 0.01 : Infinity;
  const aggregateVerdict: ChallengerVerdict = baseline && typeof baseline[primary] === "number" && typeof result[primary] === "number"
    && (result[primary] as number) < (baseline[primary] as number) * 0.99 ? "MATERIAL IMPROVEMENT" : "NO MATERIAL IMPROVEMENT";
  const verdict: ChallengerVerdict = !baseline ? "NO MATERIAL IMPROVEMENT" : input.baselinePredictions
    ? change.sampleSize >= 30 && change.high !== null && change.high < -threshold ? "MATERIAL IMPROVEMENT"
      : change.sampleSize >= 30 && change.low !== null && change.low > threshold ? "WORSE THAN BASELINE" : "NO MATERIAL IMPROVEMENT"
    : aggregateVerdict;
  return {
    concept: input.concept, family: input.family, algorithm: input.algorithm, featureNames: [...input.featureNames],
    sourceFeatureNames: [...(holdout[0]?.sourceFeatureNames ?? input.featureNames)],
    trainingSeasons: [...ADVANCED_TRAINING_SEASONS], testSeason: ADVANCED_TEST_SEASON,
    eligibleHoldoutSampleSize: eligibleHoldout.length,
    comparisonSampleSize: holdout.length,
    ...(input.baselinePredictions ? { pairedSampleSize: holdout.length } : {}),
    comparisonMode: input.baselinePredictions
      ? "exact_game_paired_predictions"
      : input.referenceMetrics
        ? "retained_recorded_market_universe_aggregate"
        : "challenger_only",
    sampleSize: holdout.length, metrics: result, baselineMetrics: baseline,
    verdictStatus: baseline ? "measured_against_locked_phase6_evidence" : "insufficient_paired_reference_evidence",
    verdictExplanation: input.baselinePredictions ? "Paired against locked evidence by exact game ID intersection." : "Compared as an aggregate against the immutable retained report on its documented matched universe; no per-game prediction interval is claimed.",
    pairedDelta: change, verdict, marketBenchmark: marketBenchmark(input.family, holdout),
    ablations: evaluateLeaveFamilyOut({ family: input.family, rows, featureNames: input.featureNames, algorithm: input.algorithm }),
    edgeBuckets: marketEvidenceSummary(input.family, holdout, predictions),
    overallMarketSummary: overallMarketSummary(input.family, holdout, predictions),
    calibration: input.family === "moneyline" ? Array.from({ length: 10 }, (_, index) => {
      const positions = holdout.map((_row, position) => position)
        .filter((position) => predictions[position] >= index / 10 && predictions[position] < (index + 1) / 10);
      return {
        bucket: `${index * 10}-${(index + 1) * 10}%`,
        sampleSize: positions.length,
        prediction: positions.length ? mean(positions.map((position) => predictions[position])) : null,
        actualRate: positions.length ? mean(positions.map((position) => holdout[position].homeWin)) : null,
      };
    }) : null,
    evaluationEvidence,
    evidenceFingerprint: hash(evaluationEvidence),
    productionMutation: false,
    promotionEligible: false,
  };
}

export function renderAdvancedChallengerMarkdown(report: Record<string, unknown>) {
  const models = (report.models as Array<Record<string, unknown>> ?? []);
  const lines = [
    "# Gridline Advanced Challenger Evaluation", "",
    "Evaluation-only research. Source-designated recorded market evidence is not verified closing evidence; CLV and production promotion are unavailable.", "",
    "| Concept | Family | Algorithm | Sample | Verdict |", "|---|---|---:|---:|---|",
    ...models.map((model) => `| ${model.concept} | ${model.family} | ${model.algorithm} | ${model.sampleSize} | **${model.verdict}** |`),
    "", "## Safeguards", "", "- Training is fixed through 2024; 2025 is holdout; 2026 is excluded.", "- Independent and market-residual concepts are never blended.", "- No production model, prediction, promotion, or accepted baseline evidence was mutated.", "",
    "```json", JSON.stringify(report, null, 2), "```",
  ];
  return lines.join("\n");
}

async function loadRetainedReference() {
  const retained = JSON.parse(await readFile(resolve(dirname(fileURLToPath(import.meta.url)), "../../..", "reports/gridline-2025-market-baseline.json"), "utf8"));
  const config = Object.fromEntries((retained.models ?? []).map((model: Record<string, unknown>) => [model.family, {
    modelVersion: model.modelVersion, artifactChecksum: model.artifactChecksum, metrics: model.metrics,
    sampleSize: model.sampleSize, coverage: retained.coverage, comparisonMode: "exact_matched_game_universe_aggregate",
  }]));
  return { identity: hash(retained), evaluationRunId: String(retained.evaluationRunId), sourceFingerprint: retained.source?.fingerprintSha256 ?? null, config };
}

export async function runAdvancedChallenger() {
  assertModelFittingAllowed("advanced challenger evaluation");
  await verifyComparableBaselineOrThrow(await buildCurrentComparableBaselineCandidate());
  const retainedReference = await loadRetainedReference();
  const rows = await loadAdvancedRows("pregame-v3");
  const [baseline] = await db.select().from(marketBaselineRunsTable)
    .where(eq(marketBaselineRunsTable.runId, retainedReference.evaluationRunId))
    .limit(1);
  const [events, quotes, lockedEvidence] = baseline ? await Promise.all([
    db.select().from(marketBaselineEventsTable).where(eq(marketBaselineEventsTable.runId, baseline.runId)),
    db.select().from(marketBaselineQuotesTable).where(eq(marketBaselineQuotesTable.runId, baseline.runId)),
    db.select().from(modelEvaluationPredictionsTable).where(eq(modelEvaluationPredictionsTable.testSeason, 2025)),
  ]) : [[], [], []];
  const evidenceRows = lockedEvidence.length ? lockedEvidence : await db.select().from(modelEvaluationPredictionsTable).where(eq(modelEvaluationPredictionsTable.testSeason, 2025));
  const matched = new Map(events.flatMap((event) => event.matchedGameId ? [[event.sourceGameId, event.matchedGameId] as const] : []));
  const quotesByGame = new Map<string, HistoricalMarketQuote[]>();
  for (const quote of quotes) {
    const gameId = matched.get(quote.sourceGameId);
    if (!gameId) continue;
    const mapped: HistoricalMarketQuote = {
      source: "nflverse/nfldata", sourceFile: "games.csv", sourceGameId: quote.sourceGameId, altGameId: quote.altGameId,
      season: 2025, week: 0, awayTeam: "", homeTeam: "", kickoffTime: null, neutralSite: false,
      family: quote.family as HistoricalMarketQuote["family"], side: quote.side as HistoricalMarketQuote["side"],
      point: quote.point, price: quote.price, sourceDesignation: "source_designated_recorded",
      sportsbook: quote.sportsbook, observedAt: quote.observedAt, sourceTimestamp: quote.sourceTimestamp, sourceOutcome: quote.sourceOutcome,
    };
    quotesByGame.set(gameId, [...(quotesByGame.get(gameId) ?? []), mapped]);
  }
  let fallbackSourceFingerprint: string | null = null;
  if (!quotes.length) {
    const source = await fetch2025MarketSource();
    qualify2025MarketSource(source);
    fallbackSourceFingerprint = sourceFingerprint(source.csv);
    const sourceQuotes = parseNflDataMarketCsv(source.csv);
    const games = rows.filter((row) => row.season === 2025).map((row) => ({
      gameId: row.gameId, season: row.season, week: row.week, kickoffTime: row.kickoffTime,
      homeAbbreviation: row.homeTeamAbbreviation, awayAbbreviation: row.awayTeamAbbreviation, neutralSite: false,
    }));
    const groups = new Map<string, HistoricalMarketQuote[]>();
    for (const quote of sourceQuotes) groups.set(quote.sourceGameId, [...(groups.get(quote.sourceGameId) ?? []), quote]);
    for (const group of groups.values()) {
      const diagnostic = matchHistoricalMarketGame(group[0], games);
      if (diagnostic.matchedGameId && diagnostic.outcome !== "ambiguous" && diagnostic.outcome !== "neutral_site") quotesByGame.set(diagnostic.matchedGameId, group);
    }
  }
  for (const row of rows) row.marketQuotes = quotesByGame.get(row.gameId);
  const referenceSourceComparable = Boolean(baseline)
    || Boolean(
      fallbackSourceFingerprint
      && retainedReference.sourceFingerprint
      && fallbackSourceFingerprint === retainedReference.sourceFingerprint,
    );
  const baselinePredictionsByFamily = selectLockedBaselinePredictions(evidenceRows, Object.fromEntries(
    (Object.entries(retainedReference.config) as Array<[Family, { modelVersion: string }]>).map(([family, config]) => [family, config.modelVersion]),
  ));
  const independentModels = (["spread", "moneyline", "totals"] as Family[]).map((family) => {
    const baselinePredictions = baselinePredictionsByFamily.get(family);
    const hasPairedPredictions = Boolean(baselinePredictions && Object.keys(baselinePredictions).length);
    const model = evaluateAdvancedChallenger({
      concept: "independent_football", family, algorithm: family === "moneyline" ? "logistic_regression" : family === "totals" ? "gradient_boosting" : "elastic_net",
      rows, featureNames: rows[0]?.featureNames ?? [], baselinePredictions,
      referenceMetrics: !hasPairedPredictions && referenceSourceComparable ? retainedReference.config[family]?.metrics : undefined,
    });
    return applyReferenceAvailability(model, {
      hasPairedPredictions,
      aggregateSourceComparable: referenceSourceComparable,
    });
  });
  const residualModels: Array<Record<string, unknown>> = (["spread", "moneyline", "totals"] as Family[]).flatMap((family) => {
    const trainingQuotes = rows.filter((row) => ADVANCED_TRAINING_SEASONS.includes(row.season as never)
      && (row.marketQuotes ?? []).some((quote) => quote.family === family));
    if (trainingQuotes.length !== rows.filter((row) => ADVANCED_TRAINING_SEASONS.includes(row.season as never)).length) {
      return [{
        concept: "market_residual", family, algorithm: "elastic_net",
        featureNames: [...(rows[0]?.featureNames ?? [])], trainingSeasons: [...ADVANCED_TRAINING_SEASONS], testSeason: 2025,
        sampleSize: 0, metrics: null, baselineMetrics: null, pairedDelta: null,
        verdict: "NO MATERIAL IMPROVEMENT" as const,
        verdictStatus: "insufficient_recorded_training_evidence",
        verdictExplanation: "The predeclared conservative policy cannot establish material improvement without qualified 2021-2024 recorded-market training evidence.",
        unavailable: true, unavailableReason: "No qualified source-designated recorded market evidence exists for every 2021-2024 training game; residual fitting is not performed.",
        productionMutation: false, promotionEligible: false,
      } as Record<string, unknown>];
    }
    return [evaluateAdvancedChallenger({ concept: "market_residual", family, algorithm: "elastic_net", rows, featureNames: rows[0]?.featureNames ?? [], baselinePredictions: baselinePredictionsByFamily.get(family) })];
  });
  const models: Array<Record<string, unknown>> = [...independentModels, ...residualModels] as Array<Record<string, unknown>>;
  const normalizedMarketSourceSnapshot = [...quotesByGame.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([gameId, gameQuotes]) => ({
      gameId,
      quotes: [...gameQuotes]
        .sort((left, right) => `${left.family}:${left.side}:${left.sportsbook ?? ""}`.localeCompare(`${right.family}:${right.side}:${right.sportsbook ?? ""}`))
        .map((quote) => ({
          source: quote.source,
          sourceFile: quote.sourceFile,
          sourceGameId: quote.sourceGameId,
          altGameId: quote.altGameId,
          family: quote.family,
          side: quote.side,
          point: quote.point,
          price: quote.price,
          sourceDesignation: quote.sourceDesignation,
          sportsbook: quote.sportsbook,
          observedAt: quote.observedAt?.toISOString() ?? null,
          sourceTimestamp: quote.sourceTimestamp?.toISOString() ?? null,
          sourceOutcome: quote.sourceOutcome,
        })),
    }));
  const pairedEvidenceByFamily = Object.fromEntries((["spread", "moneyline", "totals"] as Family[]).map((family) => {
    const predictions = baselinePredictionsByFamily.get(family);
    return [family, {
      available: Boolean(predictions && Object.keys(predictions).length),
      predictionCount: predictions ? Object.keys(predictions).length : 0,
      modelVersion: retainedReference.config[family]?.modelVersion ?? null,
    }];
  }));
  const anyPairedPredictions = Object.values(pairedEvidenceByFamily).some((value) => value.available);
  let retainedPersonnel: Record<string, unknown> = {
    status: "comparable_retained_report_unavailable",
    reason: "No retained personnel-aware report was found; no unsupported comparison was inferred.",
  };
  try {
    const retained = JSON.parse(await readFile(resolve(dirname(fileURLToPath(import.meta.url)), "../../..", "reports/gridline-2025-personnel-comparison.json"), "utf8"));
    retainedPersonnel = {
      status: "retained_fingerprint_loaded",
      fingerprint: hash(retained),
      comparisonMode: "retained_metric_level_non_comparable",
      explanation: "Family-level personnel metrics and verdicts are disclosed, but source drift and absent shared prediction rows prevent a paired comparison to this run.",
      families: (retained.models ?? []).map((model: Record<string, unknown>) => ({
        family: model.family,
        sampleSize: model.sampleSize,
        baselineMetrics: model.baseline,
        personnelChallengerMetrics: model.challenger,
        comparison: model.comparison,
        verdict: model.verdict,
      })),
    };
  } catch {
    // Missing retained artifacts remain explicitly unavailable.
  }
  const report = {
    reportVersion: ADVANCED_CHALLENGER_VERSION, policy: ADVANCED_POLICY,
    runFingerprint: hash({ models, retainedReference }), models, productionMutation: false,
    lockedPhase6Reference: {
      identity: retainedReference.identity,
      config: retainedReference.config,
      comparisonMode: anyPairedPredictions
        ? "family_specific_exact_game_pairing"
        : referenceSourceComparable
          ? "retained_recorded_market_universe_aggregate"
          : "non_comparable_source_drift",
      pairedPredictionsAvailable: anyPairedPredictions,
      pairedEvidenceByFamily,
      fallbackSourceFingerprint,
      retainedSourceFingerprint: retainedReference.sourceFingerprint,
      sourceFingerprintMatch: referenceSourceComparable,
    },
    algorithmPolicy: {
      candidates: ["linear_regression", "logistic_regression", "elastic_net", "gradient_boosting", "random_forest"],
      selection: "Precommitted by family: elastic_net spread, logistic_regression moneyline, gradient_boosting totals; random forest is only a sensitivity candidate when training sample size is at least 60 and is never selected from holdout performance.",
      validation: "Chronological training rows only; no holdout threshold search.",
    },
    ensembleEvaluation: {
      variant: "independent_plus_market_residual_research_ensemble",
      status: "unavailable",
      verdict: "NO MATERIAL IMPROVEMENT",
      reason: "An ensemble is not fitted because the separate market-residual component lacks qualified 2021-2024 training evidence. The independent concept is never silently blended with unavailable market evidence.",
      prerequisites: [
        "Complete source-designated recorded market training evidence with valid pre-kickoff provenance",
        "A separately fitted and evaluated market-residual component",
        "A precommitted ensemble weight and chronological evaluation policy",
      ],
      productionMutation: false,
      promotionEligible: false,
    },
    personnelComparison: retainedPersonnel,
    marketSourceSnapshot: {
      contentHash: hash(normalizedMarketSourceSnapshot),
      retainedSourceFingerprint: retainedReference.sourceFingerprint,
      loadedSourceFingerprint: fallbackSourceFingerprint,
      rows: normalizedMarketSourceSnapshot,
    },
    evidence: {
      identity: hash(models.map((model) => ({ concept: model.concept, family: model.family, evidenceFingerprint: model.evidenceFingerprint ?? null }))),
      immutable: true,
      ordering: "family, concept, kickoffTime, gameId",
    },
    closingLineClaims: false, clv: { status: "unavailable", reason: "No qualified timestamped paired closing evidence." },
  };
  return { report, markdown: renderAdvancedChallengerMarkdown(report), immutable: true };
}