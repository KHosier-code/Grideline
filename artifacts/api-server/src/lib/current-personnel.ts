import { and, desc, eq, gte, inArray, lte } from "drizzle-orm";
import {
  db,
  depthChartSnapshotsTable,
  gamesTable,
  historicalDepthChartTable,
  injuriesTable,
  qbGameStatsTable,
  sleeperIdentityMappingRunsTable,
  sleeperIdentityMappingsTable,
  sleeperPlayerSnapshotsTable,
  snapCountsTable,
  teamsTable,
} from "@workspace/db";
import {
  deriveCurrentTeamDepth,
  type CurrentDepthSource,
  type InterpretedTeamDepth,
} from "./current-personnel-derivation";
import { normalizeTeamId, nflverseTeamCandidates } from "./personnel-context-derivation";
import { reconstructLatestSleeperState } from "./sleeper-identity";

const QUERY_CONCURRENCY = 4;
const TEN_TEAM_SAMPLE = 10;

export function currentGamePersonnelCutoff(kickoffTime: Date | null, now: Date) {
  return new Date(Math.min(now.getTime(), kickoffTime ? kickoffTime.getTime() - 1 : now.getTime()));
}

async function mapBounded<T, R>(items: T[], fn: (item: T) => Promise<R>, concurrency = QUERY_CONCURRENCY) {
  const output = new Array<R>(items.length);
  let next = 0;
  async function worker() {
    while (next < items.length) {
      const index = next++;
      output[index] = await fn(items[index]!);
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, worker));
  return output;
}

