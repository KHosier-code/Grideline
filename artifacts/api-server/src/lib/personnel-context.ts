import { eq, inArray } from "drizzle-orm";
import {
  db,
  depthChartSnapshotsTable,
  gamesTable,
  historicalDepthChartTable,
  injuriesTable,
  playerGameStatsTable,
  pregameTeamFeaturesTable,
  qbGameStatsTable,
  snapCountsTable,
  sportsbookOddsTable,
  teamsTable,
  weatherForecastSnapshotsTable,
  type PregameFeatureAuditEntry,
} from "@workspace/db";
import {
  derivePersonnelContext,
  personnelNumericFeatures,
  type PersonnelContext,
  type PersonnelDepthRow,
  type PersonnelHistoricalDepthRow,
  type PersonnelInjuryRow,
  type PersonnelOddsRow,
  type PersonnelPriorGame,
  type PersonnelQbRow,
  type PersonnelSnapRow,
  normalizeTeamId,
  nflverseTeamCandidates,
} from "./personnel-context-derivation";

export const PREGAME_PERSONNEL_CONTEXT_VERSION = "pregame-v4-personnel-context" as const;

function contextGame(row: typeof gamesTable.$inferSelect) {
  return {
    gameId: row.gameId,
    season: row.season,
    week: row.week,
    kickoffTime: row.kickoffTime,
    homeTeamId: row.homeTeamId,
    awayTeamId: row.awayTeamId,
  };
}

