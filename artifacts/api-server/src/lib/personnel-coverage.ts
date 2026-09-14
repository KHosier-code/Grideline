import { db, gamesTable } from "@workspace/db";
import { getPersonnelContextForGame } from "./personnel-context";
import { coveragePercent, latestCoverageAnchor } from "./coverage-math";

const REQUIRED_STARTER_SLOT_COUNT = 14;
const INJURY_FRESHNESS_HOURS = 7 * 24;
const SPORTSBOOK_FRESHNESS_HOURS = 24;
const REQUIRED_STARTER_POSITIONS = new Set([
  "QB", "RB", "WR", "TE", "LT", "LG", "C", "RG", "RT", "EDGE", "DT", "LB", "CB", "S",
]);

function median(values: number[]) {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
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
  const coveredSlots = teams.flatMap((team) => {
    const byPosition = new Map<string, typeof team.starters[number]>();
    for (const starter of team.starters) {
      if (!starter.position || !REQUIRED_STARTER_POSITIONS.has(starter.position)) continue;
      const current = byPosition.get(starter.position);
      const rank = starter.classification === "official" ? 3 : starter.classification === "published_secondary" ? 2 : 1;
      const currentRank = current?.classification === "official" ? 3 : current?.classification === "published_secondary" ? 2 : current ? 1 : 0;
      if (rank > currentRank) byPosition.set(starter.position, starter);
    }
    return [...byPosition.values()];
  });
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
    const reasons: string[] = [];
    if (!injuryCurrent) reasons.push(latestInjury ? "Latest injury snapshot is stale at the game cutoff." : "No injury rows reported; feed freshness is unavailable.");
    if (!sportsbookCurrent) reasons.push(context.market.observations ? "Sportsbook observations are stale at the game cutoff." : "No sportsbook observations were available.");
    if (!context.weather.available) reasons.push(context.weather.unavailableReason ?? "Weather is unavailable.");
    reasons.push(...Object.values(context.teams).flatMap((team) => team.unavailableReasons));
    return {
      gameId: context.gameId,
      weather: context.weather.available,
      injury: injuryCurrent,
      sportsbook: sportsbookCurrent,
      latestInjurySnapshot: latestInjury,
      latestSportsbookHours: sportsbookAge,
      confidence: context.dataConfidence.overall,
      reasons: [...new Set(reasons)],
    };
  });
  return {
    teams: teams.length,
    requiredStarterSlots: requiredSlots,
    observedStarterSlots: coveredSlots.length,
    publishedStarterSlots: published.length,
    inferredStarterSlots: coveredSlots.filter((starter) => starter.classification === "inferred").length,
    teamPublishedDepthPercent: coveragePercent(publishedDepthTeams.length, teams.length),
    starterPublishedPercent: coveragePercent(published.length, requiredSlots),
    starterInferredPercent: coveragePercent(coveredSlots.filter((starter) => starter.classification === "inferred").length, requiredSlots),
    gameWeatherPercent: coveragePercent(gameCoverage.filter((game) => game.weather).length, contexts.length),
    currentInjuryPercent: coveragePercent(gameCoverage.filter((game) => game.injury).length, contexts.length),
    currentSportsbookPercent: coveragePercent(gameCoverage.filter((game) => game.sportsbook).length, contexts.length),
    medianConfidence: median(contexts.map((context) => context.dataConfidence.overall)),
    gameCoverage,
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
  const contexts = (await Promise.all(games.map((game) => getPersonnelContextForGame(game.gameId, now))))
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