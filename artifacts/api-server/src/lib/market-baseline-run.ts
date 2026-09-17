import { createHash, randomUUID } from "node:crypto";
import { asc, desc, eq, sql } from "drizzle-orm";
import {
  db,
  marketBaselineEventsTable,
  marketBaselineQuotesTable,
  marketBaselineRunsTable,
  modelEvaluationPredictionsTable,
  modelTrainingRunsTable,
} from "@workspace/db";
import {
  MARKET_BASELINE_SEASON,
  MARKET_BASELINE_SOURCE,
  MARKET_BASELINE_SOURCE_FILES,
  MARKET_BASELINE_SOURCE_URL,
  applyMinimumEdgeSettlement,
  americanOddsProfit,
  assert2025BaselineIsolation,
  canonicalizeBaselineRows,
  hasDuplicateMarketSelections,
  matchHistoricalMarketGame,
  parseNflDataMarketCsv,
  pricingAvailability,
  qualify2025MarketSource,
  settleSpread,
  settleTotal,
  sourceFingerprint,
  summarizeMarketEdges,
  type HistoricalMarketQuote,
  type MarketMatchDiagnostic,
  type Settlement,
} from "./market-baseline";
import {
  PHASE6_VECTOR_FEATURE_NAMES,
  PHASE6_VECTOR_SCHEMA_FINGERPRINT,
  artifactIdentityFor,
  loadExamples,
  mean,
  modelFor,
  standardize,
  type Algorithm,
  type Example,
  type Family,
  type FittedModelArtifact,
  type SamplePolicy,
} from "./modeling";
import { assertModelFittingAllowed } from "./model-runtime-policy";
import { PREGAME_FEATURE_VERSION } from "./features";

const SOURCE_RAW_URL = "https://raw.githubusercontent.com/nflverse/nfldata/master/data/games.csv";
const SOURCE_DATASETS_DOCUMENTATION_URL = "https://raw.githubusercontent.com/nflverse/nfldata/master/DATASETS.md";
const SOURCE_PROVENANCE_DOCUMENTATION_URL = "https://raw.githubusercontent.com/nflverse/nfldata/master/README.md";
const MATCH_CONTRACT_VERSION = 4;
const MINIMUM_RECORDED_LINE_EDGE = 1;
const PHASE6_REFERENCE = {
  spread: { sampleSize: 285, mae: 10.1982, rmse: 13.2414 },
  moneyline: { sampleSize: 285, accuracy: 0.617544, logLoss: 0.633853, brierScore: 0.222487 },
  totals: { sampleSize: 237, mae: 10.8809, rmse: 13.8065 },
} as const;
const SELECTED: Array<{
  family: Family;
  algorithm: Algorithm;
  samplePolicy: SamplePolicy;
  classification: boolean;
  target: (example: Example) => number;
}> = [
  { family: "spread", algorithm: "linear_regression", samplePolicy: "include_low_sample", classification: false, target: (row) => row.margin },
  { family: "moneyline", algorithm: "logistic_regression", samplePolicy: "include_low_sample", classification: true, target: (row) => row.homeWin },
  { family: "totals", algorithm: "gradient_boosting", samplePolicy: "exclude_low_sample", classification: false, target: (row) => row.total },
];

function clamp(value: number) {
  return Math.max(0.001, Math.min(0.999, value));
}

function metrics(family: Family, rows: Example[], predicted: number[]) {
  const actual = rows.map((row) => family === "spread" ? row.margin : family === "totals" ? row.total : row.homeWin);
  if (family === "moneyline") {
    return {
      sampleSize: rows.length,
      accuracy: mean(actual.map((value, index) => (predicted[index] >= 0.5 ? 1 : 0) === value ? 1 : 0)),
      brierScore: mean(actual.map((value, index) => (predicted[index] - value) ** 2)),
      logLoss: -mean(actual.map((value, index) => value * Math.log(clamp(predicted[index])) + (1 - value) * Math.log(clamp(1 - predicted[index])))),
    };
  }
  return {
    sampleSize: rows.length,
    mae: mean(actual.map((value, index) => Math.abs(predicted[index] - value))),
    rmse: Math.sqrt(mean(actual.map((value, index) => (predicted[index] - value) ** 2))),
  };
}

