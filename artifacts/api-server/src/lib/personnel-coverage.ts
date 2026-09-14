import { db, dataSyncRunsTable, gamesTable, oddsApiRequestsTable } from "@workspace/db";
import { getPersonnelContextForGame } from "./personnel-context";
import { coveragePercent, isPregameReadinessGame, isWeatherEligible, latestCoverageAnchor, passesReadinessThreshold } from "./coverage-math";
import { stadiumFor } from "./stadiums";

const REQUIRED_STARTER_SLOT_COUNT = 14;
const INJURY_FRESHNESS_HOURS = 7 * 24;
const SPORTSBOOK_FRESHNESS_HOURS = 24;
const PERSONNEL_FEED_FRESHNESS_HOURS = 7 * 24;
const WEATHER_FEED_FRESHNESS_HOURS = 24;
const CONTEXT_QUERY_CONCURRENCY = 4;
export const READINESS_THRESHOLDS = {
  medianPersonnelCompleteness: 80,
  medianQbCertainty: 70,
  currentInjuryCoverage: 90,
  sportsbookFreshness: 90,
  eligibleWeatherCoverage: 80,
  medianOverallConfidence: 65,
} as const;
export const PRODUCTION_READINESS_CONTROLS = {
  productionSchema: {
    authority: "replit_publish",
    status: "managed_by_replit_publish",
    scope: "tables_columns_indexes",
    migrationLedgerMirrorRequired: false,
  },
  applicationWeatherImmutability: {
    status: "enforced",
    persistenceMode: "insert_only",
    updateDeletePathsAllowed: false,
  },
  pointInTimeLeakageProtection: {
    status: "enforced",
    cutoffRule: "Evidence availability timestamps must be strictly before kickoff; post-cutoff backfills are excluded.",
  },
  unsupportedControlLimitations: [{
    control: "weather_forecast_snapshots_database_append_only_trigger",
    status: "unsupported_by_current_replit_production_migration_path",
    eligibilityImpact: "none",
    requiredAction: "Retain as a future defense-in-depth improvement if Replit supports custom production SQL migrations.",
  }],
} as const;
const REQUIRED_STARTER_POSITIONS = new Set([
  "QB", "RB", "WR", "TE", "LT", "LG", "C", "RG", "RT", "EDGE", "DT", "LB", "CB", "S",
]);

function selectedRequiredSlots<T extends {
  starters: Array<{ position: string | null; classification: string }>;
}>(team: T) {
  const byPosition = new Map<string, T["starters"][number]>();
  for (const starter of team.starters) {
    if (!starter.position || !REQUIRED_STARTER_POSITIONS.has(starter.position)) continue;
    const current = byPosition.get(starter.position);
    const rank = starter.classification === "official" ? 3 : starter.classification === "published_secondary" ? 2 : 1;
    const currentRank = current?.classification === "official" ? 3 : current?.classification === "published_secondary" ? 2 : current ? 1 : 0;
    if (rank > currentRank) byPosition.set(starter.position, starter);
  }
  return [...byPosition.values()];
}

