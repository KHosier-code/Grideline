import { spawn, type ChildProcess } from "node:child_process";
import { fileURLToPath } from "node:url";
import { verifyProductionDatabase } from "./lib/production-database-smoke";
import { createProductionDatabaseAlert } from "./lib/production-startup-alert";
import { startProductionServices } from "./lib/production-startup";

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

try {
  const evidence = await startProductionServices(
    () => verifyProductionDatabase(__GRIDLINE_BUILD_ID__),
    () => start("Gridline data worker", workerPath),
    () => start("Gridline API", apiPath),
  );
  console.info("Production database smoke check passed", {
    buildId: evidence.buildId,
    checkedAt: evidence.checkedAt.toISOString(),
    selectOneResult: evidence.selectOneResult,
    verifyFullPassed: evidence.verifyFullPassed,
  });
} catch (error) {
  console.error(
    "Production database smoke check failed; API and worker were not started",
    createProductionDatabaseAlert(error),
  );
  process.exitCode = 1;
}
