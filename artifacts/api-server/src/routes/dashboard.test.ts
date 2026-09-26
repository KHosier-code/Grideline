import assert from "node:assert/strict";
import test, { after, before } from "node:test";
import { db, pool, usageAnalyticsRetentionTable } from "@workspace/db";
import { eq, sql } from "drizzle-orm";
import dashboardRouter, { createDataHealthHandler } from "./dashboard";
import { PREGAME_FEATURE_DEFINITION } from "../lib/features";
import { requireAdmin } from "../middlewares/admin";
import {
  executeCancellableDatabaseQuery,
  getDatabasePoolCapacity,
} from "../lib/db";

// node:test runs files in parallel, but the retention health fixture replaces
// a database singleton. Hold the same session lock as the worker tests for
// this file so those writes and reads cannot overlap.
const RETENTION_TEST_LOCK = "usage-analytics-retention-test-state";
type RetentionTestLock = {
  query: (queryText: string, values?: unknown[]) => Promise<unknown>;
  release: () => void;
};
let retentionTestLock: RetentionTestLock | null = null;

before(async () => {
  retentionTestLock = await pool.connect();
  await retentionTestLock.query("SELECT pg_advisory_lock(hashtext($1))", [
    RETENTION_TEST_LOCK,
  ]);
});

type RouteLayer = {
  route?: {
    path: string;
    stack: Array<{ handle: unknown }>;
  };
};

type DataHealthHandler = (
  req: Record<string, unknown>,
  res: { json: (body: unknown) => unknown },
) => Promise<void>;

const dataHealthRoute = (
  dashboardRouter as unknown as { stack: RouteLayer[] }
).stack.find((layer) => layer.route?.path === "/data-health")?.route;

assert.ok(dataHealthRoute, "the data-health route should be registered");
assert.equal(
  dataHealthRoute.stack[0]?.handle,
  requireAdmin,
  "the data-health route must remain protected by requireAdmin",
);

const protectedDataHealthHandler = dataHealthRoute.stack.at(-1)?.handle as
  DataHealthHandler | undefined;
assert.ok(
  protectedDataHealthHandler,
  "the data-health route should have a response handler",
);

const now = new Date();

const dataHealthDependencies = {
  getEspnHealth: () => ({
    lastSuccessfulRequest: null,
    requestsToday: 0,
    requestsThisMonth: 0,
  }),
  getScheduleHealth: async () => ({
    records: 0,
    unfinished: 0,
    lastUpdated: null,
    latestRun: null,
    runs: [],
  }),
  getNflverseHealth: async () => ({
    status: "stale",
    detail: "Historical sync has not completed.",
    lastUpdated: null,
    requestsToday: 0,
    requestsThisMonth: 0,
    remainingQuota: "Test fixture",
    metadata: {
      seasonsLoaded: 0,
      gamesLoaded: 0,
      teamGameRows: 0,
      playerGameRows: 0,
      snapCountRows: 0,
      historicalDepthRows: 0,
      failures: [],
    },
  }),
  getAvailabilityHealth: async () => ({
    injury: {
      records: 0,
      lastUpdated: null,
      failure: null,
      failureAt: null,
    },
    depth: {
      records: 0,
      teams: 0,
      lastUpdated: null,
      failures: [],
    },
    runs: [],
  }),
  getSleeperHealth: async () => ({
    status: "unavailable",
    lastUpdated: null,
    staleAgeMs: null,
    snapshotCount: 0,
    lastCapturedAt: null,
    playerCount: 0,
    teamCount: 0,
    depthOrderCount: 0,
    lastAttempted: new Date(0).toISOString(),
    latestFailure: null,
    recentFailureCount: 0,
    latestMetadata: {},
    cadenceHours: 24,
  }),
  getSleeperIdentityHealth: async () => ({
    status: "unavailable",
    mappingVersion: null,
    latestAttemptMappingVersion: null,
    mappingRunId: null,
    sourceSnapshotId: null,
    lastUpdated: null,
    lastAttempted: null,
    staleAgeMs: null,
    latestFailure: null,
    recentFailureCount: 0,
    durationMs: null,
    metadata: {},
  }),
  getRecentScheduledRuns: async () => [],
  getOddsApiHealth: async () => ({
    status: "not_configured",
    detail: "Test fixture",
    lastUpdated: null,
    requestsToday: 0,
    requestsThisMonth: 0,
    remainingQuota: null,
    metadata: {},
  }),
  getSchedulerHealth: async () => ({
    status: "healthy",
    checkedAt: now.toISOString(),
    alerts: [],
    activeInThisProcess: false,
    processRole: "api",
    persistentWorkerExpected: true,
    processStartedAt: null,
    timezone: "UTC",
    alwaysOnServiceRequired: true,
    note: "Test fixture",
    jobs: [],
    runs: [],
  }),
  getPregameFeatureHealth: async () => ({
    featureVersion: "test",
    definition: PREGAME_FEATURE_DEFINITION,
    rows: 0,
    games: 0,
    lowSampleRows: 0,
    latestGeneratedAt: null,
  }),
  getModelArtifactImmutabilityStatus: async () => ({
    status: "application_only",
    mechanism: "application_append_only",
    applicationUpdateDeleteBlocked: true,
    productionFittingBlocked: true,
    databaseTriggerActive: false,
    databaseTriggerSupport: "unavailable_through_current_publish_path",
    verification: "test fixture",
    note: "Test fixture",
  }),
  getPlayerRecoveryReceiptCleanupHealth: async () => ({
    retentionDays: 90,
    cleanupIntervalHours: 24,
    status: "pending",
    cleanupState: "pending",
    lastAttemptAt: null,
    lastAttemptStatus: null,
    nextCleanupAt: null,
    consecutiveFailures: 0,
    firstFailureAt: null,
    lastSuccessfulAt: null,
    lastSuccessfulDeletedReceipts: null,
    alert: null,
    workerOwned: true,
  }),
  getFeedGameDays: async () => new Set<string>(),
  weatherHealth: async () => ({
    source: "Test fixture",
    cost: "Test fixture",
    userAgentConfigured: false,
    lastRun: null,
  }),
} as Parameters<typeof createDataHealthHandler>[0];

