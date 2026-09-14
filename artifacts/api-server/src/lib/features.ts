import { and, asc, eq } from "drizzle-orm";
import {
  db,
  gamesTable,
  qbGameStatsTable,
  pregameTeamFeaturesTable,
  teamGameStatsTable,
  type PregameFeatureSamples,
  type PregameFeatureAuditEntry,
  type PregameFeatureValues,
} from "@workspace/db";

export const PREGAME_FEATURE_VERSION = "pregame-v3";
const WINDOWS = [
  { name: "season_to_date", size: Number.POSITIVE_INFINITY, minimum: 3 },
  { name: "last_8", size: 8, minimum: 5 },
  { name: "last_5", size: 5, minimum: 3 },
  { name: "last_3", size: 3, minimum: 3 },
] as const;

const SUPPORTED_METRICS = [
  "epa_per_play",
  "opponent_adjusted_epa_per_play",
  "pass_epa_per_dropback",
  "rush_epa_per_rush",
  "offensive_success_rate",
  "passing_success_rate",
  "rushing_success_rate",
  "defensive_epa_allowed_per_play",
  "defensive_success_rate",
  "yards_per_play",
  "turnover_rate",
  "sack_rate_allowed",
  "early_down_epa_per_play",
  "early_down_pass_rate",
  "early_down_success_rate",
  "seconds_per_play",
  "explosive_pass_rate",
  "explosive_rush_rate",
  "pass_epa_allowed",
  "rush_epa_allowed",
  "pass_success_rate_allowed",
  "rush_success_rate_allowed",
  "defensive_sack_rate",
  "early_down_defensive_epa",
  "explosive_pass_rate_allowed",
  "explosive_rush_rate_allowed",
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
    "points_per_drive",
    "points_allowed_per_drive",
    "pressure_rate_allowed",
    "defensive_pressure_rate",
  ],
  limitations: [
    "Drive-level points-per-drive and true pressure-rate attribution remain unavailable in the current normalized sources.",
    "Unsupported metrics remain explicitly unavailable; they are never imputed from a future game or a proxy field.",
  ],
} as const;

type HistoryRow = typeof teamGameStatsTable.$inferSelect & { kickoffTime: Date };
type QbHistoryRow = typeof qbGameStatsTable.$inferSelect & { kickoffTime: Date; primary: boolean };
type FeatureBuild = {
  features: PregameFeatureValues;
  sampleCounts: PregameFeatureSamples;
  featureAudit: Record<string, PregameFeatureAuditEntry>;
  lowSample: boolean;
};

function average(rows: HistoryRow[], selector: (row: HistoryRow) => number | null): number | null {
  const values = rows.map(selector).filter((value): value is number => value !== null && Number.isFinite(value));
  return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null;
}

function metricValue(row: HistoryRow, metric: (typeof SUPPORTED_METRICS)[number]): number | null {
  switch (metric) {
    case "epa_per_play": return row.epaPerPlay;
    case "pass_epa_per_dropback": return row.passEpaPerDropback;
    case "rush_epa_per_rush": return row.rushEpaPerRush;
    case "offensive_success_rate": return row.offensiveSuccessRate;
    case "passing_success_rate": return row.passingSuccessRate;
    case "rushing_success_rate": return row.rushingSuccessRate;
    case "defensive_epa_allowed_per_play": return row.defensiveEpaAllowedPerPlay;
    case "defensive_success_rate": return row.defensiveSuccessRate;
    case "yards_per_play": return row.yardsPerPlay;
    case "turnover_rate": return row.plays > 0 ? row.turnovers / row.plays : null;
    case "sack_rate_allowed": return row.sackRateAllowed;
    case "early_down_epa_per_play": return row.earlyDownEpaPerPlay;
    case "early_down_pass_rate": return row.earlyDownPassRate;
    case "early_down_success_rate": return row.earlyDownSuccessRate;
    case "seconds_per_play": return row.secondsPerPlay;
    case "explosive_pass_rate": return row.explosivePassRate;
    case "explosive_rush_rate": return row.explosiveRushRate;
    case "pass_epa_allowed": return row.passEpaAllowed;
    case "rush_epa_allowed": return row.rushEpaAllowed;
    case "pass_success_rate_allowed": return row.passSuccessRateAllowed;
    case "rush_success_rate_allowed": return row.rushSuccessRateAllowed;
    case "defensive_sack_rate": return row.defensiveSackRate;
    case "early_down_defensive_epa": return row.earlyDownDefensiveEpa;
    case "explosive_pass_rate_allowed": return row.explosivePassRateAllowed;
    case "explosive_rush_rate_allowed": return row.explosiveRushRateAllowed;
    case "third_down_conversion_rate": return row.thirdDownRate;
    case "red_zone_touchdown_rate": return row.redZoneRate;
    case "neutral_script_pass_rate": return row.neutralScriptPassRate;
    default: return null;
  }
}

