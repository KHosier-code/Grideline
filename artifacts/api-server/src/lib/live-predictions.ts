import { and, asc, desc, eq, inArray, lte, sql } from "drizzle-orm";
import {
  db,
  gamesTable,
  modelPromotionHistoryTable,
  modelTrainingRunsTable,
  predictionGradesTable,
  predictionSnapshotsTable,
  predictionValidationFailuresTable,
  pregameTeamFeaturesTable,
  sportsbookOddsTable,
  teamsTable,
  weeklyLearningReportsTable,
  type PregameFeatureValues,
} from "@workspace/db";
import { safeNoVigProbabilities, validatePredictionOutputs } from "./prediction-validation";
import {
  loadExamples,
  mean,
  modelFor,
  sourceFeatureNames,
  standardize,
  type Algorithm,
  type Example,
  type Family,
  type SamplePolicy,
} from "./modeling";
import { PREGAME_FEATURE_VERSION } from "./features";

type ProductionModel = {
  family: Family;
  modelVersion: string;
  algorithm: Algorithm;
  featureVersion: string;
  trainingSeasons: number[];
  samplePolicy: SamplePolicy;
  recencyWeighting: string;
  trainingCutoff: string;
  promotedAt: Date;
};

type Quote = {
  sportsbook: string;
  market: string;
  selection: string;
  point: number | null;
  price: number;
  capturedAt: Date;
};

function clamp(value: number, min = 0.001, max = 0.999) {
  return Math.max(min, Math.min(max, value));
}

function impliedProbability(price: number) {
  return price >= 0 ? 100 / (price + 100) : -price / (-price + 100);
}

function normalize(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]/g, "");
}

function selectionIsHome(selection: string, home: { teamId: string; name: string; abbreviation: string }) {
  const value = normalize(selection);
  return [home.teamId, home.name, home.abbreviation].some((candidate) => {
    const normalized = normalize(candidate);
    return normalized.length > 2 && (value.includes(normalized) || normalized.includes(value));
  });
}

function marketPoint(quote: Quote, market: string, home: { teamId: string; name: string; abbreviation: string }) {
  if (quote.point === null || market !== "spread") return quote.point;
  return selectionIsHome(quote.selection, home) ? quote.point : -quote.point;
}

function serializeQuote(quote: Quote, point: number | null = quote.point) {
  return {
    sportsbook: quote.sportsbook,
    market: quote.market,
    selection: quote.selection,
    point,
    price: quote.price,
    capturedAt: quote.capturedAt.toISOString(),
  };
}

async function latestQuotes(gameId: string, capturedAt: Date) {
  const rows = await db
    .select({
      sportsbook: sportsbookOddsTable.sportsbook,
      market: sportsbookOddsTable.market,
      selection: sportsbookOddsTable.selection,
      point: sportsbookOddsTable.point,
      price: sportsbookOddsTable.price,
      capturedAt: sportsbookOddsTable.capturedAt,
    })
    .from(sportsbookOddsTable)
    .where(and(eq(sportsbookOddsTable.gameId, gameId), lte(sportsbookOddsTable.capturedAt, capturedAt)))
    .orderBy(desc(sportsbookOddsTable.capturedAt), desc(sportsbookOddsTable.id));
  const latest = new Map<string, Quote>();
  for (const row of rows) {
    const key = `${row.sportsbook}:${row.market}:${row.selection}`;
    if (!latest.has(key)) latest.set(key, row);
  }
  return [...latest.values()];
}

async function marketData(gameId: string, capturedAt: Date, home: { teamId: string; name: string; abbreviation: string }) {
  const quotes = await latestQuotes(gameId, capturedAt);
  const markets: Record<string, unknown> = {};
  for (const market of ["spread", "moneyline", "total"]) {
    const marketQuotes = quotes.filter((quote) => quote.market === market);
    const byBook = (sportsbook: string) => {
      const quote = marketQuotes.find((item) => item.sportsbook === sportsbook);
      return quote ? serializeQuote(quote, marketPoint(quote, market, home)) : null;
    };
    const draftKings = byBook("DraftKings");
    const fanDuel = byBook("FanDuel");
    const best = draftKings ?? fanDuel;
    let noVigHomeProbability: number | null = null;
    let noVigAwayProbability: number | null = null;
    const moneylineQuotes = marketQuotes.filter((quote) => quote.sportsbook === (draftKings ? "DraftKings" : "FanDuel"));
    if (market === "moneyline" && moneylineQuotes.length >= 2) {
      const homeQuote = moneylineQuotes.find((quote) => selectionIsHome(quote.selection, home));
      const awayQuote = moneylineQuotes.find((quote) => !selectionIsHome(quote.selection, home));
      if (homeQuote && awayQuote) {
        const homeImplied = impliedProbability(homeQuote.price);
        const awayImplied = impliedProbability(awayQuote.price);
        const noVig = safeNoVigProbabilities(homeImplied, awayImplied);
        noVigHomeProbability = noVig?.home ?? null;
        noVigAwayProbability = noVig?.away ?? null;
      }
    }
    markets[market] = {
      draftKings,
      fanDuel,
      bestAvailable: best,
      quotes: marketQuotes.map((quote) => serializeQuote(quote, marketPoint(quote, market, home))),
      noVigHomeProbability,
      noVigAwayProbability,
    };
  }
  return { capturedAt: capturedAt.toISOString(), quotes: quotes.map((quote) => serializeQuote(quote, marketPoint(quote, quote.market, home))), markets };
}

export function comparisonData(
  marketSnapshot: Record<string, any>,
  projectedMargin: number | null,
  projectedTotal: number | null,
  homeWinProbability: number | null,
) {
  const spread = marketSnapshot.markets?.spread ?? {};
  const total = marketSnapshot.markets?.total ?? {};
  const moneyline = marketSnapshot.markets?.moneyline ?? {};
  const spreadLine = spread.bestAvailable?.point ?? null;
  const totalLine = total.bestAvailable?.point ?? null;
  const noVigHome = typeof moneyline.noVigHomeProbability === "number" ? moneyline.noVigHomeProbability : null;
  return {
    spread: {
      modelLine: projectedMargin,
      marketLine: spreadLine,
      pointEdge: projectedMargin !== null && typeof spreadLine === "number" ? projectedMargin + spreadLine : null,
      marketAvailable: typeof spreadLine === "number",
    },
    moneyline: {
      modelHomeProbability: homeWinProbability,
      noVigHomeProbability: noVigHome,
      noVigAwayProbability: typeof moneyline.noVigAwayProbability === "number" ? moneyline.noVigAwayProbability : null,
      homeProbabilityEdge: homeWinProbability !== null && noVigHome !== null ? homeWinProbability - noVigHome : null,
      marketAvailable: typeof noVigHome === "number",
    },
    totals: {
      modelTotal: projectedTotal,
      marketTotal: totalLine,
      pointEdge: projectedTotal !== null && typeof totalLine === "number" ? projectedTotal - totalLine : null,
      marketAvailable: typeof totalLine === "number",
    },
  };
}