const dataHealthHandler = createDataHealthHandler(
  dataHealthDependencies,
) as unknown as DataHealthHandler;

type RetentionRow = typeof usageAnalyticsRetentionTable.$inferSelect;

async function readRetentionRow(): Promise<RetentionRow | null> {
  const [row] = await db
    .select()
    .from(usageAnalyticsRetentionTable)
    .where(eq(usageAnalyticsRetentionTable.id, 1))
    .limit(1);
  return row ?? null;
}

async function replaceRetentionRow(row: RetentionRow | null): Promise<void> {
  await db.delete(usageAnalyticsRetentionTable);
  if (row) {
    await db.insert(usageAnalyticsRetentionTable).values(row);
  }
}

async function readDataHealth(
  handler: DataHealthHandler = dataHealthHandler,
): Promise<unknown[]> {
  let responseBody: unknown;
  await handler(
    {},
    {
      json(body) {
        responseBody = body;
        return body;
      },
    },
  );
  assert.ok(
    responseBody,
    "the data-health route should return a response body",
  );
  assert.ok(
    Array.isArray(responseBody),
    "the data-health response should be a provider list",
  );
  return responseBody;
}

function providerByName(body: unknown[], name: string) {
  const provider = body.find(
    (item): item is Record<string, any> =>
      typeof item === "object" &&
      item !== null &&
      (item as Record<string, unknown>).provider === name,
  );
  assert.ok(provider, `the data-health response should include ${name}`);
  return provider;
}

test("old successful schedule and weather attempts are stale, not current", async () => {
  const old = new Date(Date.now() - 9 * 60 * 60 * 1000).toISOString();
  const handler = createDataHealthHandler({
    ...dataHealthDependencies,
    getScheduleHealth: async () => ({
      records: 12, unfinished: 12, lastUpdated: old,
      latestRun: { id: 1, status: "success", startedAt: old, completedAt: old, recordsProcessed: 12, errorMessage: null },
      runs: [],
    }),
    weatherHealth: async () => ({
      source: "National Weather Service", cost: "Free", userAgentConfigured: true,
      lastRun: { status: "success", startedAt: old, completedAt: old, error: null },
    }),
  }) as unknown as DataHealthHandler;
  const body = await readDataHealth(handler);
  assert.equal(providerByName(body, "espn").status, "stale");
  assert.match(providerByName(body, "espn").detail, /older than 60 minutes/);
  assert.equal(providerByName(body, "nws-weather").status, "stale");
  assert.match(providerByName(body, "nws-weather").detail, /six-hour/);
});

test("recent successful schedule and weather attempts stay current", async () => {
  const recent = new Date(Date.now() - 20 * 60 * 1000).toISOString();
  const handler = createDataHealthHandler({
    ...dataHealthDependencies,
    getScheduleHealth: async () => ({
      records: 12, unfinished: 12, lastUpdated: recent,
      latestRun: { id: 1, status: "success", startedAt: recent, completedAt: recent, recordsProcessed: 12, errorMessage: null },
      runs: [],
    }),
    weatherHealth: async () => ({
      source: "National Weather Service", cost: "Free", userAgentConfigured: true,
      lastRun: { status: "success", startedAt: recent, completedAt: recent, error: null },
    }),
  }) as unknown as DataHealthHandler;
  const body = await readDataHealth(handler);
  assert.equal(providerByName(body, "espn").status, "current");
  assert.equal(providerByName(body, "nws-weather").status, "current");
});

test("player receipt cleanup alert appears only on protected data-health and contains no raw errors", async () => {
  const route = (dashboardRouter as unknown as { stack: RouteLayer[] }).stack
    .find((layer) => layer.route?.path === "/data-health")?.route;
  assert.equal(route?.stack[0]?.handle, requireAdmin);
  const handler = createDataHealthHandler({
    ...dataHealthDependencies,
    getPlayerRecoveryReceiptCleanupHealth: async () => ({
      retentionDays: 90,
      cleanupIntervalHours: 24,
      status: "failed" as const,
      cleanupState: "on_time" as const,
      lastAttemptAt: new Date(),
      lastAttemptStatus: "failed" as const,
      nextCleanupAt: new Date(Date.now() + 86_400_000),
      consecutiveFailures: 3,
      firstFailureAt: new Date(),
      lastSuccessfulAt: null,
      lastSuccessfulDeletedReceipts: null,
      alert: {
        code: "repeated_failures" as const,
        severity: "critical" as const,
        scope: "player-recovery-receipt-cleanup" as const,
        title: "Player refresh receipt cleanup repeatedly failing" as const,
        detail: "Receipt cleanup has failed 3 consecutive times. Expired receipts may remain beyond the 90-day retention period.",
      },
      workerOwned: true as const,
    }),
  });
  const card = providerByName(await readDataHealth(handler as unknown as DataHealthHandler), "player-recovery-receipt-cleanup");
  assert.equal(card.status, "unavailable");
  assert.match(card.detail, /3 consecutive times/);
  assert.equal(card.metadata.alert.severity, "critical");
  assert(!JSON.stringify(card).includes("database identity"));
});

