import { createHash } from "node:crypto";
import { and, desc, eq, inArray, or, sql, type SQL } from "drizzle-orm";
import {
  db,
  gamesTable,
  oddsApiRequestsTable,
  oddsEventAuditsTable,
  sportsbookOddsTable,
  teamsTable,
  type OddsAuditCandidate,
} from "@workspace/db";

export const SUPPORTED_SPORTSBOOKS = ["DraftKings", "FanDuel"] as const;
export const SUPPORTED_MARKETS = ["spread", "moneyline", "total"] as const;

export type SupportedSportsbook = (typeof SUPPORTED_SPORTSBOOKS)[number];
export type SupportedMarket = (typeof SUPPORTED_MARKETS)[number];

type OddsApiOutcome = {
  name?: unknown;
  price?: unknown;
  point?: unknown;
};

type OddsApiMarket = {
  key?: unknown;
  last_update?: unknown;
  outcomes?: unknown;
};

type OddsApiBookmaker = {
  key?: unknown;
  title?: unknown;
  last_update?: unknown;
  markets?: unknown;
};

type OddsApiEvent = {
  id?: unknown;
  commence_time?: unknown;
  home_team?: unknown;
  away_team?: unknown;
  bookmakers?: unknown;
};

type OddsApiHeaders = {
  requestsUsed: number | null;
  requestsRemaining: number | null;
};

type MatchedGame = {
  gameId: string;
  kickoffTime: Date | null;
  homeTeamId: string;
  awayTeamId: string;
  homeAbbreviation: string;
  awayAbbreviation: string;
  homeTeamName: string;
  awayTeamName: string;
};

export const ODDS_AUDIT_OUTCOMES = [
  "matched_saved",
  "matched_post_kickoff_skipped",
  "unmatched",
] as const;
export type OddsAuditOutcome = (typeof ODDS_AUDIT_OUTCOMES)[number];

export const ODDS_AUDIT_REASONS = [
  "saved_observation",
  "duplicate_observation",
  "no_observations",
  "postkickoff",
  "invalid_fields",
  "no_matching_teams",
  "missing_schedule",
  "outside_tolerance",
  "ambiguity",
  "other",
] as const;
export type OddsAuditReason = (typeof ODDS_AUDIT_REASONS)[number];

type MatchRejectionReason = Exclude<
  OddsAuditReason,
  "saved_observation" | "duplicate_observation" | "no_observations"
>;

export type OddsMatchCandidate = OddsAuditCandidate;

export type OddsMatchDiagnostics = {
  game: MatchedGame | null;
  reason: MatchRejectionReason | null;
  candidates: OddsMatchCandidate[];
  providerEventId: string | null;
  providerHomeTeam: string | null;
  providerAwayTeam: string | null;
  providerKickoffTime: Date | null;
  normalizedHomeTeam: string | null;
  normalizedAwayTeam: string | null;
};

export function classifyMatchedAuditReason(
  observationsSaved: number,
  duplicateObservations: number,
): Extract<OddsAuditReason, "saved_observation" | "duplicate_observation" | "no_observations"> {
  if (observationsSaved > 0) return "saved_observation";
  if (duplicateObservations > 0) return "duplicate_observation";
  return "no_observations";
}

export function classifyMatchedEvent(
  kickoffTime: Date | null,
  now: Date,
): { outcome: "matched_saved" | "matched_post_kickoff_skipped"; reason: "postkickoff" | null } {
  return kickoffTime && kickoffTime.getTime() <= now.getTime()
    ? { outcome: "matched_post_kickoff_skipped", reason: "postkickoff" }
    : { outcome: "matched_saved", reason: null };
}

type OddsEventAuditInsert = {
  eventIndex: number;
  providerEventId: string | null;
  providerHomeTeam: string | null;
  providerAwayTeam: string | null;
  providerKickoffTime: Date | null;
  normalizedHomeTeam: string | null;
  normalizedAwayTeam: string | null;
  candidateGridlineGames: OddsMatchCandidate[];
  matchedGridlineGameId: string | null;
  matchedGridlineKickoff: Date | null;
  outcome: OddsAuditOutcome;
  reason: OddsAuditReason;
  observationsReceived: number;
  observationsSaved: number;
  duplicateObservations: number;
  rejectedObservations: number;
};

export type OddsQuote = {
  sportsbook: SupportedSportsbook;
  market: SupportedMarket;
  selection: string;
  point: number | null;
  price: number;
  capturedAt: Date;
  sourceTimestamp: Date | null;
  observationLabel?: string;
};

export type OddsChange = {
  sportsbook: SupportedSportsbook;
  market: SupportedMarket;
  selection: string;
  capturedAt: Date;
  sourceTimestamp: Date | null;
  previousPoint: number | null;
  point: number | null;
  previousPrice: number;
  price: number;
  pointChanged: boolean;
  priceChanged: boolean;
};

export type OddsHistory = {
  gameId: string;
  firstObservedAt: Date | null;
  firstObservedLabel: "First observed by Gridline" | null;
  firstObserved: OddsQuote[];
  current: OddsQuote[];
  changes: OddsChange[];
  closing: OddsQuote[];
  closingFrozen: boolean;
};

export type OddsCaptureResult = {
  status: "success" | "failed" | "not_configured";
  requestedAt: Date;
  requestId: number | null;
  requestCount: number;
  recordsReceived: number;
  auditedEvents: number;
  snapshotsCreated: number;
  duplicateSnapshots: number;
  unmatchedEvents: number;
  skippedPostKickoff: number;
  missingMarkets: string[];
  failedSportsbooks: string[];
  creditsUsed: number | null;
  creditsRemaining: number | null;
  error: string | null;
};

type OddsHealth = {
  status: "current" | "stale" | "not_configured" | "unavailable";
  detail: string;
  lastUpdated: Date | null;
  requestsToday: number;
  requestsThisMonth: number;
  remainingQuota: string | null;
  metadata: Record<string, unknown>;
};

const oddsApiBaseUrl = "https://api.the-odds-api.com/v4/sports/americanfootball_nfl/odds";
const requestTimeoutMs = 15_000;
let captureInFlight: Promise<OddsCaptureResult> | null = null;
let lastCaptureFailure: string | null = null;

