import app from "./app";
import { pool } from "@workspace/db";
import { logger } from "./lib/logger";
import { assertWeeklyPickSchemaReady } from "./lib/weekly-pick-schema-readiness";

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
  await assertWeeklyPickSchemaReady(pool);
  app.listen(port, (err) => {
    if (err) {
      logger.error({ err }, "Error listening on port");
      process.exit(1);
    }

    logger.info({ port }, "Server listening");
  });
}

start().catch((err: unknown) => {
  logger.error({ err }, "API schema readiness failed");
  process.exit(1);
});
