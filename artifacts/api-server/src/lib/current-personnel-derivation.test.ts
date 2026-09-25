import test from "node:test";
import assert from "node:assert/strict";
import { deriveCurrentTeamDepth, type CurrentDepthSource } from "./current-personnel-derivation";

const cutoff = new Date("2026-09-17T12:00:00.000Z");
const sleeper = (overrides: Partial<CurrentDepthSource>): CurrentDepthSource => ({
  playerId: "qb1", playerName: "Primary QB", teamId: "team", sourceTeamId: "TST",
  position: "QB", role: "QB", depthOrder: 1, source: "sleeper",
  classification: "published_secondary", capturedAt: "2026-09-17T10:00:00.000Z",
  sourceUpdatedAt: "2026-09-17T10:00:00.000Z", mappingStatus: "exact_provider_id",
  mappingConfidence: 1, ...overrides,
});

function derive(publishedDepth: CurrentDepthSource[], options: {
  snaps?: Parameters<typeof deriveCurrentTeamDepth>[0]["snaps"];
  injuries?: Parameters<typeof deriveCurrentTeamDepth>[0]["injuries"];
  historicalDepth?: Parameters<typeof deriveCurrentTeamDepth>[0]["historicalDepth"];
} = {}) {
  return deriveCurrentTeamDepth({
    teamId: "team", abbreviation: "TST", cutoff, publishedDepth,
    snaps: options.snaps ?? [], historicalDepth: options.historicalDepth ?? [], injuries: options.injuries ?? [],
  });
}

test("verified published depth precedes Sleeper and Sleeper remains secondary", () => {
  const result = derive([
    sleeper({ playerId: "secondary", playerName: "Secondary QB" }),
    sleeper({
      playerId: "official", playerName: "Official QB", source: "verified_published_depth",
      classification: "official",
    }),
  ]);
  const official = result.depth.offense.find((row) => row.playerId === "official");
  assert.equal(official?.sourceClassification, "official");
  assert.equal(official?.starter, true);
  assert.equal(result.depth.offense.find((row) => row.playerId === "secondary")?.starter, false);
  assert.ok(result.conflicts.some((conflict) => conflict.type === "provider"));
  assert.equal(result.depth.offense.find((row) => row.playerId === "secondary")?.providerLabel, "Sleeper published secondary depth signal");
  assert.notEqual(official?.providerLabel, "Sleeper published secondary depth signal");
});

test("post-cutoff published, injury, and participation evidence is excluded", () => {
  const result = derive([
    sleeper({ capturedAt: "2026-09-18T10:00:00.000Z", sourceUpdatedAt: "2026-09-18T10:00:00.000Z" }),
  ], {
    snaps: [{
      gameId: "future", season: 2026, week: 3, playerId: "future-wr", playerName: "Future WR",
      position: "WR", teamId: "team", offensePct: 1, kickoffTime: "2026-09-18T00:00:00.000Z",
      sourceUpdatedAt: "2026-09-18T00:00:00.000Z",
    }],
    injuries: [{
      playerId: "qb1", teamId: "team", position: "QB", gameStatus: "Out",
      snapshotTimestamp: "2026-09-18T00:00:00.000Z", sourceUpdatedAt: "2026-09-18T00:00:00.000Z",
    }],
  });
  assert.equal(result.freshness, "unavailable");
  assert.equal(result.depth.offense.length, 0);
  assert.equal(result.qbStarter.status, "unavailable");
});

test("injury report resolves a player absent from current depth sources", () => {
  const result = deriveCurrentTeamDepth({
    teamId: "team", cutoff, publishedDepth: [], snaps: [], historicalDepth: [],
    playerNames: { injuredReserve: "Injured Reserve Player" },
    injuries: [{
      playerId: "injuredReserve", teamId: "team", position: "WR", injury: "Knee",
      gameStatus: "Out", practiceStatus: "Did Not Participate",
      snapshotTimestamp: "2026-09-17T11:00:00.000Z", sourceUpdatedAt: "2026-09-17T11:00:00.000Z",
    }],
  });
  assert.deepEqual(result.injuryReport, [{
    playerName: "Injured Reserve Player", position: "WR", injury: "Knee",
    gameStatus: "Out", practiceStatus: "Did Not Participate",
    asOf: "2026-09-17T11:00:00.000Z", source: "espn",
  }]);
});