test("protected data-health returns a bounded unavailable result when a provider hangs", async () => {
  const handler = createDataHealthHandler(
    {
      ...dataHealthDependencies,
      getOddsApiHealth: async () => new Promise<never>(() => {}),
    },
    { timeoutMs: 25 },
  ) as unknown as DataHealthHandler;
  const startedAt = Date.now();
  const body = await readDataHealth(handler);
  const elapsedMs = Date.now() - startedAt;
  const odds = body.find(
    (item): item is Record<string, any> =>
      typeof item === "object" &&
      item !== null &&
      (item as Record<string, unknown>).provider === "odds-api",
  );

  assert.ok(elapsedMs < 500, `the bounded health check took ${elapsedMs}ms`);
  assert.ok(odds, "the data-health response should include Odds API");
  assert.equal(odds.status, "unavailable");
  assert.match(odds.detail, /did not complete within the admin route budget/);
});

test("database pool capacity telemetry is safe when metrics are unavailable", () => {
  const capacity = getDatabasePoolCapacity({});
  assert.deepEqual(
    capacity,
    {
      metricsAvailable: false,
      capacityStatus: "unknown",
      max: null,
      total: null,
      idle: null,
      waiting: null,
      active: null,
      cancelledQueries: capacity.cancelledQueries,
    },
  );
  assert.equal(typeof capacity.cancelledQueries, "number");
});

test("database pool capacity telemetry identifies queued work as degraded", () => {
  const capacity = getDatabasePoolCapacity({
    options: { max: 4 },
    totalCount: 4,
    idleCount: 0,
    waitingCount: 2,
  });

  assert.equal(capacity.metricsAvailable, true);
  assert.equal(capacity.capacityStatus, "degraded");
  assert.equal(capacity.active, 4);
});

test("data-health includes a separate database capacity record", async () => {
  const body = await readDataHealth();
  const capacity = providerByName(body, "database-capacity");

  assert.equal(capacity.label, "Database capacity");
  assert.ok(["current", "stale", "unavailable"].includes(capacity.status));
  assert.equal(typeof capacity.metadata.metricsAvailable, "boolean");
  assert.ok(Array.isArray(capacity.metadata.affectedHealthChecks));
});

test("completed database health work is not cancelled after the response finishes", async () => {
  const timeoutMs = 137;
  let databaseWorkCompleted = false;
  let routeTimer: ReturnType<typeof setTimeout> | undefined;
  let routeTimerCleared = false;
  const originalSetTimeout = globalThis.setTimeout;
  const originalClearTimeout = globalThis.clearTimeout;
  const scheduleHealth = dataHealthDependencies?.getScheduleHealth;
  assert.ok(scheduleHealth);

  globalThis.setTimeout = ((...args: Parameters<typeof setTimeout>) => {
    const timer = originalSetTimeout(...args);
    if (args[1] === timeoutMs && !routeTimer) {
      routeTimer = timer;
    }
    return timer;
  }) as typeof setTimeout;
  globalThis.clearTimeout = ((...args: Parameters<typeof clearTimeout>) => {
    if (args[0] === routeTimer) {
      routeTimerCleared = true;
    }
    return originalClearTimeout(...args);
  }) as typeof clearTimeout;

  try {
    const handler = createDataHealthHandler(
      {
        ...dataHealthDependencies,
        getScheduleHealth: async () => {
          await db.execute(sql`SELECT 1`);
          databaseWorkCompleted = true;
          return scheduleHealth();
        },
      },
      { timeoutMs },
    ) as unknown as DataHealthHandler;

    await readDataHealth(handler);
  } finally {
    globalThis.setTimeout = originalSetTimeout;
    globalThis.clearTimeout = originalClearTimeout;
  }

  assert.equal(databaseWorkCompleted, true);
  assert.equal(routeTimerCleared, true);
});

test("data-health clears its deadline timer when response validation fails after database work", async () => {
  const timeoutMs = 149;
  let databaseWorkCompleted = false;
  let routeTimer: ReturnType<typeof setTimeout> | undefined;
  let routeTimerCleared = false;
  const originalSetTimeout = globalThis.setTimeout;
  const originalClearTimeout = globalThis.clearTimeout;
  const scheduleHealth = dataHealthDependencies?.getScheduleHealth;
  assert.ok(scheduleHealth);

  globalThis.setTimeout = ((...args: Parameters<typeof setTimeout>) => {
    const timer = originalSetTimeout(...args);
    if (args[1] === timeoutMs && !routeTimer) {
      routeTimer = timer;
    }
    return timer;
  }) as typeof setTimeout;
  globalThis.clearTimeout = ((...args: Parameters<typeof clearTimeout>) => {
    if (args[0] === routeTimer) {
      routeTimerCleared = true;
    }
    return originalClearTimeout(...args);
  }) as typeof clearTimeout;

  try {
    const handler = createDataHealthHandler(
      {
        ...dataHealthDependencies,
        getEspnHealth: () => ({
          lastSuccessfulRequest: null,
          requestsToday: Number.NaN,
          requestsThisMonth: 0,
        }),
        getScheduleHealth: async () => {
          await db.execute(sql`SELECT 1`);
          databaseWorkCompleted = true;
          return scheduleHealth();
        },
      },
      { timeoutMs },
    ) as unknown as DataHealthHandler;

    await assert.rejects(
      readDataHealth(handler),
      (error: unknown) => {
        assert.ok(error instanceof Error);
        return true;
      },
    );
  } finally {
    globalThis.setTimeout = originalSetTimeout;
    globalThis.clearTimeout = originalClearTimeout;
  }

  assert.equal(databaseWorkCompleted, true);
  assert.equal(routeTimerCleared, true);
});

