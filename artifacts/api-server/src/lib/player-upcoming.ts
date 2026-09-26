import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { and, desc, eq, gte, inArray, lte } from "drizzle-orm";
import {
  dataSyncRunsTable, db, gamesTable, injuriesTable, nflversePlayerIdentitiesTable,
  nflverseSourceFilesTable, playerGameStatsTable, playersTable, pool,
  teamGameStatsTable, teamsTable, sleeperPlayerCrosswalkEvidenceTable,
} from "@workspace/db";
import { validPlayerObservation } from "./player-forecast-readiness";
import {
  buildPlayerProjectionScheduleFromTeamGames, canonicalProjectionTeam,
  forecastUpcomingPlayer, prepareIndependentProjectionSchedule,
  reconcilePlayerProjectionRows, reconcilePlayerProjectionTeamGames,
  PLAYER_PROJECTION_FAMILIES,
  type FrozenPlayerProjectionBaseline, type PlayerProjectionFamily,
  type PlayerProjectionRawTeamGame, type PlayerProjectionScheduleGame,
  type PlayerProjectionSourceStat, type PlayerProjectionTeam,
} from "./player-projections";

const reportDir = resolve(process.cwd(), "../../reports");
const baselineHash = "131c5672ce49d28b0fd226be4465d188d6403f1a5da19f88bd69e35c5ad6dc3e";
const expectedDatabase = { systemId: "7685192831018250259", oid: 16384 };
const maxSourceAgeMs = 48 * 60 * 60 * 1000;
const finalStatus = /final|complete/i;
const unavailableStatus = /\b(?:out|inactive|injured reserve|ir|suspended|released)\b/i;

type CapturedCandidate = {
  espnPlayerId: string;
  espnTeam: string;
  sleeperMatches: Array<{ sleeperId: string; team: string | null }>;
};
type CapturedEvidence = {
  target: { database: string; role: string; systemId: string; databaseOid: number };
  sleeper: { bodyReceivedAt: string; responseSha256: string; result: { snapshotId: string; playerCount: number; sourceCapturedAt: string } };
  candidates: CapturedCandidate[];
};

export type UpcomingForecast = {
  playerId: string;
  playerName: string;
  position: string;
  teamId: string;
  opponentTeamId: string;
  gameId: string;
  kickoffTime: string;
  statistic: PlayerProjectionFamily;
  projectedValue: number;
  recentAverage: number | null;
  seasonAverage: number | null;
  priorAppearances: number;
  sampleQuality: "low" | "moderate" | "high";
  modelVersion: string;
  calculatedAt: string;
  sourceRetrievedAt: string;
  injuryStatus: string | null;
  availabilityUncertain: boolean;
  uncertaintyReasons: string[];
  missingFeatures: string[];
};
export type UpcomingForecastReport = {
  status: "unavailable" | "development_forecasts";
  message: string;
  asOf: string | null;
  upcomingGames: number;
  coverage: { direct: number; crosswalk: number };
  eligibility: { conditional: number; uncertain: number; unavailable: number; reasons: Record<string, number> };
  forecasts: UpcomingForecast[];
  withheld: Array<{ playerId: string; statistic: PlayerProjectionFamily | null; reason: string }>;
};

export function assessUpcomingEvidence(input: {
  sleeperTeam: string | null;
  currentTeam: string | null;
  sourceRetrievedAt: Date;
  asOf: Date;
  injuryStatus: string | null;
  injuryObservedAt: Date | null;
  rosterStatus: string | null;
  rosterObservedAt: Date | null;
}) {
  const fresh = (at: Date | null) => at !== null && Number.isFinite(at.getTime())
    && at <= input.asOf && input.asOf.getTime() - at.getTime() <= maxSourceAgeMs;
  if (!fresh(input.sourceRetrievedAt)) return { allowed: false, reason: "stale_sleeper_retrieval", injuryStatus: null, uncertain: true };
  if (!input.sleeperTeam || !input.currentTeam) return { allowed: false, reason: "missing_team", injuryStatus: null, uncertain: true };
  if (canonicalProjectionTeam(input.sleeperTeam) !== canonicalProjectionTeam(input.currentTeam)) {
    return { allowed: false, reason: "conflicting_team", injuryStatus: null, uncertain: true };
  }
  const injury = fresh(input.injuryObservedAt) ? input.injuryStatus : null;
  const roster = fresh(input.rosterObservedAt) ? input.rosterStatus : null;
  if (unavailableStatus.test(injury ?? "") || unavailableStatus.test(roster ?? "")) {
    return { allowed: false, reason: "reported_unavailable", injuryStatus: injury, uncertain: false };
  }
  // Even explicit "Active" labels are not a promise of participation in the
  // upcoming game. A current injury-only omission cannot establish health.
  return { allowed: true, reason: "participation_unconfirmed", injuryStatus: injury, uncertain: true };
}

