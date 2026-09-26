import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { pool } from "@workspace/db";
import { runDevelopmentPlayerTdEvaluation } from "./lib/player-td-evaluation-db";

async function main() {
  const { report, provenance } = await runDevelopmentPlayerTdEvaluation();
  const path = resolve(__dirname, "../../..", "reports");
  const format = (value: number | null) => value === null ? "unavailable" : value.toFixed(4);
  const row = (label: string, metric: typeof report.metrics.model) =>
    `| ${label} | ${metric.count} | ${metric.positives} | ${format(metric.brierScore)} | ${format(metric.logLoss)} | ${format(metric.auc)} |`;
  const byPosition = (["QB", "RB", "WR", "TE"] as const).map((position) => {
    const rows = report.predictions.filter((item) => item.position === position);
    const positives = rows.filter((item) => item.label).length;
    const meanProbability = rows.length ? rows.reduce((sum, item) => sum + item.probability, 0) / rows.length : null;
    return `| ${position} | ${rows.length} | ${positives} | ${format(meanProbability)} |`;
  });
  const byWeek = [...new Set(report.predictions.map((item) => `${item.season}:${item.week}`))]
    .sort((a, b) => {
      const [as, aw] = a.split(":").map(Number);
      const [bs, bw] = b.split(":").map(Number);
      return as! - bs! || aw! - bw!;
    }).map((key) => {
      const rows = report.predictions.filter((item) => `${item.season}:${item.week}` === key);
      const positives = rows.filter((item) => item.label).length;
      const rate = positives / rows.length;
      // Approximate Wilson interval (95%) communicates small-week uncertainty.
      const z2 = 1.96 ** 2;
      const center = (rate + z2 / (2 * rows.length)) / (1 + z2 / rows.length);
      const half = 1.96 * Math.sqrt(rate * (1 - rate) / rows.length
        + z2 / (4 * rows.length ** 2)) / (1 + z2 / rows.length);
      return `| ${key.replace(":", " week ")} | ${rows.length} | ${format(rate)} | ${format(center - half)}–${format(center + half)} |`;
    });
  const markdown = [
    "# Weekly player scoring-TD probability research",
    "",
    `Model: ${report.version}. Input SHA-256: ${report.inputHash}. This is an offline development research evaluation, **not approved for live forecasts**.`,
    "",
    "Outcome is at least one rushing or receiving TD for QB/RB/WR/TE. QB passing TDs do not count. This is a player scoring event, not a sportsbook line, implied odds or betting advice.",
    `Train seasons ${report.config.trainingSeasons.join(", ")}; calibration ${report.fitting.calibrationSource} (${report.fitting.calibrationExamples} rows); held-out late 2024 and 2025. A calibration fit is ${report.fitting.platt ? "available" : "unavailable"}.`,
    `The 2021–24 schedule is date-only and withholds same-day evidence. 2025 evaluation requires an explicit final game and UTC kickoff. ${provenance.sourceTimingLimitation}`,
    "",
    `Raw player rows ${provenance.rawPlayerRows}; matched ${provenance.matchedPlayerRows}; unmatched ${provenance.unmatchedPlayerRows}; team-game rows ${provenance.matchedTeamGames}; joined zone-20 facts ${provenance.joinedRedZoneFacts}.`,
    `Prepared train ${report.cohorts.training}, calibration ${report.cohorts.calibration}, held-out ${report.cohorts.evaluation}; duplicates excluded ${report.cohorts.excludedDuplicatePlayerRows} player / ${report.cohorts.excludedDuplicateTeamGames} team / ${report.cohorts.excludedDuplicateRedZoneFacts} red-zone; unlabeled ${report.cohorts.excludedUnlabeledRows}; fewer than three prior appearances ${report.cohorts.excludedInsufficientHistory}.`,
    `Held-out red-zone covered appearances ${report.cohorts.evaluationRedZoneCoveredAppearances}; unavailable ${report.cohorts.evaluationRedZoneUnavailableAppearances}. Missing PBP/ffopportunity is unavailable, not zero. The red-zone ablation cannot establish a benefit when no training-season facts exist.`,
    "",
    "## Same-cohort evaluation (lower Brier/log loss is better; higher AUC is better)",
    "",
    "| Method | N | Scored | Brier | Log loss | AUC |",
    "|---|---:|---:|---:|---:|---:|",
    row("Model", report.metrics.model),
    ...Object.entries(report.metrics.baselines).map(([label, metric]) => row(`Baseline: ${label}`, metric)),
    ...Object.entries(report.metrics.ablations).map(([label, metric]) => row(`Ablation: ${label}`, metric)),
    "",
    `**Research verdict:** On this reconstructed held-out cohort the model's Brier ${format(report.metrics.model.brierScore)} is below the player-rate baseline ${format(report.metrics.baselines.player.brierScore)}. But removing the defensive family yields Brier ${format(report.metrics.ablations.withoutDefense.brierScore)}, so these defensive features have not demonstrated incremental scoring-TD value. The red-zone family was excluded for lack of verified training coverage; the without-red-zone row is intentionally identical. These measurements do not establish genuinely archived point-in-time availability, future accuracy, or approval to publish.`,
    "",
    "## Observed calibration by predicted probability decile",
    "",
    "| Decile | N | Mean predicted | Observed scored |",
    "|---|---:|---:|---:|",
    ...report.metrics.model.reliability.map((bin) =>
      `| ${bin.bin} | ${bin.count} | ${format(bin.meanPrediction)} | ${format(bin.observedRate)} |`),
    "",
    "## Coverage by position",
    "",
    "| Position | Evaluated appearances | Scored | Mean predicted |",
    "|---|---:|---:|---:|",
    ...byPosition,
    "",
    "## Week coverage and observed scoring-rate uncertainty",
    "",
    "Wilson intervals are descriptive, not confidence bounds on future model accuracy.",
    "",
    "| Season/week | Evaluated appearances | Observed rate | Approx. 95% interval |",
    "|---|---:|---:|---:|",
    ...byWeek,
    "",
    "WR1 is ranked by strictly prior team WR targets at each earlier cutoff; opponent WR1/other-WR rates are team-defense proxies, not named CB coverage. No individual WR–CB assignment is available.",
    "Expected-TD ffopportunity is excluded: no licensed, uniquely matched, timestamped historical weekly releases were preserved. No invented red-zone zeros or postgame xTD inputs are used.",
    "Live publication remains blocked by complete independently timestamped roster/team, injury/availability, depth/participation and source-publication evidence, plus a qualified calibration verdict and operational approval. Existing yardage simulations and Phase 6 models are unchanged.",
    "",
  ].join("\n");
  await mkdir(path, { recursive: true });
  await writeFile(resolve(path, "gridline-player-td-evaluation.json"), `${JSON.stringify({ report, provenance }, null, 2)}\n`);
  await writeFile(resolve(path, "gridline-player-td-evaluation.md"), markdown);
  process.stdout.write(JSON.stringify({ inputHash: report.inputHash, cohorts: report.cohorts, metrics: report.metrics.model }) + "\n");
}

void main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
}).finally(() => pool.end());