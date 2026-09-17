import test from "node:test";
import assert from "node:assert/strict";
import { asc } from "drizzle-orm";
import { db, gamesTable, teamsTable } from "@workspace/db";
import {
  currentGamePersonnelCutoff,
  getCurrentGamePersonnel,
  getCurrentTeamDepth,
  isLowerPriorityDepthSuperseded,
  reconstructLatestVerifiedDepthState,
  roleCardAudit,
  roleCardCoverageState,
  verifiedEvidenceAtCutoff,
} from "./current-personnel";
import { deriveCurrentTeamDepth, type CurrentDepthSource } from "./current-personnel-derivation";

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

test("verified depth replay uses observed chronology and tombstones supersede prior facts", () => {
  const rows = [
    { id: 1, teamId: "DET", role: "RB1", position: "RB", depthRank: 1, observedAt: new Date("2026-09-17T10:00:00Z"), evidenceState: "verified" },
    { id: 2, teamId: "DET", role: "RB1", position: "RB", depthRank: null, observedAt: new Date("2026-09-17T12:00:00Z"), evidenceState: "unavailable" },
    { id: 3, teamId: "DET", role: "RB1", position: "RB", depthRank: 1, observedAt: new Date("2026-09-17T11:00:00Z"), evidenceState: "verified" },
  ];
  const latest = reconstructLatestVerifiedDepthState(rows);
  assert.equal(latest.length, 1);
  assert.equal(latest[0]?.evidenceState, "unavailable");
});

test("verified depth replay retains separate starter and backup ranks within one role card", () => {
  const latest = reconstructLatestVerifiedDepthState([
    { id: 1, teamId: "DET", role: "WR1", position: "WR", depthRank: 1, observedAt: new Date("2026-09-17T10:00:00Z"), evidenceState: "verified" },
    { id: 2, teamId: "DET", role: "WR1", position: "WR", depthRank: 2, observedAt: new Date("2026-09-17T10:01:00Z"), evidenceState: "verified" },
  ]);
  assert.deepEqual(latest.map((row) => row.depthRank).sort(), [1, 2]);
});

test("verified evidence requires both observation and verification before the cutoff", () => {
  const cutoff = new Date("2026-09-17T12:00:00Z");
  const base = { observedAt: new Date("2026-09-17T10:00:00Z"), verifiedAt: new Date("2026-09-17T11:00:00Z") };
  assert.equal(verifiedEvidenceAtCutoff([
    { ...base, id: "eligible" },
    { ...base, id: "late-verification", verifiedAt: new Date("2026-09-17T13:00:00Z") },
    { ...base, id: "late-observation", observedAt: new Date("2026-09-17T13:00:00Z"), verifiedAt: new Date("2026-09-17T13:30:00Z") },
  ], cutoff).map((row) => row.id).join(","), "eligible");
});

test("latest manual role evidence suppresses lower-priority depth for the same role card", () => {
  const lower = { teamId: "DET", position: "RB", role: "RB", depthOrder: 1 };
  const tombstone = [{ teamId: "DET", position: "RB", role: "RB1", depthRank: null }];
  assert.equal(isLowerPriorityDepthSuperseded(lower, tombstone), true);
  assert.equal(isLowerPriorityDepthSuperseded({ ...lower, depthOrder: 2 }, tombstone), false);
});