test("data-health clears its deadline timer when response serialization fails after health checks", async () => {
  const timeoutMs = 163;
  let databaseWorkCompleted = false;
  let routeTimer: ReturnType<typeof setTimeout> | undefined;
  let routeTimerCleared = false;
  const originalSetTimeout = globalThis.setTimeout;
  const originalClearTimeout = globalThis.clearTimeout;
  const scheduleHealth = dataHealthDependencies?.getScheduleHealth;
  assert.ok(scheduleHealth);

  globalThis.setTimeout = ((...args: Parameters<typeof setTimeout>) => {
    const timer = originalSetTimeout(...args);
    if (args[1] === timeoutMs && !routeTimer) {
      routeTimer = timer;
    }
    return timer;
  }) as typeof setTimeout;
  globalThis.clearTimeout = ((...args: Parameters<typeof clearTimeout>) => {
    if (args[0] === routeTimer) {
      routeTimerCleared = true;
    }
    return originalClearTimeout(...args);
  }) as typeof clearTimeout;

  try {
    const handler = createDataHealthHandler(
      {
        ...dataHealthDependencies,
        getScheduleHealth: async () => {
          await db.execute(sql`SELECT 1`);
          databaseWorkCompleted = true;
          return scheduleHealth();
        },
      },
      { timeoutMs },
    ) as unknown as DataHealthHandler;

    const responseError = new Error("response serialization failed");
    await assert.rejects(
      handler(
        {},
        {
          json() {
            throw responseError;
          },
        },
      ),
      responseError,
    );
  } finally {
    globalThis.setTimeout = originalSetTimeout;
    globalThis.clearTimeout = originalClearTimeout;
  }

  assert.equal(databaseWorkCompleted, true);
  assert.equal(routeTimerCleared, true);
});

test("timed-out database health work cancels and releases its client without a live provider", async () => {
  const controller = new AbortController();
  const queryToken = {};
  let cancellationCount = 0;
  let releaseCount = 0;
  let releaseError: Error | undefined;

  const fakeClient = {
    _getActiveQuery: () => queryToken,
    query(
      _queryOrConfig: unknown,
      _values: unknown[] | undefined,
      _callback: (error: unknown, result?: unknown) => void,
    ) {
      return undefined;
    },
    cancel(_client: unknown, query: unknown) {
      assert.equal(query, queryToken);
      cancellationCount += 1;
    },
    release(error?: Error) {
      releaseCount += 1;
      releaseError = error;
    },
  };
  const fakePool = {
    connect: async () => fakeClient,
  };

  const query = executeCancellableDatabaseQuery(
    fakePool,
    { text: "select pg_sleep($1)" },
    [60_000],
    controller.signal,
  );
  const timeout = setTimeout(() => controller.abort(), 5);

  await assert.rejects(query, (error: unknown) => {
    assert.ok(error instanceof Error);
    assert.equal(error.name, "AbortError");
    return true;
  });
  clearTimeout(timeout);

  assert.equal(cancellationCount, 1);
  assert.equal(releaseCount, 1);
  assert.equal(releaseError?.name, "AbortError");
});

test("a timed-out PostgreSQL health query is cancelled, discarded, and followed by a usable connection", async () => {
  const client = await pool.connect();
  const cancellableClient = client as typeof client & {
    cancel: (client: unknown, query: unknown) => void;
  };
  const originalRelease = cancellableClient.release.bind(cancellableClient);
  const originalCancel = cancellableClient.cancel.bind(cancellableClient);
  let releaseError: Error | undefined;
  let cancellationCount = 0;

  cancellableClient.release = (error?: Error) => {
    releaseError = error;
    originalRelease(error);
  };
  cancellableClient.cancel = (...args: Parameters<typeof cancellableClient.cancel>) => {
    cancellationCount += 1;
    return originalCancel(...args);
  };

  const controller = new AbortController();
  const query = executeCancellableDatabaseQuery(
    { connect: async () => client },
    { text: "SELECT pg_sleep($1)" },
    [60_000],
    controller.signal,
  );
  const timeout = setTimeout(() => controller.abort(), 25);

  try {
    await assert.rejects(query, (error: unknown) => {
      assert.ok(error instanceof Error);
      assert.equal(error.name, "AbortError");
      return true;
    });
  } finally {
    clearTimeout(timeout);
  }

  assert.equal(
    cancellationCount,
    1,
    "the live PostgreSQL client should receive a cancellation request",
  );
  assert.equal(
    releaseError?.name,
    "AbortError",
    "the active client should be discarded instead of returned to the pool",
  );

  const result = await pool.query("SELECT 1 AS connection_check");
  assert.deepEqual(result.rows, [{ connection_check: 1 }]);
});