test("injury authority and participation disagreements create confidence-reducing conflicts", () => {
  const result = derive([
    sleeper({}),
    sleeper({ playerId: "wr1", playerName: "Listed WR", position: "WR", role: "WR", depthOrder: 1 }),
    sleeper({ playerId: "wr2", playerName: "Playing WR", position: "WR", role: "WR", depthOrder: 2 }),
  ], {
    snaps: [{
      gameId: "prior", season: 2026, week: 2, playerId: "wr1", playerName: "Listed WR",
      position: "WR", teamId: "team", offensePct: 0.2, kickoffTime: "2026-09-10T00:00:00.000Z",
      sourceUpdatedAt: "2026-09-11T00:00:00.000Z",
    }, {
      gameId: "prior", season: 2026, week: 2, playerId: "wr2", playerName: "Playing WR",
      position: "WR", teamId: "team", offensePct: 0.9, kickoffTime: "2026-09-10T00:00:00.000Z",
      sourceUpdatedAt: "2026-09-11T00:00:00.000Z",
    }],
    injuries: [{
      playerId: "qb1", teamId: "team", position: "QB", gameStatus: "Out",
      snapshotTimestamp: "2026-09-17T11:00:00.000Z", sourceUpdatedAt: "2026-09-17T11:00:00.000Z",
    }],
  });
  assert.equal(result.qbStarter.status, "conflict");
  assert.equal(result.qbStarter.player?.starter, false);
  assert.ok(result.conflicts.some((conflict) => conflict.type === "injury"));
  assert.ok(result.conflicts.some((conflict) => conflict.type === "participation"));
  assert.ok((result.depth.offense.find((row) => row.playerId === "wr1")?.confidence ?? 100) < 94);
});

test("WR and CB evidence is exposed without direct assignment claims", () => {
  const result = derive([
    sleeper({}), sleeper({ playerId: "wr", position: "WR", role: "LWR", depthOrder: 1 }),
    sleeper({ playerId: "cb", position: "CB", role: "LCB", depthOrder: 1 }),
    sleeper({ playerId: "k", position: "K", role: "K", depthOrder: 1 }),
  ]);
  assert.equal(result.wrRoles.length, 1);
  assert.equal(result.cbRoles.length, 1);
  assert.equal(result.depth.specialTeams.length, 1);
  assert.ok(result.wrRoles[0]?.explanation.length);
  assert.equal(Object.hasOwn(result.wrRoles[0]!, "providerIds"), false);
  assert.equal(Object.hasOwn(result.wrRoles[0]!, "sourcePlayerId"), false);
});

test("QB evidence chooses the maximum-dropback player in the latest eligible game", () => {
  const result = deriveCurrentTeamDepth({
    teamId: "team", cutoff, publishedDepth: [sleeper({})], snaps: [], historicalDepth: [], injuries: [],
    qbs: [{
      gameId: "latest", season: 2026, week: 2, playerId: "backup", playerName: "Backup",
      teamId: "team", dropbacks: 2, passAttempts: 2, passEpa: 0, passSuccesses: 1,
      interceptions: 0, sacks: 0, rushAttempts: 0, rushEpa: 0,
      kickoffTime: "2026-09-10T00:00:00.000Z", sourceUpdatedAt: "2026-09-11T00:00:00.000Z",
    }, {
      gameId: "latest", season: 2026, week: 2, playerId: "qb1", playerName: "Primary QB",
      teamId: "team", dropbacks: 31, passAttempts: 29, passEpa: 2, passSuccesses: 15,
      interceptions: 0, sacks: 2, rushAttempts: 2, rushEpa: 0,
      kickoffTime: "2026-09-10T00:00:00.000Z", sourceUpdatedAt: "2026-09-11T00:00:00.000Z",
    }],
  });
  assert.equal(result.qbStarter.status, "available");
  assert.match(result.qbStarter.supportingEvidence.at(-1) ?? "", /31 dropbacks/);
});

