import { createHash } from "node:crypto";

export const CONFIDENCE_VERSION = "confidence-v1";
export const CONFIDENCE_WEIGHTS = { data: 0.35, model: 0.35, market: 0.30 } as const;
export const CONFIDENCE_THRESHOLDS = { moderate: 50, strong: 70, veryStrong: 85 } as const;
export const CONFIDENCE_HISTORICAL_EVIDENCE = {
  status: "recorded_evidence_only",
  source: "nflverse/nfldata games.csv",
  designation: "source_designated_recorded",
  limitation: "No sportsbook or observation timestamps; not a verified close, CLV, profitability result, or universal threshold.",
} as const;
export const CONFIDENCE_NORMALIZATION = {
  data: "minimum of quarterback evidence and feature completeness; low-sample inputs are capped at 49 and cannot pass the acceptable-data gate",
  model: "equal blend of immutable projection-revision stability and retained family error context; unavailable evidence remains null",
  market: "70% absolute model-market difference (0 at zero, 100 at 7 points or percentage points), 10% freshness, 10% two-book coverage, and 10% DraftKings/FanDuel agreement",
} as const;

export type ConfidenceMarket = "spread" | "moneyline" | "total";
export type ConfidenceLabel = "Low" | "Moderate" | "Strong" | "Very Strong";
export type ConfidenceInput = {
  market: ConfidenceMarket;
  dataScore: number | null;
  modelScore: number | null;
  marketDifference: number | null;
  marketFresh: boolean;
  bookCount: number;
  booksAgree: boolean;
  snapshotValid: boolean;
  artifactVerified: boolean;
  startersResolved: boolean;
  dataAcceptable: boolean;
  calculatedAt?: Date;
  historical?: Record<string, unknown>;
};

export type ConfidenceResult = {
  market: ConfidenceMarket;
  score: number;
  label: ConfidenceLabel;
  explanation: string;
  components: Array<{ key: "data" | "model" | "marketEdge"; label: string; score: number | null; summary: string }>;
  evidence: {
    marketDifference: number | null;
    marketFresh: boolean;
    bookCount: number;
    booksAgree: boolean;
    agreementTolerance: string;
    historical: Record<string, unknown>;
    gates: {
      snapshotValid: boolean;
      artifactVerified: boolean;
      startersResolved: boolean;
      dataAcceptable: boolean;
    };
  };
  downgradeReasons: string[];
  calculatedAt: string;
};

const clamp = (value: number) => Math.max(0, Math.min(100, value));
export const normalizeDataConfidence = (value: number | null) => value === null || !Number.isFinite(value) ? null : clamp(value);
export const normalizeModelConfidence = (errorPoints: number | null) =>
  errorPoints === null || !Number.isFinite(errorPoints) ? null : clamp(((20 - Math.abs(errorPoints)) / 18) * 100);
export const normalizeMarketEdge = (difference: number | null) =>
  difference === null || !Number.isFinite(difference) ? null : clamp((Math.abs(difference) / 7) * 100);

export function snapshotDataConfidence(input: {
  qbConfidence: number | null;
  lowSample: boolean;
  inputFeatureCount: number;
  inputMissingFeatureCount: number;
}) {
  const qb = input.qbConfidence === null || !Number.isFinite(input.qbConfidence)
    ? null
    : clamp(input.qbConfidence * 100);
  const completeness = input.inputFeatureCount > 0
    ? clamp((input.inputFeatureCount - input.inputMissingFeatureCount) / input.inputFeatureCount * 100)
    : null;
  const score = qb === null || completeness === null
    ? null
    : Math.min(qb, completeness, input.lowSample ? 49 : 100);
  return {
    score,
    acceptable: score !== null
      && score >= 60
      && !input.lowSample
      && input.inputMissingFeatureCount === 0
      && (input.qbConfidence ?? 0) >= 0.75,
  };
}

export type ConfidenceQuote = {
  sportsbook: string;
  point: number | null;
  price: number;
  capturedAt?: string;
};

export function freshConfidenceQuotes(
  quotes: ConfidenceQuote[],
  calculatedAt: Date,
  staleAfterMinutes = 30,
) {
  const cutoff = staleAfterMinutes * 60_000;
  return quotes.filter((quote) => {
    if (!quote.capturedAt) return false;
    const capturedAt = Date.parse(quote.capturedAt);
    const age = calculatedAt.getTime() - capturedAt;
    return Number.isFinite(capturedAt) && age >= 0 && age <= cutoff;
  });
}

function impliedProbability(price: number) {
  if (!Number.isInteger(price) || (price > -100 && price < 100)) return null;
  return price < 0 ? Math.abs(price) / (Math.abs(price) + 100) : 100 / (price + 100);
}

