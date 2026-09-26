import { and, eq, gte, lte } from "drizzle-orm";
import { pool } from "@workspace/db";
import {
  db, gamesTable, nflverseSourceFilesTable, playerGameStatsTable,
  redZonePlayerGameFactsTable, redZoneTeamGameFactsTable,
  teamGameStatsTable, teamsTable,
} from "@workspace/db";
import { canonicalProjectionTeam } from "./player-projections";
import {
  runTdEvaluation, type PlayerTdEvaluationInput, type PlayerTdGame,
  type PlayerTdTeamGame, type PlayerTdRedZoneFact,
} from "./player-td-model";

/**
 * Research-only read. Historical 2021–24 schedule rows are absent in the
 * development archive: their PBP team-game dates supply midnight UTC boundaries.
 * 2025+ must instead have an explicit final schedule row and UTC kickoff.
 */
export async function readDevelopmentPlayerTdEvidence() {
  if (process.env.NODE_ENV !== "development" || process.env.REPLIT_DEPLOYMENT) {
    throw new Error("TD evaluation is restricted to the development database");
  }
  const identity = await pool.query(`
    SELECT current_database() AS database_name, current_user AS database_role,
           pg_is_in_recovery() AS replica, inet_server_addr() IS NULL AS local_proxy
  `);
  const connection = identity.rows[0] as
    | { database_name: string; database_role: string; replica: boolean; local_proxy: boolean }
    | undefined;
  if (identity.rows.length !== 1 || connection?.database_name !== "heliumdb"
    || connection.database_role !== "postgres" || connection.replica || !connection.local_proxy) {
    throw new Error("Refusing TD research read: the connection is not the verified development database");
  }
  const [stats, teamStats, schedule, teams, redPlayers, redTeams, sources] = await Promise.all([
    db.select({
      playerId: playerGameStatsTable.playerId, playerName: playerGameStatsTable.playerName,
      position: playerGameStatsTable.position, team: playerGameStatsTable.teamId,
      opponent: playerGameStatsTable.opponentTeamId, season: playerGameStatsTable.season,
      week: playerGameStatsTable.week, targets: playerGameStatsTable.targets,
      carries: playerGameStatsTable.carries, rushingTds: playerGameStatsTable.rushingTds,
      receivingTds: playerGameStatsTable.receivingTds, passingTds: playerGameStatsTable.passingTds,
    }).from(playerGameStatsTable).where(and(
      eq(playerGameStatsTable.seasonType, "REG"),
      gte(playerGameStatsTable.season, 2021), lte(playerGameStatsTable.season, 2025),
    )),
    db.select({
      gameId: teamGameStatsTable.gameId, season: teamGameStatsTable.season,
      week: teamGameStatsTable.week, team: teamGameStatsTable.teamId,
      opponent: teamGameStatsTable.opponentTeamId, gameDate: teamGameStatsTable.gameDate,
      score: teamGameStatsTable.teamScore,
      defensiveEpa: teamGameStatsTable.defensiveEpaAllowedPerPlay,
    }).from(teamGameStatsTable).where(and(
      gte(teamGameStatsTable.season, 2021), lte(teamGameStatsTable.season, 2025),
    )),
    db.select({
      gameId: gamesTable.gameId, season: gamesTable.season, week: gamesTable.week,
      kickoff: gamesTable.kickoffTime, status: gamesTable.gameStatus,
      home: gamesTable.homeTeamId, away: gamesTable.awayTeamId,
    }).from(gamesTable).where(and(gte(gamesTable.season, 2025), lte(gamesTable.season, 2025))),
    db.select({ id: teamsTable.teamId, abbreviation: teamsTable.abbreviation }).from(teamsTable),
    db.select({
      gameId: redZonePlayerGameFactsTable.gameId, playerId: redZonePlayerGameFactsTable.playerId,
      season: redZonePlayerGameFactsTable.season, week: redZonePlayerGameFactsTable.week,
      team: redZonePlayerGameFactsTable.teamId, opponent: redZonePlayerGameFactsTable.opponentTeamId,
      zone: redZonePlayerGameFactsTable.zone, targets: redZonePlayerGameFactsTable.targets,
      carries: redZonePlayerGameFactsTable.carries,
    }).from(redZonePlayerGameFactsTable).where(and(
      eq(redZonePlayerGameFactsTable.zone, 20), gte(redZonePlayerGameFactsTable.season, 2021),
      lte(redZonePlayerGameFactsTable.season, 2025),
    )),
    db.select({
      gameId: redZoneTeamGameFactsTable.gameId, team: redZoneTeamGameFactsTable.teamId,
      season: redZoneTeamGameFactsTable.season, zone: redZoneTeamGameFactsTable.zone,
    }).from(redZoneTeamGameFactsTable).where(and(
      eq(redZoneTeamGameFactsTable.zone, 20), gte(redZoneTeamGameFactsTable.season, 2021),
      lte(redZoneTeamGameFactsTable.season, 2025),
    )),
    db.select({
      dataset: nflverseSourceFilesTable.dataset, season: nflverseSourceFilesTable.season,
      status: nflverseSourceFilesTable.status, completedAt: nflverseSourceFilesTable.completedAt,
      sourceUrl: nflverseSourceFilesTable.sourceUrl,
    }).from(nflverseSourceFilesTable).where(and(
      gte(nflverseSourceFilesTable.season, 2021), lte(nflverseSourceFilesTable.season, 2025),
    )),
  ]);
  const codeById = new Map(teams.map((team) => [team.id, canonicalProjectionTeam(team.abbreviation)]));
  const canonical = (value: string | null) => canonicalProjectionTeam(value);
  const key = (season: number, week: number, team: string, opponent: string) =>
    `${season}:${week}:${team}:${opponent}`;
  const scheduleByMatchup = new Map<string, Array<{ gameId: string; kickoff: Date; source: "scheduledKickoff" | "calendarDateBoundary" }>>();
  for (const game of schedule) {
    if (!/final|complete/i.test(game.status) || !game.kickoff || !Number.isFinite(game.kickoff.getTime())) continue;
    const home = codeById.get(game.home);
    const away = codeById.get(game.away);
    if (!home || !away || home === away) continue;
    for (const [team, opponent] of [[home, away], [away, home]]) {
      const matchup = key(game.season, game.week, team!, opponent!);
      scheduleByMatchup.set(matchup, [...(scheduleByMatchup.get(matchup) ?? []),
        { gameId: game.gameId, kickoff: game.kickoff, source: "scheduledKickoff" }]);
    }
  }
  // Deduplicate the two team records of each historical game, but reject
  // conflicting same-week matchups rather than guessing which source game won.
  for (const row of teamStats) {
    if (row.season >= 2025 || !row.gameDate) continue;
    const team = canonical(row.team);
    const opponent = canonical(row.opponent);
    const kickoff = new Date(`${row.gameDate}T00:00:00.000Z`);
    if (!team || !opponent || !Number.isFinite(kickoff.getTime())) continue;
    const matchup = key(row.season, row.week, team, opponent);
    const games = scheduleByMatchup.get(matchup) ?? [];
    if (!games.some((game) => game.gameId === row.gameId)) {
      scheduleByMatchup.set(matchup, [...games, { gameId: row.gameId, kickoff, source: "calendarDateBoundary" }]);
    }
  }
  const resolved = (season: number, week: number, team: string | null, opponent: string | null) => {
    const a = canonical(team);
    const b = canonical(opponent);
    if (!a || !b || a === b) return null;
    const matches = scheduleByMatchup.get(key(season, week, a, b));
    return matches?.length === 1 ? { ...matches[0]!, team: a, opponent: b } : null;
  };
  let unmatchedPlayerRows = 0;
  const players: PlayerTdGame[] = [];
  for (const row of stats) {
    if (!["QB", "RB", "WR", "TE"].includes(row.position ?? "")) continue;
    const game = resolved(row.season, row.week, row.team, row.opponent);
    if (!game) { unmatchedPlayerRows += 1; continue; }
    players.push({
      ...game, playerId: row.playerId, playerName: row.playerName,
      position: row.position as PlayerTdGame["position"],
      kickoff: game.kickoff, kickoffTimeSource: game.source,
      targets: row.targets, carries: row.carries, rushingTds: row.rushingTds,
      receivingTds: row.receivingTds, passingTds: row.passingTds,
      season: row.season, week: row.week,
    });
  }
  const teamGames: PlayerTdTeamGame[] = teamStats.flatMap((row) => {
    const game = resolved(row.season, row.week, row.team, row.opponent);
    return game ? [{
      ...game, season: row.season, week: row.week, kickoff: game.kickoff,
      kickoffTimeSource: game.source, score: row.score, defensiveEpa: row.defensiveEpa,
    }] : [];
  });
  const covered = new Set(redTeams.map((row) => `${row.gameId}:${canonical(row.team)}:${row.zone}`));
  const appearances = new Set(players.map((row) => `${row.gameId}:${row.team}:${row.playerId}`));
  const redZoneFacts: PlayerTdRedZoneFact[] = redPlayers.flatMap((row) => {
    const team = canonical(row.team);
    const opponent = canonical(row.opponent);
    const game = resolved(row.season, row.week, row.team, row.opponent);
    return game && team && opponent && row.gameId === game.gameId && row.zone === 20
      && covered.has(`${game.gameId}:${team}:20`)
      && appearances.has(`${game.gameId}:${team}:${row.playerId}`)
      ? [{ gameId: game.gameId, playerId: row.playerId, team, opponent,
        season: row.season, week: row.week, zone: 20 as const, targets: row.targets,
        carries: row.carries, validJoinedCoverage: true }] : [];
  });
  return {
    input: { players, teamGames, redZoneFacts } satisfies PlayerTdEvaluationInput,
    provenance: {
      rawPlayerRows: stats.length, matchedPlayerRows: players.length, unmatchedPlayerRows,
      matchedTeamGames: teamGames.length, joinedRedZoneFacts: redZoneFacts.length,
      sourceLedger: sources.map((row) => ({
        ...row, completedAt: row.completedAt?.toISOString() ?? null,
      })),
      sourceTimingLimitation: "Current mutable imports were captured in 2026. Original per-week release/publication timestamps are not archived; structural pregame features are not proof of historically available information.",
    },
  };
}

export async function runDevelopmentPlayerTdEvaluation() {
  const evidence = await readDevelopmentPlayerTdEvidence();
  return { report: runTdEvaluation(evidence.input), provenance: evidence.provenance };
}