test("repeatedly timed-out database health checks cancel and release every client exactly once", async () => {
  const checkCount = 8;
  let queriesStarted = 0;
  let resolveQueriesStarted: (() => void) | undefined;
  const allQueriesStarted = new Promise<void>((resolve) => {
    resolveQueriesStarted = resolve;
  });
  const checks: Array<{
    queryToken: object;
    callback?: (error: unknown, result?: unknown) => void;
    cancellationCount: number;
    releaseCount: number;
    releaseError?: Error;
  }> = [];

  const fakePool = {
    connect: async () => {
      const check = {
        queryToken: {},
        callback: undefined as
          | ((error: unknown, result?: unknown) => void)
          | undefined,
        cancellationCount: 0,
        releaseCount: 0,
        releaseError: undefined as Error | undefined,
      };
      checks.push(check);

      return {
        _getActiveQuery: () => check.queryToken,
        query(
          _queryOrConfig: unknown,
          _values: unknown[] | undefined,
          callback: (error: unknown, result?: unknown) => void,
        ) {
          check.callback = callback;
          queriesStarted += 1;
          if (queriesStarted === checkCount) {
            resolveQueriesStarted?.();
          }
          return check.queryToken;
        },
        cancel(_client: unknown, query: unknown) {
          assert.equal(query, check.queryToken);
          check.cancellationCount += 1;
        },
        release(error?: Error) {
          check.releaseCount += 1;
          check.releaseError = error;
        },
      };
    },
  };

  const queries = Array.from({ length: checkCount }, () => {
    const controller = new AbortController();
    return {
      controller,
      query: executeCancellableDatabaseQuery(
        fakePool,
        { text: "select pg_sleep($1)" },
        [60_000],
        controller.signal,
      ),
    };
  });

  await allQueriesStarted;
  for (const { controller } of queries) {
    controller.abort();
  }

  const results = await Promise.allSettled(queries.map(({ query }) => query));
  assert.equal(results.length, checkCount);
  for (const result of results) {
    assert.equal(result.status, "rejected");
    if (result.status === "rejected") {
      assert.ok(result.reason instanceof Error);
      assert.equal(result.reason.name, "AbortError");
    }
  }

  assert.equal(checks.length, checkCount);
  for (const check of checks) {
    assert.equal(check.cancellationCount, 1);
    assert.equal(check.releaseCount, 1);
    assert.equal(check.releaseError?.name, "AbortError");
  }

  // A database driver can report the cancelled query after the route has
  // already returned its unavailable response. It must not release again or
  // surface a second rejection.
  for (const check of checks) {
    check.callback?.(new Error("late database callback"));
    check.callback?.(undefined, { rows: [] });
  }
  await new Promise<void>((resolve) => setImmediate(resolve));

  for (const check of checks) {
    assert.equal(check.cancellationCount, 1);
    assert.equal(check.releaseCount, 1);
  }
});