async function productionModels() {
  const promotions = await db
    .select()
    .from(modelPromotionHistoryTable)
    .where(eq(modelPromotionHistoryTable.role, "production"))
    .orderBy(desc(modelPromotionHistoryTable.promotedAt), desc(modelPromotionHistoryTable.id));
  const current = new Map<Family, typeof promotions[number]>();
  for (const promotion of promotions) {
    if (!current.has(promotion.family as Family)) current.set(promotion.family as Family, promotion);
  }
  const versions = [...current.values()].map((promotion) => promotion.modelVersion);
  if (!versions.length) return new Map<Family, ProductionModel>();
  const runs = await db.select().from(modelTrainingRunsTable).where(inArray(modelTrainingRunsTable.modelVersion, versions));
  const byVersion = new Map(runs.map((run) => [run.modelVersion, run]));
  const models = new Map<Family, ProductionModel>();
  for (const [family, promotion] of current) {
    const run = byVersion.get(promotion.modelVersion);
    if (!run) continue;
    models.set(family, {
      family,
      modelVersion: promotion.modelVersion,
      algorithm: run.algorithm as Algorithm,
      featureVersion: promotion.featureVersion,
      trainingSeasons: run.trainingSeasons,
      samplePolicy: run.samplePolicy as SamplePolicy,
      recencyWeighting: run.recencyWeighting,
      trainingCutoff: promotion.trainingCutoff,
      promotedAt: promotion.promotedAt,
    });
  }
  return models;
}

function targetFor(family: Family, example: Example) {
  return family === "spread" ? example.margin : family === "totals" ? example.total : example.homeWin;
}

export function isValidPredictionSnapshot(snapshot: {
  projectedHomeScore: number | null;
  projectedAwayScore: number | null;
  projectedMargin: number | null;
  projectedTotal: number | null;
  homeWinProbability: number | null;
  awayWinProbability: number | null;
}) {
  const values = [
    snapshot.projectedHomeScore,
    snapshot.projectedAwayScore,
    snapshot.projectedMargin,
    snapshot.projectedTotal,
    snapshot.homeWinProbability,
    snapshot.awayWinProbability,
  ];
  return values.every((value) => typeof value === "number" && Number.isFinite(value)) &&
    validatePredictionOutputs(snapshot).length === 0;
}

export function hasVerifiedPredictionInputs(snapshot: {
  inputFeatureCount: number | null;
  inputMissingFeatureCount: number | null;
}) {
  return Number.isInteger(snapshot.inputFeatureCount) &&
    snapshot.inputFeatureCount! > 0 &&
    snapshot.inputMissingFeatureCount === 0;
}

export function isEligiblePredictionSnapshot(
  snapshot: Parameters<typeof isValidPredictionSnapshot>[0] & Parameters<typeof hasVerifiedPredictionInputs>[0],
) {
  return isValidPredictionSnapshot(snapshot) && hasVerifiedPredictionInputs(snapshot);
}

export function filterEligiblePredictionRows<
  T extends { prediction: Parameters<typeof isEligiblePredictionSnapshot>[0] },
>(rows: T[]) {
  return rows.filter((row) => isEligiblePredictionSnapshot(row.prediction));
}

export function gameSpecificSnapshot<T extends { gameId: string }>(
  gameId: string,
  snapshots: ReadonlyMap<string, T>,
) {
  const snapshot = snapshots.get(gameId);
  return snapshot?.gameId === gameId ? snapshot : undefined;
}

type PredictionResult = {
  value: number | null;
  reason?: string;
  diagnostics?: Record<string, unknown>;
};

function predictWithModel(model: ProductionModel, examples: Example[], vector: number[]): PredictionResult {
  const baseRows = examples.filter((example) =>
    model.trainingSeasons.includes(example.season) &&
    (model.samplePolicy === "include_low_sample" || !example.lowSample),
  );
  const latestSeason = baseRows.length ? Math.max(...baseRows.map((row) => row.season)) : null;
  const rows = !latestSeason || model.recencyWeighting === "none"
    ? baseRows
    : [...baseRows, ...baseRows.filter((row) => row.season === latestSeason).slice(0, Math.ceil(baseRows.filter((row) => row.season === latestSeason).length * (model.recencyWeighting === "recent_2x" ? 1 : 0.5)))];
  if (rows.length < 20) return { value: null, reason: "insufficient_training_rows", diagnostics: { rows: rows.length } };
  const scaled = standardize(rows.map((row) => row.x), [vector]);
  if (!scaled.train.flat().every(Number.isFinite) || !scaled.test[0]?.every(Number.isFinite)) {
    return { value: null, reason: "nonfinite_scaled_features" };
  }
  const fitted = modelFor(model.algorithm, scaled.train, rows.map((row) => targetFor(model.family, row)), model.family === "moneyline");
  const value = fitted.predict(scaled.test[0]);
  if (!Number.isFinite(value)) return { value: null, reason: "nonfinite_model_output" };
  const prediction = model.family === "moneyline" ? clamp(value) : value;
  return Number.isFinite(prediction) ? { value: prediction } : { value: null, reason: "nonfinite_clamped_output" };
}

function snapshotLabel(now: Date, kickoff: Date) {
  const hours = (kickoff.getTime() - now.getTime()) / 3_600_000;
  if (hours > 96) return "early-week";
  if (hours > 60) return "midweek";
  if (hours > 36) return "friday";
  if (hours > 18) return "saturday";
  if (hours > 3) return "sunday-morning";
  return "final-pre-kickoff";
}