export async function getPersonnelContextForGame(gameId: string, now = new Date()): Promise<PersonnelContext | null> {
  const [game] = await db.select().from(gamesTable).where(eq(gamesTable.gameId, gameId)).limit(1);
  if (!game) return null;
  const cutoff = new Date(Math.min(
    now.getTime(),
    game.kickoffTime ? game.kickoffTime.getTime() - 1 : now.getTime(),
  ));
  const teamIds = [game.homeTeamId, game.awayTeamId];
  // ESPN schedule rows use numeric IDs while nflverse participation/depth rows
  // use abbreviations. Resolve source identifiers once at this boundary so
  // derivation receives one canonical ID space and can never silently filter
  // out legitimate historical evidence.
  const allTeams = await db.select().from(teamsTable);
  const teamByAbbreviation = new Map(allTeams.map((team) => [team.abbreviation.toUpperCase(), team.teamId]));
  const sourceTeamIds = [...new Set(teamIds.flatMap((teamId) => {
    const team = allTeams.find((row) => row.teamId === teamId);
    return team ? [teamId, ...nflverseTeamCandidates(team.abbreviation)] : [teamId];
  }))];
  const [depth, historicalDepth, injuries, snaps, qbRows, playerRows, priorGames, odds, weatherRows] = await Promise.all([
    db.select().from(depthChartSnapshotsTable).where(inArray(depthChartSnapshotsTable.teamId, sourceTeamIds)),
    db.select().from(historicalDepthChartTable).where(inArray(historicalDepthChartTable.teamId, sourceTeamIds)),
    db.select().from(injuriesTable).where(inArray(injuriesTable.teamId, teamIds)),
    db.select().from(snapCountsTable).where(inArray(snapCountsTable.teamId, sourceTeamIds)),
    db.select().from(qbGameStatsTable).where(inArray(qbGameStatsTable.teamId, sourceTeamIds)),
    db.select().from(playerGameStatsTable).where(inArray(playerGameStatsTable.teamId, sourceTeamIds)),
    db.select().from(gamesTable),
    db.select().from(sportsbookOddsTable).where(eq(sportsbookOddsTable.gameId, gameId)),
    db.select().from(weatherForecastSnapshotsTable).where(eq(weatherForecastSnapshotsTable.gameId, gameId)),
  ]);
  const canonicalDepth = depth.map((row) => ({ ...row, sourceTeamId: row.teamId, teamId: normalizeTeamId(row.teamId, teamByAbbreviation) }));
  const canonicalHistoricalDepth = historicalDepth.map((row) => ({ ...row, sourceTeamId: row.teamId, teamId: normalizeTeamId(row.teamId, teamByAbbreviation) }));
  const canonicalSnaps = snaps.map((row) => ({ ...row, sourceTeamId: row.teamId, teamId: normalizeTeamId(row.teamId, teamByAbbreviation) }));
  const playerNameById = new Map(
    playerRows
      .filter((row) => row.sourceUpdatedAt.getTime() <= cutoff.getTime())
      .map((row) => [`${row.teamId}:${row.playerId}`, row.playerName]),
  );
  const canonicalQbs = qbRows.map((row) => ({
    ...row,
    playerName: playerNameById.get(`${row.teamId}:${row.playerId}`) ?? null,
    sourceTeamId: row.teamId,
    teamId: normalizeTeamId(row.teamId, teamByAbbreviation),
  }));
  const gameById = new Map(priorGames.map((row) => [row.gameId, row]));
  const prior: PersonnelPriorGame[] = priorGames
    .filter((row) => row.gameId !== gameId && (row.homeTeamId === game.homeTeamId || row.awayTeamId === game.homeTeamId || row.homeTeamId === game.awayTeamId || row.awayTeamId === game.awayTeamId))
    .flatMap((row) => [
      {
        gameId: row.gameId,
        teamId: row.homeTeamId,
        kickoffTime: row.kickoffTime,
        isHome: true,
        finalHomeScore: row.finalHomeScore,
        finalAwayScore: row.finalAwayScore,
      },
      {
        gameId: row.gameId,
        teamId: row.awayTeamId,
        kickoffTime: row.kickoffTime,
        isHome: false,
        finalHomeScore: row.finalHomeScore,
        finalAwayScore: row.finalAwayScore,
      },
    ]);
  const qbWithKickoff: PersonnelQbRow[] = canonicalQbs
    .map((row) => {
      const sourceGame = gameById.get(row.gameId);
      return {
        ...row,
        kickoffTime: sourceGame?.kickoffTime,
      };
    })
    .filter((row) =>
      row.sourceUpdatedAt.getTime() <= cutoff.getTime()
      && (
        row.season < game.season
        || Boolean(row.kickoffTime && row.kickoffTime.getTime() < cutoff.getTime())
      ),
    );
  const snapsWithKickoff: PersonnelSnapRow[] = canonicalSnaps.map((row) => ({
    ...row,
    kickoffTime: gameById.get(row.gameId)?.kickoffTime,
  }));
  const context = derivePersonnelContext({
    game: contextGame(game),
    now,
    depth: canonicalDepth as PersonnelDepthRow[],
    historicalDepth: canonicalHistoricalDepth as PersonnelHistoricalDepthRow[],
    injuries: injuries as PersonnelInjuryRow[],
    snaps: snapsWithKickoff,
    qbs: qbWithKickoff,
    priorGames: prior,
    odds: odds as PersonnelOddsRow[],
    weather: weatherRows,
  });
  const teamById = new Map(allTeams.map((team) => [team.teamId, team]));
  for (const [teamId, teamContext] of Object.entries(context.teams)) {
    const team = teamById.get(teamId);
    if (team) Object.assign(teamContext, { teamName: team.teamName, abbreviation: team.abbreviation });
  }
  return context;
}

function auditForNumericFeatures(context: PersonnelContext, features: Record<string, number | null>) {
  const result: Record<string, PregameFeatureAuditEntry> = {};
  for (const [featureName, value] of Object.entries(features)) {
    const teamId = featureName.match(/^personnel\.([^\.]+)\./)?.[1];
    const team = teamId ? context.teams[teamId] : null;
    result[featureName] = {
      value,
      sourceDataset: "phase7_personnel_context",
      lookbackWindow: "as_of_cutoff",
      gamesIncluded: team?.qb.metricsSampleGames ?? context.market.observations,
      lastSourceGame: null,
      lastSourceDate: context.sourceCutoff,
      sampleSize: value === null ? 0 : 1,
      quality: value === null ? "unavailable" : "high",
      ...(value === null ? { unavailableReason: "The immutable sources do not provide this field as of the cutoff." } : {}),
    };
  }
  return result;
}

