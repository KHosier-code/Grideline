import { mkdir, rename, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { pool } from "@workspace/db";
import {
  readDevelopmentUpcomingPlayerReadiness,
  renderUpcomingPlayerReadinessMarkdown,
} from "./lib/player-forecast-readiness";

async function main() {
  if (process.env.NODE_ENV !== "development" || process.env.REPLIT_DEPLOYMENT) {
    throw new Error("Upcoming player readiness report generation is restricted to local development");
  }
  const repositoryRoot = resolve(__dirname, "../../..");
  const reportDirectory = resolve(repositoryRoot, "reports");
  const jsonPath = resolve(reportDirectory, "gridline-player-engine-upcoming-readiness.json");
  const markdownPath = resolve(reportDirectory, "gridline-player-engine-upcoming-readiness.md");
  const report = await readDevelopmentUpcomingPlayerReadiness();
  const jsonTemp = `${jsonPath}.tmp`;
  const markdownTemp = `${markdownPath}.tmp`;
  await mkdir(reportDirectory, { recursive: true });
  await writeFile(jsonTemp, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  await writeFile(markdownTemp, `${renderUpcomingPlayerReadinessMarkdown(report)}\n`, "utf8");
  await rename(jsonTemp, jsonPath);
  await rename(markdownTemp, markdownPath);
  process.stdout.write(`${JSON.stringify({
    status: report.status,
    asOf: report.asOf,
    upcomingGames: report.upcomingGames,
    eligibility: report.eligibility,
    blockers: report.blockers,
    reports: [jsonPath, markdownPath],
    databaseAccess: "read-only",
    forecastsGenerated: report.forecasts.length,
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