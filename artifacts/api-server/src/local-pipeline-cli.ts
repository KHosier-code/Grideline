/**
 * Local development only: run the real data + model pipeline end to end
 * against a localhost database seeded by local-seed-cli.ts.
 *   1. import nflverse history (play-by-play, player stats) for the given seasons
 *   2. rebuild pregame team features
 *   3. refit the Phase 6 production models and promote them
 *   4. generate live predictions as of --now
 */
import { desc, eq } from "drizzle-orm";
import { db, modelPromotionHistoryTable, modelTrainingRunsTable, pool } from "@workspace/db";
import { syncNflverseHistory } from "./lib/nflverse";
import { rebuildPregameFeatures } from "./lib/features";
import { refitPhase6ProductionModels } from "./lib/modeling";
import { generateLivePredictions } from "./lib/live-predictions";

const args = new Map(process.argv.slice(2).map((arg) => {
  const [key, value] = arg.replace(/^--/, "").split("=");
  return [key, value ?? "true"] as const;
}));

async function step<T>(name: string, run: () => Promise<T>) {
  const started = Date.now();
  console.log(`▶ ${name}`);
  const result = await run();
  console.log(`✓ ${name} (${((Date.now() - started) / 1000).toFixed(1)}s)`, JSON.stringify(result, null, 0)?.slice(0, 600));
  return result;
}

async function main() {
  if (process.env.NODE_ENV !== "development" || !/@(127\.0\.0\.1|localhost)[:/]/.test(process.env.DATABASE_URL ?? "")) {
    throw new Error("local-pipeline-cli only runs with NODE_ENV=development against a localhost database");
  }
  const seasons = (args.get("seasons") ?? "2021,2022,2023,2024,2025,2026").split(",").map(Number);
  const now = new Date(args.get("now") ?? new Date().toISOString());
  if (!args.has("skip-import")) {
    await step("import nflverse", () => syncNflverseHistory(seasons, { datasets: ["pbp", "player_stats"] }));
  }
  await step("rebuild features", () => rebuildPregameFeatures(undefined, now, { futureOnly: false }));
  await step("refit models", () => refitPhase6ProductionModels());
  for (const family of ["spread", "moneyline", "totals"]) {
    const [run] = await db.select().from(modelTrainingRunsTable)
      .where(eq(modelTrainingRunsTable.family, family))
      .orderBy(desc(modelTrainingRunsTable.trainedAt), desc(modelTrainingRunsTable.id)).limit(1);
    if (!run) throw new Error(`No refit run for ${family}`);
    await db.insert(modelPromotionHistoryTable).values({
      family, modelVersion: run.modelVersion, algorithm: run.algorithm, featureVersion: run.featureVersion,
      trainingCutoff: "2025 regular season", role: "production", promotedBy: "local-pipeline-cli", reason: "Local development",
    });
  }
  await step("generate predictions", () => generateLivePredictions(now));
  await pool.end();
}

await main();
