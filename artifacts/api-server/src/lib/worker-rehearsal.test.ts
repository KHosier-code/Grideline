import test from "node:test";
import assert from "node:assert/strict";
import { userInfo } from "node:os";
import {
  assertWorkerStartupConfiguration, assertDisposableDatabaseIdentity,
} from "./worker-rehearsal";
import { expiredFreezeReason, lateClaimedFreezeReason } from "./scheduler";

const valid = {
  DATABASE_URL: `postgresql://${userInfo().username}@127.0.0.1:55429/gridline_rehearsal`,
  GRIDLINE_WORKER_REHEARSAL: "1",
  GRIDLINE_REHEARSAL_NO_PROVIDERS: "1",
  GRIDLINE_REHEARSAL_NO_SCHEDULED_EXECUTION: "1",
  GRIDLINE_REHEARSAL_NO_RETENTION: "1",
  GRIDLINE_REHEARSAL_MARKER: "a".repeat(32),
  GRIDLINE_REHEARSAL_SYSTEM_ID: "12345678901234567890",
  GRIDLINE_REHEARSAL_NOW: "2026-09-26T02:09:54.000Z",
};

test("rehearsal rejects missing, contradictory, remote and live-bound settings before imports", () => {
  assert.doesNotThrow(() => assertWorkerStartupConfiguration(valid));
  for (const key of Object.keys(valid)) {
    const broken = { ...valid } as Record<string, string>;
    delete broken[key];
    assert.throws(() => assertWorkerStartupConfiguration(broken), key);
  }
  for (const [key, value] of Object.entries({
    GRIDLINE_NEW_WORKER_APPROVED: "1",
    GRIDLINE_SCHEDULER_WORKER: "1",
    GRIDLINE_REHEARSAL_NO_PROVIDERS: "0",
    GRIDLINE_REHEARSAL_NO_SCHEDULED_EXECUTION: "false",
    GRIDLINE_REHEARSAL_NO_RETENTION: "0",
    DATABASE_URL: "postgresql://runner@remote.example/gridline_rehearsal",
  })) {
    assert.throws(() => assertWorkerStartupConfiguration({ ...valid, [key]: value }), key);
  }
  assert.throws(() => assertWorkerStartupConfiguration({ ...valid, DATABASE_URL:
    `postgresql://${userInfo().username}@127.0.0.1:55429/heliumdb` }));
  assert.throws(() => assertWorkerStartupConfiguration({ ...valid, DATABASE_URL:
    `postgresql://${userInfo().username}:password@127.0.0.1:55429/gridline_rehearsal` }));
  assert.throws(() => assertWorkerStartupConfiguration({ ...valid, DATABASE_URL:
    `postgresql://${userInfo().username}@127.0.0.1:55429/gridline_rehearsal?sslmode=require` }));
});

test("normal worker remains separately approved; rehearsal flags cannot bleed into it", () => {
  assert.equal(assertWorkerStartupConfiguration({ GRIDLINE_NEW_WORKER_APPROVED: "1" }), null);
  assert.throws(() => assertWorkerStartupConfiguration({}));
  assert.throws(() => assertWorkerStartupConfiguration({ GRIDLINE_NEW_WORKER_APPROVED: "1",
    GRIDLINE_WORKER_REHEARSAL: "0" }));
  assert.throws(() => assertWorkerStartupConfiguration({ GRIDLINE_NEW_WORKER_APPROVED: "1",
    GRIDLINE_REHEARSAL_NO_RETENTION: "1" }));
});

test("server identity and marker must both match before ownership", async () => {
  const expected = {
    database_name: "gridline_rehearsal", system_id: valid.GRIDLINE_REHEARSAL_SYSTEM_ID,
    marker: `gridline-disposable:${valid.GRIDLINE_REHEARSAL_MARKER}`,
    server_address: "127.0.0.1/32",
  };
  await assertDisposableDatabaseIdentity(valid, async () => ({ rows: [expected] }));
  for (const key of Object.keys(expected)) {
    await assert.rejects(assertDisposableDatabaseIdentity(valid,
      async () => ({ rows: [{ ...expected, [key]: "wrong" }] })), key);
  }
});

test("historical and flexed freeze windows retire; timely claims stay eligible", () => {
  const now = new Date("2026-09-26T02:09:54Z");
  const past = new Date("2026-09-18T00:45:00Z");
  const future = new Date("2026-09-27T17:00:00Z");
  for (const kind of ["prediction-freeze", "prediction-canonical"]) {
    const job = { kind, jobKey: `${kind}-g`, nextRunAt: past };
    assert.match(expiredFreezeReason(job, past, now) ?? "", /kickoff elapsed/);
    assert.match(expiredFreezeReason(job, future, now) ?? "", /occurrence elapsed/);
    assert.equal(expiredFreezeReason({ ...job, nextRunAt: future }, future, now), null);
    assert.match(lateClaimedFreezeReason(job, past, now) ?? "", /kickoff elapsed/);
    assert.match(lateClaimedFreezeReason(job, future, now) ?? "", /claim window/);
    assert.equal(lateClaimedFreezeReason({ ...job, nextRunAt: new Date(now.getTime() - 30_000) },
      future, now), null);
  }
});