import { logger } from "./lib/logger";
import { startDataScheduler, stopDataScheduler } from "./lib/scheduler";
import { startFeedScheduler } from "./lib/feed-scheduler";
import { startUsageAnalyticsRetention } from "./lib/usage-analytics-retention";
import { pool } from "@workspace/db";
import {
  acquireGlobalWorkerOwnership,
  isNewWorkerApproved,
} from "./lib/worker-ownership";

if (!isNewWorkerApproved()) {
  throw new Error(
    "Data worker refused to start: GRIDLINE_NEW_WORKER_APPROVED must be exactly 1",
  );
}

// The ownership lock only coordinates workers running this new build. Older
// deployed workers do not honor it, so operators must stop them before enabling
// this worker or overlap remains possible.
await acquireGlobalWorkerOwnership(pool, {
  onConnectionLost: (error) => {
    logger.error({ error }, "Global worker ownership connection lost; exiting fail-closed");
    process.exit(1);
  },
});

process.env.GRIDLINE_SCHEDULER_WORKER = "1";
await startDataScheduler();
const stopFeedScheduler = startFeedScheduler();
const stopUsageAnalyticsRetention = startUsageAnalyticsRetention();
logger.info(
  "Gridline data worker is running; scheduled jobs continue independently of the interactive API process.",
);

// Keep this process alive even when the database driver has no pending socket.
const keepAlive = setInterval(() => undefined, 60_000);

for (const signal of ["SIGTERM", "SIGINT"] as const) {
  process.once(signal, () => {
    // Never unlock while an async job or provider call might still be active.
    // The process exit closes the PostgreSQL session and releases ownership
    // only when this worker can no longer initiate any scheduled activity.
    clearInterval(keepAlive);
    stopFeedScheduler();
    stopUsageAnalyticsRetention();
    stopDataScheduler();
    process.exit(0);
  });
}
