import app from "./app";
import { logger } from "./lib/logger";
import { startDataScheduler } from "./lib/scheduler";

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

app.listen(port, (err) => {
  if (err) {
    logger.error({ err }, "Error listening on port");
    process.exit(1);
  }

  logger.info({ port }, "Server listening");
  // The recurring data layer is intentionally in-process. Replit/deployed
  // environments must keep this API service always-on for scheduled work;
  // a stopped process does not claim missed jobs or report them as runs.
  void startDataScheduler();
});
