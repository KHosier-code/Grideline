import { spawn, type ChildProcess } from "node:child_process";
import { fileURLToPath } from "node:url";
import { verifyProductionDatabase } from "./lib/production-database-smoke";
import { createProductionDatabaseAlert } from "./lib/production-startup-alert";
import { startProductionServices, waitForApiHealth } from "./lib/production-startup";
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

let databaseReady = false;
try {
  await startProductionServices(
    async () => {
      const result = await verifyProductionDatabase(__GRIDLINE_BUILD_ID__);
      databaseReady = true;
      console.info("Production database smoke check passed", {
        buildId: result.buildId,
        checkedAt: result.checkedAt.toISOString(),
        selectOneResult: result.selectOneResult,
        verifyFullPassed: result.verifyFullPassed,
      });
      return result;
    },
    () => {
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
    },
    async () => {
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
    },
  );
} catch (error) {
  if (children.length) stop("SIGTERM");
  if (databaseReady) {
    console.error("Production API health gate failed; worker was not started", {
      event: "production_api_startup_gate_failed",
      reason: "api_not_healthy",
    });
  } else {
    console.error(
      "Production database smoke check failed; API and worker were not started",
      createProductionDatabaseAlert(error),
    );
  }
  process.exitCode = 1;
}
