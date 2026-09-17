import assert from "node:assert/strict";
import test from "node:test";
import {
  changedSleeperPlayers,
  fetchSleeperPlayers,
  isoTimestamp,
  SLEEPER_ACTIVE_TEAM_CODES,
  SLEEPER_PLAYERS_URL,
  sleeperSyncIntervalHours,
  sleeperTeamCoverage,
  type SleeperPlayer,
} from "./sleeper";
import { schedulerProcessOwnsRecurringJobs } from "./scheduler";

function player(index: number, team: string): SleeperPlayer {
  return {
    player_id: `player-${index}`,
    full_name: `Player ${index}`,
    first_name: "Player",
    last_name: String(index),
    team,
    position: "QB",
    fantasy_positions: ["QB"],
    depth_chart_position: "QB",
    depth_chart_order: 1,
    status: "Active",
    injury_status: null,
    practice_participation: null,
    years_exp: 1,
    age: 25,
    provider_ids: { gsis_id: `gsis-${index}` },
  };
}

test("Sleeper client performs one full-feed fetch and preserves all teams", async () => {
  let calls = 0;
  const payload = Object.fromEntries(
    SLEEPER_ACTIVE_TEAM_CODES.map((team, index) => [`id-${index}`, {
      ...player(index, team),
      gsis_id: `gsis-${index}`,
    }]),
  );
  const players = await fetchSleeperPlayers(async (url, init) => {
    calls += 1;
    assert.equal(url, SLEEPER_PLAYERS_URL);
    assert.equal((init?.headers as Record<string, string>)["User-Agent"], "Gridline/0.2 (Sleeper sync)");
    return new Response(JSON.stringify(payload), { status: 200 });
  });
  assert.equal(calls, 1);
  assert.equal(players.length, 32);
  assert.equal(new Set(players.map((item) => item.team)).size, 32);
  assert.deepEqual(players[0]?.provider_ids, { gsis_id: "gsis-0" });
  assert.equal(sleeperTeamCoverage(players).teamCount, 32);
});

test("active-team health excludes legacy provider labels without dropping players", () => {
  const players = [
    ...SLEEPER_ACTIVE_TEAM_CODES.map((team, index) => player(index, team)),
    player(99, "OAK"),
  ];
  const coverage = sleeperTeamCoverage(players);
  assert.equal(players.length, 33);
  assert.equal(coverage.teamCount, 32);
  assert.equal(coverage.rawTeamCount, 33);
  assert.deepEqual(coverage.unexpectedTeamCodes, ["OAK"]);
});

test("Sleeper client bounds retries and classifies provider failures", async () => {
  let calls = 0;
  await assert.rejects(
    () => fetchSleeperPlayers(async () => {
      calls += 1;
      return new Response("unavailable", { status: 503 });
    }),
    (error: unknown) => error instanceof Error
      && error.name === "SleeperProviderError"
      && error.message.includes("HTTP 503"),
  );
  assert.equal(calls, 3);
});

test("latest-state dedupe suppresses unchanged rows and preserves A-B-A history", () => {
  const normalizedA: SleeperPlayer = {
    player_id: "player-1",
    full_name: "Player 1",
    first_name: "Player",
    last_name: "1",
    team: "BUF",
    position: "QB",
    fantasy_positions: ["QB"],
    depth_chart_position: "QB",
    depth_chart_order: 1,
    status: "Active",
    injury_status: null,
    practice_participation: null,
    years_exp: 3,
    age: 26,
    provider_ids: { gsis_id: "gsis-1" },
  };
  const first = changedSleeperPlayers([normalizedA], new Map());
  assert.equal(first.length, 1);
  const hashA = first[0]!.sourceHash;
  assert.equal(changedSleeperPlayers([normalizedA], new Map([["player-1", hashA]])).length, 0);
  const normalizedB = { ...normalizedA, depth_chart_order: 2 };
  const second = changedSleeperPlayers([normalizedB], new Map([["player-1", hashA]]));
  assert.equal(second.length, 1);
  assert.equal(changedSleeperPlayers([normalizedA], new Map([["player-1", second[0]!.sourceHash]])).length, 1);
});

test("Sleeper cadence is configurable but bounded", () => {
  const original = process.env.GRIDLINE_SLEEPER_SYNC_INTERVAL_HOURS;
  process.env.GRIDLINE_SLEEPER_SYNC_INTERVAL_HOURS = "48";
  assert.equal(sleeperSyncIntervalHours(), 48);
  process.env.GRIDLINE_SLEEPER_SYNC_INTERVAL_HOURS = "0";
  assert.equal(sleeperSyncIntervalHours(), 24);
  if (original === undefined) delete process.env.GRIDLINE_SLEEPER_SYNC_INTERVAL_HOURS;
  else process.env.GRIDLINE_SLEEPER_SYNC_INTERVAL_HOURS = original;
});

test("recurring Sleeper work is owned only by the persistent worker", () => {
  assert.equal(schedulerProcessOwnsRecurringJobs({ GRIDLINE_SCHEDULER_WORKER: "1" }), true);
  assert.equal(schedulerProcessOwnsRecurringJobs({ GRIDLINE_SCHEDULER_WORKER: "0" }), false);
  assert.equal(schedulerProcessOwnsRecurringJobs({ GRIDLINE_SCHEDULER_WORKER: undefined }), false);
});

test("Sleeper health timestamps accept PostgreSQL string aggregates", () => {
  assert.equal(
    isoTimestamp("2026-09-17 01:56:56.606+00"),
    "2026-09-17T01:56:56.606Z",
  );
  assert.equal(isoTimestamp("not-a-timestamp"), null);
});