/*
test("timed-out database health waiters release a late client without dispatching a query", async () => {
  const timeoutMs = 163;
  let databaseWorkCompleted = false;
  let routeTimer: ReturnType<typeof setTimeout> | undefined;
  let routeTimerCleared = false;
  const originalSetTimeout = globalThis.setTimeout;
  const originalClearTimeout = globalThis.clearTimeout;
  const scheduleHealth = dataHealthDependencies?.getScheduleHealth;
  assert.ok(scheduleHealth);

  globalThis.setTimeout = ((...args: Parameters<typeof setTimeout>) => {
    const timer = originalSetTimeout(...args);
    if (args[1] === timeoutMs && !routeTimer) {
      routeTimer = timer;
    }
    return timer;
  }) as typeof setTimeout;
  globalThis.clearTimeout = ((...args: Parameters<typeof clearTimeout>) => {
    if (args[0] === routeTimer) {
      routeTimerCleared = true;
    }
    return originalClearTimeout(...args);
  }) as typeof clearTimeout;

  try {
  const handler = createDataHealthHandler({
    ...dataHealthDependencies,
    getScheduleHealth: async () => {
      throw new Error("schedule database unavailable");
    },
    getNflverseHealth: async () => ({
      status: "current",
      detail: "Historical data is ready.",
      lastUpdated: now.toISOString(),
      requestsToday: 0,
      requestsThisMonth: 0,
      remainingQuota: "Test fixture",
      metadata: {
        seasonsLoaded: 2,
        gamesLoaded: 10,
        teamGameRows: 20,
        playerGameRows: 30,
        snapCountRows: 40,
        historicalDepthRows: 50,
        failures: [],
      },
    }),
    getUsageAnalyticsRetentionHealth: async () => ({
      retentionDays: 30,
      cleanupIntervalHours: 24,
      nextCleanupAt: new Date(now.getTime() + 60 * 60 * 1000),
      cleanupState: "on_time",
      status: "healthy",
      lastAttemptAt: now,
      lastAttemptStatus: "success",
      consecutiveFailures: 0,
      firstFailureAt: null,
      lastSuccessfulAt: now,
      lastSuccessfulDeletedEvents: 0,
      lastSuccessfulBatches: 0,
      lastSuccessfulCutoff: new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000),
      latestError: null,
      latestErrorAt: null,
      alert: null,
      workerOwned: true,
    }),
  }) as unknown as DataHealthHandler;

    const responseError = new Error("response serialization failed");

    await assert.rejects(
      readDataHealth(handler),
      (error: unknown) => {
        assert.ok(error instanceof Error);
        return true;
      },
    );
  } finally {
    globalThis.setTimeout = originalSetTimeout;
    globalThis.clearTimeout = originalClearTimeout;
  }

  assert.equal(databaseWorkCompleted, true);
  assert.equal(routeTimerCleared, true);
});

test("data-health clears its deadline timer when response serialization fails after health checks", async () => {
  const timeoutMs = 163;
  let databaseWorkCompleted = false;
  let routeTimer: ReturnType<typeof setTimeout> | undefined;
  let routeTimerCleared = false;
  const originalSetTimeout = globalThis.setTimeout;
  const originalClearTimeout = globalThis.clearTimeout;
  const scheduleHealth = dataHealthDependencies?.getScheduleHealth;
  assert.ok(scheduleHealth);

  globalThis.setTimeout = ((...args: Parameters<typeof setTimeout>) => {
    const timer = originalSetTimeout(...args);
    if (args[1] === timeoutMs && !routeTimer) {
      routeTimer = timer;
    }
    return timer;
  }) as typeof setTimeout;
  globalThis.clearTimeout = ((...args: Parameters<typeof clearTimeout>) => {
    if (args[0] === routeTimer) {
      routeTimerCleared = true;
    }
    return originalClearTimeout(...args);
  }) as typeof clearTimeout;

  try {
  const handler = createDataHealthHandler({
    ...dataHealthDependencies,
    getScheduleHealth: async () => {
      throw new Error("schedule database unavailable");
    },
    getNflverseHealth: async () => ({
      status: "current",
      detail: "Historical data is ready.",
      lastUpdated: now.toISOString(),
      requestsToday: 0,
      requestsThisMonth: 0,
      remainingQuota: "Test fixture",
      metadata: {
        seasonsLoaded: 2,
        gamesLoaded: 10,
        teamGameRows: 20,
        playerGameRows: 30,
        snapCountRows: 40,
        historicalDepthRows: 50,
        failures: [],
      },
    }),
    getUsageAnalyticsRetentionHealth: async () => ({
      retentionDays: 30,
      cleanupIntervalHours: 24,
      nextCleanupAt: new Date(now.getTime() + 60 * 60 * 1000),
      cleanupState: "on_time",
      status: "healthy",
      lastAttemptAt: now,
      lastAttemptStatus: "success",
      consecutiveFailures: 0,
      firstFailureAt: null,
      lastSuccessfulAt: now,
      lastSuccessfulDeletedEvents: 0,
      lastSuccessfulBatches: 0,
      lastSuccessfulCutoff: new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000),
      latestError: null,
      latestErrorAt: null,
      alert: null,
      workerOwned: true,
    }),
  }) as unknown as DataHealthHandler;

    const responseError = new Error("response serialization failed");
  const controller = new AbortController();
  const queryToken = {};
  let cancellationCount = 0;
  let releaseCount = 0;
  let releaseError: Error | undefined;

  const fakeClient = {
    _getActiveQuery: () => queryToken,
    query(
      _queryOrConfig: unknown,
      _values: unknown[] | undefined,
      _callback: (error: unknown, result?: unknown) => void,
    ) {
      return undefined;
    },
    cancel(_client: unknown, query: unknown) {
      assert.equal(query, queryToken);
      cancellationCount += 1;
    },
    release(error?: Error) {
      releaseCount += 1;
      releaseError = error;
    },
  };
  const fakePool = {
    connect: () =>
      new Promise<typeof lateClient>((resolve) => {
        resolveClient = resolve;
      }),
  };

  const query = executeCancellableDatabaseQuery(
    fakePool,
    "select 1",
    undefined,
    controller.signal,
  );
  const timeout = setTimeout(() => controller.abort(), 25);

  await assert.rejects(query, (error: unknown) => {
    assert.ok(error instanceof Error);
    assert.equal(error.name, "AbortError");
    return true;
  });
  clearTimeout(timeout);

  assert.equal(cancellationCount, 1);
  assert.equal(releaseCount, 1);
  assert.equal(releaseError?.name, "AbortError");
});

test("a timed-out PostgreSQL health query is cancelled, discarded, and followed by a usable connection", async () => {
  const client = await pool.connect();
  const cancellableClient = client as typeof client & {
    cancel: (client: unknown, query: unknown) => void;
  };
  const originalRelease = cancellableClient.release.bind(cancellableClient);
  const originalCancel = cancellableClient.cancel.bind(cancellableClient);
  let releaseError: Error | undefined;
  let cancellationCount = 0;

  cancellableClient.release = (error?: Error) => {
    releaseError = error;
    originalRelease(error);
  };
  cancellableClient.cancel = (...args: Parameters<typeof cancellableClient.cancel>) => {
    cancellationCount += 1;
    return originalCancel(...args);
  };

  const controller = new AbortController();
  const query = executeCancellableDatabaseQuery(
    fakePool,
    "select 1",
    undefined,
    controller.signal,
  );
  const timeout = setTimeout(() => controller.abort(), 25);

  try {
    await assert.rejects(query, (error: unknown) => {
      assert.ok(error instanceof Error);
      assert.equal(error.name, "AbortError");
      return true;
    });
  } finally {
    clearTimeout(timeout);
  }

  assert.equal(
    cancellationCount,
    1,
    "the live PostgreSQL client should receive a cancellation request",
  );
  assert.equal(
    releaseError?.name,
    "AbortError",
    "the active client should be discarded instead of returned to the pool",
  );

  const result = await pool.query("SELECT 1 AS connection_check");
  assert.deepEqual(result.rows, [{ connection_check: 1 }]);
});

test("repeatedly timed-out database health checks cancel and release every client exactly once", async () => {
  const checkCount = 8;
  let queriesStarted = 0;
  let resolveQueriesStarted: (() => void) | undefined;
  const allQueriesStarted = new Promise<void>((resolve) => {
    resolveQueriesStarted = resolve;
  });
  const checks: Array<{
    queryToken: object;
    callback?: (error: unknown, result?: unknown) => void;
    cancellationCount: number;
    releaseCount: number;
    releaseError?: Error;
  }> = [];

  const fakePool = {
    connect: () =>
      new Promise<typeof lateClient>((resolve) => {
        resolveClient = resolve;
      }),
  };

  const queries = Array.from({ length: checkCount }, () => {
    const controller = new AbortController();
    return {
      controller,
      query: executeCancellableDatabaseQuery(
        fakePool,
        { text: "select pg_sleep($1)" },
        [60_000],
        controller.signal,
      ),
    };
  });

  await allQueriesStarted;
  for (const { controller } of queries) {
    controller.abort();
  }

  const results = await Promise.allSettled(queries.map(({ query }) => query));
  assert.equal(results.length, checkCount);
  for (const result of results) {
    assert.equal(result.status, "rejected");
    if (result.status === "rejected") {
      assert.ok(result.reason instanceof Error);
      assert.equal(result.reason.name, "AbortError");
    }
  }

  assert.equal(checks.length, checkCount);
  for (const check of checks) {
    assert.equal(check.cancellationCount, 1);
    assert.equal(check.releaseCount, 1);
    assert.equal(check.releaseError?.name, "AbortError");
  }

  // A database driver can report the cancelled query after the route has
  // already returned its unavailable response. It must not release again or
  // surface a second rejection.
  for (const check of checks) {
    check.callback?.(new Error("late database callback"));
    check.callback?.(undefined, { rows: [] });
  }
  await new Promise<void>((resolve) => setImmediate(resolve));

  for (const check of checks) {
    assert.equal(check.cancellationCount, 1);
    assert.equal(check.releaseCount, 1);
  }
});
*/

