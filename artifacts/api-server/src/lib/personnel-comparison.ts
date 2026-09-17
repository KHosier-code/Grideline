import { createHash } from "node:crypto";
import { and, desc, eq } from "drizzle-orm";
import {
  db,
  marketBaselineEventsTable,
  marketBaselineQuotesTable,
  marketBaselineRunsTable,
  modelEvaluationPredictionsTable,
  pregameTeamFeaturesTable,
} from "@workspace/db";
import {
  MARKET_EDGE_BUCKETS,
  applyMinimumEdgeSettlement,
  settleSpread,
  settleTotal,
  type MarketFamily,
  type Settlement,
} from "./market-baseline";
import {
  PHASE6_VECTOR_FEATURE_NAMES,
  mean,
  modelFor,
  standardize,
  type Algorithm,
  type Example,
} from "./modeling";
import { loadPersonnelContextBatch } from "./personnel-context";
import { personnelNumericFeatures, type PersonnelContext } from "./personnel-context-derivation";
import { loadExamples } from "./modeling";

export const PERSONNEL_COMPARISON_VERSION = "phase7-personnel-aware-2025-v1";
export const PERSONNEL_VECTOR_FEATURE_NAMES = [
  "personnel.data_confidence",
  "personnel.home_starter_count_difference",
  "personnel.home_personnel_completeness_difference",
  "personnel.home_qb_certainty_difference",
  "personnel.home_qb_recent_dropbacks_difference",
  "personnel.home_qb_recent_epa_difference",
  "personnel.home_qb_success_rate_difference",
  "personnel.home_qb_interception_rate_difference",
  "personnel.home_qb_sack_rate_difference",
  "personnel.home_qb_continuity_difference",
  "personnel.home_injury_offense_difference",
  "personnel.home_injury_defense_difference",
  "personnel.home_injury_ol_difference",
  "personnel.home_ol_continuity_difference",
  "personnel.home_rest_days_difference",
  "personnel.home_short_week_difference",
] as const;

export type PersonnelGameInput = {
  gameId: string;
  kickoffTime: Date;
  sourceCutoff: Date;
  homeTeamId: string;
  awayTeamId: string;
  personnel: Record<string, number | null>;
};

export function assertPersonnelChronology(rows: Array<Pick<PersonnelGameInput, "kickoffTime" | "sourceCutoff">>) {
  if (rows.some((row) => !(row.sourceCutoff < row.kickoffTime))) {
    throw new Error("Personnel evidence must be reconstructed strictly before kickoff");
  }
}

export function personnelVector(row: PersonnelGameInput) {
  assertPersonnelChronology([row]);
  const value = (name: string): number | null => {
    const value = row.personnel[name];
    return typeof value === "number" && Number.isFinite(value) ? value : null;
  };
  const home = row.homeTeamId;
  const away = row.awayTeamId;
  const team = (name: string) => {
    const homeValue = row.personnel[`personnel.${home}.${name}`];
    const awayValue = row.personnel[`personnel.${away}.${name}`];
    return typeof homeValue === "number" && Number.isFinite(homeValue)
      && typeof awayValue === "number" && Number.isFinite(awayValue)
      ? homeValue - awayValue : null;
  };
  const confidence = value("personnel.data_confidence");
  const values: Array<number | null> = [
    confidence,
    team("starter_count"),
    team("personnel_completeness"),
    team("qb_starter_certainty"),
    team("qb_recent_dropbacks"),
    team("qb_recent_epa_per_dropback"),
    team("qb_recent_success_rate"),
    team("qb_interception_rate"),
    team("qb_sack_rate"),
    team("qb_continuity_score"),
    team("injury_offense_impact"),
    team("injury_defense_impact"),
    team("injury_ol_impact"),
    team("ol_snap_continuity"),
    team("rest_days"),
    team("short_week"),
  ];
  return values.flatMap((item) => [typeof item === "number" && Number.isFinite(item) ? item : 0, item === null ? 0 : 1]);
}

export type PersonnelTrainingRow = PersonnelGameInput & {
  season: number;
  x: number[];
  target: number;
};

