import { createHash } from "node:crypto";

export const MARKET_BASELINE_SOURCE = "nflverse/nfldata";
export const MARKET_BASELINE_SOURCE_URL = "https://github.com/nflverse/nfldata";
export const MARKET_BASELINE_SOURCE_FILES = ["games.csv"] as const;
export const MARKET_BASELINE_SEASON = 2025;
export const MARKET_BASELINE_EXPECTED_2025_EVENTS = 285;
export const MARKET_BASELINE_EXPECTED_2025_WEEKS = Array.from({ length: 22 }, (_, index) => index + 1);
export const MARKET_BASELINE_GAMES_DOCUMENTATION_SHA256 = "5aacebf50250ac29a1de79d71fa7e258e621da8d16f1692b38d926775ad4939c";
export const MARKET_BASELINE_PROVENANCE_DOCUMENTATION_SHA256 = "42035b4ee0e548389ef91509bc672a861b43c6226a7317507d41536816c9f88a";

export const MARKET_BASELINE_REQUIRED_COLUMNS = [
  "game_id", "season", "game_type", "week", "gameday", "gametime",
  "away_team", "away_score", "home_team", "home_score", "location",
  "away_moneyline", "home_moneyline", "spread_line", "away_spread_odds",
  "home_spread_odds", "total_line", "under_odds", "over_odds",
] as const;

export type MarketSourceDesignation = "source_designated_recorded";
export type MarketFamily = "spread" | "moneyline" | "totals";
export type MarketSide = "home" | "away" | "over" | "under";
export type MarketMatchOutcome = "matched" | "unmatched" | "ambiguous" | "duplicate" | "alias" | "neutral_site";

export type HistoricalMarketQuote = {
  source: typeof MARKET_BASELINE_SOURCE;
  sourceFile: (typeof MARKET_BASELINE_SOURCE_FILES)[number];
  sourceGameId: string;
  altGameId: string;
  season: number;
  week: number;
  awayTeam: string;
  homeTeam: string;
  kickoffTime: Date | null;
  neutralSite: boolean;
  family: MarketFamily;
  side: MarketSide;
  point: number | null;
  price: number | null;
  sourceDesignation: MarketSourceDesignation;
  sportsbook: string | null;
  observedAt: Date | null;
  sourceTimestamp: Date | null;
  sourceOutcome: number | null;
};

export type BaselineGame = {
  gameId: string;
  season: number;
  week: number;
  kickoffTime: Date | null;
  homeAbbreviation: string;
  awayAbbreviation: string;
  homeTeamName?: string;
  awayTeamName?: string;
  neutralSite?: boolean;
};

export type MarketMatchDiagnostic = {
  sourceGameId: string;
  altGameId: string;
  outcome: MarketMatchOutcome;
  matchedGameId: string | null;
  candidateGameIds: string[];
  aliasUsed: boolean;
  reason: string;
};

export type Settlement = "win" | "loss" | "push" | "no_bet";

export function applyMinimumEdgeSettlement(
  settlement: Settlement,
  edge: number,
  minimumAbsoluteEdge: number,
): Settlement {
  return Math.abs(edge) < minimumAbsoluteEdge ? "no_bet" : settlement;
}

export function canonicalizeBaselineRows<T extends {
  gameId: string;
  kickoffTime: Date;
  homeTeamId: string | null;
  awayTeamId: string | null;
}>(rows: T[]): T[] {
  return [...rows].sort((left, right) =>
    left.gameId.localeCompare(right.gameId)
    || left.kickoffTime.getTime() - right.kickoffTime.getTime()
    || (left.homeTeamId ?? "").localeCompare(right.homeTeamId ?? "")
    || (left.awayTeamId ?? "").localeCompare(right.awayTeamId ?? ""));
}