export async function rebuildPregamePersonnelContextFeatures() {
  const v3Rows = await db.select().from(pregameTeamFeaturesTable)
    .where(eq(pregameTeamFeaturesTable.featureVersion, "pregame-v3"));
  const rows: Array<typeof pregameTeamFeaturesTable.$inferInsert> = [];
  let contextsBuilt = 0;
  let unavailableGames = 0;
  for (const row of v3Rows) {
    const context = await getPersonnelContextForGame(row.gameId);
    if (!context) {
      unavailableGames += 1;
      continue;
    }
    contextsBuilt += 1;
    const numeric = personnelNumericFeatures(context);
    const audit = auditForNumericFeatures(context, numeric);
    const sourceCutoff = new Date(context.sourceCutoff);
    rows.push({
      featureVersion: PREGAME_PERSONNEL_CONTEXT_VERSION,
      gameId: row.gameId,
      teamId: row.teamId,
      opponentTeamId: row.opponentTeamId,
      season: row.season,
      week: row.week,
      kickoffTime: row.kickoffTime,
      isHome: row.isHome,
      // v3 is never updated.  v4 is an additive immutable row.
      features: { ...row.features, ...numeric },
      sampleCounts: { ...row.sampleCounts, ...Object.fromEntries(Object.entries(numeric).map(([key, value]) => [key, value === null ? 0 : 1])) },
      featureAudit: {
        ...row.featureAudit,
        ...audit,
        _personnel_context: context as unknown as PregameFeatureAuditEntry,
      },
      lowSample: row.lowSample || Object.values(numeric).some((value) => value === null),
      sourceCutoff,
      generatedAt: new Date(),
    });
  }
  for (let index = 0; index < rows.length; index += 250) {
    await db.insert(pregameTeamFeaturesTable).values(rows.slice(index, index + 250)).onConflictDoNothing({
      target: [pregameTeamFeaturesTable.featureVersion, pregameTeamFeaturesTable.gameId, pregameTeamFeaturesTable.teamId],
    });
  }
  return {
    featureVersion: PREGAME_PERSONNEL_CONTEXT_VERSION,
    sourceFeatureVersion: "pregame-v3",
    gamesConsidered: new Set(v3Rows.map((row) => row.gameId)).size,
    rowsGenerated: rows.length,
    contextsBuilt,
    unavailableGames,
    immutable: true,
  };
}

export async function listPersonnelContextAudit(filters: {
  gameId?: string;
  teamId?: string;
  season?: number;
  week?: number;
}) {
  const rows = await db.select().from(pregameTeamFeaturesTable)
    .where(eq(pregameTeamFeaturesTable.featureVersion, PREGAME_PERSONNEL_CONTEXT_VERSION));
  return rows
    .filter((row) => !filters.gameId || row.gameId === filters.gameId)
    .filter((row) => !filters.teamId || row.teamId === filters.teamId)
    .filter((row) => filters.season === undefined || row.season === filters.season)
    .filter((row) => filters.week === undefined || row.week === filters.week)
    .map((row) => ({
      featureVersion: row.featureVersion,
      gameId: row.gameId,
      teamId: row.teamId,
      opponentTeamId: row.opponentTeamId,
      season: row.season,
      week: row.week,
      kickoffTime: row.kickoffTime.toISOString(),
      sourceCutoff: row.sourceCutoff.toISOString(),
      dataConfidence: row.features["personnel.data_confidence"] ?? null,
      featureAudit: row.featureAudit,
      sources: (row.featureAudit._personnel_context as unknown as PersonnelContext | undefined)?.sources ?? [],
    }));
}