export function fitPersonnelChallenger(input: {
  family: MarketFamily;
  algorithm: Algorithm;
  classification: boolean;
  training: PersonnelTrainingRow[];
  holdout: PersonnelTrainingRow[];
}) {
  if (!input.training.length) throw new Error("Personnel challenger requires 2021-2024 training evidence");
  if (input.training.some((row) => row.season < 2021 || row.season > 2024)) {
    throw new Error("Personnel challenger training must be limited to 2021-2024");
  }
  assertPersonnelChronology([...input.training, ...input.holdout]);
  const vector = (row: PersonnelTrainingRow) => [...row.x, ...personnelVector(row)];
  const scaled = standardize(input.training.map(vector), input.holdout.map(vector));
  const model = modelFor(input.algorithm, scaled.train, input.training.map((row) => row.target), input.classification);
  const predicted = scaled.test.map((row) => model.predict(row));
  if (!predicted.every(Number.isFinite)) throw new Error(`${input.family} personnel challenger produced a non-finite prediction`);
  return {
    predicted,
    featureCount: scaled.centers.length,
    featureNames: [
      ...PHASE6_VECTOR_FEATURE_NAMES,
      ...PERSONNEL_VECTOR_FEATURE_NAMES.flatMap((name) => [name, `${name}.available`]),
    ],
  };
}

export function pairedUncertainty(deltas: number[]) {
  if (deltas.length < 2) return { sampleSize: deltas.length, mean: deltas.length ? deltas[0] : null, low: null, high: null, status: "insufficient_sample" as const };
  const average = mean(deltas);
  const variance = deltas.reduce((sum, value) => sum + (value - average) ** 2, 0) / (deltas.length - 1);
  const standardError = Math.sqrt(variance / deltas.length);
  return {
    sampleSize: deltas.length,
    mean: average,
    low: average - 1.96 * standardError,
    high: average + 1.96 * standardError,
    status: "descriptive_95_percent_interval" as const,
  };
}

export type PairedPrediction = {
  gameId: string;
  week: number;
  family: MarketFamily;
  kickoffTime: Date;
  personnelSourceCutoff: Date;
  actual: number;
  baseline: number;
  challenger: number;
  marketQuotes?: Array<{
    family: string;
    side: string;
    point: number | null;
    price: number | null;
  }>;
};

function metrics(rows: PairedPrediction[], selector: (row: PairedPrediction) => number) {
  if (!rows.length) return { sampleSize: 0, mae: null, rmse: null };
  if (rows[0].family === "moneyline") {
    const actual = rows.map((row) => row.actual);
    const predicted = rows.map(selector);
    const clamp = (value: number) => Math.max(0.001, Math.min(0.999, value));
    return {
      sampleSize: rows.length,
      accuracy: mean(actual.map((value, index) => (predicted[index] >= 0.5 ? 1 : 0) === value ? 1 : 0)),
      brierScore: mean(actual.map((value, index) => (predicted[index] - value) ** 2)),
      logLoss: -mean(actual.map((value, index) => value * Math.log(clamp(predicted[index])) + (1 - value) * Math.log(clamp(1 - predicted[index])))),
    };
  }
  const errors = rows.map((row) => Math.abs(selector(row) - row.actual));
  return { sampleSize: rows.length, mae: mean(errors), rmse: Math.sqrt(mean(errors.map((value) => value ** 2))) };
}

function settlementSummary(rows: PairedPrediction[], minimumEdge: number, selector: (row: PairedPrediction) => number) {
  const settlements = rows.flatMap((row) => {
    const choices = (row.marketQuotes ?? []).map((quote) => {
      const prediction = selector(row);
      const edge = row.family === "spread"
        ? quote.side === "home" ? prediction + (quote.point ?? 0) : (quote.point ?? 0) - prediction
        : quote.side === "over" ? prediction - (quote.point ?? 0) : (quote.point ?? 0) - prediction;
      const settlement = row.family === "spread"
        ? settleSpread(row.actual, quote.point, quote.side as "home" | "away")
        : settleTotal(row.actual, quote.point, quote.side as "over" | "under");
      return { edge, settlement };
    });
    if (!choices.length) return [];
    const best = choices.reduce((current, choice) => choice.edge > current.edge ? choice : current);
    return [applyMinimumEdgeSettlement(best.settlement, best.edge, minimumEdge)];
  });
  const wins = settlements.filter((value) => value === "win").length;
  const losses = settlements.filter((value) => value === "loss").length;
  const pushes = settlements.filter((value) => value === "push").length;
  return {
    wins,
    losses,
    pushes,
    noBets: settlements.filter((value) => value === "no_bet").length,
    winRate: wins + losses ? wins / (wins + losses) : null,
  };
}

