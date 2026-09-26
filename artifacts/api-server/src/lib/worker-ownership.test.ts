import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import test from "node:test";
import { pool } from "@workspace/db";
import {
  acquireGlobalWorkerOwnership,
  isNewWorkerApproved,
  startWorkerOnlyWhenApproved,
  type WorkerOwnershipClient,
  type WorkerOwnershipPool,
} from "./worker-ownership";

class AdvisoryLockServer {
  locked = false;
  failAcquire = false;
  disconnectCurrent: (() => void) | null = null;
  endCurrent: (() => void) | null = null;

  pool(): WorkerOwnershipPool {
    return {
      connect: async () => {
        const server = this;
        const events = new EventEmitter();
        server.disconnectCurrent = () => events.emit("error", new Error("session disconnected"));
        server.endCurrent = () => events.emit("end");
        let ownsLock = false;
        const client: WorkerOwnershipClient = {
          query: async (queryText) => {
            if (queryText.includes("pg_try_advisory_lock")) {
              if (server.failAcquire) throw new Error("database lock query failed");
              if (server.locked) return { rows: [{ locked: false }] };
              server.locked = true;
              ownsLock = true;
              return { rows: [{ locked: true }] };
            }
            if (queryText.includes("pg_advisory_unlock")) {
              if (ownsLock) server.locked = false;
              ownsLock = false;
              return { rows: [{ unlocked: true }] };
            }
            throw new Error("unexpected query");
          },
          release: (error) => {
            if (error && ownsLock) server.locked = false;
            ownsLock = false;
          },
          on: (event, listener) => events.on(event, listener),
          removeListener: (event, listener) => events.removeListener(event, listener),
        };
        return client;
      },
    };
  }
}

test("simultaneous new workers admit only one global lock owner", async () => {
  const server = new AdvisoryLockServer();
  const pool = server.pool();
  const outcomes = await Promise.allSettled([
    acquireGlobalWorkerOwnership(pool),
    acquireGlobalWorkerOwnership(pool),
  ]);
  const owners = outcomes.filter((result) => result.status === "fulfilled");
  const rejected = outcomes.filter((result) => result.status === "rejected");
  assert.equal(owners.length, 1);
  assert.equal(rejected.length, 1);
  assert.match(String((rejected[0] as PromiseRejectedResult).reason), /currently owns/);
  await (owners[0] as PromiseFulfilledResult<() => Promise<void>>).value();
  assert.equal(server.locked, false);
});

test("lock query failure fails closed and discards the checked-out client", async () => {
  const server = new AdvisoryLockServer();
  server.failAcquire = true;
  await assert.rejects(
    acquireGlobalWorkerOwnership(server.pool()),
    /database lock query failed/,
  );
  assert.equal(server.locked, false);
});

test("explicit release and lost session both permit failover", async () => {
  const server = new AdvisoryLockServer();
  const pool = server.pool();
  const release = await acquireGlobalWorkerOwnership(pool);
  await release();
  assert.equal(server.locked, false);

  const afterExplicitRelease = await acquireGlobalWorkerOwnership(pool);
  await afterExplicitRelease();

  // PostgreSQL drops a session advisory lock when its owning connection dies.
  let connectionLost = false;
  await acquireGlobalWorkerOwnership(pool, {
    onConnectionLost: () => { connectionLost = true; },
  });
  server.disconnectCurrent?.();
  assert.equal(connectionLost, true);
  assert.equal(server.locked, false);
  const nextOwner = await acquireGlobalWorkerOwnership(pool);
  await nextOwner();
  assert.equal(server.locked, false);

  let endReason = "";
  await acquireGlobalWorkerOwnership(pool, {
    onConnectionLost: (error) => { endReason = error.message; },
  });
  server.endCurrent?.();
  assert.match(endReason, /session ended/);
  const afterSessionEnd = await acquireGlobalWorkerOwnership(pool);
  await afterSessionEnd();
});

test("activation is exact-match and off leaves only an old uncooperative worker running", () => {
  const starts: string[] = [];
  // Simulates an already-deployed worker: it runs independently and does not
  // inspect or honor the new activation flag or advisory lock.
  starts.push("old worker");

  assert.equal(isNewWorkerApproved({}), false);
  assert.equal(isNewWorkerApproved({ GRIDLINE_NEW_WORKER_APPROVED: "true" }), false);
  assert.equal(
    startWorkerOnlyWhenApproved({}, () => starts.push("new worker")),
    false,
  );
  assert.deepEqual(starts, ["old worker"]);

  assert.equal(
    startWorkerOnlyWhenApproved(
      { GRIDLINE_NEW_WORKER_APPROVED: "1" },
      () => starts.push("new worker"),
    ),
    true,
  );
  assert.deepEqual(starts, ["old worker", "new worker"]);
});

test("two independent development database sessions transfer the worker lock", {
  skip: process.env.GRIDLINE_WORKER_LOCK_DEV_TEST !== "1",
}, async () => {
  if (process.env.NODE_ENV !== "development" || process.env.REPLIT_DEPLOYMENT) {
    throw new Error("Worker lock integration test is development-only");
  }
  const identity = await pool.query(`
    SELECT current_database() AS database_name, current_user AS database_role,
           pg_is_in_recovery() AS replica, inet_server_addr() IS NULL AS local_proxy
  `);
  const row = identity.rows[0];
  if (identity.rows.length !== 1 || row?.database_name !== "heliumdb"
    || row.database_role !== "postgres" || row.replica || !row.local_proxy) {
    throw new Error("Refusing worker lock test on an unverified development database");
  }
  try {
    const first = await acquireGlobalWorkerOwnership(pool);
    try {
      await assert.rejects(
        acquireGlobalWorkerOwnership(pool),
        /currently owns the global worker lock/,
      );
    } finally {
      await first();
    }
    const successor = await acquireGlobalWorkerOwnership(pool);
    await successor();

    let ownerBackendPid = 0;
    let lostSession = false;
    // Terminate only the verified development session that owns this lock.
    // This simulates a crashed worker without touching any application data.
    await acquireGlobalWorkerOwnership({
      connect: async () => {
        const client = await pool.connect();
        ownerBackendPid = Number((await client.query("SELECT pg_backend_pid() AS pid")).rows[0]?.pid);
        return client;
      },
    }, { onConnectionLost: () => { lostSession = true; } });
    const terminated = await pool.query(
      "SELECT pg_terminate_backend($1) AS terminated",
      [ownerBackendPid],
    );
    assert.equal(terminated.rows[0]?.terminated, true);
    for (let attempt = 0; !lostSession && attempt < 40; attempt++) {
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
    assert.equal(lostSession, true, "worker must detect an ended ownership session");
    const afterCrash = await acquireGlobalWorkerOwnership(pool);
    await afterCrash();
  } finally {
    await pool.end();
  }
});