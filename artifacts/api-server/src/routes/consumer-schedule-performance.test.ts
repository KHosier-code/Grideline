import test from "node:test";
import assert from "node:assert/strict";
import { performance } from "node:perf_hooks";
import { pool } from "@workspace/db";
import { consumerScheduleSummaryQuery, unfamiliarGameStatusesQuery, unfamiliarStatusWarning } from "./consumer";
import { selectConsumerSlate, selectConsumerSlateSummaries } from "../lib/consumer-schedule-selection";
import { gameStatusVocabulary, interpretNflGameState } from "../lib/game-state";

type ScheduleRow = {
  season: number; week: number; first: Date; last: Date; live: boolean; upcoming: boolean;
};

type ConnectCallback = Exclude<Parameters<typeof pool.connect>[0], undefined>;
type PoolClient = NonNullable<Parameters<ConnectCallback>[1]>;

async function databaseSummaries(client: PoolClient, now: Date) {
  const compiled = consumerScheduleSummaryQuery(now).toSQL();
  const { rows } = await client.query<ScheduleRow>(compiled.sql, compiled.params);
  return rows;
}

// Each status occupies its own slate so bool_or cannot hide a mistaken classification.
// Include every terminal/live marker recognized by interpretNflGameState, alongside
// the provider's scheduled/unknown forms and normalization/precedence cases.
const statusCases = [
  { status: "STATUS_POSTPONED", state: "postponed" },
  { status: "Postponed", state: "postponed" },
  { status: "STATUS_CANCELED", state: "cancelled" },
  { status: "STATUS_CANCELLED", state: "cancelled" },
  { status: "Cancelled", state: "cancelled" },
  { status: "STATUS_FINAL", state: "final" },
  { status: "Final", state: "final" },
  { status: "STATUS_COMPLETED", state: "final" },
  { status: "closed", state: "final" },
  { status: "  CLOSED  ", state: "final" },
  { status: "unclosed", state: "pregame" },
  { status: "STATUS_IN_PROGRESS", state: "live" },
  { status: "in-progress", state: "live" },
  { status: "STATUS_HALFTIME", state: "live" },
  { status: "END_OF_PERIOD", state: "live" },
  { status: "SECOND_QUARTER", state: "live" },
  { status: "STATUS_SCHEDULED", state: "pregame" },
  { status: "Pre-Game", state: "pregame" },
  { status: "STATUS_UNKNOWN", state: "pregame" },
  { status: "unrecognized provider status", state: "pregame" },
  { status: "  STATUS_FINAL_IN_PROGRESS  ", state: "final" },
  { status: "STATUS_POSTPONED_IN_PROGRESS", state: "postponed" },
  { status: "STATUS_CANCELLED_IN_PROGRESS", state: "cancelled" },
  { status: "STATUS_COMPLETED_IN_PROGRESS", state: "final" },
] as const;

test("persisted unfamiliar statuses produce bounded operator evidence without changing the selector fallback", async () => {
  const client = await pool.connect();
  const kickoff = new Date("2026-09-20T20:00:00Z");
  try {
    await client.query(`CREATE TEMP TABLE games (
      season integer NOT NULL, week integer NOT NULL,
      kickoff_time timestamptz, game_status text
    )`);
    for (const [index, { status, state }] of statusCases.entries()) {
      await client.query(
        "INSERT INTO games (season, week, kickoff_time, game_status) VALUES ($1, 1, $2, $3)",
        [2100 + index, kickoff, status],
      );
      assert.equal(gameStatusVocabulary(status),
        ["unrecognized provider status", "unclosed"].includes(status) ? "unknown"
          : state === "pregame" ? "scheduled"
            : ["final", "postponed", "cancelled"].includes(state) ? "terminal" : "live");
    }
    const malicious = "NEW<script>status</script>" + "x".repeat(500);
    for (let i = 0; i < 8; i++) {
      await client.query(
        "INSERT INTO games (season, week, kickoff_time, game_status) VALUES ($1, 2, $2, $3)",
        [2200 + i, kickoff, i === 7 ? malicious : `STATUS_NEW_${i}`],
      );
    }
    await client.query("INSERT INTO games (season, week, kickoff_time, game_status) VALUES (2209, 2, $1, NULL)", [kickoff]);
    const compiled = unfamiliarGameStatusesQuery().toSQL();
    const { rows: rawRows } = await client.query<{
      season: number; week: number; game_status: string | null; total: string;
    }>(compiled.sql, compiled.params);
    const rows = rawRows.map(({ game_status, ...row }) => ({ ...row, gameStatus: game_status }));
    assert.equal(rows.length, 5);
    assert.equal(Number(rows[0].total), 11);
    assert.ok(rows.every((row) => gameStatusVocabulary(row.gameStatus) === "unknown"));
    const warning = unfamiliarStatusWarning(rows);
    assert.equal(warning?.count, 11);
    assert.equal(warning?.examples.length, 5);
    assert.ok(warning?.examples.every((example) => example.status.length <= 48 && !/[<>]/.test(example.status)));
    assert.ok(warning?.examples.some((example) => example.status.startsWith("NEW?script?status")), JSON.stringify(warning));
    assert.equal(unfamiliarStatusWarning([]), null);
    assert.equal(interpretNflGameState({ gameStatus: malicious, kickoffTime: kickoff }, new Date(kickoff.getTime() - 1)), "pregame");
    assert.deepEqual(
      selectConsumerSlate([{ season: 2200, week: 2, kickoffTime: kickoff, gameStatus: malicious }], new Date(kickoff.getTime() - 1)),
      { selection: { season: 2200, week: 2 }, reason: "upcoming" },
    );
  } finally {
    await client.query("DROP TABLE IF EXISTS pg_temp.games");
    client.release();
  }
});