function edgeSummary(rows: PairedPrediction[], minimumEdge: number, selector: (row: PairedPrediction) => number) {
  return MARKET_EDGE_BUCKETS.map((bucket) => {
    const values = rows.flatMap((row) => {
      const choices = (row.marketQuotes ?? []).map((quote) => {
        const prediction = selector(row);
        const edge = row.family === "spread"
          ? quote.side === "home" ? prediction + (quote.point ?? 0) : (quote.point ?? 0) - prediction
          : quote.side === "over" ? prediction - (quote.point ?? 0) : (quote.point ?? 0) - prediction;
        const settlement: Settlement = row.family === "spread"
          ? settleSpread(row.actual, quote.point, quote.side as "home" | "away")
          : settleTotal(row.actual, quote.point, quote.side as "over" | "under");
        return { edge, settlement, error: Math.abs(prediction - row.actual) };
      });
      if (!choices.length) return [];
      const best = choices.reduce((current, choice) => choice.edge > current.edge ? choice : current);
      return [{ ...best, settlement: applyMinimumEdgeSettlement(best.settlement, best.edge, minimumEdge) }];
    }).filter((row) => Math.abs(row.edge) >= bucket.min && Math.abs(row.edge) < bucket.max);
    const graded = values.filter((row) => row.settlement === "win" || row.settlement === "loss");
    const wins = graded.filter((row) => row.settlement === "win").length;
    return { bucket: bucket.label, sampleSize: values.length, gradedSampleSize: graded.length, wins, losses: graded.length - wins, winRate: graded.length ? wins / graded.length : null };
  });
}

function calibration(rows: PairedPrediction[], selector: (row: PairedPrediction) => number) {
  return Array.from({ length: 10 }, (_, index) => {
    const min = index / 10;
    const values = rows.filter((row) => selector(row) >= min && (index === 9 ? selector(row) <= 1 : selector(row) < min + 0.1));
    return {
      bucket: `${index * 10}-${(index + 1) * 10}%`,
      sampleSize: values.length,
      averagePrediction: values.length ? mean(values.map(selector)) : null,
      actualHomeWinRate: values.length ? mean(values.map((row) => row.actual)) : null,
    };
  });
}

function metricComparison(family: MarketFamily, baseline: Record<string, number | null | undefined>, challenger: Record<string, number | null | undefined>) {
  const lowerIsBetter = family === "moneyline" ? ["logLoss", "brierScore"] : ["mae", "rmse"];
  const names = family === "moneyline" ? ["accuracy", ...lowerIsBetter] : lowerIsBetter;
  return Object.fromEntries(names.map((name) => {
    const left = baseline[name];
    const right = challenger[name];
    const difference = typeof left === "number" && typeof right === "number" ? right - left : null;
    const improvementPercent = difference === null || typeof left !== "number" || left === 0 ? null
      : (lowerIsBetter.includes(name) ? -difference : difference) / Math.abs(left) * 100;
    return [name, { baseline: left ?? null, challenger: right ?? null, difference, improvementPercent }];
  }));
}

function marketBenchmark(rows: PairedPrediction[]) {
  const family = rows[0]?.family;
  const comparable = rows.flatMap((row) => {
    if (family === "spread") {
      const quote = row.marketQuotes?.find((item) => item.side === "home");
      return quote?.point == null ? [] : [{ actual: row.actual, predicted: -quote.point }];
    }
    if (family === "totals") {
      const quote = row.marketQuotes?.find((item) => item.side === "over");
      return quote?.point == null ? [] : [{ actual: row.actual, predicted: quote.point }];
    }
    const home = row.marketQuotes?.find((item) => item.side === "home");
    const away = row.marketQuotes?.find((item) => item.side === "away");
    const implied = (price: number | null | undefined) => price == null ? null : price > 0 ? 100 / (price + 100) : -price / (-price + 100);
    const homeRaw = implied(home?.price);
    const awayRaw = implied(away?.price);
    return homeRaw === null || awayRaw === null ? [] : [{ actual: row.actual, predicted: homeRaw / (homeRaw + awayRaw) }];
  });
  const synthetic = comparable.map((row, index) => ({
    ...rows[index],
    gameId: String(index),
    actual: row.actual,
    baseline: row.predicted,
    challenger: row.predicted,
  }));
  return {
    designation: "source-designated recorded; not verified closing",
    ...metrics(synthetic, (row) => row.baseline),
  };
}

