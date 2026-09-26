import { and, eq, gte, inArray, lte } from "drizzle-orm";
import {
  db,
  gamesTable,
  playerGameStatsTable,
  teamGameStatsTable,
  teamsTable,
} from "@workspace/db";
import {
  buildPlayerProjectionScheduleFromTeamGames,
  hash,
  reconcilePlayerProjectionRows,
  reconcilePlayerProjectionTeamGames,
  runPlayerProjectionEvaluation,
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