test("a complete verified role-card lineup preserves exact roles and can reach readiness", () => {
  const cards = [
    ["QB1", "QB", 1], ["QB2", "QB", 2], ["RB1", "RB", 1], ["RB2", "RB", 2],
    ["WR1", "WR", 1], ["WR2", "WR", 1], ["WR3", "WR", 1], ["TE1", "TE", 1],
    ["LT1", "LT", 1], ["LG1", "LG", 1], ["C1", "C", 1], ["RG1", "RG", 1], ["RT1", "RT", 1],
    ["DT1", "DT", 1], ["DT2", "DT", 1], ["LB1", "LB", 1], ["LB2", "LB", 1],
    ["CB1", "CB", 1], ["CB2", "CB", 1], ["CB3_OR_SLOT", "CB", 1],
    ["FS1", "FS", 1], ["SS1", "SS", 1], ["EDGE1", "EDGE", 1], ["EDGE2", "EDGE", 1],
    ["K1", "K", 1], ["P1", "P", 1], ["LS1", "LS", 1],
  ] as const;
  const publishedDepth: CurrentDepthSource[] = cards.map(([role, position, depthOrder], index) => ({
    playerId: `player-${index}`, playerName: `Player ${index}`, teamId: "team",
    sourceTeamId: "TST", position, role, depthOrder,
    source: "verified_published_depth", classification: "official",
    capturedAt: "2026-09-17T10:00:00.000Z", sourceUpdatedAt: "2026-09-17T10:00:00.000Z",
    observedAt: "2026-09-17T10:00:00.000Z", verifiedAt: "2026-09-17T10:05:00.000Z",
    availability: "available", mappingStatus: "manual_verified", mappingConfidence: 1,
  }));
  publishedDepth.push(
    { ...publishedDepth.find((row) => row.role === "WR1")!, playerId: "backup-wr", playerName: "Backup WR", depthOrder: 2 },
    { ...publishedDepth.find((row) => row.role === "LT1")!, playerId: "backup-lt", playerName: "Backup LT", depthOrder: 2 },
    { ...publishedDepth.find((row) => row.role === "EDGE1")!, playerId: "backup-edge", playerName: "Backup Edge", depthOrder: 2 },
  );
  const team = deriveCurrentTeamDepth({
    teamId: "team", abbreviation: "TST", cutoff: new Date("2026-09-17T12:00:00.000Z"),
    publishedDepth, snaps: [], historicalDepth: [], injuries: [],
  });
  assert.equal(team.conflicts.some((conflict) => conflict.severity === "blocking"), false);
  assert.equal(team.depth.offense.some((player) => player.position === "LT"), true);
  assert.equal(team.depth.offense.some((player) => player.position === "RT"), true);
  assert.equal(team.depth.defense.some((player) => player.position === "FS"), true);
  assert.equal(team.depth.defense.some((player) => player.position === "SS"), true);
  assert.equal(team.depth.offense.find((player) => player.role === "WR2")?.publishedStarter, true);
  assert.equal(team.depth.defense.find((player) => player.role === "EDGE2")?.publishedStarter, true);
  assert.equal(roleCardAudit(team).completeVerified, true);

  const teamWithOutStarter = deriveCurrentTeamDepth({
    teamId: "team", abbreviation: "TST", cutoff: new Date("2026-09-17T12:00:00.000Z"),
    publishedDepth, snaps: [], historicalDepth: [],
    injuries: [
      { playerId: "player-2", teamId: "team", position: "RB", gameStatus: "Out", snapshotTimestamp: "2026-09-17T11:00:00.000Z", sourceUpdatedAt: "2026-09-17T11:00:00.000Z" },
      { playerId: "player-4", teamId: "team", position: "WR", gameStatus: "Out", snapshotTimestamp: "2026-09-17T11:00:00.000Z", sourceUpdatedAt: "2026-09-17T11:00:00.000Z" },
      { playerId: "player-8", teamId: "team", position: "LT", gameStatus: "Out", snapshotTimestamp: "2026-09-17T11:00:00.000Z", sourceUpdatedAt: "2026-09-17T11:00:00.000Z" },
      { playerId: "player-22", teamId: "team", position: "EDGE", gameStatus: "Out", snapshotTimestamp: "2026-09-17T11:00:00.000Z", sourceUpdatedAt: "2026-09-17T11:00:00.000Z" },
    ],
  });
  assert.equal(teamWithOutStarter.conflicts.some((conflict) => conflict.severity === "blocking"), false);
  assert.equal(teamWithOutStarter.expectedLineup?.status, "available");
  assert.equal(teamWithOutStarter.expectedLineup?.players.find((player) => player.playerId === "player-3")?.projected, true);
  assert.equal(teamWithOutStarter.expectedLineup?.players.find((player) => player.playerId === "backup-wr")?.projected, true);
  assert.equal(teamWithOutStarter.expectedLineup?.players.find((player) => player.playerId === "backup-lt")?.projected, true);
  assert.equal(teamWithOutStarter.expectedLineup?.players.find((player) => player.playerId === "backup-edge")?.projected, true);
  assert.equal(roleCardAudit(teamWithOutStarter).completeVerified, true);
});