export type PersonnelPreflightRow = {
  season: number;
  kickoffTime: Date;
  context: PersonnelContext;
};

export function buildPersonnelComparisonPreflight(rows: PersonnelPreflightRow[]) {
  const chronologyViolations = rows.filter((row) =>
    !(new Date(row.context.sourceCutoff).getTime() < row.kickoffTime.getTime()));
  const seasons = [...new Set(rows.map((row) => row.season))].sort((a, b) => a - b);
  const coverageBySeason = seasons.map((season) => ({
    season,
    ...personnelAvailability(rows.filter((row) => row.season === season).map((row) => row.context)),
  }));
  const missingCategories = coverageBySeason.flatMap((coverage) =>
    Object.entries(coverage.categories)
      .filter(([, category]) => category.status === "unavailable")
      .map(([category]) => ({ season: coverage.season, category })));
  const derivedZeroLimitations = coverageBySeason.flatMap((coverage) =>
    Object.entries(coverage.categories)
      .filter(([, category]) => category.derivedZeroWithoutSourceRows > 0)
      .map(([category, detail]) => ({
        season: coverage.season,
        category,
        observations: detail.derivedZeroWithoutSourceRows,
      })));
  const status = rows.length === 0 || chronologyViolations.length > 0
    ? "block"
    : missingCategories.length > 0 || derivedZeroLimitations.length > 0
      ? "warn"
      : "proceed";
  return {
    status,
    readOnly: true,
    modelFittingPerformed: false,
    databaseWritesPerformed: false,
    chronology: {
      policy: "strictly-before-kickoff",
      valid: chronologyViolations.length === 0,
      violationGameIds: chronologyViolations.map((row) => row.context.gameId).sort(),
    },
    gamesChecked: rows.length,
    coverageBySeason,
    missingCategories,
    derivedZeroLimitations,
    message: status === "block"
      ? rows.length === 0
        ? "BLOCK: no historical personnel contexts were available for the audit."
        : "BLOCK: personnel evidence failed the strict pre-kickoff chronology check."
      : status === "warn"
        ? "WARN: the audit can run, but one or more personnel categories lack source rows or contain derived zeroes without source support."
        : "PROCEED: all requested personnel categories have source-backed pre-kickoff coverage.",
  };
}

function personnelAvailability(contexts: PersonnelContext[]) {
  const teamRows = contexts.flatMap((context) => Object.values(context.teams));
  const category = (available: number, total: number, limitations: string[], derivedZeroWithoutRows = 0) => ({
    status: available === total && total > 0 ? "available" : available ? "partially_available" : "unavailable",
    availableObservations: available,
    totalObservations: total,
    availabilityRate: total ? available / total : null,
    derivedZeroWithoutSourceRows: derivedZeroWithoutRows,
    limitations,
  });
  const injuryRows = teamRows.filter((team) => team.injuryPlayers.length > 0);
  const secondaryRows = teamRows.filter((team) => team.injuryPlayers.some((row) => row.unit === "secondary"));
  return {
    gameContexts: contexts.length,
    distinction: "Source availability is counted from underlying pre-cutoff rows, not from derived numeric values. Under the unchanged feature contract, some empty injury-unit summaries derive to zero; those are disclosed separately and are not counted as source observations.",
    categories: {
      injury: category(injuryRows.length, teamRows.length,
        ["Replacement quality is unavailable; injury impact is limited to pre-cutoff designations, participation, and starter likelihood.", "A derived zero with no underlying injury rows means no supported pre-cutoff injury impact was found; it does not prove a complete injury feed."],
        teamRows.filter((team) => team.injuryPlayers.length === 0 && team.injuries.offense.impactScore === 0).length),
      qbStarter: category(teamRows.filter((team) => team.qb.projectedStarter !== null).length, teamRows.length,
        ["A projected starter may be inferred from prior participation when a published depth source is unavailable."]),
      depth: category(teamRows.filter((team) => team.starters.length > 0).length, teamRows.length,
        ["Historical depth and snap-count inference are fallbacks; they are not official depth charts."]),
      offensiveLine: category(teamRows.filter((team) => team.olContinuity.olSnapContinuity !== null).length, teamRows.length,
        ["Continuity is a recent-snap proxy; replacement quality and complete snap burden are unavailable."]),
      secondaryCornerback: category(secondaryRows.length, teamRows.length,
        ["Direct cornerback assignments and player-vs-player coverage are unavailable.", "Unit-level derived zeroes without an underlying secondary injury row are not counted as available evidence."],
        teamRows.filter((team) => !team.injuryPlayers.some((row) => row.unit === "secondary") && team.injuries.secondary.impactScore === 0).length),
      rosterTrade: category(0, teamRows.length,
        ["No immutable point-in-time roster transaction or trade feed is included; no roster/trade value was imputed."]),
    },
  };
}

