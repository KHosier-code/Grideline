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
  isFittedModelArtifact,
  mean,
  PHASE6_VECTOR_FEATURE_NAMES,
  PHASE6_VECTOR_SCHEMA_FINGERPRINT,
  predictFittedModelArtifact,
  predictPersistedModelArtifact,
  verifyArtifactIntegrity,
  artifactMetadataMatchesTrainingRun,
  sourceFeatureNames,
  vectorSchemaFingerprint,
  type Algorithm,
  type FittedModelArtifact,
  type Family,
  type SamplePolicy,
} from "./modeling";
import { PREGAME_FEATURE_VERSION } from "./features";
import { getPersonnelContextForGame } from "./personnel-context";
import { interpretNflGameState } from "./game-state";

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
  vectorFeatureNames: string[];
  vectorSchemaFingerprint: string | null;
  modelArtifact: FittedModelArtifact | null;
  trainedAt: Date;
  artifactId: string | null;
  artifactChecksum: string | null;
  artifactMetadata: Record<string, unknown> | null;
};

export const CANONICAL_EVALUATION_CUTOFF_MINUTES = 30;
export const CANONICAL_MARKET_MAX_AGE_MINUTES = 15;

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

async function latestQuotes(gameId: string, capturedAt: Date, strictlyBefore = false) {
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
    .where(and(
      eq(sportsbookOddsTable.gameId, gameId),
      strictlyBefore
        ? sql`${sportsbookOddsTable.capturedAt} < ${capturedAt}`
        : lte(sportsbookOddsTable.capturedAt, capturedAt),
    ))
    .orderBy(desc(sportsbookOddsTable.capturedAt), desc(sportsbookOddsTable.id));
  const latest = new Map<string, Quote>();
  for (const row of rows) {
    const key = `${row.sportsbook}:${row.market}:${row.selection}`;
    if (!latest.has(key)) latest.set(key, row);
  }
  return [...latest.values()];
}

async function marketData(
  gameId: string,
  capturedAt: Date,
  home: { teamId: string; name: string; abbreviation: string },
  strictlyBefore = false,
) {
  const quotes = await latestQuotes(gameId, capturedAt, strictlyBefore);
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
      vectorFeatureNames: Array.isArray(run.vectorFeatureNames) ? run.vectorFeatureNames : [],
      vectorSchemaFingerprint: run.vectorSchemaFingerprint,
       modelArtifact: verifyArtifactIntegrity(run).valid && artifactMetadataMatchesTrainingRun(run)
         && isFittedModelArtifact(run.modelArtifact, PHASE6_VECTOR_FEATURE_NAMES.length) ? run.modelArtifact : null,
      trainedAt: run.trainedAt,
       artifactId: isFittedModelArtifact(run.modelArtifact, PHASE6_VECTOR_FEATURE_NAMES.length) ? run.modelArtifact.metadata?.artifactId ?? null : null,
       artifactChecksum: isFittedModelArtifact(run.modelArtifact, PHASE6_VECTOR_FEATURE_NAMES.length) ? run.modelArtifact.metadata?.artifactChecksum ?? null : null,
       artifactMetadata: isFittedModelArtifact(run.modelArtifact, PHASE6_VECTOR_FEATURE_NAMES.length) ? run.modelArtifact.metadata as Record<string, unknown> ?? null : null,
    });
  }
  return models;
}

export function sharedProductionFeatureVersion(models: Array<{ featureVersion: string }>) {
  const versions = [...new Set(models.map((model) => model.featureVersion))];
  return models.length === 3 && versions.length === 1 ? versions[0] : null;
}

function sharedProductionSchema(models: ProductionModel[]) {
  const featureVersion = sharedProductionFeatureVersion(models);
  if (!featureVersion) return null;
  const names = models[0]?.vectorFeatureNames ?? [];
  const fingerprint = models[0]?.vectorSchemaFingerprint ?? null;
  const exactNames = JSON.stringify(names);
  if (
    exactNames !== JSON.stringify(PHASE6_VECTOR_FEATURE_NAMES)
    || fingerprint !== PHASE6_VECTOR_SCHEMA_FINGERPRINT
    || vectorSchemaFingerprint(names) !== fingerprint
    || models.some((model) =>
      JSON.stringify(model.vectorFeatureNames) !== exactNames
      || model.vectorSchemaFingerprint !== fingerprint
      || !model.modelArtifact
      || model.modelArtifact.algorithm !== model.algorithm)
  ) return null;
  return { featureVersion, names, fingerprint };
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
  return snapshot.inputFeatureCount === PHASE6_PRODUCTION_VECTOR_WIDTH &&
    snapshot.inputMissingFeatureCount === 0;
}

export function isEligiblePredictionSnapshot(
  snapshot: Parameters<typeof isValidPredictionSnapshot>[0] & Parameters<typeof hasVerifiedPredictionInputs>[0] & {
    gameId: string;
    predictionTimestamp: Date;
    kickoffTime: Date | null;
    snapshotKey: string;
    spreadModelVersion: string | null;
    moneylineModelVersion: string | null;
    totalsModelVersion: string | null;
    inputVector: number[] | null;
    vectorFeatureNames: string[] | null;
    vectorSchemaFingerprint: string | null;
    inputSourceEvidence: Record<string, unknown> | null;
  },
) {
  return isValidPredictionSnapshot(snapshot)
    && hasVerifiedPredictionInputs(snapshot)
    && Boolean(snapshot.spreadModelVersion && snapshot.moneylineModelVersion && snapshot.totalsModelVersion)
    && Array.isArray(snapshot.inputVector)
    && snapshot.inputVector.length === PHASE6_PRODUCTION_VECTOR_WIDTH
    && snapshot.inputVector.every((value) => typeof value === "number" && Number.isFinite(value))
    && JSON.stringify(snapshot.vectorFeatureNames) === JSON.stringify(PHASE6_VECTOR_FEATURE_NAMES)
    && snapshot.vectorSchemaFingerprint === PHASE6_VECTOR_SCHEMA_FINGERPRINT
    && snapshotEvidenceMatchesVector(snapshot)
    && snapshot.snapshotKey.endsWith(`:input-integrity-v3:${PHASE6_VECTOR_SCHEMA_FINGERPRINT}`);
}

