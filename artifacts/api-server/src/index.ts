import app from "./app";
import { logger } from "./lib/logger";
import { startKickoffClock } from "./lib/kickoff-clock";
import { ensurePlayerRecoveryReceiptCleanupMarker } from "./lib/player-recovery-receipts";

const rawPort = process.env["PORT"];

if (!rawPort) {
  throw new Error(
    "PORT environment variable is required but was not provided.",
  );
}

const port = Number(rawPort);

if (Number.isNaN(port) || port <= 0) {
  throw new Error(`Invalid PORT value: "${rawPort}"`);
}

async function start() {
  // The production check (production.ts) already stops startup when this
  // table is missing. A write that fails here means the database is down or
  // over a plan limit, and the site should still come up and say so.
  await ensurePlayerRecoveryReceiptCleanupMarker().catch((err: unknown) => {
    logger.error({ err }, "Receipt cleanup marker could not be written; starting without it");
  });
  app.listen(port, (err) => {
    if (err) {
      logger.error({ err }, "Error listening on port");
      process.exit(1);
    }

    logger.info({ port }, "Server listening");
    startKickoffClock();
  });
}

start().catch((err: unknown) => {
  logger.error({ err }, "API startup failed");
  process.exit(1);
});