export function supportedBooksAgree(market: ConfidenceMarket, quotes: ConfidenceQuote[]) {
  const draftKings = quotes.find((quote) => quote.sportsbook === "DraftKings");
  const fanDuel = quotes.find((quote) => quote.sportsbook === "FanDuel");
  if (!draftKings || !fanDuel) return false;
  if (market === "moneyline") {
    const left = impliedProbability(draftKings.price);
    const right = impliedProbability(fanDuel.price);
    return left !== null && right !== null && Math.abs(left - right) <= 0.03;
  }
  return draftKings.point !== null
    && fanDuel.point !== null
    && Math.abs(draftKings.point - fanDuel.point) <= 0.5
    && Math.abs(draftKings.price - fanDuel.price) <= 10;
}

export function startersResolvedFromEvidence(value: Record<string, unknown> | null | undefined) {
  const rows = (value as { rows?: unknown[] } | null | undefined)?.rows;
  if (!Array.isArray(rows) || rows.length !== 2) return false;
  return rows.every((row) => {
    if (!row || typeof row !== "object") return false;
    const evidence = row as Record<string, unknown>;
    return typeof evidence.qbDataConfidence === "number"
      && Number.isFinite(evidence.qbDataConfidence)
      && evidence.qbDataConfidence >= 0.75;
  });
}

export function projectionRevisionStability(
  market: ConfidenceMarket,
  revisions: Array<{ projectedMargin: number | null; projectedTotal: number | null; homeWinProbability: number | null }>,
) {
  const values = revisions.map((row) =>
    market === "spread" ? row.projectedMargin
      : market === "total" ? row.projectedTotal
        : row.homeWinProbability === null ? null : row.homeWinProbability * 100)
    .filter((value): value is number => typeof value === "number" && Number.isFinite(value));
  if (values.length < 2) return null;
  const mean = values.reduce((sum, value) => sum + value, 0) / values.length;
  const deviation = Math.sqrt(values.reduce((sum, value) => sum + (value - mean) ** 2, 0) / values.length);
  return clamp(100 - deviation / 7 * 100);
}

export function cutoffSafeRevisions<T extends { predictionTimestamp: Date }>(
  revisions: T[],
  selectedPredictionTimestamp: Date | null | undefined,
  kickoffTime: Date | null | undefined,
) {
  if (!selectedPredictionTimestamp) return [];
  const selectedCutoff = selectedPredictionTimestamp.getTime();
  const kickoffCutoff = kickoffTime?.getTime() ?? Number.POSITIVE_INFINITY;
  return revisions.filter((row) =>
    row.predictionTimestamp.getTime() <= selectedCutoff
    && row.predictionTimestamp.getTime() < kickoffCutoff);
}

function label(score: number): ConfidenceLabel {
  if (score >= CONFIDENCE_THRESHOLDS.veryStrong) return "Very Strong";
  if (score >= CONFIDENCE_THRESHOLDS.strong) return "Strong";
  if (score >= CONFIDENCE_THRESHOLDS.moderate) return "Moderate";
  return "Low";
}

export function calculateConfidence(input: ConfidenceInput): ConfidenceResult {
  const data = normalizeDataConfidence(input.dataScore);
  const model = input.modelScore === null ? null : clamp(input.modelScore);
  const edge = normalizeMarketEdge(input.marketDifference);
  const market = edge === null ? null : clamp(
    edge * 0.70
    + (input.marketFresh ? 10 : 0)
    + (input.bookCount >= 2 ? 10 : 0)
    + (input.booksAgree ? 10 : 0),
  );
  const reasons: string[] = [];
  if (!input.snapshotValid) reasons.push("Prediction snapshot is missing or invalid");
  if (!input.artifactVerified) reasons.push("Model artifact verification is unavailable");
  if (!input.startersResolved) reasons.push("Projected starters are unresolved");
  if (!input.dataAcceptable || data === null || data < 60) reasons.push("Data Confidence is below the acceptable threshold");
  if (!input.marketFresh) reasons.push("Current sportsbook evidence is stale or unavailable");
  if (input.bookCount < 2) reasons.push("Fewer than two supported sportsbook books are available");
  if (!input.booksAgree) reasons.push("DraftKings and FanDuel do not agree");
  const weighted = [data, model, market].every((value) => value !== null)
    ? data! * CONFIDENCE_WEIGHTS.data + model! * CONFIDENCE_WEIGHTS.model + market! * CONFIDENCE_WEIGHTS.market
    : 0;
  const criticalGateFailed = !input.snapshotValid || !input.artifactVerified || !input.startersResolved
    || !input.dataAcceptable || data === null || model === null || market === null;
  const score = Math.round(clamp(
    criticalGateFailed ? Math.min(weighted, 49)
      : reasons.length ? Math.min(weighted, 69)
        : weighted,
  ));
  const finalLabel = label(score);
  const calculatedAt = (input.calculatedAt ?? new Date()).toISOString();
  return {
    market: input.market,
    score,
    label: finalLabel,
    explanation: reasons.length ? `${finalLabel} confidence; ${reasons.join("; ")}.` : `${finalLabel} confidence from data quality, model evidence, and current market agreement.`,
    components: [
      { key: "data", label: "Data Confidence", score: data, summary: data === null ? "Unavailable" : `${Math.round(data)}/100 input quality` },
      { key: "model", label: "Model Confidence", score: model, summary: model === null ? "Unavailable" : `${Math.round(model)}/100 stability/error evidence` },
      { key: "marketEdge", label: "Market Edge Strength", score: market, summary: market === null ? "Unavailable" : `${Math.round(market)}/100 difference, freshness, and consensus` },
    ],
    evidence: {
      marketDifference: input.marketDifference,
      marketFresh: input.marketFresh,
      bookCount: input.bookCount,
      booksAgree: input.booksAgree,
      agreementTolerance: input.market === "moneyline" ? "implied probability within 3 percentage points" : "point within 0.5 and American price within 10",
      historical: input.historical ?? { status: "insufficient", reason: "No retained evidence supplied" },
      gates: {
        snapshotValid: input.snapshotValid,
        artifactVerified: input.artifactVerified,
        startersResolved: input.startersResolved,
        dataAcceptable: input.dataAcceptable,
      },
    },
    downgradeReasons: reasons,
    calculatedAt,
  };
}

