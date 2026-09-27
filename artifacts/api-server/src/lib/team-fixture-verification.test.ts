import assert from "node:assert/strict";
import test from "node:test";
import type { EspnGame } from "./espn";
import { createTeamFixtureVerifier } from "./team-fixture-verification";

function fixture(week: number): EspnGame[] {
  return [{
    season: 2025, week, gameId: `game-${week}`,
    homeTeam: { teamId: "1" }, awayTeam: { teamId: "2" },
  } as EspnGame];
}

test("limits parallel fetches, coalesces requests and serves successful cached fixtures", async () => {
  const waiting: Array<() => void> = [];
  let active = 0;
  let peak = 0;
  let calls = 0;
  const verifier = createTeamFixtureVerifier(async (_season, week) => {
    calls++;
    active++;
    peak = Math.max(peak, active);
    await new Promise<void>((resolve) => waiting.push(resolve));
    active--;
    return fixture(week);
  }, { responseBudgetMs: 1 });

  const first = await verifier.getWeeks(2025, 18);
  assert.equal(first.filter((week) => week.games !== null).length, 0);
  assert.equal(peak, 3);
  await verifier.getWeeks(2025, 18);
  assert.equal(calls, 3, "overlapping requests reuse queued work");
  for (let i = 0; i < 18; i += 3) {
    waiting.splice(0).forEach((resolve) => resolve());
    await new Promise((resolve) => setImmediate(resolve));
  }
  const verified = await verifier.getWeeks(2025, 18);
  assert.equal(peak, 3);
  assert.equal(calls, 18);
  assert.equal(verified.filter((week) => week.games !== null).length, 18);
  await verifier.getWeeks(2025, 18);
  assert.equal(calls, 18, "valid cache hits do not refetch");
});

test("does not cache empty, malformed or failed weeks, and expires verified evidence", async () => {
  let calls = 0;
  const verifier = createTeamFixtureVerifier(async (_season, week) => {
    calls++;
    if (week === 1) return [];
    if (week === 2) throw new Error("unavailable");
    if (week === 3) return fixture(4);
    return fixture(week);
  }, { cacheTtlMs: 20 });
  const first = await verifier.getWeeks(2025, 4);
  assert.deepEqual(first.map((entry) => !!entry.games), [false, false, false, true]);
  await verifier.getWeeks(2025, 4);
  assert.equal(calls, 7, "only failed weeks are retried");
  await new Promise((resolve) => setTimeout(resolve, 25));
  const expired = await verifier.getWeeks(2025, 4);
  assert.equal(calls, 11, "expired verification is fetched again");
  assert.equal(expired[3]?.games?.[0]?.gameId, "game-4");
});