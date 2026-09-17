import { writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { run2025MarketBaseline } from "./lib/market-baseline-run";
import { pool } from "@workspace/db";

async function main() {
  if (process.env.NODE_ENV !== "development") {
    throw new Error("The 2025 market baseline CLI is development-only");
  }
  const result = await run2025MarketBaseline();
  const output = resolve(process.argv[2] ?? "reports/gridline-2025-market-baseline.json");
  await writeFile(output, `${JSON.stringify(result.report, null, 2)}\n`, "utf8");
  console.log(JSON.stringify({ evaluationRunId: result.evaluationRunId, created: result.created, output }));
}

main()
  .finally(() => pool.end())
  .catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });