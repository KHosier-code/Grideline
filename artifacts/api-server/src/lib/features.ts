import { and, asc, eq } from "drizzle-orm";
import {
  db,
  gamesTable,
  pregameTeamFeaturesTable,
  teamGameStatsTable,
  type PregameFeatureSamples,
  type PregameFeatureValues,
} from "@workspace/db";

export const PREGAME_FEATURE_VERSION = "pregame-v2";
const WINDOWS = [
  { name: "season_to_date", size: Number.POSITIVE_INFINITY, minimum: 3 },
  { name: "last_8", size: 8, minimum: 5 },
  { name: "last_5", size: 5, minimum: 3 },
  { name: "last_3", size: 3, minimum: 3 },
] as const;

const SUPPORTED_METRICS = [
  "epa_per_play",
  "offensive_success_rate",
  "defensive_epa_allowed_per_play",
  "defensive_success_rate",
  "yards_per_play",
  "turnover_rate",
  "explosive_pass_rate",
  "explosive_rush_rate",
  "third_down_conversion_rate",
  "red_zone_touchdown_rate",
  "neutral_script_pass_rate",
] as const;

export const PREGAME_FEATURE_DEFINITION = {
  version: PREGAME_FEATURE_VERSION,
  chronologicalRule: "Only completed team-game rows with kickoffTime strictly before the target kickoff are eligible.",
  windows: WINDOWS.map(({ name, minimum }) => ({ name, minimum })),
  supportedMetrics: [...SUPPORTED_METRICS],
  unsupportedMetrics: [
    "pass_epa_per_dropback",
    "rush_epa_per_rush",
    "passing_success_rate",
    "rushing_success_rate",
    "points_per_drive",
    "points_allowed_per_drive",
    "sack_rate_allowed",
    "defensive_sack_rate",
    "pressure_rate_allowed",
    "defensive_pressure_rate",
    "pace_seconds_per_play",
    "early_down_pass_rate",
    "early_down_success_rate",
  ],
  limitations: [
    "The normalized team-game table does not retain pass/rush attempt denominators, drives, pressure attribution, or play-clock timing.",
    "Unsupported metrics remain explicitly unavailable; they are never imputed from a future game or a proxy field.",
  ],
} as const;

type HistoryRow = typeof teamGameStatsTable.$inferSelect & { kickoffTime: Date };

function average(rows: HistoryRow[], selector: (row: HistoryRow) => number | null): number | null {
  const values = rows.map(selector).filter((value): value is number => value !== null && Number.isFinite(value));
  return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null;
}

function metricValue(row: HistoryRow, metric: (typeof SUPPORTED_METRICS)[number]): number | null {
  switch (metric) {
    case "epa_per_play": return row.epaPerPlay;
    case "offensive_success_rate": return row.offensiveSuccessRate;
    case "defensive_epa_allowed_per_play": return row.defensiveEpaAllowedPerPlay;
    case "defensive_success_rate": return row.defensiveSuccessRate;
    case "yards_per_play": return row.yardsPerPlay;
    case "turnover_rate": return row.plays > 0 ? row.turnovers / row.plays : null;
    case "explosive_pass_rate": return row.explosivePassRate;
    case "explosive_rush_rate": return row.explosiveRushRate;
    case "third_down_conversion_rate": return row.thirdDownRate;
    case "red_zone_touchdown_rate": return row.redZoneRate;
    case "neutral_script_pass_rate": return row.neutralScriptPassRate;
  }
}

function buildFeatures(history: HistoryRow[], season: number): {
  features: PregameFeatureValues;
  sampleCounts: PregameFeatureSamples;
  lowSample: boolean;
} {
  const features: PregameFeatureValues = {};
  const sampleCounts: PregameFeatureSamples = {};
  let lowSample = false;
  for (const window of WINDOWS) {
    const rows = history
      .filter((row) => window.name !== "season_to_date" || row.season === season)
      .slice(0, window.size);
    sampleCounts[`${window.name}.games`] = rows.length;
    if (rows.length < window.minimum) lowSample = true;
    for (const metric of SUPPORTED_METRICS) {
      const values = rows.map((row) => metricValue(row, metric)).filter((value): value is number => value !== null);
      sampleCounts[`${window.name}.${metric}`] = values.length;
      features[`${window.name}.${metric}`] = average(rows, (row) => metricValue(row, metric));
    }
  }
  return { features, sampleCounts, lowSample };
}