export function assert2025BaselineIsolation(input: {
  featureVersion: string;
  vectorFeatureNames: string[];
  trainingSeasons: number[];
  testSeason: number;
  chronology: Array<{ featureCutoff: Date; predictionCutoff: Date; kickoffTime: Date }>;
}) {
  if (input.featureVersion !== "pregame-v3") throw new Error("The market baseline requires pregame-v3");
  if (input.testSeason !== MARKET_BASELINE_SEASON || input.trainingSeasons.some((season) => season >= MARKET_BASELINE_SEASON)) {
    throw new Error("The market baseline requires through-2024 training and 2025-only evaluation");
  }
  const forbidden = /(market|odds|sportsbook|closing|sleeper|personnel|depth|injury|trade|starter)/i;
  if (input.vectorFeatureNames.some((name) => forbidden.test(name))) {
    throw new Error("Market or current-day personnel evidence cannot enter baseline model inputs");
  }
  if (input.chronology.some((row) =>
    !(row.featureCutoff < row.predictionCutoff) || row.predictionCutoff > row.kickoffTime)) {
    throw new Error("Baseline chronology is not strictly pregame");
  }
}

export function hasDuplicateMarketSelections(quotes: HistoricalMarketQuote[]) {
  const keys = quotes.map((quote) => `${quote.family}:${quote.side}`);
  return new Set(keys).size !== keys.length;
}

const aliases: Record<string, string> = {
  ari: "ARI", atl: "ATL", bal: "BAL", buf: "BUF", car: "CAR", chi: "CHI",
  cin: "CIN", cle: "CLE", dal: "DAL", den: "DEN", det: "DET", gb: "GB",
  hou: "HOU", ind: "IND", jac: "JAX", jax: "JAX", kc: "KC", kan: "KC",
  la: "LAR", lac: "LAC", lar: "LAR", lv: "LV", mia: "MIA", min: "MIN", ne: "NE",
  no: "NO", nyg: "NYG", nyj: "NYJ", oak: "LV", phi: "PHI", pit: "PIT",
  sd: "LAC", sea: "SEA", sf: "SF", sfo: "SF", stl: "LAR", tb: "TB",
  ten: "TEN", was: "WAS", wsh: "WAS",
};
const canonicalAbbreviations = new Set([
  "ARI", "ATL", "BAL", "BUF", "CAR", "CHI", "CIN", "CLE", "DAL", "DEN", "DET",
  "GB", "HOU", "IND", "JAX", "KC", "LAC", "LAR", "LV", "MIA", "MIN", "NE",
  "NO", "NYG", "NYJ", "PHI", "PIT", "SEA", "SF", "TB", "TEN", "WAS",
]);

function normalizeTeam(value: string): { value: string; aliasUsed: boolean } {
  const compact = value.trim().toLowerCase().replace(/[^a-z0-9]/g, "");
  const alias = aliases[compact];
  if (alias) return { value: alias, aliasUsed: !canonicalAbbreviations.has(value.trim().toUpperCase()) };
  return { value: compact.toUpperCase(), aliasUsed: false };
}

