import { logger } from "./lib/logger";
import { startDataScheduler } from "./lib/scheduler";
import { startFeedScheduler } from "./lib/feed-scheduler";
import { startUsageAnalyticsRetention } from "./lib/usage-analytics-retention";

process.env.GRIDLINE_SCHEDULER_WORKER = "1";
await startDataScheduler();
startFeedScheduler();
startUsageAnalyticsRetention();
logger.info(
  "Gridline data worker is running; scheduled jobs continue independently of the interactive API process.",
);

// Keep this process alive even when the database driver has no pending socket.
setInterval(() => undefined, 60_000);