export function buildPersonnelComparisonReport(input: {
  baselineRunId: string;
  eligibleGameIds: string[];
  eligibleGameIdsByFamily?: Partial<Record<MarketFamily, string[]>>;
  minimumRecordedLineEdge: number;
  predictions: PairedPrediction[];
  personnelContexts?: PersonnelContext[];
}) {
  const orderedPredictions = [...input.predictions].sort((left, right) =>
    left.family.localeCompare(right.family)
    || left.kickoffTime.getTime() - right.kickoffTime.getTime()
    || left.gameId.localeCompare(right.gameId));
  const expected = new Set(input.eligibleGameIds);
  for (const family of new Set(orderedPredictions.map((row) => row.family))) {
    const expectedFamily = new Set(input.eligibleGameIdsByFamily?.[family] ?? input.eligibleGameIds);
    const actualFamily = orderedPredictions.filter((row) => row.family === family).map((row) => row.gameId);
    if (actualFamily.length !== expectedFamily.size || new Set(actualFamily).size !== actualFamily.length
      || [...expectedFamily].some((id) => !actualFamily.includes(id))) {
      throw new Error(`Personnel challenger ${family} predictions must use exactly one row per baseline game`);
    }
  }
  assertPersonnelChronology(orderedPredictions.map((row) => ({
    kickoffTime: row.kickoffTime,
    sourceCutoff: row.personnelSourceCutoff,
  })));
  const families = (["spread", "moneyline", "totals"] as MarketFamily[])
    .filter((family) => orderedPredictions.some((row) => row.family === family));
  const models = families.map((family) => {
    const rows = orderedPredictions.filter((row) => row.family === family);
    const baselineMetrics = metrics(rows, (row) => row.baseline);
    const challengerMetrics = metrics(rows, (row) => row.challenger);
    const comparison = metricComparison(family, baselineMetrics, challengerMetrics);
    const clamp = (value: number) => Math.max(0.001, Math.min(0.999, value));
    const absoluteErrorDeltas = rows.map((row) =>
      Math.abs(row.challenger - row.actual) - Math.abs(row.baseline - row.actual));
    const pairedDelta = family === "moneyline"
      ? {
          brierScore: pairedUncertainty(rows.map((row) =>
            (row.challenger - row.actual) ** 2 - (row.baseline - row.actual) ** 2)),
          logLoss: pairedUncertainty(rows.map((row) => {
            const loss = (prediction: number) =>
              -(row.actual * Math.log(clamp(prediction)) + (1 - row.actual) * Math.log(clamp(1 - prediction)));
            return loss(row.challenger) - loss(row.baseline);
          })),
        }
      : { mae: pairedUncertainty(absoluteErrorDeltas) };
    const weeks = [...new Set(rows.map((row) => row.week))].sort((a, b) => a - b);
    const primaryMetric = family === "moneyline" ? "logLoss" : "mae";
    const primary = (family === "moneyline" ? pairedDelta.logLoss : pairedDelta.mae)!;
    const baselinePrimary = baselineMetrics[primaryMetric]!;
    const materialDifference = typeof baselinePrimary === "number" ? Math.abs(baselinePrimary) * 0.01 : Infinity;
    const verdict = primary.sampleSize >= 30 && primary.mean !== null && primary.high !== null && primary.high < -materialDifference
      ? "CHALLENGER IMPROVES BASELINE"
      : primary.sampleSize >= 30 && primary.mean !== null && primary.low !== null && primary.low > materialDifference
        ? "CHALLENGER WORSE"
        : "NO MATERIAL IMPROVEMENT";
    return {
      family,
      sampleSize: rows.length,
      baseline: baselineMetrics,
      challenger: challengerMetrics,
      comparison,
      pairedDelta,
      statisticalAssessment: {
        method: "descriptive paired normal-approximation 95% interval; no multiple-comparison or threshold-selection claim",
        primaryMetric,
        minimumPairedGames: 30,
        materialityThreshold: "1% of the baseline primary metric",
        verdictRule: "Improve/worse only with at least 30 paired games and when the full paired 95% interval exceeds the 1% materiality threshold in one direction; otherwise no material improvement.",
      },
      recordedMarketBenchmark: marketBenchmark(rows),
      verdict,
      weekly: weeks.map((week) => {
        const weekly = rows.filter((row) => row.week === week);
        return { week, baseline: metrics(weekly, (row) => row.baseline), challenger: metrics(weekly, (row) => row.challenger) };
      }),
      cumulative: weeks.map((week) => {
        const cumulative = rows.filter((row) => row.week <= week);
        return { throughWeek: week, baseline: metrics(cumulative, (row) => row.baseline), challenger: metrics(cumulative, (row) => row.challenger) };
      }),
      calibration: family === "moneyline" ? {
        baseline: calibration(rows, (row) => row.baseline),
        challenger: calibration(rows, (row) => row.challenger),
      } : null,
      market: family === "moneyline" ? null : {
        baselineRecord: settlementSummary(rows, input.minimumRecordedLineEdge, (row) => row.baseline),
        challengerRecord: settlementSummary(rows, input.minimumRecordedLineEdge, (row) => row.challenger),
        baselineEdgeBuckets: edgeSummary(rows, input.minimumRecordedLineEdge, (row) => row.baseline),
        challengerEdgeBuckets: edgeSummary(rows, input.minimumRecordedLineEdge, (row) => row.challenger),
        note: "Small edge buckets are descriptive only; no threshold is recommended.",
      },
    };
  });
  return {
    comparisonVersion: PERSONNEL_COMPARISON_VERSION,
    baselineRunId: input.baselineRunId,
    gameSet: {
      eligibleGameCount: expected.size,
      challengerGameCount: new Set(orderedPredictions.map((row) => row.gameId)).size,
      exactMatch: true,
      perFamily: Object.fromEntries(families.map((family) => [
        family, { baseline: (input.eligibleGameIdsByFamily?.[family] ?? input.eligibleGameIds).length, challenger: orderedPredictions.filter((row) => row.family === family).length },
      ])),
    },
    chronology: { trainingSeasons: [2021, 2022, 2023, 2024], testSeason: 2025, personnelCutoff: "strictly-before-kickoff", vectorFeatureNames: [...PERSONNEL_VECTOR_FEATURE_NAMES] },
    personnelEvidence: personnelAvailability(input.personnelContexts ?? []),
    models,
    suitability: { status: "insufficient_for_threshold_recommendation", reason: "Paired uncertainty intervals are descriptive; small edge buckets and no pre-registered threshold prevent a betting recommendation." },
    safeguards: {
      tuningPerformed: false,
      promotionPerformed: false,
      productionModelChanged: false,
      productionPredictionMutation: false,
    },
    productionMutation: false,
    immutable: true,
  };
}