function median(values: number[]) {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

function percentOrZero(numerator: number, denominator: number) {
  return denominator ? coveragePercent(numerator, denominator) : 0;
}

function hoursSince(value: string | null, cutoff: string, now: Date) {
  const timestamp = value ? Date.parse(value) : NaN;
  const cutoffTime = Date.parse(cutoff);
  if (!Number.isFinite(timestamp) || !Number.isFinite(cutoffTime)) return null;
  // Context timestamps are already cutoff-safe; never measure freshness past
  // the point in time represented by the game.
  return Math.max(0, (Math.min(now.getTime(), cutoffTime) - timestamp) / 3_600_000);
}

export function coverageFromContexts(
  contexts: NonNullable<Awaited<ReturnType<typeof getPersonnelContextForGame>>>[],
  now = new Date(),
) {
  const teams = contexts.flatMap((context) => Object.values(context.teams));
  const starters = teams.flatMap((team) => team.starters);
  const requiredSlots = teams.length * REQUIRED_STARTER_SLOT_COUNT;
  const coveredSlots = teams.flatMap(selectedRequiredSlots);
  const published = coveredSlots.filter((starter) => starter.classification !== "inferred");
  const publishedDepthTeams = teams.filter((team) =>
    team.starters.some((starter) =>
      starter.classification === "official" || starter.classification === "published_secondary",
    ),
  );
  const gameCoverage = contexts.map((context) => {
    const injuryTimestamps = Object.values(context.teams)
      .flatMap((team) => team.injuryPlayers.map((injury) => injury.snapshotTimestamp))
      .filter((timestamp): timestamp is string => Boolean(timestamp));
    const latestInjury = injuryTimestamps.sort().at(-1) ?? null;
    const injuryAge = hoursSince(latestInjury, context.sourceCutoff, now);
    const injuryCurrent = injuryAge !== null && injuryAge <= INJURY_FRESHNESS_HOURS;
    const sportsbookAge = context.market.timeSinceLastOddsUpdateHours;
    const sportsbookCurrent = context.market.observations > 0
      && sportsbookAge !== null
      && sportsbookAge <= SPORTSBOOK_FRESHNESS_HOURS;
    const personnelCompleteness = teamsForContext(context).length
      ? teamsForContext(context).reduce((sum, team) => sum + team.personnelCompleteness, 0) / teamsForContext(context).length
      : 0;
    const qbCertainty = teamsForContext(context).length
      ? teamsForContext(context).reduce((sum, team) => sum + team.qb.starterCertainty, 0) / teamsForContext(context).length
      : 0;
    const gameCoveredSlots = teamsForContext(context).flatMap(selectedRequiredSlots);
    const publishedSlots = gameCoveredSlots
      .filter((starter) => starter.classification !== "inferred").length;
    const inferredSlots = gameCoveredSlots
      .filter((starter) => starter.classification === "inferred").length;
    const requiredSlotsForGame = teamsForContext(context).length * REQUIRED_STARTER_SLOT_COUNT;
    // Indoor games do not require an outdoor forecast. A retractable roof is
    // eligible because the game-time roof decision can affect conditions.
    const weatherEligible = isWeatherEligible(context.weather.indoorOutdoor, context.weather.roofStatus);
    const reasons: string[] = [];
    if (!injuryCurrent) reasons.push(latestInjury ? "Latest injury snapshot is stale at the game cutoff." : "No injury rows reported; feed freshness is unavailable.");
    if (!sportsbookCurrent) reasons.push(context.market.observations ? "Sportsbook observations are stale at the game cutoff." : "No sportsbook observations were available.");
    if (!context.weather.available) reasons.push(context.weather.unavailableReason ?? "Weather is unavailable.");
    reasons.push(...Object.values(context.teams).flatMap((team) => team.unavailableReasons));
    if (personnelCompleteness < 80) reasons.push(`Personnel completeness is ${Math.round(personnelCompleteness)}%, below the 80% readiness threshold.`);
    if (qbCertainty < 70) reasons.push(`QB certainty is ${Math.round(qbCertainty)}%, below the 70% readiness threshold.`);
    if (context.dataConfidence.overall < 65) reasons.push(`Overall Data Confidence is ${context.dataConfidence.overall}, below the 65% readiness threshold.`);
    return {
      gameId: context.gameId,
      personnelCompleteness,
      qbCertainty,
      injuryFreshness: context.dataConfidence.components.injuryFreshness,
      injuryCurrent,
      // Retain the short names used by the existing coverage contract.
      injury: injuryCurrent,
      sportsbookFreshness: context.dataConfidence.components.sportsbookFreshness,
      sportsbookCurrent,
      sportsbook: sportsbookCurrent,
      weather: context.weather.available,
      weatherAvailable: context.weather.available,
      weatherEligible,
      sampleQuality: context.dataConfidence.components.sampleQuality,
      overallDataConfidence: context.dataConfidence.overall,
      publishedStarterCoverage: percentOrZero(publishedSlots, requiredSlotsForGame),
      inferredStarterCoverage: percentOrZero(inferredSlots, requiredSlotsForGame),
      latestInjurySnapshot: latestInjury,
      latestSportsbookHours: sportsbookAge,
      confidence: context.dataConfidence.overall,
      below50: context.dataConfidence.overall < 50,
      above70: context.dataConfidence.overall > 70,
      reasons: [...new Set(reasons)],
    };
  });
  const eligibleWeatherGames = gameCoverage.filter((game) => game.weatherEligible);
  return {
    teams: teams.length,
    requiredStarterSlots: requiredSlots,
    observedStarterSlots: coveredSlots.length,
    publishedStarterSlots: published.length,
    inferredStarterSlots: coveredSlots.filter((starter) => starter.classification === "inferred").length,
    teamPublishedDepthPercent: coveragePercent(publishedDepthTeams.length, teams.length),
    starterPublishedPercent: coveragePercent(published.length, requiredSlots),
    starterInferredPercent: coveragePercent(coveredSlots.filter((starter) => starter.classification === "inferred").length, requiredSlots),
    gameWeatherPercent: percentOrZero(gameCoverage.filter((game) => game.weather).length, contexts.length),
    currentInjuryPercent: coveragePercent(gameCoverage.filter((game) => game.injuryCurrent).length, contexts.length),
    currentSportsbookPercent: coveragePercent(gameCoverage.filter((game) => game.sportsbookCurrent).length, contexts.length),
    eligibleWeatherPercent: percentOrZero(eligibleWeatherGames.filter((game) => game.weatherAvailable).length, eligibleWeatherGames.length),
    medianConfidence: median(contexts.map((context) => context.dataConfidence.overall)),
    gameCoverage,
  };
}

function teamsForContext(context: NonNullable<Awaited<ReturnType<typeof getPersonnelContextForGame>>>) {
  return Object.values(context.teams);
}

type ReadinessGame = ReturnType<typeof coverageFromContexts>["gameCoverage"][number] & {
  season: number;
  week: number;
  kickoffTime: string | null;
};

function aggregateTrend(games: ReadinessGame[]) {
  const groups = new Map<string, ReadinessGame[]>();
  for (const game of games) {
    const key = `${game.season}:${game.week}`;
    groups.set(key, [...(groups.get(key) ?? []), game]);
  }
  return [...groups.entries()]
    .map(([key, rows]) => {
      const [season, week] = key.split(":").map(Number);
      const eligibleWeather = rows.filter((row) => row.weatherEligible);
      return {
        season,
        week,
        gameCount: rows.length,
        personnelCoverage: median(rows.map((row) => row.personnelCompleteness)),
        personnelCompleteness: median(rows.map((row) => row.personnelCompleteness)),
        medianQbCertainty: median(rows.map((row) => row.qbCertainty)),
        currentInjuryCoverage: percentOrZero(rows.filter((row) => row.injuryCurrent).length, rows.length),
        injuryCoverage: percentOrZero(rows.filter((row) => row.injuryCurrent).length, rows.length),
        sportsbookFreshness: percentOrZero(rows.filter((row) => row.sportsbookCurrent).length, rows.length),
        sportsbookCoverage: percentOrZero(rows.filter((row) => row.sportsbookCurrent).length, rows.length),
        weatherCoverage: percentOrZero(eligibleWeather.filter((row) => row.weatherAvailable).length, eligibleWeather.length),
        eligibleWeatherGames: eligibleWeather.length,
        medianDataConfidence: median(rows.map((row) => row.overallDataConfidence)),
        gamesBelow50: rows.filter((row) => row.below50).length,
        gamesAbove70: rows.filter((row) => row.above70).length,
        publishedStarterCoverage: median(rows.map((row) => row.publishedStarterCoverage)),
        inferredStarterCoverage: median(rows.map((row) => row.inferredStarterCoverage)),
      };
    })
    .sort((a, b) => a.season - b.season || a.week - b.week);
}

type FeedFamily = "personnel" | "injury" | "sportsbook" | "weather";

/**
 * Feed failure is deliberately bounded and evidence-based: a failed latest
 * persisted run fails the family, while absence of a successful run inside
 * the family window is reported as unknown/failure rather than guessed
 * healthy. This is an evaluation gate, not a feed availability fallback.
 */
async function assessFeedHealth(now: Date) {
  const [runs, oddsRequests] = await Promise.all([
    db.select().from(dataSyncRunsTable),
    db.select().from(oddsApiRequestsTable),
  ]);
  const definitions: Array<{ family: FeedFamily; providers: string[]; freshnessHours: number; label: string }> = [
    { family: "personnel", providers: ["espn-depth-charts", "nflverse"], freshnessHours: PERSONNEL_FEED_FRESHNESS_HOURS, label: "personnel" },
    { family: "injury", providers: ["espn-injuries"], freshnessHours: PERSONNEL_FEED_FRESHNESS_HOURS, label: "injury" },
    { family: "sportsbook", providers: ["odds-api"], freshnessHours: SPORTSBOOK_FRESHNESS_HOURS, label: "sportsbook" },
    { family: "weather", providers: ["nws-weather"], freshnessHours: WEATHER_FEED_FRESHNESS_HOURS, label: "weather" },
  ];
  const assessments = definitions.map((definition) => {
    if (definition.family === "sportsbook") {
      const sorted = [...oddsRequests].sort((a, b) => b.requestedAt.getTime() - a.requestedAt.getTime());
      const latest = sorted[0];
      const latestSuccess = sorted.find((request) => request.status === "success");
      const ageHours = latestSuccess
        ? Math.max(0, (now.getTime() - latestSuccess.requestedAt.getTime()) / 3_600_000)
        : null;
      const latestFailed = latest?.status === "failed";
      const stale = ageHours === null || ageHours > definition.freshnessHours;
      const failed = latestFailed || stale;
      return {
        family: definition.family,
        failed,
        status: failed ? "failed_or_unproven" : "evidenced_current",
        latestRunAt: latest?.requestedAt.toISOString() ?? null,
        latestSuccessfulRunAt: latestSuccess?.requestedAt.toISOString() ?? null,
        freshnessBoundHours: definition.freshnessHours,
        reason: latestFailed
          ? `sportsbook feed latest persisted request failed${latest.errorMessage ? `: ${latest.errorMessage}` : "."}`
          : stale
            ? `No successful sportsbook request is evidenced within the ${definition.freshnessHours}-hour freshness bound.`
            : null,
      };
    }
    const familyRuns = runs
      .filter((run) => definition.providers.includes(run.provider))
      .sort((a, b) => b.startedAt.getTime() - a.startedAt.getTime());
    const latest = familyRuns[0];
    const latestSuccess = familyRuns.find((run) => run.status === "success" && run.completedAt);
    const ageHours = latestSuccess?.completedAt
      ? Math.max(0, (now.getTime() - latestSuccess.completedAt.getTime()) / 3_600_000)
      : null;
    const latestFailed = latest?.status === "failed";
    const stale = ageHours === null || ageHours > definition.freshnessHours;
    const failed = latestFailed || stale;
    const reason = latestFailed
      ? `${definition.label} feed latest persisted run failed${latest.errorMessage ? `: ${latest.errorMessage}` : "."}`
      : stale
        ? `No successful ${definition.label} run is evidenced within the ${definition.freshnessHours}-hour freshness bound.`
        : null;
    return {
      family: definition.family,
      failed,
      status: failed ? "failed_or_unproven" : "evidenced_current",
      latestRunAt: latest?.startedAt.toISOString() ?? null,
      latestSuccessfulRunAt: latestSuccess?.completedAt?.toISOString() ?? null,
      freshnessBoundHours: definition.freshnessHours,
      reason,
    };
  });
  return assessments;
}

async function mapContexts<T>(items: T[], fn: (item: T) => Promise<ReadinessGame | null>, concurrency = 12) {
  const output: ReadinessGame[] = [];
  let next = 0;
  async function worker() {
    while (next < items.length) {
      const index = next++;
      const value = await fn(items[index]);
      if (value) output.push(value);
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, () => worker()));
  return output;
}

export async function getChallengerReadinessReport(now = new Date()) {
  const allGames = await db.select().from(gamesTable);
  const anchor = latestCoverageAnchor(allGames, now);
  if (!anchor) {
    return {
      evaluationOnly: true,
      label: "Evaluation-only; not a performance guarantee or betting confidence.",
      season: null,
      week: null,
      games: [],
      weeklyTrend: [],
      thresholds: [],
      eligible: false,
      systematicSourceFailures: [],
      failureRule: "A latest failed persisted feed run or no successful run within the bounded family freshness window fails the major family.",
      ...PRODUCTION_READINESS_CONTROLS,
    };
  }
  const contextGames = await mapContexts(allGames, async (game) => {
    const context = await getPersonnelContextForGame(game.gameId, now);
    if (!context) return null;
    const [coverage] = coverageFromContexts([context], now).gameCoverage;
    if (!coverage) return null;
    // The persisted forecast row records an unknown roof state for a
    // retractable venue. Resolve eligibility from the immutable schedule
    // venue metadata, without changing the weather evidence itself.
    const stadium = stadiumFor(null, game.stadium);
    const weatherEligible = stadium
      ? stadium.indoorOutdoor === "outdoor" || stadium.retractableRoof === "retractable"
      : coverage.weatherEligible;
    return {
      ...coverage,
      weatherEligible,
      season: game.season,
      week: game.week,
      kickoffTime: game.kickoffTime?.toISOString() ?? null,
    };
  }, CONTEXT_QUERY_CONCURRENCY);
  const currentGames = contextGames.filter((game) =>
    game.season === anchor.season
    && game.week === anchor.week
    && isPregameReadinessGame(
      { kickoffTime: game.kickoffTime ? new Date(game.kickoffTime) : null },
      now,
    ),
  );
  const current = currentGames;
  const values = {
    personnelCompleteness: median(current.map((game) => game.personnelCompleteness)),
    qbCertainty: median(current.map((game) => game.qbCertainty)),
    injuryCoverage: percentOrZero(current.filter((game) => game.injuryCurrent).length, current.length),
    sportsbookFreshness: percentOrZero(current.filter((game) => game.sportsbookCurrent).length, current.length),
    weatherCoverage: percentOrZero(
      current.filter((game) => game.weatherEligible && game.weatherAvailable).length,
      current.filter((game) => game.weatherEligible).length,
    ),
    overallConfidence: median(current.map((game) => game.overallDataConfidence)),
  };
  const feedHealth = await assessFeedHealth(now);
  const thresholds = [
    { metric: "medianPersonnelCompleteness", observed: values.personnelCompleteness, threshold: READINESS_THRESHOLDS.medianPersonnelCompleteness, pass: passesReadinessThreshold(values.personnelCompleteness, READINESS_THRESHOLDS.medianPersonnelCompleteness), interpretation: "Median game personnel completeness must cover at least 80% of required starter positions." },
    { metric: "medianQbCertainty", observed: values.qbCertainty, threshold: READINESS_THRESHOLDS.medianQbCertainty, pass: passesReadinessThreshold(values.qbCertainty, READINESS_THRESHOLDS.medianQbCertainty), interpretation: "Median QB starter certainty must be at least 70%." },
    { metric: "currentInjuryCoverage", observed: values.injuryCoverage, threshold: READINESS_THRESHOLDS.currentInjuryCoverage, pass: values.injuryCoverage >= READINESS_THRESHOLDS.currentInjuryCoverage, interpretation: "At least 90% of selected games must have a current injury snapshot at their cutoff." },
    { metric: "sportsbookFreshness", observed: values.sportsbookFreshness, threshold: READINESS_THRESHOLDS.sportsbookFreshness, pass: values.sportsbookFreshness >= READINESS_THRESHOLDS.sportsbookFreshness, interpretation: "At least 90% of selected games must have current sportsbook observations at cutoff." },
    { metric: "eligibleWeatherCoverage", observed: values.weatherCoverage, threshold: READINESS_THRESHOLDS.eligibleWeatherCoverage, pass: values.weatherCoverage >= READINESS_THRESHOLDS.eligibleWeatherCoverage, interpretation: "At least 80% of eligible outdoor/retractable games must have weather evidence; indoor games are excluded from the denominator." },
    { metric: "medianOverallConfidence", observed: values.overallConfidence, threshold: READINESS_THRESHOLDS.medianOverallConfidence, pass: passesReadinessThreshold(values.overallConfidence, READINESS_THRESHOLDS.medianOverallConfidence), interpretation: "Median non-betting Data Confidence must be at least 65." },
    { metric: "noSystematicSourceFailure", observed: feedHealth.every((feed) => !feed.failed), threshold: true, pass: feedHealth.every((feed) => !feed.failed), interpretation: "No persisted feed health/run evidence may show a bounded failure affecting a major feature family." },
  ];
  return {
    evaluationOnly: true,
    label: "Evaluation-only; not a performance guarantee; not betting confidence.",
    season: anchor.season,
    week: anchor.week,
    games: current,
    weeklyTrend: aggregateTrend(contextGames),
    thresholds,
    eligible: thresholds.every((threshold) => threshold.pass),
    systematicSourceFailures: feedHealth.filter((feed) => feed.failed),
    failureRule: "A latest failed persisted feed run or no successful run within the bounded family freshness window fails the major family. Windows: personnel/injury 168 hours; sportsbook/weather 24 hours.",
    ...PRODUCTION_READINESS_CONTROLS,
  };
}

export async function getCurrentPersonnelCoverage(now = new Date()) {
  const allGames = await db.select().from(gamesTable);
  const anchor = latestCoverageAnchor(allGames, now);
  if (!anchor) {
    return {
      season: null, week: null, games: 0, teams: 0, requiredStarterSlots: 0,
      observedStarterSlots: 0, publishedStarterSlots: 0, inferredStarterSlots: 0,
      teamPublishedDepthPercent: 0, starterPublishedPercent: 0, starterInferredPercent: 0,
      gameWeatherPercent: 0, currentInjuryPercent: 0, currentSportsbookPercent: 0,
      medianConfidence: null, lowestConfidenceGames: [], gameCoverage: [], sourceAssessments: [],
      weather: { source: "National Weather Service api.weather.gov", cost: "Free, keyless open data" },
    };
  }
  // Always use the complete slate for the selected season/week, including
  // games that have already kicked off.
  const games = allGames.filter((game) => game.season === anchor.season && game.week === anchor.week);
  const contexts = (await mapContexts(games, (game) => getPersonnelContextForGame(game.gameId, now), CONTEXT_QUERY_CONCURRENCY))
    .filter((context): context is NonNullable<typeof context> => Boolean(context));
  const metrics = coverageFromContexts(contexts, now);
  return {
    season: anchor.season,
    week: anchor.week,
    games: games.length,
    ...metrics,
    lowestConfidenceGames: [...metrics.gameCoverage].sort((a, b) => a.confidence - b.confidence).slice(0, 5),
    sourceAssessments: [
      { source: "verified official/published depth", classification: "official_or_published", permitted: "Only when explicitly sourced and permitted; no unsupported source claimed." },
      { source: "ESPN depth-chart endpoint", classification: "published_secondary", permitted: "Existing best-effort structured endpoint; terms status is not verified for production reuse." },
      { source: "nflverse snap counts/participation", classification: "inferred", permitted: true, hierarchyRank: 3 },
      { source: "nflverse historical depth charts", classification: "inferred", permitted: true, hierarchyRank: 4 },
      { source: "Ourlads", permitted: false, reason: "Automated access prohibited by terms." },
      { source: "NFL.com and official team HTML", permitted: false, reason: "Systematic retrieval requires written consent." },
    ],
    weather: {
      source: "National Weather Service api.weather.gov",
      cost: "Free, keyless open data; reasonable rate limits",
      requestPolicy: "At most one cached points request and one cached forecast request per unique stadium per run.",
    },
  };
}