/**
 * Odds API is allowed to use abbreviations and city variants.  Returning a
 * nickname-based canonical value also keeps "NY Giants" and "New York
 * Giants" on the same stream without changing the Gridline team record.
 */
const teamAliases: Record<string, string> = {
  ari: "arizona cardinals",
  arizona: "arizona cardinals",
  "arizona cardinals": "arizona cardinals",
  atl: "atlanta falcons",
  atlanta: "atlanta falcons",
  "atlanta falcons": "atlanta falcons",
  bal: "baltimore ravens",
  baltimore: "baltimore ravens",
  "baltimore ravens": "baltimore ravens",
  buf: "buffalo bills",
  buffalo: "buffalo bills",
  "buffalo bills": "buffalo bills",
  car: "carolina panthers",
  carolina: "carolina panthers",
  "carolina panthers": "carolina panthers",
  chi: "chicago bears",
  chicago: "chicago bears",
  "chicago bears": "chicago bears",
  cin: "cincinnati bengals",
  cincinnati: "cincinnati bengals",
  "cincinnati bengals": "cincinnati bengals",
  cle: "cleveland browns",
  cleveland: "cleveland browns",
  "cleveland browns": "cleveland browns",
  dal: "dallas cowboys",
  dallas: "dallas cowboys",
  "dallas cowboys": "dallas cowboys",
  den: "denver broncos",
  denver: "denver broncos",
  "denver broncos": "denver broncos",
  det: "detroit lions",
  detroit: "detroit lions",
  "detroit lions": "detroit lions",
  gb: "green bay packers",
  gnb: "green bay packers",
  "green bay": "green bay packers",
  "green bay packers": "green bay packers",
  hou: "houston texans",
  houston: "houston texans",
  "houston texans": "houston texans",
  ind: "indianapolis colts",
  indianapolis: "indianapolis colts",
  "indianapolis colts": "indianapolis colts",
  jac: "jacksonville jaguars",
  jax: "jacksonville jaguars",
  jacksonville: "jacksonville jaguars",
  "jacksonville jaguars": "jacksonville jaguars",
  kc: "kansas city chiefs",
  kan: "kansas city chiefs",
  "kansas city": "kansas city chiefs",
  "kansas city chiefs": "kansas city chiefs",
  lv: "las vegas raiders",
  las: "las vegas raiders",
  oak: "las vegas raiders",
  "las vegas": "las vegas raiders",
  "las vegas raiders": "las vegas raiders",
  lac: "los angeles chargers",
  la: "los angeles chargers",
  "los angeles chargers": "los angeles chargers",
  lar: "los angeles rams",
  "la rams": "los angeles rams",
  "los angeles rams": "los angeles rams",
  mia: "miami dolphins",
  miami: "miami dolphins",
  "miami dolphins": "miami dolphins",
  min: "minnesota vikings",
  minnesota: "minnesota vikings",
  "minnesota vikings": "minnesota vikings",
  ne: "new england patriots",
  newengland: "new england patriots",
  "new england": "new england patriots",
  "new england patriots": "new england patriots",
  no: "new orleans saints",
  nor: "new orleans saints",
  "new orleans": "new orleans saints",
  "new orleans saints": "new orleans saints",
  nyg: "new york giants",
  "ny giants": "new york giants",
  "new york giants": "new york giants",
  nyj: "new york jets",
  "ny jets": "new york jets",
  "new york jets": "new york jets",
  phi: "philadelphia eagles",
  philadelphia: "philadelphia eagles",
  "philadelphia eagles": "philadelphia eagles",
  pit: "pittsburgh steelers",
  pittsburgh: "pittsburgh steelers",
  "pittsburgh steelers": "pittsburgh steelers",
  sf: "san francisco 49ers",
  sfo: "san francisco 49ers",
  "san francisco": "san francisco 49ers",
  "san francisco 49ers": "san francisco 49ers",
  sea: "seattle seahawks",
  seattle: "seattle seahawks",
  "seattle seahawks": "seattle seahawks",
  tb: "tampa bay buccaneers",
  tam: "tampa bay buccaneers",
  tampa: "tampa bay buccaneers",
  "tampa bay": "tampa bay buccaneers",
  "tampa bay buccaneers": "tampa bay buccaneers",
  ten: "tennessee titans",
  tennessee: "tennessee titans",
  "tennessee titans": "tennessee titans",
  was: "washington commanders",
  wsh: "washington commanders",
  washington: "washington commanders",
  "washington commanders": "washington commanders",
};

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : {};
}

function asString(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

/**
 * The Odds API normally returns ISO timestamps, but keeping this parser
 * tolerant of Date/epoch values makes source-time handling deterministic for
 * provider responses and fixtures.  Invalid timestamps are deliberately
 * treated as missing rather than being allowed to become an Invalid Date.
 */
export function parseOddsTimestamp(value: unknown): Date | null {
  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? null : new Date(value.getTime());
  }
  if (typeof value === "number" && Number.isFinite(value)) {
    const milliseconds = Math.abs(value) < 1_000_000_000_000 ? value * 1000 : value;
    const date = new Date(milliseconds);
    return Number.isNaN(date.getTime()) ? null : date;
  }
  const stringValue = asString(value);
  if (!stringValue) return null;
  if (/^[+-]?\d+(?:\.\d+)?$/.test(stringValue)) {
    const numericValue = Number(stringValue);
    if (Number.isFinite(numericValue)) {
      const milliseconds = Math.abs(numericValue) < 1_000_000_000_000 ? numericValue * 1000 : numericValue;
      const date = new Date(milliseconds);
      return Number.isNaN(date.getTime()) ? null : date;
    }
  }
  const date = new Date(stringValue);
  return Number.isNaN(date.getTime()) ? null : date;
}

const asDate = parseOddsTimestamp;

function asFiniteNumber(value: unknown): number | null {
  if (typeof value !== "number" && typeof value !== "string") return null;
  if (typeof value === "string" && value.trim() === "") return null;
  const numberValue = typeof value === "number" ? value : Number(value);
  return Number.isFinite(numberValue) ? numberValue : null;
}