test("an old Out row cannot survive feed omission as current injury authority", () => {
  const result = derive([sleeper({})], {
    injuries: [{
      playerId: "qb1", teamId: "team", position: "QB", gameStatus: "Out",
      snapshotTimestamp: "2026-09-01T12:00:00.000Z",
      sourceUpdatedAt: "2026-09-01T12:00:00.000Z",
    }],
  });
  assert.equal(result.qbStarter.status, "available");
  assert.equal(result.qbStarter.player?.starter, true);
  assert.equal(result.qbStarter.player?.injuryState.gameStatus, null);
  assert.equal(result.conflicts.some((conflict) => conflict.type === "injury"), false);
});

test("Sleeper availability is supplemental when ESPN is absent and ESPN wins conflicts", () => {
  const sleeperOut = sleeper({ sleeperStatus: "Inactive", sleeperInjuryStatus: "Out" });
  const withoutEspn = derive([sleeperOut]);
  assert.equal(withoutEspn.qbStarter.status, "conflict");
  assert.equal(withoutEspn.qbStarter.player?.starter, false);
  assert.equal(withoutEspn.qbStarter.player?.injuryState.source, "sleeper_supplemental");

  const withEspn = derive([sleeperOut], {
    injuries: [{
      playerId: "qb1", teamId: "team", position: "QB", gameStatus: "Questionable",
      snapshotTimestamp: "2026-09-17T11:00:00.000Z",
      sourceUpdatedAt: "2026-09-17T11:00:00.000Z",
    }],
  });
  assert.equal(withEspn.qbStarter.player?.starter, true);
  assert.equal(withEspn.qbStarter.player?.injuryState.source, "espn");
  assert.ok(withEspn.conflicts.some((conflict) => conflict.type === "injury" && conflict.severity === "warning"));
});

test("distinct WR and CB roles do not create duplicate-rank conflicts", () => {
  const result = derive([
    sleeper({}),
    sleeper({ playerId: "lwr", position: "WR", role: "LWR", depthOrder: 1 }),
    sleeper({ playerId: "rwr", position: "WR", role: "RWR", depthOrder: 1 }),
    sleeper({ playerId: "swr", position: "WR", role: "SWR", depthOrder: 1 }),
    sleeper({ playerId: "lcb", position: "CB", role: "LCB", depthOrder: 1 }),
    sleeper({ playerId: "rcb", position: "CB", role: "RCB", depthOrder: 1 }),
  ]);
  assert.equal(result.wrRoles.length, 3);
  assert.equal(result.cbRoles.length, 2);
  assert.equal(result.conflicts.some((conflict) => conflict.type === "depth_order" && ["WR", "CB"].includes(conflict.position ?? "")), false);
});

test("blocking non-QB identity conflicts fail downstream readiness", () => {
  const result = derive([
    sleeper({}),
    sleeper({ playerId: "wr", position: "WR", role: "LWR", depthOrder: 1 }),
    sleeper({
      playerId: "cb", position: "CB", role: "LCB", depthOrder: 1,
      mappingConflictReason: "Mapped identity position is incompatible.",
    }),
  ]);
  assert.equal(result.downstreamReady, false);
  assert.ok(result.conflicts.some((conflict) => conflict.type === "identity" && conflict.severity === "blocking"));
});

