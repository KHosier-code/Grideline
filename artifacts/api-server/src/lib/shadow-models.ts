import { createHash } from "node:crypto";
import { and, asc, desc, eq, inArray } from "drizzle-orm";
import {
  db,
  evaluationBaselineManifestsTable,
  gamesTable,
  pregameTeamFeaturesTable,
  predictionSnapshotsTable,
  shadowModelCutoffsTable,
  shadowModelGradesTable,
  teamsTable,
} from "@workspace/db";
import { PHASE61_RELEASE_MODEL_VERSIONS } from "./phase61-release";
import { americanOddsProfit } from "./market-baseline";
import { interpretNflGameState } from "./game-state";
import retainedAdvancedReport from "../../../../reports/gridline-advanced-challenger-evaluation.json" with { type: "json" };

export const SHADOW_CONTRACT_VERSION = "shadow-forward-v1";
export const SHADOW_MINIMUM_SAMPLE = 30;
export const SHADOW_MODEL_FAMILIES = [
  "phase61",
  "advanced_football",
  "market_residual",
  "ensemble",
] as const;
export type ShadowModelFamily = typeof SHADOW_MODEL_FAMILIES[number];

export const SHADOW_MODEL_CONTRACT = {
  version: SHADOW_CONTRACT_VERSION,
  cutoffMinutes: 30,
  maximumMarketAgeMinutes: 15,
  families: [...SHADOW_MODEL_FAMILIES],
  windows: ["season", "last20", "last50"],
  minimumSample: SHADOW_MINIMUM_SAMPLE,
  eligibility: "One row per scheduled game and family at the canonical cutoff; unavailable inference is retained, never replaced.",
  grading: "Official final score against the shared frozen cutoff market snapshot; returns require a valid selected-side price.",
} as const;