test("role-card readiness rejects backup-only starter evidence and cross-card player collisions", () => {
  const complete = [
    ["QB1", "QB", 1], ["QB2", "QB", 2], ["RB1", "RB", 1], ["RB2", "RB", 2],
    ["WR1", "WR", 1], ["WR2", "WR", 1], ["WR3", "WR", 1], ["TE1", "TE", 1],
    ["LT1", "LT", 1], ["LG1", "LG", 1], ["C1", "C", 1], ["RG1", "RG", 1], ["RT1", "RT", 1],
    ["DT1", "DT", 1], ["DT2", "DT", 1], ["LB1", "LB", 1], ["LB2", "LB", 1],
    ["CB1", "CB", 1], ["CB2", "CB", 1], ["CB3_OR_SLOT", "CB", 1],
    ["FS1", "FS", 1], ["SS1", "SS", 1], ["EDGE1", "EDGE", 1], ["EDGE2", "EDGE", 1],
    ["K1", "K", 1], ["P1", "P", 1], ["LS1", "LS", 1],
  ] as const;
  const source = complete.map(([role, position, depthOrder], index): CurrentDepthSource => ({
    playerId: `unique-${index}`, playerName: `Player ${index}`, teamId: "team",
    sourceTeamId: "TST", position, role, depthOrder,
    source: "verified_published_depth", classification: "official",
    capturedAt: "2026-09-17T10:00:00.000Z", sourceUpdatedAt: "2026-09-17T10:00:00.000Z",
    observedAt: "2026-09-17T10:00:00.000Z", verifiedAt: "2026-09-17T10:05:00.000Z",
    availability: "available", mappingStatus: "manual_verified", mappingConfidence: 1,
  }));
  const derive = (publishedDepth: CurrentDepthSource[]) => deriveCurrentTeamDepth({
    teamId: "team", abbreviation: "TST", cutoff: new Date("2026-09-17T12:00:00.000Z"),
    publishedDepth, snaps: [], historicalDepth: [], injuries: [],
  });

  const rankTwoOnly = source
    .filter((row) => row.role !== "WR1")
    .concat({ ...source.find((row) => row.role === "WR1")!, playerId: "wr1-backup", depthOrder: 2 });
  const rankAudit = roleCardAudit(derive(rankTwoOnly));
  assert.equal(rankAudit.cards.WR1.verified, 0);
  assert.equal(rankAudit.cards.WR1.requiredDepthRank, 1);
  assert.equal(rankAudit.completeVerified, false);

  const collisionRows = source.map((row) => row.role === "WR2"
    ? { ...row, playerId: source.find((candidate) => candidate.role === "WR1")!.playerId }
    : row);
  const collisionAudit = roleCardAudit(derive(collisionRows));
  assert.deepEqual(collisionAudit.identityCollisions, [{
    playerId: source.find((row) => row.role === "WR1")!.playerId,
    cards: ["WR1", "WR2"],
  }]);
  assert.equal(collisionAudit.cards.WR1.ambiguous, 100);
  assert.equal(collisionAudit.cards.WR2.ambiguous, 100);
  assert.equal(collisionAudit.completeVerified, false);
});

test("mixed-age role evidence stays stale per player and cannot inflate verified coverage", () => {
  const row = (
    playerId: string,
    position: string,
    role: string,
    observedAt: string,
  ): CurrentDepthSource => ({
    playerId,
    playerName: playerId,
    teamId: "team",
    sourceTeamId: "TST",
    position,
    role,
    depthOrder: 1,
    source: "verified_published_depth",
    classification: "official",
    capturedAt: observedAt,
    sourceUpdatedAt: observedAt,
    observedAt,
    verifiedAt: observedAt,
    availability: "available",
    mappingStatus: "manual_verified",
    mappingConfidence: 1,
  });
  const team = deriveCurrentTeamDepth({
    teamId: "team",
    abbreviation: "TST",
    cutoff: new Date("2026-09-17T12:00:00.000Z"),
    publishedDepth: [
      row("fresh-qb", "QB", "QB1", "2026-09-17T10:00:00.000Z"),
      row("stale-rb", "RB", "RB1", "2026-08-01T10:00:00.000Z"),
    ],
    snaps: [],
    historicalDepth: [],
    injuries: [],
  });

  assert.equal(team.depth.offense.find((player) => player.playerId === "fresh-qb")?.freshness, "current");
  assert.equal(team.depth.offense.find((player) => player.playerId === "stale-rb")?.freshness, "stale");
  assert.equal(team.freshness, "stale");
  assert.equal(roleCardAudit(team).cards.QB1.verified, 100);
  assert.equal(roleCardAudit(team).cards.RB1.verified, 0);
  assert.equal(roleCardAudit(team).cards.RB1.unknown, 100);
  assert.equal(roleCardCoverageState(team, "QB1"), "verified");
  assert.equal(roleCardCoverageState(team, "RB1"), "unknown");
});