export function vectorForRows(rows: Array<{ gameId: string; isHome: boolean; features: PregameFeatureValues; lowSample: boolean }>, names: string[]) {
  const home = rows.find((row) => row.isHome);
  const away = rows.find((row) => !row.isHome);
  if (!home || !away) return null;
  let inputMissingFeatureCount = 0;
  const x = names.map((name) => {
    const homeValue = home.features[name];
    const awayValue = away.features[name];
    if (typeof homeValue === "number" && Number.isFinite(homeValue) && typeof awayValue === "number" && Number.isFinite(awayValue)) {
      return homeValue - awayValue;
    }
    inputMissingFeatureCount += 1;
    return 0;
  });
  const homeQb = typeof home.features.qb_data_confidence === "number" && Number.isFinite(home.features.qb_data_confidence) ? home.features.qb_data_confidence : 0;
  const awayQb = typeof away.features.qb_data_confidence === "number" && Number.isFinite(away.features.qb_data_confidence) ? away.features.qb_data_confidence : 0;
  return {
    x: [...x, home.lowSample ? 1 : 0, away.lowSample ? 1 : 0, homeQb - awayQb],
    lowSample: home.lowSample || away.lowSample,
    qbConfidence: (homeQb + awayQb) / 2,
    inputFeatureCount: names.length,
    inputMissingFeatureCount,
  };
}

function isFutureGame(game: { kickoffTime: Date | null; gameStatus: string | null }, now: Date) {
  const status = (game.gameStatus ?? "").toLowerCase();
  return Boolean(game.kickoffTime && game.kickoffTime > now &&
    !status.includes("final") && !status.includes("completed") &&
    !status.includes("postponed") && !status.includes("canceled"));
}

export async function generateLivePredictions(now = new Date()) {
  const models = await productionModels();
  if (models.size < 3) {
    return {
      status: "not_configured",
      reason: "One production model per family must be explicitly promoted before official predictions are generated.",
      productionFamilies: [...models.keys()],
      snapshotsCreated: 0,
    };
  }
  const featureVersion = [...models.values()][0].featureVersion;
  const [examplesResult, featureRows, games] = await Promise.all([
    loadExamples(featureVersion),
    db.select().from(pregameTeamFeaturesTable).where(eq(pregameTeamFeaturesTable.featureVersion, featureVersion)),
    db.select().from(gamesTable).where(sql`${gamesTable.kickoffTime} is not null`).orderBy(asc(gamesTable.kickoffTime)),
  ]);
  const names = examplesResult.names;
  const rowsByGame = new Map<string, typeof featureRows>();
  for (const row of featureRows) rowsByGame.set(row.gameId, [...(rowsByGame.get(row.gameId) ?? []), row]);
  const teamRows = await db.select().from(teamsTable);
  const teamById = new Map(teamRows.map((team) => [team.teamId, team]));
  let snapshotsCreated = 0;
  let skippedNoVector = 0;
  let skippedIncompleteInputs = 0;
  let skippedNoHomeTeam = 0;
  let skippedNonFinite = 0;
  let firstNonFinite: Record<string, unknown> | null = null;
  const considered = [];
  for (const game of games.filter((candidate) => isFutureGame(candidate, now))) {
    if (!game.kickoffTime) continue;
    const vector = vectorForRows(rowsByGame.get(game.gameId) ?? [], names);
    if (!vector) {
      skippedNoVector += 1;
      continue;
    }
    if (vector.inputFeatureCount === 0 || vector.inputMissingFeatureCount > 0) {
      skippedIncompleteInputs += 1;
      continue;
    }
    const marginResult = predictWithModel(models.get("spread")!, examplesResult.examples, vector.x);
    const totalResult = predictWithModel(models.get("totals")!, examplesResult.examples, vector.x);
    const homeProbabilityResult = predictWithModel(models.get("moneyline")!, examplesResult.examples, vector.x);
    const margin = marginResult.value;
    const total = totalResult.value;
    const homeProbability = homeProbabilityResult.value;
    const projectedHomeScore = margin !== null && total !== null ? (total + margin) / 2 : null;
    const projectedAwayScore = margin !== null && total !== null ? (total - margin) / 2 : null;
    const validationFailures = validatePredictionOutputs({
      projectedMargin: margin,
      projectedTotal: total,
      homeWinProbability: homeProbability,
      awayWinProbability: homeProbability === null ? null : 1 - homeProbability,
      projectedHomeScore,
      projectedAwayScore,
    });
    if (validationFailures.length) {
      skippedNonFinite += 1;
      await db.insert(predictionValidationFailuresTable).values(validationFailures.map((failure) => ({
        gameId: game.gameId,
        predictionTimestamp: now,
        snapshotLabel: snapshotLabel(now, game.kickoffTime!),
        featureVersion,
        spreadModelVersion: models.get("spread")?.modelVersion ?? null,
        moneylineModelVersion: models.get("moneyline")?.modelVersion ?? null,
        totalsModelVersion: models.get("totals")?.modelVersion ?? null,
        ...failure,
      })));
      if (!firstNonFinite) firstNonFinite = {
        gameId: game.gameId,
        vectorLength: vector.x.length,
        finiteVector: vector.x.every(Number.isFinite),
        failures: validationFailures,
        modelResults: { spread: marginResult, totals: totalResult, moneyline: homeProbabilityResult },
      };
      continue;
    }
    const home = teamById.get(game.homeTeamId);
    if (!home) {
      skippedNoHomeTeam += 1;
      continue;
    }
    const marketSnapshot = await marketData(game.gameId, now, {
      teamId: home.teamId,
      name: home.teamName,
      abbreviation: home.abbreviation,
    });
    const label = snapshotLabel(now, game.kickoffTime!);
    const insert = await db.insert(predictionSnapshotsTable).values({
      snapshotKey: `${game.gameId}:${label}:${models.get("spread")!.modelVersion}:${models.get("moneyline")!.modelVersion}:${models.get("totals")!.modelVersion}`,
      gameId: game.gameId,
      predictionTimestamp: now,
      snapshotLabel: label,
      kickoffTime: game.kickoffTime,
      featureVersion,
      spreadModelVersion: models.get("spread")!.modelVersion,
      moneylineModelVersion: models.get("moneyline")!.modelVersion,
      totalsModelVersion: models.get("totals")!.modelVersion,
      trainingCutoff: [...models.values()].map((model) => `${model.family}:${model.trainingCutoff}`).join("; "),
      projectedHomeScore,
      projectedAwayScore,
      projectedMargin: margin,
      projectedTotal: total,
      homeWinProbability: homeProbability,
      awayWinProbability: 1 - homeProbability!,
      marketSnapshot,
      marketComparison: comparisonData(marketSnapshot, margin, total, homeProbability),
      lowSample: vector.lowSample,
      qbConfidence: vector.qbConfidence,
      inputFeatureCount: vector.inputFeatureCount,
      inputMissingFeatureCount: vector.inputMissingFeatureCount,
    }).onConflictDoNothing({ target: predictionSnapshotsTable.snapshotKey }).returning({ id: predictionSnapshotsTable.id });
    if (insert.length) snapshotsCreated += 1;
    considered.push(game.gameId);
  }
  return {
    status: "success",
    snapshotsCreated,
    gamesConsidered: considered.length,
    skippedNoVector,
    skippedIncompleteInputs,
    skippedNoHomeTeam,
    skippedNonFinite,
    firstNonFinite,
    productionModels: [...models.values()].map((model) => ({
      family: model.family,
      modelVersion: model.modelVersion,
      algorithm: model.algorithm,
      featureVersion: model.featureVersion,
      trainingCutoff: model.trainingCutoff,
    })),
  };
}

