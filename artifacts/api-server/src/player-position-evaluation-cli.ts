import { writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { readDefenseInputs } from "./lib/defense-vs-position";
import { evaluatePlayerPositionMatchups } from "./lib/player-position-evaluation";
import { readPlayerPositionReleases } from "./lib/player-position-releases";

async function main() {
  if (process.env.NODE_ENV !== "development" || process.env.REPLIT_DEPLOYMENT) {
    throw new Error("Historical evaluation is development-only.");
  }
  const cutoff = new Date("2026-02-01T00:00:00Z");
  const report = evaluatePlayerPositionMatchups([await readDefenseInputs(2025, cutoff)], 2025, 2025,
    await readPlayerPositionReleases(2025, cutoff));
  await writeFile(resolve(process.cwd(), "../../reports/gridline-player-position-evaluation.json"),
    JSON.stringify(report, null, 2) + "\n");
}
main().catch(error => { process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`); process.exitCode = 1; });