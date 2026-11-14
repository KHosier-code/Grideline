import test from "node:test";
import assert from "node:assert/strict";
import { startWithDatabaseRetry } from "./production-startup";
import type { ProductionDatabaseEvidence } from "./production-database-smoke";

const evidence: ProductionDatabaseEvidence = { buildId: "b", checkedAt: new Date(0), selectOneResult: 1, verifyFullPassed: true };

function harness(results: Array<"ok" | "down" | "fatal">) {
  const log: string[] = [];
  let call = 0;
  return {
    log,
    options: {
      verify: async () => {
        const result = results[Math.min(call++, results.length - 1)];
        log.push(`verify:${result}`);
        if (result === "ok") return evidence;
        throw new Error(result);
      },
      startApi: () => { log.push("api"); },
      startWorker: () => { log.push("worker"); },
      isFatal: (error: unknown) => (error as Error).message === "fatal",
      onDegraded: (_error: unknown, attempt: number) => { log.push(`degraded:${attempt}`); },
      onRecovered: (_evidence: ProductionDatabaseEvidence, attempt: number) => { log.push(`recovered:${attempt}`); },
      wait: async () => {},
    },
  };
}

test("a healthy database starts the API, then the worker", async () => {
  const { log, options } = harness(["ok"]);
  const started = await startWithDatabaseRetry(options);
  assert.equal(started.mode, "healthy");
  assert.equal(await started.recovered, true);
  assert.deepEqual(log, ["verify:ok", "api", "worker"]);
});

test("a database outage still starts the API, and the worker waits for the database", async () => {
  const { log, options } = harness(["down", "down", "ok"]);
  let release!: () => void;
  const firstWait = new Promise<void>((resolve) => { release = resolve; });
  let waits = 0;
  const started = await startWithDatabaseRetry({ ...options, wait: () => (waits++ === 0 ? firstWait : Promise.resolve()) });
  assert.equal(started.mode, "degraded");
  assert.deepEqual(log, ["verify:down", "api", "degraded:1"]); // the site is up before the database is
  release();
  assert.equal(await started.recovered, true);
  assert.deepEqual(log, ["verify:down", "api", "degraded:1", "verify:down", "degraded:2", "verify:ok", "recovered:3", "worker"]);
});

test("a wrong setting or missing schema still stops startup", async () => {
  const { log, options } = harness(["fatal"]);
  await assert.rejects(startWithDatabaseRetry(options), /fatal/);
  assert.deepEqual(log, ["verify:fatal"]);
});

test("stopping the server ends the retries without starting the worker", async () => {
  const { log, options } = harness(["down"]);
  let stopping = false;
  const started = await startWithDatabaseRetry({ ...options, stopped: () => stopping, wait: async () => { stopping = true; } });
  assert.equal(await started.recovered, false);
  assert.ok(!log.includes("worker"));
});