async function currentEvidence(cutoff: Date, teamIdentities?: string[]) {
  const recentCutoff = new Date(cutoff.getTime() - 400 * 86_400_000);
  const injuryCutoff = new Date(cutoff.getTime() - 30 * 86_400_000);
  const historicalCutoff = new Date(cutoff.getTime() - 3 * 365 * 86_400_000);
  const teams = await db.select().from(teamsTable);
  const requested = teamIdentities?.map((value) => value.trim().toUpperCase());
  const selectedTeams = requested?.length
    ? teams.filter((team) => requested.includes(team.teamId.toUpperCase()) || requested.includes(team.abbreviation.toUpperCase()))
    : teams;
  const teamByAbbreviation = new Map(teams.map((team) => [team.abbreviation.toUpperCase(), team.teamId]));
  const canonicalTeamIds = selectedTeams.map((team) => team.teamId);
  const abbreviations = [...new Set(selectedTeams.flatMap((team) => nflverseTeamCandidates(team.abbreviation)))];
  const sourceTeamIds = [...new Set([...canonicalTeamIds, ...abbreviations])];
  const [mappingRun] = await db.select().from(sleeperIdentityMappingRunsTable)
    .where(and(
      eq(sleeperIdentityMappingRunsTable.status, "success"),
      lte(sleeperIdentityMappingRunsTable.completedAt, cutoff),
    ))
    .orderBy(desc(sleeperIdentityMappingRunsTable.completedAt))
    .limit(1);
  const mappingsPromise: Promise<Array<typeof sleeperIdentityMappingsTable.$inferSelect>> = mappingRun && abbreviations.length
    ? db.select().from(sleeperIdentityMappingsTable).where(and(
      eq(sleeperIdentityMappingsTable.mappingRunId, mappingRun.mappingRunId),
      inArray(sleeperIdentityMappingsTable.normalizedTeam, abbreviations),
    ))
    : Promise.resolve([]);
  const [mappings, publishedDepth, snaps, historicalDepth, injuries, qbs] = await Promise.all([
    mappingsPromise,
    sourceTeamIds.length ? db.select().from(depthChartSnapshotsTable).where(and(
      inArray(depthChartSnapshotsTable.teamId, sourceTeamIds),
      gte(depthChartSnapshotsTable.snapshotTimestamp, recentCutoff),
      lte(depthChartSnapshotsTable.snapshotTimestamp, cutoff),
    )) : Promise.resolve([] as Array<typeof depthChartSnapshotsTable.$inferSelect>),
    sourceTeamIds.length ? db.select().from(snapCountsTable).where(and(
      inArray(snapCountsTable.teamId, sourceTeamIds),
      gte(snapCountsTable.sourceUpdatedAt, recentCutoff),
      lte(snapCountsTable.sourceUpdatedAt, cutoff),
    )) : Promise.resolve([] as Array<typeof snapCountsTable.$inferSelect>),
    sourceTeamIds.length ? db.select().from(historicalDepthChartTable).where(and(
      inArray(historicalDepthChartTable.teamId, sourceTeamIds),
      gte(historicalDepthChartTable.sourceUpdatedAt, historicalCutoff),
      lte(historicalDepthChartTable.sourceUpdatedAt, cutoff),
    )) : Promise.resolve([] as Array<typeof historicalDepthChartTable.$inferSelect>),
    canonicalTeamIds.length ? db.select().from(injuriesTable).where(and(
      inArray(injuriesTable.teamId, canonicalTeamIds),
      gte(injuriesTable.snapshotTimestamp, injuryCutoff),
      lte(injuriesTable.snapshotTimestamp, cutoff),
    )) : Promise.resolve([] as Array<typeof injuriesTable.$inferSelect>),
    sourceTeamIds.length ? db.select().from(qbGameStatsTable).where(and(
      inArray(qbGameStatsTable.teamId, sourceTeamIds),
      gte(qbGameStatsTable.sourceUpdatedAt, recentCutoff),
      lte(qbGameStatsTable.sourceUpdatedAt, cutoff),
    )) : Promise.resolve([] as Array<typeof qbGameStatsTable.$inferSelect>),
  ]);
  const sleeperPlayerIds = mappings.map((mapping) => mapping.sleeperPlayerId);
  const sleeperRows = mappingRun && sleeperPlayerIds.length
    ? await db.selectDistinctOn([sleeperPlayerSnapshotsTable.sleeperPlayerId])
      .from(sleeperPlayerSnapshotsTable).where(and(
      inArray(sleeperPlayerSnapshotsTable.sleeperPlayerId, sleeperPlayerIds),
      lte(sleeperPlayerSnapshotsTable.capturedAt, mappingRun.sourceCapturedAt ?? cutoff),
    )).orderBy(
      sleeperPlayerSnapshotsTable.sleeperPlayerId,
      desc(sleeperPlayerSnapshotsTable.capturedAt),
      desc(sleeperPlayerSnapshotsTable.id),
    )
    : [];
  const evidenceGameIds = [...new Set([...snaps, ...qbs].map((row) => row.gameId))];
  const games = evidenceGameIds.length
    ? await db.select().from(gamesTable).where(inArray(gamesTable.gameId, evidenceGameIds))
    : [];
  const mappingBySleeperId = new Map(mappings.map((mapping) => [mapping.sleeperPlayerId, mapping]));
  const reconstructedSleeperRows = reconstructLatestSleeperState(
    sleeperRows,
    mappingRun?.sourceCapturedAt ?? cutoff,
  );
  const sleeperDepth: CurrentDepthSource[] = reconstructedSleeperRows
    .filter((row) => row.depthChartOrder !== null)
    .flatMap((row) => {
      const mapping = mappingBySleeperId.get(row.sleeperPlayerId);
      if (!mapping?.mappedGridlinePlayerId || mapping.mappingStatus === "ambiguous" || mapping.mappingStatus === "unmatched") return [];
      const teamId = mapping.normalizedTeam ? normalizeTeamId(mapping.normalizedTeam, teamByAbbreviation) : null;
      if (!teamId) return [];
      return [{
        playerId: mapping.mappedGridlinePlayerId,
        playerName: row.fullName,
        teamId,
        sourceTeamId: row.team,
        position: row.depthChartPosition ?? row.position,
        role: row.depthChartPosition,
        depthOrder: row.depthChartOrder,
        source: "sleeper" as const,
        classification: "published_secondary" as const,
        capturedAt: row.capturedAt,
        sourceUpdatedAt: row.sourceTimestamp ?? row.capturedAt,
        mappingStatus: mapping.mappingStatus,
        mappingConfidence: mapping.mappingConfidence,
        sourcePlayerId: row.sleeperPlayerId,
        sourceTeamConflict: Boolean(mapping.teamChangeEvidence),
        mappingConflictReason: mapping.positionCompatibility === "incompatible"
          ? "Mapped identity has an incompatible position."
          : null,
        sleeperStatus: row.status,
        sleeperInjuryStatus: row.injuryStatus,
        sleeperPracticeParticipation: row.practiceParticipation,
      }];
    });
  const verifiedDepth: CurrentDepthSource[] = publishedDepth
    .filter((row) => row.source === "official_depth_chart" && row.classification === "official")
    .map((row) => ({
      playerId: row.playerId, playerName: row.playerName, teamId: normalizeTeamId(row.teamId, teamByAbbreviation),
      sourceTeamId: row.teamId, position: row.position, role: row.role, depthOrder: row.depthPosition,
      source: "verified_published_depth", classification: "official", capturedAt: row.snapshotTimestamp,
      sourceUpdatedAt: row.sourceUpdatedAt, mappingStatus: null, mappingConfidence: null,
    }));
  const kickoffByGame = new Map(games.map((game) => [game.gameId, game.kickoffTime]));
  return {
    teams: selectedTeams,
    mappingRun,
    publishedDepth: [...verifiedDepth, ...sleeperDepth],
    snaps: snaps.map((row) => ({
      ...row,
      sourceTeamId: row.teamId,
      teamId: normalizeTeamId(row.teamId, teamByAbbreviation),
      kickoffTime: kickoffByGame.get(row.gameId),
    })),
    historicalDepth: historicalDepth.map((row) => ({
      ...row,
      sourceTeamId: row.teamId,
      teamId: normalizeTeamId(row.teamId, teamByAbbreviation),
    })),
    injuries,
    qbs: qbs.map((row) => ({
      ...row,
      sourceTeamId: row.teamId,
      teamId: normalizeTeamId(row.teamId, teamByAbbreviation),
      kickoffTime: kickoffByGame.get(row.gameId),
    })),
  };
}