function hyperparameters(algorithm: Algorithm) {
  if (algorithm === "linear_regression") return { ridgeLambda: 1 };
  if (algorithm === "logistic_regression") return { epochs: 350, learningRate: 0.08, coefficientRegularization: 0.02 };
  return { rounds: 8, depth: 2, learningRate: 0.08, minLeafSamples: 5 };
}

function artifactChecksum(value: unknown) {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

export async function fetch2025MarketSource() {
  const requests = await Promise.all([
    fetch(SOURCE_RAW_URL),
    fetch(SOURCE_DATASETS_DOCUMENTATION_URL),
    fetch(SOURCE_PROVENANCE_DOCUMENTATION_URL),
  ]);
  const labels = ["games.csv", "DATASETS.md", "README.md"];
  for (const [index, response] of requests.entries()) {
    if (!response.ok) throw new Error(`Historical market source ${labels[index]} request failed with HTTP ${response.status}`);
  }
  const [csv, datasetsDocumentation, provenanceDocumentation] = await Promise.all(requests.map((response) => response.text()));
  return { csv, datasetsDocumentation, provenanceDocumentation };
}

type BaselineBuild = Awaited<ReturnType<typeof build2025MarketBaseline>>;

export async function build2025MarketBaseline(csv: string, featureVersion = PREGAME_FEATURE_VERSION) {
  assertModelFittingAllowed("2025 evaluation-only market baseline");
  const quotes = parseNflDataMarketCsv(csv);
  if (!quotes.length) throw new Error("The qualified source contains no 2025 recorded market rows");
  const { examples } = await loadExamples(featureVersion);
  const training = canonicalizeBaselineRows(examples.filter((row) => row.season >= 2021 && row.season <= 2024));
  const holdout = canonicalizeBaselineRows(examples.filter((row) => row.season === MARKET_BASELINE_SEASON));
  if ([...new Set(training.map((row) => row.season))].join(",") !== "2021,2022,2023,2024") {
    throw new Error("The 2025 baseline requires complete 2021-2024 training seasons");
  }
  if (examples.some((row) => row.season > MARKET_BASELINE_SEASON && (training.includes(row) || holdout.includes(row)))) {
    throw new Error("Forward-season evidence entered the 2025 baseline");
  }
  const baselineGames = holdout.map((game) => ({
    gameId: game.gameId,
    season: game.season,
    week: game.week,
    kickoffTime: game.kickoffTime,
    homeAbbreviation: game.homeTeamAbbreviation,
    awayAbbreviation: game.awayTeamAbbreviation,
  }));
  const firstQuoteBySource = new Map<string, HistoricalMarketQuote>();
  for (const quote of quotes) if (!firstQuoteBySource.has(quote.sourceGameId)) firstQuoteBySource.set(quote.sourceGameId, quote);
  const sourceGroups = new Map<string, HistoricalMarketQuote[]>();
  for (const quote of quotes) sourceGroups.set(quote.sourceGameId, [...(sourceGroups.get(quote.sourceGameId) ?? []), quote]);
  const diagnostics = [...firstQuoteBySource.values()].map((quote) => {
    if (hasDuplicateMarketSelections(sourceGroups.get(quote.sourceGameId) ?? [])) {
      return {
        sourceGameId: quote.sourceGameId, altGameId: quote.altGameId, outcome: "duplicate" as const,
        matchedGameId: null, candidateGameIds: [], aliasUsed: false,
        reason: "duplicate family/side selections make the source event non-deterministic",
      };
    }
    return matchHistoricalMarketGame(quote, baselineGames);
  });
  const diagnosticBySource = new Map(diagnostics.map((row) => [row.sourceGameId, row]));
  const eligibleQuotes = quotes.filter((quote) => diagnosticBySource.get(quote.sourceGameId)?.matchedGameId != null);
  const eligibleGameIds = new Set(diagnostics.flatMap((row) => row.matchedGameId ? [row.matchedGameId] : []));
  const quotesByGame = new Map<string, HistoricalMarketQuote[]>();
  for (const quote of eligibleQuotes) {
    const matched = diagnosticBySource.get(quote.sourceGameId)?.matchedGameId;
    if (matched) quotesByGame.set(matched, [...(quotesByGame.get(matched) ?? []), quote]);
  }
  const evaluationInputFingerprint = artifactChecksum({
    featureVersion,
    vectorSchemaFingerprint: PHASE6_VECTOR_SCHEMA_FINGERPRINT,
    training,
    holdout,
    eligibleGameIds: [...eligibleGameIds].sort(),
  });
  const evaluationRunId = `phase6-1-2025-market-baseline-v${MATCH_CONTRACT_VERSION}-${sourceFingerprint(csv).slice(0, 12)}-${evaluationInputFingerprint.slice(0, 12)}`;
  const bundles = [];
  for (const config of SELECTED) {
    const trainRows = training.filter((row) => config.samplePolicy === "include_low_sample" || !row.lowSample);
    const testRows = holdout.filter((row) =>
      eligibleGameIds.has(row.gameId) && (config.samplePolicy === "include_low_sample" || !row.lowSample));
    const scaled = standardize(trainRows.map((row) => row.x), testRows.map((row) => row.x));
    const model = modelFor(config.algorithm, scaled.train, trainRows.map(config.target), config.classification);
    const predicted = scaled.test.map((row) => config.classification ? clamp(model.predict(row)) : model.predict(row));
    if (!predicted.every(Number.isFinite)) throw new Error(`${config.family} produced a non-finite holdout prediction`);
    const bareArtifact: FittedModelArtifact = {
      version: 1, algorithm: config.algorithm, centers: scaled.centers, scales: scaled.scales, model: model.artifact,
    };
    const metadata = artifactIdentityFor(bareArtifact, {
      family: config.family,
      algorithm: config.algorithm,
      featureVersion,
      vectorFeatureNames: [...PHASE6_VECTOR_FEATURE_NAMES],
      vectorSchemaFingerprint: PHASE6_VECTOR_SCHEMA_FINGERPRINT,
      trainingSeasons: [2021, 2022, 2023, 2024],
      trainingCutoff: "through-2024",
      samplePolicy: config.samplePolicy,
      hyperparameters: hyperparameters(config.algorithm),
      randomSeed: null,
      trainingSampleCount: trainRows.length,
    });
    const artifact = { ...bareArtifact, metadata };
    const modelVersion = `phase6-1-2025-baseline-v${MATCH_CONTRACT_VERSION}-${config.family}-${metadata.artifactChecksum.slice(0, 12)}-${sourceFingerprint(csv).slice(0, 8)}-${evaluationInputFingerprint.slice(0, 8)}`;
    const run = {
      modelVersion,
      family: config.family,
      algorithm: config.algorithm,
      featureVersion,
      trainingSeasons: [2021, 2022, 2023, 2024],
      testSeason: 2025,
      samplePolicy: config.samplePolicy,
      recencyWeighting: "none",
      status: "evaluation_baseline",
      sampleSize: testRows.length,
      metrics: metrics(config.family, testRows, predicted),
      calibration: { status: config.family === "moneyline" ? "calculated_from_immutable_evidence" : "not_applicable" },
      featureImportance: {},
      vectorFeatureNames: [...PHASE6_VECTOR_FEATURE_NAMES],
      vectorSchemaFingerprint: PHASE6_VECTOR_SCHEMA_FINGERPRINT,
      modelArtifact: artifact,
      notes: "Evaluation-only through-2024 fit against the fixed 2025 game set. No production model, snapshot, promotion, market, personnel, or Sleeper input.",
    } satisfies typeof modelTrainingRunsTable.$inferInsert;
    const evidence = testRows.map((row, index) => {
      const predictionCutoff = new Date(Math.max(row.homeFeatureSourceCutoff.getTime(), row.awayFeatureSourceCutoff.getTime()) + 1);
      return {
        evaluationRunId, modelVersion, family: config.family, algorithm: config.algorithm, featureVersion,
        testSeason: 2025, week: row.week, evaluationStage: "season_holdout", gameId: row.gameId,
        kickoffTime: row.kickoffTime, predictionCutoff, trainingSeasons: [2021, 2022, 2023, 2024],
        trainingCutoff: "through-2024", gameStage: row.gameStage, homeTeamId: row.homeTeamId,
        awayTeamId: row.awayTeamId, homeFeatureSourceCutoff: row.homeFeatureSourceCutoff,
        awayFeatureSourceCutoff: row.awayFeatureSourceCutoff, lowSample: row.lowSample,
        predictedValue: predicted[index], actualValue: config.target(row), actualHomeScore: row.actualHomeScore,
        actualAwayScore: row.actualAwayScore, actualMargin: row.margin, actualTotal: row.total,
        actualHomeWin: row.homeWin, projectedHomeWinProbability: config.family === "moneyline" ? predicted[index] : null,
        projectedAwayWinProbability: config.family === "moneyline" ? 1 - predicted[index] : null,
        projectedMargin: config.family === "spread" ? predicted[index] : null,
        projectedTotal: config.family === "totals" ? predicted[index] : null,
        marketSportsbook: null, marketName: null, marketSelection: null, marketSide: null,
        marketPoint: null, marketPrice: null, marketObservedAt: null, marketEvidence: null,
        closingMarketEvidence: null,
      } satisfies typeof modelEvaluationPredictionsTable.$inferInsert;
    });
    assert2025BaselineIsolation({
      featureVersion,
      vectorFeatureNames: [...PHASE6_VECTOR_FEATURE_NAMES],
      trainingSeasons: [2021, 2022, 2023, 2024],
      testSeason: 2025,
      chronology: evidence.flatMap((row) => [
        { featureCutoff: row.homeFeatureSourceCutoff, predictionCutoff: row.predictionCutoff, kickoffTime: row.kickoffTime },
        { featureCutoff: row.awayFeatureSourceCutoff, predictionCutoff: row.predictionCutoff, kickoffTime: row.kickoffTime },
      ]),
    });
    bundles.push({ run, evidence });
  }
  return {
    evaluationRunId,
    sourceFingerprint: sourceFingerprint(csv),
    evaluationInputFingerprint,
    sourceRows: firstQuoteBySource.size,
    quotes,
    diagnostics,
    eligibleQuotes,
    bundles,
  };
}

export async function persist2025MarketBaseline(build: BaselineBuild) {
  let created = false;
  await db.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${build.evaluationRunId}))`);
    const existing = await tx.select({ runId: marketBaselineRunsTable.runId }).from(marketBaselineRunsTable)
      .where(eq(marketBaselineRunsTable.runId, build.evaluationRunId)).limit(1);
    if (existing.length) return;
    await tx.insert(marketBaselineRunsTable).values({
      runId: build.evaluationRunId, season: 2025, source: MARKET_BASELINE_SOURCE,
      sourceUrl: MARKET_BASELINE_SOURCE_URL, sourceFiles: [...MARKET_BASELINE_SOURCE_FILES],
      sourceFingerprints: { "games.csv": build.sourceFingerprint }, status: "complete",
      metadata: {
        sourceDesignation: "source_designated_recorded", closingStatus: "unavailable",
        sportsbookStatus: "unavailable", timestampStatus: "unavailable",
        matchContractVersion: MATCH_CONTRACT_VERSION,
        evaluationInputFingerprint: build.evaluationInputFingerprint,
        quoteCount: build.quotes.length, eventCount: build.sourceRows,
         minimumRecordedLineEdge: MINIMUM_RECORDED_LINE_EDGE,
         edgeBuckets: ["<1", "1-1.99", "2-2.99", "3-4.99", "5+"],
         grading: "final scores only",
      },
    });
    await tx.insert(marketBaselineEventsTable).values(build.diagnostics.map((row) => ({
      runId: build.evaluationRunId, sourceGameId: row.sourceGameId, altGameId: row.altGameId,
      outcome: row.outcome, reason: row.reason, candidateGameIds: row.candidateGameIds,
      matchedGameId: row.matchedGameId, aliasUsed: row.aliasUsed,
    })));
    const diagnosticBySource = new Map(build.diagnostics.map((row) => [row.sourceGameId, row]));
    for (let index = 0; index < build.quotes.length; index += 500) {
      await tx.insert(marketBaselineQuotesTable).values(build.quotes.slice(index, index + 500).map((quote) => ({
        runId: build.evaluationRunId, sourceGameId: quote.sourceGameId, altGameId: quote.altGameId,
        matchedGameId: diagnosticBySource.get(quote.sourceGameId)?.matchedGameId ?? null,
        sourceFile: quote.sourceFile, family: quote.family, side: quote.side, point: quote.point,
        price: quote.price, sourceDesignation: quote.sourceDesignation, sportsbook: quote.sportsbook,
        observedAt: quote.observedAt, sourceTimestamp: quote.sourceTimestamp, sourceOutcome: quote.sourceOutcome,
      })));
    }
    for (const bundle of build.bundles) {
      await tx.insert(modelTrainingRunsTable).values(bundle.run);
      for (let index = 0; index < bundle.evidence.length; index += 500) {
        await tx.insert(modelEvaluationPredictionsTable).values(bundle.evidence.slice(index, index + 500));
      }
    }
    created = true;
  });
  return { evaluationRunId: build.evaluationRunId, created };
}

function summarizeSettlements(values: Settlement[]) {
  const wins = values.filter((value) => value === "win").length;
  const losses = values.filter((value) => value === "loss").length;
  const pushes = values.filter((value) => value === "push").length;
  return { wins, losses, pushes, noBets: values.filter((value) => value === "no_bet").length, winRate: wins + losses ? wins / (wins + losses) : null };
}

function directionCounts(rows: Array<{ quote: HistoricalMarketQuote; settlement: Settlement }>) {
  const recommendations = rows.filter((row) => row.settlement !== "no_bet");
  return {
    home: recommendations.filter((row) => row.quote.side === "home").length,
    away: recommendations.filter((row) => row.quote.side === "away").length,
    over: recommendations.filter((row) => row.quote.side === "over").length,
    under: recommendations.filter((row) => row.quote.side === "under").length,
    noBet: rows.length - recommendations.length,
  };
}

function moneylineCalibration(rows: Array<{ predictedValue: number; actualHomeWin: number }>) {
  return Array.from({ length: 10 }, (_, index) => {
    const min = index / 10;
    const max = (index + 1) / 10;
    const values = rows.filter((row) =>
      row.predictedValue >= min && (index === 9 ? row.predictedValue <= max : row.predictedValue < max));
    return {
      bucket: `${Math.round(min * 100)}-${Math.round(max * 100)}%`,
      sampleSize: values.length,
      averagePrediction: values.length ? mean(values.map((row) => row.predictedValue)) : null,
      actualHomeWinRate: values.length ? mean(values.map((row) => row.actualHomeWin)) : null,
    };
  });
}

function phase6ReferenceDeltas(family: Family, values: Record<string, unknown>) {
  const reference = PHASE6_REFERENCE[family] as Record<string, number>;
  return Object.fromEntries(Object.entries(reference)
    .filter(([metric]) => metric !== "sampleSize" && typeof values[metric] === "number")
    .map(([metric, value]) => [metric, (values[metric] as number) - value]));
}

export function report2025MarketBaseline(build: BaselineBuild) {
  const quoteKey = (gameId: string, family: string, side: string) => `${gameId}:${family}:${side}`;
  const diagnostics = new Map(build.diagnostics.map((row) => [row.sourceGameId, row]));
  const quotes = new Map<string, HistoricalMarketQuote>();
  for (const quote of build.eligibleQuotes) {
    const gameId = diagnostics.get(quote.sourceGameId)?.matchedGameId;
    if (gameId) quotes.set(quoteKey(gameId, quote.family, quote.side), quote);
  }
  const models = build.bundles.map((bundle) => {
    const family = bundle.run.family as Family;
    const marketRows = bundle.evidence.flatMap((row) => {
      if (family === "moneyline") return [];
      const homeSide = family === "spread" ? "home" : "over";
      const awaySide = family === "spread" ? "away" : "under";
      const first = quotes.get(quoteKey(row.gameId, family, homeSide));
      const second = quotes.get(quoteKey(row.gameId, family, awaySide));
      const choices = [first, second].filter(Boolean) as HistoricalMarketQuote[];
      if (!choices.length) return [];
      const scored = choices.map((quote) => {
        const edge = family === "spread"
          ? quote.side === "home" ? row.predictedValue + (quote.point ?? 0) : (quote.point ?? 0) - row.predictedValue
          : quote.side === "over" ? row.predictedValue - (quote.point ?? 0) : (quote.point ?? 0) - row.predictedValue;
        const settlement = family === "spread"
          ? settleSpread(row.actualMargin, quote.point, quote.side as "home" | "away")
          : settleTotal(row.actualTotal, quote.point, quote.side as "over" | "under");
        return { quote, edge, settlement, error: Math.abs(row.predictedValue - row.actualValue) };
      });
      const best = scored.reduce((current, value) => value.edge > current.edge ? value : current);
      return [{
        ...best,
        settlement: applyMinimumEdgeSettlement(best.settlement, best.edge, MINIMUM_RECORDED_LINE_EDGE),
        week: row.week,
      }];
    });
    const weekly = [...new Set(bundle.evidence.map((row) => row.week))].sort((a, b) => a - b).map((week) => {
      const rows = bundle.evidence.filter((row) => row.week === week);
      return { week, ...metrics(family, rows.map((row) => ({
        margin: row.actualMargin, total: row.actualTotal, homeWin: row.actualHomeWin,
      } as Example)), rows.map((row) => row.predictedValue)) };
    });
    const ordered = [...bundle.evidence].sort((left, right) => left.week - right.week || left.gameId.localeCompare(right.gameId));
    const cumulative = [...new Set(ordered.map((row) => row.week))].map((week) => {
      const rows = ordered.filter((row) => row.week <= week);
      return {
        throughWeek: week,
        ...metrics(family, rows.map((item) => ({
          margin: item.actualMargin, total: item.actualTotal, homeWin: item.actualHomeWin,
        } as Example)), rows.map((item) => item.predictedValue)),
      };
    });
    const betRows = marketRows.filter((row) => row.settlement !== "no_bet");
    const returns = betRows.map((row) => {
      const profit = americanOddsProfit(row.quote.price);
      return profit === null || row.settlement === "no_bet" ? null
        : row.settlement === "push" ? 0 : row.settlement === "win" ? profit : -1;
    }).filter((value): value is number => value !== null);
    const weeklyMarket = family === "moneyline" ? [] : [...new Set(marketRows.map((row) => row.week))]
      .sort((a, b) => a - b)
      .map((week) => ({
        week,
        averageAbsoluteEdge: mean(marketRows.filter((row) => row.week === week).map((row) => Math.abs(row.edge))),
        directions: directionCounts(marketRows.filter((row) => row.week === week)),
        ...summarizeSettlements(marketRows.filter((row) => row.week === week).map((row) => row.settlement)),
      }));
    const cumulativeMarket = family === "moneyline" ? [] : [...new Set(marketRows.map((row) => row.week))]
      .sort((a, b) => a - b)
      .map((week) => {
        const rows = marketRows.filter((row) => row.week <= week);
        return {
          throughWeek: week,
          averageAbsoluteEdge: mean(rows.map((row) => Math.abs(row.edge))),
          directions: directionCounts(rows),
          ...summarizeSettlements(rows.map((row) => row.settlement)),
        };
      });
    const comparable = bundle.evidence.flatMap((row) => {
      if (family === "spread") {
        const quote = quotes.get(quoteKey(row.gameId, family, "home"));
        return quote?.point == null ? [] : [{ actual: row.actualMargin, predicted: -quote.point }];
      }
      if (family === "totals") {
        const quote = quotes.get(quoteKey(row.gameId, family, "over"));
        return quote?.point == null ? [] : [{ actual: row.actualTotal, predicted: quote.point }];
      }
      const home = quotes.get(quoteKey(row.gameId, family, "home"));
      const away = quotes.get(quoteKey(row.gameId, family, "away"));
      const homeProfit = americanOddsProfit(home?.price ?? null);
      const awayProfit = americanOddsProfit(away?.price ?? null);
      if (homeProfit === null || awayProfit === null) return [];
      const rawHome = 1 / (1 + homeProfit);
      const rawAway = 1 / (1 + awayProfit);
      return [{ actual: row.actualHomeWin, predicted: rawHome / (rawHome + rawAway), home, away, row }];
    });
    const recordedMarketAccuracy = family === "moneyline"
      ? {
          status: comparable.length ? "measured_from_recorded_prices" : "unavailable",
          sampleSize: comparable.length,
          accuracy: comparable.length ? mean(comparable.map((item) => (item.predicted >= 0.5 ? 1 : 0) === item.actual ? 1 : 0)) : null,
          brierScore: comparable.length ? mean(comparable.map((item) => (item.predicted - item.actual) ** 2)) : null,
          logLoss: comparable.length ? -mean(comparable.map((item) => item.actual * Math.log(clamp(item.predicted)) + (1 - item.actual) * Math.log(clamp(1 - item.predicted)))) : null,
        }
      : {
          status: comparable.length ? "measured_from_recorded_line" : "unavailable",
          sampleSize: comparable.length,
          mae: comparable.length ? mean(comparable.map((item) => Math.abs(item.predicted - item.actual))) : null,
          rmse: comparable.length ? Math.sqrt(mean(comparable.map((item) => (item.predicted - item.actual) ** 2))) : null,
        };
    const moneylineComparable = comparable as Array<{
      actual: number;
      predicted: number;
      home?: HistoricalMarketQuote;
      away?: HistoricalMarketQuote;
      row?: { predictedValue: number; actualHomeWin: number };
    }>;
    const moneylineReturns = family === "moneyline" ? moneylineComparable.flatMap((item) => {
      if (!item.row || !item.home || !item.away) return [];
      const chooseHome = item.row.predictedValue >= 0.5;
      const quote = chooseHome ? item.home : item.away;
      const won = chooseHome ? item.row.actualHomeWin === 1 : item.row.actualHomeWin === 0;
      const profit = americanOddsProfit(quote.price);
      return profit === null ? [] : [won ? profit : -1];
    }) : [];
    return {
      modelVersion: bundle.run.modelVersion,
      artifactChecksum: (bundle.run.modelArtifact as FittedModelArtifact).metadata?.artifactChecksum ?? artifactChecksum(bundle.run.modelArtifact),
      family,
      sampleSize: bundle.evidence.length,
      metrics: bundle.run.metrics,
      phase6Reference: {
        reference: PHASE6_REFERENCE[family],
        metricDeltas: phase6ReferenceDeltas(family, bundle.run.metrics),
        eligibilityDifference: {
          referenceSampleSize: PHASE6_REFERENCE[family].sampleSize,
          baselineSampleSize: bundle.evidence.length,
          excludedNeutralSiteGames: 8,
          note: "The retained Phase 6 reference used the full evaluable corpus; this market baseline uses only matched non-neutral games.",
        },
      },
      weekly,
      cumulative,
      calibration: family === "moneyline" ? moneylineCalibration(bundle.evidence) : null,
      market: family === "moneyline"
        ? {
            status: "recorded_price_baseline",
            recordedMarketAccuracy,
            modelPriceAwareReturn: moneylineReturns.length
              ? { status: "available", sampleSize: moneylineReturns.length, units: moneylineReturns.reduce((sum, value) => sum + value, 0), roi: mean(moneylineReturns) }
              : { status: "unavailable" },
            note: "Moneyline probability and returns use retained recorded prices; they are not closing-price or CLV claims.",
          }
        : {
            status: marketRows.length ? "measured_against_recorded_line" : "unavailable",
            sampleSize: marketRows.length,
            recordedMarketAccuracy,
            settlement: summarizeSettlements(marketRows.map((row) => row.settlement)),
            directions: directionCounts(marketRows),
            weekly: weeklyMarket,
            cumulative: cumulativeMarket,
            edgeBuckets: summarizeMarketEdges(marketRows),
            priceAwareReturn: betRows.length && returns.length === betRows.length
              ? { status: "available", sampleSize: returns.length, units: returns.reduce((sum, value) => sum + value, 0), roi: mean(returns) }
              : { status: returns.length ? "partial" : "unavailable" },
          },
    };
  });
  const outcomeCounts = Object.fromEntries([...new Set(build.diagnostics.map((row) => row.outcome))]
    .map((outcome) => [outcome, build.diagnostics.filter((row) => row.outcome === outcome).length]));
  return {
    evaluationRunId: build.evaluationRunId,
    season: 2025,
    source: {
      name: MARKET_BASELINE_SOURCE, url: MARKET_BASELINE_SOURCE_URL, file: "games.csv",
      fingerprintSha256: build.sourceFingerprint, designation: "source_designated_recorded",
      license: "Repository data is publicly distributed by nflverse; upstream data ownership remains with its respective owners.",
      closingStatus: "unavailable",
    },
    coverage: { sourceEvents: build.sourceRows, quotes: build.quotes.length, matchingOutcomes: outcomeCounts },
    chronology: { trainingSeasons: [2021, 2022, 2023, 2024], testSeason: 2025, forwardSeasonsExcluded: [2026], featureVersion: PREGAME_FEATURE_VERSION },
    models,
    pricing: pricingAvailability(build.eligibleQuotes),
    closingMarketBaseline: { status: "unavailable", reason: "The source does not designate its values as closing lines or prices." },
    clv: { status: "unavailable", reason: "The retained source has no provenance-matched earlier and closing timestamps. Model-versus-recorded-line differences are not CLV." },
    suitability: {
      status: "insufficient_for_threshold_recommendation",
      reason: "Edge-bucket samples are small, confidence intervals are wide, and no betting threshold was pre-registered. Results are descriptive only.",
    },
    productionMutation: false,
    reusableComparisonContract: {
      evaluationRunId: build.evaluationRunId,
      gameSet: "matched non-neutral 2025 games",
      edgeBuckets: ["<1", "1-1.99", "2-2.99", "3-4.99", "5+"],
      minimumRecordedLineEdge: MINIMUM_RECORDED_LINE_EDGE,
      grading: "final scores only",
    },
  };
}

export async function run2025MarketBaseline(csv?: string) {
  const source = await fetch2025MarketSource();
  if (csv !== undefined) source.csv = csv;
  qualify2025MarketSource(source);
  const build = await build2025MarketBaseline(source.csv);
  const persistence = await persist2025MarketBaseline(build);
  return { ...persistence, report: report2025MarketBaseline(build) };
}

export async function get2025MarketBaselineReport(runId?: string) {
  const [run] = await db.select().from(marketBaselineRunsTable)
    .where(runId ? eq(marketBaselineRunsTable.runId, runId) : eq(marketBaselineRunsTable.season, 2025))
    .orderBy(runId ? asc(marketBaselineRunsTable.createdAt) : desc(marketBaselineRunsTable.createdAt)).limit(1);
  if (!run) return { status: "unavailable", reason: "No persisted 2025 market baseline exists." };
  const [events, quotes, evidence] = await Promise.all([
    db.select().from(marketBaselineEventsTable).where(eq(marketBaselineEventsTable.runId, run.runId)),
    db.select().from(marketBaselineQuotesTable).where(eq(marketBaselineQuotesTable.runId, run.runId)),
    db.select().from(modelEvaluationPredictionsTable).where(eq(modelEvaluationPredictionsTable.evaluationRunId, run.runId)),
  ]);
  return { status: "measured", run, events, quotes, evidence, immutable: true, productionMutation: false };
}