export async function freezeOfficialFinalPredictions(now = new Date()) {
  const candidates = await db.select().from(predictionSnapshotsTable).where(and(
    eq(predictionSnapshotsTable.officialFinalPrediction, false),
    sql`${predictionSnapshotsTable.kickoffTime} is not null`,
    lte(predictionSnapshotsTable.kickoffTime, now),
    sql`${predictionSnapshotsTable.predictionTimestamp} < ${predictionSnapshotsTable.kickoffTime}`,
  )).orderBy(asc(predictionSnapshotsTable.gameId), desc(predictionSnapshotsTable.predictionTimestamp));
  const latest = new Map<string, typeof candidates[number]>();
  for (const candidate of candidates) {
    if (isEligiblePredictionSnapshot(candidate) && !latest.has(candidate.gameId)) {
      latest.set(candidate.gameId, candidate);
    }
  }
  for (const candidate of latest.values()) {
    await db.update(predictionSnapshotsTable).set({
      officialFinalPrediction: true,
      frozenAt: now,
    }).where(eq(predictionSnapshotsTable.id, candidate.id));
  }
  return { status: "success", frozen: latest.size };
}

function resultForLine(actual: number, line: number | null, direction: "spread" | "total") {
  if (line === null) return { status: "unavailable" };
  const value = direction === "spread" ? actual + line : actual - line;
  return { status: value > 0 ? "win" : value < 0 ? "loss" : "push", value };
}

async function gradeSnapshot(snapshot: typeof predictionSnapshotsTable.$inferSelect, game: typeof gamesTable.$inferSelect) {
  if (game.finalHomeScore === null || game.finalAwayScore === null) return null;
  const actualMargin = game.finalHomeScore - game.finalAwayScore;
  const actualTotal = game.finalHomeScore + game.finalAwayScore;
  const comparison = snapshot.marketComparison as Record<string, any>;
  const marketResults = {
    spread: resultForLine(actualMargin, comparison.spread?.marketLine ?? null, "spread"),
    totals: resultForLine(actualTotal, comparison.totals?.marketTotal ?? null, "total"),
    moneyline: comparison.moneyline?.marketAvailable ? {
      status: actualMargin > 0 ? "home_win" : actualMargin < 0 ? "away_win" : "push",
      modelHomeProbability: snapshot.homeWinProbability,
    } : { status: "unavailable" },
  };
  const closingMarkets = await marketData(game.gameId, game.kickoffTime ?? new Date(), {
    teamId: game.homeTeamId,
    name: game.homeTeamId,
    abbreviation: game.homeTeamId,
  });
  const closingComparison = comparisonData(
    closingMarkets,
    snapshot.projectedMargin,
    snapshot.projectedTotal,
    snapshot.homeWinProbability,
  ) as Record<string, any>;
  const clv = {
    spreadPoints: comparison.spread?.marketLine !== null && closingComparison.spread?.marketLine !== null
      ? comparison.spread.marketLine - closingComparison.spread.marketLine : null,
    totalPoints: comparison.totals?.marketTotal !== null && closingComparison.totals?.marketTotal !== null
      ? closingComparison.totals.marketLine - comparison.totals.marketLine : null,
    status: comparison.spread?.marketAvailable || comparison.totals?.marketAvailable ? "measured" : "unavailable",
  };
  const marginError = snapshot.projectedMargin === null ? null : snapshot.projectedMargin - actualMargin;
  const totalError = snapshot.projectedTotal === null ? null : snapshot.projectedTotal - actualTotal;
  const homeWin = actualMargin > 0 ? 1 : actualMargin < 0 ? 0 : null;
  const probability = snapshot.homeWinProbability;
  const whyMiss = {
    largestAbsoluteError: Math.max(Math.abs(marginError ?? 0), Math.abs(totalError ?? 0)),
    marginDeviation: marginError,
    totalDeviation: totalError,
    scoreline: `${game.finalHomeScore}-${game.finalAwayScore}`,
    interpretation: Math.abs(marginError ?? 0) >= Math.abs(totalError ?? 0)
      ? "Margin error was the larger model miss."
      : "Total-points error was the larger model miss.",
  };
  return {
    actualHomeScore: game.finalHomeScore,
    actualAwayScore: game.finalAwayScore,
    actualMargin,
    actualTotal,
    marginError,
    totalError,
    homeWinCorrect: probability === null || homeWin === null ? null : (probability >= 0.5 ? 1 : 0) === homeWin,
    moneylineBrier: probability === null || homeWin === null ? null : (probability - homeWin) ** 2,
    moneylineLogLoss: probability === null || homeWin === null ? null : -(homeWin * Math.log(clamp(probability)) + (1 - homeWin) * Math.log(clamp(1 - probability))),
    marketResults,
    closingMarkets,
    clv,
    whyMiss,
  };
}