function buildFeatures(history: HistoryRow[], season: number): FeatureBuild {
  const features: PregameFeatureValues = {};
  const sampleCounts: PregameFeatureSamples = {};
  const featureAudit: Record<string, PregameFeatureAuditEntry> = {};
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
      const value = average(rows, (row) => metricValue(row, metric));
      const quality = values.length >= window.minimum ? "high" : "low_sample";
      features[`${window.name}.${metric}`] = value;
      featureAudit[`${window.name}.${metric}`] = {
        value,
        sourceDataset: "nflverse_pbp",
        lookbackWindow: window.name,
        gamesIncluded: rows.length,
        lastSourceGame: rows[0]?.gameId ?? null,
        lastSourceDate: rows[0]?.gameDate ?? null,
        sampleSize: values.length,
        quality,
      };
    }
    for (const metric of PREGAME_FEATURE_DEFINITION.unsupportedMetrics) {
      featureAudit[`${window.name}.${metric}`] = {
        value: null,
        sourceDataset: "nflverse_pbp",
        lookbackWindow: window.name,
        gamesIncluded: rows.length,
        lastSourceGame: rows[0]?.gameId ?? null,
        lastSourceDate: rows[0]?.gameDate ?? null,
        sampleSize: 0,
        quality: "unavailable",
        unavailableReason: "The current normalized sources do not provide a reliable denominator or drive-level attribution.",
      };
    }
  }
  return { features, sampleCounts, featureAudit, lowSample };
}

function addOpponentAdjustedFeatures(build: FeatureBuild, history: HistoryRow[], opponentHistory: HistoryRow[], season: number) {
  for (const window of WINDOWS) {
    const teamRows = history.filter((row) => window.name !== "season_to_date" || row.season === season).slice(0, window.size);
    const opponentRows = opponentHistory.filter((row) => window.name !== "season_to_date" || row.season === season).slice(0, window.size);
    const teamEpa = average(teamRows, (row) => row.epaPerPlay);
    const opponentDefense = average(opponentRows, (row) => row.defensiveEpaAllowedPerPlay);
    const values = [teamEpa, opponentDefense].every((value) => value !== null)
      ? teamEpa! - opponentDefense!
      : null;
    const sampleSize = Math.min(
      teamRows.filter((row) => row.epaPerPlay !== null).length,
      opponentRows.filter((row) => row.defensiveEpaAllowedPerPlay !== null).length,
    );
    const key = `${window.name}.opponent_adjusted_epa_per_play`;
    build.features[key] = values;
    build.sampleCounts[key] = sampleSize;
    build.featureAudit[key] = {
      value: values,
      sourceDataset: "nflverse_pbp",
      lookbackWindow: window.name,
      gamesIncluded: Math.min(teamRows.length, opponentRows.length),
      lastSourceGame: teamRows[0]?.gameId ?? null,
      lastSourceDate: teamRows[0]?.gameDate ?? null,
      sampleSize,
      quality: sampleSize >= window.minimum ? "high" : "low_sample",
      unavailableReason: values === null ? "Prior team and opponent defensive samples are not both available." : undefined,
    };
    if (sampleSize < window.minimum) build.lowSample = true;
  }
}

