import test from "node:test";
import assert from "node:assert/strict";
import {
  buildUpcomingPlayerReadinessAudit,
  measureFreshness,
  validPlayerObservation,
  verifiedAssignmentsForRun,
  type ReadinessDepth,
  type ReadinessGame,
  type ReadinessIdentity,
  type ReadinessPlayer,
  type ReadinessStat,
  type ReadinessStatus,
} from "./player-forecast-readiness";
import { SLEEPER_ACTIVE_TEAM_CODES } from "./sleeper";

const asOf = new Date("2026-09-26T12:00:00.000Z");
const upcomingGame: ReadinessGame = {
  gameId: "upcoming-week-3",
  season: 2026,
  week: 3,
  kickoffTime: new Date("2026-09-27T17:00:00.000Z"),
  gameStatus: "Scheduled",
  homeTeamId: "team-current",
  awayTeamId: "opponent",
};
const player: ReadinessPlayer = {
  playerId: "espn-100",
  teamId: "team-current",
  position: "RB",
  activeStatus: "Active",
  sourceUpdatedAt: new Date("2026-09-26T10:00:00.000Z"),
};
const identity: ReadinessIdentity = {
  gsisId: "gsis-100",
  espnId: "espn-100",
  observedAt: new Date("2026-09-26T09:00:00.000Z"),
};
const priorStats: ReadinessStat[] = [
  { season: 2025, week: 18 },
  { season: 2026, week: 1 },
  { season: 2026, week: 2 },
].map(({ season, week }) => ({
  playerId: "gsis-100",
  season,
  week,
  seasonType: "REG",
  teamId: "historical-team",
  opponentTeamId: `opp-${week}`,
}));
const injury: ReadinessStatus = {
  playerId: "espn-100",
  teamId: "team-current",
  gameStatus: "Active",
  sourceUpdatedAt: new Date("2026-09-26T10:00:00.000Z"),
  snapshotTimestamp: new Date("2026-09-26T10:01:00.000Z"),
};
const depth: ReadinessDepth = {
  playerId: "espn-100",
  teamId: "team-current",
  starter: true,
  snapshotTimestamp: new Date("2026-09-26T10:01:00.000Z"),
};

function audit(overrides: Partial<Parameters<typeof buildUpcomingPlayerReadinessAudit>[0]> = {}) {
  return buildUpcomingPlayerReadinessAudit({
    asOf,
    games: [upcomingGame],
    players: [player],
    identities: [identity],
    stats: priorStats,
    injuries: [injury],
    depthCharts: [depth],
    verifiedRosterAssignments: [{
      playerId: player.playerId,
      teamId: player.teamId!,
      activeStatus: player.activeStatus!,
      observedAt: asOf,
    }],
    ...overrides,
  });
}

test("joins GSIS identity to current ESPN roster team, including transfers", () => {
  const result = audit({
    players: [{ ...player, teamId: "team-current" }],
    stats: priorStats.map((stat) => ({ ...stat, teamId: "team-old" })),
  });
  assert.equal(result.eligibility.eligible, 1);
  assert.equal(result.eligibility.reasons.missing_gsis_espn_mapping, undefined);
  assert.deepEqual(result.forecasts, []);
});

test("excludes candidates when the GSIS-to-ESPN mapping is missing", () => {
  const result = audit({ identities: [] });
  assert.equal(result.eligibility.excluded, 1);
  assert.equal(result.eligibility.reasons.missing_gsis_espn_mapping, 1);
});