export async function gradeCompletedPredictions(now = new Date()) {
  await freezeOfficialFinalPredictions(now);
  const predictions = (await db.select().from(predictionSnapshotsTable).where(eq(predictionSnapshotsTable.officialFinalPrediction, true)))
    .filter(isEligiblePredictionSnapshot);
  if (!predictions.length) return { status: "success", graded: 0 };
  const gameIds = [...new Set(predictions.map((prediction) => prediction.gameId))];
  const games = await db.select().from(gamesTable).where(inArray(gamesTable.gameId, gameIds));
  const grades = await db.select({ predictionId: predictionGradesTable.predictionId }).from(predictionGradesTable).where(inArray(predictionGradesTable.predictionId, predictions.map((prediction) => prediction.id)));
  const gradedIds = new Set(grades.map((grade) => grade.predictionId));
  let graded = 0;
  for (const prediction of predictions) {
    if (gradedIds.has(prediction.id)) continue;
    const game = games.find((candidate) => candidate.gameId === prediction.gameId);
    if (!game) continue;
    const grade = await gradeSnapshot(prediction, game);
    if (!grade) continue;
    await db.insert(predictionGradesTable).values({ predictionId: prediction.id, ...grade }).onConflictDoNothing({ target: predictionGradesTable.predictionId });
    graded += 1;
  }
  return { status: "success", graded };
}

function bucketEdge(value: unknown) {
  if (typeof value !== "number") return "unavailable";
  const absolute = Math.abs(value);
  return absolute < 0.02 ? "0-2%" : absolute < 0.05 ? "2-5%" : "5%+";
}

export function matchesPredictionPerformanceWindow(
  row: { game: { season: number; week: number } | null },
  window?: { season: number; week: number },
) {
  return !window || Boolean(
    row.game
    && row.game.season === window.season
    && row.game.week === window.week,
  );
}

export async function getPredictionPerformance(
  windowOrMax?: { season: number; week: number } | number,
) {
  const window = typeof windowOrMax === "object" ? windowOrMax : undefined;
  const maxOfficialPredictions = typeof windowOrMax === "number" ? windowOrMax : undefined;
  const query = db
    .select({ prediction: predictionSnapshotsTable, grade: predictionGradesTable, game: gamesTable })
    .from(predictionSnapshotsTable)
    .leftJoin(predictionGradesTable, eq(predictionGradesTable.predictionId, predictionSnapshotsTable.id))
    .leftJoin(gamesTable, eq(gamesTable.gameId, predictionSnapshotsTable.gameId))
    .where(and(
      eq(predictionSnapshotsTable.officialFinalPrediction, true),
      window ? eq(gamesTable.season, window.season) : undefined,
      window ? eq(gamesTable.week, window.week) : undefined,
    ))
    .orderBy(desc(predictionSnapshotsTable.predictionTimestamp));
  const selectedRowsWithSentinel = maxOfficialPredictions === undefined
    ? await query
    : await query.limit(maxOfficialPredictions + 1);
  const windowTruncated = maxOfficialPredictions !== undefined
    && selectedRowsWithSentinel.length > maxOfficialPredictions;
  const selectedRows = maxOfficialPredictions === undefined
    ? selectedRowsWithSentinel
    : selectedRowsWithSentinel.slice(0, maxOfficialPredictions);
  const rows = selectedRows
    .filter((row) => isEligiblePredictionSnapshot(row.prediction))
    .filter((row) => matchesPredictionPerformanceWindow(row, window));
  const graded = rows.filter((row) => row.grade);
  const abs = (values: Array<number | null | undefined>) => values.filter((value): value is number => typeof value === "number").map(Math.abs);
  const average = (values: Array<number | null | undefined>) => {
    const valid = values.filter((value): value is number => typeof value === "number");
    return valid.length ? mean(valid) : null;
  };
  const byFamily = {
    spread: { predictions: graded.length, mae: average(graded.map((row) => row.grade!.marginError)), rmse: average(graded.map((row) => (row.grade!.marginError ?? 0) ** 2)) === null ? null : Math.sqrt(average(graded.map((row) => (row.grade!.marginError ?? 0) ** 2))!), avgClv: average(graded.map((row) => (row.grade!.clv as any)?.spreadPoints)) },
    moneyline: (() => {
      const decided = graded.filter((row) => row.grade!.homeWinCorrect !== null);
      return { predictions: graded.length, accuracy: decided.length ? decided.filter((row) => row.grade!.homeWinCorrect === true).length / decided.length : null, brier: average(graded.map((row) => row.grade!.moneylineBrier)), logLoss: average(graded.map((row) => row.grade!.moneylineLogLoss)) };
    })(),
    totals: { predictions: graded.length, mae: average(graded.map((row) => row.grade!.totalError)), rmse: average(graded.map((row) => (row.grade!.totalError ?? 0) ** 2)) === null ? null : Math.sqrt(average(graded.map((row) => (row.grade!.totalError ?? 0) ** 2))!), avgClv: average(graded.map((row) => (row.grade!.clv as any)?.totalPoints)) },
  };
  const breakdown = (key: "season" | "week" | "model" | "edge" | "homeAway" | "favoriteUnderdog" | "sampleQuality" | "qbConfidence") => {
    const groups = new Map<string, typeof graded>();
    for (const row of graded) {
      const comparison = row.prediction.marketComparison as Record<string, any>;
      const value = key === "season" ? String(row.game?.season ?? "unknown")
        : key === "week" ? String(row.game?.week ?? "unknown")
          : key === "model" ? `${row.prediction.spreadModelVersion ?? "none"} / ${row.prediction.moneylineModelVersion ?? "none"}`
          : key === "edge" ? bucketEdge(comparison.moneyline?.homeProbabilityEdge)
            : key === "homeAway" ? (row.prediction.projectedMargin === null ? "unavailable" : row.prediction.projectedMargin >= 0 ? "home" : "away")
              : key === "favoriteUnderdog" ? (comparison.spread?.marketLine === null || comparison.spread?.marketLine === undefined ? "unavailable" : comparison.spread.marketLine < 0 ? "home-favorite" : "away-favorite")
                : key === "sampleQuality" ? (row.prediction.lowSample ? "low-sample" : "standard")
                  : row.prediction.qbConfidence === null ? "unavailable" : row.prediction.qbConfidence < 0.75 ? "low-confidence" : "high-confidence";
      groups.set(value, [...(groups.get(value) ?? []), row]);
    }
    return [...groups.entries()].map(([group, items]) => ({
      group,
      predictions: items.length,
      spreadMae: average(items.map((row) => row.grade!.marginError)),
      totalsMae: average(items.map((row) => row.grade!.totalError)),
      moneylineAccuracy: items.filter((row) => row.grade!.homeWinCorrect === true).length / (items.filter((row) => row.grade!.homeWinCorrect !== null).length || 1),
      avgClv: average(items.flatMap((row) => [((row.grade!.clv as any)?.spreadPoints ?? null), ((row.grade!.clv as any)?.totalPoints ?? null)])),
    })).sort((left, right) => left.group.localeCompare(right.group));
  };
  return {
    status: graded.length ? "measured" : "not_configured",
    windowTruncated,
    officialPredictions: rows.length,
    gradedPredictions: graded.length,
    byFamily,
    breakdowns: {
      season: breakdown("season"),
      week: breakdown("week"),
      model: breakdown("model"),
      edge: breakdown("edge"),
      homeAway: breakdown("homeAway"),
      favoriteUnderdog: breakdown("favoriteUnderdog"),
      sampleQuality: breakdown("sampleQuality"),
      qbConfidence: breakdown("qbConfidence"),
    },
    note: "Market metrics remain unavailable for snapshots without a legitimate pre-prediction Gridline line. No betting units or recommendations are calculated.",
  };
}