function addQbFeatures(build: FeatureBuild, history: QbHistoryRow[]) {
  const recent = history
    .filter((row) => row.primary)
    .sort((left, right) => right.kickoffTime.getTime() - left.kickoffTime.getTime())
    .slice(0, 5);
  const games = recent.length;
  const totals = recent.reduce((result, row) => ({
    dropbacks: result.dropbacks + row.dropbacks,
    passEpa: result.passEpa + row.passEpa,
    passAttempts: result.passAttempts + row.passAttempts,
    passSuccesses: result.passSuccesses + row.passSuccesses,
    interceptions: result.interceptions + row.interceptions,
    sacks: result.sacks + row.sacks,
    rushAttempts: result.rushAttempts + row.rushAttempts,
    rushEpa: result.rushEpa + row.rushEpa,
  }), { dropbacks: 0, passAttempts: 0, passEpa: 0, passSuccesses: 0, interceptions: 0, sacks: 0, rushAttempts: 0, rushEpa: 0 });
  const values: Record<string, number | null> = {
    "qb.epa_per_dropback_last_5": games ? totals.passEpa / Math.max(1, totals.dropbacks) : null,
    "qb.passing_success_rate_last_5": games ? totals.passSuccesses / Math.max(1, totals.dropbacks) : null,
    "qb.interception_rate_last_5": games ? totals.interceptions / Math.max(1, totals.passAttempts) : null,
    "qb.sack_rate_last_5": games ? totals.sacks / Math.max(1, totals.dropbacks) : null,
    "qb.rushing_epa_per_attempt_last_5": totals.rushAttempts ? totals.rushEpa / totals.rushAttempts : null,
    "qb.recent_start_count": games,
    "qb.qb_continuity_indicator": games >= 2 && recent[0].playerId === recent[1].playerId ? 1 : games >= 2 ? 0 : null,
    "qb.starter_change_indicator": games >= 2 && recent[0].playerId !== recent[1].playerId ? 1 : games >= 2 ? 0 : null,
    "qb_data_confidence": games >= 3 ? 1 : games > 0 ? 0.5 : null,
  };
  for (const [key, value] of Object.entries(values)) {
    const sampleSize = games;
    build.features[key] = value;
    build.sampleCounts[key] = sampleSize;
    build.featureAudit[key] = {
      value,
      sourceDataset: "nflverse_pbp",
      lookbackWindow: "prior_primary_qb_games_last_5",
      gamesIncluded: games,
      lastSourceGame: recent[0]?.gameId ?? null,
      lastSourceDate: null,
      sampleSize,
      quality: games >= 3 ? "high" : games ? "low_sample" : "unavailable",
      ...(games ? {} : { unavailableReason: "No prior quarterback participation evidence was available." }),
    };
  }
}

export function buildPregameFeaturesForTesting(input: {
  season: number;
  targetKickoff: Date;
  teamRows: HistoryRow[];
  opponentRows?: HistoryRow[];
  qbRows?: QbHistoryRow[];
}) {
  const history = input.teamRows
    .filter((row) => row.kickoffTime.getTime() < input.targetKickoff.getTime())
    .sort((left, right) => right.kickoffTime.getTime() - left.kickoffTime.getTime() || right.gameId.localeCompare(left.gameId));
  const build = buildFeatures(history, input.season);
  addOpponentAdjustedFeatures(build, history, input.opponentRows ?? [], input.season);
  addQbFeatures(build, (input.qbRows ?? []).filter((row) => row.kickoffTime.getTime() < input.targetKickoff.getTime()));
  return {
    ...build,
    eligibleGameIds: history.map((row) => row.gameId),
    sourceCutoff: new Date(input.targetKickoff.getTime() - 1),
  };
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
  const qbStats = await db.select().from(qbGameStatsTable);
  const qbsByGame = new Map<string, typeof qbStats>();
  for (const qb of qbStats) qbsByGame.set(qb.gameId, [...(qbsByGame.get(qb.gameId) ?? []), qb]);
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
  const qbHistoryByTeam = new Map<string, QbHistoryRow[]>();
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
      addOpponentAdjustedFeatures(built, history, historyByTeam.get(opponent) ?? [], game.season);
      const priorQbs = (qbHistoryByTeam.get(team) ?? []).filter((item) => item.kickoffTime.getTime() < kickoff.getTime());
      addQbFeatures(built, priorQbs);
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
        featureAudit: built.featureAudit,
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
      const currentQbs = (qbsByGame.get(game.gameId) ?? []).filter((item) => item.teamId === team);
      const primaryDropbacks = Math.max(...currentQbs.map((item) => item.dropbacks), 0);
      const qbHistory = qbHistoryByTeam.get(team) ?? [];
      qbHistory.push(...currentQbs.map((item) => ({
        ...item,
        kickoffTime: kickoff,
        primary: item.dropbacks === primaryDropbacks && primaryDropbacks > 0,
      })));
      qbHistoryByTeam.set(team, qbHistory);
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

export async function listPregameFeatureAudit(filters: {
  season?: number;
  week?: number;
  gameId?: string;
  teamId?: string;
  featureVersion?: string;
}) {
  const version = filters.featureVersion || PREGAME_FEATURE_VERSION;
  const rows = await db.select().from(pregameTeamFeaturesTable).where(eq(pregameTeamFeaturesTable.featureVersion, version));
  return rows
    .filter((row) => filters.season === undefined || row.season === filters.season)
    .filter((row) => filters.week === undefined || row.week === filters.week)
    .filter((row) => !filters.gameId || row.gameId === filters.gameId)
    .filter((row) => !filters.teamId || row.teamId === filters.teamId)
    .flatMap((row) => Object.entries(row.featureAudit).map(([featureName, audit]) => ({
      featureVersion: row.featureVersion,
      gameId: row.gameId,
      teamId: row.teamId,
      opponentTeamId: row.opponentTeamId,
      season: row.season,
      week: row.week,
      kickoffTime: row.kickoffTime.toISOString(),
      featureName,
      ...audit,
    })));
}