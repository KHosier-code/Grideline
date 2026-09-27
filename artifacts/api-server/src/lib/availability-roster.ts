import { and, desc, eq, lte } from "drizzle-orm";
import { dataSyncRunsTable, db, espnRosterObservationsTable, injuriesTable,
  nflversePlayerIdentitiesTable, playerAvailabilitySourcesTable, teamsTable } from "@workspace/db";
import { validPlayerObservation, verifiedAssignmentsForRun } from "./player-forecast-readiness";

/** Evidence for a named player at one forecast cutoff. Historical appearances
 * and omission from an injury-only feed are never affirmative participation. */
export type PlayerEligibilityEvidence = {
  playerId: string;
  team: string;
  opponent: string;
  gameId: string;
  asOf: Date;
  kickoff: Date;
  identity: { gsisId: string; providerId: string; observedAt: Date } | null;
  roster: { providerId: string; team: string; status: string | null; observedAt: Date;
    complete: boolean } | null;
  gameRoster: { providerId: string; team: string; gameId: string; status: string | null;
    observedAt: Date; publicationAt: Date; sourceUrl: string; sourceHash: string; complete: boolean } | null;
  injury: { providerId: string; team: string; status: string | null;
    observedAt: Date; publicationAt: Date | null; sourceUrl?: string; sourceHash?: string; complete: boolean } | null;
  injuryConflict?: boolean;
};

export type PlayerEligibilityVerdict = { eligible: boolean; reason: string };
const MAX_AGE_MS = 48 * 60 * 60 * 1000;
const fresh = (at: Date | null | undefined, input: PlayerEligibilityEvidence) =>
  at instanceof Date && Number.isFinite(at.getTime())
  && at <= input.asOf && at < input.kickoff
  && input.asOf.getTime() - at.getTime() <= MAX_AGE_MS;

const active = (status: string | null) => /^(active|available|healthy|cleared)$/i.test(status?.trim() ?? "");

/** Requires separate affirmative game-roster AND availability assertions.
 * An injury-only run can report exclusions, but cannot certify health. */
export function qualifyPlayerEligibility(input: PlayerEligibilityEvidence): PlayerEligibilityVerdict {
  const no = (reason: string): PlayerEligibilityVerdict => ({ eligible: false, reason });
  if (!Number.isFinite(input.asOf.getTime()) || !Number.isFinite(input.kickoff.getTime())
    || input.asOf >= input.kickoff || !input.playerId || !input.team || !input.opponent
    || input.team === input.opponent || !input.gameId) return no("Future game and cutoff are not verified.");
  if (!input.identity || input.identity.gsisId !== input.playerId
    || !/^\d+$/.test(input.identity.providerId) || !fresh(input.identity.observedAt, input))
    return no("Current player identity is missing, stale or conflicting.");
  const providerId = input.identity.providerId;
  if (!input.roster?.complete || input.roster.providerId !== providerId
    || input.roster.team !== input.team || !fresh(input.roster.observedAt, input)
    || !active(input.roster.status))
    return no("Current complete team roster does not confirm this player's team and active status.");
  if (!input.gameRoster?.complete || input.gameRoster.providerId !== providerId
    || input.gameRoster.team !== input.team || input.gameRoster.gameId !== input.gameId
    || !fresh(input.gameRoster.observedAt, input) || !fresh(input.gameRoster.publicationAt, input)
    || input.gameRoster.publicationAt > input.gameRoster.observedAt
    || input.kickoff.getTime() - input.gameRoster.observedAt.getTime() > 24 * 60 * 60 * 1000
    || !input.gameRoster.sourceUrl || !input.gameRoster.sourceHash || !active(input.gameRoster.status))
    return no("Game-specific active roster is missing, stale or conflicting.");
  if (input.injuryConflict) return no("A later injury report conflicts with clearance.");
  if (!input.injury?.complete || input.injury.providerId !== providerId
    || input.injury.team !== input.team || !fresh(input.injury.observedAt, input)
    || !fresh(input.injury.publicationAt, input)
    || input.injury.publicationAt! > input.injury.observedAt
    || !input.injury.sourceUrl || !input.injury.sourceHash || input.injury.sourceUrl === input.gameRoster.sourceUrl
    || input.injury.sourceHash === input.gameRoster.sourceHash
    || !active(input.injury.status))
    return no("Recent affirmative injury clearance is missing, stale or conflicting.");
  return { eligible: true, reason: "Roster, game roster and injury clearance agree before cutoff." };
}

/** Read only archived affirmative observations before cutoff. Neither ESPN
 * injury omissions nor a normal team roster can fill these two independent slots. */
