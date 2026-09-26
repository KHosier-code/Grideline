import { and, desc, eq, gte, inArray, lte } from "drizzle-orm";
import {
  dataSyncRunsTable,
  db,
  gamesTable,
  nflverseSourceFilesTable,
  playerGameStatsTable,
  teamGameStatsTable,
  teamsTable,
} from "@workspace/db";
import {
  buildPlayerProjectionScheduleFromTeamGames,
  canonicalProjectionTeam,
  hash,
  hashSortedPlayerProjectionInputs,
  prepareIndependentProjectionSchedule,
  reconcilePlayerProjectionRows,
  reconcilePlayerProjectionTeamGames,
  runIndependentPlayerProjectionValidation,
  runPlayerProjectionEvaluation,
  type FrozenPlayerProjectionBaseline,
  type IndependentPlayerProjectionReport,
  type PlayerProjectionRawTeamGame,
  type PlayerProjectionScheduleGame,
  type PlayerProjectionSourceStat,
  type PlayerProjectionTeam,
} from "./player-projections";

const SEASONS = [2021, 2022, 2023, 2024] as const;

export async function runDevelopmentPlayerProjectionBaseline(generatedAt = new Date()) {
  const [sourceStats, sourceSchedule, sourceTeamGames, sourceTeams] = await Promise.all([
    db.select({
      playerId: playerGameStatsTable.playerId,
      playerName: playerGameStatsTable.playerName,
      position: playerGameStatsTable.position,
      teamId: playerGameStatsTable.teamId,
      opponentTeamId: playerGameStatsTable.opponentTeamId,
      season: playerGameStatsTable.season,
      week: playerGameStatsTable.week,
      seasonType: playerGameStatsTable.seasonType,
      passingYards: playerGameStatsTable.passingYards,
      rushingYards: playerGameStatsTable.rushingYards,
      receivingYards: playerGameStatsTable.receivingYards,
      receptions: playerGameStatsTable.receptions,
      passAttempts: playerGameStatsTable.attempts,
      carries: playerGameStatsTable.carries,
      targets: playerGameStatsTable.targets,
    }).from(playerGameStatsTable).where(and(
      gte(playerGameStatsTable.season, 2021),
      lte(playerGameStatsTable.season, 2024),
      eq(playerGameStatsTable.seasonType, "REG"),
      inArray(playerGameStatsTable.position, ["QB", "RB", "WR", "TE"]),
    )),
    db.select({
      gameId: gamesTable.gameId,
      season: gamesTable.season,
      week: gamesTable.week,
      kickoffTime: gamesTable.kickoffTime,
      gameDate: gamesTable.gameDate,
      status: gamesTable.gameStatus,
      homeTeamId: gamesTable.homeTeamId,
      awayTeamId: gamesTable.awayTeamId,
      finalHomeScore: gamesTable.finalHomeScore,
      finalAwayScore: gamesTable.finalAwayScore,
    }).from(gamesTable).where(and(
      gte(gamesTable.season, 2021),
      lte(gamesTable.season, 2024),
    )),
    db.select({
      season: teamGameStatsTable.season,
      week: teamGameStatsTable.week,
      gameId: teamGameStatsTable.gameId,
      teamId: teamGameStatsTable.teamId,
      opponentTeamId: teamGameStatsTable.opponentTeamId,
      passAttempts: teamGameStatsTable.passAttempts,
      rushAttempts: teamGameStatsTable.rushAttempts,
      defensiveEpaAllowedPerPlay: teamGameStatsTable.defensiveEpaAllowedPerPlay,
      gameDate: teamGameStatsTable.gameDate,
      isHome: teamGameStatsTable.isHome,
    }).from(teamGameStatsTable).where(and(
      gte(teamGameStatsTable.season, 2021),
      lte(teamGameStatsTable.season, 2024),
    )),
    db.select({
      teamId: teamsTable.teamId,
      abbreviation: teamsTable.abbreviation,
    }).from(teamsTable),
  ]);

  const stats = sourceStats as PlayerProjectionSourceStat[];
  const schedule = sourceSchedule as PlayerProjectionScheduleGame[];
  const teamGames = sourceTeamGames as PlayerProjectionRawTeamGame[];
  const teams = sourceTeams as PlayerProjectionTeam[];
  const effectiveSchedule = schedule.length
    ? schedule
    : buildPlayerProjectionScheduleFromTeamGames({ teamGames, teams });
  const scheduleTimeMode = schedule.length
    ? schedule.every((game) => game.kickoffTime !== null)
      ? "schedule_kickoff" as const
      : "calendar_date_boundary" as const
    : "team_game_calendar_date_fallback" as const;
  const reconciled = reconcilePlayerProjectionRows({ stats, schedule: effectiveSchedule, teams });
  const reconciledTeamGames = reconcilePlayerProjectionTeamGames({ teamGames, schedule: effectiveSchedule, teams });
  const finalMatchedGames = new Set(reconciled.rows.map((row) => row.gameId));
  const seasonCoverage = Object.fromEntries(SEASONS.map((season) => [
    String(season),
    reconciled.rows.filter((row) => row.season === season).length,
  ]));
  const checksumSha256 = hash(JSON.stringify({
    stats,
    schedule,
    teamGames,
    teams,
  }));
  const report = runPlayerProjectionEvaluation({
    observations: reconciled.rows,
    teamGames: reconciledTeamGames,
    generatedAt,
    provenance: {
      databaseScope: "development",
      sourceDatasets: [
        "player_game_stats (nflverse, regular season, 2021–2024)",
        schedule.length
          ? "games (schedule, canonical team matchup and scheduled-kickoff reconciliation)"
          : "team_game_stats game dates used as a conservative calendar-date schedule fallback; all same-day evidence withheld",
        "team_game_stats (lagged team pass-rate and opponent defensive context where available)",
        "teams (schedule-ID to abbreviation mapping)",
      ],
      rawPlayerStatRows: stats.length,
      reconciledPlayerGameRows: reconciled.rows.length,
      teamGameRows: reconciledTeamGames.length,
      scheduleGames: effectiveSchedule.length,
      scheduleTimeMode,
      matchedScheduleGames: finalMatchedGames.size,
      unmatchedPlayerStatRows: reconciled.excludedUnmatchedOrAmbiguousPlayerRows,
      excludedNonFinalScheduleRows: reconciled.excludedNonFinalScheduleRows,
      excludedUnmatchedOrAmbiguousPlayerRows: reconciled.excludedUnmatchedOrAmbiguousPlayerRows,
      seasonCoverage,
      checksumSha256,
    },
  });
  return report;
}

