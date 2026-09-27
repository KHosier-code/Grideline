import test from "node:test";
import assert from "node:assert/strict";
import { performance } from "node:perf_hooks";
import { sql } from "drizzle-orm";
import { db } from "@workspace/db";
import { buildPlayerPositionMatchup } from "./player-position-matchup";
import { buildDefenseVsPosition, readDefenseInputs, readMatchupDefenseInputs } from "./defense-vs-position";

const fixture = process.env.GRIDLINE_PLAYER_POSITION_FIXTURE === "1";
const realSeason = process.env.GRIDLINE_PLAYER_POSITION_REAL_SEASON === "1";
assert.notEqual(fixture, realSeason,
  "Choose the disposable fixture runner or the explicit read-only real-season rehearsal");

// The upcoming game exists only in memory. This assertion is shared by the
// disposable full-season CI fixture and the opt-in imported-season rehearsal.
test("cold selected-player read stays bounded across a full season", async () => {
  const season = 2025;
  const now = new Date("2026-10-01T12:00:00Z");
  const game = {
    gameId: "performance-only-upcoming", season, week: 18,
    kickoffTime: new Date("2026-10-02T12:00:00Z"),
    gameStatus: "STATUS_SCHEDULED",
    homeTeamId: fixture ? "fixture-1" : "kc",
    awayTeamId: fixture ? "fixture-2" : "lar",
  };
  const countsResult = await db.execute<{ games: number; stats: number }>(sql`
    select (select count(*)::integer from games where season = ${season}) as games,
           (select count(*)::integer from player_game_stats where season = ${season}) as stats
  `);
  const counts = countsResult.rows[0];
  assert.ok(counts && counts.games >= 270 && counts.stats >= 15_000,
    "Full-season fixture required; no partial-season timing assertion");

  const baselineStart = performance.now();
  const baseline = await readDefenseInputs(season, game.kickoffTime);
  const oldCandidates = buildPlayerPositionMatchup(baseline, game, now, "WR", "last5");
  if (fixture) await db.execute(sql`select pg_stat_statements_reset()`);
  const start = performance.now();
  const scoped = await readMatchupDefenseInputs(season, game.kickoffTime, game.homeTeamId, game.awayTeamId);
  if (fixture) {
    const queries = await db.execute<{ calls: number }>(sql`
      select coalesce(sum(calls), 0)::integer as calls
      from pg_stat_statements
      where dbid = (select oid from pg_database where datname = current_database())
        and lower(ltrim(query)) like 'select%'
        and query not ilike '%pg_stat_statements%'
    `);
    assert.equal(queries.rows[0]?.calls, 6,
      "Scoped read must use only six bounded SQL selects (schedule, teams, sources, three evidence tables)");
  }
  const candidates = buildPlayerPositionMatchup(scoped, game, now, "WR", "last5");
  const key = candidates?.candidates[0]?.selectionKey;
  assert.ok(key, "A full season should offer a selected receiver");
  assert.deepEqual(candidates?.candidates, oldCandidates?.candidates);
  const selected = buildPlayerPositionMatchup(scoped, game, now, "WR", "last5", key);
  const elapsed = performance.now() - start;
  const oldSelected = buildPlayerPositionMatchup(baseline, game, now, "WR", "last5", key);
  const baselineMs = performance.now() - baselineStart - elapsed;
  assert.equal(selected?.status, "selected");
  assert.deepEqual(selected?.candidates, oldSelected?.candidates);
  assert.deepEqual(selected?.metrics, oldSelected?.metrics);
  assert.deepEqual(selected?.score, oldSelected?.score);
  if (fixture) {
    assert.ok((selected?.metrics.receivingYards?.defense?.coveredGames ?? 0) >= 3,
      "Fixture must exercise actual selected-defense coverage");
    assert.ok(selected?.metrics.receivingYards?.player?.coveredGames >= 3,
      "Fixture must exercise actual selected-player coverage");
    assert.ok(selected?.metrics.targets?.player?.missingWeeks.includes(17),
      "Fixture must exercise missing selected-player metric coverage");
    assert.ok(selected?.metrics.targets?.defense?.missingWeeks.includes(17),
      "Fixture must exercise missing opponent-defense metric coverage");
    const allDefense = buildDefenseVsPosition(baseline, season, now, game.gameId, "last5");
    const selectedDefense = buildDefenseVsPosition(scoped, season, now, game.gameId, "last5");
    for (const abbreviation of ["KC", "LAR"]) {
      assert.deepEqual(selectedDefense.defenses.find(d => d.abbreviation === abbreviation),
        allDefense.defenses.find(d => d.abbreviation === abbreviation));
    }
    assert.ok(scoped.rzPlayers.length > 0 && scoped.rzTeams.length > 0);
  }
  assert.ok(scoped.stats.length < baseline.stats.length * 0.4,
    `selected matchup transferred ${scoped.stats.length}/${baseline.stats.length} stat rows`);
  assert.ok(elapsed < 5_000, `cold selected-player read took ${elapsed.toFixed(0)}ms`);
  process.stdout.write(`${fixture ? "Disposable" : "Imported"} full season: baseline ${baselineMs.toFixed(0)}ms/${baseline.stats.length} stats; ` +
    `scoped ${elapsed.toFixed(0)}ms/${scoped.stats.length} stats, ` +
    `${scoped.rzPlayers.length} player red-zone rows, ${scoped.rzTeams.length} team red-zone rows\n`);
});

test("imported season retains both sides' verified red-zone and missing-metric coverage",
  { skip: !realSeason }, async () => {
  const season = 2026;
  const now = new Date("2027-01-01T12:00:00Z");
  const game = {
    gameId: "performance-only-red-zone", season, week: 18,
    kickoffTime: new Date("2027-01-02T12:00:00Z"),
    gameStatus: "STATUS_SCHEDULED", homeTeamId: "12", awayTeamId: "14",
  };
  const [all, scoped] = await Promise.all([
    readDefenseInputs(season, game.kickoffTime),
    readMatchupDefenseInputs(season, game.kickoffTime, game.homeTeamId, game.awayTeamId),
  ]);
  assert.ok(scoped.rzPlayers.length > 0 && scoped.rzTeams.length > 0,
    "Expected actual PBP-derived evidence for selected teams");
  const a = buildDefenseVsPosition(all, season, now, game.gameId);
  const b = buildDefenseVsPosition(scoped, season, now, game.gameId);
  for (const abbreviation of ["KC", "LAR"]) {
    assert.deepEqual(b.defenses.find((d) => d.abbreviation === abbreviation),
      a.defenses.find((d) => d.abbreviation === abbreviation));
  }
  const key = buildPlayerPositionMatchup(scoped, game, now, "RB", "last3")?.candidates[0]?.selectionKey;
  assert.ok(key);
  const selected = buildPlayerPositionMatchup(scoped, game, now, "RB", "last3", key);
  const old = buildPlayerPositionMatchup(all, game, now, "RB", "last3", key);
  assert.deepEqual(selected?.metrics, old?.metrics);
  assert.deepEqual(selected?.score, old?.score);
});