test("explicit CB roles recover generic DB rows without merging distinct CB slots", () => {
  const result = derive([
    sleeper({}),
    sleeper({ playerId: "left", position: "DB", role: "LCB", depthOrder: 1 }),
    sleeper({ playerId: "right", position: "DB", role: "RCB", depthOrder: 1 }),
  ]);
  assert.deepEqual(result.cbRoles.map((row) => row.playerId).sort(), ["left", "right"]);
  assert.equal(result.conflicts.some((conflict) =>
    conflict.type === "depth_order" && conflict.position === "CB"), false);
});

test("FS and SS normalize to safety while retaining distinct depth roles", () => {
  const result = derive([
    sleeper({}),
    sleeper({ playerId: "free", position: "DB", role: "FS", depthOrder: 1 }),
    sleeper({ playerId: "strong", position: "DB", role: "SS", depthOrder: 1 }),
  ]);
  const safeties = result.depth.defense.filter((row) => row.position === "S");
  assert.deepEqual(safeties.map((row) => row.role).sort(), ["FS", "SS"]);
  assert.equal(result.conflicts.some((conflict) =>
    conflict.type === "depth_order" && conflict.position === "S"), false);
});

test("bare safety roles remain one slot and preserve rank ambiguity", () => {
  const result = derive([
    sleeper({}),
    sleeper({ playerId: "s-one", position: "S", role: "S", depthOrder: 1 }),
    sleeper({ playerId: "s-two", position: "S", role: "S", depthOrder: 1 }),
  ]);
  assert.ok(result.conflicts.some((conflict) =>
    conflict.type === "depth_order" && conflict.position === "S" && conflict.severity === "blocking"));
  assert.equal(result.downstreamReady, false);
});

test("OLB requires explicit edge-compatible roster evidence", () => {
  const result = derive([
    sleeper({}),
    sleeper({ playerId: "linebacker", position: "OLB", role: "LOLB", depthOrder: 1 }),
    sleeper({ playerId: "edge", position: "DE", role: "LDE", depthOrder: 1 }),
  ]);
  assert.equal(result.depth.defense.find((row) => row.playerId === "linebacker")?.position, "LB");
  assert.equal(result.depth.defense.find((row) => row.playerId === "edge")?.position, "EDGE");
});

test("snap and historical evidence cannot fabricate offensive-line depth slots", () => {
  const result = derive([sleeper({})], {
    snaps: [{
      gameId: "prior", season: 2026, week: 2, playerId: "snap-ol", playerName: "Snap Tackle",
      position: "LT", teamId: "team", offensePct: 1, kickoffTime: "2026-09-10T00:00:00.000Z",
      sourceUpdatedAt: "2026-09-11T00:00:00.000Z",
    }],
    historicalDepth: [{
      playerId: "history-ol", playerName: "History Guard", teamId: "team",
      sourceTeamId: "TST", position: "RG", role: "RG", depthPosition: 1,
      sourceUpdatedAt: "2026-09-10T00:00:00.000Z",
    }],
  });
  assert.equal(result.depth.offense.some((row) =>
    ["OT", "OG", "C"].includes(row.position ?? "")), false);
  assert.equal(result.positionalCoverage.OT, 0);
  assert.equal(result.positionalCoverage.OG, 0);
  assert.equal(result.positionalCoverage.C, 0);
  assert.equal(result.downstreamReady, false);
});