test("timed-out database health waiters release a late client without dispatching a query", async () => {
  const controller = new AbortController();
  let queryCount = 0;
  let releaseCount = 0;
  let releaseError: Error | undefined;
  const lateClient = {
    query() {
      queryCount += 1;
    },
    release(error?: Error) {
      releaseCount += 1;
      releaseError = error;
    },
  };
  let resolveClient!: (client: typeof lateClient) => void;
  const fakePool = {
    connect: () =>
      new Promise<typeof lateClient>((resolve) => {
        resolveClient = resolve;
      }),
  };

  const query = executeCancellableDatabaseQuery(
    fakePool,
    "select 1",
    undefined,
    controller.signal,
  );
  controller.abort();

  await assert.rejects(query, (error: unknown) => {
    assert.ok(error instanceof Error);
    assert.equal(error.name, "AbortError");
    return true;
  });

  resolveClient(lateClient);
  await new Promise<void>((resolve) => setImmediate(resolve));

  assert.equal(queryCount, 0);
  assert.equal(releaseCount, 1);
  assert.equal(releaseError?.name, "AbortError");
});

test("protected data-health isolates a failed provider and keeps mixed provider states visible", async () => {
  const handler = createDataHealthHandler({
    ...dataHealthDependencies,
    getScheduleHealth: async () => {
      throw new Error("schedule database unavailable");
    },
    getNflverseHealth: async () => ({
      status: "current",
      detail: "Historical data is ready.",
      lastUpdated: now.toISOString(),
      requestsToday: 0,
      requestsThisMonth: 0,
      remainingQuota: "Test fixture",
      metadata: {
        seasonsLoaded: 2,
        gamesLoaded: 10,
        teamGameRows: 20,
        playerGameRows: 30,
        snapCountRows: 40,
        historicalDepthRows: 50,
        failures: [],
      },
    }),
    getUsageAnalyticsRetentionHealth: async () => ({
      retentionDays: 30,
      cleanupIntervalHours: 24,
      nextCleanupAt: new Date(now.getTime() + 60 * 60 * 1000),
      cleanupState: "on_time",
      status: "healthy",
      lastAttemptAt: now,
      lastAttemptStatus: "success",
      consecutiveFailures: 0,
      firstFailureAt: null,
      lastSuccessfulAt: now,
      lastSuccessfulDeletedEvents: 0,
      lastSuccessfulBatches: 0,
      lastSuccessfulCutoff: new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000),
      latestError: null,
      latestErrorAt: null,
      alert: null,
      workerOwned: true,
    }),
  }) as unknown as DataHealthHandler;

    const responseError = new Error("response serialization failed");

  const body = await readDataHealth(handler);
  const espn = providerByName(body, "espn");
  const nflverse = providerByName(body, "nflverse");
  const odds = providerByName(body, "odds-api");
  const retention = usageRetentionProvider(body);

  assert.equal(espn.status, "unavailable");
  assert.equal(espn.metadata.healthCheck, "failed");
  assert.equal(nflverse.status, "current");
  assert.equal(odds.status, "not_configured");
  assert.equal(retention.status, "current");
  assert.equal(retention.metadata.workerOwned, true);
});

