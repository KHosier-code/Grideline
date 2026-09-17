import assert from "node:assert/strict";
import test, { after, before } from "node:test";
import {
  db,
  pool,
  usageAnalyticsRetentionTable,
} from "@workspace/db";
import { eq } from "drizzle-orm";
import dashboardRouter, { createDataHealthHandler } from "./dashboard";
import { PREGAME_FEATURE_DEFINITION } from "../lib/features";
import { requireAdmin } from "../middlewares/admin";

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
  await retentionTestLock.query(
    "SELECT pg_advisory_lock(hashtext($1))",
    [RETENTION_TEST_LOCK],
  );
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

const dataHealthRoute = (dashboardRouter as unknown as { stack: RouteLayer[] }).stack
  .find((layer) => layer.route?.path === "/data-health")?.route;

assert.ok(dataHealthRoute, "the data-health route should be registered");
assert.equal(
  dataHealthRoute.stack[0]?.handle,
  requireAdmin,
  "the data-health route must remain protected by requireAdmin",
);

const protectedDataHealthHandler = dataHealthRoute.stack.at(-1)?.handle as DataHealthHandler | undefined;
assert.ok(protectedDataHealthHandler, "the data-health route should have a response handler");

const now = new Date();

const dataHealthOverrides = {
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
    status: "stale" as const,
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
    status: "unavailable" as const,
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
    status: "not_configured" as const,
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
    status: "application_only" as const,
    mechanism: "application_append_only",
    applicationUpdateDeleteBlocked: true,
    productionFittingBlocked: true,
    databaseTriggerActive: false,
    databaseTriggerSupport: "unavailable_through_current_publish_path",
    verification: "test fixture",
    note: "Test fixture",
  }),
  getFeedGameDays: async () => new Set<string>(),
  weatherHealth: async () => ({
    source: "Test fixture",
    cost: "Test fixture",
    userAgentConfigured: false,
    lastRun: null,
  }),
};
const dataHealthHandler = createDataHealthHandler(dataHealthOverrides) as unknown as DataHealthHandler;

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

async function readDataHealth(handler = dataHealthHandler): Promise<unknown[]> {
  let responseBody: unknown;
  await handler({}, {
    json(body) {
      responseBody = body;
      return body;
    },
  });
  assert.ok(responseBody, "the data-health route should return a response body");
  assert.ok(Array.isArray(responseBody), "the data-health response should be a provider list");
  return responseBody;
}

function usageRetentionProvider(body: unknown[]) {
  const provider = body.find(
    (item): item is Record<string, any> =>
      typeof item === "object"
      && item !== null
      && (item as Record<string, unknown>).provider === "usage-analytics-retention",
  );
  assert.ok(provider, "the data-health response should include Usage Lab retention");
  return provider;
}

function providerByName(body: unknown[], name: string) {
  const provider = body.find(
    (item): item is Record<string, any> =>
      typeof item === "object"
      && item !== null
      && (item as Record<string, unknown>).provider === name,
  );
  assert.ok(provider, `the data-health response should include ${name}`);
  return provider;
}

const hourAgo = new Date(now.getTime() - 60 * 60 * 1000);
const twoDaysAgo = new Date(now.getTime() - 2 * 24 * 60 * 60 * 1000);

test("protected data-health isolates a failed provider and keeps mixed provider states visible", async () => {
  const handler = createDataHealthHandler({
    ...dataHealthOverrides,
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

  const body = await readDataHealth(handler);
  const espn = providerByName(body, "espn");
  const nflverse = providerByName(body, "nflverse");
  const odds = providerByName(body, "odds-api");
  const retention = usageRetentionProvider(body);

  assert.equal(espn.status, "unavailable", "a throwing schedule health check should become unavailable");
  assert.equal(espn.metadata.healthCheck, "failed");
  assert.equal(nflverse.status, "current", "healthy providers should retain their normal status");
  assert.equal(odds.status, "not_configured", "a successful unavailable provider should remain distinguishable");
  assert.equal(retention.status, "current", "Usage Lab retention should remain visible and healthy");
  assert.equal(retention.metadata.workerOwned, true);
});

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
        lastSuccessfulCutoff: new Date(hourAgo.getTime() - 30 * 24 * 60 * 60 * 1000),
        latestError: null,
        latestErrorAt: null,
      },
      expected: {
        status: "current",
        cleanupState: "on_time",
        detail: "The latest Usage Lab retention cleanup completed successfully; no expired rows were found.",
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
        lastSuccessfulCutoff: new Date(twoDaysAgo.getTime() - 30 * 24 * 60 * 60 * 1000),
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
        detail: "The latest Usage Lab retention cleanup failed: database temporarily unavailable.",
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

      assert.deepEqual(after, before, `${testCase.name} must not mutate persisted retention state`);
      assert.equal(provider.status, testCase.expected.status, testCase.name);
      assert.equal(provider.metadata.cleanupState, testCase.expected.cleanupState, testCase.name);
      assert.equal(provider.metadata.lastAttemptStatus, testCase.expected.persistedStatus, testCase.name);
      assert.equal(provider.metadata.status, testCase.expected.metadataStatus, testCase.name);
      assert.match(provider.detail, new RegExp(testCase.expected.detail.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")), testCase.name);
      assert.equal(provider.metadata.workerOwned, true, testCase.name);
      assert.equal(provider.schedule, "Every 24 hours; worker-owned", testCase.name);
      assert.equal(provider.retryPolicy, "A failed cleanup is recorded and retried on the next daily tick.", testCase.name);
    }
  } finally {
    await replaceRetentionRow(originalRow);
  }
});

after(async () => {
  if (retentionTestLock) {
    try {
      await retentionTestLock.query(
        "SELECT pg_advisory_unlock(hashtext($1))",
        [RETENTION_TEST_LOCK],
      );
    } finally {
      retentionTestLock.release();
      retentionTestLock = null;
    }
  }
  await pool.end();
});