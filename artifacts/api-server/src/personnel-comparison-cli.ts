import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { pool } from "@workspace/db";
import {
  assertRetainedPersonnelComparisonFingerprint,
  prepare2025PersonnelComparison,
  run2025PersonnelComparison,
} from "./lib/personnel-comparison";
import { renderPersonnelComparisonMarkdown } from "./lib/personnel-comparison-markdown";

/**
 * Development-only report writer. The runner reads the accepted immutable
 * baseline and reconstructs every personnel context at its historical cutoff.
 */
async function main() {
  if (process.env.NODE_ENV !== "development") throw new Error("The personnel comparison CLI is development-only");
  const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
  const outputPath = resolve(process.argv[2] ?? repositoryRoot, process.argv[2] ? "" : "reports/gridline-2025-personnel-comparison.json");
  const markdownPath = resolve(process.argv[3] ?? outputPath.replace(/\.json$/, ".md"));
  const retainedPath = resolve(repositoryRoot, "reports/gridline-2025-personnel-comparison.json");
  const retainedReport = JSON.parse(await readFile(retainedPath, "utf8"));
  const preparation = await prepare2025PersonnelComparison();
  console.log(JSON.stringify({
    phase: "preflight",
    status: preparation.preflight.status,
    message: preparation.preflight.message,
    gamesChecked: preparation.preflight.gamesChecked,
    coverageBySeason: preparation.preflight.coverageBySeason,
  }));
  if (preparation.preflight.status === "block") throw new Error(preparation.preflight.message);
  const report = await run2025PersonnelComparison(preparation);
  assertRetainedPersonnelComparisonFingerprint(report, retainedReport);
  await mkdir(resolve(outputPath, ".."), { recursive: true });
  await writeFile(outputPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  await writeFile(markdownPath, `${renderPersonnelComparisonMarkdown(report)}\n`, "utf8");
  console.log(JSON.stringify({ baselineRunId: report.baselineRunId, output: outputPath, markdown: markdownPath, immutable: report.immutable }));
}

main().finally(() => pool.end()).catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