export function personnelComparisonFingerprint(report: unknown) {
  return createHash("sha256").update(JSON.stringify(report)).digest("hex");
}

export function comparablePersonnelComparisonReport(report: unknown) {
  if (!report || typeof report !== "object" || Array.isArray(report)) return report;
  const { preflight: _executionMetadata, ...comparable } = report as Record<string, unknown>;
  return comparable;
}

export function assertRetainedPersonnelComparisonFingerprint(report: unknown, retainedReport: unknown) {
  const actual = personnelComparisonFingerprint(comparablePersonnelComparisonReport(report));
  const expected = personnelComparisonFingerprint(comparablePersonnelComparisonReport(retainedReport));
  if (actual !== expected) {
    throw new Error(`Optimized personnel comparison fingerprint ${actual} does not match retained report ${expected}`);
  }
  return actual;
}

const CHALLENGER_CONFIG = {
  spread: { algorithm: "linear_regression" as const, classification: false, target: (row: any) => row.margin },
  moneyline: { algorithm: "logistic_regression" as const, classification: true, target: (row: any) => row.homeWin },
  totals: { algorithm: "gradient_boosting" as const, classification: false, target: (row: any) => row.total },
};

type PersonnelComparisonPreparation = Awaited<ReturnType<typeof prepare2025PersonnelComparison>>;