function safeErrorMessage(error: unknown, fallback: string): string {
  const message = error instanceof Error ? error.message : fallback;
  // Provider/library errors should never be allowed to echo the keyed URL into
  // the request ledger or Data Health response.
  return message
    .replace(/([?&]apiKey=)[^&\s]+/gi, "$1[redacted]")
    .replace(/(api[_-]?key[=:])[^&\s]+/gi, "$1[redacted]")
    .replace(/https?:\/\/[^\s]+/gi, "[redacted-url]");
}

function canonicalTeamName(value: string): string {
  const compact = value
    .toLowerCase()
    .replace(/[.'’]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
  return teamAliases[compact] ?? compact;
}

export function normalizeTeamName(value: string): string {
  return canonicalTeamName(value);
}

function bookmakerName(value: OddsApiBookmaker): SupportedSportsbook | null {
  const key = asString(value.key)?.toLowerCase();
  const title = asString(value.title)?.toLowerCase();
  if (key === "draftkings" || title?.includes("draftkings")) return "DraftKings";
  if (key === "fanduel" || title?.includes("fanduel")) return "FanDuel";
  return null;
}

function normalizeMarket(value: unknown): SupportedMarket | null {
  switch (asString(value)?.toLowerCase()) {
    case "spreads":
      return "spread";
    case "h2h":
      return "moneyline";
    case "totals":
      return "total";
    default:
      return null;
  }
}

function expectedPoint(market: SupportedMarket, outcome: Record<string, unknown>): number | null {
  if (market === "moneyline") return null;
  return asFiniteNumber(outcome.point);
}

function selectionForOutcome(
  market: SupportedMarket,
  outcomeName: string,
  game: MatchedGame,
): string | null {
  if (market === "total") {
    const normalizedTotal = outcomeName.trim().toLowerCase();
    if (normalizedTotal === "under") return "Under";
    if (normalizedTotal === "over") return "Over";
    return null;
  }
  const normalized = canonicalTeamName(outcomeName);
  if (normalized === canonicalTeamName(game.homeTeamName) || normalized === canonicalTeamName(game.homeAbbreviation)) {
    return game.homeAbbreviation;
  }
  if (normalized === canonicalTeamName(game.awayTeamName) || normalized === canonicalTeamName(game.awayAbbreviation)) {
    return game.awayAbbreviation;
  }
  return null;
}

export function hashOddsState(observationKey: string, point: number | null, price: number): string {
  return createHash("sha256")
    .update(`${observationKey}|${point === null ? "null" : point}|${price}`)
    .digest("hex");
}

export function getObservationKey(
  gameId: string,
  sportsbook: SupportedSportsbook,
  market: SupportedMarket,
  selection: string,
): string {
  return [gameId, sportsbook.toLowerCase(), market, canonicalTeamName(selection)].join("|");
}

export type ComparableOddsQuote = Pick<OddsQuote, "market" | "selection" | "point" | "price">;

/**
 * Return a positive value when candidate is more bettor-favorable than
 * incumbent, a negative value when it is worse, and zero when they are
 * equivalent.  Points are always ranked before price; the direction for a
 * total depends on whether the row is Over or Under.
 */
export function compareOddsQuotes(
  candidate: ComparableOddsQuote | null | undefined,
  incumbent: ComparableOddsQuote | null | undefined,
): number {
  if (!candidate) return incumbent ? -1 : 0;
  if (!incumbent) return 1;
  if (candidate.market !== incumbent.market) return 0;

  if (candidate.market !== "moneyline") {
    const candidatePoint = candidate.point;
    const incumbentPoint = incumbent.point;
    if (candidatePoint !== incumbentPoint) {
      if (candidatePoint === null || candidatePoint === undefined) return -1;
      if (incumbentPoint === null || incumbentPoint === undefined) return 1;
      const isOver = candidate.market === "total" && candidate.selection.trim().toLowerCase() === "over";
      return (isOver ? incumbentPoint - candidatePoint : candidatePoint - incumbentPoint);
    }
  }
  return candidate.price - incumbent.price;
}

export function oddsQuoteIsBetter(
  candidate: ComparableOddsQuote | null | undefined,
  incumbent: ComparableOddsQuote | null | undefined,
): boolean {
  return compareOddsQuotes(candidate, incumbent) > 0;
}

/**
 * Closing eligibility is based only on the local capture clock.  A provider's
 * last_update can lag or lead the local clock and must never move a quote
 * across the kickoff boundary.
 */
export function isPreKickoffCapture(capturedAt: Date, kickoffTime: Date | null): boolean {
  return Boolean(kickoffTime && capturedAt.getTime() < kickoffTime.getTime());
}

/**
 * Build a deterministic missing-market report for only events that were
 * matched to Gridline games. Unmatched provider events cannot establish that
 * a market is missing from a Gridline game.
 */
export function findMissingOddsMarkets(
  matchedGameIds: Iterable<string>,
  observedMarketKeys: Iterable<string>,
): string[] {
  const observed = new Set(observedMarketKeys);
  const missing: string[] = [];
  for (const gameId of new Set(matchedGameIds)) {
    for (const sportsbook of SUPPORTED_SPORTSBOOKS) {
      for (const market of SUPPORTED_MARKETS) {
        const key = `${gameId}:${sportsbook}:${market}`;
        if (!observed.has(key)) missing.push(`${gameId} ${sportsbook} ${market}`);
      }
    }
  }
  return missing.sort();
}

export function hasCompleteOddsMarket(
  market: SupportedMarket,
  observedSelections: Iterable<string>,
  homeAbbreviation: string,
  awayAbbreviation: string,
): boolean {
  const observed = new Set(observedSelections);
  const required = market === "total"
    ? ["Over", "Under"]
    : [homeAbbreviation, awayAbbreviation];
  return required.every((selection) => observed.has(selection));
}

function parseQuotaHeaders(headers: Headers): OddsApiHeaders {
  const parse = (name: string) => {
    const value = headers.get(name);
    if (value === null) return null;
    const numberValue = Number(value);
    return Number.isFinite(numberValue) ? numberValue : null;
  };
  return {
    requestsUsed: parse("x-requests-used"),
    requestsRemaining: parse("x-requests-remaining"),
  };
}

async function findExistingGames(): Promise<MatchedGame[]> {
  const [games, teams] = await Promise.all([
    db.select().from(gamesTable),
    db.select().from(teamsTable),
  ]);
  const teamById = new Map(teams.map((team) => [team.teamId, team]));
  return games.flatMap((game) => {
    const home = teamById.get(game.homeTeamId);
    const away = teamById.get(game.awayTeamId);
    if (!home || !away) return [];
    return [{
      gameId: game.gameId,
      kickoffTime: game.kickoffTime,
      homeTeamId: game.homeTeamId,
      awayTeamId: game.awayTeamId,
      homeAbbreviation: home.abbreviation,
      awayAbbreviation: away.abbreviation,
      homeTeamName: home.teamName,
      awayTeamName: away.teamName,
    }];
  });
}

function candidateForGame(
  game: MatchedGame,
  commence: Date | null,
): OddsMatchCandidate {
  return {
    gridlineGameId: game.gameId,
    kickoffTime: game.kickoffTime?.toISOString() ?? null,
    timeDifferenceMinutes: commence && game.kickoffTime
      ? Math.abs(commence.getTime() - game.kickoffTime.getTime()) / 60_000
      : null,
  };
}

/**
 * Match diagnostics intentionally use the same ordered checks as the original
 * matcher: exact normalized home/away teams, a 36-hour absolute kickoff
 * tolerance, nearest candidate, and a sub-minute nearest-candidate ambiguity
 * refusal.  The additional reason/candidate fields are observational only.
 */
export function diagnoseOddsEventMatch(
  event: OddsApiEvent,
  existingGames: MatchedGame[],
): OddsMatchDiagnostics {
  const home = asString(event.home_team);
  const away = asString(event.away_team);
  const commence = asDate(event.commence_time);
  const providerEventId = asString(event.id);
  const normalizedHomeTeam = home ? canonicalTeamName(home) : null;
  const normalizedAwayTeam = away ? canonicalTeamName(away) : null;
  const base = {
    providerEventId,
    providerHomeTeam: home,
    providerAwayTeam: away,
    providerKickoffTime: commence,
    normalizedHomeTeam,
    normalizedAwayTeam,
  };
  const teamCandidates = home && away
    ? existingGames.filter((game) =>
      normalizedHomeTeam === canonicalTeamName(game.homeTeamName) &&
      normalizedAwayTeam === canonicalTeamName(game.awayTeamName))
    : [];
  const candidates = teamCandidates.map((game) => candidateForGame(game, commence));

  if (!home || !away || !commence) {
    return {
      ...base,
      game: null,
      reason: "invalid_fields",
      candidates,
    };
  }
  if (existingGames.length === 0) {
    return {
      ...base,
      game: null,
      reason: "missing_schedule",
      candidates: [],
    };
  }

  if (teamCandidates.length === 0) {
    return {
      ...base,
      game: null,
      reason: "no_matching_teams",
      candidates,
    };
  }

  const withinTolerance = teamCandidates.filter((game) => {
    if (!game.kickoffTime) return false;
    const kickoffDiff = Math.abs(commence.getTime() - game.kickoffTime.getTime());
    return kickoffDiff <= 36 * 60 * 60 * 1000;
  });
  if (withinTolerance.length === 0) {
    return {
      ...base,
      game: null,
      reason: teamCandidates.every((game) => !game.kickoffTime) ? "missing_schedule" : "outside_tolerance",
      candidates,
    };
  }

  withinTolerance.sort((left, right) => {
    const leftDiff = Math.abs(commence.getTime() - (left.kickoffTime?.getTime() ?? 0));
    const rightDiff = Math.abs(commence.getTime() - (right.kickoffTime?.getTime() ?? 0));
    return leftDiff - rightDiff;
  });
  const nearest = withinTolerance[0];
  const nearestDiff = Math.abs(commence.getTime() - (nearest.kickoffTime?.getTime() ?? 0));
  const secondDiff = withinTolerance[1]
    ? Math.abs(commence.getTime() - (withinTolerance[1].kickoffTime?.getTime() ?? 0))
    : Number.POSITIVE_INFINITY;
  // If two Gridline games are equally close, refusing the observation is safer
  // than attaching a market to the wrong game.
  if (Math.abs(nearestDiff - secondDiff) < 60_000) {
    return {
      ...base,
      game: null,
      reason: "ambiguity",
      candidates,
    };
  }
  return {
    ...base,
    game: nearest,
    reason: null,
    candidates,
  };
}

function matchGame(
  event: OddsApiEvent,
  existingGames: MatchedGame[],
): MatchedGame | null {
  return diagnoseOddsEventMatch(event, existingGames).game;
}

async function insertIfChanged(
  game: MatchedGame,
  sportsbook: SupportedSportsbook,
  market: SupportedMarket,
  selection: string,
  point: number | null,
  price: number,
  capturedAt: Date,
  sourceTimestamp: Date | null,
): Promise<"inserted" | "duplicate"> {
  const key = getObservationKey(game.gameId, sportsbook, market, selection);
  const hash = hashOddsState(key, point, price);
  return db.transaction(async (tx) => {
    // PostgreSQL advisory locks make the latest-state comparison atomic across
    // concurrent capture requests without changing immutable history rows.
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${key}))`);
    const [latest] = await tx
      .select({
        point: sportsbookOddsTable.point,
        price: sportsbookOddsTable.price,
        stateHash: sportsbookOddsTable.stateHash,
      })
      .from(sportsbookOddsTable)
      .where(
        and(
          eq(sportsbookOddsTable.gameId, game.gameId),
          or(
            eq(sportsbookOddsTable.observationKey, key),
            and(
              eq(sportsbookOddsTable.observationKey, ""),
              eq(sportsbookOddsTable.sportsbook, sportsbook),
              eq(sportsbookOddsTable.market, market),
              eq(sportsbookOddsTable.selection, selection),
            ),
          ),
        ),
      )
      .orderBy(desc(sportsbookOddsTable.capturedAt), desc(sportsbookOddsTable.id))
      .limit(1);
    // Point and price are the authoritative quote state. Do not require the
    // additive hash columns to be populated so rows written before those
    // columns existed are still deduplicated correctly.
    if (latest && latest.point === point && latest.price === price) {
      return "duplicate";
    }
    await tx.insert(sportsbookOddsTable).values({
      gameId: game.gameId,
      sportsbook,
      capturedAt,
      sourceTimestamp,
      market,
      selection,
      point,
      price,
      observationKey: key,
      stateHash: hash,
    });
    return "inserted";
  });
}

async function recordRequest(values: {
  requestedAt: Date;
  status: "success" | "failed";
  httpStatus?: number | null;
  recordsProcessed?: number;
  creditsUsed?: number | null;
  creditsRemaining?: number | null;
  errorMessage?: string | null;
  metadata?: Record<string, unknown>;
}) {
  const [request] = await db
    .insert(oddsApiRequestsTable)
    .values({
      requestedAt: values.requestedAt,
      status: values.status,
      httpStatus: values.httpStatus ?? null,
      recordsProcessed: values.recordsProcessed ?? 0,
      creditsUsed: values.creditsUsed ?? null,
      creditsRemaining: values.creditsRemaining ?? null,
      errorMessage: values.errorMessage ?? null,
      metadata: values.metadata,
    })
    .returning({ id: oddsApiRequestsTable.id });
  return request.id;
}

async function recordEventAudits(
  requestId: number,
  audits: OddsEventAuditInsert[],
) {
  if (audits.length === 0) return;
  await db.insert(oddsEventAuditsTable).values(
    audits.map((audit) => ({
      requestId,
      eventIndex: audit.eventIndex,
      providerEventId: audit.providerEventId,
      providerHomeTeam: audit.providerHomeTeam,
      providerAwayTeam: audit.providerAwayTeam,
      providerKickoffTime: audit.providerKickoffTime,
      normalizedHomeTeam: audit.normalizedHomeTeam,
      normalizedAwayTeam: audit.normalizedAwayTeam,
      candidateGridlineGames: audit.candidateGridlineGames,
      matchedGridlineGameId: audit.matchedGridlineGameId,
      matchedGridlineKickoff: audit.matchedGridlineKickoff,
      outcome: audit.outcome,
      reason: audit.reason,
      observationsReceived: audit.observationsReceived,
      observationsSaved: audit.observationsSaved,
      duplicateObservations: audit.duplicateObservations,
      rejectedObservations: audit.rejectedObservations,
    })),
  );
}

async function runOddsCapture(): Promise<OddsCaptureResult> {
  const requestedAt = new Date();
  const emptyResult = (status: OddsCaptureResult["status"], error: string | null): OddsCaptureResult => ({
    status,
    requestedAt,
    requestId: null,
    requestCount: 0,
    recordsReceived: 0,
    auditedEvents: 0,
    snapshotsCreated: 0,
    duplicateSnapshots: 0,
    unmatchedEvents: 0,
    skippedPostKickoff: 0,
    missingMarkets: [],
    failedSportsbooks: [],
    creditsUsed: null,
    creditsRemaining: null,
    error,
  });
  const apiKey = process.env.ODDS_API_KEY;
  if (!apiKey) return emptyResult("not_configured", "ODDS_API_KEY is not configured.");

  const query = new URLSearchParams({
    apiKey,
    regions: "us",
    markets: "h2h,spreads,totals",
    oddsFormat: "american",
    dateFormat: "iso",
    bookmakers: "draftkings,fanduel",
  });
  const url = `${oddsApiBaseUrl}?${query.toString()}`;
  let response: Response;
  let headers: OddsApiHeaders = { requestsUsed: null, requestsRemaining: null };
  try {
    // Exactly one request is made by this capture. There is intentionally no
    // retry loop: the free API allowance must not be consumed implicitly.
    response = await fetch(url, {
      method: "GET",
      headers: { Accept: "application/json" },
      signal: AbortSignal.timeout(requestTimeoutMs),
    });
    headers = parseQuotaHeaders(response.headers);
  } catch (error) {
    const message = safeErrorMessage(error, "Odds API request failed");
    const requestId = await recordRequest({
      requestedAt,
      status: "failed",
      errorMessage: message,
      creditsUsed: headers.requestsUsed,
      creditsRemaining: headers.requestsRemaining,
    });
    lastCaptureFailure = message;
    return {
      ...emptyResult("failed", message),
      requestId,
      requestCount: 1,
      creditsUsed: headers.requestsUsed,
      creditsRemaining: headers.requestsRemaining,
    };
  }

  if (!response.ok) {
    const message = `The Odds API returned HTTP ${response.status}.`;
    const requestId = await recordRequest({
      requestedAt,
      status: "failed",
      httpStatus: response.status,
      errorMessage: message,
      creditsUsed: headers.requestsUsed,
      creditsRemaining: headers.requestsRemaining,
    });
    lastCaptureFailure = message;
    return {
      ...emptyResult("failed", message),
      requestId,
      requestCount: 1,
      creditsUsed: headers.requestsUsed,
      creditsRemaining: headers.requestsRemaining,
    };
  }

  let payload: unknown;
  try {
    payload = await response.json();
  } catch {
    const message = "The Odds API returned an unreadable response.";
    const requestId = await recordRequest({
      requestedAt,
      status: "failed",
      httpStatus: response.status,
      errorMessage: message,
      creditsUsed: headers.requestsUsed,
      creditsRemaining: headers.requestsRemaining,
    });
    lastCaptureFailure = message;
    return {
      ...emptyResult("failed", message),
      requestId,
      requestCount: 1,
      creditsUsed: headers.requestsUsed,
      creditsRemaining: headers.requestsRemaining,
    };
  }

  const events = Array.isArray(payload) ? payload.map(asRecord) : [];
  const existingGames = await findExistingGames();
  let snapshotsCreated = 0;
  let duplicateSnapshots = 0;
  let unmatchedEvents = 0;
  let skippedPostKickoff = 0;
  const missingMarkets = new Set<string>();
  const matchedGameIds = new Set<string>();
  const matchedGames = new Map<string, MatchedGame>();
  const observedSelections = new Map<string, Set<string>>();
  const validSportsbooks = new Set<SupportedSportsbook>();
  const failedSportsbooks = new Set<string>();
  const eventAudits: OddsEventAuditInsert[] = [];
  const now = new Date();

  for (const [eventIndex, event] of events.entries()) {
    const diagnostics = diagnoseOddsEventMatch(event, existingGames);
    const game = diagnostics.game;
    if (!game) {
      unmatchedEvents += 1;
      eventAudits.push({
        eventIndex,
        providerEventId: diagnostics.providerEventId,
        providerHomeTeam: diagnostics.providerHomeTeam,
        providerAwayTeam: diagnostics.providerAwayTeam,
        providerKickoffTime: diagnostics.providerKickoffTime,
        normalizedHomeTeam: diagnostics.normalizedHomeTeam,
        normalizedAwayTeam: diagnostics.normalizedAwayTeam,
        candidateGridlineGames: diagnostics.candidates,
        matchedGridlineGameId: null,
        matchedGridlineKickoff: null,
        outcome: "unmatched",
        reason: diagnostics.reason ?? "other",
        observationsReceived: 0,
        observationsSaved: 0,
        duplicateObservations: 0,
        rejectedObservations: 0,
      });
      continue;
    }
    const matchedEvent = classifyMatchedEvent(game.kickoffTime, now);
    if (matchedEvent.outcome === "matched_post_kickoff_skipped") {
      skippedPostKickoff += 1;
      eventAudits.push({
        eventIndex,
        providerEventId: diagnostics.providerEventId,
        providerHomeTeam: diagnostics.providerHomeTeam,
        providerAwayTeam: diagnostics.providerAwayTeam,
        providerKickoffTime: diagnostics.providerKickoffTime,
        normalizedHomeTeam: diagnostics.normalizedHomeTeam,
        normalizedAwayTeam: diagnostics.normalizedAwayTeam,
        candidateGridlineGames: diagnostics.candidates,
        matchedGridlineGameId: game.gameId,
        matchedGridlineKickoff: game.kickoffTime,
        outcome: matchedEvent.outcome,
        reason: matchedEvent.reason ?? "postkickoff",
        observationsReceived: 0,
        observationsSaved: 0,
        duplicateObservations: 0,
        rejectedObservations: 0,
      });
      continue;
    }
    // Scope missing-market reporting to each matched upcoming game. A
    // bookmaker having a market on one game must not hide that same market
    // being absent on another game.
    matchedGameIds.add(game.gameId);
    matchedGames.set(game.gameId, game);
    let observationsReceived = 0;
    let observationsSaved = 0;
    let duplicateObservations = 0;
    let rejectedObservations = 0;
    const bookmakers = Array.isArray(event.bookmakers) ? event.bookmakers.map(asRecord) : [];
    for (const rawBookmaker of bookmakers) {
      const sportsbook = bookmakerName(rawBookmaker);
      if (!sportsbook) {
        rejectedObservations += 1;
        continue;
      }
      const bookmakerLastUpdate = asDate(rawBookmaker.last_update);
      const markets = Array.isArray(rawBookmaker.markets) ? rawBookmaker.markets.map(asRecord) : [];
      for (const rawMarket of markets) {
        const market = normalizeMarket(rawMarket.key);
        if (!market) {
          rejectedObservations += 1;
          continue;
        }
        const sourceTimestamp = asDate(rawMarket.last_update) ?? bookmakerLastUpdate;
        const outcomes = Array.isArray(rawMarket.outcomes) ? rawMarket.outcomes.map(asRecord) : [];
        for (const outcome of outcomes) {
          const outcomeName = asString(outcome.name);
          const price = asFiniteNumber(outcome.price);
          if (!outcomeName || price === null || !Number.isInteger(price) || price === 0) {
            rejectedObservations += 1;
            continue;
          }
          const point = expectedPoint(market, outcome);
          if (market !== "moneyline" && point === null) {
            rejectedObservations += 1;
            continue;
          }
          const selection = selectionForOutcome(market, outcomeName, game);
          if (!selection) {
            rejectedObservations += 1;
            continue;
          }
          observationsReceived += 1;
          const result = await insertIfChanged(
            game,
            sportsbook,
            market,
            selection,
            point,
            price,
            now,
            sourceTimestamp,
          );
          const marketKey = `${game.gameId}:${sportsbook}:${market}`;
          const selections = observedSelections.get(marketKey) ?? new Set<string>();
          selections.add(selection);
          observedSelections.set(marketKey, selections);
          validSportsbooks.add(sportsbook);
          if (result === "inserted") {
            snapshotsCreated += 1;
            observationsSaved += 1;
          } else {
            duplicateSnapshots += 1;
            duplicateObservations += 1;
          }
        }
      }
    }
    eventAudits.push({
      eventIndex,
      providerEventId: diagnostics.providerEventId,
      providerHomeTeam: diagnostics.providerHomeTeam,
      providerAwayTeam: diagnostics.providerAwayTeam,
      providerKickoffTime: diagnostics.providerKickoffTime,
      normalizedHomeTeam: diagnostics.normalizedHomeTeam,
      normalizedAwayTeam: diagnostics.normalizedAwayTeam,
      candidateGridlineGames: diagnostics.candidates,
      matchedGridlineGameId: game.gameId,
      matchedGridlineKickoff: game.kickoffTime,
      outcome: "matched_saved",
      reason: classifyMatchedAuditReason(observationsSaved, duplicateObservations),
      observationsReceived,
      observationsSaved,
      duplicateObservations,
      rejectedObservations,
    });
  }
  for (const sportsbook of SUPPORTED_SPORTSBOOKS) {
    if (!validSportsbooks.has(sportsbook)) {
      failedSportsbooks.add(sportsbook);
    }
  }
  const completeMarkets = new Set<string>();
  for (const [marketKey, selections] of observedSelections) {
    const [gameId, _sportsbook, market] = marketKey.split(":");
    const game = matchedGames.get(gameId);
    if (!game) continue;
    if (hasCompleteOddsMarket(
      market as SupportedMarket,
      selections,
      game.homeAbbreviation,
      game.awayAbbreviation,
    )) {
      completeMarkets.add(marketKey);
    }
  }
  for (const missing of findMissingOddsMarkets(matchedGameIds, completeMarkets)) {
    missingMarkets.add(missing);
  }
  const recordsProcessed = snapshotsCreated + duplicateSnapshots;
  const auditReasonCounts = eventAudits.reduce<Record<string, number>>((counts, audit) => {
    counts[audit.reason] = (counts[audit.reason] ?? 0) + 1;
    return counts;
  }, {});
  const requestId = await recordRequest({
    requestedAt,
    status: "success",
    httpStatus: response.status,
    recordsProcessed,
    creditsUsed: headers.requestsUsed,
    creditsRemaining: headers.requestsRemaining,
    metadata: {
      missingMarkets: [...missingMarkets].sort(),
      failedSportsbooks: [...failedSportsbooks].sort(),
      auditedEvents: eventAudits.length,
      auditReasonCounts,
    },
  });
  await recordEventAudits(requestId, eventAudits);
  lastCaptureFailure = null;
  return {
    status: "success",
    requestedAt,
    requestId,
    requestCount: 1,
    recordsReceived: events.length,
    auditedEvents: eventAudits.length,
    snapshotsCreated,
    duplicateSnapshots,
    unmatchedEvents,
    skippedPostKickoff,
    missingMarkets: [...missingMarkets].sort(),
    failedSportsbooks: [...failedSportsbooks].sort(),
    creditsUsed: headers.requestsUsed,
    creditsRemaining: headers.requestsRemaining,
    error: null,
  };
}

export function captureOddsSnapshots(): Promise<OddsCaptureResult> {
  if (captureInFlight) return captureInFlight;
  captureInFlight = runOddsCapture().finally(() => {
    captureInFlight = null;
  });
  return captureInFlight;
}

function quoteFromRow(row: typeof sportsbookOddsTable.$inferSelect): OddsQuote {
  return {
    sportsbook: row.sportsbook as SupportedSportsbook,
    market: row.market as SupportedMarket,
    selection: row.selection,
    point: row.point,
    price: row.price,
    capturedAt: row.capturedAt,
    sourceTimestamp: row.sourceTimestamp,
  };
}

function latestByObservation(rows: Array<typeof sportsbookOddsTable.$inferSelect>) {
  const latest = new Map<string, typeof sportsbookOddsTable.$inferSelect>();
  for (const row of rows) {
    const key = row.observationKey || getObservationKey(
      row.gameId,
      row.sportsbook as SupportedSportsbook,
      row.market as SupportedMarket,
      row.selection,
    );
    if (!latest.has(key)) latest.set(key, row);
  }
  return [...latest.values()];
}

export async function getLatestOddsByGame(gameIds: string[]) {
  if (gameIds.length === 0) return new Map<string, OddsQuote[]>();
  const rows = await db
    .select()
    .from(sportsbookOddsTable)
    .where(inArray(sportsbookOddsTable.gameId, gameIds))
    .orderBy(desc(sportsbookOddsTable.capturedAt), desc(sportsbookOddsTable.id));
  const grouped = new Map<string, OddsQuote[]>();
  for (const row of latestByObservation(rows)) {
    const quotes = grouped.get(row.gameId) ?? [];
    quotes.push(quoteFromRow(row));
    grouped.set(row.gameId, quotes);
  }
  return grouped;
}

export async function getOddsHistory(gameId: string): Promise<OddsHistory> {
  const [game] = await db
    .select({ kickoffTime: gamesTable.kickoffTime })
    .from(gamesTable)
    .where(eq(gamesTable.gameId, gameId))
    .limit(1);
  const rows = await db
    .select()
    .from(sportsbookOddsTable)
    .where(eq(sportsbookOddsTable.gameId, gameId))
    .orderBy(sportsbookOddsTable.capturedAt, sportsbookOddsTable.id);
  const currentRows = latestByObservation([...rows].reverse());
  const firstRows = latestByObservation(rows);
  const changes: OddsChange[] = [];
  const priorByKey = new Map<string, typeof sportsbookOddsTable.$inferSelect>();
  for (const row of rows) {
    const key = row.observationKey || getObservationKey(
      row.gameId,
      row.sportsbook as SupportedSportsbook,
      row.market as SupportedMarket,
      row.selection,
    );
    const prior = priorByKey.get(key);
    if (prior && (prior.point !== row.point || prior.price !== row.price)) {
      changes.push({
        sportsbook: row.sportsbook as SupportedSportsbook,
        market: row.market as SupportedMarket,
        selection: row.selection,
        capturedAt: row.capturedAt,
        sourceTimestamp: row.sourceTimestamp,
        previousPoint: prior.point,
        point: row.point,
        previousPrice: prior.price,
        price: row.price,
        pointChanged: prior.point !== row.point,
        priceChanged: prior.price !== row.price,
      });
    }
    priorByKey.set(key, row);
  }
  const closingRows = game?.kickoffTime
    ? latestByObservation(
        rows
          .filter((row) => isPreKickoffCapture(row.capturedAt, game.kickoffTime))
          .reverse(),
      )
    : [];
  const firstObservedAt = rows[0]?.capturedAt ?? null;
  const closingFrozen = Boolean(
    game?.kickoffTime && game.kickoffTime.getTime() <= Date.now(),
  );
  return {
    gameId,
    firstObservedAt,
    firstObservedLabel: firstObservedAt ? "First observed by Gridline" : null,
    firstObserved: firstRows.map(quoteFromRow),
    current: currentRows.map(quoteFromRow),
    changes,
    closing: closingRows.map(quoteFromRow),
    closingFrozen,
  };
}

export type OddsEventAudit = {
  id: number;
  requestId: number;
  eventIndex: number;
  providerEventId: string | null;
  providerHomeTeam: string | null;
  providerAwayTeam: string | null;
  providerKickoffTime: Date | null;
  normalizedHomeTeam: string | null;
  normalizedAwayTeam: string | null;
  candidateGridlineGames: OddsMatchCandidate[];
  matchedGridlineGameId: string | null;
  matchedGridlineKickoff: Date | null;
  outcome: OddsAuditOutcome;
  reason: OddsAuditReason;
  observationsReceived: number;
  observationsSaved: number;
  duplicateObservations: number;
  rejectedObservations: number;
  auditedAt: Date;
};

export async function getOddsEventAudits(filters: {
  requestId?: number;
  outcome?: OddsAuditOutcome;
  limit?: number;
} = {}): Promise<OddsEventAudit[]> {
  const conditions: SQL[] = [];
  if (filters.requestId !== undefined) {
    conditions.push(eq(oddsEventAuditsTable.requestId, filters.requestId));
  }
  if (filters.outcome !== undefined) {
    conditions.push(eq(oddsEventAuditsTable.outcome, filters.outcome));
  }
  const rows = await db
    .select()
    .from(oddsEventAuditsTable)
    .where(conditions.length > 0 ? and(...conditions) : undefined)
    .orderBy(desc(oddsEventAuditsTable.auditedAt), desc(oddsEventAuditsTable.id))
    .limit(Math.min(Math.max(filters.limit ?? 200, 1), 1000));
  return rows.map((row) => ({
    id: row.id,
    requestId: row.requestId,
    eventIndex: row.eventIndex,
    providerEventId: row.providerEventId,
    providerHomeTeam: row.providerHomeTeam,
    providerAwayTeam: row.providerAwayTeam,
    providerKickoffTime: row.providerKickoffTime,
    normalizedHomeTeam: row.normalizedHomeTeam,
    normalizedAwayTeam: row.normalizedAwayTeam,
    candidateGridlineGames: row.candidateGridlineGames,
    matchedGridlineGameId: row.matchedGridlineGameId,
    matchedGridlineKickoff: row.matchedGridlineKickoff,
    outcome: row.outcome as OddsAuditOutcome,
    reason: row.reason as OddsAuditReason,
    observationsReceived: row.observationsReceived,
    observationsSaved: row.observationsSaved,
    duplicateObservations: row.duplicateObservations,
    rejectedObservations: row.rejectedObservations,
    auditedAt: row.auditedAt,
  }));
}

export async function getOddsApiHealth(): Promise<OddsHealth> {
  const configured = Boolean(process.env.ODDS_API_KEY);
  if (!configured) {
    return {
      status: "not_configured",
      detail: "ODDS_API_KEY is not configured; no live sportsbook request has been attempted.",
      lastUpdated: null,
      requestsToday: 0,
      requestsThisMonth: 0,
      remainingQuota: null,
      metadata: { requestsMade: 0, failedRequests: [], missingMarkets: [] },
    };
  }
  const [latestSuccess] = await db
    .select()
    .from(oddsApiRequestsTable)
    .where(eq(oddsApiRequestsTable.status, "success"))
    .orderBy(desc(oddsApiRequestsTable.requestedAt), desc(oddsApiRequestsTable.id))
    .limit(1);
  // Quota headers describe the request that just ran, not necessarily the
  // latest successful capture. A failed request can still consume credits and
  // can return the authoritative remaining quota.
  const [latestRequest] = await db
    .select()
    .from(oddsApiRequestsTable)
    .orderBy(desc(oddsApiRequestsTable.requestedAt), desc(oddsApiRequestsTable.id))
    .limit(1);
  const [counts] = await db
    .select({
      requestsMade: sql<number>`count(*)`,
      failedRequests: sql<number>`count(*) filter (where ${oddsApiRequestsTable.status} = 'failed')`,
      requestsToday: sql<number>`count(*) filter (where ${oddsApiRequestsTable.requestedAt} >= current_date)`,
      requestsThisMonth: sql<number>`count(*) filter (where ${oddsApiRequestsTable.requestedAt} >= date_trunc('month', current_timestamp))`,
    })
    .from(oddsApiRequestsTable);
  const [latestFailure] = await db
    .select()
    .from(oddsApiRequestsTable)
    .where(eq(oddsApiRequestsTable.status, "failed"))
    .orderBy(desc(oddsApiRequestsTable.requestedAt), desc(oddsApiRequestsTable.id))
    .limit(1);
  const failures = await db
    .select({
      requestedAt: oddsApiRequestsTable.requestedAt,
      httpStatus: oddsApiRequestsTable.httpStatus,
      errorMessage: oddsApiRequestsTable.errorMessage,
    })
    .from(oddsApiRequestsTable)
    .where(eq(oddsApiRequestsTable.status, "failed"))
    .orderBy(desc(oddsApiRequestsTable.requestedAt), desc(oddsApiRequestsTable.id))
    .limit(10);
  const requestsMade = Number(counts?.requestsMade ?? 0);
  const failedRequests = Number(counts?.failedRequests ?? 0);
  const requestsToday = Number(counts?.requestsToday ?? 0);
  const requestsThisMonth = Number(counts?.requestsThisMonth ?? 0);
  const remaining =
    latestRequest?.creditsRemaining ??
    latestSuccess?.creditsRemaining ??
    latestFailure?.creditsRemaining ??
    null;
  const stale =
    !latestSuccess ||
    Date.now() - latestSuccess.requestedAt.getTime() > 6 * 60 * 60 * 1000;
  const status = latestSuccess ? (stale ? "stale" : "current") : "unavailable";
  return {
    status,
    detail: latestSuccess
      ? latestSuccess.recordsProcessed > 0
        ? "The last successful capture preserved DraftKings and FanDuel observations. Capture is manual; no polling is enabled."
        : "The last request succeeded but returned no matched sportsbook observations."
      : lastCaptureFailure ?? latestFailure?.errorMessage ?? "No successful Odds API request has been captured.",
    lastUpdated: latestSuccess?.requestedAt ?? null,
    requestsToday,
    requestsThisMonth,
    remainingQuota: remaining === null ? null : `${remaining} credits`,
    metadata: {
      requestsMade,
      failedRequests,
      creditsUsed: latestRequest?.creditsUsed ?? latestSuccess?.creditsUsed ?? latestFailure?.creditsUsed ?? null,
      creditsRemaining: remaining,
      lastRequestAt: latestRequest?.requestedAt?.toISOString() ?? null,
      lastFailure: latestFailure?.errorMessage ?? null,
      failures: failures.map((failure) =>
        `${failure.requestedAt.toISOString()}${failure.httpStatus ? ` HTTP ${failure.httpStatus}` : ""}: ${failure.errorMessage ?? "Unknown provider failure"}`,
      ),
      supportedSportsbooks: [...SUPPORTED_SPORTSBOOKS],
      supportedMarkets: [...SUPPORTED_MARKETS],
      missingMarkets: (latestSuccess?.metadata?.missingMarkets as string[] | undefined) ?? [],
      failedSportsbooks: (latestSuccess?.metadata?.failedSportsbooks as string[] | undefined) ?? [],
    },
  };
}