function snapshotEvidenceMatchesVector(snapshot: {
  gameId: string;
  predictionTimestamp: Date;
  kickoffTime: Date | null;
  inputVector: number[] | null;
  inputSourceEvidence: Record<string, unknown> | null;
}) {
  if (!snapshot.kickoffTime || !Array.isArray(snapshot.inputVector)) return false;
  const evidenceRows = (snapshot.inputSourceEvidence as { rows?: unknown[] } | null)?.rows;
  if (!Array.isArray(evidenceRows) || evidenceRows.length !== 2) return false;
  const rows = evidenceRows.filter((row): row is Record<string, unknown> => Boolean(row && typeof row === "object"));
  const home = rows.find((row) => row.isHome === true);
  const away = rows.find((row) => row.isHome === false);
  if (!home || !away ||
      home.gameId !== snapshot.gameId || away.gameId !== snapshot.gameId ||
      typeof home.teamId !== "string" || typeof away.teamId !== "string" ||
      home.teamId === away.teamId ||
      home.opponentTeamId !== away.teamId || away.opponentTeamId !== home.teamId) return false;
  const kickoff = snapshot.kickoffTime.getTime();
  const predictionTimestamp = snapshot.predictionTimestamp.getTime();
  for (const row of [home, away]) {
    const sourceCutoff = typeof row.sourceCutoff === "string" ? Date.parse(row.sourceCutoff) : Number.NaN;
    const generatedAt = typeof row.generatedAt === "string" ? Date.parse(row.generatedAt) : Number.NaN;
    if (!Number.isFinite(sourceCutoff) || !Number.isFinite(generatedAt) ||
        sourceCutoff >= kickoff || sourceCutoff > predictionTimestamp ||
        generatedAt >= kickoff || generatedAt > predictionTimestamp) return false;
  }
  const homeValues = home.selectedValues;
  const awayValues = away.selectedValues;
  if (!homeValues || typeof homeValues !== "object" || !awayValues || typeof awayValues !== "object") return false;
  const differences: number[] = [];
  for (const name of PHASE6_VECTOR_FEATURE_NAMES.slice(0, -3)) {
    const homeValue = (homeValues as Record<string, unknown>)[name];
    const awayValue = (awayValues as Record<string, unknown>)[name];
    if (typeof homeValue !== "number" || !Number.isFinite(homeValue) ||
        typeof awayValue !== "number" || !Number.isFinite(awayValue)) return false;
    differences.push(homeValue - awayValue);
  }
  if (typeof home.lowSample !== "boolean" || typeof away.lowSample !== "boolean" ||
      typeof home.qbDataConfidence !== "number" || !Number.isFinite(home.qbDataConfidence) ||
      typeof away.qbDataConfidence !== "number" || !Number.isFinite(away.qbDataConfidence)) return false;
  const reconstructed = [
    ...differences,
    home.lowSample ? 1 : 0,
    away.lowSample ? 1 : 0,
    home.qbDataConfidence - away.qbDataConfidence,
  ];
  return reconstructed.length === snapshot.inputVector.length
    && reconstructed.every((value, index) => Math.abs(value - snapshot.inputVector![index]) <= 1e-12);
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

function predictWithModel(model: ProductionModel, vector: number[]): PredictionResult {
  if (!model.modelArtifact) return { value: null, reason: "immutable_model_artifact_unavailable" };
   const value = predictPersistedModelArtifact(model, vector);
  if (value === null) return { value: null, reason: "invalid_persisted_model_artifact_or_input" };
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

type VectorRow = {
  gameId: string;
  teamId?: string;
  opponentTeamId?: string;
  isHome: boolean;
  features: PregameFeatureValues;
  featureAudit?: Record<string, { unavailableReason?: string; sampleSize?: number; quality?: string }>;
  lowSample: boolean;
  sourceCutoff?: Date;
  generatedAt?: Date;
};

const PHASE6_PRODUCTION_VECTOR_WIDTH = PHASE6_VECTOR_FEATURE_NAMES.length;

export function vectorForRows(rows: VectorRow[], names: string[]) {
  const home = rows.find((row) => row.isHome);
  const away = rows.find((row) => !row.isHome);
  if (!home || !away) return null;
  const missingFeatures: Array<{ name: string; side: "home" | "away"; reason: string }> = [];
  const selectedValues = names.map((name) => {
    const homeValue = home.features[name];
    const awayValue = away.features[name];
    const homeValid = typeof homeValue === "number" && Number.isFinite(homeValue);
    const awayValid = typeof awayValue === "number" && Number.isFinite(awayValue);
    if (!homeValid) {
      missingFeatures.push({
        name,
        side: "home",
        reason: home.featureAudit?.[name]?.unavailableReason ?? "Selected feature is missing or non-finite in the home pregame row.",
      });
    }
    if (!awayValid) {
      missingFeatures.push({
        name,
        side: "away",
        reason: away.featureAudit?.[name]?.unavailableReason ?? "Selected feature is missing or non-finite in the away pregame row.",
      });
    }
    if (!homeValid || !awayValid) return null;
    return homeValue - awayValue;
  });
  const qbValue = (row: VectorRow, side: "home" | "away") => {
    const value = row.features.qb_data_confidence;
    if (typeof value === "number" && Number.isFinite(value)) {
      return value;
    }
    missingFeatures.push({
      name: "qb_data_confidence",
      side,
      reason: row.featureAudit?.qb_data_confidence?.unavailableReason ?? `Quarterback confidence is unavailable for the ${side} team.`,
    });
    return null;
  };
  const homeQb = qbValue(home, "home");
  const awayQb = qbValue(away, "away");
  const values = [
    ...selectedValues,
    home.lowSample ? 1 : 0,
    away.lowSample ? 1 : 0,
    homeQb === null || awayQb === null ? null : homeQb - awayQb,
  ];
  const inputFeatureCount = names.length + 3;
  const inputMissingFeatureCount = values.filter((value) => value === null).length;
  const legitimateZeroCount = values.filter((value) => value === 0).length;
  return {
    x: inputMissingFeatureCount === 0 ? values as number[] : null,
    values,
    lowSample: home.lowSample || away.lowSample,
    qbConfidence: homeQb === null || awayQb === null ? null : (homeQb + awayQb) / 2,
    qb: {
      home: { confidence: homeQb, unavailableReason: missingFeatures.find((item) => item.name === "qb_data_confidence" && item.side === "home")?.reason ?? null },
      away: { confidence: awayQb, unavailableReason: missingFeatures.find((item) => item.name === "qb_data_confidence" && item.side === "away")?.reason ?? null },
    },
    inputFeatureCount,
    inputMissingFeatureCount,
    inputPopulatedFeatureCount: inputFeatureCount - inputMissingFeatureCount,
    legitimateZeroCount,
    formerlyMissingZeroCount: inputMissingFeatureCount,
    missingFeatures,
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
  const productionSchema = sharedProductionSchema([...models.values()]);
  if (!productionSchema) {
    return {
      status: "not_configured",
      reason: "Active production model families require one exact persisted schema and immutable fitted artifact.",
      productionFamilies: [...models.keys()],
      snapshotsCreated: 0,
    };
  }
  const { featureVersion } = productionSchema;
  const [featureRows, games] = await Promise.all([
    db.select().from(pregameTeamFeaturesTable).where(eq(pregameTeamFeaturesTable.featureVersion, featureVersion)),
    db.select().from(gamesTable).where(sql`${gamesTable.kickoffTime} is not null`).orderBy(asc(gamesTable.kickoffTime)),
  ]);
  const names = productionSchema.names;
  const selectedFeatureNames = names.slice(0, -3);
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
    const vector = vectorForRows(rowsByGame.get(game.gameId) ?? [], selectedFeatureNames);
    if (!vector) {
      skippedNoVector += 1;
      continue;
    }
    const inputEligibility = evaluateProductionInputEligibility(
      game,
      rowsByGame.get(game.gameId) ?? [],
      vector,
      true,
      now,
    );
    if (!inputEligibility.eligible) {
      skippedIncompleteInputs += 1;
      continue;
    }
    if (!vector.x) {
      skippedIncompleteInputs += 1;
      continue;
    }
    const inputVector = vector.x;
    const marginResult = predictWithModel(models.get("spread")!, inputVector);
    const totalResult = predictWithModel(models.get("totals")!, inputVector);
    const homeProbabilityResult = predictWithModel(models.get("moneyline")!, inputVector);
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
        vectorLength: inputVector.length,
        finiteVector: inputVector.every(Number.isFinite),
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
    const inputSourceEvidence = {
      rows: (rowsByGame.get(game.gameId) ?? []).map((row) => ({
        gameId: row.gameId,
        teamId: row.teamId,
        opponentTeamId: row.opponentTeamId,
        isHome: row.isHome,
        sourceCutoff: row.sourceCutoff.toISOString(),
        generatedAt: row.generatedAt.toISOString(),
        lowSample: row.lowSample,
        selectedValues: Object.fromEntries(selectedFeatureNames.map((name) => [name, row.features[name] ?? null])),
        selectedAudit: Object.fromEntries(selectedFeatureNames.map((name) => [name, row.featureAudit[name] ?? null])),
        qbDataConfidence: row.features.qb_data_confidence ?? null,
        qbDataConfidenceAudit: row.featureAudit.qb_data_confidence ?? null,
      })),
    };
    const insert = await db.insert(predictionSnapshotsTable).values({
      snapshotKey: `${game.gameId}:${label}:${models.get("spread")!.modelVersion}:${models.get("moneyline")!.modelVersion}:${models.get("totals")!.modelVersion}:input-integrity-v3:${productionSchema.fingerprint}`,
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
      inputVector,
      vectorFeatureNames: names,
      vectorSchemaFingerprint: productionSchema.fingerprint,
      inputSourceEvidence,
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

function upcomingInputCause(
  game: typeof gamesTable.$inferSelect,
  rows: VectorRow[],
  featureVersion: string,
  vector: ReturnType<typeof vectorForRows>,
  now: Date,
) {
  const reasons: string[] = [];
  const expected = [
    { teamId: game.homeTeamId, opponentTeamId: game.awayTeamId, isHome: true },
    { teamId: game.awayTeamId, opponentTeamId: game.homeTeamId, isHome: false },
  ];
  if (!rows.length) reasons.push(`No ${featureVersion} rows exist for this scheduled game; the future-game feature build has not covered it.`);
  for (const side of expected) {
    const row = rows.find((candidate) => candidate.teamId === side.teamId);
    if (!row) {
      reasons.push(`Missing ${side.isHome ? "home" : "away"} pregame row for scheduled team ${side.teamId}; check schedule-to-feature team identifiers.`);
      continue;
    }
    if (row.opponentTeamId !== side.opponentTeamId || row.isHome !== side.isHome) {
      reasons.push(`Pregame row identity does not match the scheduled ${side.isHome ? "home" : "away"} team/opponent pairing.`);
    }
    if (!row.sourceCutoff) {
      reasons.push("Pregame source cutoff is unavailable.");
    } else if (game.kickoffTime && row.sourceCutoff >= game.kickoffTime) {
      reasons.push("Pregame source cutoff is not strictly before kickoff.");
    } else if (row.sourceCutoff > now) {
      reasons.push("Pregame source cutoff is later than the prediction or audit time.");
    }
    if (!row.generatedAt) {
      reasons.push("Pregame row generation timestamp is unavailable.");
    } else if (game.kickoffTime && row.generatedAt >= game.kickoffTime) {
      reasons.push("Pregame row was generated at or after kickoff.");
    } else if (row.generatedAt > now) {
      reasons.push("Pregame row generation timestamp is inconsistent with the upcoming-game audit time.");
    }
  }
  reasons.push(...(vector?.missingFeatures ?? []).map((item) => `${item.side} ${item.name}: ${item.reason}`));
  return [...new Set(reasons)];
}

export function evaluateProductionInputEligibility(
  game: typeof gamesTable.$inferSelect,
  rows: VectorRow[],
  vector: ReturnType<typeof vectorForRows>,
  schemaConsistent: boolean,
  now: Date,
) {
  const causes = upcomingInputCause(game, rows, game.kickoffTime ? "active feature version" : "unknown feature version", vector, now);
  if (!schemaConsistent) causes.unshift("Active production model families do not share one complete feature schema/version.");
  const identityValid = rows.length === 2
    && rows.some((row) => row.teamId === game.homeTeamId && row.opponentTeamId === game.awayTeamId && row.isHome)
    && rows.some((row) => row.teamId === game.awayTeamId && row.opponentTeamId === game.homeTeamId && !row.isHome);
  const cutoffValid = rows.length === 2 && rows.every((row) =>
    row.sourceCutoff instanceof Date
    && Number.isFinite(row.sourceCutoff.getTime())
    && Boolean(game.kickoffTime && row.sourceCutoff < game.kickoffTime)
    && row.sourceCutoff <= now
    && row.generatedAt instanceof Date
    && Number.isFinite(row.generatedAt.getTime())
    && Boolean(game.kickoffTime && row.generatedAt < game.kickoffTime)
    && row.generatedAt <= now,
  );
  const vectorValid = Boolean(
    vector?.x
    && vector.inputFeatureCount === PHASE6_PRODUCTION_VECTOR_WIDTH
    && vector.inputMissingFeatureCount === 0
    && vector.x.length === PHASE6_PRODUCTION_VECTOR_WIDTH
    && vector.x.every(Number.isFinite),
  );
  return {
    eligible: schemaConsistent && identityValid && cutoffValid && vectorValid,
    identityValid,
    cutoffValid,
    vectorValid,
    causes: [...new Set(causes)],
  };
}

/**
 * Recovery shadow path.  It deliberately has no writes (in particular, it
 * never touches prediction_snapshots or validation-failure tables) and is not
 * called by consumer routes.
 */
export async function generatePhase61ShadowPredictions(
  candidates: Array<{
    family: string;
    modelVersion: string;
    modelArtifact: FittedModelArtifact | null;
    artifactId: string | null;
    artifactChecksum: string | null;
    artifactMetadata: Record<string, unknown> | null;
    featureVersion: string;
    vectorFeatureNames: string[];
    vectorSchemaFingerprint: string | null;
  }>,
  now = new Date(),
  limit = 6,
  scope?: { season: number; week: number },
) {
  const byFamily = new Map(candidates.map((candidate) => [candidate.family as Family, candidate]));
  const schemaConsistent = candidates.length === 3
    && candidates.every((candidate) =>
      JSON.stringify(candidate.vectorFeatureNames) === JSON.stringify(PHASE6_VECTOR_FEATURE_NAMES)
      && candidate.vectorSchemaFingerprint === PHASE6_VECTOR_SCHEMA_FINGERPRINT
      && verifyArtifactIntegrity(candidate).valid);
  const featureVersion = candidates[0]?.featureVersion ?? PREGAME_FEATURE_VERSION;
  const [featureRows, games, teamRows] = await Promise.all([
    db.select().from(pregameTeamFeaturesTable).where(eq(pregameTeamFeaturesTable.featureVersion, featureVersion)),
    db.select().from(gamesTable).where(sql`${gamesTable.kickoffTime} is not null`).orderBy(asc(gamesTable.kickoffTime)),
    db.select().from(teamsTable),
  ]);
  const teamsById = new Map(teamRows.map((team) => [team.teamId, team]));
  const rowsByGame = new Map<string, typeof featureRows>();
  for (const row of featureRows) rowsByGame.set(row.gameId, [...(rowsByGame.get(row.gameId) ?? []), row]);
  const selectedFeatureNames = PHASE6_VECTOR_FEATURE_NAMES.slice(0, -3);
  const shadows: Array<Record<string, unknown>> = [];
  const inputReadiness: Array<Record<string, unknown>> = [];
  const scopedGames = games.filter((candidate) =>
    isFutureGame(candidate, now)
    && (!scope || (candidate.season === scope.season && candidate.week === scope.week)));
  for (const game of scopedGames) {
    if (!game.kickoffTime) continue;
    const rows = rowsByGame.get(game.gameId) ?? [];
    const vector = vectorForRows(rows, selectedFeatureNames);
    const eligibility = evaluateProductionInputEligibility(game, rows, vector, schemaConsistent, now);
    inputReadiness.push({
      gameId: game.gameId,
      season: game.season,
      week: game.week,
      matchup: {
        away: teamsById.get(game.awayTeamId)?.abbreviation ?? game.awayTeamId,
        home: teamsById.get(game.homeTeamId)?.abbreviation ?? game.homeTeamId,
      },
      kickoffTime: game.kickoffTime.toISOString(),
      requiredFeatureCount: PHASE6_VECTOR_FEATURE_NAMES.length,
      populatedCount: vector?.inputPopulatedFeatureCount ?? 0,
      missingCount: vector?.inputMissingFeatureCount ?? PHASE6_VECTOR_FEATURE_NAMES.length,
      qbConfidence: vector?.qb ?? null,
      sourceCutoffs: rows.map((row) => ({
        teamId: row.teamId,
        sourceCutoff: row.sourceCutoff.toISOString(),
        generatedAt: row.generatedAt.toISOString(),
      })),
      cutoffSafe: eligibility.cutoffValid,
      vectorReconstructs: eligibility.eligible,
      causes: eligibility.causes,
    });
    if (!eligibility.eligible || !vector?.x || shadows.length >= limit) continue;
    const spread = byFamily.get("spread");
    const totals = byFamily.get("totals");
    const moneyline = byFamily.get("moneyline");
    if (!spread || !totals || !moneyline) continue;
    const projectedMargin = predictPersistedModelArtifact(spread, vector.x);
    const projectedTotal = predictPersistedModelArtifact(totals, vector.x);
    const homeWinProbability = predictPersistedModelArtifact(moneyline, vector.x);
    if (![projectedMargin, projectedTotal, homeWinProbability].every((value) => typeof value === "number" && Number.isFinite(value))) continue;
    shadows.push({
      gameId: game.gameId,
      matchup: {
        away: teamsById.get(game.awayTeamId)?.abbreviation ?? game.awayTeamId,
        home: teamsById.get(game.homeTeamId)?.abbreviation ?? game.homeTeamId,
      },
      kickoffTime: game.kickoffTime.toISOString(),
      artifactIds: {
        spread: spread.artifactId,
        moneyline: moneyline.artifactId,
        totals: totals.artifactId,
      },
      artifactChecksums: {
        spread: spread.artifactChecksum,
        moneyline: moneyline.artifactChecksum,
        totals: totals.artifactChecksum,
      },
      populatedFeatureCount: vector.inputPopulatedFeatureCount,
      missingFeatureCount: vector.inputMissingFeatureCount,
      qbConfidence: vector.qbConfidence,
      projectedMargin,
      projectedTotal,
      homeWinProbability,
      inputQualityStatus: "complete_verified",
      inputVector: [...vector.x],
    });
  }
  return {
    status: shadows.length >= limit ? "complete" : "partial",
    requested: limit,
    returned: shadows.length,
    scope: scope ?? null,
    targetGames: scopedGames.length,
    readyGames: inputReadiness.filter((item) => item.vectorReconstructs === true).length,
    inputReadiness,
    shadows,
    vectorsDiffer: new Set(shadows.map((shadow) => JSON.stringify(shadow.inputVector))).size === shadows.length,
    writes: { predictionSnapshots: 0, consumerPredictions: 0 },
    note: "Shadow inference used candidate artifacts only; no prediction snapshot or consumer record was written.",
  };
}

export function snapshotMatchesProductionModels(
  snapshot: typeof predictionSnapshotsTable.$inferSelect,
  models: Map<Family, ProductionModel>,
) {
  const schema = sharedProductionSchema([...models.values()]);
  return models.size === 3
    && schema !== null
    && snapshot.featureVersion === schema.featureVersion
    && snapshot.spreadModelVersion === models.get("spread")?.modelVersion
    && snapshot.moneylineModelVersion === models.get("moneyline")?.modelVersion
    && snapshot.totalsModelVersion === models.get("totals")?.modelVersion
    && snapshot.inputFeatureCount === PHASE6_PRODUCTION_VECTOR_WIDTH
    && Array.isArray(snapshot.inputVector)
    && snapshot.inputVector.length === schema.names.length
    && snapshot.inputVector.every((value) => typeof value === "number" && Number.isFinite(value))
    && JSON.stringify(snapshot.vectorFeatureNames) === JSON.stringify(schema.names)
    && snapshot.vectorSchemaFingerprint === schema.fingerprint
    && isEligiblePredictionSnapshot(snapshot)
    && snapshot.snapshotKey.endsWith(`:input-integrity-v3:${schema.fingerprint}`);
}

export function immutableAuditVector(
  snapshot: { inputVector: number[] | null } | undefined,
  currentVector: Array<number | null> | null,
) {
  return Array.isArray(snapshot?.inputVector) ? [...snapshot.inputVector] : currentVector;
}

export async function getLiveModelInputIntegrityAudit(now = new Date()) {
  const models = await productionModels();
  const modelList = [...models.values()];
  const productionSchema = sharedProductionSchema(modelList);
  const schemaConsistent = productionSchema !== null;
  const featureVersion = productionSchema?.featureVersion ?? modelList[0]?.featureVersion ?? PREGAME_FEATURE_VERSION;
  const [featureRows, games, teams, snapshots] = await Promise.all([
    db.select().from(pregameTeamFeaturesTable).where(eq(pregameTeamFeaturesTable.featureVersion, featureVersion)),
    db.select().from(gamesTable).where(sql`${gamesTable.kickoffTime} is not null`).orderBy(asc(gamesTable.kickoffTime)),
    db.select().from(teamsTable),
    db.select().from(predictionSnapshotsTable).orderBy(desc(predictionSnapshotsTable.predictionTimestamp), desc(predictionSnapshotsTable.id)),
  ]);
  const diagnosticSourceNames = sourceFeatureNames(featureRows);
  const vectorFeatureNames = productionSchema?.names ?? [
    ...diagnosticSourceNames,
    "home_low_sample",
    "away_low_sample",
    "qb_confidence_difference",
  ];
  const selectedFeatureNames = vectorFeatureNames.slice(0, -3);
  const rowsByGame = new Map<string, typeof featureRows>();
  for (const row of featureRows) rowsByGame.set(row.gameId, [...(rowsByGame.get(row.gameId) ?? []), row]);
  const teamById = new Map(teams.map((team) => [team.teamId, team]));
  const latestSnapshot = new Map<string, typeof snapshots[number]>();
  for (const snapshot of snapshots) {
    if (isValidPredictionSnapshot(snapshot) && hasVerifiedPredictionInputs(snapshot) && snapshotMatchesProductionModels(snapshot, models) && !latestSnapshot.has(snapshot.gameId)) {
      latestSnapshot.set(snapshot.gameId, snapshot);
    }
  }
  const upcoming = games.filter((game) => isFutureGame(game, now));
  const records = [];
  for (const game of upcoming) {
    const rows = rowsByGame.get(game.gameId) ?? [];
    const vector = vectorForRows(rows, selectedFeatureNames);
    const context = await getPersonnelContextForGame(game.gameId, now);
    const eligibility = evaluateProductionInputEligibility(game, rows, vector, schemaConsistent, now);
    const causes = eligibility.causes.map((cause) => cause.replace("active feature version", featureVersion));
    const snapshot = latestSnapshot.get(game.gameId);
    const inputsReady = eligibility.eligible;
    const eligible = Boolean(snapshot);
    if (inputsReady && !snapshot) causes.push("Current inputs are ready, but no valid current-model snapshot is available.");
    const teamAudit = (teamId: string, side: "home" | "away") => {
      const row = rows.find((candidate) => candidate.teamId === teamId);
      const personnel = context?.teams[teamId];
      const qb = personnel?.qb;
      return {
        side,
        teamId,
        teamName: teamById.get(teamId)?.teamName ?? null,
        abbreviation: teamById.get(teamId)?.abbreviation ?? null,
        pregameRow: row ? {
          opponentTeamId: row.opponentTeamId,
          isHome: row.isHome,
          sourceCutoff: row.sourceCutoff.toISOString(),
          generatedAt: row.generatedAt.toISOString(),
          lowSample: row.lowSample,
        } : null,
        phase6QbConfidence: vector?.qb[side].confidence ?? null,
        phase6QbUnavailableReason: vector?.qb[side].unavailableReason ?? null,
        projectedStarter: qb?.projectedStarter ? {
          playerId: qb.projectedStarter.playerId,
          playerName: qb.projectedStarter.playerName,
          source: qb.projectedStarter.source,
          classification: qb.projectedStarter.classification,
          confidence: qb.projectedStarter.confidence,
          evidence: qb.projectedStarter.evidence,
          unavailableReason: qb.projectedStarter.unavailableReason,
        } : null,
        phase7QbCertainty: qb?.projectedStarter ? qb.starterCertainty : null,
        phase7QbUnavailableReason: qb?.projectedStarter ? null : qb?.unavailableReasons[0] ?? "Phase 7 projected-starter evidence is unavailable.",
        personnelCompleteness: personnel?.personnelCompleteness ?? null,
        sampleQuality: context?.dataConfidence.components.sampleQuality ?? null,
      };
    };
    records.push({
      gameId: game.gameId,
      season: game.season,
      week: game.week,
      kickoffTime: game.kickoffTime!.toISOString(),
      homeTeamId: game.homeTeamId,
      awayTeamId: game.awayTeamId,
      snapshotId: snapshot?.id ?? null,
      featureVersion,
      models: modelList.map((model) => ({ family: model.family, modelVersion: model.modelVersion, algorithm: model.algorithm, featureVersion: model.featureVersion })),
      vectorFeatureNames,
      vector: immutableAuditVector(snapshot, vector?.values ?? null),
      currentVector: vector?.values ?? null,
      snapshotVector: snapshot?.inputVector ?? null,
      vectorSchemaFingerprint: productionSchema?.fingerprint ?? null,
      vectorProvenance: productionSchema ? "persisted_active_model_contract" : "diagnostic_only_unverified_legacy_contract",
      snapshotInputSourceEvidence: snapshot?.inputSourceEvidence ?? null,
      requiredCount: snapshot?.inputFeatureCount ?? vector?.inputFeatureCount ?? vectorFeatureNames.length,
      populatedCount: snapshot
        ? snapshot.inputFeatureCount - snapshot.inputMissingFeatureCount
        : vector?.inputPopulatedFeatureCount ?? 0,
      missingCount: snapshot?.inputMissingFeatureCount ?? vector?.inputMissingFeatureCount ?? vectorFeatureNames.length,
      legitimateZeroCount: snapshot?.inputVector?.filter((value) => value === 0).length ?? vector?.legitimateZeroCount ?? 0,
      formerlyMissingZeroCount: snapshot ? 0 : vector?.formerlyMissingZeroCount ?? vectorFeatureNames.length,
      missingInputs: snapshot ? [] : vector?.missingFeatures ?? [],
      rowIdentityValid: eligibility.identityValid,
      sourceEvidence: (snapshot?.inputSourceEvidence as { rows?: unknown[] } | null)?.rows ?? rows.map((row) => ({
        teamId: row.teamId,
        sourceCutoff: row.sourceCutoff.toISOString(),
        selectedFeatures: Object.fromEntries(selectedFeatureNames.map((name) => [name, row.featureAudit[name] ?? { value: row.features[name] ?? null }])),
      })),
      currentSourceEvidence: rows.map((row) => ({
        teamId: row.teamId,
        sourceCutoff: row.sourceCutoff.toISOString(),
        selectedFeatures: Object.fromEntries(selectedFeatureNames.map((name) => [name, row.featureAudit[name] ?? { value: row.features[name] ?? null }])),
      })),
      teams: [teamAudit(game.homeTeamId, "home"), teamAudit(game.awayTeamId, "away")],
      inputQualityStatus: inputsReady ? "ready" : "incomplete",
      inputReadiness: inputsReady,
      predictionEligibility: eligible,
      consumerAvailability: eligible ? null : "Prediction pending — incomplete model inputs",
      causes,
      phase7UsedForValidationOnly: true,
    });
  }
  const eligibleVectors = records.filter((record) => record.predictionEligibility && record.vector);
  const vectorFingerprints = new Set(eligibleVectors.map((record) => JSON.stringify(record.vector)));
  return {
    generatedAt: now.toISOString(),
    featureVersion,
    modelSchemaStatus: schemaConsistent ? "valid" : "invalid",
    productionModels: modelList.map((model) => ({ family: model.family, modelVersion: model.modelVersion, algorithm: model.algorithm, featureVersion: model.featureVersion })),
    selectedFeatureNames,
    vectorFeatureNames,
    upcomingGames: records.length,
    trustworthyUpcomingPredictions: records.length > 0 && records.every((record) => record.predictionEligibility),
    inputReadyGames: records.filter((record) => record.inputReadiness).length,
    eligibleGames: eligibleVectors.length,
    incompleteGames: records.length - eligibleVectors.length,
    distinctEligibleVectors: vectorFingerprints.size,
    vectorsDiffer: eligibleVectors.length < 2 ? null : vectorFingerprints.size === eligibleVectors.length,
    modelLifecycleEvidence: modelList.map((model) => ({
      family: model.family,
      modelVersion: model.modelVersion,
      trainedAt: model.trainedAt.toISOString(),
      promotedAt: model.promotedAt.toISOString(),
      immutableArtifactAvailable: Boolean(model.modelArtifact),
    })),
    records,
  };
}

export async function freezeOfficialFinalPredictions(
  now = new Date(),
  options: { gameId?: string; cutoffOverride?: Date } = {},
) {
  const latestFreezeTime = new Date(now.getTime() + CANONICAL_EVALUATION_CUTOFF_MINUTES * 60_000);
  const candidates = await db.select().from(predictionSnapshotsTable).where(and(
    eq(predictionSnapshotsTable.officialFinalPrediction, false),
    ...(options.gameId ? [eq(predictionSnapshotsTable.gameId, options.gameId)] : []),
    sql`${predictionSnapshotsTable.kickoffTime} is not null`,
    sql`${predictionSnapshotsTable.kickoffTime} > ${now}`,
    ...(options.gameId ? [] : [lte(predictionSnapshotsTable.kickoffTime, latestFreezeTime)]),
    sql`${predictionSnapshotsTable.predictionTimestamp} <= ${predictionSnapshotsTable.kickoffTime} - (${CANONICAL_EVALUATION_CUTOFF_MINUTES} * interval '1 minute')`,
  )).orderBy(asc(predictionSnapshotsTable.gameId), desc(predictionSnapshotsTable.predictionTimestamp));
  const latest = new Map<string, {
    candidate: typeof candidates[number];
    canonicalMarket: Awaited<ReturnType<typeof marketData>>;
    evaluationCutoffAt: Date;
  }>();
  let missingMarketEvidence = 0;
  for (const candidate of candidates) {
    const cutoff = candidate.kickoffTime
      ? canonicalEvaluationCutoff(candidate.kickoffTime, options.cutoffOverride)
      : null;
    if (
      cutoff
      && canonicalFreezeWindowOpen(candidate.predictionTimestamp, candidate.kickoffTime!, now, options.cutoffOverride)
      && isEligiblePredictionSnapshot(candidate)
      && !latest.has(candidate.gameId)
    ) {
      const [game] = await db.select().from(gamesTable).where(eq(gamesTable.gameId, candidate.gameId)).limit(1);
      const [home] = game
        ? await db.select().from(teamsTable).where(eq(teamsTable.teamId, game.homeTeamId)).limit(1)
        : [];
      if (!game?.kickoffTime || game.kickoffTime <= now || !home) continue;
      const evaluationCutoffAt = canonicalEvaluationCutoff(game.kickoffTime, cutoff);
      if (candidate.predictionTimestamp > evaluationCutoffAt || evaluationCutoffAt > now) continue;
      // The model snapshot is selected independently from the market stream.
      // Re-read the latest book/market observations at-or-before the
      // immutable cutoff instead of trusting the market embedded at prediction
      // time. This is the canonical evaluation occurrence.
      const canonicalMarket = await marketData(candidate.gameId, evaluationCutoffAt, {
        teamId: home.teamId,
        name: home.teamName,
        abbreviation: home.abbreviation,
      }, false);
      if (!canonicalSnapshotReady(candidate.predictionTimestamp, evaluationCutoffAt, canonicalMarket)) {
        missingMarketEvidence += 1;
        continue;
      }
      recordCanonicalFreezeCandidate(latest, candidate.gameId, { candidate, canonicalMarket, evaluationCutoffAt });
    }
  }
  let frozen = 0;
  for (const { candidate, canonicalMarket, evaluationCutoffAt } of latest.values()) {
    const canonicalComparison = comparisonData(
      canonicalMarket,
      candidate.projectedMargin,
      candidate.projectedTotal,
      candidate.homeWinProbability,
    );
    const result = await db.update(predictionSnapshotsTable).set({
      marketSnapshot: canonicalMarketEvidenceSnapshot(
        candidate.marketSnapshot,
        candidate.marketComparison,
        canonicalMarket,
        canonicalComparison,
        {
          cutoffAt: evaluationCutoffAt,
          frozenAt: now,
          candidate,
        },
      ),
      marketComparison: canonicalComparison,
      officialFinalPrediction: true,
      evaluationCutoffAt,
      frozenAt: now,
    }).where(and(
      eq(predictionSnapshotsTable.id, candidate.id),
      eq(predictionSnapshotsTable.officialFinalPrediction, false),
      lte(predictionSnapshotsTable.predictionTimestamp, evaluationCutoffAt),
      sql`${evaluationCutoffAt} <= now()`,
      sql`${predictionSnapshotsTable.kickoffTime} > now()`,
      sql`exists (
        select 1 from ${gamesTable}
        where ${gamesTable.gameId} = ${predictionSnapshotsTable.gameId}
          and ${gamesTable.kickoffTime} > now()
          and ${evaluationCutoffAt} <= ${gamesTable.kickoffTime}
            - (${CANONICAL_EVALUATION_CUTOFF_MINUTES} * interval '1 minute')
      )`,
    )).returning({ id: predictionSnapshotsTable.id });
    if (result.length) frozen += 1;
  }
  return {
    status: "success",
    frozen,
    pendingMarketEvidence: missingMarketEvidence,
    canonicalCutoffMinutes: CANONICAL_EVALUATION_CUTOFF_MINUTES,
    canonicalCutoffAt: [...latest.values()][0]?.candidate.kickoffTime
      ? [...latest.values()][0]!.evaluationCutoffAt.toISOString()
      : null,
  };
}

export function canonicalEvaluationCutoff(kickoff: Date, cutoffOverride?: Date) {
  const fixedCutoff = new Date(kickoff.getTime() - CANONICAL_EVALUATION_CUTOFF_MINUTES * 60_000);
  return cutoffOverride && Number.isFinite(cutoffOverride.getTime()) && cutoffOverride < fixedCutoff
    ? cutoffOverride
    : fixedCutoff;
}

export function canonicalFreezeWindowOpen(
  predictionTimestamp: Date,
  kickoff: Date,
  now: Date,
  cutoffOverride?: Date,
) {
  const cutoff = canonicalEvaluationCutoff(kickoff, cutoffOverride);
  return predictionTimestamp <= cutoff && cutoff <= now && now < kickoff;
}

export function recordCanonicalFreezeCandidate<T>(
  selected: Map<string, T>,
  gameId: string,
  value: T,
) {
  if (selected.has(gameId)) return false;
  selected.set(gameId, value);
  return true;
}

export function canonicalMarketEvidenceSnapshot(
  predictionTimeMarketSnapshot: Record<string, unknown>,
  predictionTimeMarketComparison: Record<string, unknown>,
  canonicalMarket: Record<string, unknown>,
  canonicalComparison: Record<string, unknown>,
  details: {
    cutoffAt: Date;
    frozenAt: Date;
    candidate: {
      snapshotKey: string;
      predictionTimestamp: Date;
      qbConfidence: number | null;
      lowSample: boolean;
      inputFeatureCount: number;
      inputMissingFeatureCount: number;
      homeWinProbability: number | null;
      awayWinProbability: number | null;
    };
  },
): Record<string, unknown> {
  return {
    ...canonicalMarket,
    predictionTimeEvidence: {
      marketSnapshot: predictionTimeMarketSnapshot,
      marketComparison: predictionTimeMarketComparison,
    },
    canonicalEvaluation: {
      cutoffAt: details.cutoffAt.toISOString(),
      frozenAt: details.frozenAt.toISOString(),
      candidateSnapshotKey: details.candidate.snapshotKey,
      candidatePredictionTimestamp: details.candidate.predictionTimestamp.toISOString(),
      canonicalComparison,
      confidence: {
        qbConfidence: details.candidate.qbConfidence,
        lowSample: details.candidate.lowSample,
        inputFeatureCount: details.candidate.inputFeatureCount,
        inputMissingFeatureCount: details.candidate.inputMissingFeatureCount,
        homeWinProbability: details.candidate.homeWinProbability,
        awayWinProbability: details.candidate.awayWinProbability,
      },
      explanation: "Official prediction selected at or before the fixed 30-minute pre-kickoff cutoff; complete DraftKings and FanDuel spread, moneyline, and total evidence was observed no later than that cutoff.",
    },
  };
}

/**
 * Canonical evaluation requires both supported books for every supported
 * market. The cutoff occurrence independently selects the latest persisted
 * observations and writes them onto the one immutable official snapshot.
 */
export function hasCompleteCanonicalMarketEvidence(
  snapshot: Record<string, unknown>,
  cutoff: Date,
) {
  const markets = snapshot.markets;
  if (!markets || typeof markets !== "object") return false;
  for (const market of ["spread", "moneyline", "total"]) {
    const row = (markets as Record<string, unknown>)[market];
    if (!row || typeof row !== "object") return false;
    const marketRow = row as Record<string, unknown>;
    if (!Array.isArray(marketRow.quotes)) return false;
    for (const [book, sportsbook] of [["draftKings", "DraftKings"], ["fanDuel", "FanDuel"]] as const) {
      const quote = marketRow[book];
      if (!quote || typeof quote !== "object") return false;
      const value = quote as Record<string, unknown>;
      if (value.market !== market || value.sportsbook !== sportsbook
        || typeof value.price !== "number" || !Number.isFinite(value.price)
        || typeof value.capturedAt !== "string") return false;
      if (!canonicalQuoteFreshAt(value, cutoff)) return false;
      if (market !== "moneyline" && (typeof value.point !== "number" || !Number.isFinite(value.point))) return false;
      const outcomes = new Set<string>();
      for (const quote of marketRow.quotes) {
        if (!quote || typeof quote !== "object") continue;
        const rawQuote = quote as Record<string, unknown>;
        if (rawQuote.sportsbook !== sportsbook) continue;
        if (rawQuote.market !== market || typeof rawQuote.selection !== "string" || !rawQuote.selection
          || typeof rawQuote.price !== "number" || !Number.isFinite(rawQuote.price)
          || typeof rawQuote.capturedAt !== "string" || !canonicalQuoteFreshAt(rawQuote, cutoff)
          || (market !== "moneyline"
            && (typeof rawQuote.point !== "number" || !Number.isFinite(rawQuote.point)))) return false;
        outcomes.add(rawQuote.selection);
      }
      if (market === "moneyline" && outcomes.size < 2) return false;
    }
  }
  return true;
}

function canonicalQuoteFreshAt(quote: Record<string, unknown>, cutoff: Date) {
  if (typeof quote.capturedAt !== "string") return false;
  const captured = new Date(quote.capturedAt);
  return Number.isFinite(captured.getTime())
    && captured <= cutoff
    && cutoff.getTime() - captured.getTime() <= CANONICAL_MARKET_MAX_AGE_MINUTES * 60_000;
}

/**
 * Shared cutoff gate: an old model row alone is never canonical. The model
 * timestamp and every retained DK/FD market observation must be at or before
 * the same fixed cutoff.
 */
export function canonicalSnapshotReady(
  predictionTimestamp: Date,
  cutoff: Date,
  marketSnapshot: Record<string, unknown>,
) {
  return Number.isFinite(predictionTimestamp.getTime())
    && Number.isFinite(cutoff.getTime())
    && predictionTimestamp <= cutoff
    && hasCompleteCanonicalMarketEvidence(marketSnapshot, cutoff);
}

export function isCanonicalOfficialPrediction(
  snapshot: typeof predictionSnapshotsTable.$inferSelect,
  authoritativeKickoff: Date | null | undefined,
  asOf = new Date(),
) {
  if (!snapshot.officialFinalPrediction || !authoritativeKickoff
    || !snapshot.kickoffTime || !snapshot.frozenAt || !snapshot.evaluationCutoffAt
    || snapshot.frozenAt > asOf || snapshot.frozenAt >= authoritativeKickoff
    || snapshot.evaluationCutoffAt > snapshot.frozenAt
    || snapshot.evaluationCutoffAt > new Date(authoritativeKickoff.getTime()
      - CANONICAL_EVALUATION_CUTOFF_MINUTES * 60_000)
    || snapshot.predictionTimestamp > snapshot.evaluationCutoffAt
    || !isEligiblePredictionSnapshot(snapshot)
    || !hasCompleteCanonicalMarketEvidence(snapshot.marketSnapshot, snapshot.evaluationCutoffAt)) return false;
  const meta = snapshot.marketSnapshot.canonicalEvaluation as Record<string, unknown> | undefined;
  const predictionTime = snapshot.marketSnapshot.predictionTimeEvidence;
  return Boolean(meta && predictionTime && typeof predictionTime === "object"
    && meta.cutoffAt === snapshot.evaluationCutoffAt.toISOString()
    && meta.frozenAt === snapshot.frozenAt.toISOString()
    && meta.candidateSnapshotKey === snapshot.snapshotKey
    && meta.candidatePredictionTimestamp === snapshot.predictionTimestamp.toISOString());
}

function resultForLine(actual: number, line: number | null, direction: "spread" | "total") {
  if (line === null || !Number.isFinite(line)) return { status: "unavailable" };
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
  const [home] = await db.select({
    teamId: teamsTable.teamId,
    name: teamsTable.teamName,
    abbreviation: teamsTable.abbreviation,
  }).from(teamsTable).where(eq(teamsTable.teamId, game.homeTeamId)).limit(1);
  const closingMarkets = await marketData(
    game.gameId,
    game.kickoffTime ?? new Date(),
    home ?? { teamId: game.homeTeamId, name: game.homeTeamId, abbreviation: game.homeTeamId },
    true,
  );
  const closingComparison = comparisonData(
    closingMarkets,
    snapshot.projectedMargin,
    snapshot.projectedTotal,
    snapshot.homeWinProbability,
  ) as Record<string, any>;
  const clv = {
    spreadPoints: typeof comparison.spread?.marketLine === "number" && Number.isFinite(comparison.spread.marketLine)
      && typeof closingComparison.spread?.marketLine === "number" && Number.isFinite(closingComparison.spread.marketLine)
      ? comparison.spread.marketLine - closingComparison.spread.marketLine : null,
    totalPoints: typeof comparison.totals?.marketTotal === "number" && Number.isFinite(comparison.totals.marketTotal)
      && typeof closingComparison.totals?.marketTotal === "number" && Number.isFinite(closingComparison.totals.marketTotal)
      ? closingComparison.totals.marketTotal - comparison.totals.marketTotal : null,
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
  const predictions = await db.select().from(predictionSnapshotsTable)
    .where(eq(predictionSnapshotsTable.officialFinalPrediction, true));
  if (!predictions.length) return { status: "success", graded: 0 };
  const gameIds = [...new Set(predictions.map((prediction) => prediction.gameId))];
  const games = await db.select().from(gamesTable).where(inArray(gamesTable.gameId, gameIds));
  const grades = await db.select({ predictionId: predictionGradesTable.predictionId }).from(predictionGradesTable).where(inArray(predictionGradesTable.predictionId, predictions.map((prediction) => prediction.id)));
  const gradedIds = new Set(grades.map((grade) => grade.predictionId));
  let graded = 0;
  for (const prediction of predictions) {
    if (gradedIds.has(prediction.id)) continue;
    const game = games.find((candidate) => candidate.gameId === prediction.gameId);
    if (!game || !isCanonicalOfficialPrediction(prediction, game.kickoffTime, now)) continue;
    const authoritativeFinal = interpretNflGameState(game, now) === "final"
      && game.finalHomeScore !== null && game.finalAwayScore !== null
      && Boolean(game.kickoffTime && game.kickoffTime <= now);
    if (!authoritativeFinal) continue;
    const grade = await gradeSnapshot(prediction, game);
    if (!grade) continue;
    const inserted = await db.insert(predictionGradesTable).values({ predictionId: prediction.id, ...grade })
      .onConflictDoNothing({ target: predictionGradesTable.predictionId })
      .returning({ id: predictionGradesTable.id });
    if (inserted.length) graded += 1;
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
  const selectedRowsWithSentinel = (await query).filter((row) =>
    isCanonicalOfficialPrediction(row.prediction, row.game?.kickoffTime));
  const windowTruncated = maxOfficialPredictions !== undefined
    && selectedRowsWithSentinel.length > maxOfficialPredictions;
  const selectedRows = maxOfficialPredictions === undefined
    ? selectedRowsWithSentinel
    : selectedRowsWithSentinel.slice(0, maxOfficialPredictions);
  const rows = selectedRows
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
    .select({ prediction: predictionSnapshotsTable, grade: predictionGradesTable, game: gamesTable })
    .from(predictionSnapshotsTable)
    .innerJoin(predictionGradesTable, eq(predictionGradesTable.predictionId, predictionSnapshotsTable.id))
    .innerJoin(gamesTable, eq(gamesTable.gameId, predictionSnapshotsTable.gameId))
    .where(eq(predictionSnapshotsTable.officialFinalPrediction, true))
    .orderBy(desc(predictionSnapshotsTable.predictionTimestamp)))
    .filter((row) => isCanonicalOfficialPrediction(row.prediction, row.game.kickoffTime));
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
  const models = await productionModels();
  const rows = await db.select().from(predictionSnapshotsTable)
    .where(sql`${predictionSnapshotsTable.kickoffTime} > ${now}`)
    .orderBy(asc(predictionSnapshotsTable.kickoffTime), desc(predictionSnapshotsTable.predictionTimestamp));
  const latest = new Map<string, typeof rows[number]>();
  for (const row of rows) {
    const valid = [row.projectedMargin, row.projectedTotal, row.homeWinProbability, row.awayWinProbability]
      .every((value) => typeof value === "number" && Number.isFinite(value));
    if (valid && hasVerifiedPredictionInputs(row) && snapshotMatchesProductionModels(row, models) && !latest.has(row.gameId)) latest.set(row.gameId, row);
  }
  return [...latest.values()];
}

export async function getLatestValidPredictionSnapshots(
  gameIds: string[],
  options: { preKickoffOnly?: boolean; authoritativeGameKickoff?: boolean; maxRows?: number; cutoffAt?: Date } = {},
) {
  if (!gameIds.length) return new Map<string, typeof predictionSnapshotsTable.$inferSelect>();
  const models = await productionModels();
  const schema = sharedProductionSchema([...models.values()]);
  if (!schema) return new Map<string, typeof predictionSnapshotsTable.$inferSelect>();
  const featureVersion = schema.featureVersion;
  const productionConditions = [
    eq(predictionSnapshotsTable.featureVersion, featureVersion),
    eq(predictionSnapshotsTable.spreadModelVersion, models.get("spread")!.modelVersion),
    eq(predictionSnapshotsTable.moneylineModelVersion, models.get("moneyline")!.modelVersion),
    eq(predictionSnapshotsTable.totalsModelVersion, models.get("totals")!.modelVersion),
    eq(predictionSnapshotsTable.inputFeatureCount, PHASE6_PRODUCTION_VECTOR_WIDTH),
    eq(predictionSnapshotsTable.inputMissingFeatureCount, 0),
    eq(predictionSnapshotsTable.vectorSchemaFingerprint, schema.fingerprint),
    sql`${predictionSnapshotsTable.vectorFeatureNames} = ${JSON.stringify(schema.names)}::jsonb`,
    sql`${predictionSnapshotsTable.inputVector} is not null`,
    sql`${predictionSnapshotsTable.inputSourceEvidence} is not null`,
    sql`${predictionSnapshotsTable.snapshotKey} like ${`%:input-integrity-v3:${schema.fingerprint}`}`,
  ];
  if (options.authoritativeGameKickoff) {
    const rows = await db.selectDistinctOn(
      [predictionSnapshotsTable.gameId],
      { prediction: predictionSnapshotsTable },
    )
      .from(predictionSnapshotsTable)
      .innerJoin(gamesTable, eq(gamesTable.gameId, predictionSnapshotsTable.gameId))
      .where(and(
        inArray(predictionSnapshotsTable.gameId, gameIds),
        ...productionConditions,
        options.cutoffAt ? lte(predictionSnapshotsTable.predictionTimestamp, options.cutoffAt) : undefined,
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
      ))
      .orderBy(
        predictionSnapshotsTable.gameId,
        desc(predictionSnapshotsTable.predictionTimestamp),
        desc(predictionSnapshotsTable.id),
      )
      .limit(options.maxRows ?? gameIds.length);
    return new Map(rows
      .map((row) => row.prediction)
      .filter((snapshot) => isValidPredictionSnapshot(snapshot) && hasVerifiedPredictionInputs(snapshot) && snapshotMatchesProductionModels(snapshot, models))
      .map((snapshot) => [snapshot.gameId, snapshot]));
  }
  const conditions = [
    inArray(predictionSnapshotsTable.gameId, gameIds),
    ...productionConditions,
    options.preKickoffOnly
      ? sql`${predictionSnapshotsTable.predictionTimestamp} < ${predictionSnapshotsTable.kickoffTime}`
      : undefined,
    options.cutoffAt ? lte(predictionSnapshotsTable.predictionTimestamp, options.cutoffAt) : undefined,
  ].filter((condition): condition is NonNullable<typeof condition> => Boolean(condition));
  const query = db.select().from(predictionSnapshotsTable)
    .where(and(...conditions))
    .orderBy(desc(predictionSnapshotsTable.predictionTimestamp), desc(predictionSnapshotsTable.id));
  const rows = options.maxRows === undefined ? await query : await query.limit(options.maxRows);
  const latest = new Map<string, typeof rows[number]>();
  for (const row of rows) {
    if (isValidPredictionSnapshot(row) && hasVerifiedPredictionInputs(row) && snapshotMatchesProductionModels(row, models) && !latest.has(row.gameId)) latest.set(row.gameId, row);
  }
  return latest;
}

export async function getProductionModelStatus() {
  const models = await productionModels();
  return sharedProductionSchema([...models.values()]) ? "available" as const : "not_trained" as const;
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
  const selectedRows = (await db.select({ prediction: predictionSnapshotsTable, grade: predictionGradesTable, game: gamesTable })
    .from(predictionSnapshotsTable)
    .innerJoin(predictionGradesTable, eq(predictionGradesTable.predictionId, predictionSnapshotsTable.id))
    .innerJoin(gamesTable, eq(gamesTable.gameId, predictionSnapshotsTable.gameId))
    .where(and(eq(gamesTable.season, season), eq(gamesTable.week, week))))
    .filter((row) => isCanonicalOfficialPrediction(row.prediction, row.game.kickoffTime));
  const misses = selectedRows
    .sort((left, right) => Math.max(Math.abs(right.grade.marginError ?? 0), Math.abs(right.grade.totalError ?? 0)) - Math.max(Math.abs(left.grade.marginError ?? 0), Math.abs(left.grade.totalError ?? 0)))
    .slice(0, 5)
    .map((row) => ({ gameId: row.prediction.gameId, whyMiss: row.grade.whyMiss, projectedMargin: row.prediction.projectedMargin, actualMargin: row.grade.actualMargin, projectedTotal: row.prediction.projectedTotal, actualTotal: row.grade.actualTotal }));
  const report = { season, week, completedGames: selectedRows.length, performance, misses, generatedAt: new Date().toISOString() };
  const narrative = selectedRows.length
    ? `Gridline graded ${selectedRows.length} official prediction snapshot${selectedRows.length === 1 ? "" : "s"} for ${season} week ${week}. ` +
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
  return db.select().from(weeklyLearningReportsTable).orderBy(desc(weeklyLearningReportsTable.generatedAt)).limit(12);
}