export async function getModelDriftMonitoring() {
  const rows = (await db
    .select({ prediction: predictionSnapshotsTable, grade: predictionGradesTable })
    .from(predictionSnapshotsTable)
    .innerJoin(predictionGradesTable, eq(predictionGradesTable.predictionId, predictionSnapshotsTable.id))
    .where(eq(predictionSnapshotsTable.officialFinalPrediction, true))
    .orderBy(desc(predictionSnapshotsTable.predictionTimestamp)))
    .filter((row) => isEligiblePredictionSnapshot(row.prediction));
  const results = (["spread", "moneyline", "totals"] as const).map((family) => {
    const versionKey = family === "spread" ? "spreadModelVersion" : family === "moneyline" ? "moneylineModelVersion" : "totalsModelVersion";
    const groups = new Map<string, typeof rows>();
    for (const row of rows) {
      const version = row.prediction[versionKey];
      if (version) groups.set(version, [...(groups.get(version) ?? []), row]);
    }
    return [...groups.entries()].map(([modelVersion, items]) => {
      const recent = items.slice(0, 8);
      const baseline = items.slice(8);
      const metric = (subset: typeof items) => {
        if (!subset.length) return null;
        if (family === "spread") return mean(subset.map((item) => Math.abs(item.grade.marginError ?? 0)));
        if (family === "totals") return mean(subset.map((item) => Math.abs(item.grade.totalError ?? 0)));
        return mean(subset.map((item) => item.grade.moneylineLogLoss ?? 0));
      };
      const recentMetric = metric(recent);
      const baselineMetric = metric(baseline);
      const elevated = recentMetric !== null && baselineMetric !== null && recent.length >= 4 && recentMetric > baselineMetric * 1.25;
      return {
        family,
        modelVersion,
        completedPredictions: items.length,
        recentWindow: recent.length,
        recentMetric,
        baselineMetric,
        metric: family === "moneyline" ? "log_loss" : "absolute_error",
        status: elevated ? "elevated" : baselineMetric === null || recent.length < 4 ? "insufficient_history" : "stable",
        note: elevated ? "Recent error is at least 25% above the prior measured window." : "Monitoring compares chronological completed snapshots; it does not trigger automatic retraining or promotion.",
      };
    });
  }).flat();
  return { status: results.length ? "measured" : "not_configured", results };
}

export async function getLivePredictionBoard() {
  const now = new Date();
  const rows = await db.select().from(predictionSnapshotsTable)
    .where(sql`${predictionSnapshotsTable.kickoffTime} > ${now}`)
    .orderBy(asc(predictionSnapshotsTable.kickoffTime), desc(predictionSnapshotsTable.predictionTimestamp));
  const latest = new Map<string, typeof rows[number]>();
  for (const row of rows) {
    if (isEligiblePredictionSnapshot(row) && !latest.has(row.gameId)) latest.set(row.gameId, row);
  }
  return [...latest.values()];
}

export async function getLatestValidPredictionSnapshots(
  gameIds: string[],
  options: { preKickoffOnly?: boolean; authoritativeGameKickoff?: boolean; maxRows?: number } = {},
) {
  if (!gameIds.length) return new Map<string, typeof predictionSnapshotsTable.$inferSelect>();
  if (options.authoritativeGameKickoff) {
    const rows = await db.selectDistinctOn(
      [predictionSnapshotsTable.gameId],
      { prediction: predictionSnapshotsTable },
    )
      .from(predictionSnapshotsTable)
      .innerJoin(gamesTable, eq(gamesTable.gameId, predictionSnapshotsTable.gameId))
      .where(and(
        inArray(predictionSnapshotsTable.gameId, gameIds),
        sql`${predictionSnapshotsTable.predictionTimestamp} < ${gamesTable.kickoffTime}`,
        sql`${predictionSnapshotsTable.projectedHomeScore} is not null`,
        sql`${predictionSnapshotsTable.projectedAwayScore} is not null`,
        sql`${predictionSnapshotsTable.projectedMargin} is not null`,
        sql`${predictionSnapshotsTable.projectedTotal} is not null`,
        sql`${predictionSnapshotsTable.projectedHomeScore} >= 0`,
        sql`${predictionSnapshotsTable.projectedAwayScore} >= 0`,
        sql`${predictionSnapshotsTable.projectedTotal} >= 0`,
        sql`${predictionSnapshotsTable.homeWinProbability} between 0 and 1`,
        sql`${predictionSnapshotsTable.awayWinProbability} between 0 and 1`,
        sql`abs(${predictionSnapshotsTable.homeWinProbability} + ${predictionSnapshotsTable.awayWinProbability} - 1) < 0.000001`,
        sql`abs(${predictionSnapshotsTable.projectedHomeScore} - ${predictionSnapshotsTable.projectedAwayScore} - ${predictionSnapshotsTable.projectedMargin}) < 0.000001`,
        sql`abs(${predictionSnapshotsTable.projectedHomeScore} + ${predictionSnapshotsTable.projectedAwayScore} - ${predictionSnapshotsTable.projectedTotal}) < 0.000001`,
        sql`${predictionSnapshotsTable.inputFeatureCount} > 0`,
        eq(predictionSnapshotsTable.inputMissingFeatureCount, 0),
      ))
      .orderBy(
        predictionSnapshotsTable.gameId,
        desc(predictionSnapshotsTable.predictionTimestamp),
        desc(predictionSnapshotsTable.id),
      )
      .limit(options.maxRows ?? gameIds.length);
    return new Map(rows
      .map((row) => row.prediction)
      .filter(isEligiblePredictionSnapshot)
      .map((snapshot) => [snapshot.gameId, snapshot]));
  }
  const conditions = [
    inArray(predictionSnapshotsTable.gameId, gameIds),
    options.preKickoffOnly
      ? sql`${predictionSnapshotsTable.predictionTimestamp} < ${predictionSnapshotsTable.kickoffTime}`
      : undefined,
  ].filter((condition): condition is NonNullable<typeof condition> => Boolean(condition));
  const query = db.select().from(predictionSnapshotsTable)
    .where(and(...conditions))
    .orderBy(desc(predictionSnapshotsTable.predictionTimestamp), desc(predictionSnapshotsTable.id));
  const rows = options.maxRows === undefined ? await query : await query.limit(options.maxRows);
  const latest = new Map<string, typeof rows[number]>();
  for (const row of rows) {
    if (isEligiblePredictionSnapshot(row) && !latest.has(row.gameId)) latest.set(row.gameId, row);
  }
  return latest;
}