test("distinguishes fresh and stale roster evidence at the strict 48-hour cutoff", () => {
  const exactlyFresh = audit({
    verifiedRosterAssignments: [{ playerId: player.playerId, teamId: player.teamId!, activeStatus: "Active", observedAt: new Date(asOf.getTime() - 48 * 60 * 60 * 1000) }],
  });
  const stale = audit({
    verifiedRosterAssignments: [{ playerId: player.playerId, teamId: player.teamId!, activeStatus: "Active", observedAt: new Date(asOf.getTime() - 48 * 60 * 60 * 1000 - 1) }],
  });
  assert.equal(exactlyFresh.sourceFreshness.roster.ageHours, 48);
  assert.equal(exactlyFresh.eligibility.eligible, 1);
  assert.equal(stale.eligibility.eligible, 0);
  assert.equal(stale.eligibility.uncertain, 1);
  assert.equal(stale.eligibility.reasons.roster_assignment_not_recently_verified, 1);
  assert.equal(stale.forecasts.length, 0);
});

test("a recently changed or unchanged roster row alone cannot clear the verification gate", () => {
  const unchangedButVerified = audit({
    players: [{ ...player, sourceUpdatedAt: new Date("2026-09-17T00:00:00Z") }],
  });
  const changedButUnverified = audit({ verifiedRosterAssignments: [] });
  assert.equal(unchangedButVerified.eligibility.eligible, 1);
  assert.equal(changedButUnverified.eligibility.eligible, 0);
  assert.equal(changedButUnverified.eligibility.uncertain, 1);
  assert.equal(changedButUnverified.sourceFreshness.roster.latestSourceUpdatedAt, null);
  assert.match(changedButUnverified.blockers[0]!, /lack recent per-player verification/);
});

test("a verified assignment to a player's former team cannot validate the current team", () => {
  const result = audit({
    verifiedRosterAssignments: [{
      playerId: player.playerId,
      teamId: "former-team",
      activeStatus: "Active",
      observedAt: asOf,
    }],
  });
  assert.equal(result.eligibility.eligible, 0);
  assert.equal(result.eligibility.uncertain, 1);
  assert.equal(result.eligibility.reasons.roster_assignment_not_recently_verified, 1);
});

test("does not treat stale inactive or injury statuses as current exclusions", () => {
  const result = audit({
    players: [{ ...player, activeStatus: "Injured Reserve", sourceUpdatedAt: new Date(asOf.getTime() - 49 * 60 * 60 * 1000) }],
    verifiedRosterAssignments: [{ playerId: player.playerId, teamId: player.teamId!, activeStatus: "Injured Reserve", observedAt: new Date(asOf.getTime() - 49 * 60 * 60 * 1000) }],
    injuries: [{
      ...injury,
      gameStatus: "Out",
      sourceUpdatedAt: new Date(asOf.getTime() - 49 * 60 * 60 * 1000),
    }],
  });
  assert.equal(result.eligibility.excluded, 0);
  assert.equal(result.eligibility.uncertain, 1);
});

test("excludes a player when a fresh roster observation confirms unavailability", () => {
  const result = audit({
    verifiedRosterAssignments: [{ playerId: player.playerId, teamId: player.teamId!, activeStatus: "Injured Reserve", observedAt: asOf }],
  });
  assert.equal(result.eligibility.excluded, 1);
  assert.equal(result.eligibility.reasons.confirmed_unavailable_roster_status, 1);
});

test("missing injury and depth coverage warns and keeps starter uncertain", () => {
  const result = audit({ injuries: [], depthCharts: [] });
  assert.equal(result.eligibility.uncertain, 1);
  assert.equal(result.eligibility.reasons.injury_status_missing, 1);
  assert.equal(result.eligibility.reasons.starter_status_unknown_no_depth_chart, 1);
  assert.match(result.message, /injury coverage is missing or stale/i);
  assert.match(result.message, /No depth-chart snapshots exist/i);
});

test("missing depth evidence prevents confirmed starter eligibility", () => {
  const result = audit({ depthCharts: [] });
  assert.equal(result.eligibility.eligible, 0);
  assert.equal(result.eligibility.uncertain, 1);
  assert.equal(result.eligibility.reasons.starter_status_unknown_no_depth_chart, 1);
});

