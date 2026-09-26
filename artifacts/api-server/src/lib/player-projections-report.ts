import type {
  IndependentPlayerProjectionReport,
  PlayerProjectionFamily,
  PlayerProjectionReport,
} from "./player-projections";

function number(value: number | null, digits = 3) {
  return value === null ? "—" : value.toFixed(digits);
}

function interval(value: [number, number] | null) {
  return value ? `[${number(value[0])}, ${number(value[1])}]` : "insufficient sample";
}

function percent(value: number | null) {
  return value === null ? "—" : `${(value * 100).toFixed(1)}%`;
}

const FAMILY_ORDER: PlayerProjectionFamily[] = [
  "qbPassingYards",
  "rbRushingYards",
  "receiverReceivingYards",
  "receiverReceptions",
];

export function renderPlayerProjectionMarkdown(report: PlayerProjectionReport) {
  const lines = [
    "# Gridline Player Projection Baseline",
    "",
    `**Status:** ${report.evaluationKind.replaceAll("_", " ")} — not live projections  `,
    `**Generated:** ${report.generatedAt}  `,
    `**Training seasons:** ${report.config.trainingSeasons.join(", ")}  `,
    `**Chronological evaluation season:** ${report.config.evaluationSeason}  `,
    `**Prediction cutoff:** ${report.config.predictionCutoff}  `,
    `**Model version:** ${report.version}`,
    "",
    report.provenance.scheduleTimeMode === "schedule_kickoff"
      ? "This evaluation uses authentic completed 2024 NFL regular-season player stat rows, reconstructing each prediction from rows whose scheduled kickoff is strictly earlier than the target game's kickoff. Predictions below are historical simulations; they are not current or upcoming-game advice."
      : "This evaluation uses authentic completed 2024 NFL regular-season player stat rows. The development schedule table is empty, so team-game source dates provide a conservative calendar-date boundary; all evidence from the target date is withheld and exact kickoff times remain unavailable. Predictions below are historical simulations, not current or upcoming-game advice.",
    "",
    "## Results",
    "",
    "| Family | Train rows | Eligible 2024 | Eligible players | Availability | Overall model MAE (95% CI) | Model RMSE | Bias |",
    "|---|---:|---:|---:|---:|---:|---:|---:|",
  ];
  for (const family of FAMILY_ORDER) {
    const result = report.families[family];
    lines.push(
      `| ${result.label} | ${result.trainingSamples} | ${result.eligiblePredictions}/${result.evaluationCandidates} | ${result.eligiblePlayers}/${result.evaluationCandidatePlayers} | ${percent(result.predictionAvailability)} | ${number(result.metrics.meanAbsoluteError)} (${interval(result.metrics.meanAbsoluteError95CI)}) | ${number(result.metrics.rootMeanSquaredError)} | ${number(result.metrics.meanBias)} |`,
    );
  }
  lines.push(
    "",
    "## Paired baseline comparisons",
    "",
    "Overall model metrics above use all eligible predictions. Each comparison below uses only evaluation rows where that baseline is available; the baseline and paired-model columns are scored on the exact same player-games. Do not compare a paired baseline MAE with the all-prediction overall model MAE above.",
    "",
    "| Family | Baseline | Baseline N | Paired model N | Baseline MAE | Model MAE on same rows |",
    "|---|---|---:|---:|---:|---:|",
  );
  const baselineRows = [
    ["Last 3 appearances", "last3AppearanceMean"],
    ["Last 5 appearances", "last5AppearanceMean"],
    ["Season to date", "seasonToDateMean"],
  ] as const;
  for (const family of FAMILY_ORDER) {
    const result = report.families[family];
    for (const [label, key] of baselineRows) {
      const comparison = result.baselines[key];
      lines.push(
        `| ${result.label} | ${label} | ${comparison.baseline.sampleSize} | ${comparison.modelOnSameCohort.sampleSize} | ${number(comparison.baseline.meanAbsoluteError)} | ${number(comparison.modelOnSameCohort.meanAbsoluteError)} |`,
      );
    }
  }
  lines.push(
    "",
    "Metric confidence intervals are descriptive normal-approximation 95% intervals over per-player-game absolute errors, squared errors, and signed errors. They quantify uncertainty in the measured mean metric, not uncertainty for an individual forecast. Missing target rows are not synthesized as zero production.",
    "Bias is projected statistic minus actual statistic; positive values indicate overprediction. RMSE intervals are obtained by transforming the interval for mean squared error.",
    "Prediction availability is eligible predictions divided by matched 2024 player-game rows with a recorded target statistic; player IDs counted as eligible are unique GSIS IDs within the family, not a complete active-roster count.",
    "",
    "## Model and feature configuration",
    "",
    `${report.modelMethod.name}: ${report.modelMethod.description}`,
    "",
    `Minimum prior appearances: **${report.config.minimumPriorAppearances}**. Recent player production is calculated over the prior 3, 5, and 8 recorded appearances where enough history exists. Same-season means, volume/efficiency, team pass rate, opponent defensive EPA allowed, and team rest are included only when their source rows precede the target cutoff.`,
    "",
    "Continuous features are standardized from training examples only; missing-feature indicators are fitted separately. Each market family is trained independently on 2021–2023. Usage bands use prior target-relevant volume terciles estimated only from the training split.",
    "",
    "### Usage-level holdout results",
    "",
    "| Family | Usage band | Thresholds from training | N | Model MAE | Last-3 MAE |",
    "|---|---|---|---:|---:|---:|",
  );
  for (const family of FAMILY_ORDER) {
    for (const band of report.families[family].usageStrata) {
      const range = band.trainingVolumeRange.map((value) => number(value, 2)).join("–");
      lines.push(`| ${report.families[family].label} | ${band.band} | ${range} | ${band.sampleSize} | ${number(band.modelMae)} | ${number(band.last3BaselineMae)} |`);
    }
  }
  lines.push(
    "",
    "## Source coverage and reproducibility",
    "",
    `- Development database only; raw player-stat rows: **${report.provenance.rawPlayerStatRows}**; schedule-reconciled player-game rows: **${report.provenance.reconciledPlayerGameRows}**.`,
    `- Schedule-time mode: **${report.provenance.scheduleTimeMode}**; ${report.provenance.matchedScheduleGames} player-matched games from ${report.provenance.scheduleGames} schedule/proxy-game rows; lagged team-game rows: **${report.provenance.teamGameRows}**.`,
    `- Player-stat rows without a unique schedule/team/opponent match: **${report.provenance.excludedUnmatchedOrAmbiguousPlayerRows}**; schedule rows excluded as non-final: **${report.provenance.excludedNonFinalScheduleRows}**.`,
    `- Matched player-game rows by season: ${Object.entries(report.provenance.seasonCoverage).map(([season, count]) => `${season}: ${count}`).join("; ")}.`,
    `- Input SHA-256: \`${report.provenance.checksumSha256}\`.`,
    `- Source tables: ${report.provenance.sourceDatasets.join("; ")}.`,
    `- ${report.provenance.historicalTimestampCaveat}`,
    "",
    "The source table records an import/update timestamp but does not supply an independently verified historical publication timestamp for every stat line. This report therefore enforces game-time chronology and labels its outputs historical simulations; it does not claim that the original source publication itself was captured before every 2024 cutoff.",
    "",
    "## Historical projection examples",
    "",
    "Every row below is a genuine historical 2024 simulation. The calculation timestamp is one millisecond before its reported schedule-time boundary; for the date-only fallback it is before the start of the game date, with all same-day evidence withheld. No row is a live projection.",
    "",
    "| Family | Player | Matchup | Game date / kickoff | Cutoff | Basis | Projection | Actual | Prior appearances | Quality | Warnings |",
    "|---|---|---|---|---|---|---:|---:|---:|---|---|",
  );
  for (const family of FAMILY_ORDER) {
    const examples = report.predictions.filter((prediction) => prediction.family === family).slice(0, 3);
    for (const prediction of examples) {
      lines.push(
        `| ${report.families[family].label} | ${prediction.player} (${prediction.playerId}) | ${prediction.team} vs ${prediction.opponent} | ${prediction.gameDate} / ${prediction.kickoffTime ?? "kickoff unavailable"} | ${prediction.calculationTimestamp} | ${prediction.cutoffBasis} | ${number(prediction.projectedStatistic)} | ${number(prediction.actualStatistic)} | ${prediction.historicalSampleQuality.priorAppearances} | ${prediction.historicalSampleQuality.label} | ${prediction.missingDataWarnings.join("; ") || "none"} |`,
      );
    }
  }
  lines.push("", "## Limitations", "", ...report.modelMethod.limitations.map((limitation) => `- ${limitation}`));
  return lines.join("\n");
}

