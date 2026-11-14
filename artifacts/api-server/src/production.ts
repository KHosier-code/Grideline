import { spawn, type ChildProcess } from "node:child_process";
import { fileURLToPath } from "node:url";
import { verifyProductionDatabase } from "./lib/production-database-smoke";
import { createProductionDatabaseAlert, isFatalStartupFailure } from "./lib/production-startup-alert";
import { startWithDatabaseRetry, waitForApiHealth } from "./lib/production-startup";
import { startWorkerOnlyWhenApproved } from "./lib/worker-ownership";

declare const __GRIDLINE_BUILD_ID__: string;

const workerPath = fileURLToPath(new URL("./worker.mjs", import.meta.url));
const apiPath = fileURLToPath(new URL("./index.mjs", import.meta.url));
const children: ChildProcess[] = [];
let stopping = false;

function start(name: string, entrypoint: string) {
  const child = spawn(process.execPath, ["--enable-source-maps", entrypoint], {
    env: process.env,
    stdio: "inherit",
  });
  children.push(child);
  child.once("exit", (code, signal) => {
    if (stopping) return;
    stopping = true;
    console.error(`${name} exited`, { code, signal });
    for (const sibling of children) {
      if (sibling !== child && sibling.exitCode === null) sibling.kill("SIGTERM");
    }
    process.exitCode = code ?? 1;
  });
  return child;
}

function stop(signal: NodeJS.Signals) {
  if (stopping) return;
  stopping = true;
  for (const child of children) {
    if (child.exitCode === null) child.kill(signal);
  }
}

process.once("SIGTERM", () => stop("SIGTERM"));
process.once("SIGINT", () => stop("SIGINT"));

const startWorker = () => {
  const started = startWorkerOnlyWhenApproved(process.env, () => {
    // Existing deployed workers do not know this approval gate or advisory
    // lock. Activating a new worker while one remains alive can overlap;
    // operators must retire the old worker before setting the flag.
    console.warn(
      "GRIDLINE_NEW_WORKER_APPROVED=1: starting the new worker. This does not fence older deployed workers; verify they are stopped to avoid overlap.",
    );
    start("Gridline data worker", workerPath);
  });
  if (!started) {
    console.info(
      "Production API is running; new data worker is disabled because GRIDLINE_NEW_WORKER_APPROVED is not exactly 1",
    );
  }
};

const verify = async () => {
  const result = await verifyProductionDatabase(__GRIDLINE_BUILD_ID__);
  console.info("Production database smoke check passed", {
    buildId: result.buildId,
    checkedAt: result.checkedAt.toISOString(),
    selectOneResult: result.selectOneResult,
    verifyFullPassed: result.verifyFullPassed,
  });
  return result;
};

const startApi = async () => {
  const port = Number(process.env.PORT);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error("Production PORT must be a valid TCP port before API startup");
  }
  const api = start("Gridline API", apiPath);
  let spawnError: Error | undefined;
  api.once("error", (error) => { spawnError = error; });
  await waitForApiHealth(
    `http://127.0.0.1:${port}/api/healthz`,
    () => !spawnError && api.exitCode === null && api.signalCode === null,
  );
  console.info("Production API healthy; checking data worker approval", {
    event: "production_api_health_ready",
  });
};

try {
  // The site starts even when the database is down or over a plan limit:
  // pages then say data is refreshing, and the check retries every minute.
  await startWithDatabaseRetry({
    verify,
    startApi,
    startWorker,
    isFatal: isFatalStartupFailure,
    stopped: () => stopping,
    onDegraded: (error, attempt) => {
      if (attempt === 1 || attempt % 15 === 0) {
        console.error("Database unavailable; the site is running without it and retrying every minute", {
          ...createProductionDatabaseAlert(error),
          action: "api_started_without_database",
          attempt,
        });
      }
    },
    onRecovered: (_evidence, attempt) => {
      console.info("Database is back; starting the data worker", { attempt });
    },
  });
} catch (error) {
  if (children.length) stop("SIGTERM");
  console.error(
    "Production startup stopped; API and worker were not started",
    createProductionDatabaseAlert(error),
  );
  process.exitCode = 1;
}