export async function getCurrentTeamDepth(teamIdentity: string, cutoff = new Date()): Promise<InterpretedTeamDepth | null> {
  const evidence = await currentEvidence(cutoff, [teamIdentity]);
  const normalized = teamIdentity.trim().toUpperCase();
  const team = evidence.teams.find((row) =>
    row.teamId === teamIdentity || row.abbreviation.toUpperCase() === normalized);
  if (!team) return null;
  return deriveCurrentTeamDepth({
    teamId: team.teamId,
    teamName: team.teamName,
    abbreviation: team.abbreviation,
    cutoff,
    publishedDepth: evidence.publishedDepth,
    snaps: evidence.snaps,
    historicalDepth: evidence.historicalDepth,
    injuries: evidence.injuries,
    qbs: evidence.qbs,
  });
}

export async function getCurrentGamePersonnel(gameId: string, cutoff = new Date()) {
  const [game] = await db.select().from(gamesTable).where(eq(gamesTable.gameId, gameId)).limit(1);
  if (!game) return null;
  const asOf = currentGamePersonnelCutoff(game.kickoffTime, cutoff);
  const evidence = await currentEvidence(asOf, [game.homeTeamId, game.awayTeamId]);
  const derive = (teamId: string) => {
    const team = evidence.teams.find((row) => row.teamId === teamId);
    return team ? deriveCurrentTeamDepth({
      teamId, teamName: team.teamName, abbreviation: team.abbreviation, cutoff: asOf,
      publishedDepth: evidence.publishedDepth, snaps: evidence.snaps,
      historicalDepth: evidence.historicalDepth, injuries: evidence.injuries, qbs: evidence.qbs,
    }) : null;
  };
  const home = derive(game.homeTeamId);
  const away = derive(game.awayTeamId);
  return {
    gameId,
    kickoffTime: game.kickoffTime?.toISOString() ?? null,
    asOf: asOf.toISOString(),
    teams: { home, away },
    matchupRoleEvidence: [
      {
        offenseTeamId: game.homeTeamId,
        defenseTeamId: game.awayTeamId,
        receivers: home?.wrRoles ?? [],
        opposingCorners: away?.cbRoles ?? [],
        directCoverageAssignments: null,
      },
      {
        offenseTeamId: game.awayTeamId,
        defenseTeamId: game.homeTeamId,
        receivers: away?.wrRoles ?? [],
        opposingCorners: home?.cbRoles ?? [],
        directCoverageAssignments: null,
      },
    ],
    limitation: "WR and CB role evidence is matchup-ready context; it does not claim direct coverage assignments.",
  };
}

export async function getCurrentQbEvidence(teamIdentity: string, cutoff = new Date()) {
  const team = await getCurrentTeamDepth(teamIdentity, cutoff);
  return team ? { teamId: team.teamId, asOf: team.asOf, qbStarter: team.qbStarter } : null;
}

