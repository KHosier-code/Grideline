import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { pool } from "@workspace/db";
import {
  classifyWorkerObservation,
  getWorkerObservation,
  startWorkerHeartbeat,
  WORKER_HEARTBEAT_STALE_MS,
} from "./worker-heartbeat";

const now = new Date("2026-09-26T12:00:00.000Z");

test("worker observation distinguishes fresh, stopped and never observed without inspecting feeds", () => {
  assert.equal(classifyWorkerObservation(null, now).state, "unobserved");
  assert.equal(classifyWorkerObservation(
    new Date(now.getTime() - WORKER_HEARTBEAT_STALE_MS), now,
  ).state, "observed");
  assert.equal(classifyWorkerObservation(
    new Date(now.getTime() - WORKER_HEARTBEAT_STALE_MS - 1), now,
  ).state, "stopped");
  assert.equal(classifyWorkerObservation(
    new Date(now.getTime() + 60_000), now,
  ).state, "unknown");
});

test("fresh migrated schema supports worker heartbeat; missing table fails explicitly", async () => {
  const client = await pool.connect();
  const schema = `heartbeat_test_${randomUUID().replaceAll("-", "")}`;
  let stop: (() => void) | undefined;
  try {
    await client.query(`CREATE SCHEMA "${schema}"`);
    await client.query(`SET search_path TO "${schema}"`);
    await assert.rejects(getWorkerObservation(client), /worker_heartbeat/);
    await assert.rejects(startWorkerHeartbeat(client), /worker_heartbeat/);
    const migration = await readFile(
      new URL("../../../../lib/db/migrations/0047_worker_heartbeat.sql", import.meta.url),
      "utf8",
    );
    await client.query(migration);
    assert.equal((await getWorkerObservation(client)).state, "unobserved");
    stop = await startWorkerHeartbeat(client);
    const observed = await getWorkerObservation(client);
    assert.equal(observed.state, "observed");
    assert.ok(observed.lastObservedAt);
    await client.query(
      "UPDATE worker_heartbeat SET observed_at = now() - interval '2 minutes' WHERE id = 1",
    );
    assert.equal((await getWorkerObservation(client)).state, "stopped");
  } finally {
    stop?.();
    await client.query("SET search_path TO public");
    await client.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
    client.release();
  }
});