export async function rebuildPregameFeatures(featureVersion = PREGAME_FEATURE_VERSION) {
  const stats = await db
    .select()
    .from(teamGameStatsTable)
    .leftJoin(gamesTable, eq(teamGameStatsTable.gameId, gamesTable.gameId))
    .orderBy(asc(teamGameStatsTable.season), asc(teamGameStatsTable.week), asc(teamGameStatsTable.gameId), asc(teamGameStatsTable.teamId));
  const statsByGameTeam = new Map(
    stats.map((item) => [`${item.team_game_stats.gameId}:${item.team_game_stats.teamId}`, item.team_game_stats]),
  );
  const scheduledGames = new Map(
    stats
      .filter((item) => item.games)
      .map((item) => [item.team_game_stats.gameId, item.games]),
  );
  const historicalGames = new Map<string, {
    season: number;
    week: number;
    gameId: string;
    kickoffTime: Date;
    teams: Array<{ teamId: string; opponentTeamId: string; isHome: boolean }>;
  }>();
  for (const item of stats) {
    const stat = item.team_game_stats;
    if (historicalGames.has(stat.gameId)) continue;
    const scheduled = scheduledGames.get(stat.gameId);
    const fallbackDate = stat.gameDate
      ? new Date(`${stat.gameDate}T12:00:00.000Z`)
      : new Date(Date.UTC(stat.season, 0, 1 + Math.max(0, stat.week - 1) * 7, 12));
    historicalGames.set(stat.gameId, {
      season: stat.season,
      week: stat.week,
      gameId: stat.gameId,
      kickoffTime: scheduled?.kickoffTime ?? fallbackDate,
      teams: [],
    });
  }
  for (const game of historicalGames.values()) {
    const gameStats = stats
      .filter((item) => item.team_game_stats.gameId === game.gameId)
      .map((item) => item.team_game_stats);
    for (const stat of gameStats) {
      const scheduled = scheduledGames.get(game.gameId);
      game.teams.push({
        teamId: stat.teamId,
        opponentTeamId: stat.opponentTeamId,
        isHome: scheduled ? scheduled.homeTeamId === stat.teamId : stat.isHome,
      });
    }
  }
  const games = [...historicalGames.values()].sort((left, right) =>
    left.kickoffTime.getTime() - right.kickoffTime.getTime() || left.gameId.localeCompare(right.gameId));
  const historyByTeam = new Map<string, HistoryRow[]>();
  const rows: Array<typeof pregameTeamFeaturesTable.$inferInsert> = [];
  for (const game of games) {
    const kickoff = new Date(game.kickoffTime);
    for (const matchup of game.teams) {
      const team = matchup.teamId;
      const opponent = matchup.opponentTeamId;
      const history = (historyByTeam.get(team) ?? [])
        .filter((item) => item.kickoffTime.getTime() < kickoff.getTime())
        .sort((a, b) => b.kickoffTime.getTime() - a.kickoffTime.getTime());
      const built = buildFeatures(history, game.season);
      rows.push({
        featureVersion,
        gameId: game.gameId,
        teamId: team,
        opponentTeamId: opponent,
        season: game.season,
        week: game.week,
        kickoffTime: kickoff,
        isHome: matchup.isHome,
        features: built.features,
        sampleCounts: built.sampleCounts,
        lowSample: built.lowSample,
        sourceCutoff: new Date(kickoff.getTime() - 1),
        generatedAt: new Date(),
      });
      const source = statsByGameTeam.get(`${game.gameId}:${team}`);
      if (source) {
        const existing = historyByTeam.get(team) ?? [];
        existing.push({ ...source, kickoffTime: kickoff });
        historyByTeam.set(team, existing);
      }
    }
  }
  for (let index = 0; index < rows.length; index += 250) {
    await db.insert(pregameTeamFeaturesTable).values(rows.slice(index, index + 250)).onConflictDoNothing({
      target: [pregameTeamFeaturesTable.featureVersion, pregameTeamFeaturesTable.gameId, pregameTeamFeaturesTable.teamId],
    });
  }
  return {
    featureVersion,
    gamesConsidered: games.length,
    rowsGenerated: rows.length,
    lowSampleRows: rows.filter((row) => row.lowSample).length,
    definition: PREGAME_FEATURE_DEFINITION,
  };
}

export async function getPregameFeatureHealth(featureVersion = PREGAME_FEATURE_VERSION) {
  const rows = await db.select().from(pregameTeamFeaturesTable).where(eq(pregameTeamFeaturesTable.featureVersion, featureVersion));
  const latest = rows.reduce<Date | null>((current, row) => !current || row.generatedAt > current ? row.generatedAt : current, null);
  return {
    featureVersion,
    definition: PREGAME_FEATURE_DEFINITION,
    rows: rows.length,
    games: new Set(rows.map((row) => row.gameId)).size,
    lowSampleRows: rows.filter((row) => row.lowSample).length,
    latestGeneratedAt: latest?.toISOString() ?? null,
  };
}

export async function getPregameFeaturesForGame(gameId: string, featureVersion = PREGAME_FEATURE_VERSION) {
  return db.select().from(pregameTeamFeaturesTable).where(and(
    eq(pregameTeamFeaturesTable.gameId, gameId),
    eq(pregameTeamFeaturesTable.featureVersion, featureVersion),
  ));
}