const INDEPENDENT_SEASONS = [2021, 2022, 2023, 2024, 2025, 2026] as const;
const FINAL_STATUS = /final|complete/i;
const SCHEDULE_RECOVERY_JOB_KEYS = [
  "development-historical-schedule-recovery",
  "development-historical-schedule-week3-atl-gb",
] as const;

function explicitFinal(game: PlayerProjectionScheduleGame) {
  return FINAL_STATUS.test(game.status);
}

export async function runDevelopmentPlayerProjectionIndependentValidation(input: {
  baseline: FrozenPlayerProjectionBaseline;
  baselineReportSha256: string;
  generatedAt?: Date;
}): Promise<IndependentPlayerProjectionReport> {
  const [sourceStats, sourceSchedule, sourceTeamGames, sourceTeams, statSourceFiles, scheduleRecoveryRuns] = await Promise.all([
    db.select({
      playerId: playerGameStatsTable.playerId,
      playerName: playerGameStatsTable.playerName,
      position: playerGameStatsTable.position,
      teamId: playerGameStatsTable.teamId,
      opponentTeamId: playerGameStatsTable.opponentTeamId,
      season: playerGameStatsTable.season,
      week: playerGameStatsTable.week,
      seasonType: playerGameStatsTable.seasonType,
      passingYards: playerGameStatsTable.passingYards,
      rushingYards: playerGameStatsTable.rushingYards,
      receivingYards: playerGameStatsTable.receivingYards,
      receptions: playerGameStatsTable.receptions,
      passAttempts: playerGameStatsTable.attempts,
      carries: playerGameStatsTable.carries,
      targets: playerGameStatsTable.targets,
    }).from(playerGameStatsTable).where(and(
      gte(playerGameStatsTable.season, 2021),
      lte(playerGameStatsTable.season, 2026),
      eq(playerGameStatsTable.seasonType, "REG"),
      inArray(playerGameStatsTable.position, ["QB", "RB", "WR", "TE"]),
    )),
    db.select({
      gameId: gamesTable.gameId,
      season: gamesTable.season,
      week: gamesTable.week,
      kickoffTime: gamesTable.kickoffTime,
      gameDate: gamesTable.gameDate,
      status: gamesTable.gameStatus,
      homeTeamId: gamesTable.homeTeamId,
      awayTeamId: gamesTable.awayTeamId,
      finalHomeScore: gamesTable.finalHomeScore,
      finalAwayScore: gamesTable.finalAwayScore,
    }).from(gamesTable).where(and(
      gte(gamesTable.season, 2021),
      lte(gamesTable.season, 2026),
    )),
    db.select({
      season: teamGameStatsTable.season,
      week: teamGameStatsTable.week,
      gameId: teamGameStatsTable.gameId,
      teamId: teamGameStatsTable.teamId,
      opponentTeamId: teamGameStatsTable.opponentTeamId,
      passAttempts: teamGameStatsTable.passAttempts,
      rushAttempts: teamGameStatsTable.rushAttempts,
      defensiveEpaAllowedPerPlay: teamGameStatsTable.defensiveEpaAllowedPerPlay,
      gameDate: teamGameStatsTable.gameDate,
      isHome: teamGameStatsTable.isHome,
    }).from(teamGameStatsTable).where(and(
      gte(teamGameStatsTable.season, 2021),
      lte(teamGameStatsTable.season, 2026),
    )),
    db.select({
      teamId: teamsTable.teamId,
      abbreviation: teamsTable.abbreviation,
    }).from(teamsTable),
    db.select({
      season: nflverseSourceFilesTable.season,
      sourceUrl: nflverseSourceFilesTable.sourceUrl,
      status: nflverseSourceFilesTable.status,
      rowsProcessed: nflverseSourceFilesTable.rowsProcessed,
      fileSizeBytes: nflverseSourceFilesTable.fileSizeBytes,
      completedAt: nflverseSourceFilesTable.completedAt,
    }).from(nflverseSourceFilesTable).where(and(
      eq(nflverseSourceFilesTable.dataset, "player_stats"),
      inArray(nflverseSourceFilesTable.season, [2025, 2026]),
    )),
    db.select({
      id: dataSyncRunsTable.id,
      jobKey: dataSyncRunsTable.jobKey,
      status: dataSyncRunsTable.status,
      recordsProcessed: dataSyncRunsTable.recordsProcessed,
      completedAt: dataSyncRunsTable.completedAt,
    }).from(dataSyncRunsTable)
      .where(and(
        eq(dataSyncRunsTable.provider, "espn-schedule"),
        inArray(dataSyncRunsTable.jobKey, [...SCHEDULE_RECOVERY_JOB_KEYS]),
      ))
      .orderBy(desc(dataSyncRunsTable.startedAt), desc(dataSyncRunsTable.id)),
  ]);

  const stats = sourceStats as PlayerProjectionSourceStat[];
  const schedule = sourceSchedule as PlayerProjectionScheduleGame[];
  const teamGames = sourceTeamGames as PlayerProjectionRawTeamGame[];
  const teams = sourceTeams as PlayerProjectionTeam[];
  for (const season of [2025, 2026]) {
    if (!stats.some((row) => row.season === season)) {
      throw new Error(`Independent validation requires authentic ${season} player-stat rows in the development database`);
    }
    if (!schedule.some((game) => game.season === season && explicitFinal(game))) {
      throw new Error(`Independent validation requires at least one explicitly final ${season} schedule game`);
    }
  }
  const abbreviationByTeamId = new Map(teams.map((team) => [team.teamId, canonicalProjectionTeam(team.abbreviation)]));
  const finalNewSeasonGames = schedule.filter((game) => game.season >= 2025 && explicitFinal(game));
  for (const stat of stats.filter((row) => row.season >= 2025)) {
    const team = canonicalProjectionTeam(stat.teamId);
    const opponent = canonicalProjectionTeam(stat.opponentTeamId);
    if (!team || !opponent) continue;
    const matchingFinal = finalNewSeasonGames.filter((game) => {
      const home = abbreviationByTeamId.get(game.homeTeamId);
      const away = abbreviationByTeamId.get(game.awayTeamId);
      return game.season === stat.season && game.week === stat.week
        && ((home === team && away === opponent) || (home === opponent && away === team));
    });
    if (matchingFinal.length > 1) {
      throw new Error(`Scored ${stat.season} player row has an ambiguous final schedule matchup (${stat.teamId} / ${stat.opponentTeamId}, week ${stat.week})`);
    }
    if (matchingFinal.length === 1
      && (!matchingFinal[0]!.kickoffTime || !Number.isFinite(matchingFinal[0]!.kickoffTime.getTime()))) {
      throw new Error(`Scored ${stat.season} player row matches a final schedule game without a UTC kickoff (${stat.teamId} / ${stat.opponentTeamId}, week ${stat.week})`);
    }
  }

  // Preserve the original baseline's 2021–2024 date-only fallback, but never
  // infer finality or kickoff times for the independent 2025–2026 holdouts.
  const historicalFallback = buildPlayerProjectionScheduleFromTeamGames({
    teamGames: teamGames.filter((row) => row.season <= 2024),
    teams,
  });
  const officialHistoricalSeasons = new Set(schedule.filter((game) => game.season <= 2024).map((game) => game.season));
  const effectiveSchedule = [
    ...schedule.filter((game) => game.season >= 2025 || officialHistoricalSeasons.has(game.season)),
    ...historicalFallback.filter((game) => !officialHistoricalSeasons.has(game.season)),
  ];
  const strictSchedule = prepareIndependentProjectionSchedule(effectiveSchedule);
  const reconciled = reconcilePlayerProjectionRows({ stats, schedule: strictSchedule, teams });
  const reconciledTeamGames = reconcilePlayerProjectionTeamGames({
    teamGames,
    schedule: strictSchedule,
    teams,
  });
  const matchedScheduleGames = new Set(reconciled.rows.map((row) => row.gameId));
  const seasonCoverage = Object.fromEntries(INDEPENDENT_SEASONS.map((season) => [
    String(season),
    reconciled.rows.filter((row) => row.season === season).length,
  ]));
  const rawSeasonCoverage = Object.fromEntries(INDEPENDENT_SEASONS.map((season) => [
    String(season),
    stats.filter((row) => row.season === season).length,
  ]));
  const scheduleTimeModeBySeason = Object.fromEntries(INDEPENDENT_SEASONS.map((season) => [
    String(season),
    season >= 2025
      ? "explicit_final_schedule_kickoff_only"
      : schedule.some((game) => game.season === season)
        ? "official_schedule_kickoff_or_date_boundary"
        : "team_game_calendar_date_fallback",
  ]));
  const seasonWeekCoverage: Record<string, {
    finalScheduleGames: number;
    validKickoffGames: number;
    matchedPlayerRows: number;
  }> = {};
  const isIncludedCoverageWeek = (season: number, week: number) =>
    season >= 2025 && (season !== 2025 || (week >= 1 && week <= 18));
  for (const game of schedule.filter((item) => isIncludedCoverageWeek(item.season, item.week))) {
    seasonWeekCoverage[`${game.season}:${game.week}`] ??= {
      finalScheduleGames: 0,
      validKickoffGames: 0,
      matchedPlayerRows: 0,
    };
  }
  for (const game of finalNewSeasonGames.filter((item) => isIncludedCoverageWeek(item.season, item.week))) {
    const key = `${game.season}:${game.week}`;
    const coverage = seasonWeekCoverage[key] ??= {
      finalScheduleGames: 0,
      validKickoffGames: 0,
      matchedPlayerRows: 0,
    };
    coverage.finalScheduleGames += 1;
    if (game.kickoffTime && Number.isFinite(game.kickoffTime.getTime())) {
      coverage.validKickoffGames += 1;
    }
  }
  for (const row of reconciled.rows.filter((item) => isIncludedCoverageWeek(item.season, item.week))) {
    const key = `${row.season}:${row.week}`;
    const coverage = seasonWeekCoverage[key] ??= {
      finalScheduleGames: 0,
      validKickoffGames: 0,
      matchedPlayerRows: 0,
    };
    coverage.matchedPlayerRows += 1;
  }
  const sourceFileBySeason = new Map(statSourceFiles.map((row) => [row.season, row]));
  const checksumSha256 = hashSortedPlayerProjectionInputs({ stats, schedule, teamGames, teams });
  return runIndependentPlayerProjectionValidation({
    observations: reconciled.rows,
    teamGames: reconciledTeamGames,
    baseline: input.baseline,
    baselineReportSha256: input.baselineReportSha256,
    generatedAt: input.generatedAt,
    provenance: {
      databaseScope: "development",
      sourceDatasets: [
        "player_game_stats (nflverse, regular season, 2021–2026)",
        "games (2025–2026 rows require explicit final/complete status and scheduled UTC kickoff)",
        "team_game_stats (lagged team pass-rate and opponent defensive context where available)",
        "teams (schedule-ID to abbreviation mapping)",
        "team_game_stats date-only schedule fallback permitted for 2021–2024 history only",
      ],
      sourceLedger: {
        playerStats: ([2025, 2026] as const).map((season) => {
          const sourceFile = sourceFileBySeason.get(season);
          return {
            season,
            sourceUrl: sourceFile?.sourceUrl
              ?? `https://github.com/nflverse/nflverse-data/releases/download/stats_player/stats_player_week_${season}.csv.gz`,
            status: sourceFile?.status ?? null,
            rowCount: sourceFile?.rowsProcessed ?? 0,
            fileSizeBytes: sourceFile?.fileSizeBytes ?? null,
            completedAt: sourceFile?.completedAt?.toISOString() ?? null,
            upstreamFileContentSha256: null,
          };
        }),
        espnScheduleRecovery: SCHEDULE_RECOVERY_JOB_KEYS.map((jobKey) => {
          const run = scheduleRecoveryRuns.find((candidate) => candidate.jobKey === jobKey);
          return {
            jobKey,
            runId: run?.id ?? null,
            status: run?.status ?? null,
            recordsProcessed: run?.recordsProcessed ?? null,
            completedAt: run?.completedAt?.toISOString() ?? null,
          };
        }),
      },
      rawPlayerStatRows: stats.length,
      reconciledPlayerGameRows: reconciled.rows.length,
      teamGameRows: reconciledTeamGames.length,
      scheduleGames: effectiveSchedule.length,
      matchedScheduleGames: matchedScheduleGames.size,
      unmatchedPlayerStatRows: reconciled.excludedUnmatchedOrAmbiguousPlayerRows,
      excludedNonFinalScheduleRows: reconciled.excludedNonFinalScheduleRows,
      excludedUnmatchedOrAmbiguousPlayerRows: reconciled.excludedUnmatchedOrAmbiguousPlayerRows,
      rawSeasonCoverage,
      seasonCoverage,
      scheduleTimeModeBySeason,
      finalScheduleGamesBySeasonWeek: Object.fromEntries(
        Object.entries(seasonWeekCoverage).map(([key, coverage]) => [key, coverage.finalScheduleGames]),
      ),
      validKickoffGamesBySeasonWeek: Object.fromEntries(
        Object.entries(seasonWeekCoverage).map(([key, coverage]) => [key, coverage.validKickoffGames]),
      ),
      matchedPlayerRowsBySeasonWeek: Object.fromEntries(
        Object.entries(seasonWeekCoverage).map(([key, coverage]) => [key, coverage.matchedPlayerRows]),
      ),
      checksumSha256,
      historicalTimestampCaveat: "Game-time ordering is enforced, but archived source-publication timestamps were not verified. 2021–2024 history may use conservative date-only boundaries; 2025–2026 scored observations require an explicitly final/complete game with a scheduled UTC kickoff. Outcomes from games still in progress or not explicitly final are excluded even if score columns are non-null.",
    },
  });
}