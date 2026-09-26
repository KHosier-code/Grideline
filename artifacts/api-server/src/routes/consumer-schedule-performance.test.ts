import test from "node:test";
import assert from "node:assert/strict";
import { performance } from "node:perf_hooks";
import { pool } from "@workspace/db";
import { consumerScheduleSummaryQuery } from "./consumer";
import { selectConsumerSlate, selectConsumerSlateSummaries } from "../lib/consumer-schedule-selection";

test("schedule selection aggregates a century of games without transferring game history", async () => {
  const client = await pool.connect();
  try {
    await client.query(`CREATE TEMP TABLE games (
      season integer NOT NULL, week integer NOT NULL,
      kickoff_time timestamptz, game_status text NOT NULL
    )`);
    // 100 seasons of 18 regular weeks and four postseason weeks; 16 games
    // per week is deliberately a full-size rather than a toy schedule.
    await client.query(`INSERT INTO games (season, week, kickoff_time, game_status)
      SELECT season, week,
        make_timestamptz(season, 9, 1, 17, 0, 0, 'UTC')
          + (week - 1) * interval '7 days' + game * interval '10 minutes',
        'STATUS_FINAL'
      FROM generate_series(1927, 2026) season
      CROSS JOIN generate_series(1, 22) week
      CROSS JOIN generate_series(0, 15) game`);
    // A finalized early game must still determine the slate's FIRST kickoff.
    // A future in-progress status must not count as upcoming.
    await client.query(`UPDATE games SET game_status = 'STATUS_SCHEDULED'
      WHERE season = 2026 AND week = 19 AND kickoff_time = (
        SELECT max(kickoff_time) FROM games WHERE season = 2026 AND week = 19
      )`);
    await client.query(`UPDATE games SET game_status = 'STATUS_IN_PROGRESS'
      WHERE season = 2026 AND week = 18 AND kickoff_time = (
        SELECT max(kickoff_time) FROM games WHERE season = 2026 AND week = 18
      )`);
    await client.query(`UPDATE games SET game_status = 'STATUS_IN_PROGRESS'
      WHERE season = 2026 AND week = 20`);
    await client.query(`UPDATE games SET game_status = 'STATUS_POSTPONED'
      WHERE season = 2026 AND week = 21`);
    await client.query(`UPDATE games SET kickoff_time = NULL
      WHERE season = 1927 AND week = 1 AND kickoff_time = (
        SELECT min(kickoff_time) FROM games WHERE season = 1927 AND week = 1
      )`);
    const { rows: history } = await client.query<{
      season: number; week: number; kickoff_time: Date | null; game_status: string;
    }>("SELECT season, week, kickoff_time, game_status FROM games ORDER BY season, week, kickoff_time");
    assert.equal(history.length, 35_200);

    for (const now of [
      new Date("2027-01-05T16:00:00Z"), // postseason upcoming
      new Date("2026-12-29T20:00:00Z"), // week 18 in progress
      new Date("2027-01-11T16:00:00Z"), // future in-progress/postponed cannot count as upcoming
      new Date("2028-08-01T00:00:00Z"), // no future games: latest past
    ]) {
      const compiled = consumerScheduleSummaryQuery(now).toSQL();
      const started = performance.now();
      const { rows } = await client.query<{
        season: number; week: number; first: Date; last: Date; live: boolean; upcoming: boolean;
      }>(compiled.sql, compiled.params);
      const elapsed = performance.now() - started;
      assert.equal(rows.length, 2_200);
      assert.ok(elapsed < 3_000, `35,200-game aggregate took ${elapsed.toFixed(0)}ms`);
      assert.deepEqual(selectConsumerSlateSummaries(rows), selectConsumerSlate(history.map((row) => ({
        season: row.season, week: row.week, kickoffTime: row.kickoff_time, gameStatus: row.game_status,
      })), now));
    }
  } finally {
    // TEMP tables are session-local and never touch persisted schedule rows.
    await client.query("DROP TABLE IF EXISTS pg_temp.games");
    client.release();
  }
});