export async function getCurrentWrCbEvidence(teamIdentity: string, cutoff = new Date()) {
  const team = await getCurrentTeamDepth(teamIdentity, cutoff);
  return team ? {
    teamId: team.teamId,
    asOf: team.asOf,
    receivers: team.wrRoles,
    cornerbacks: team.cbRoles,
    directCoverageAssignments: null,
    limitation: "Roles describe depth and participation evidence only.",
  } : null;
}

export async function getCurrentDepthValidationReport(cutoff = new Date()) {
  const evidence = await currentEvidence(cutoff);
  const teams = await mapBounded(evidence.teams, async (team) => deriveCurrentTeamDepth({
    teamId: team.teamId, teamName: team.teamName, abbreviation: team.abbreviation, cutoff,
    publishedDepth: evidence.publishedDepth, snaps: evidence.snaps,
    historicalDepth: evidence.historicalDepth, injuries: evidence.injuries,
    qbs: evidence.qbs,
  }));
  const qbAvailable = teams.filter((team) => team.qbStarter.status === "available").length;
  const qbConflicts = teams.filter((team) => team.qbStarter.status === "conflict").length;
  const positions = [...new Set(teams.flatMap((team) =>
    [...team.depth.offense, ...team.depth.defense, ...team.depth.specialTeams].map((row) => row.position).filter(Boolean)))].sort();
  return {
    asOf: cutoff.toISOString(),
    expectedTeamCount: 32,
    observedTeamCount: teams.length,
    allTeamsCovered: teams.length === 32,
    qbAgreement: {
      available: qbAvailable,
      conflicts: qbConflicts,
      unavailable: teams.length - qbAvailable - qbConflicts,
      percentage: teams.length ? Math.round(qbAvailable / teams.length * 100) : 0,
      teams: teams.map((team) => ({
        teamId: team.teamId,
        abbreviation: team.abbreviation,
        status: team.qbStarter.status,
        playerId: team.qbStarter.player?.playerId ?? null,
        playerName: team.qbStarter.player?.playerName ?? null,
        confidence: team.qbStarter.confidence,
        unavailableReason: team.qbStarter.unavailableReason,
      })),
    },
    allTeamRequiredRoles: teams.map((team) => ({
      teamId: team.teamId,
      abbreviation: team.abbreviation,
      qb1: team.qbStarter.player,
      rb1: team.depth.offense.filter((row) => row.position === "RB" && row.rank === 1),
      topThreeWr: team.wrRoles.slice(0, 3),
      te1: team.depth.offense.filter((row) => row.position === "TE" && row.rank === 1),
      cb1Cb2: team.cbRoles.filter((row) => row.rank === 1 || row.rank === 2),
    })),
    positionalCoverage: Object.fromEntries(positions.map((position) => [
      position!,
      Math.round(teams.filter((team) =>
        [...team.depth.offense, ...team.depth.defense, ...team.depth.specialTeams]
          .some((row) => row.position === position)).length / Math.max(1, teams.length) * 100),
    ])),
    conflictSummary: {
      provider: teams.reduce((sum, team) => sum + team.conflicts.filter((item) => item.type === "provider").length, 0),
      team: teams.reduce((sum, team) => sum + team.conflicts.filter((item) => item.type === "team").length, 0),
      depthOrder: teams.reduce((sum, team) => sum + team.conflicts.filter((item) => item.type === "depth_order").length, 0),
      participation: teams.reduce((sum, team) => sum + team.conflicts.filter((item) => item.type === "participation").length, 0),
      injury: teams.reduce((sum, team) => sum + team.conflicts.filter((item) => item.type === "injury").length, 0),
      identity: teams.reduce((sum, team) => sum + team.conflicts.filter((item) => item.type === "identity").length, 0),
    },
    tenTeamSourceComparison: teams.slice(0, TEN_TEAM_SAMPLE).map((team) => ({
      teamId: team.teamId,
      abbreviation: team.abbreviation,
      freshness: team.freshness,
      qbStatus: team.qbStarter.status,
      publishedPlayers: [...team.depth.offense, ...team.depth.defense, ...team.depth.specialTeams]
        .filter((row) => row.sourceClassification !== "inferred").length,
      inferredPlayers: [...team.depth.offense, ...team.depth.defense, ...team.depth.specialTeams]
        .filter((row) => row.sourceClassification === "inferred").length,
      conflicts: team.conflicts.length,
      requiredRoles: {
        qb1: team.qbStarter.player ? {
          playerId: team.qbStarter.player.playerId,
          playerName: team.qbStarter.player.playerName,
          rank: team.qbStarter.player.rank,
          source: team.qbStarter.player.providerLabel,
          recentSnapShare: team.qbStarter.player.recentSnapShare,
          injury: team.qbStarter.player.injuryState,
          finalStatus: team.qbStarter.status,
        } : null,
        rb1: team.depth.offense.filter((row) => row.position === "RB" && row.rank === 1),
        topThreeWr: team.wrRoles.slice(0, 3),
        te1: team.depth.offense.filter((row) => row.position === "TE" && row.rank === 1),
        cb1Cb2: team.cbRoles.filter((row) => row.rank === 1 || row.rank === 2),
      },
      evidenceComparison: {
        sleeper: [...team.depth.offense, ...team.depth.defense, ...team.depth.specialTeams]
          .flatMap((row) => row.providerEvidence
            .filter((evidence) => evidence.source === "sleeper")
            .map((evidence) => ({ playerId: row.playerId, position: row.position, rank: evidence.rank, capturedAt: evidence.capturedAt }))),
        participation: [...team.depth.offense, ...team.depth.defense, ...team.depth.specialTeams]
          .filter((row) => row.recentGames > 0)
          .map((row) => ({ playerId: row.playerId, position: row.position, recentGames: row.recentGames, recentSnapShare: row.recentSnapShare })),
        espnInjuries: [...team.depth.offense, ...team.depth.defense, ...team.depth.specialTeams]
          .filter((row) => row.injuryState.asOf)
          .map((row) => ({ playerId: row.playerId, gameStatus: row.injuryState.gameStatus, asOf: row.injuryState.asOf })),
        finalInterpretation: [...team.depth.offense, ...team.depth.defense, ...team.depth.specialTeams]
          .filter((row) => row.starter)
          .map((row) => ({ playerId: row.playerId, position: row.position, confidence: row.confidence })),
      },
    })),
    endpointAvailability: {
      teamDepth: "/features/personnel/current/team/:teamId",
      gameComparison: "/features/personnel/current/game/:gameId",
      qbEvidence: "/features/personnel/current/team/:teamId/qb",
      wrCbEvidence: "/features/personnel/current/team/:teamId/wr-cb",
      validation: "/features/personnel/current/validation",
      authorization: "administrator_required",
    },
    downstreamReadiness: {
      readyTeams: teams.filter((team) => team.downstreamReady).length,
      totalTeams: teams.length,
      ready: teams.length === 32 && teams.every((team) => team.downstreamReady),
      reasons: teams.filter((team) => !team.downstreamReady).map((team) => ({
        teamId: team.teamId,
        reasons: team.unavailableReasons,
      })),
    },
    sourceState: {
      mappingRunId: evidence.mappingRun?.mappingRunId ?? null,
      mappingVersion: evidence.mappingRun?.mappingVersion ?? null,
      sourceCapturedAt: evidence.mappingRun?.sourceCapturedAt?.toISOString() ?? null,
      sleeperClassification: "published_secondary",
      rawProviderPayloadExposed: false,
    },
    phase61Boundary: {
      unchanged: true,
      interpretationOnly: true,
      featureSchemaChanged: false,
      modelTrainingChanged: false,
      predictionPathChanged: false,
    },
  };
}

/** Evaluation-only normalized evidence; it does not alter source precedence. */
export async function getCurrentDepthComparisonEvidence(cutoff = new Date()) {
  const evidence = await currentEvidence(cutoff);
  const teams = await mapBounded(evidence.teams, async (team) => deriveCurrentTeamDepth({
    teamId: team.teamId,
    teamName: team.teamName,
    abbreviation: team.abbreviation,
    cutoff,
    publishedDepth: evidence.publishedDepth,
    snaps: evidence.snaps,
    historicalDepth: evidence.historicalDepth,
    injuries: evidence.injuries,
    qbs: evidence.qbs,
  }));
  return teams.map((team) => ({
    team: team.abbreviation,
    players: [...team.depth.offense, ...team.depth.defense, ...team.depth.specialTeams].map((player) => ({
      playerId: player.playerId,
      position: player.position,
      role: player.role,
      rank: player.rank,
      starter: player.starter,
      source: player.source,
      recentGames: player.recentGames,
      recentSnapShare: player.recentSnapShare,
      injuryState: player.injuryState,
    })),
    conflicts: team.conflicts,
  }));
}