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
} = {}) {
  return deriveCurrentTeamDepth({
    teamId: "team", abbreviation: "TST", cutoff, publishedDepth,
    snaps: options.snaps ?? [], historicalDepth: [], injuries: options.injuries ?? [],
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