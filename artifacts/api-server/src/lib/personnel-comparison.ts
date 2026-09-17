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
import { getPersonnelContextForGame } from "./personnel-context";
import { personnelNumericFeatures } from "./personnel-context-derivation";
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
  const variance = mean(deltas.map((value) => (value - average) ** 2));
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

function edgeSummary(rows: PairedPrediction[], minimumEdge: number) {
  return MARKET_EDGE_BUCKETS.map((bucket) => {
    const values = rows.flatMap((row) => {
      const choices = (row.marketQuotes ?? []).map((quote) => {
        const edge = row.family === "spread"
          ? quote.side === "home" ? row.challenger + (quote.point ?? 0) : (quote.point ?? 0) - row.challenger
          : quote.side === "over" ? row.challenger - (quote.point ?? 0) : (quote.point ?? 0) - row.challenger;
        const settlement: Settlement = row.family === "spread"
          ? settleSpread(row.actual, quote.point, quote.side as "home" | "away")
          : settleTotal(row.actual, quote.point, quote.side as "over" | "under");
        return { edge, settlement, error: Math.abs(row.challenger - row.actual) };
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

export function buildPersonnelComparisonReport(input: {
  baselineRunId: string;
  eligibleGameIds: string[];
  eligibleGameIdsByFamily?: Partial<Record<MarketFamily, string[]>>;
  minimumRecordedLineEdge: number;
  predictions: PairedPrediction[];
}) {
  const expected = new Set(input.eligibleGameIds);
  for (const family of new Set(input.predictions.map((row) => row.family))) {
    const expectedFamily = new Set(input.eligibleGameIdsByFamily?.[family] ?? input.eligibleGameIds);
    const actualFamily = input.predictions.filter((row) => row.family === family).map((row) => row.gameId);
    if (actualFamily.length !== expectedFamily.size || new Set(actualFamily).size !== actualFamily.length
      || [...expectedFamily].some((id) => !actualFamily.includes(id))) {
      throw new Error(`Personnel challenger ${family} predictions must use exactly one row per baseline game`);
    }
  }
  assertPersonnelChronology(input.predictions.map((row) => ({
    kickoffTime: row.kickoffTime,
    sourceCutoff: row.personnelSourceCutoff,
  })));
  const families = [...new Set(input.predictions.map((row) => row.family))];
  const models = families.map((family) => {
    const rows = input.predictions.filter((row) => row.family === family);
    const baselineMetrics = metrics(rows, (row) => row.baseline);
    const challengerMetrics = metrics(rows, (row) => row.challenger);
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
    return {
      family,
      sampleSize: rows.length,
      baseline: baselineMetrics,
      challenger: challengerMetrics,
      pairedDelta,
      weekly: weeks.map((week) => {
        const weekly = rows.filter((row) => row.week === week);
        return { week, baseline: metrics(weekly, (row) => row.baseline), challenger: metrics(weekly, (row) => row.challenger) };
      }),
      cumulative: weeks.map((week) => {
        const cumulative = rows.filter((row) => row.week <= week);
        return { throughWeek: week, baseline: metrics(cumulative, (row) => row.baseline), challenger: metrics(cumulative, (row) => row.challenger) };
      }),
      calibration: family === "moneyline" ? [0, 10, 20, 30, 40, 50, 60, 70, 80, 90].map((min) => {
        const bucket = rows.filter((row) => row.challenger * 100 >= min && row.challenger * 100 < min + 10);
        return { bucket: `${min}-${min + 10}%`, sampleSize: bucket.length, averagePrediction: bucket.length ? mean(bucket.map((row) => row.challenger)) : null, actualHomeWinRate: bucket.length ? mean(bucket.map((row) => row.actual)) : null };
      }) : null,
      market: family === "moneyline" ? null : {
        edgeBuckets: edgeSummary(rows, input.minimumRecordedLineEdge),
        note: "Small edge buckets are descriptive only; no threshold is recommended.",
      },
    };
  });
  return {
    comparisonVersion: PERSONNEL_COMPARISON_VERSION,
    baselineRunId: input.baselineRunId,
    gameSet: {
      eligibleGameCount: expected.size,
      challengerGameCount: new Set(input.predictions.map((row) => row.gameId)).size,
      exactMatch: true,
      perFamily: Object.fromEntries([...new Set(input.predictions.map((row) => row.family))].map((family) => [
        family, { baseline: (input.eligibleGameIdsByFamily?.[family] ?? input.eligibleGameIds).length, challenger: input.predictions.filter((row) => row.family === family).length },
      ])),
    },
    chronology: { trainingSeasons: [2021, 2022, 2023, 2024], testSeason: 2025, personnelCutoff: "strictly-before-kickoff", vectorFeatureNames: [...PERSONNEL_VECTOR_FEATURE_NAMES] },
    models,
    suitability: { status: "insufficient_for_threshold_recommendation", reason: "Paired uncertainty intervals are descriptive; small edge buckets and no pre-registered threshold prevent a betting recommendation." },
    productionMutation: false,
    immutable: true,
  };
}

export function personnelComparisonFingerprint(report: unknown) {
  return createHash("sha256").update(JSON.stringify(report)).digest("hex");
}

async function bounded<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>) {
  const result: R[] = [];
  let cursor = 0;
  const worker = async () => {
    while (cursor < items.length) {
      const index = cursor++;
      result[index] = await fn(items[index]);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return result;
}

const CHALLENGER_CONFIG = {
  spread: { algorithm: "linear_regression" as const, classification: false, target: (row: any) => row.margin },
  moneyline: { algorithm: "logistic_regression" as const, classification: true, target: (row: any) => row.homeWin },
  totals: { algorithm: "gradient_boosting" as const, classification: false, target: (row: any) => row.total },
};

export async function run2025PersonnelComparison() {
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
  const examples = loadedExamples.examples;
  const eligible = [...new Set(events.flatMap((event) => event.matchedGameId ? [event.matchedGameId] : []))].sort();
  if (!eligible.length) throw new Error("Accepted market baseline has no eligible game IDs");
  const exampleById = new Map(examples.map((row) => [row.gameId, row]));
  const allRows = examples.filter((row) => row.season >= 2021 && row.season <= 2025);
  const contexts = await bounded(allRows, 8, async (row) => {
    const cutoff = new Date(Math.max(row.homeFeatureSourceCutoff.getTime(), row.awayFeatureSourceCutoff.getTime()) + 1);
    const context = await getPersonnelContextForGame(row.gameId, cutoff);
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
  const quoteByKey = new Map(quotes.map((quote) => [`${quote.matchedGameId}:${quote.family}:${quote.side}`, quote]));
  const predictions: PairedPrediction[] = [];
  const models: Record<string, unknown>[] = [];
  for (const family of Object.keys(CHALLENGER_CONFIG) as Array<keyof typeof CHALLENGER_CONFIG>) {
    const config = CHALLENGER_CONFIG[family];
    const baselineRows = baselineEvidence.filter((row) => row.family === family && eligible.includes(row.gameId));
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
      const marketQuotes = family === "moneyline" ? undefined : quotes
        .filter((quote) => quote.matchedGameId === item.gameId && quote.family === family)
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
  });
  return { ...report, models, evidenceRows: predictions.length, baselineEvidenceImmutable: true };
}

function enrichedFor(rows: any[], enriched: Map<string, any>) {
  return rows.map((row) => enriched.get(row.gameId)).filter(Boolean).map((item) => ({
    ...item,
    x: item.x,
  }));
}