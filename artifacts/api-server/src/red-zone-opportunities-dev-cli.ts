import { resolve } from "node:path";
import { stat } from "node:fs/promises";
import { pool } from "@workspace/db";
import { deriveAndPersistRedZoneOpportunities } from "./lib/nflverse";

async function main() {
  if (process.env.NODE_ENV !== "development" || process.env.REPLIT_DEPLOYMENT) {
    throw new Error("Red-zone derivation CLI is development-only and cannot run in a deployment");
  }
  const seasons = process.argv.slice(2).map(Number);
  if (!seasons.length || seasons.some((season) => !Number.isInteger(season) || season < 2000 || season > 2100)) {
    throw new Error("Usage: pnpm --filter @workspace/api-server run derive:red-zone:dev -- <season> [season ...]");
  }
  for (const season of seasons) {
    const filePath = resolve(process.cwd(), ".cache", "nflverse", `play_by_play_${season}.csv.gz`);
    const file = await stat(filePath);
    if (file.size === 0) throw new Error(`Cached nflverse PBP file is empty: ${filePath}`);
    const result = await deriveAndPersistRedZoneOpportunities(season, filePath);
    process.stderr.write(`Derived red-zone facts from local cached PBP only: ${JSON.stringify(result)}\n`);
  }
}

main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
}).finally(() => pool.end());