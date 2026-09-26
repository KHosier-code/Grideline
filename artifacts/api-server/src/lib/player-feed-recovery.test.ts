import test from "node:test";
import assert from "node:assert/strict";
import {
  assertPlayerRecoveryConfiguration, attestPlayerRecoveryDatabase,
  RecoveryFeedLockedError, runAttestedPlayerRecovery,
} from "./player-feed-recovery";

const env = {
  NODE_ENV: "development",
  GRIDLINE_PLAYER_RECOVERY: "injuries,sleeper",
  GRIDLINE_PLAYER_RECOVERY_APPROVED: "1",
  GRIDLINE_PLAYER_RECOVERY_DATABASE: "heliumdb",
  GRIDLINE_PLAYER_RECOVERY_ROLE: "postgres",
  GRIDLINE_PLAYER_RECOVERY_SYSTEM_ID: "1234567890123456789",
  GRIDLINE_PLAYER_RECOVERY_DATABASE_OID: "16384",
  GRIDLINE_PLAYER_RECOVERY_SERVER_ADDRESS: "local",
};

test("recovery requires exact consent and independent database claims", () => {
  assert.deepEqual(assertPlayerRecoveryConfiguration(env).feeds, ["injuries", "sleeper"]);
  assert.deepEqual(assertPlayerRecoveryConfiguration({ ...env, GRIDLINE_PLAYER_RECOVERY: "injuries" }).feeds, ["injuries"]);
  for (const key of Object.keys(env)) {
    const incomplete = { ...env } as Record<string, string>;
    delete incomplete[key];
    assert.throws(() => assertPlayerRecoveryConfiguration(incomplete), key);
  }
  for (const change of [
    { GRIDLINE_PLAYER_RECOVERY: "weather" },
    { GRIDLINE_PLAYER_RECOVERY: "sleeper,injuries" },
    { GRIDLINE_PLAYER_RECOVERY_APPROVED: "true" },
    { GRIDLINE_NEW_WORKER_APPROVED: "1" },
    { GRIDLINE_SCHEDULER_WORKER: "1" },
    { GRIDLINE_WORKER_REHEARSAL: "1" },
    { GRIDLINE_REHEARSAL_NO_RETENTION: "1" },
    { REPLIT_DEPLOYMENT: "1" },
    { GRIDLINE_PLAYER_RECOVERY_TEST_BLOCK_NETWORK: "1" },
    { GRIDLINE_PLAYER_RECOVERY_DATABASE: "production" },
    { GRIDLINE_PLAYER_RECOVERY_SERVER_ADDRESS: "127.0.0.1" },
  ]) assert.throws(() => assertPlayerRecoveryConfiguration({ ...env, ...change }));
});

test("the connected server, role, database, oid and primary must match", async () => {
  const config = assertPlayerRecoveryConfiguration(env);
  const row = {
    database_name: "heliumdb", database_role: "postgres", replica: false,
    system_id: config.systemId, database_oid: config.databaseOid,
    server_address: null, marker: null,
  };
  await attestPlayerRecoveryDatabase(config, async () => ({ rows: [row] }));
  for (const key of ["database_name", "database_role", "replica", "system_id", "database_oid", "server_address"]) {
    await assert.rejects(attestPlayerRecoveryDatabase(config,
      async () => ({ rows: [{ ...row, [key]: "wrong" }] })), key);
  }
  await assert.rejects(attestPlayerRecoveryDatabase(config, async () => ({ rows: [] })));
});

test("receipt shows partial success, links only selected sync runs and excludes target identifiers", async () => {
  const config = assertPlayerRecoveryConfiguration(env);
  const called: string[] = [];
  const receipt = await runAttestedPlayerRecovery(config, async (feed, jobKey) => {
    called.push(`${feed}:${jobKey}`);
    if (feed === "sleeper") throw new Error("secret connection detail");
    return { inserted: 3 };
  });
  assert.equal(receipt.status, "partial_success");
  assert.deepEqual(receipt.approvedFeeds, ["injuries", "sleeper"]);
  assert.deepEqual(receipt.attempts, [
    { feed: "injuries", status: "success", inserted: 3 },
    { feed: "sleeper", status: "failed", reason: "sync_error" },
  ]);
  assert.match(receipt.syncRunJobKey, /^operator-player-recovery:[0-9a-f-]{36}$/);
  assert.equal(called.length, 2);
  assert(called.every((value) => value.endsWith(receipt.syncRunJobKey)));
  assert.equal(receipt.target, "attested_development_primary");
  const serialized = JSON.stringify(receipt);
  for (const value of [config.database, config.role, config.systemId, String(config.databaseOid),
    config.serverAddress, "secret connection detail"]) {
    assert(!serialized.includes(value), `receipt leaked ${value}`);
  }
});

test("receipt distinguishes a lock refusal from a sync failure and reports total failure", async () => {
  const receipt = await runAttestedPlayerRecovery(
    assertPlayerRecoveryConfiguration({ ...env, GRIDLINE_PLAYER_RECOVERY: "injuries" }),
    async () => { throw new RecoveryFeedLockedError("locked"); },
  );
  assert.equal(receipt.status, "failed");
  assert.deepEqual(receipt.attempts, [{ feed: "injuries", status: "failed", reason: "locked" }]);
});