test("unchanged complete Sleeper retrieval is fresh, but cannot verify ESPN roster", () => {
  const run = { provider: "sleeper-players", status: "success", startedAt: "2026-09-26T09:00:00Z",
    completedAt: "2026-09-26T09:01:00Z", recordsProcessed: 0,
    metadata: { sourceCapturedAt: "2026-09-26T09:00:30Z", playerCount: 12227,
      unchanged: 12227, teamCount: 32, teams: [...SLEEPER_ACTIVE_TEAM_CODES] } };
  assert.equal(validPlayerObservation(run)?.toISOString(), "2026-09-26T09:00:30.000Z");
  const result = audit({ verifiedRosterAssignments: [], providerRuns: [run] });
  assert.equal(result.eligibility.eligible, 0);
  assert.equal(result.sourceFreshness.roster.validRetrievalAt, null);
  assert.match(result.sourceFreshness.roster.status, /Sleeper retrieval/);
  assert.equal(validPlayerObservation({ ...run, metadata: { ...run.metadata, unchanged: 0 } }), null);
  assert.equal(validPlayerObservation({ ...run, status: "partial" }), null);
});

test("injury-only successful observation cannot make an omitted player healthy", () => {
  const run = { provider: "espn-injuries", status: "success", startedAt: "2026-09-26T09:00:00Z",
    completedAt: "2026-09-26T09:01:00Z", recordsProcessed: 0,
    metadata: { observationKind: "injury-only", responseComplete: true, observedCount: 4,
      unchanged: 4, retrievedAt: "2026-09-26T09:00:30Z" } };
  const result = audit({ injuries: [], providerRuns: [run] });
  assert.ok(validPlayerObservation(run));
  assert.equal(result.eligibility.reasons.injury_status_missing, 1);
  assert.equal(validPlayerObservation({ ...run, metadata: { ...run.metadata, responseComplete: false } }), null);
});

test("injury from former team and ambiguous identity fail closed", () => {
  assert.equal(audit({ injuries: [{ ...injury, teamId: "former-team" }] })
    .eligibility.reasons.injury_status_missing, 1);
  assert.equal(audit({ identities: [identity, { ...identity, espnId: "another-espn" }] })
    .eligibility.reasons.ambiguous_gsis_espn_mapping, 1);
});

test("only an intact complete ESPN capture verifies roster rows", () => {
  const run = {
    id: 12, provider: "espn-complete-rosters", status: "success",
    startedAt: "2026-09-26T09:00:00Z", completedAt: "2026-09-26T09:01:00Z",
    recordsProcessed: 32,
    metadata: { observationKind: "complete-espn-rosters", responseComplete: true,
      teamCount: 32, teams: Array.from({ length: 32 }, (_, i) => String(i + 1)),
      observedCount: 32, retrievedAt: "2026-09-26T09:00:30Z" },
  };
  const rows = Array.from({ length: 32 }, (_, i) => ({
    runId: 12, playerId: String(i + 100), teamId: String(i + 1),
    activeStatus: "Active", observedAt: "2026-09-26T09:00:30Z",
    sourcePath: `/teams/${i + 1}/roster`, publicationAt: null,
  }));
  assert.equal(verifiedAssignmentsForRun(run, rows).length, 32);
  assert.deepEqual(verifiedAssignmentsForRun(run, rows.slice(1)), []);
  assert.deepEqual(verifiedAssignmentsForRun(run, [{ ...rows[0]!, teamId: "2" }, ...rows.slice(1)]), []);
  assert.deepEqual(verifiedAssignmentsForRun(run, [{ ...rows[0]!, observedAt: "2026-09-26T09:02:00Z" }, ...rows.slice(1)]), []);
  assert.deepEqual(verifiedAssignmentsForRun(run, [{ ...rows[0]!, sourcePath: "/injuries" }, ...rows.slice(1)]), []);
  assert.deepEqual(verifiedAssignmentsForRun({ ...run, status: "partial" }, rows), []);
  assert.deepEqual(verifiedAssignmentsForRun({ ...run, provider: "espn-injuries" }, rows), []);
  const scenario = {
    games: [{ ...upcomingGame, homeTeamId: "1" }],
    players: [{ ...player, playerId: "100", teamId: "1" }],
    identities: [{ ...identity, espnId: "100" }],
    injuries: [{ ...injury, playerId: "100", teamId: "1" }],
    depthCharts: [{ ...depth, playerId: "100", teamId: "1" }],
    providerRuns: [run],
  };
  assert.equal(audit({ ...scenario, verifiedRosterAssignments: verifiedAssignmentsForRun(run, rows) })
    .eligibility.eligible, 1);
  assert.equal(audit({ ...scenario, verifiedRosterAssignments: verifiedAssignmentsForRun(run, rows.slice(1)) })
    .eligibility.reasons.roster_assignment_not_recently_verified, 1);
});

