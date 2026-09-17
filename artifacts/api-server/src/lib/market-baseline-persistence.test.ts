import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test, { after } from "node:test";
import { pool } from "@workspace/db";

test("market baseline evidence is recorded-only, timestamp-safe, and append-only", async () => {
  const runId = `market-baseline-integration-${randomUUID()}`;
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query(
      `INSERT INTO market_baseline_runs
        (run_id, season, source, source_url, source_files, source_fingerprints, status, metadata)
       VALUES ($1, 2025, 'integration-test', 'https://example.test/source',
         '["games.csv"]'::jsonb, '{"games.csv":"test"}'::jsonb, 'test', '{}'::jsonb)`,
      [runId],
    );
    await client.query(
      `INSERT INTO market_baseline_events
        (run_id, source_game_id, alt_game_id, outcome, reason, candidate_game_ids)
       VALUES ($1, 'source-game', 'alt-game', 'unmatched', 'integration test', '[]'::jsonb)`,
      [runId],
    );
    await client.query(
      `INSERT INTO market_baseline_quotes
        (run_id, source_game_id, alt_game_id, source_file, family, side, point, price, source_designation)
       VALUES ($1, 'source-game', 'alt-game', 'games.csv', 'spread', 'home', -3, -110,
         'source_designated_recorded')`,
      [runId],
    );

    await assert.rejects(
      () => client.query("UPDATE market_baseline_runs SET status = 'changed' WHERE run_id = $1", [runId]),
      /append-only/i,
    );
    await client.query("ROLLBACK");

    await client.query("BEGIN");
    await assert.rejects(
      () => client.query(
        `INSERT INTO market_baseline_quotes
          (run_id, source_game_id, alt_game_id, source_file, family, side, source_designation, observed_at)
         VALUES ($1, 'bad-time', 'bad-time', 'games.csv', 'moneyline', 'home',
           'source_designated_recorded', now())`,
        [runId],
      ),
      /market_baseline_no_inferred_time/i,
    );
    await client.query("ROLLBACK");

    await client.query("BEGIN");
    await assert.rejects(
      () => client.query(
        `INSERT INTO market_baseline_quotes
          (run_id, source_game_id, alt_game_id, source_file, family, side, source_designation)
         VALUES ($1, 'bad-close', 'bad-close', 'games.csv', 'moneyline', 'home', 'verified_closing')`,
        [runId],
      ),
      /market_baseline_recorded_only|market_baseline_quotes_source_designation_check/i,
    );
  } finally {
    await client.query("ROLLBACK");
    client.release();
  }
});

after(async () => {
  await pool.end();
});