test("matchup season prevents stale Buffalo-like RB evidence from replacing the current lead back", () => {
  const result = deriveCurrentTeamDepth({
    teamId: "team", abbreviation: "BUF", cutoff, season: 2026,
    publishedDepth: [
      sleeper({ playerId: "cook", playerName: "James Cook", position: "RB", role: "RB", depthOrder: 1 }),
      sleeper({
        playerId: "singletary", playerName: "Devin Singletary", position: "RB", role: "RB",
        depthOrder: 1, capturedAt: "2025-09-10T10:00:00.000Z", sourceUpdatedAt: "2025-09-10T10:00:00.000Z",
      }),
    ],
    snaps: [{
      gameId: "old", season: 2025, week: 18, playerId: "singletary", playerName: "Devin Singletary",
      position: "RB", teamId: "team", offensePct: 1, kickoffTime: "2026-01-01T00:00:00.000Z",
      sourceUpdatedAt: "2026-01-02T00:00:00.000Z",
    }],
    historicalDepth: [{
      season: 2025, week: 18, playerId: "singletary", playerName: "Devin Singletary", teamId: "team",
      position: "RB", role: "RB", depthPosition: 1, sourceUpdatedAt: "2026-01-02T00:00:00.000Z",
    }],
    injuries: [],
  });
  assert.equal(result.depth.offense.find((row) => row.position === "RB" && row.starter)?.playerName, "James Cook");
  assert.equal(result.depth.offense.some((row) => row.playerName === "Devin Singletary"), false);
});

test("matchup season leaves a missing position unavailable instead of using prior-season participation", () => {
  const result = deriveCurrentTeamDepth({
    teamId: "team", cutoff, season: 2026, publishedDepth: [], historicalDepth: [], injuries: [],
    snaps: [{
      gameId: "old", season: 2025, week: 18, playerId: "old-rb", playerName: "Old RB",
      position: "RB", teamId: "team", offensePct: 1, kickoffTime: "2026-01-01T00:00:00.000Z",
      sourceUpdatedAt: "2026-01-02T00:00:00.000Z",
    }],
  });
  assert.equal(result.depth.offense.some((row) => row.position === "RB"), false);
  assert.ok(result.unavailableReasons.includes("RB depth is unavailable."));
});

test("current available QB2 replaces an unavailable QB1 without changing saved model inputs", () => {
  const result = deriveCurrentTeamDepth({
    teamId: "team", cutoff, season: 2026,
    publishedDepth: [
      sleeper({ playerId: "daniels", playerName: "Jayden Daniels", depthOrder: 1 }),
      sleeper({ playerId: "mariota", playerName: "Marcus Mariota", depthOrder: 2 }),
    ],
    snaps: [], historicalDepth: [],
    qbs: [{
      gameId: "recent-daniels", season: 2026, playerId: "daniels", playerName: "Jayden Daniels",
      teamId: "team", week: 2, dropbacks: 28, passAttempts: 0, passEpa: 0, passSuccesses: 0,
      interceptions: 0, sacks: 0, rushAttempts: 0, rushEpa: 0, kickoffTime: "2026-09-10T00:00:00.000Z",
      sourceUpdatedAt: "2026-09-11T00:00:00.000Z",
    }],
    injuries: [{
      playerId: "daniels", teamId: "team", position: "QB", gameStatus: "Out",
      snapshotTimestamp: "2026-09-17T11:00:00.000Z", sourceUpdatedAt: "2026-09-17T11:00:00.000Z",
    }, {
      playerId: "mariota", teamId: "team", position: "QB", gameStatus: "Active",
      snapshotTimestamp: "2026-09-17T11:00:00.000Z", sourceUpdatedAt: "2026-09-17T11:00:00.000Z",
    }],
  });
  assert.equal(result.qbStarter.status, "available");
  assert.equal(result.qbStarter.player?.playerId, "mariota");
  assert.equal(result.conflicts.some((conflict) => conflict.type === "participation"), false);
  assert.equal(result.depth.offense.find((player) => player.playerId === "daniels")?.starter, false);
});

test("unseasoned stale historical identity cannot be promoted into current depth", () => {
  const result = deriveCurrentTeamDepth({
    teamId: "team", cutoff, season: 2026, publishedDepth: [], snaps: [], injuries: [],
    historicalDepth: [{
      playerId: "stale-qb", playerName: "Historical QB", teamId: "team", position: "QB",
      depthPosition: 1, sourceUpdatedAt: "2021-09-10T12:00:00.000Z",
    }],
  });
  assert.equal(result.qbStarter.player, null);
  assert.equal(result.depth.offense.some((player) => player.playerId === "stale-qb"), false);
});