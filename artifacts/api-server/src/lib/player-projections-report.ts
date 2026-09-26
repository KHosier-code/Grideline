import type { PlayerProjectionFamily, PlayerProjectionReport } from "./player-projections";

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