test("a newer roster transfer invalidates a prior verified player/team pair", () => {
  const result = audit({
    verifiedRosterAssignments: [
      { playerId: player.playerId, teamId: player.teamId!, activeStatus: "Active",
        observedAt: "2026-09-26T09:00:00Z" },
      { playerId: player.playerId, teamId: "former-team", activeStatus: "Active",
        observedAt: "2026-09-26T10:00:00Z" },
    ],
  });
  assert.equal(result.eligibility.eligible, 0);
  assert.equal(result.eligibility.reasons.roster_assignment_not_recently_verified, 1);
});

test("strictly excludes same-week and future-week stats from prior appearance eligibility", () => {
  const result = audit({
    stats: [
      { ...priorStats[0]!, week: 1 },
      { ...priorStats[1]!, week: 2 },
      { ...priorStats[2]!, week: 3 },
      { ...priorStats[2]!, week: 4 },
    ],
  });
  assert.equal(result.eligibility.excluded, 1);
  assert.equal(result.eligibility.reasons.fewer_than_three_strictly_prior_regular_season_appearances, 1);
  assert.equal(result.forecasts.length, 0);
});

test("never generates forecasts, including when all eligibility checks pass", () => {
  const result = audit();
  assert.equal(result.status, "unavailable");
  assert.deepEqual(result.forecasts, []);
});

test("freshness measurement rejects future timestamps and preserves ingestion labels", () => {
  const future = measureFreshness({
    timestamp: new Date(asOf.getTime() + 1),
    asOf,
    label: "test source observation",
  });
  assert.equal(future.ageHours, null);
  assert.match(future.status, /invalid or in the future/i);
});

test("uses only the nearest future regular-season week and excludes invalid or postgame schedule rows", () => {
  const laterWeek: ReadinessGame = {
    ...upcomingGame,
    gameId: "later-week",
    week: 4,
    kickoffTime: new Date("2026-10-04T17:00:00.000Z"),
  };
  const result = audit({
    games: [
      { ...upcomingGame, gameId: "old", kickoffTime: new Date("2026-09-25T17:00:00.000Z") },
      { ...upcomingGame, gameId: "final", gameStatus: "Final" },
      { ...upcomingGame, gameId: "no-kickoff", kickoffTime: null },
      upcomingGame,
      laterWeek,
    ],
  });
  assert.equal(result.upcomingGames, 1);
});

test("chooses the earliest future kickoff even when a later season is already scheduled", () => {
  const result = audit({
    games: [upcomingGame, {
      ...upcomingGame,
      gameId: "next-season",
      season: 2027,
      week: 1,
      kickoffTime: new Date("2027-09-09T00:20:00Z"),
      homeTeamId: "different-team",
      awayTeamId: "another-team",
    }],
  });
  assert.equal(result.upcomingGames, 1);
  assert.equal(result.eligibility.eligible, 1);
  assert.match(result.message, /week 3/);
});