async function verifyDevelopmentDatabase() {
  if (process.env.NODE_ENV !== "development" || process.env.REPLIT_DEPLOYMENT) {
    throw new Error("Upcoming player forecasts are restricted to local development");
  }
  const result = await pool.query(`
    SELECT current_database() AS database_name, current_user AS database_role,
      pg_is_in_recovery() AS replica, inet_server_addr() IS NULL AS local_proxy,
      (SELECT system_identifier FROM pg_control_system()) AS system_id,
      (SELECT oid FROM pg_database WHERE datname=current_database()) AS database_oid
  `);
  const row = result.rows[0];
  if (result.rows.length !== 1 || row?.database_name !== "heliumdb" || row.database_role !== "postgres"
    || row.replica || !row.local_proxy || String(row.system_id) !== expectedDatabase.systemId
    || Number(row.database_oid) !== expectedDatabase.oid) {
    throw new Error("Upcoming player forecasts require the attested development database");
  }
}

export async function readDevelopmentUpcomingPlayerProjections(asOf = new Date()): Promise<UpcomingForecastReport> {
  await verifyDevelopmentDatabase();
  const captured = JSON.parse(await readFile(resolve(reportDir, "gridline-player-availability-approved-refresh-evidence.json"), "utf8")) as CapturedEvidence;
  if (captured.target.database !== "heliumdb" || captured.target.role !== "postgres"
    || captured.target.systemId !== expectedDatabase.systemId || captured.target.databaseOid !== expectedDatabase.oid
    || !/^[a-f0-9]{64}$/.test(captured.sleeper.responseSha256)
    || captured.sleeper.result.playerCount !== 12229 || captured.candidates.length !== 512) {
    throw new Error("The retained full-response Sleeper evidence does not match the attested capture");
  }
  const retrievedAt = new Date(captured.sleeper.bodyReceivedAt);
  const sourceCapturedAt = new Date(captured.sleeper.result.sourceCapturedAt);
  const baselineText = await readFile(resolve(reportDir, "gridline-player-projection-baseline.json"), "utf8");
  if (createHash("sha256").update(baselineText).digest("hex") !== baselineHash) {
    throw new Error("Frozen player model report checksum changed");
  }
  const baseline = JSON.parse(baselineText) as FrozenPlayerProjectionBaseline;
  const [run] = await db.select().from(dataSyncRunsTable)
    .where(and(eq(dataSyncRunsTable.provider, "sleeper-players"), eq(dataSyncRunsTable.status, "success")))
    .orderBy(desc(dataSyncRunsTable.startedAt)).limit(1);
  if (!run || !run.metadata || run.metadata.snapshotId !== captured.sleeper.result.snapshotId
    || run.metadata.playerCount !== captured.sleeper.result.playerCount
    || run.metadata.sourceCapturedAt !== sourceCapturedAt.toISOString()
    || validPlayerObservation(run)?.getTime() !== sourceCapturedAt.getTime()
    || !Number.isFinite(retrievedAt.getTime()) || retrievedAt < run.startedAt
    || retrievedAt > run.completedAt!) {
    throw new Error("No matching complete successful Sleeper retrieval is persisted");
  }
  const capturedById = new Map(captured.candidates.map((row) => [row.espnPlayerId, row]));
  const direct = captured.candidates.filter((row) => row.sleeperMatches.length === 1
    && !!row.sleeperMatches[0]!.team
    && canonicalProjectionTeam(row.espnTeam) === canonicalProjectionTeam(row.sleeperMatches[0]!.team));
  const directIds = direct.map((row) => row.espnPlayerId);

  const [currentPlayers, identities, sourceStats, sourceSchedule, sourceTeamGames, teams, injuries, imports, crosswalks] = await Promise.all([
    db.select().from(playersTable).where(inArray(playersTable.playerId, directIds)),
    db.select({
      gsisId: nflversePlayerIdentitiesTable.gsisId, espnId: nflversePlayerIdentitiesTable.espnId,
      observedAt: nflversePlayerIdentitiesTable.observedAt,
    }).from(nflversePlayerIdentitiesTable),
    db.select({
      playerId: playerGameStatsTable.playerId, playerName: playerGameStatsTable.playerName,
      position: playerGameStatsTable.position, teamId: playerGameStatsTable.teamId,
      opponentTeamId: playerGameStatsTable.opponentTeamId, season: playerGameStatsTable.season,
      week: playerGameStatsTable.week, seasonType: playerGameStatsTable.seasonType,
      passingYards: playerGameStatsTable.passingYards, rushingYards: playerGameStatsTable.rushingYards,
      receivingYards: playerGameStatsTable.receivingYards, receptions: playerGameStatsTable.receptions,
      passAttempts: playerGameStatsTable.attempts, carries: playerGameStatsTable.carries,
      targets: playerGameStatsTable.targets,
    }).from(playerGameStatsTable).where(and(gte(playerGameStatsTable.season, 2021),
      lte(playerGameStatsTable.season, 2026), eq(playerGameStatsTable.seasonType, "REG"),
      inArray(playerGameStatsTable.position, ["QB", "RB", "WR", "TE"]),
      lte(playerGameStatsTable.sourceUpdatedAt, asOf))),
    db.select({
      gameId: gamesTable.gameId, season: gamesTable.season, week: gamesTable.week,
      kickoffTime: gamesTable.kickoffTime, gameDate: gamesTable.gameDate,
      status: gamesTable.gameStatus, homeTeamId: gamesTable.homeTeamId,
      awayTeamId: gamesTable.awayTeamId, finalHomeScore: gamesTable.finalHomeScore,
      finalAwayScore: gamesTable.finalAwayScore,
    }).from(gamesTable).where(and(gte(gamesTable.season, 2021), lte(gamesTable.season, 2026))),
    db.select({
      season: teamGameStatsTable.season, week: teamGameStatsTable.week,
      gameId: teamGameStatsTable.gameId, teamId: teamGameStatsTable.teamId,
      opponentTeamId: teamGameStatsTable.opponentTeamId, passAttempts: teamGameStatsTable.passAttempts,
      rushAttempts: teamGameStatsTable.rushAttempts,
      defensiveEpaAllowedPerPlay: teamGameStatsTable.defensiveEpaAllowedPerPlay,
      gameDate: teamGameStatsTable.gameDate, isHome: teamGameStatsTable.isHome,
    }).from(teamGameStatsTable).where(and(gte(teamGameStatsTable.season, 2021), lte(teamGameStatsTable.season, 2026),
      lte(teamGameStatsTable.sourceUpdatedAt, asOf))),
    db.select({ teamId: teamsTable.teamId, abbreviation: teamsTable.abbreviation }).from(teamsTable),
    db.select({
      playerId: injuriesTable.playerId, teamId: injuriesTable.teamId,
      gameStatus: injuriesTable.gameStatus, sourceUpdatedAt: injuriesTable.sourceUpdatedAt,
      snapshotTimestamp: injuriesTable.snapshotTimestamp,
    }).from(injuriesTable).where(lte(injuriesTable.snapshotTimestamp, asOf)).orderBy(desc(injuriesTable.snapshotTimestamp)),
    db.select({ completedAt: nflverseSourceFilesTable.completedAt }).from(nflverseSourceFilesTable)
      .where(and(eq(nflverseSourceFilesTable.dataset, "player_stats"), eq(nflverseSourceFilesTable.season, 2026)))
      .orderBy(desc(nflverseSourceFilesTable.completedAt)).limit(1),
    db.select({ ambiguous: sleeperPlayerCrosswalkEvidenceTable.ambiguous })
      .from(sleeperPlayerCrosswalkEvidenceTable).limit(1),
  ]);
  if (!imports[0]?.completedAt || imports[0].completedAt > asOf) {
    throw new Error("Current-season player-stat ingestion is not verified before calculation");
  }
  // Existing crosswalk rows are only usable if independently associated with this
  // full retrieval. The current database has none; fail closed if that changes.
  if (crosswalks.length) throw new Error("Crosswalk expansion requires per-player full-response verification");
  const teamRows = teams as PlayerProjectionTeam[];
  const schedule = sourceSchedule as PlayerProjectionScheduleGame[];
  const teamCode = new Map(teamRows.map((row) => [row.teamId, canonicalProjectionTeam(row.abbreviation)]));
  const future = schedule.filter((game) => game.season >= 2026
    && !finalStatus.test(game.status) && game.kickoffTime instanceof Date
    && Number.isFinite(game.kickoffTime.getTime()) && game.kickoffTime > asOf
    && !!teamCode.get(game.homeTeamId) && !!teamCode.get(game.awayTeamId));
  const next = [...future].sort((a, b) => a.kickoffTime!.getTime() - b.kickoffTime!.getTime())[0];
  const slate = next ? future.filter((game) => game.season === next.season && game.week === next.week) : [];
  const byTeam = new Map<string, PlayerProjectionScheduleGame>();
  const duplicateTeams = new Set<string>();
  for (const game of slate) for (const teamId of [game.homeTeamId, game.awayTeamId]) {
    if (byTeam.has(teamId)) duplicateTeams.add(teamId);
    byTeam.set(teamId, game);
  }
  const legacyFallback = buildPlayerProjectionScheduleFromTeamGames({
    teamGames: (sourceTeamGames as PlayerProjectionRawTeamGame[]).filter((row) => row.season <= 2024), teams: teamRows,
  });
  const officialOldSeasons = new Set(schedule.filter((row) => row.season <= 2024).map((row) => row.season));
  const strictSchedule = prepareIndependentProjectionSchedule([
    ...schedule.filter((game) => game.season >= 2025
      ? finalStatus.test(game.status) && game.kickoffTime instanceof Date && game.kickoffTime < asOf
      : officialOldSeasons.has(game.season)),
    ...legacyFallback.filter((game) => !officialOldSeasons.has(game.season)),
  ]);
  const historical = reconcilePlayerProjectionRows({
    stats: sourceStats as PlayerProjectionSourceStat[], schedule: strictSchedule, teams: teamRows,
  }).rows.filter((row) => row.kickoffTime < asOf);
  const teamGames = reconcilePlayerProjectionTeamGames({
    teamGames: sourceTeamGames as PlayerProjectionRawTeamGame[], schedule: strictSchedule, teams: teamRows,
  }).filter((row) => row.kickoffTime < asOf);
  const historyByGsis = new Map<string, typeof historical>();
  for (const row of historical) historyByGsis.set(row.playerId, [...(historyByGsis.get(row.playerId) ?? []), row]);
  const injuryByPair = new Map<string, (typeof injuries)[number]>();
  for (const injury of injuries) {
    const key = `${injury.playerId}:${injury.teamId}`;
    if (!injuryByPair.has(key)) injuryByPair.set(key, injury);
  }
  const currentById = new Map(currentPlayers.map((row) => [row.playerId, row]));
  const gsisByEspn = new Map<string, Set<string>>();
  const espnByGsis = new Map<string, Set<string>>();
  for (const row of identities) {
    if (!row.espnId || !row.gsisId || row.observedAt > asOf) continue;
    gsisByEspn.set(row.espnId, (gsisByEspn.get(row.espnId) ?? new Set()).add(row.gsisId));
    espnByGsis.set(row.gsisId, (espnByGsis.get(row.gsisId) ?? new Set()).add(row.espnId));
  }
  const forecasts: UpcomingForecast[] = [];
  const withheld: UpcomingForecastReport["withheld"] = [];
  const reasons: Record<string, number> = {};
  let conditional = 0;
  let uncertain = 0;
  const count = (reason: string) => { reasons[reason] = (reasons[reason] ?? 0) + 1; };
  const suppress = (playerId: string, reason: string) => {
    count(reason);
    withheld.push({ playerId, statistic: null, reason });
  };
  for (const capturedPlayer of captured.candidates) {
    const playerId = capturedPlayer.espnPlayerId;
    const player = currentById.get(playerId);
    const sleeper = capturedById.get(playerId)?.sleeperMatches;
    if (!directIds.includes(playerId)) { suppress(playerId, "identity_or_team_not_verified_in_full_response"); continue; }
    if (!player?.teamId || !["QB", "RB", "WR", "TE"].includes(player.position ?? "")) { suppress(playerId, "player_or_team_missing"); continue; }
    if (teamCode.get(player.teamId) !== canonicalProjectionTeam(capturedPlayer.espnTeam)) { suppress(playerId, "changed_espn_team"); continue; }
    const game = byTeam.get(player.teamId);
    if (!game || duplicateTeams.has(player.teamId)) { suppress(playerId, "off_slate_or_ambiguous_game"); continue; }
    const mapped = gsisByEspn.get(playerId);
    const gsis = mapped?.size === 1 ? [...mapped][0]! : null;
    if (!gsis || espnByGsis.get(gsis)?.size !== 1) { suppress(playerId, "missing_or_ambiguous_gsis_identity"); continue; }
    const opponentId = game.homeTeamId === player.teamId ? game.awayTeamId : game.homeTeamId;
    const team = teamCode.get(player.teamId);
    const opponent = teamCode.get(opponentId);
    if (!team || !opponent || !game.kickoffTime) { suppress(playerId, "unverified_schedule"); continue; }
    const injury = injuryByPair.get(`${playerId}:${player.teamId}`);
    const assessed = assessUpcomingEvidence({
      sleeperTeam: sleeper?.[0]?.team ?? null, currentTeam: team,
      sourceRetrievedAt: retrievedAt, asOf,
      injuryStatus: injury?.gameStatus ?? null,
      injuryObservedAt: injury?.sourceUpdatedAt ?? null,
      rosterStatus: player.activeStatus,
      rosterObservedAt: player.sourceUpdatedAt,
    });
    if (!assessed.allowed) { suppress(playerId, assessed.reason!); continue; }
    const history = historyByGsis.get(gsis) ?? [];
    const playerForecasts: UpcomingForecast[] = [];
    for (const family of Object.keys(PLAYER_PROJECTION_FAMILIES) as PlayerProjectionFamily[]) {
      if (!PLAYER_PROJECTION_FAMILIES[family].position.includes(player.position!)) continue;
      const output = forecastUpcomingPlayer({
        current: {
          playerId: gsis, playerName: player.name, position: player.position!,
          season: game.season, week: game.week, seasonType: "REG", gameId: game.gameId,
          kickoffTime: game.kickoffTime, team, opponent,
          homeAway: game.homeTeamId === player.teamId ? "home" : "away",
        },
        history, teamGames, family, baseline, baselineReportSha256: baselineHash,
      });
      if (!output) {
        withheld.push({ playerId, statistic: family, reason: "insufficient_prior_appearances_or_model_features" });
        continue;
      }
      if (!Number.isFinite(output.projectedValue)) throw new Error(`Non-finite frozen projection for ${family}`);
      playerForecasts.push({
        playerId, playerName: player.name, position: player.position!, teamId: team, opponentTeamId: opponent,
        gameId: game.gameId, kickoffTime: game.kickoffTime.toISOString(), statistic: family,
        projectedValue: output.projectedValue, recentAverage: output.recentAverage,
        seasonAverage: output.seasonAverage, priorAppearances: output.priorAppearances,
        sampleQuality: output.priorAppearances >= 8 ? "high" : output.priorAppearances >= 5 ? "moderate" : "low",
        modelVersion: output.modelVersion, calculatedAt: asOf.toISOString(),
        sourceRetrievedAt: retrievedAt.toISOString(), injuryStatus: assessed.injuryStatus,
        availabilityUncertain: assessed.uncertain,
        uncertaintyReasons: assessed.uncertain ? ["Participation not confirmed; injury-only omissions are not health evidence"] : [],
        missingFeatures: output.missingFeatures,
      });
    }
    if (!playerForecasts.length) { count("insufficient_prior_appearances_or_model_features"); continue; }
    conditional += 1;
    if (assessed.uncertain) uncertain += 1;
    forecasts.push(...playerForecasts);
  }
  return {
    status: forecasts.length ? "development_forecasts" : "unavailable",
    message: forecasts.length
      ? "Development forecasts are conditional on participation. A Sleeper full-response team match is not an ESPN roster re-verification; missing injury entries do not establish health."
      : "No currently eligible conditional upcoming forecasts. Source evidence or historical history is insufficient.",
    asOf: asOf.toISOString(), upcomingGames: slate.length,
    coverage: { direct: direct.length, crosswalk: 0 },
    eligibility: { conditional, uncertain, unavailable: captured.candidates.length - conditional, reasons },
    forecasts, withheld,
  };
}