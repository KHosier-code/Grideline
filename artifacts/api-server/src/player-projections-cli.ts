import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { pool } from "@workspace/db";
import { runDevelopmentPlayerProjectionBaseline } from "./lib/player-projections-db";
import { renderPlayerProjectionMarkdown } from "./lib/player-projections-report";

async function main() {
  if (process.env.NODE_ENV !== "development" || process.env.REPLIT_DEPLOYMENT) {
    throw new Error("Player projection evaluation is restricted to a development database");
  }
  const repositoryRoot = resolve(__dirname, "../../..");
  const jsonPath = resolve(process.argv[2] ?? repositoryRoot, process.argv[2] ? "" : "reports/gridline-player-projection-baseline.json");
  const markdownPath = resolve(process.argv[3] ?? jsonPath.replace(/\.json$/, ".md"));
  const report = await runDevelopmentPlayerProjectionBaseline();
  const markdown = renderPlayerProjectionMarkdown(report);
  await mkdir(dirname(jsonPath), { recursive: true });
  await mkdir(dirname(markdownPath), { recursive: true });
  await writeFile(jsonPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  await writeFile(markdownPath, `${markdown}\n`, "utf8");
  process.stdout.write(`${JSON.stringify({
    evaluationKind: report.evaluationKind,
    outputs: { json: jsonPath, markdown: markdownPath },
    checksumSha256: report.provenance.checksumSha256,
    families: Object.fromEntries(Object.entries(report.families).map(([family, result]) => [
      family,
      {
        trainingSamples: result.trainingSamples,
        evaluationCandidates: result.evaluationCandidates,
        evaluationCandidatePlayers: result.evaluationCandidatePlayers,
        eligiblePredictions: result.eligiblePredictions,
        eligiblePlayers: result.eligiblePlayers,
        overallModelMae: result.metrics.meanAbsoluteError,
        pairedBaselines: Object.fromEntries(Object.entries(result.baselines).map(([baseline, comparison]) => [
          baseline,
          {
            baselineSampleSize: comparison.baseline.sampleSize,
            pairedModelSampleSize: comparison.modelOnSameCohort.sampleSize,
            baselineMae: comparison.baseline.meanAbsoluteError,
            pairedModelMae: comparison.modelOnSameCohort.meanAbsoluteError,
          },
        ])),
      },
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