import assert from "node:assert/strict";
import test from "node:test";
import { randomUUID } from "node:crypto";
import { pool } from "@workspace/db";

test("database rejects duplicate officials and all post-freeze mutation", async () => {
  const client = await pool.connect();
  const gameId = `gl003-test-${randomUUID()}`;
  try {
    await client.query("BEGIN");
    await client.query(`INSERT INTO prediction_snapshots
      (snapshot_key, game_id, prediction_timestamp, snapshot_label, feature_version,
       training_cutoff, official_final_prediction, evaluation_cutoff_at, frozen_at, kickoff_time)
      VALUES ($1, $2, $3, 'test-official', 'test', 'test', true, $3, $3, $4)`,
      [`${gameId}:one`, gameId, "2026-09-20T16:30:00Z", "2026-09-20T17:00:00Z"]);
    await client.query("SAVEPOINT duplicate_check");
    await assert.rejects(client.query(`INSERT INTO prediction_snapshots
      (snapshot_key, game_id, snapshot_label, feature_version, training_cutoff, official_final_prediction)
      VALUES ($1, $2, 'test-official', 'test', 'test', true)`,
      [`${gameId}:two`, gameId]), /prediction_snapshots_one_official_per_game/);
    await client.query("ROLLBACK TO SAVEPOINT duplicate_check");
    await client.query("SAVEPOINT update_check");
    await assert.rejects(client.query(
      "UPDATE prediction_snapshots SET snapshot_label='changed' WHERE snapshot_key=$1",
      [`${gameId}:one`],
    ), /official prediction snapshots are immutable/);
    await client.query("ROLLBACK TO SAVEPOINT update_check");
    await client.query("SAVEPOINT delete_check");
    await assert.rejects(client.query(
      "DELETE FROM prediction_snapshots WHERE snapshot_key=$1",
      [`${gameId}:one`],
    ), /official prediction snapshots are immutable/);
  } finally {
    await client.query("ROLLBACK");
    client.release();
  }
});