export function renderIndependentPlayerProjectionMarkdown(report: IndependentPlayerProjectionReport) {
  const lines = [
    "# Gridline Player Projection Independent Validation",
    "",
    `**Status:** frozen-model independent validation — historical outcomes only  `,
    `**Generated:** ${report.generatedAt}  `,
    `**Frozen baseline:** ${report.baseline.version}  `,
    `**Frozen baseline report SHA-256:** \`${report.baseline.reportSha256}\`  `,
    `**Frozen training seasons:** ${report.baseline.config.trainingSeasons.join(", ")}; minimum prior appearances: ${report.baseline.config.minimumPriorAppearances}; ridge penalty: ${report.baseline.config.ridgePenalty}  `,
    `**Frozen feature definitions:** ${report.baseline.featureNames.join(", ")}  `,
    `**Evaluation seasons:** ${report.evaluationSeasons.join(", ")}`,
    "",
    "This report applies the original 2021–2023 fitted parameters without refitting to completed 2025 and 2026 regular-season player games. It is an independent holdout evaluation, not a live projection or betting recommendation.",
    "",
    "## Results by holdout season",
    "",
    "| Family | Season | Eligible / candidates | Players | Availability | Model MAE | RMSE | Bias |",
    "|---|---:|---:|---:|---:|---:|---:|---:|",
  ];
  for (const family of FAMILY_ORDER) {
    const result = report.families[family];
    for (const season of report.evaluationSeasons) {
      const evaluation = result.evaluations[String(season) as "2025" | "2026"];
      lines.push(`| ${result.label} | ${season} | ${evaluation.eligiblePredictions} / ${evaluation.evaluationCandidates} | ${evaluation.eligiblePlayers} / ${evaluation.evaluationCandidatePlayers} | ${percent(evaluation.predictionAvailability)} | ${number(evaluation.metrics.meanAbsoluteError)} | ${number(evaluation.metrics.rootMeanSquaredError)} | ${number(evaluation.metrics.meanBias)} |`);
    }
  }
  lines.push(
    "",
    "## Retained 2024 comparison",
    "",
    "The 2024 values below are read from the unchanged frozen baseline report, not recalculated on the recovered data. Different season cohorts and schedule-time quality mean changes in MAE are descriptive, not a head-to-head significance test.",
    "",
    "| Family | 2024 eligible / MAE / RMSE / bias | 2025 eligible / MAE / RMSE / bias | 2026 eligible / MAE / RMSE / bias |",
    "|---|---|---|---|",
  );
  for (const family of FAMILY_ORDER) {
    const result = report.families[family];
    const retained = report.baseline.retained2024[family];
    const summary = (eligible: number, metric: typeof retained.metrics) =>
      `${eligible} / ${number(metric.meanAbsoluteError)} / ${number(metric.rootMeanSquaredError)} / ${number(metric.meanBias)}`;
    lines.push(`| ${result.label} | ${summary(retained.eligiblePredictions, retained.metrics)} | ${summary(result.evaluations["2025"].eligiblePredictions, result.evaluations["2025"].metrics)} | ${summary(result.evaluations["2026"].eligiblePredictions, result.evaluations["2026"].metrics)} |`);
  }
  lines.push(
    "",
    "## Paired baseline comparisons",
    "",
    "Each baseline is compared with the frozen model on exactly the rows where that baseline is available. Last-3, last-5, and season-to-date means are extracted with the same strict chronological feature logic as the original evaluator.",
    "",
    "| Family | Season | Baseline | N | Baseline MAE | Frozen model MAE on same rows |",
    "|---|---:|---|---:|---:|---:|",
  );
  const baselineRows = [
    ["Last 3 appearances", "last3AppearanceMean"],
    ["Last 5 appearances", "last5AppearanceMean"],
    ["Season to date", "seasonToDateMean"],
  ] as const;
  for (const family of FAMILY_ORDER) {
    for (const season of report.evaluationSeasons) {
      const evaluation = report.families[family].evaluations[String(season) as "2025" | "2026"];
      for (const [label, key] of baselineRows) {
        const comparison = evaluation.baselines[key];
        lines.push(`| ${report.families[family].label} | ${season} | ${label} | ${comparison.baseline.sampleSize} | ${number(comparison.baseline.meanAbsoluteError)} | ${number(comparison.modelOnSameCohort.meanAbsoluteError)} |`);
      }
    }
  }
  lines.push(
    "",
    "## Usage strata using frozen training thresholds",
    "",
    "Usage bands use the original frozen model's 2021–2023 training-volume tertiles; no holdout outcomes or holdout quantiles are used to set bands.",
    "",
    "| Family | Season | Band | Frozen training volume range | N | Model MAE | Last-3 MAE |",
    "|---|---:|---|---|---:|---:|---:|",
  );
  for (const family of FAMILY_ORDER) {
    for (const season of report.evaluationSeasons) {
      const strata = report.families[family].evaluations[String(season) as "2025" | "2026"].usageStrata;
      for (const band of strata) {
        const range = band.trainingVolumeRange.map((value) => number(value, 2)).join("–");
        lines.push(`| ${report.families[family].label} | ${season} | ${band.band} | ${range} | ${band.sampleSize} | ${number(band.modelMae)} | ${number(band.last3BaselineMae)} |`);
      }
    }
  }
  lines.push(
    "",
    "## Frozen artifact and leakage assertions",
    "",
    `- All predictions have cutoffs strictly before scheduled kickoff (structural game-time chronology): **${report.leakageChecks.allPredictionsHaveStrictPreKickoffCutoffs}**.`,
    `- All holdout predictions use scheduled UTC kickoffs (structural game-time chronology): **${report.leakageChecks.allPredictionsUseScheduledKickoffs}**.`,
    `- Player and team feature history is strictly earlier than the target cutoff (structural game-time chronology): **${report.leakageChecks.playerAndTeamFeaturesUseOnlyEarlierRows}**.`,
    "",
    "These true flags establish structural ordering against the available game-time fields only; they do not prove when the original stat or schedule sources were published.",
    "",
    "| Family | Frozen model version | Fitted artifact SHA-256 | Training examples SHA-256 | Frozen usage tertiles |",
    "|---|---|---|---|---|",
  );
  for (const family of FAMILY_ORDER) {
    const artifact = report.baseline.modelArtifacts[family];
    lines.push(`| ${family} | ${artifact.modelVersion} | \`${artifact.artifactSha256}\` | \`${artifact.trainingExamplesSha256}\` | ${artifact.trainingUsageVolumeTertiles.map((value) => number(value, 3)).join(", ")} |`);
  }
  lines.push(
    "",
    "## Source coverage and caveats",
    "",
    `- Development database only; raw player-stat rows: **${report.provenance.rawPlayerStatRows}**; reconciled player-game rows: **${report.provenance.reconciledPlayerGameRows}**; lagged team-game rows: **${report.provenance.teamGameRows}**.`,
    `- Schedule rows: **${report.provenance.scheduleGames}**; unique matched player-game schedule IDs: **${report.provenance.matchedScheduleGames}**.`,
    `- Unmatched/ambiguous player rows: **${report.provenance.excludedUnmatchedOrAmbiguousPlayerRows}**; non-final schedule rows excluded: **${report.provenance.excludedNonFinalScheduleRows}**.`,
    `- Raw player-stat rows by season: ${Object.entries(report.provenance.rawSeasonCoverage).map(([season, count]) => `${season}: ${count}`).join("; ")}.`,
    `- Reconciled player-game rows by season: ${Object.entries(report.provenance.seasonCoverage).map(([season, count]) => `${season}: ${count}`).join("; ")}.`,
    `- Schedule time mode by season: ${Object.entries(report.provenance.scheduleTimeModeBySeason).map(([season, mode]) => `${season}: ${mode}`).join("; ")}.`,
    "",
    "### Recovered source ledger",
    "",
    "| Source | Season | URL / run identity | Status | Rows / records | File size | Completed at |",
    "|---|---:|---|---|---:|---:|---|",
  );
  for (const source of report.provenance.sourceLedger.playerStats) {
    lines.push(`| NFLverse player_stats | ${source.season} | ${source.sourceUrl} | ${source.status ?? "not recorded"} | ${source.rowCount} | ${source.fileSizeBytes === null ? "not recorded" : `${source.fileSizeBytes} bytes`} | ${source.completedAt ?? "not recorded"} |`);
  }
  for (const scheduleRun of report.provenance.sourceLedger.espnScheduleRecovery) {
    const records = scheduleRun.recordsProcessed;
    const recordCount = records === null ? "not recorded" : `${records} ${records === 1 ? "record" : "records"}`;
    lines.push(`| ESPN schedule recovery | — | ${scheduleRun.jobKey}; run ${scheduleRun.runId ?? "not recorded"} | ${scheduleRun.status ?? "not recorded"} | ${recordCount} | — | ${scheduleRun.completedAt ?? "not recorded"} |`);
  }
  lines.push(
    "",
    "The source ledger records imported file metadata and the persisted ESPN schedule-recovery runs for the historical recovery and week-3 ATL–GB update. No upstream NFLverse file-content digest was available in the source metadata.",
    "",
    "### Final-game and player-row coverage by season/week",
    "",
    "| Season:week | Explicitly final schedule games | Final games with valid kickoff | Matched player rows |",
    "|---|---:|---:|---:|",
  );
  const coverageKeys = new Set([
    ...Object.keys(report.provenance.finalScheduleGamesBySeasonWeek),
    ...Object.keys(report.provenance.validKickoffGamesBySeasonWeek),
    ...Object.keys(report.provenance.matchedPlayerRowsBySeasonWeek),
  ]);
  for (const key of [...coverageKeys].sort((left, right) => {
    const [leftSeason, leftWeek] = left.split(":").map(Number);
    const [rightSeason, rightWeek] = right.split(":").map(Number);
    return leftSeason! - rightSeason! || leftWeek! - rightWeek!;
  })) {
    const [season, week] = key.split(":").map(Number);
    if (season === 2025 && (week! < 1 || week! > 18)) continue;
    lines.push(`| ${key} | ${report.provenance.finalScheduleGamesBySeasonWeek[key] ?? 0} | ${report.provenance.validKickoffGamesBySeasonWeek[key] ?? 0} | ${report.provenance.matchedPlayerRowsBySeasonWeek[key] ?? 0} |`);
  }
  lines.push(
    "",
    `- Input checksum SHA-256: \`${report.provenance.checksumSha256}\`.`,
    `- Sources: ${report.provenance.sourceDatasets.join("; ")}.`,
    `- ${report.provenance.historicalTimestampCaveat}`,
    "",
    "Only explicit final/complete status qualifies a 2025–2026 schedule game for evaluation; score columns, including 0–0, do not establish finality. Non-final schedule entries are excluded from both scored outcomes and lagged team context. Historical 2021–2024 history may use conservative date-only boundaries. ESPN kickoff timestamps are presently reported scheduled kickoffs normalized to UTC, not independently archived original pregame schedule snapshots. Archived stat source-publication timestamps were not independently verified, so game-time chronology does not prove historical source availability.",
    "",
    "Metric confidence intervals are descriptive normal-approximation intervals; they measure uncertainty in mean metrics, not individual projection uncertainty. Missing target rows are not synthesized as zero production. Player game rows are observed stat lines, not complete roster participation records.",
    "",
    "## Upcoming projection readiness",
    "",
    `**${report.upcomingReadiness.status.replace("_", " ").toUpperCase()}** — no upcoming-game forecasts have been generated or published.`,
    "",
    ...report.upcomingReadiness.reasons.map((reason) => `- ${reason}`),
    "",
    "## Sample validation rows",
    "",
    "| Family | Season | Player | Matchup | Kickoff | Cutoff | Projection | Actual | Prior appearances |",
    "|---|---:|---|---|---|---|---:|---:|---:|",
  );
  for (const family of FAMILY_ORDER) {
    for (const prediction of report.predictions.filter((row) => row.family === family).slice(0, 2)) {
      lines.push(`| ${family} | ${prediction.season} | ${prediction.player} (${prediction.playerId}) | ${prediction.team} vs ${prediction.opponent} | ${prediction.kickoffTime} | ${prediction.calculationTimestamp} | ${number(prediction.projectedStatistic)} | ${number(prediction.actualStatistic)} | ${prediction.priorAppearanceCount} |`);
    }
  }
  return lines.join("\n");
}