function parseNumber(value: string): number | null {
  if (!value.trim()) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function csvRows(input: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  for (let index = 0; index < input.length; index += 1) {
    const char = input[index];
    const next = input[index + 1];
    if (char === '"' && quoted && next === '"') { field += '"'; index += 1; continue; }
    if (char === '"') { quoted = !quoted; continue; }
    if (char === "," && !quoted) { row.push(field); field = ""; continue; }
    if ((char === "\n" || char === "\r") && !quoted) {
      if (char === "\r" && next === "\n") index += 1;
      row.push(field); field = "";
      if (row.some((item) => item.length > 0)) rows.push(row);
      row = [];
      continue;
    }
    field += char;
  }
  row.push(field);
  if (row.some((item) => item.length > 0)) rows.push(row);
  return rows;
}

function normalizedDocumentation(input: string): string {
  return `${input.replace(/\r\n/g, "\n").trim()}\n`;
}

function gamesDocumentationSection(input: string): string | null {
  const normalized = input.replace(/\r\n/g, "\n");
  return normalized.match(/## Games\n[\s\S]*?(?=\n<a name="colors"\/?>)/)?.[0] ?? null;
}

function reviewRequired(reasons: string[]): never {
  throw new Error(`Market source contract changed; review required before audit rerun: ${reasons.join("; ")}`);
}

/**
 * Qualify the live source before an audit is allowed to load models or write
 * append-only results. Documentation hashes intentionally fail on any edit:
 * changes must be reviewed to ensure recorded lines are not relabeled as
 * closing evidence and that timestamp, sportsbook, and provenance claims still
 * match the source.
 */
type MarketSourceQualificationInput = {
  csv: string;
  datasetsDocumentation: string;
  provenanceDocumentation: string;
};

type MarketSourceContract = {
  expected2025Events: number;
  expected2025Weeks: number[];
  gamesDocumentationSha256: string;
  provenanceDocumentationSha256: string;
};

export function qualify2025MarketSourceAgainstContract(
  input: MarketSourceQualificationInput,
  contract: MarketSourceContract,
) {
  const reasons: string[] = [];
  const rows = csvRows(input.csv);
  const header = rows.shift()?.map((item) => item.trim().toLowerCase()) ?? [];
  const missingColumns = MARKET_BASELINE_REQUIRED_COLUMNS.filter((name) => !header.includes(name));
  if (missingColumns.length) reasons.push(`games.csv is missing required columns: ${missingColumns.join(", ")}`);

  const seasonIndex = header.indexOf("season");
  const weekIndex = header.indexOf("week");
  const seasonRows = seasonIndex < 0 ? [] : rows.filter((row) => parseNumber(row[seasonIndex] ?? "") === MARKET_BASELINE_SEASON);
  const weeks = weekIndex < 0
    ? []
    : [...new Set(seasonRows.map((row) => parseNumber(row[weekIndex] ?? "")).filter((week): week is number => week !== null))].sort((a, b) => a - b);
  if (seasonRows.length !== contract.expected2025Events) {
    reasons.push(`2025 coverage is ${seasonRows.length} events; expected ${contract.expected2025Events}`);
  }
  if (weeks.join(",") !== contract.expected2025Weeks.join(",")) {
    reasons.push(`2025 week coverage is [${weeks.join(",")}]; expected [${contract.expected2025Weeks.join(",")}]`);
  }

  const gamesSection = gamesDocumentationSection(input.datasetsDocumentation);
  const gamesDocumentationFingerprint = gamesSection ? sourceFingerprint(normalizedDocumentation(gamesSection)) : null;
  if (gamesDocumentationFingerprint !== contract.gamesDocumentationSha256) {
    reasons.push("DATASETS.md Games documentation changed (line designation, timing, or source-field semantics require review)");
  }
  const provenanceDocumentationFingerprint = sourceFingerprint(normalizedDocumentation(input.provenanceDocumentation));
  if (provenanceDocumentationFingerprint !== contract.provenanceDocumentationSha256) {
    reasons.push("README.md provenance or licensing context changed and requires review");
  }
  if (reasons.length) reviewRequired(reasons);

  return {
    season: MARKET_BASELINE_SEASON,
    eventCount: seasonRows.length,
    weeks,
    requiredColumns: [...MARKET_BASELINE_REQUIRED_COLUMNS],
    gamesDocumentationFingerprint,
    provenanceDocumentationFingerprint,
    designation: "source_designated_recorded" as const,
    sportsbook: null,
    observationTimestamp: null,
  };
}

export function qualify2025MarketSource(input: MarketSourceQualificationInput) {
  return qualify2025MarketSourceAgainstContract(input, {
    expected2025Events: MARKET_BASELINE_EXPECTED_2025_EVENTS,
    expected2025Weeks: MARKET_BASELINE_EXPECTED_2025_WEEKS,
    gamesDocumentationSha256: MARKET_BASELINE_GAMES_DOCUMENTATION_SHA256,
    provenanceDocumentationSha256: MARKET_BASELINE_PROVENANCE_DOCUMENTATION_SHA256,
  });
}

/**
 * Parse Lee Sharpe's games.csv rows without adding provenance the source does
 * not provide. DATASETS.md describes spread_line and total_line as lines, but
 * does not designate them as closing. The source has no sportsbook or
 * observation timestamp, so all quotes remain recorded-only.
 */
export function parseNflDataMarketCsv(input: string, sourceFile: "games.csv" = "games.csv"): HistoricalMarketQuote[] {
  const rows = csvRows(input);
  const header = rows.shift()?.map((item) => item.trim().toLowerCase()) ?? [];
  const column = (name: string) => header.indexOf(name);
  const designation: MarketSourceDesignation = "source_designated_recorded";
  return rows.flatMap((row) => {
    const season = parseNumber(row[column("season")] ?? "");
    if (season !== MARKET_BASELINE_SEASON || !row[column("game_id")]) return [];
    const gameId = row[column("game_id")]!;
    const awayTeam = row[column("away_team")] ?? "";
    const homeTeam = row[column("home_team")] ?? "";
    const kickoffTime = row[column("gameday")] && row[column("gametime")]
      ? new Date(`${row[column("gameday")]}T${row[column("gametime")]}Z`) : null;
    const week = parseNumber(row[column("week")] ?? "") ?? 0;
    const base = {
      source: MARKET_BASELINE_SOURCE,
      sourceFile,
      sourceGameId: gameId,
      altGameId: gameId,
      season,
      week,
      awayTeam,
      homeTeam,
      kickoffTime: Number.isFinite(kickoffTime?.getTime()) ? kickoffTime : null,
      neutralSite: (row[column("location")] ?? "").trim().toLowerCase() === "neutral",
      sourceDesignation: designation,
      sportsbook: null,
      observedAt: null,
      sourceTimestamp: null,
    } satisfies Partial<HistoricalMarketQuote>;
    const quotes: HistoricalMarketQuote[] = [];
    const awayMoneyline = parseNumber(row[column("away_moneyline")] ?? "");
    const homeMoneyline = parseNumber(row[column("home_moneyline")] ?? "");
    if (awayMoneyline !== null) quotes.push({ ...base, family: "moneyline", side: "away", point: null, price: awayMoneyline, sourceOutcome: null });
    if (homeMoneyline !== null) quotes.push({ ...base, family: "moneyline", side: "home", point: null, price: homeMoneyline, sourceOutcome: null });
    const spread = parseNumber(row[column("spread_line")] ?? "");
    const awaySpreadPrice = parseNumber(row[column("away_spread_odds")] ?? "");
    const homeSpreadPrice = parseNumber(row[column("home_spread_odds")] ?? "");
    if (spread !== null) {
      quotes.push({ ...base, family: "spread", side: "away", point: spread, price: awaySpreadPrice, sourceOutcome: null });
      quotes.push({ ...base, family: "spread", side: "home", point: -spread, price: homeSpreadPrice, sourceOutcome: null });
    }
    const total = parseNumber(row[column("total_line")] ?? "");
    const underPrice = parseNumber(row[column("under_odds")] ?? "");
    const overPrice = parseNumber(row[column("over_odds")] ?? "");
    if (total !== null) {
      quotes.push({ ...base, family: "totals", side: "under", point: total, price: underPrice, sourceOutcome: null });
      quotes.push({ ...base, family: "totals", side: "over", point: total, price: overPrice, sourceOutcome: null });
    }
    return quotes;
  });
}

export function sourceFingerprint(input: string): string {
  return createHash("sha256").update(input).digest("hex");
}

export function matchHistoricalMarketGame(
  quote: Pick<HistoricalMarketQuote, "altGameId" | "sourceGameId" | "season" | "week" | "awayTeam" | "homeTeam" | "kickoffTime" | "neutralSite">,
  games: BaselineGame[],
): MarketMatchDiagnostic {
  const sourceAway = normalizeTeam(quote.awayTeam);
  const sourceHome = normalizeTeam(quote.homeTeam);
  const seasonGames = games.filter((game) => game.season === MARKET_BASELINE_SEASON);
  const metadataMatches = (game: BaselineGame) => {
    if (game.week !== quote.week) return false;
    const teamsAgree = normalizeTeam(game.awayAbbreviation).value === sourceAway.value
      && normalizeTeam(game.homeAbbreviation).value === sourceHome.value;
    if (!teamsAgree) return false;
    if (!quote.kickoffTime || !game.kickoffTime) return true;
    return Math.abs(quote.kickoffTime.getTime() - game.kickoffTime.getTime()) <= 36 * 60 * 60 * 1000;
  };
  const exact = seasonGames.filter((game) => game.gameId === quote.altGameId && metadataMatches(game));
  const candidates = exact.length ? exact : seasonGames.filter(metadataMatches);
  if (candidates.length === 0) {
    return { sourceGameId: quote.sourceGameId, altGameId: quote.altGameId, outcome: "unmatched", matchedGameId: null, candidateGameIds: [], aliasUsed: false, reason: "no deterministic 2025 identifier or team/week/kickoff match" };
  }
  if (quote.neutralSite || candidates.some((game) => game.neutralSite)) {
    return { sourceGameId: quote.sourceGameId, altGameId: quote.altGameId, outcome: "neutral_site", matchedGameId: null, candidateGameIds: candidates.map((game) => game.gameId), aliasUsed: false, reason: "neutral-site games are excluded from orientation-safe grading" };
  }
  if (candidates.length > 1) {
    return { sourceGameId: quote.sourceGameId, altGameId: quote.altGameId, outcome: "ambiguous", matchedGameId: null, candidateGameIds: candidates.map((game) => game.gameId), aliasUsed: false, reason: "multiple canonical games share the source identifier" };
  }
  const game = candidates[0];
  const sourceTeams = [sourceAway, sourceHome];
  const canonicalTeams = [normalizeTeam(game.awayAbbreviation), normalizeTeam(game.homeAbbreviation)];
  const teamsAgree = sourceTeams.length === 2
    && sourceTeams.every((team, index) => team.value === canonicalTeams[index].value);
  if (!teamsAgree) {
    return { sourceGameId: quote.sourceGameId, altGameId: quote.altGameId, outcome: "unmatched", matchedGameId: null, candidateGameIds: [game.gameId], aliasUsed: false, reason: "source identifier teams disagree with canonical home/away orientation" };
  }
  const aliasUsed = sourceTeams.some((team) => team.aliasUsed)
    || quote.altGameId !== game.gameId;
  return {
    sourceGameId: quote.sourceGameId,
    altGameId: quote.altGameId,
    outcome: aliasUsed ? "alias" : "matched",
    matchedGameId: game.gameId,
    candidateGameIds: [game.gameId],
    aliasUsed,
    reason: aliasUsed
      ? "matched by canonical team aliases, week, and kickoff"
      : "matched by season, identifier, canonical teams, and orientation",
  };
}

export function americanOddsProfit(price: number | null): number | null {
  if (price === null || !Number.isInteger(price) || price === 0) return null;
  return price > 0 ? price / 100 : 100 / Math.abs(price);
}

export function settlementReturn(settlement: Settlement, price: number | null): number | null {
  const profit = americanOddsProfit(price);
  if (profit === null || settlement === "no_bet") return null;
  if (settlement === "push") return 0;
  return settlement === "win" ? profit : -1;
}

export function settleSpread(actualMargin: number, point: number | null, side: "home" | "away"): Settlement {
  if (point === null || !Number.isFinite(actualMargin)) return "no_bet";
  const result = side === "home" ? actualMargin + point : -actualMargin + point;
  return result === 0 ? "push" : result > 0 ? "win" : "loss";
}

export function settleTotal(actualTotal: number, point: number | null, side: "over" | "under"): Settlement {
  if (point === null || !Number.isFinite(actualTotal)) return "no_bet";
  const result = side === "over" ? actualTotal - point : point - actualTotal;
  return result === 0 ? "push" : result > 0 ? "win" : "loss";
}

export const MARKET_EDGE_BUCKETS = [
  { label: "<1", min: 0, max: 1 },
  { label: "1-1.99", min: 1, max: 2 },
  { label: "2-2.99", min: 2, max: 3 },
  { label: "3-4.99", min: 3, max: 5 },
  { label: "5+", min: 5, max: Number.POSITIVE_INFINITY },
] as const;

function wilson(successes: number, trials: number) {
  if (!trials) return { low: null, high: null };
  const z = 1.959963984540054;
  const p = successes / trials;
  const denominator = 1 + z ** 2 / trials;
  const center = (p + z ** 2 / (2 * trials)) / denominator;
  const margin = z * Math.sqrt((p * (1 - p) + z ** 2 / (4 * trials)) / trials) / denominator;
  return { low: Math.max(0, center - margin), high: Math.min(1, center + margin) };
}

export function summarizeMarketEdges(rows: Array<{ edge: number; settlement: Settlement; error: number }>) {
  return MARKET_EDGE_BUCKETS.map((bucket) => {
    const values = rows.filter((row) => Math.abs(row.edge) >= bucket.min && Math.abs(row.edge) < bucket.max);
    const graded = values.filter((row) => row.settlement !== "no_bet" && row.settlement !== "push");
    const wins = graded.filter((row) => row.settlement === "win").length;
    return {
      bucket: bucket.label,
      sampleSize: values.length,
      gradedSampleSize: graded.length,
      wins,
      losses: graded.length - wins,
      winRate: graded.length ? wins / graded.length : null,
      confidenceInterval95: wilson(wins, graded.length),
      meanAbsoluteError: values.length ? values.reduce((sum, row) => sum + row.error, 0) / values.length : null,
    };
  });
}

export function pricingAvailability(quotes: Array<Pick<HistoricalMarketQuote, "price" | "observedAt" | "sourceTimestamp">>) {
  const priced = quotes.filter((quote) => quote.price !== null);
  const withTime = priced.filter((quote) => quote.observedAt || quote.sourceTimestamp);
  return {
    priceAwareReturns: priced.length === quotes.length ? "available" : priced.length ? "partial" : "unavailable",
    trueClv: withTime.length >= 2 ? "partial" : "unavailable",
    pricedQuotes: priced.length,
    timestampedPricedQuotes: withTime.length,
    reason: withTime.length >= 2
      ? null
      : "The source supplies no sportsbook or observation timestamps; true CLV requires a provenance-matched earlier and closing pair.",
  } as const;
}

/** Historical confidence evidence is deliberately descriptive, never a close/CLV or profitability claim. */
export function historicalConfidenceEvidence(rows: Array<{
  market: "spread" | "moneyline" | "total";
  score: number;
  settlement?: Settlement;
}>) {
  return (["spread", "moneyline", "total"] as const).map((market) => {
    const values = rows.filter((row) => row.market === market);
    const supported = values.filter((row) => row.settlement && row.settlement !== "no_bet");
    const wins = supported.filter((row) => row.settlement === "win").length;
    const intervals = wilson(wins, supported.length);
    return {
      market,
      status: supported.length >= 30 ? "measured_recorded_evidence" as const : "insufficient" as const,
      buckets: MARKET_EDGE_BUCKETS.map((bucket) => {
        const bucketRows = values.filter((row) => Math.abs(row.score) >= bucket.min && Math.abs(row.score) < bucket.max);
        return { bucket: bucket.label, sampleSize: bucketRows.length };
      }),
      sampleSize: supported.length,
      confidenceInterval95: intervals,
      limitation: "Recorded-market evidence only; not verified closing lines, CLV, ROI, or profitability.",
    };
  });
}