test("database schedule eligibility matches every supported provider status at kickoff and the eight-hour boundary", async () => {
  const client = await pool.connect();
  const kickoff = new Date("2026-09-20T20:00:00.000Z");
  const before = new Date(kickoff.getTime() - 1);
  const cutoff = new Date(kickoff.getTime() + 8 * 60 * 60_000);
  try {
    await client.query(`CREATE TEMP TABLE games (
      season integer NOT NULL, week integer NOT NULL,
      kickoff_time timestamptz, game_status text NOT NULL
    )`);
    for (const [index, { status }] of statusCases.entries()) {
      await client.query(
        "INSERT INTO games (season, week, kickoff_time, game_status) VALUES ($1, 1, $2, $3)",
        [2100 + index, kickoff, status],
      );
    }
    for (const [label, now] of [
      ["before kickoff", before],
      ["at kickoff", kickoff],
      ["at eight hours", cutoff],
      ["past eight hours", new Date(cutoff.getTime() + 1)],
    ] as const) {
      const summaries = await databaseSummaries(client, now);
      assert.equal(summaries.length, statusCases.length, label);
      for (const [index, { status, state }] of statusCases.entries()) {
        const actual = summaries.find((row) => row.season === 2100 + index);
        assert.ok(actual, `${label}: ${status} missing from SQL`);
        const terminal = ["final", "postponed", "cancelled"].includes(state);
        const expectedState = state === "pregame" && now >= kickoff ? "live" : state;
        assert.equal(interpretNflGameState({ gameStatus: status, kickoffTime: kickoff }, now),
          expectedState, `${label}: canonical state for ${status}`);
        assert.deepEqual(
          { live: actual.live, upcoming: actual.upcoming },
          { live: !terminal && now >= kickoff && now <= cutoff,
            upcoming: state === "pregame" && now < kickoff },
          `${label}: SQL eligibility for ${status}`,
        );
        assert.deepEqual(
          selectConsumerSlateSummaries([actual]),
          selectConsumerSlate([{ season: 2100 + index, week: 1, kickoffTime: kickoff, gameStatus: status }], now),
          `${label}: selector parity for ${status}`,
        );
      }
    }
  } finally {
    await client.query("DROP TABLE IF EXISTS pg_temp.games");
    client.release();
  }
});

test("mixed-status slates choose live, upcoming, then past across kickoff and expiry", async () => {
  const client = await pool.connect();
  const kickoff = new Date("2026-09-20T20:00:00.000Z");
  const at = (offset: number) => new Date(kickoff.getTime() + offset);
  const games = [
    { season: 2026, week: 1, kickoffTime: at(-60_000), gameStatus: "STATUS_FINAL" },
    { season: 2026, week: 1, kickoffTime: kickoff, gameStatus: "STATUS_SCHEDULED" },
    { season: 2026, week: 1, kickoffTime: at(60_000), gameStatus: "STATUS_POSTPONED" },
    { season: 2026, week: 2, kickoffTime: at(60_000), gameStatus: "STATUS_IN_PROGRESS" },
    { season: 2026, week: 2, kickoffTime: at(2 * 60_000), gameStatus: "STATUS_UNKNOWN" },
    { season: 2026, week: 3, kickoffTime: at(10 * 60 * 60_000), gameStatus: "STATUS_SCHEDULED" },
  ];
  try {
    await client.query(`CREATE TEMP TABLE games (
      season integer NOT NULL, week integer NOT NULL,
      kickoff_time timestamptz, game_status text NOT NULL
    )`);
    for (const game of games) {
      await client.query(
        "INSERT INTO games (season, week, kickoff_time, game_status) VALUES ($1, $2, $3, $4)",
        [game.season, game.week, game.kickoffTime, game.gameStatus],
      );
    }
    for (const [label, now, expected] of [
      ["before kickoff", at(-1), { selection: { season: 2026, week: 1 }, reason: "upcoming" }],
      ["at kickoff", kickoff, { selection: { season: 2026, week: 1 }, reason: "live" }],
      ["just before next kickoff", at(60_000 - 1), { selection: { season: 2026, week: 1 }, reason: "live" }],
      ["at next kickoff", at(60_000), { selection: { season: 2026, week: 2 }, reason: "live" }],
      ["at eight hours after first kickoff", at(8 * 60 * 60_000), { selection: { season: 2026, week: 2 }, reason: "live" }],
      ["at eight hours after last kickoff", at(8 * 60 * 60_000 + 2 * 60_000), { selection: { season: 2026, week: 2 }, reason: "live" }],
      ["just after eight hours after last kickoff", at(8 * 60 * 60_000 + 2 * 60_000 + 1), { selection: { season: 2026, week: 3 }, reason: "upcoming" }],
      ["after all kickoffs", at(20 * 60 * 60_000), { selection: { season: 2026, week: 3 }, reason: "past" }],
    ] as const) {
      const summaries = await databaseSummaries(client, now);
      assert.deepEqual(selectConsumerSlateSummaries(summaries), expected, `${label}: database choice`);
      assert.deepEqual(selectConsumerSlate(games, now), expected, `${label}: canonical choice`);
      assert.equal(summaries.find((row) => row.week === 1)?.first.getTime(), at(-60_000).getTime(),
        `${label}: a final game still sets the first kickoff`);
    }
  } finally {
    await client.query("DROP TABLE IF EXISTS pg_temp.games");
    client.release();
  }
});

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