export async function readPlayerEligibilityEvidence(
  playerId: string, team: string, opponent: string, gameId: string, asOf: Date, kickoff: Date,
): Promise<PlayerEligibilityEvidence> {
  const evidence: PlayerEligibilityEvidence = {
    playerId, team, opponent, gameId, asOf, kickoff,
    identity: null, roster: null, gameRoster: null, injury: null,
  };
  const [identities, runs, teams] = await Promise.all([
    db.select({ gsisId: nflversePlayerIdentitiesTable.gsisId,
      providerId: nflversePlayerIdentitiesTable.espnId,
      observedAt: nflversePlayerIdentitiesTable.observedAt })
      .from(nflversePlayerIdentitiesTable)
      .where(and(eq(nflversePlayerIdentitiesTable.gsisId, playerId),
        lte(nflversePlayerIdentitiesTable.observedAt, asOf)))
      .orderBy(desc(nflversePlayerIdentitiesTable.observedAt)).limit(10),
    db.select().from(dataSyncRunsTable)
      .where(and(eq(dataSyncRunsTable.provider, "espn-complete-rosters"),
        lte(dataSyncRunsTable.completedAt, asOf)))
      .orderBy(desc(dataSyncRunsTable.completedAt)).limit(2),
    db.select({ teamId: teamsTable.teamId, abbreviation: teamsTable.abbreviation }).from(teamsTable),
  ]);
  const ids = new Set(identities.filter(row => fresh(row.observedAt, evidence)).map(row => row.providerId));
  if (ids.size !== 1) return evidence;
  const providerId = [...ids][0];
  if (!providerId) return evidence;
  evidence.identity = { gsisId: playerId, providerId, observedAt: identities[0]!.observedAt };
  // Never substitute an older capture if the most recent run is partial or
  // invalid: the latest observation may have superseded the old assignment.
  const run = runs[0];
   if (run && fresh(validPlayerObservation(run), evidence)) {
     const rows = await db.select().from(espnRosterObservationsTable)
       .where(eq(espnRosterObservationsTable.runId, run.id));
     const verified = verifiedAssignmentsForRun(run, rows);
     const assignment = verified.find(row => row.playerId === providerId);
     const assignedTeam = teams.find(row => row.teamId === assignment?.teamId)?.abbreviation;
     if (assignment && assignedTeam) evidence.roster = {
       providerId, team: assignedTeam, status: assignment.activeStatus,
       observedAt: new Date(assignment.observedAt), complete: verified.length > 0,
     };
   }
   const sources = await db.select().from(playerAvailabilitySourcesTable)
     .where(and(eq(playerAvailabilitySourcesTable.gameId, gameId),
       eq(playerAvailabilitySourcesTable.playerId, playerId),
       lte(playerAvailabilitySourcesTable.observedAt, asOf)))
     .orderBy(desc(playerAvailabilitySourcesTable.observedAt), desc(playerAvailabilitySourcesTable.id)).limit(50);
   const gameSource = sources.find(row => row.kind === "game-roster");
   const clearance = sources.find(row => row.kind === "injury-clearance");
   if (gameSource && gameSource.providerId === providerId) evidence.gameRoster = {
     providerId, team: gameSource.team, gameId: gameSource.gameId,
     status: gameSource.assertion, observedAt: gameSource.observedAt,
     publicationAt: gameSource.publicationAt, sourceUrl: gameSource.sourceUrl,
     sourceHash: gameSource.sourceHash,
     complete: gameSource.publisher === "NFL",
   };
   if (clearance && clearance.providerId === providerId) evidence.injury = {
     providerId, team: clearance.team, status: clearance.assertion,
     observedAt: clearance.observedAt, publicationAt: clearance.publicationAt,
     sourceUrl: clearance.sourceUrl, sourceHash: clearance.sourceHash,
     complete: clearance.publisher === "NFL",
   };
  const latestInjury = await db.select().from(injuriesTable)
    .where(and(eq(injuriesTable.playerId, providerId),
      lte(injuriesTable.snapshotTimestamp, asOf)))
    .orderBy(desc(injuriesTable.snapshotTimestamp), desc(injuriesTable.id)).limit(1);
  const injury = latestInjury[0];
  if (injury && evidence.injury && injury.snapshotTimestamp >= evidence.injury.observedAt
    && /^(out|inactive|doubtful|questionable|injured reserve)$/i.test(injury.gameStatus?.trim() ?? "")) {
    evidence.injuryConflict = true;
  }
  return evidence;
}