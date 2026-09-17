export function renderPersonnelComparisonMarkdown(report: any) {
  const number = (value: unknown, digits = 4) => typeof value === "number" ? value.toFixed(digits) : "—";
  const percent = (value: unknown) => typeof value === "number" ? `${(value * 100).toFixed(2)}%` : "—";
  const lines = [
    "# Gridline 2025 Personnel-Aware Challenger Comparison",
    "",
    `**Baseline run:** \`${report.baselineRunId}\`  `,
    "**Training:** 2021–2024 only  ",
    "**Test season:** 2025 only  ",
    "**Personnel chronology:** strictly before kickoff  ",
    "**Tuning, promotion, production-model changes, or production-prediction mutation:** None",
    "",
    "## Family verdicts",
    "",
    "| Family | Paired games | Baseline | Challenger | Raw difference | Improvement | Verdict |",
    "|---|---:|---|---|---|---:|---|",
  ];
  for (const model of report.models) {
    const primary = model.family === "moneyline" ? "logLoss" : "mae";
    const comparison = model.comparison[primary];
    lines.push(`| ${model.family} | ${model.sampleSize} | ${primary} ${number(comparison.baseline)} | ${primary} ${number(comparison.challenger)} | ${number(comparison.difference)} | ${number(comparison.improvementPercent, 2)}% | **${model.verdict}** |`);
  }
  lines.push("", "Paired intervals are descriptive normal-approximation 95% intervals using sample variance. Improve/worse requires at least 30 paired games and the full interval to exceed 1% of the baseline primary metric; otherwise the verdict is no material improvement. No betting threshold was selected from these results.");
  for (const model of report.models) {
    lines.push("", `## ${model.family[0].toUpperCase()}${model.family.slice(1)}`, "", "### Metrics", "");
    lines.push("```json", JSON.stringify({ baseline: model.baseline, challenger: model.challenger, comparison: model.comparison, pairedDelta: model.pairedDelta }, null, 2), "```");
    lines.push("", "### Recorded-market benchmark", "", `The retained benchmark is ${model.recordedMarketBenchmark.designation}.`, "", "```json", JSON.stringify(model.recordedMarketBenchmark, null, 2), "```");
    if (model.market) {
      lines.push("", `Baseline record: ${model.market.baselineRecord.wins}-${model.market.baselineRecord.losses}-${model.market.baselineRecord.pushes} (${model.market.baselineRecord.noBets} no-bets; ${percent(model.market.baselineRecord.winRate)} graded win rate).`);
      lines.push(`Challenger record: ${model.market.challengerRecord.wins}-${model.market.challengerRecord.losses}-${model.market.challengerRecord.pushes} (${model.market.challengerRecord.noBets} no-bets; ${percent(model.market.challengerRecord.winRate)} graded win rate).`);
      lines.push("", "Baseline and challenger edge buckets are retained in the JSON report.");
    } else {
      lines.push("", "Baseline and challenger 10-point calibration buckets are retained in the JSON report.");
    }
  }
  lines.push("", "## Personnel evidence availability and limitations", "", report.personnelEvidence.distinction, "");
  for (const [name, value] of Object.entries(report.personnelEvidence.categories)) {
    const category = value as any;
    lines.push(`### ${name}`, "", `Availability: ${category.availableObservations}/${category.totalObservations} observations (${percent(category.availabilityRate)}).`, ...category.limitations.map((item: string) => `- ${item}`), "");
  }
  lines.push("## Reproducibility and safeguards", "", "- Exact same-game pairing is enforced independently for spread, moneyline, and totals.", "- Personnel source cutoffs must be strictly before kickoff.", "- Output ordering and serialization are deterministic.", "- No tuning, promotion, production-model change, or production-prediction mutation occurred.", "- The comparison remains evaluation-only and does not persist challenger evidence as new database rows.");
  return lines.join("\n");
}