export async function prepare2025PersonnelComparison() {
  const [baseline] = await db.select().from(marketBaselineRunsTable)
    .where(and(eq(marketBaselineRunsTable.season, 2025), eq(marketBaselineRunsTable.status, "complete")))
    .orderBy(desc(marketBaselineRunsTable.createdAt)).limit(1);
  if (!baseline) throw new Error("No persisted accepted 2025 market baseline exists");
  const [events, quotes, baselineEvidence, loadedExamples] = await Promise.all([
    db.select().from(marketBaselineEventsTable).where(eq(marketBaselineEventsTable.runId, baseline.runId)),
    db.select().from(marketBaselineQuotesTable).where(eq(marketBaselineQuotesTable.runId, baseline.runId)),
    db.select().from(modelEvaluationPredictionsTable).where(eq(modelEvaluationPredictionsTable.evaluationRunId, baseline.runId)),
    loadExamples("pregame-v3"),
  ]);
  const examples = [...loadedExamples.examples].sort((left, right) =>
    left.season - right.season
    || left.kickoffTime.getTime() - right.kickoffTime.getTime()
    || left.gameId.localeCompare(right.gameId));
  const eligible = [...new Set(events.flatMap((event) => event.matchedGameId ? [event.matchedGameId] : []))].sort();
  if (!eligible.length) throw new Error("Accepted market baseline has no eligible game IDs");
  const exampleById = new Map(examples.map((row) => [row.gameId, row]));
  const allRows = examples.filter((row) => row.season >= 2021 && row.season <= 2025);
  const evaluationGames = allRows.map((row) => ({
    gameId: row.gameId,
    season: row.season,
    week: row.week,
    kickoffTime: row.kickoffTime,
    homeTeamId: row.homeTeamId,
    awayTeamId: row.awayTeamId,
    finalHomeScore: row.actualHomeScore,
    finalAwayScore: row.actualAwayScore,
  }));
  const contextBatch = await loadPersonnelContextBatch(evaluationGames);
  const contexts = allRows.map((row) => {
    const cutoff = new Date(Math.max(row.homeFeatureSourceCutoff.getTime(), row.awayFeatureSourceCutoff.getTime()) + 1);
    const context = contextBatch.get(row.gameId, cutoff);
    if (!context) throw new Error(`Personnel context unavailable for ${row.gameId} at its prediction cutoff`);
    const sourceCutoff = new Date(context.sourceCutoff);
    if (!(sourceCutoff < row.kickoffTime)) throw new Error(`Personnel chronology violation for ${row.gameId}`);
    return { row, context, sourceCutoff };
  });
  const enriched = new Map(contexts.map((item) => [item.row.gameId, {
    ...item.row,
    personnel: personnelNumericFeatures(item.context),
    sourceCutoff: item.sourceCutoff,
  }]));
  const preflight = buildPersonnelComparisonPreflight(contexts.map((item) => ({
    season: item.row.season,
    kickoffTime: item.row.kickoffTime,
    context: item.context,
  })));
  return { baseline, events, quotes, baselineEvidence, examples, eligible, exampleById, contexts, enriched, preflight };
}