function canonicalJson(value: unknown): string {
  if (value instanceof Date) return JSON.stringify(value.toISOString());
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value as Record<string, unknown>).sort().map((key) =>
      `${JSON.stringify(key)}:${canonicalJson((value as Record<string, unknown>)[key])}`).join(",")}}`;
  }
  return JSON.stringify(value) ?? "null";
}

export function shadowFingerprint(value: unknown) {
  return createHash("sha256").update(canonicalJson(value)).digest("hex");
}

const CHALLENGER_UNAVAILABLE = {
  advanced_football: {
    version: "advanced-challenger-v1",
    reason: "immutable_forward_artifact_not_approved",
  },
  market_residual: {
    version: "advanced-challenger-v1:market-residual",
    reason: "immutable_forward_artifact_not_approved",
  },
  ensemble: {
    version: "research-ensemble-v1",
    reason: "immutable_forward_artifact_not_approved",
  },
} as const;

type AdvancedEvidenceModel = {
  family: "spread" | "moneyline" | "totals";
  evidenceFingerprint: string;
  featureNames: string[];
  evaluationEvidence: {
    standardization: { centers: number[]; scales: number[] };
    fittedModel: {
      classification: boolean;
      parameters: Record<string, unknown>;
    };
  };
};

const RETAINED_ADVANCED_MODELS = (retainedAdvancedReport.models as unknown as AdvancedEvidenceModel[])
  .filter((model) => model.evaluationEvidence && model.family && model.featureNames?.length);
const RETAINED_ADVANCED_VERSION = RETAINED_ADVANCED_MODELS.length === 3
  ? `advanced-challenger-v1:${RETAINED_ADVANCED_MODELS.map((model) => model.evidenceFingerprint.slice(0, 12)).join("-")}`
  : "advanced-challenger-v1:incomplete";

function predictResearchTree(node: Record<string, unknown>, row: number[]): number {
  if (typeof node.feature !== "number") return Number(node.value);
  const branch = row[node.feature] <= Number(node.threshold) ? node.left : node.right;
  return predictResearchTree(branch as Record<string, unknown>, row);
}

function predictAdvancedArtifact(model: AdvancedEvidenceModel, vector: number[]) {
  const { centers, scales } = model.evaluationEvidence.standardization;
  if (vector.length !== centers.length || centers.length !== scales.length) return null;
  const x = vector.map((value, index) => (value - centers[index]) / scales[index]);
  const parameters = model.evaluationEvidence.fittedModel.parameters;
  let raw: number;
  if (Array.isArray(parameters.coefficients)) {
    raw = Number(parameters.coefficients[0])
      + x.reduce((sum, value, index) => sum + value * Number((parameters.coefficients as number[])[index + 1]), 0);
  } else if (Array.isArray(parameters.trees)) {
    raw = Number(parameters.base) + parameters.trees.reduce((sum, item) => {
      const tree = item as { tree: Record<string, unknown>; weight: number };
      return sum + tree.weight * predictResearchTree(tree.tree, x);
    }, 0);
  } else return null;
  if (!Number.isFinite(raw)) return null;
  return model.evaluationEvidence.fittedModel.classification
    ? Math.max(.001, Math.min(.999, 1 / (1 + Math.exp(-Math.max(-30, Math.min(30, raw))))))
    : raw;
}

export function isAdvancedFeatureRowCutoffSafe(
  row: { sourceCutoff: Date; generatedAt: Date },
  cutoffAt: Date,
) {
  return row.sourceCutoff <= cutoffAt && row.generatedAt <= cutoffAt;
}

async function advancedForwardInference(gameId: string, featureVersion: string, cutoffAt: Date) {
  const models = RETAINED_ADVANCED_MODELS;
  if (models.length !== 3) return { available: false as const, reason: "retained_advanced_artifacts_incomplete" };
  const featureNames = models[0].featureNames;
  if (models.some((model) => JSON.stringify(model.featureNames) !== JSON.stringify(featureNames))) {
    return { available: false as const, reason: "advanced_feature_contract_mismatch" };
  }
  const allRows = await db.select().from(pregameTeamFeaturesTable)
    .where(eq(pregameTeamFeaturesTable.featureVersion, featureVersion));
  const rows = allRows.filter((row) =>
    row.gameId === gameId && isAdvancedFeatureRowCutoffSafe(row, cutoffAt));
  const home = rows.find((row) => row.isHome);
  const away = rows.find((row) => !row.isHome);
  if (!home || !away) return { available: false as const, reason: "advanced_paired_features_unavailable" };
  const sourceNames = [...new Set([...Object.keys(home.features), ...Object.keys(away.features)])]
    .filter((name) => !name.startsWith("market.") && !/personnel|injury|depth|starter/i.test(name)).sort();
  const vector = sourceNames.flatMap((sourceName) => {
    const left = home.features[sourceName];
    const right = away.features[sourceName];
    const complete = typeof left === "number" && Number.isFinite(left)
      && typeof right === "number" && Number.isFinite(right);
    return [complete ? left - right : 0, complete ? 1 : 0];
  });
  const prior = allRows.filter((row) => row.kickoffTime < home.kickoffTime
    && isAdvancedFeatureRowCutoffSafe(row, cutoffAt)
    && (row.teamId === home.teamId || row.teamId === away.teamId))
    .sort((left, right) => right.kickoffTime.getTime() - left.kickoffTime.getTime());
  const previousByTeam = new Map<string, Date>();
  for (const row of prior) if (!previousByTeam.has(row.teamId)) previousByTeam.set(row.teamId, row.kickoffTime);
  const homePrior = previousByTeam.get(home.teamId);
  const awayPrior = previousByTeam.get(away.teamId);
  const retainedPriorRows = [home.teamId, away.teamId].flatMap((teamId) => {
    const row = prior.find((item) => item.teamId === teamId);
    return row ? [{
      gameId: row.gameId,
      teamId: row.teamId,
      kickoffTime: row.kickoffTime,
      sourceCutoff: row.sourceCutoff,
      generatedAt: row.generatedAt,
      features: row.features,
    }] : [];
  });
  const homeRest = homePrior ? (home.kickoffTime.getTime() - homePrior.getTime()) / 86_400_000 : null;
  const awayRest = awayPrior ? (away.kickoffTime.getTime() - awayPrior.getTime()) / 86_400_000 : null;
  vector.push(1, homeRest !== null && awayRest !== null ? homeRest - awayRest : 0, homeRest !== null && awayRest !== null ? 1 : 0);
  const generatedNames = sourceNames.flatMap((sourceName) => {
    const expected = featureNames.find((name) => name.endsWith(`.${sourceName}`));
    const prefix = expected?.slice(0, -(sourceName.length + 1));
    return prefix ? [`${prefix}.${sourceName}`, `${prefix}.${sourceName}.available`] : [];
  });
  generatedNames.push("schedule.home_indicator", "schedule.rest_days_difference", "schedule.available");
  if (JSON.stringify(generatedNames) !== JSON.stringify(featureNames)) {
    return { available: false as const, reason: "advanced_current_feature_contract_mismatch" };
  }
  const inputEvidence = {
    contract: "advanced-retained-artifact-input-v1",
    cutoffAt,
    currentRows: [home, away].map((row) => ({
      gameId: row.gameId,
      teamId: row.teamId,
      kickoffTime: row.kickoffTime,
      sourceCutoff: row.sourceCutoff,
      generatedAt: row.generatedAt,
      features: row.features,
    })),
    priorRows: retainedPriorRows,
  };
  const predictions = Object.fromEntries(models.map((model) => [model.family, predictAdvancedArtifact(model, vector)]));
  if (!Object.values(predictions).every((value) => typeof value === "number" && Number.isFinite(value))) {
    return { available: false as const, reason: "advanced_inference_nonfinite" };
  }
  return {
    available: true as const,
    vector,
    featureNames,
    inputEvidence,
    inputFingerprint: shadowFingerprint(inputEvidence),
    fingerprint: shadowFingerprint(models.map((model) => model.evidenceFingerprint)),
    version: RETAINED_ADVANCED_VERSION,
    projectedMargin: predictions.spread!,
    projectedTotal: predictions.totals!,
    homeWinProbability: predictions.moneyline!,
  };
}

type MarketQuote = {
  sportsbook?: string;
  market?: string;
  selection?: string;
  point?: number | null;
  price?: number;
  capturedAt?: string;
};

function marketPart(snapshot: Record<string, unknown>, name: "spread" | "moneyline" | "total") {
  const markets = snapshot.markets as Record<string, Record<string, unknown>> | undefined;
  return markets?.[name] ?? {};
}

function bestQuote(snapshot: Record<string, unknown>, name: "spread" | "moneyline" | "total") {
  return (marketPart(snapshot, name).bestAvailable ?? null) as MarketQuote | null;
}

export async function captureShadowModelsForCanonicalGame(gameId: string, cutoffAt: Date, inferenceAt = new Date()) {
  const [game] = await db.select().from(gamesTable).where(eq(gamesTable.gameId, gameId)).limit(1);
  if (!game?.kickoffTime) return { status: "skipped", reason: "game_or_kickoff_unavailable", inserted: 0 };
  if (inferenceAt >= game.kickoffTime) return { status: "skipped", reason: "post_kickoff_inference_rejected", inserted: 0 };
  const [snapshot] = await db.select().from(predictionSnapshotsTable).where(and(
    eq(predictionSnapshotsTable.gameId, gameId),
    eq(predictionSnapshotsTable.officialFinalPrediction, true),
  )).limit(1);
  if (!snapshot || !snapshot.evaluationCutoffAt
    || snapshot.evaluationCutoffAt.getTime() !== cutoffAt.getTime()) {
    return { status: "pending", reason: "canonical_phase61_snapshot_not_frozen", inserted: 0 };
  }

  const inputEvidence = snapshot.inputSourceEvidence ?? {};
  const vector = snapshot.inputVector ?? [];
  const marketEvidence = snapshot.marketSnapshot ?? {};
  const common = {
    gameId,
    season: game.season,
    week: game.week,
    featureVersion: snapshot.featureVersion,
    kickoffTime: game.kickoffTime,
    cutoffAt,
    inputFingerprint: shadowFingerprint({
      gameId,
      cutoffAt,
      kickoffTime: game.kickoffTime,
      evidence: inputEvidence,
    }),
    featureVectorFingerprint: shadowFingerprint({
      names: snapshot.vectorFeatureNames,
      schema: snapshot.vectorSchemaFingerprint,
      vector,
    }),
    inputEvidence,
    marketFingerprint: shadowFingerprint(marketEvidence),
    marketEvidence,
    confidence: {
      qb: snapshot.qbConfidence,
      lowSample: snapshot.lowSample,
      source: "canonical_phase61_snapshot",
    },
    personnelAvailability: {
      status: "recorded_in_cutoff_input_evidence",
      lowSample: snapshot.lowSample,
    },
    weatherAvailability: {
      status: "unavailable",
      reason: "weather_not_in_phase61_feature_contract",
    },
  };

  const available = Array.isArray(snapshot.inputVector)
    && snapshot.inputVector.length > 0
    && snapshot.projectedMargin !== null
    && snapshot.projectedTotal !== null
    && snapshot.homeWinProbability !== null;
  const rows: Array<typeof shadowModelCutoffsTable.$inferInsert> = [{
    ...common,
    modelFamily: "phase61",
    predictionAt: snapshot.predictionTimestamp,
    modelVersion: [
      snapshot.spreadModelVersion,
      snapshot.moneylineModelVersion,
      snapshot.totalsModelVersion,
    ].filter(Boolean).join("|") || PHASE61_RELEASE_MODEL_VERSIONS.join("|"),
    modelArtifactId: [
      snapshot.spreadModelVersion,
      snapshot.moneylineModelVersion,
      snapshot.totalsModelVersion,
    ].filter(Boolean).join("|") || null,
    status: available ? "available" : "unavailable",
    unavailableReason: available ? null : "canonical_phase61_output_incomplete",
    featureVector: available ? vector : null,
    projectedMargin: available ? snapshot.projectedMargin : null,
    projectedTotal: available ? snapshot.projectedTotal : null,
    homeWinProbability: available ? snapshot.homeWinProbability : null,
  }];
  const advanced = await advancedForwardInference(gameId, snapshot.featureVersion, cutoffAt);
  rows.push(advanced.available ? {
    ...common,
    modelFamily: "advanced_football",
    predictionAt: inferenceAt,
    modelVersion: advanced.version,
    modelArtifactChecksum: advanced.fingerprint,
    status: "available",
    unavailableReason: null,
    featureVector: advanced.vector,
    inputEvidence: advanced.inputEvidence,
    inputFingerprint: advanced.inputFingerprint,
    featureVectorFingerprint: shadowFingerprint({ names: advanced.featureNames, vector: advanced.vector }),
    projectedMargin: advanced.projectedMargin,
    projectedTotal: advanced.projectedTotal,
    homeWinProbability: advanced.homeWinProbability,
    confidence: { status: "research_only", calibrated: false },
  } : {
    ...common,
    modelFamily: "advanced_football",
    predictionAt: inferenceAt,
    modelVersion: CHALLENGER_UNAVAILABLE.advanced_football.version,
    status: "unavailable",
    unavailableReason: advanced.reason,
    featureVector: null,
    projectedMargin: null,
    projectedTotal: null,
    homeWinProbability: null,
  });
  for (const family of ["market_residual", "ensemble"] as const) {
    const challenger = CHALLENGER_UNAVAILABLE[family];
    rows.push({
      ...common,
      modelFamily: family,
      predictionAt: inferenceAt,
      modelVersion: challenger.version,
      status: "unavailable",
      unavailableReason: challenger.reason,
      featureVector: null,
      projectedMargin: null,
      projectedTotal: null,
      homeWinProbability: null,
    });
  }

  const inserted = await db.insert(shadowModelCutoffsTable).values(rows)
    .onConflictDoNothing({
      target: [shadowModelCutoffsTable.gameId, shadowModelCutoffsTable.modelFamily],
    }).returning({ id: shadowModelCutoffsTable.id });
  return {
    status: "success",
    inserted: inserted.length,
    retained: rows.length - inserted.length,
    cutoffAt: cutoffAt.toISOString(),
    productionMutation: false,
    consumerPredictionWrites: 0,
  };
}

export function settle(value: number, line: number | null, side: "positive" | "negative") {
  if (line === null || !Number.isFinite(line)) return null;
  // Spread points in the canonical market snapshot are normalized to the
  // home-team line for both selections. The away result is therefore the
  // inverse of the home margin plus that shared line.
  const result = side === "positive" ? value + line : -value - line;
  return result > 0 ? "win" : result < 0 ? "loss" : "push";
}

export function selectedReturn(outcome: string | null, price: number | undefined) {
  if (!outcome || price === undefined) return null;
  const profit = americanOddsProfit(price);
  if (profit === null) return null;
  return outcome === "win" ? profit : outcome === "push" ? 0 : -1;
}

export async function gradeShadowModels(now = new Date()) {
  const rows = await db.select({
    shadow: shadowModelCutoffsTable,
    game: gamesTable,
  }).from(shadowModelCutoffsTable)
    .innerJoin(gamesTable, eq(gamesTable.gameId, shadowModelCutoffsTable.gameId))
    .orderBy(asc(shadowModelCutoffsTable.id));
  if (!rows.length) return { status: "success", graded: 0 };
  const existing = await db.select({ shadowCutoffId: shadowModelGradesTable.shadowCutoffId })
    .from(shadowModelGradesTable)
    .where(inArray(shadowModelGradesTable.shadowCutoffId, rows.map((row) => row.shadow.id)));
  const gradedIds = new Set(existing.map((row) => row.shadowCutoffId));
  let graded = 0;
  for (const { shadow, game } of rows) {
    if (gradedIds.has(shadow.id)
      || interpretNflGameState(game, now) !== "final"
      || game.finalHomeScore === null || game.finalAwayScore === null) continue;
    const actualMargin = game.finalHomeScore - game.finalAwayScore;
    const actualTotal = game.finalHomeScore + game.finalAwayScore;
    const [homeTeam] = await db.select().from(teamsTable).where(eq(teamsTable.teamId, game.homeTeamId)).limit(1);
    const quoteForSide = (market: "spread" | "moneyline" | "total", side: "home" | "away" | "over" | "under") => {
      const quotes = (marketPart(shadow.marketEvidence, market).quotes ?? []) as MarketQuote[];
      if (side === "over" || side === "under") {
        return quotes.find((quote) => quote.selection?.toLowerCase().includes(side)) ?? null;
      }
      const normalize = (value: string) => value.toLowerCase().replace(/[^a-z0-9]/g, "");
      const identities = [game.homeTeamId, homeTeam?.abbreviation, homeTeam?.teamName]
        .filter((value): value is string => Boolean(value)).map(normalize);
      const isHome = (quote: MarketQuote) => identities.some((identity) => {
        const selection = normalize(quote.selection ?? "");
        return identity.length > 2 && (selection.includes(identity) || identity.includes(selection));
      });
      return quotes.find((quote) => side === "home" ? isHome(quote) : !isHome(quote)) ?? null;
    };
    const spreadLine = bestQuote(shadow.marketEvidence, "spread")?.point ?? null;
    const totalLine = bestQuote(shadow.marketEvidence, "total")?.point ?? null;
    const spreadEdge = shadow.projectedMargin === null || typeof spreadLine !== "number"
      ? null : shadow.projectedMargin + spreadLine;
    const totalEdge = shadow.projectedTotal === null || typeof totalLine !== "number"
      ? null : shadow.projectedTotal - totalLine;
    const atsSide = spreadEdge === null ? null : spreadEdge >= 0 ? "home" : "away";
    const totalSide = totalEdge === null ? null : totalEdge >= 0 ? "over" : "under";
    const spread = atsSide ? quoteForSide("spread", atsSide) : null;
    const total = totalSide ? quoteForSide("total", totalSide) : null;
    const atsOutcome = atsSide === null ? null : settle(actualMargin, spreadLine, atsSide === "home" ? "positive" : "negative");
    const totalOutcome = totalSide === null || typeof total?.point !== "number"
      ? null
      : actualTotal === total.point ? "push"
        : (totalSide === "over" ? actualTotal > total.point : actualTotal < total.point) ? "win" : "loss";
    const moneylineSide = shadow.homeWinProbability === null ? null : shadow.homeWinProbability >= 0.5 ? "home" : "away";
    const moneyline = moneylineSide ? quoteForSide("moneyline", moneylineSide) : null;
    const moneylineOutcome = moneylineSide === null || actualMargin === 0 ? null
      : (moneylineSide === "home" ? actualMargin > 0 : actualMargin < 0) ? "win" : "loss";
    const homeWin = actualMargin > 0 ? 1 : actualMargin < 0 ? 0 : null;
    const p = shadow.homeWinProbability;
    const priceReturn = {
      status: spread?.price !== undefined && total?.price !== undefined && moneyline?.price !== undefined
        ? "qualified" : "partial_or_unavailable",
      spread: selectedReturn(atsOutcome, spread?.price),
      total: selectedReturn(totalOutcome, total?.price),
      moneyline: selectedReturn(moneylineOutcome, moneyline?.price),
      note: "Return is reported only from the selected side's frozen cutoff price; no CLV or closing-price claim.",
    };
    const inserted = await db.insert(shadowModelGradesTable).values({
      shadowCutoffId: shadow.id,
      actualHomeScore: game.finalHomeScore,
      actualAwayScore: game.finalAwayScore,
      actualMargin,
      actualTotal,
      homeWin,
      marginAbsoluteError: shadow.projectedMargin === null ? null : Math.abs(shadow.projectedMargin - actualMargin),
      totalAbsoluteError: shadow.projectedTotal === null ? null : Math.abs(shadow.projectedTotal - actualTotal),
      brierScore: p === null || homeWin === null ? null : (p - homeWin) ** 2,
      logLoss: p === null || homeWin === null ? null : -(homeWin * Math.log(Math.max(.001, Math.min(.999, p)))
        + (1 - homeWin) * Math.log(Math.max(.001, Math.min(.999, 1 - p)))),
      atsOutcome,
      totalOutcome,
      moneylineOutcome,
      marketDifference: { spread: spreadEdge, total: totalEdge, moneyline: null },
      priceReturn,
    }).onConflictDoNothing({ target: shadowModelGradesTable.shadowCutoffId })
      .returning({ id: shadowModelGradesTable.id });
    graded += inserted.length;
  }
  return { status: "success", graded };
}

function mean(values: Array<number | null>) {
  const available = values.filter((value): value is number => typeof value === "number");
  return available.length ? available.reduce((sum, value) => sum + value, 0) / available.length : null;
}

function record(values: Array<string | null>) {
  return {
    wins: values.filter((value) => value === "win").length,
    losses: values.filter((value) => value === "loss").length,
    pushes: values.filter((value) => value === "push").length,
  };
}

function summarizeWindow(rows: Awaited<ReturnType<typeof scoreboardRows>>, limit?: number) {
  const selected = limit ? rows.slice(-limit) : rows;
  const available = selected.filter((row) => row.shadow.status === "available");
  const graded = available.filter((row) => row.grade);
  const marketReturns = (market: "spread" | "total" | "moneyline") => graded.flatMap((row) => {
    const value = row.grade?.priceReturn as Record<string, unknown> | null;
    return typeof value?.[market] === "number" ? [value[market] as number] : [];
  });
  const returnSummary = (market: "spread" | "total" | "moneyline") => {
    const values = marketReturns(market);
    return values.length
      ? { samples: values.length, units: values.reduce((sum, value) => sum + value, 0), roi: mean(values) }
      : null;
  };
  const marginErrors = graded.map((row) => row.grade!.marginAbsoluteError);
  const totalErrors = graded.map((row) => row.grade!.totalAbsoluteError);
  const moneylineDecisions = graded.filter((row) =>
    row.grade!.homeWin !== null && row.shadow.homeWinProbability !== null);
  return {
    captured: selected.length,
    available: available.length,
    unavailable: selected.length - available.length,
    graded: graded.length,
    minimumSample: SHADOW_MINIMUM_SAMPLE,
    sampleStatus: graded.length >= SHADOW_MINIMUM_SAMPLE ? "measured" : "insufficient_sample",
    sampleMessage: graded.length >= SHADOW_MINIMUM_SAMPLE
      ? "Minimum sample reached; metrics are descriptive and do not promote a model."
      : `${SHADOW_MINIMUM_SAMPLE - graded.length} more graded games are required before comparison.`,
    metrics: {
      marginMae: mean(graded.map((row) => row.grade!.marginAbsoluteError)),
      totalMae: mean(graded.map((row) => row.grade!.totalAbsoluteError)),
      marginRmse: mean(marginErrors.map((value) => value === null ? null : value ** 2)) === null
        ? null
        : Math.sqrt(mean(marginErrors.map((value) => value === null ? null : value ** 2))!),
      totalRmse: mean(totalErrors.map((value) => value === null ? null : value ** 2)) === null
        ? null
        : Math.sqrt(mean(totalErrors.map((value) => value === null ? null : value ** 2))!),
      brierScore: mean(graded.map((row) => row.grade!.brierScore)),
      logLoss: mean(graded.map((row) => row.grade!.logLoss)),
      moneylineAccuracy: moneylineDecisions.length
        ? moneylineDecisions.filter((row) =>
          (row.shadow.homeWinProbability! >= .5 ? 1 : 0) === row.grade!.homeWin).length / moneylineDecisions.length
        : null,
      averageMarketDifference: {
        spread: mean(graded.map((row) => (row.grade!.marketDifference as Record<string, number | null>).spread ?? null)),
        total: mean(graded.map((row) => (row.grade!.marketDifference as Record<string, number | null>).total ?? null)),
      },
      ats: record(graded.map((row) => row.grade!.atsOutcome)),
      overUnder: record(graded.map((row) => row.grade!.totalOutcome)),
      moneyline: record(graded.map((row) => row.grade!.moneylineOutcome)),
      qualifiedReturn: {
        spread: returnSummary("spread"),
        total: returnSummary("total"),
        moneyline: returnSummary("moneyline"),
      },
      calibration: Array.from({ length: 10 }, (_, index) => {
        const bucket = graded.filter((row) => row.shadow.homeWinProbability !== null
          && row.shadow.homeWinProbability >= index / 10
          && row.shadow.homeWinProbability < (index + 1) / 10);
        return {
          bucket: `${index * 10}-${index === 9 ? 100 : (index + 1) * 10 - 1}%`,
          predictions: bucket.length,
          predicted: mean(bucket.map((row) => row.shadow.homeWinProbability)),
          actual: mean(bucket.map((row) => row.grade!.homeWin)),
        };
      }),
    },
  };
}

async function scoreboardRows(season: number, family: ShadowModelFamily) {
  return db.select({ shadow: shadowModelCutoffsTable, grade: shadowModelGradesTable })
    .from(shadowModelCutoffsTable)
    .leftJoin(shadowModelGradesTable, eq(shadowModelGradesTable.shadowCutoffId, shadowModelCutoffsTable.id))
    .where(and(
      eq(shadowModelCutoffsTable.season, season),
      eq(shadowModelCutoffsTable.modelFamily, family),
    ))
    .orderBy(asc(shadowModelCutoffsTable.kickoffTime), asc(shadowModelCutoffsTable.gameId));
}

export async function getShadowResearchScoreboard(season?: number) {
  const { ensureRetainedBaselineManifest } = await import("./shadow-baseline-manifest");
  await ensureRetainedBaselineManifest();
  const selectedSeason = season ?? new Date().getUTCFullYear();
  const families = await Promise.all(SHADOW_MODEL_FAMILIES.map(async (family) => {
    const rows = await scoreboardRows(selectedSeason, family);
    const latest = rows.at(-1)?.shadow;
    return {
      family,
      modelVersion: latest?.modelVersion ?? (family === "phase61"
        ? PHASE61_RELEASE_MODEL_VERSIONS.join("|")
        : CHALLENGER_UNAVAILABLE[family as keyof typeof CHALLENGER_UNAVAILABLE]?.version),
      featureVersion: latest?.featureVersion ?? null,
      provenance: latest ? {
        artifactId: latest.modelArtifactId,
        artifactChecksum: latest.modelArtifactChecksum,
        inputFingerprint: latest.inputFingerprint,
        marketFingerprint: latest.marketFingerprint,
      } : null,
      windows: {
        season: summarizeWindow(rows),
        last20: summarizeWindow(rows, 20),
        last50: summarizeWindow(rows, 50),
      },
    };
  }));
  const [manifest] = await db.select().from(evaluationBaselineManifestsTable)
    .orderBy(desc(evaluationBaselineManifestsTable.createdAt)).limit(1);
  return {
    contract: SHADOW_MODEL_CONTRACT,
    season: selectedSeason,
    generatedAt: new Date().toISOString(),
    families,
    baselineManifest: manifest ?? null,
    productionBehavior: "unchanged",
    promotionStateChanged: false,
  };
}

export async function getShadowOperationalStatus() {
  const { ensureRetainedBaselineManifest } = await import("./shadow-baseline-manifest");
  const manifest = await ensureRetainedBaselineManifest();
  const upcoming = await db.select().from(gamesTable)
    .where(and(eq(gamesTable.season, new Date().getUTCFullYear())))
    .orderBy(asc(gamesTable.kickoffTime));
  const next = upcoming.find((game) => game.kickoffTime && game.kickoffTime > new Date()) ?? null;
  const captured = next
    ? await db.select().from(shadowModelCutoffsTable).where(eq(shadowModelCutoffsTable.gameId, next.gameId))
    : [];
  return {
    contractVersion: SHADOW_CONTRACT_VERSION,
    nextEligibleSlate: next ? {
      gameId: next.gameId,
      kickoffTime: next.kickoffTime?.toISOString() ?? null,
      cutoffAt: next.kickoffTime ? new Date(next.kickoffTime.getTime() - 30 * 60_000).toISOString() : null,
      cutoffReadiness: captured.length === SHADOW_MODEL_FAMILIES.length
        ? "captured"
        : next.kickoffTime && new Date() < new Date(next.kickoffTime.getTime() - 30 * 60_000)
          ? "scheduled"
          : "capture_pending_retry",
      capturedFamilies: captured.map((row) => ({ family: row.modelFamily, version: row.modelVersion, status: row.status, reason: row.unavailableReason })),
    } : null,
    phase61Versions: PHASE61_RELEASE_MODEL_VERSIONS,
    challengerAvailability: {
      advanced_football: RETAINED_ADVANCED_MODELS.length === 3
        ? { status: "artifact_ready", version: RETAINED_ADVANCED_VERSION, reason: null }
        : { status: "unavailable", version: RETAINED_ADVANCED_VERSION, reason: "retained_advanced_artifacts_incomplete" },
      market_residual: { status: "unavailable", ...CHALLENGER_UNAVAILABLE.market_residual },
      ensemble: { status: "unavailable", ...CHALLENGER_UNAVAILABLE.ensemble },
    },
    baselineManifest: {
      version: manifest?.manifestVersion ?? null,
      status: manifest?.reproducibilityStatus ?? "unavailable",
      checksum: manifest?.manifestChecksum ?? null,
      limitation: manifest?.limitation ?? null,
      diagnosis: manifest?.diagnosis ?? null,
    },
    productionBehavior: "unchanged",
    consumerChallengerOutputs: false,
  };
}