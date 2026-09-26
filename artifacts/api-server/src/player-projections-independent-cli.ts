import { readFile, rename, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { pool } from "@workspace/db";
import {
  runDevelopmentPlayerProjectionIndependentValidation,
} from "./lib/player-projections-db";
import {
  hash,
  type FrozenPlayerProjectionBaseline,
} from "./lib/player-projections";
import { renderIndependentPlayerProjectionMarkdown } from "./lib/player-projections-report";

// The frozen 2024 report is an input artifact, not a model to refit or replace.
const FROZEN_BASELINE_SHA256 = "131c5672ce49d28b0fd226be4465d188d6403f1a5da19f88bd69e35c5ad6dc3e";

async function main() {
  if (process.env.NODE_ENV !== "development" || process.env.REPLIT_DEPLOYMENT) {
    throw new Error("Independent player-projection validation is restricted to a development database");
  }
  const repositoryRoot = resolve(__dirname, "../../..");
  const baselinePath = resolve(repositoryRoot, "reports/gridline-player-projection-baseline.json");
  const jsonPath = resolve(repositoryRoot, "reports/gridline-player-projection-independent-validation.json");
  const markdownPath = resolve(repositoryRoot, "reports/gridline-player-projection-independent-validation.md");
  const baselineBytes = await readFile(baselinePath);
  const baselineReportSha256 = hash(baselineBytes.toString("utf8"));
  if (baselineReportSha256 !== FROZEN_BASELINE_SHA256) {
    throw new Error("Frozen 2024 player-projection baseline changed; independent validation refuses to continue");
  }
  let baseline: FrozenPlayerProjectionBaseline;
  try {
    baseline = JSON.parse(baselineBytes.toString("utf8")) as FrozenPlayerProjectionBaseline;
  } catch {
    throw new Error(`Could not parse frozen player-projection baseline report: ${baselinePath}`);
  }
  const report = await runDevelopmentPlayerProjectionIndependentValidation({
    baseline,
    baselineReportSha256,
  });
  const markdown = renderIndependentPlayerProjectionMarkdown(report);
  const jsonTemp = `${jsonPath}.tmp`;
  const markdownTemp = `${markdownPath}.tmp`;
  await writeFile(jsonTemp, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  await writeFile(markdownTemp, `${markdown}\n`, "utf8");
  await rename(jsonTemp, jsonPath);
  await rename(markdownTemp, markdownPath);
  process.stdout.write(`${JSON.stringify({
    evaluationKind: report.evaluationKind,
    outputs: { json: jsonPath, markdown: markdownPath },
    baselineReportSha256: report.baseline.reportSha256,
    checksumSha256: report.provenance.checksumSha256,
    leakageChecks: report.leakageChecks,
    familySampleSizes: Object.fromEntries(Object.entries(report.families).map(([family, result]) => [
      family,
      Object.fromEntries(Object.entries(result.evaluations).map(([season, evaluation]) => [
        season,
        { candidates: evaluation.evaluationCandidates, eligible: evaluation.eligiblePredictions },
      ])),
    ])),
  }, null, 2)}\n`);
}

void (async () => {
  try {
    await main();
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  } finally {
    await pool.end();
  }
})();