export async function run2025PersonnelComparison(prepared?: PersonnelComparisonPreparation) {
  const preparation = prepared ?? await prepare2025PersonnelComparison();
  const { baseline, quotes, baselineEvidence, examples, eligible, exampleById, contexts, enriched, preflight } = preparation;
  if (preflight.status === "block") throw new Error(preflight.message);
  const predictions: PairedPrediction[] = [];
  const models: Record<string, unknown>[] = [];
  for (const family of Object.keys(CHALLENGER_CONFIG) as Array<keyof typeof CHALLENGER_CONFIG>) {
    const config = CHALLENGER_CONFIG[family];
    const baselineRows = baselineEvidence.filter((row) => row.family === family && eligible.includes(row.gameId))
      .sort((left, right) => left.kickoffTime.getTime() - right.kickoffTime.getTime() || left.gameId.localeCompare(right.gameId));
    const gameIds = baselineRows.map((row) => row.gameId);
    if (new Set(gameIds).size !== gameIds.length) throw new Error(`Duplicate baseline ${family} evidence rows`);
    const trainingExamples = examples.filter((row) =>
      row.season >= 2021
      && row.season <= 2024
      && (family !== "totals" || !row.lowSample));
    const training = enrichedFor(trainingExamples, enriched);
    const holdoutExamples = baselineRows.map((row) => exampleById.get(row.gameId))
      .filter((row): row is Example => Boolean(row));
    if (holdoutExamples.length !== baselineRows.length) {
      throw new Error(`The persisted baseline ${family} evidence contains games without pregame-v3 examples`);
    }
    const holdout = enrichedFor(holdoutExamples, enriched);
    const fitted = fitPersonnelChallenger({
      family,
      algorithm: config.algorithm,
      classification: config.classification,
      training: training.map((row) => ({ ...row, target: config.target(row) })),
      holdout: holdout.map((row) => ({ ...row, target: config.target(row) })),
    });
    const byId = new Map(baselineRows.map((row, index) => [row.gameId, { row, predicted: fitted.predicted[index] }]));
    for (const item of baselineRows) {
      const result = byId.get(item.gameId)!;
      const row = exampleById.get(item.gameId)!;
      const baselinePred = item.predictedValue;
      const marketQuotes = quotes
        .filter((quote) => quote.matchedGameId === item.gameId && quote.family === family)
        .sort((left, right) => left.side.localeCompare(right.side) || (left.point ?? 0) - (right.point ?? 0) || (left.price ?? 0) - (right.price ?? 0))
        .map((quote) => ({ ...quote, point: quote.point, price: quote.price }));
      predictions.push({
        gameId: item.gameId, week: item.week, family, kickoffTime: item.kickoffTime,
        personnelSourceCutoff: enriched.get(item.gameId)!.sourceCutoff,
        actual: config.target(row), baseline: baselinePred, challenger: result.predicted, marketQuotes,
      });
    }
    models.push({ family, modelVersion: `phase7-personnel-${family}-${personnelComparisonFingerprint(fitted).slice(0, 16)}`, featureCount: fitted.featureCount, featureNames: fitted.featureNames });
  }
  const report = buildPersonnelComparisonReport({
    baselineRunId: baseline.runId,
    eligibleGameIds: eligible,
    eligibleGameIdsByFamily: Object.fromEntries((Object.keys(CHALLENGER_CONFIG) as Array<keyof typeof CHALLENGER_CONFIG>).map((family) => [
      family, baselineEvidence.filter((row) => row.family === family && eligible.includes(row.gameId)).map((row) => row.gameId),
    ])) as Partial<Record<MarketFamily, string[]>>,
    minimumRecordedLineEdge: Number((baseline.metadata as Record<string, unknown>)?.minimumRecordedLineEdge ?? 1),
    predictions,
    personnelContexts: contexts.filter((item) => eligible.includes(item.row.gameId)).map((item) => item.context),
  });
  return { ...report, preflight, challengerArtifacts: models, evidenceRows: predictions.length, baselineEvidenceImmutable: true };
}

function enrichedFor(rows: any[], enriched: Map<string, any>) {
  return rows.map((row) => enriched.get(row.gameId)).filter(Boolean).map((item) => ({
    ...item,
    x: item.x,
  }));
}