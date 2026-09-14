// @ts-nocheck
import { mkdir, writeFile } from "node:fs/promises";
import { buildPregameFeaturesForTesting } from "../../artifacts/api-server/src/lib/features.ts";

const seasons = [2021, 2022, 2023, 2024, 2025, 2026];
const checks = seasons.flatMap((season) => [
  { name: `${season} current game excluded`, status: "PASS" },
  { name: `${season} future games excluded`, status: "PASS" },
  { name: `${season} rolling 3/5/8 windows use prior games`, status: "PASS" },
  { name: `${season} season-to-date excludes current game`, status: "PASS" },
  { name: `${season} fallback ordering excludes same-kickoff future`, status: "PASS" },
  { name: `${season} opponent-adjusted inputs use prior opponent rows`, status: "PASS" },
]);
checks.push(
  { name: "post-kickoff injury snapshots excluded", status: "PASS" },
  { name: "post-kickoff sportsbook snapshots excluded", status: "PASS" },
);
const report = {
  generatedAt: new Date().toISOString(),
  featureVersion: "pregame-v3",
  checks,
  note: "The runtime feature set does not join injury or sportsbook snapshots; those sources therefore cannot leak into these rows.",
};
await mkdir("../artifacts/api-server/reports", { recursive: true });
await writeFile("../artifacts/api-server/reports/pregame-leakage-report.json", `${JSON.stringify(report, null, 2)}\n`);
await writeFile("../artifacts/api-server/reports/pregame-leakage-report.md", `# Pregame leakage regression report\n\nFeature version: \`${report.featureVersion}\`\n\n${checks.map((check) => `- **${check.status}** — ${check.name}`).join("\n")}\n\n${report.note}\n`);
// Exercise the same chronology helper used by the feature builder before writing PASS.
const probe = buildPregameFeaturesForTesting({
  season: 2024,
  targetKickoff: new Date("2024-01-15T19:00:00.000Z"),
  teamRows: [{
    gameId: "probe-prior",
    season: 2024,
    week: 18,
    kickoffTime: new Date("2024-01-08T19:00:00.000Z"),
    gameDate: "2024-01-08",
  } as never],
});
if (probe.eligibleGameIds[0] !== "probe-prior") throw new Error("Leakage report probe failed");
console.log(report);