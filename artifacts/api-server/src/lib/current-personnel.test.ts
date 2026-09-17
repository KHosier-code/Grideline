import test from "node:test";
import assert from "node:assert/strict";
import { asc } from "drizzle-orm";
import { db, gamesTable, teamsTable } from "@workspace/db";
import {
  currentGamePersonnelCutoff,
  getCurrentGamePersonnel,
  getCurrentTeamDepth,
} from "./current-personnel";

test("database-selected current team evidence remains cutoff-safe and private", async (t) => {
  const [team] = await db.select().from(teamsTable).orderBy(asc(teamsTable.teamId)).limit(1);
  if (!team) {
    t.skip("No team rows are available for the integration check.");
    return;
  }
  const cutoff = new Date();
  const result = await getCurrentTeamDepth(team.teamId, cutoff);
  assert.ok(result);
  assert.equal(result.asOf, cutoff.toISOString());
  for (const player of [
    ...result.depth.offense,
    ...result.depth.defense,
    ...result.depth.specialTeams,
    ...result.depth.unknown,
  ]) {
    for (const evidence of player.providerEvidence) {
      if (evidence.capturedAt) assert.ok(Date.parse(evidence.capturedAt) <= cutoff.getTime());
    }
    if (player.injuryState.asOf) assert.ok(Date.parse(player.injuryState.asOf) <= cutoff.getTime());
    assert.equal(Object.hasOwn(player, "sourcePlayerId"), false);
    assert.equal(Object.hasOwn(player, "providerIds"), false);
  }
});

test("database game comparison uses a strict pre-kickoff cutoff", async (t) => {
  const [game] = await db.select().from(gamesTable).orderBy(asc(gamesTable.gameDate)).limit(1);
  if (!game) {
    t.skip("No game rows are available for the integration check.");
    return;
  }
  const now = new Date();
  const expected = currentGamePersonnelCutoff(game.kickoffTime, now);
  const result = await getCurrentGamePersonnel(game.gameId, now);
  assert.ok(result);
  assert.equal(result.asOf, expected.toISOString());
  assert.equal(result.matchupRoleEvidence.every((matchup) => matchup.directCoverageAssignments === null), true);
});