export async function getProductionModelStatus() {
  const models = await productionModels();
  return models.size === 3 ? "available" as const : "not_trained" as const;
}

function predictionRecord(
  game: typeof gamesTable.$inferSelect,
  snapshot: typeof predictionSnapshotsTable.$inferSelect | undefined,
  previousSnapshot: typeof predictionSnapshotsTable.$inferSelect | undefined,
  teams: Map<string, typeof teamsTable.$inferSelect>,
) {
  const comparison = snapshot?.marketComparison as Record<string, any> | undefined;
  const marketSnapshot = snapshot?.marketSnapshot as Record<string, any> | undefined;
  const sportsbookSnapshotTimestamp = Array.isArray(marketSnapshot?.quotes)
    ? marketSnapshot.quotes
      .map((quote: Record<string, unknown>) => typeof quote.capturedAt === "string" ? quote.capturedAt : null)
      .filter((value: string | null): value is string => Boolean(value))
      .sort()
      .at(-1) ?? null
    : null;
  const missing: string[] = [];
  if (!snapshot) missing.push("production_prediction");
  const spreadAvailable = typeof comparison?.spread?.marketLine === "number";
  const moneylineAvailable = typeof comparison?.moneyline?.noVigHomeProbability === "number";
  const totalsAvailable = typeof comparison?.totals?.marketTotal === "number";
  if (snapshot && !spreadAvailable) missing.push("current_spread");
  if (snapshot && !moneylineAvailable) missing.push("no_vig_moneyline");
  if (snapshot && !totalsAvailable) missing.push("current_total");
  const home = teams.get(game.homeTeamId);
  const away = teams.get(game.awayTeamId);
  return {
    gameId: game.gameId,
    season: game.season,
    week: game.week,
    kickoffTime: game.kickoffTime?.toISOString() ?? null,
    homeTeam: home?.teamName ?? game.homeTeamId,
    awayTeam: away?.teamName ?? game.awayTeamId,
    status: !snapshot ? "insufficient_data" : missing.length ? "partial_market_data" : "measured",
    componentStatus: {
      modelData: snapshot ? "complete" : "unavailable",
      spreadComparison: snapshot && spreadAvailable ? "available" : "market_unavailable",
      moneylineComparison: snapshot && moneylineAvailable ? "available" : "market_unavailable",
      totalsComparison: snapshot && totalsAvailable ? "available" : "market_unavailable",
    },
    missing,
    model: snapshot ? {
      snapshotId: snapshot.id,
      snapshotKey: snapshot.snapshotKey,
      snapshotLabel: snapshot.snapshotLabel,
      spreadModelVersion: snapshot.spreadModelVersion,
      moneylineModelVersion: snapshot.moneylineModelVersion,
      totalsModelVersion: snapshot.totalsModelVersion,
      featureVersion: snapshot.featureVersion,
      predictionTimestamp: snapshot.predictionTimestamp.toISOString(),
      sportsbookSnapshotTimestamp,
    } : null,
    prediction: snapshot ? {
      projectedHomeScore: snapshot.projectedHomeScore,
      projectedAwayScore: snapshot.projectedAwayScore,
      projectedMargin: snapshot.projectedMargin,
      projectedTotal: snapshot.projectedTotal,
      homeWinProbability: snapshot.homeWinProbability,
      awayWinProbability: snapshot.awayWinProbability,
      qbConfidence: snapshot.qbConfidence,
      lowSample: snapshot.lowSample,
    } : null,
    market: snapshot ? {
      spread: marketSnapshot?.markets?.spread?.bestAvailable ?? null,
      moneyline: marketSnapshot?.markets?.moneyline?.bestAvailable ?? null,
      total: marketSnapshot?.markets?.total?.bestAvailable ?? null,
      noVigHomeProbability: comparison?.moneyline?.noVigHomeProbability ?? null,
      noVigAwayProbability: comparison?.moneyline?.noVigAwayProbability ?? null,
    } : null,
    difference: snapshot ? {
      spread: comparison?.spread?.pointEdge ?? null,
      moneyline: comparison?.moneyline?.homeProbabilityEdge ?? null,
      total: comparison?.totals?.pointEdge ?? null,
    } : { spread: null, moneyline: null, total: null },
    previousPrediction: previousSnapshot ? {
      predictionTimestamp: previousSnapshot.predictionTimestamp.toISOString(),
      spreadModelVersion: previousSnapshot.spreadModelVersion,
      moneylineModelVersion: previousSnapshot.moneylineModelVersion,
      totalsModelVersion: previousSnapshot.totalsModelVersion,
      projectedHomeScore: previousSnapshot.projectedHomeScore,
      projectedAwayScore: previousSnapshot.projectedAwayScore,
      projectedMargin: previousSnapshot.projectedMargin,
      projectedTotal: previousSnapshot.projectedTotal,
      homeWinProbability: previousSnapshot.homeWinProbability,
      awayWinProbability: previousSnapshot.awayWinProbability,
    } : null,
  };
}

export async function getGamePredictionDetail(gameId: string) {
  const [game] = await db.select().from(gamesTable).where(eq(gamesTable.gameId, gameId)).limit(1);
  if (!game) return null;
  const snapshots = await db.select().from(predictionSnapshotsTable)
    .where(eq(predictionSnapshotsTable.gameId, gameId))
    .orderBy(desc(predictionSnapshotsTable.predictionTimestamp), desc(predictionSnapshotsTable.id));
  const valid = snapshots.filter(isEligiblePredictionSnapshot);
  const teams = new Map((await db.select().from(teamsTable)).map((team) => [team.teamId, team]));
  return predictionRecord(game, valid[0], valid[1], teams);
}

