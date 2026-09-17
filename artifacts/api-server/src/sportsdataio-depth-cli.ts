import { writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { pool } from "@workspace/db";
import { runSportsDataIoDepthEvaluation } from "./lib/sportsdataio-depth";

async function main() {
  if (process.env.NODE_ENV !== "development") throw new Error("The SportsDataIO depth evaluation CLI is development-only");
  const output = resolve(process.argv[2] ?? "reports/sportsdataio-depth-evaluation.json");
  const report = await runSportsDataIoDepthEvaluation();
  await writeFile(output, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  console.log(JSON.stringify({ output, status: report.preflight.status, finalVerdict: report.finalVerdict }));
}

main().finally(() => pool.end()).catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});