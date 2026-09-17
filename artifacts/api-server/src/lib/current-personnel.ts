import { and, desc, eq, gte, inArray, lte } from "drizzle-orm";
import {
  db,
  depthChartSnapshotsTable,
  gamesTable,
  historicalDepthChartTable,
  injuriesTable,
  playersTable,
  qbGameStatsTable,
  sleeperIdentityMappingRunsTable,
  sleeperIdentityMappingsTable,
  sleeperPlayerSnapshotsTable,
  snapCountsTable,
  teamsTable,
  verifiedDepthEvidenceTable,
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
export const VERIFIED_ROLE_CARDS = [
  "QB1", "QB2", "RB1", "RB2", "WR1", "WR2", "WR3", "TE1",
  "LT1", "LG1", "C1", "RG1", "RT1", "DT1", "DT2", "LB1", "LB2",
  "CB1", "CB2", "CB3_OR_SLOT", "FS1", "SS1", "EDGE1", "EDGE2", "K1", "P1", "LS1",
] as const;

export function reconstructLatestVerifiedDepthState<T extends {
  teamId: string; role: string | null; position: string | null;
  depthRank: number | null; observedAt: Date; id: number;
}>(rows: T[]) {
  const latest = new Map<string, T>();
  for (const row of rows.sort((a, b) =>
    a.observedAt.getTime() - b.observedAt.getTime() || a.id - b.id)) {
    const base = `${row.teamId}:${(row.role ?? row.position ?? "UNKNOWN").trim().toUpperCase()}`;
    if (row.depthRank === null) {
      for (const key of latest.keys()) if (key.startsWith(`${base}:`)) latest.delete(key);
    } else {
      latest.delete(`${base}:ALL`);
    }
    const key = `${base}:${row.depthRank ?? "ALL"}`;
    const prior = latest.get(key);
    if (!prior || row.observedAt.getTime() > prior.observedAt.getTime()
      || (row.observedAt.getTime() === prior.observedAt.getTime() && row.id > prior.id)) latest.set(key, row);
  }
  return [...latest.values()];
}

export function verifiedEvidenceAtCutoff<T extends {
  observedAt: Date; verifiedAt: Date;
}>(rows: T[], cutoff: Date) {
  const cutoffTime = cutoff.getTime();
  return rows.filter((row) =>
    row.observedAt.getTime() <= cutoffTime
    && row.verifiedAt.getTime() <= cutoffTime);
}

export function roleCardForPlayer(player: { position: string | null; role: string | null; rank: number | null }) {
  const role = player.role?.toUpperCase() ?? "";
  const position = player.position?.toUpperCase() ?? "";
  if ((VERIFIED_ROLE_CARDS as readonly string[]).includes(role)) return role;
  if (["LT", "LG", "C", "RG", "RT"].includes(role) && player.rank === 1) return `${role}1`;
  if (["FS", "SS"].includes(role) && player.rank === 1) return `${role}1`;
  if (position === "CB" && player.rank && player.rank <= 3) return player.rank === 3 ? "CB3_OR_SLOT" : `CB${player.rank}`;
  if (position === "EDGE" && player.rank && player.rank <= 2) return `EDGE${player.rank}`;
  if (position === "DT" && player.rank && player.rank <= 2) return `DT${player.rank}`;
  if (position === "LB" && player.rank && player.rank <= 2) return `LB${player.rank}`;
  if (["QB", "RB", "WR", "TE", "K", "P", "LS"].includes(position) && player.rank && player.rank <= 3) {
    return `${position}${player.rank}`;
  }
  return null;
}

export function requiredDepthRankForRoleCard(card: typeof VERIFIED_ROLE_CARDS[number]) {
  return card === "QB2" || card === "RB2" ? 2 : 1;
}

function matchesRequiredRoleCard(
  player: { position: string | null; role: string | null; rank: number | null },
  card: typeof VERIFIED_ROLE_CARDS[number],
) {
  const derived = roleCardForPlayer(player);
  const roleMatches = derived === card
    || (card === "CB3_OR_SLOT" && player.position === "CB"
      && ["SCB", "NCB"].includes(player.role?.toUpperCase() ?? ""));
  return roleMatches && player.rank === requiredDepthRankForRoleCard(card);
}

export function isLowerPriorityDepthSuperseded(
  row: Pick<CurrentDepthSource, "teamId" | "position" | "role" | "depthOrder">,
  latestEvidence: Array<{ teamId: string; position: string | null; role: string | null; depthRank: number | null }>,
) {
  const card = roleCardForPlayer({ position: row.position, role: row.role, rank: row.depthOrder });
  return Boolean(card && latestEvidence.some((evidence) =>
    evidence.teamId === row.teamId
    && roleCardForPlayer({ position: evidence.position, role: evidence.role, rank: evidence.depthRank }) === card));
}

export function roleCardAudit(team: InterpretedTeamDepth | null) {
  const players = team ? [...team.depth.offense, ...team.depth.defense, ...team.depth.specialTeams] : [];
  const currentOfficialByCard = new Map(VERIFIED_ROLE_CARDS.map((card) => [
    card,
    players.filter((player) => player.sourceClassification === "official"
      && player.freshness === "current"
      && matchesRequiredRoleCard(player, card)),
  ]));
  const cardsByPlayer = new Map<string, Set<string>>();
  for (const [card, matches] of currentOfficialByCard) {
    for (const player of matches) {
      const prior = cardsByPlayer.get(player.playerId) ?? new Set<string>();
      prior.add(card);
      cardsByPlayer.set(player.playerId, prior);
    }
  }
  const identityCollisions = [...cardsByPlayer]
    .filter(([, cards]) => cards.size > 1)
    .map(([playerId, cards]) => ({ playerId, cards: [...cards].sort() }));
  const collisionCards = new Set(identityCollisions.flatMap((collision) => collision.cards));
  const cards = Object.fromEntries(VERIFIED_ROLE_CARDS.map((card) => {
    const matches = players.filter((player) => matchesRequiredRoleCard(player, card));
    const currentMatches = matches.filter((player) => player.freshness === "current");
    const verified = currentMatches.filter((player) => player.sourceClassification === "official");
    const published = currentMatches.filter((player) => player.sourceClassification !== "inferred");
    const projected = currentMatches.filter((player) => player.sourceClassification === "inferred");
    const ambiguous = collisionCards.has(card)
      || matches.some((player) => player.conflicts.some((conflict) => conflict.severity === "blocking"));
    const currentVerified = (currentOfficialByCard.get(card) ?? []).length > 0;
    return [card, {
      verified: verified.length > 0 ? 100 : 0,
      published: published.length > 0 ? 100 : 0,
      projected: projected.length > 0 ? 100 : 0,
      unknown: currentMatches.length ? 0 : 100,
      ambiguous: ambiguous ? 100 : 0,
      currentVerified,
      playerIds: matches.map((player) => player.playerId),
      requiredDepthRank: requiredDepthRankForRoleCard(card),
    }];
  }));
  const values = Object.values(cards);
  return {
    cards,
    identityCollisions,
    completeVerified: identityCollisions.length === 0
      && values.every((card) => card.verified === 100 && card.currentVerified && card.ambiguous === 0),
    percentages: {
      verified: values.length ? Math.round(values.reduce((sum, card) => sum + card.verified, 0) / values.length) : 0,
      published: values.length ? Math.round(values.reduce((sum, card) => sum + card.published, 0) / values.length) : 0,
      projected: values.length ? Math.round(values.reduce((sum, card) => sum + card.projected, 0) / values.length) : 0,
      unknown: values.length ? Math.round(values.reduce((sum, card) => sum + card.unknown, 0) / values.length) : 100,
      ambiguous: values.length ? Math.round(values.reduce((sum, card) => sum + card.ambiguous, 0) / values.length) : 0,
    },
  };
}

export function roleCardCoverageState(
  team: InterpretedTeamDepth,
  card: (typeof VERIFIED_ROLE_CARDS)[number],
  explicitState?: string,
): "verified" | "published" | "projected" | "unknown" | "ambiguous" {
  const players = [...team.depth.offense, ...team.depth.defense, ...team.depth.specialTeams]
    .filter((player) => matchesRequiredRoleCard(player, card));
  const cardBasePosition = card.replace(/[123]$/, "").replace("_OR_SLOT", "");
  const hasBlockingConflict = team.conflicts.some((conflict) =>
    conflict.severity === "blocking"
    && (conflict.position === card || conflict.position === cardBasePosition
      || (card === "CB3_OR_SLOT" && conflict.position === "CB")));
  if (hasBlockingConflict || explicitState === "ambiguous") return "ambiguous";
  const currentPlayers = players.filter((player) => player.freshness === "current");
  if (currentPlayers.some((player) => player.sourceClassification === "official")) return "verified";
  if (currentPlayers.some((player) => player.sourceClassification === "published_secondary")) return "published";
  if (currentPlayers.some((player) => player.sourceClassification === "inferred")) return "projected";
  return "unknown";
}

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
  const loadVerifiedEvidence = canonicalTeamIds.length
    ? db.select().from(verifiedDepthEvidenceTable).where(and(
      inArray(verifiedDepthEvidenceTable.teamId, canonicalTeamIds),
      lte(verifiedDepthEvidenceTable.observedAt, cutoff),
      lte(verifiedDepthEvidenceTable.verifiedAt, cutoff),
    )).catch((error: unknown) => {
      // Older development databases may predate the append-only migration.
      // Treat that schema state as unavailable evidence, not as fabricated depth.
      const code = (error as { cause?: { code?: string }; code?: string })?.cause?.code
        ?? (error as { code?: string })?.code;
      if (code === "42P01") return [] as Array<typeof verifiedDepthEvidenceTable.$inferSelect>;
      throw error;
    })
    : Promise.resolve([] as Array<typeof verifiedDepthEvidenceTable.$inferSelect>);
  const [mappings, publishedDepth, verifiedEvidence, snaps, historicalDepth, injuries, qbs] = await Promise.all([
    mappingsPromise,
    sourceTeamIds.length ? db.select().from(depthChartSnapshotsTable).where(and(
      inArray(depthChartSnapshotsTable.teamId, sourceTeamIds),
      gte(depthChartSnapshotsTable.snapshotTimestamp, recentCutoff),
      lte(depthChartSnapshotsTable.snapshotTimestamp, cutoff),
    )) : Promise.resolve([] as Array<typeof depthChartSnapshotsTable.$inferSelect>),
    loadVerifiedEvidence,
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
  // Verified evidence is a snapshot stream, not a bag of facts. Select the
  // latest observation for each team/role before materializing depth. A
  // tombstone (unavailable/ambiguous) intentionally suppresses older verified
  // rows, so a departed starter cannot remain current forever.
  const latestVerifiedEvidence = reconstructLatestVerifiedDepthState(
    verifiedEvidenceAtCutoff(verifiedEvidence, cutoff),
  );
  const injuryPlayerIds = [...new Set(injuries.map((injury) => injury.playerId))];
  const injuryPlayers = injuryPlayerIds.length
    ? await db.select({ playerId: playersTable.playerId, name: playersTable.name })
      .from(playersTable).where(inArray(playersTable.playerId, injuryPlayerIds))
    : [];
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
  const manuallyVerifiedDepth: CurrentDepthSource[] = latestVerifiedEvidence
    .filter((row) => row.evidenceState === "verified" && Boolean(row.playerId))
    .map((row) => ({
      playerId: row.playerId!,
      playerName: row.playerName,
      teamId: row.teamId,
      sourceTeamId: row.teamId,
      position: row.position,
      role: row.role,
      depthOrder: row.depthRank,
      source: "verified_published_depth" as const,
      classification: "official" as const,
      // Freshness is evidence freshness, never database insertion time.
      capturedAt: row.observedAt,
      sourceUpdatedAt: row.observedAt,
      observedAt: row.observedAt,
      verifiedAt: row.verifiedAt,
      sourceUrl: row.sourceUrl,
      verificationMethod: row.verificationMethod,
      evidenceId: String(row.id),
      availability: row.availability,
      injuryStatus: row.injuryStatus,
      provenance: row.provenance,
      mappingStatus: "manual_verified",
      mappingConfidence: row.confidence === null ? null : row.confidence / 100,
    }));
  const isSupersededByManualEvidence = (row: CurrentDepthSource) =>
    isLowerPriorityDepthSuperseded(row, latestVerifiedEvidence);
  const kickoffByGame = new Map(games.map((game) => [game.gameId, game.kickoffTime]));
  return {
    teams: selectedTeams,
    mappingRun,
    verifiedEvidence: latestVerifiedEvidence,
    publishedDepth: [
      ...verifiedDepth.filter((row) => !isSupersededByManualEvidence(row)),
      ...manuallyVerifiedDepth,
      ...sleeperDepth.filter((row) => !isSupersededByManualEvidence(row)),
    ],
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
    playerNames: Object.fromEntries(injuryPlayers.map((player) => [player.playerId, player.name])),
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
    playerNames: evidence.playerNames,
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
      season: game.season,
      publishedDepth: evidence.publishedDepth, snaps: evidence.snaps,
      historicalDepth: evidence.historicalDepth, injuries: evidence.injuries, qbs: evidence.qbs,
      playerNames: evidence.playerNames,
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
  const requiredPositions = [...VERIFIED_ROLE_CARDS];
  const verifiedStateByTeamPosition = new Map(
    evidence.verifiedEvidence.map((row) => [`${row.teamId}:${(row.role ?? row.position ?? "UNKNOWN").toUpperCase()}`, row.evidenceState]),
  );
  const coverageRows = teams.flatMap((team) => requiredPositions.map((position) => {
    const explicitState = verifiedStateByTeamPosition.get(`${team.teamId}:${position}`);
    const state = roleCardCoverageState(team, position, explicitState);
    return {
      teamId: team.teamId, abbreviation: team.abbreviation, position, role: position, state,
      sourceUrl: evidence.verifiedEvidence.find((row) => row.teamId === team.teamId
        && (row.role ?? "").toUpperCase() === position)?.sourceUrl ?? null,
      provenance: evidence.verifiedEvidence.find((row) => row.teamId === team.teamId
        && (row.role ?? "").toUpperCase() === position)?.provenance ?? null,
    };
  }));
  const stateCount = (state: string, rows = coverageRows) => rows.filter((row) => row.state === state).length;
  const coverageSummary = (rows: typeof coverageRows) => {
    const denominator = Math.max(1, rows.length);
    return Object.fromEntries(["verified", "published", "projected", "unknown", "ambiguous"].map((state) => [
      state,
      { count: stateCount(state, rows), percentage: Math.round(stateCount(state, rows) / denominator * 100) },
    ]));
  };
  const truthCoverage = {
    requestedPositions: requiredPositions,
    totalSlots: coverageRows.length,
    overall: coverageSummary(coverageRows),
    byPosition: Object.fromEntries(requiredPositions.map((position) => [
      position,
      coverageSummary(coverageRows.filter((row) => row.position === position)),
    ])),
    teams: coverageRows,
  };
  const allTeamReady = teams.length === 32
    && coverageRows.every((row) => row.state === "verified")
    && teams.every((team) => roleCardAudit(team).completeVerified)
    && teams.every((team) => team.expectedLineup?.status === "available")
    && !teams.some((team) => team.conflicts.some((conflict) => conflict.severity === "blocking"));
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
    truthCoverage,
    allTeamVerdict: {
      ready: allTeamReady,
      verdict: allTeamReady ? "ready" : "not_ready",
      rule: "All 32 teams must have current verified evidence for every requested role card, with no blocking ambiguity.",
    },
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

/** Consumer-safe audit summary; no readiness is forced when DET/BUF evidence is absent. */
export async function getDetBufPersonnelReport(cutoff = new Date()) {
  const evidence = await currentEvidence(cutoff, ["DET", "BUF"]);
  const teams = await Promise.all(["DET", "BUF"].map((team) => getCurrentTeamDepth(team, cutoff)));
  const teamReports = teams.map((team, index) => ({
    team: ["DET", "BUF"][index],
    available: Boolean(team),
    depth: team?.depth ?? { offense: [], defense: [], specialTeams: [], unknown: [] },
    injuries: team?.injuryReport ?? [],
    expectedLineup: team?.expectedLineup ?? {
      status: "unavailable" as const,
      players: [],
      unavailableReasons: ["No verified current evidence is available."],
    },
    conflicts: team?.conflicts ?? [],
    freshness: team?.freshness ?? "unavailable" as const,
    roleCards: roleCardAudit(team),
    verifiedEvidence: evidence.verifiedEvidence
      .filter((row) => row.teamId === team?.teamId)
      .map((row) => ({
        evidenceState: row.evidenceState,
        playerId: row.playerId,
        playerName: row.playerName,
        position: row.position,
        role: row.role,
        rank: row.depthRank,
        confidence: row.confidence,
        availability: row.availability,
        injuryStatus: row.injuryStatus,
        source: row.source,
        sourceUrl: row.sourceUrl,
        observedAt: row.observedAt.toISOString(),
        verifiedAt: row.verifiedAt.toISOString(),
        verificationMethod: row.verificationMethod,
        provenance: row.provenance,
      })),
  }));
  const ready = teamReports.every((team) => team.available
    && team.freshness === "current"
    && team.expectedLineup.status === "available"
    && team.roleCards.completeVerified
    && team.verifiedEvidence.some((row) => row.evidenceState === "verified")
    && !team.conflicts.some((conflict) => conflict.severity === "blocking"));
  return {
    matchup: "DET-BUF",
    asOf: cutoff.toISOString(),
    ready,
    verdict: ready ? "ready" : "not_ready",
    evidencePolicy: "Permitted authoritative or safe manual verification only; missing evidence remains unavailable.",
    teams: teamReports,
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