function usageRetentionProvider(body: unknown[]) {
  const provider = body.find(
    (item): item is Record<string, any> =>
      typeof item === "object" &&
      item !== null &&
      (item as Record<string, unknown>).provider ===
        "usage-analytics-retention",
  );
  assert.ok(
    provider,
    "the data-health response should include Usage Lab retention",
  );
  return provider;
}

const hourAgo = new Date(now.getTime() - 60 * 60 * 1000);
const twoDaysAgo = new Date(now.getTime() - 2 * 24 * 60 * 60 * 1000);

test("protected data-health reports persisted Usage Lab cleanup states without mutating retention state", async () => {
  const originalRow = await readRetentionRow();

  const cases: Array<{
    name: string;
    row: RetentionRow | null;
    expected: {
      status: string;
      cleanupState: string;
      detail: string;
      persistedStatus: string | null;
      metadataStatus: string;
    };
  }> = [
    {
      name: "pending cleanup",
      row: null,
      expected: {
        status: "stale",
        cleanupState: "pending",
        detail: "The first Usage Lab retention cleanup is pending.",
        persistedStatus: null,
        metadataStatus: "pending",
      },
    },
    {
      name: "on-time successful cleanup",
      row: {
        id: 1,
        lastAttemptAt: hourAgo,
        lastAttemptStatus: "success",
        consecutiveFailures: 0,
        firstFailureAt: null,
        lastSuccessfulAt: hourAgo,
        lastSuccessfulDeletedEvents: 0,
        lastSuccessfulBatches: 0,
        lastSuccessfulCutoff: new Date(
          hourAgo.getTime() - 30 * 24 * 60 * 60 * 1000,
        ),
        latestError: null,
        latestErrorAt: null,
      },
      expected: {
        status: "current",
        cleanupState: "on_time",
        detail:
          "The latest Usage Lab retention cleanup completed successfully; no expired rows were found.",
        persistedStatus: "success",
        metadataStatus: "healthy",
      },
    },
    {
      name: "overdue successful cleanup",
      row: {
        id: 1,
        lastAttemptAt: twoDaysAgo,
        lastAttemptStatus: "success",
        consecutiveFailures: 0,
        firstFailureAt: null,
        lastSuccessfulAt: twoDaysAgo,
        lastSuccessfulDeletedEvents: 2,
        lastSuccessfulBatches: 1,
        lastSuccessfulCutoff: new Date(
          twoDaysAgo.getTime() - 30 * 24 * 60 * 60 * 1000,
        ),
        latestError: null,
        latestErrorAt: null,
      },
      expected: {
        status: "stale",
        cleanupState: "overdue",
        detail: "The Usage Lab retention cleanup is overdue;",
        persistedStatus: "success",
        metadataStatus: "healthy",
      },
    },
    {
      name: "failed cleanup",
      row: {
        id: 1,
        lastAttemptAt: hourAgo,
        lastAttemptStatus: "failed",
        consecutiveFailures: 1,
        firstFailureAt: hourAgo,
        lastSuccessfulAt: null,
        lastSuccessfulDeletedEvents: null,
        lastSuccessfulBatches: null,
        lastSuccessfulCutoff: null,
        latestError: "database temporarily unavailable",
        latestErrorAt: hourAgo,
      },
      expected: {
        status: "unavailable",
        cleanupState: "on_time",
        detail:
          "The latest Usage Lab retention cleanup failed: database temporarily unavailable.",
        persistedStatus: "failed",
        metadataStatus: "failed",
      },
    },
  ];

  try {
    for (const testCase of cases) {
      await replaceRetentionRow(testCase.row);
      const before = await readRetentionRow();
      const provider = usageRetentionProvider(await readDataHealth());
      const after = await readRetentionRow();

      assert.deepEqual(
        after,
        before,
        `${testCase.name} must not mutate persisted retention state`,
      );
      assert.equal(provider.status, testCase.expected.status, testCase.name);
      assert.equal(
        provider.metadata.cleanupState,
        testCase.expected.cleanupState,
        testCase.name,
      );
      assert.equal(
        provider.metadata.lastAttemptStatus,
        testCase.expected.persistedStatus,
        testCase.name,
      );
      assert.equal(
        provider.metadata.status,
        testCase.expected.metadataStatus,
        testCase.name,
      );
      assert.match(
        provider.detail,
        new RegExp(
          testCase.expected.detail.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"),
        ),
        testCase.name,
      );
      assert.equal(provider.metadata.workerOwned, true, testCase.name);
      assert.equal(
        provider.schedule,
        "Every 24 hours; worker-owned",
        testCase.name,
      );
      assert.equal(
        provider.retryPolicy,
        "A failed cleanup is recorded and retried on the next daily tick.",
        testCase.name,
      );
    }
  } finally {
    await replaceRetentionRow(originalRow);
  }
});

after(async () => {
  if (retentionTestLock) {
    try {
      await retentionTestLock.query("SELECT pg_advisory_unlock(hashtext($1))", [
        RETENTION_TEST_LOCK,
      ]);
    } finally {
      retentionTestLock.release();
      retentionTestLock = null;
    }
  }
  await pool.end();
});