export async function getCurrentWeekValidationReport() {
  const now = new Date();
  const upcoming = await db.select().from(gamesTable)
    .where(and(
      sql`${gamesTable.kickoffTime} > ${now}`,
      sql`lower(${gamesTable.gameStatus}) not like '%final%'`,
      sql`lower(${gamesTable.gameStatus}) not like '%completed%'`,
      sql`lower(${gamesTable.gameStatus}) not like '%postponed%'`,
      sql`lower(${gamesTable.gameStatus}) not like '%canceled%'`,
    ))
    .orderBy(asc(gamesTable.kickoffTime), asc(gamesTable.gameId));
  const currentWeek = upcoming[0] ? { season: upcoming[0].season, week: upcoming[0].week } : null;
  if (!currentWeek) return { status: "not_configured", season: null, week: null, games: [], rankings: { spread: [], moneyline: [], totals: [] } };
  const games = upcoming.filter((game) => game.season === currentWeek.season && game.week === currentWeek.week);
  const gameIds = games.map((game) => game.gameId);
  const snapshots = gameIds.length
    ? await db.select().from(predictionSnapshotsTable)
      .where(inArray(predictionSnapshotsTable.gameId, gameIds))
      .orderBy(desc(predictionSnapshotsTable.predictionTimestamp), desc(predictionSnapshotsTable.id))
    : [];
   const latest = new Map<string, typeof snapshots[number]>();
   const previous = new Map<string, typeof snapshots[number]>();
   for (const snapshot of snapshots) {
       const valid = isEligiblePredictionSnapshot(snapshot);
      if (!valid) continue;
      if (!latest.has(snapshot.gameId)) latest.set(snapshot.gameId, snapshot);
      else if (!previous.has(snapshot.gameId)) previous.set(snapshot.gameId, snapshot);
   }
  const teamRows = await db.select().from(teamsTable);
  const teams = new Map(teamRows.map((team) => [team.teamId, team]));
  const records = games.map((game) => predictionRecord(game, latest.get(game.gameId), previous.get(game.gameId), teams));
  const rank = (key: "spread" | "moneyline" | "total") => [...records]
    .sort((left, right) => {
      const leftValue = left.difference[key];
      const rightValue = right.difference[key];
      if (typeof leftValue !== "number" && typeof rightValue !== "number") return left.gameId.localeCompare(right.gameId);
      if (typeof leftValue !== "number") return 1;
      if (typeof rightValue !== "number") return -1;
      return Math.abs(rightValue) - Math.abs(leftValue) || left.gameId.localeCompare(right.gameId);
    })
    .map((game, index) => ({ rank: index + 1, ...game }));
  return {
    status: records.some((game) => game.status === "measured" || game.status === "partial_market_data") ? "measured" : "insufficient_data",
    season: currentWeek.season,
    week: currentWeek.week,
    games: records,
    rankings: {
      spread: rank("spread"),
      moneyline: rank("moneyline"),
      totals: rank("total"),
    },
    note: "Rankings are independent analysis views. A difference is not a betting recommendation, and unavailable values are not imputed.",
  };
}

export async function getPredictionValidationFailures(limit = 50) {
  const safeLimit = Math.max(1, Math.min(100, Math.floor(limit)));
  return db.select().from(predictionValidationFailuresTable)
    .orderBy(desc(predictionValidationFailuresTable.predictionTimestamp), desc(predictionValidationFailuresTable.id))
    .limit(safeLimit);
}

export async function generateWeeklyLearningReport(season: number, week: number) {
  const performance = await getPredictionPerformance({ season, week });
  const queriedRows = await db.select({ prediction: predictionSnapshotsTable, grade: predictionGradesTable, game: gamesTable })
    .from(predictionSnapshotsTable)
    .innerJoin(predictionGradesTable, eq(predictionGradesTable.predictionId, predictionSnapshotsTable.id))
    .innerJoin(gamesTable, eq(gamesTable.gameId, predictionSnapshotsTable.gameId))
    .where(and(eq(gamesTable.season, season), eq(gamesTable.week, week)));
  const rows = filterEligiblePredictionRows(queriedRows);
  const misses = rows
    .sort((left, right) => Math.max(Math.abs(right.grade.marginError ?? 0), Math.abs(right.grade.totalError ?? 0)) - Math.max(Math.abs(left.grade.marginError ?? 0), Math.abs(left.grade.totalError ?? 0)))
    .slice(0, 5)
    .map((row) => ({ gameId: row.prediction.gameId, whyMiss: row.grade.whyMiss, projectedMargin: row.prediction.projectedMargin, actualMargin: row.grade.actualMargin, projectedTotal: row.prediction.projectedTotal, actualTotal: row.grade.actualTotal }));
  const report = {
    season,
    week,
    completedGames: rows.length,
    performance,
    misses,
    inputProvenance: "verified",
    generatedAt: new Date().toISOString(),
  };
  const narrative = rows.length
    ? `Gridline graded ${rows.length} official prediction snapshot${rows.length === 1 ? "" : "s"} for ${season} week ${week}. ` +
      `Spread MAE was ${performance.byFamily.spread.mae === null ? "unavailable" : performance.byFamily.spread.mae.toFixed(2)} points; ` +
      `totals MAE was ${performance.byFamily.totals.mae === null ? "unavailable" : performance.byFamily.totals.mae.toFixed(2)} points; ` +
      `moneyline accuracy was ${typeof performance.byFamily.moneyline.accuracy === "number" ? `${(performance.byFamily.moneyline.accuracy * 100).toFixed(1)}%` : "unavailable"}. ` +
      `The largest misses are listed quantitatively below; no subjective explanation or betting recommendation is added.`
    : `No completed official predictions were available for ${season} week ${week}; the report remains unmeasured rather than zero-filled.`;
  await db.insert(weeklyLearningReportsTable).values({ season, week, report, narrative })
    .onConflictDoUpdate({ target: [weeklyLearningReportsTable.season, weeklyLearningReportsTable.week], set: { generatedAt: new Date(), report, narrative } });
  return { season, week, narrative, report };
}

export async function getLatestLearningReports() {
  return db.select().from(weeklyLearningReportsTable)
    .where(sql`${weeklyLearningReportsTable.report}->>'inputProvenance' = 'verified'`)
    .orderBy(desc(weeklyLearningReportsTable.generatedAt))
    .limit(12);
}