export function methodologyChecksum() {
  return createHash("sha256").update(JSON.stringify({
    version: CONFIDENCE_VERSION, weights: CONFIDENCE_WEIGHTS, thresholds: CONFIDENCE_THRESHOLDS, normalization: CONFIDENCE_NORMALIZATION,
    historicalEvidence: CONFIDENCE_HISTORICAL_EVIDENCE,
  })).digest("hex");
}

export function confidenceTierDistribution(results: Array<{ label: ConfidenceLabel }>) {
  return Object.fromEntries((["Low", "Moderate", "Strong", "Very Strong"] as const).map((tier) => [
    tier, results.filter((result) => result.label === tier).length,
  ]));
}

export function confidenceHistoricalTierReport() {
  return {
    status: "insufficient" as const,
    source: "nflverse/nfldata games.csv",
    designation: "source_designated_recorded",
    markets: {
      spread: { status: "insufficient", sampleSize: 0, confidenceInterval95: { low: null, high: null }, buckets: [] },
      moneyline: { status: "insufficient", sampleSize: 0, confidenceInterval95: { low: null, high: null }, buckets: [] },
      total: { status: "insufficient", sampleSize: 0, confidenceInterval95: { low: null, high: null }, buckets: [] },
    },
    limitation: "The retained source does not provide per-game out-of-sample confidence results or timestamped closing lines. Recorded lines are not closes, CLV, profitability, or universal thresholds.",
  };
}

export function buildConsumerConfidence(input: {
  snapshot?: {
    snapshotKey?: string;
    predictionTimestamp?: Date;
    qbConfidence?: number | null;
    inputFeatureCount?: number;
    inputMissingFeatureCount?: number;
    lowSample?: boolean;
    spreadModelVersion?: string | null;
    moneylineModelVersion?: string | null;
    totalsModelVersion?: string | null;
    verifiedArtifacts?: Partial<Record<ConfidenceMarket, boolean>>;
  };
  dataConfidence: { score: number | null };
  dataAcceptable?: boolean;
  comparisons: Array<{ market: ConfidenceMarket; difference: number | null; state: "available" | "stale" | "absent"; currentQuotes?: ConfidenceQuote[] }>;
  calculatedAt?: Date;
  historical?: Partial<Record<ConfidenceMarket, Record<string, unknown>>>;
  modelScores?: Partial<Record<ConfidenceMarket, number | null>>;
  startersResolved?: boolean;
}) {
  const snapshot = input.snapshot;
  const snapshotValid = Boolean(snapshot?.snapshotKey && snapshot?.predictionTimestamp);
  const calculatedAt = input.calculatedAt ?? new Date();
  return {
    markets: (["spread", "moneyline", "total"] as const).map((market) => {
      const comparison = input.comparisons.find((item) => item.market === market);
      const books = freshConfidenceQuotes(comparison?.currentQuotes ?? [], calculatedAt);
      return calculateConfidence({
        market,
        dataScore: input.dataConfidence.score,
        modelScore: input.modelScores?.[market] ?? null,
        marketDifference: comparison?.difference ?? null,
        marketFresh: comparison?.state === "available" && books.length > 0,
        bookCount: books.length,
        booksAgree: supportedBooksAgree(market, books),
        snapshotValid,
        artifactVerified: Boolean(snapshot?.verifiedArtifacts?.[market]),
        startersResolved: input.startersResolved ?? false,
        dataAcceptable: input.dataAcceptable ?? (input.dataConfidence.score ?? 0) >= 60,
        calculatedAt,
        historical: input.historical?.[market],
      });
    }),
  };
}