export type MatchupEdge = "home" | "away" | "neutral" | "insufficient";
export type MatchupConfidence = "high" | "medium" | "low" | "unavailable";

export type MatchupMetric = {
  label: string;
  homeValue: number | null;
  awayValue: number | null;
  unit: "rate" | "seconds" | "score";
  higherIsBetter: boolean;
};

export type MatchupAssessment = {
  category: string;
  title: string;
  edge: MatchupEdge;
  edgeLabel: string;
  confidence: MatchupConfidence;
  strength: number | null;
  metrics: MatchupMetric[];
  explanation: string;
  coverage: string;
  limitations: string[];
};

type TeamEvidence = {
  features: Record<string, number | null>;
  sampleCounts: Record<string, number>;
};

type PersonnelTeam = {
  side: "home" | "away";
  qbCertainty: number | null;
  qbChange: boolean | null;
  qbEvidenceAvailable: boolean;
  personnelCompleteness: number | null;
  offenseInjuryImpact: number | null;
  defenseInjuryImpact: number | null;
  injuryEvidenceAvailable: boolean;
  depth: Array<{ position: string; unit: "offense" | "defense" | "special_teams"; role: string; recentSnapShare: number | null }>;
};

const MIN_GAMES = 3;

function evidence(team: TeamEvidence | null, key: string) {
  const featureKey = `season_to_date.${key}`;
  const value = team?.features[featureKey];
  const samples = team?.sampleCounts[featureKey] ?? 0;
  return {
    value: typeof value === "number" && Number.isFinite(value) && samples >= MIN_GAMES ? value : null,
    samples,
  };
}

function confidenceFor(samples: number, values: Array<number | null>): MatchupConfidence {
  if (values.some((value) => value === null)) return "unavailable";
  if (samples >= 8) return "high";
  if (samples >= 5) return "medium";
  return samples >= MIN_GAMES ? "low" : "unavailable";
}

function comparison(
  category: string,
  title: string,
  homeValue: number | null,
  awayValue: number | null,
  homeSamples: number,
  awaySamples: number,
  metric: Omit<MatchupMetric, "homeValue" | "awayValue">,
  explanation: string,
  limitations: string[] = [],
): MatchupAssessment {
  const confidence = confidenceFor(Math.min(homeSamples, awaySamples), [homeValue, awayValue]);
  if (confidence === "unavailable") {
    return {
      category, title, edge: "insufficient", edgeLabel: "Insufficient data", confidence, strength: null,
      metrics: [{ ...metric, homeValue, awayValue }], explanation,
      coverage: `Home ${homeSamples} games · Away ${awaySamples} games`,
      limitations: [...limitations, "At least three cutoff-safe games with valid denominators are required for each team."],
    };
  }
  const difference = (homeValue as number) - (awayValue as number);
  const oriented = metric.higherIsBetter ? difference : -difference;
  const threshold = metric.unit === "seconds" ? 0.5 : metric.unit === "rate" ? 0.015 : 3;
  const edge: MatchupEdge = Math.abs(oriented) < threshold ? "neutral" : oriented > 0 ? "home" : "away";
  return {
    category, title, edge,
    edgeLabel: edge === "home" ? "Home team edge" : edge === "away" ? "Away team edge" : "No clear edge",
    confidence,
    strength: edge === "neutral" ? 0 : Math.min(100, Math.round(Math.abs(oriented) / threshold * 20)),
    metrics: [{ ...metric, homeValue, awayValue }],
    explanation,
    coverage: `Home ${homeSamples} games · Away ${awaySamples} games`,
    limitations,
  };
}

function unavailable(category: string, title: string, explanation: string, reason: string): MatchupAssessment {
  return {
    category, title, edge: "insufficient", edgeLabel: "Insufficient data", confidence: "unavailable",
    strength: null, metrics: [], explanation, coverage: "Verified evidence unavailable", limitations: [reason],
  };
}

function personnelComparison(
  category: string,
  title: string,
  homeValue: number,
  awayValue: number,
  higherIsBetter: boolean,
  completeness: number,
  label: string,
  explanation: string,
  limitations: string[] = [],
): MatchupAssessment {
  const difference = (homeValue - awayValue) * (higherIsBetter ? 1 : -1);
  const edge: MatchupEdge = Math.abs(difference) < 3 ? "neutral" : difference > 0 ? "home" : "away";
  const confidence: MatchupConfidence = completeness >= 85 ? "high" : completeness >= 70 ? "medium" : "low";
  return {
    category, title, edge,
    edgeLabel: edge === "home" ? "Home team edge" : edge === "away" ? "Away team edge" : "No clear edge",
    confidence,
    strength: edge === "neutral" ? 0 : Math.min(100, Math.round(Math.abs(difference) / 3 * 20)),
    metrics: [{ label, homeValue, awayValue, unit: "score", higherIsBetter }],
    explanation,
    coverage: "Point-in-time personnel context for both teams",
    limitations,
  };
}

export function buildConsumerMatchupBoard(input: {
  homeEvidence: TeamEvidence | null;
  awayEvidence: TeamEvidence | null;
  personnelTeams: PersonnelTeam[];
  homeName: string;
  awayName: string;
  sourceCutoff: Date;
}) {
  const { homeEvidence, awayEvidence, personnelTeams, homeName, awayName } = input;
  const h = (key: string) => evidence(homeEvidence, key);
  const a = (key: string) => evidence(awayEvidence, key);
  const blend = (offense: number | null, defense: number | null) =>
    offense === null || defense === null ? null : (offense + defense) / 2;
  const samples = (...items: Array<{ samples: number }>) => Math.min(...items.map((item) => item.samples));
  const rate = (label: string, higherIsBetter = true) => ({ label, unit: "rate" as const, higherIsBetter });
  const hp = h("pass_epa_per_dropback"); const ap = a("pass_epa_per_dropback");
  const hpa = h("pass_epa_allowed"); const apa = a("pass_epa_allowed");
  const hr = h("rush_epa_per_rush"); const ar = a("rush_epa_per_rush");
  const hra = h("rush_epa_allowed"); const ara = a("rush_epa_allowed");
  const hsa = h("sack_rate_allowed"); const asa = a("sack_rate_allowed");
  const hds = h("defensive_sack_rate"); const ads = a("defensive_sack_rate");
  const he = h("explosive_pass_rate"); const ae = a("explosive_pass_rate");
  const hea = h("explosive_pass_rate_allowed"); const aea = a("explosive_pass_rate_allowed");
  const hz = h("red_zone_touchdown_rate"); const az = a("red_zone_touchdown_rate");
  const ht = h("neutral_script_pass_rate"); const at = a("neutral_script_pass_rate");
  const hpace = h("seconds_per_play"); const apace = a("seconds_per_play");
  const assessments: MatchupAssessment[] = [
    comparison("passing", "Passing offense vs pass defense",
      blend(hp.value, apa.value), blend(ap.value, hpa.value),
      samples(hp, apa), samples(ap, hpa), rate("Blended pass EPA / dropback"),
      "Compares each passing offense with the opposing pass defense using prior-game EPA efficiency."),
    comparison("rushing", "Rushing offense vs rush defense",
      blend(hr.value, ara.value), blend(ar.value, hra.value),
      samples(hr, ara), samples(ar, hra), rate("Blended rush EPA / carry"),
      "Compares each rushing offense with the opposing rush defense using prior-game EPA efficiency."),
    unavailable("wr_secondary", "WR room vs secondary", "Describes supported room-level availability only.", "Persisted evidence does not verify coverage assignments or a complete position-room efficiency comparison."),
    unavailable("te_second_level", "TE usage vs LB/S context", "Describes supported unit context without assigning defenders.", "Persisted evidence does not provide verified TE-versus-LB/S assignment outcomes."),
    comparison("ol_pass_rush", "OL vs pass rush",
      blend(hsa.value, ads.value), blend(asa.value, hds.value),
      samples(hsa, ads), samples(asa, hds), rate("Blended sack rate", false),
      "Compares offensive sack rate allowed with the opposing defense’s sack rate.",
      ["This is a unit-level rate comparison and does not infer individual blocking or rush assignments."]),
    comparison("explosive", "Explosive-play environment",
      blend(he.value, aea.value), blend(ae.value, hea.value),
      samples(he, aea), samples(ae, hea), rate("Blended explosive pass rate"),
      "Combines each offense’s explosive-pass rate with the opposing defense’s rate allowed."),
    comparison("red_zone", "Red-zone matchup", hz.value, az.value,
      hz.samples, az.samples, rate("Offensive red-zone rate"),
      "Compares supported offensive red-zone rates; opponent red-zone defense is not available in the persisted team-game source.",
      ["Defensive red-zone rate is unsupported, so this is not a complete offense-versus-defense comparison."]),
    comparison("pace_tendency", "Pace / pass tendency",
      ht.value, at.value, ht.samples, at.samples,
      rate("Neutral-script pass rate"), "Compares neutral-script pass tendency from prior games.",
      ["Pace is shown in the expanded evidence when available; pass tendency determines the displayed edge."]),
  ];

  const homePersonnel = personnelTeams.find((team) => team.side === "home");
  const awayPersonnel = personnelTeams.find((team) => team.side === "away");
  const personnelReady = Boolean(
    homePersonnel
    && awayPersonnel
    && homePersonnel.personnelCompleteness !== null
    && awayPersonnel.personnelCompleteness !== null,
  );
  const personnelCompleteness = Math.min(homePersonnel?.personnelCompleteness ?? 0, awayPersonnel?.personnelCompleteness ?? 0);
  assessments.splice(5, 0, personnelReady
    && homePersonnel?.qbEvidenceAvailable && awayPersonnel?.qbEvidenceAvailable
    && homePersonnel?.qbCertainty !== null && awayPersonnel?.qbCertainty !== null
    ? personnelComparison("qb_stability", "QB stability",
        homePersonnel!.qbCertainty!, awayPersonnel!.qbCertainty!, true, personnelCompleteness, "Starter certainty",
        "Compares point-in-time starter certainty and flags supported quarterback changes.",
        [homePersonnel?.qbChange ? `${homeName} has a supported quarterback change.` : "", awayPersonnel?.qbChange ? `${awayName} has a supported quarterback change.` : ""].filter(Boolean))
    : unavailable("qb_stability", "QB stability", "Compares point-in-time quarterback starter certainty.", "Both teams need supported pregame personnel context."));
  const injuryValues = personnelReady
    && homePersonnel?.injuryEvidenceAvailable && awayPersonnel?.injuryEvidenceAvailable
    && homePersonnel?.offenseInjuryImpact !== null && homePersonnel?.defenseInjuryImpact !== null
    && awayPersonnel?.offenseInjuryImpact !== null && awayPersonnel?.defenseInjuryImpact !== null;
  assessments.splice(6, 0, injuryValues
    ? personnelComparison("injury_burden", "Injury burden",
        homePersonnel!.offenseInjuryImpact! + homePersonnel!.defenseInjuryImpact!,
        awayPersonnel!.offenseInjuryImpact! + awayPersonnel!.defenseInjuryImpact!,
        false, personnelCompleteness, "Supported injury impact",
        "Compares supported offense and defense injury-impact evidence as of the cutoff.")
    : unavailable("injury_burden", "Injury burden", "Compares supported injury-impact evidence.", "Both teams need supported pregame personnel context."));

  const pace = assessments.find((item) => item.category === "pace_tendency");
  if (pace) {
    pace.metrics.push({
      label: "Seconds per play",
      homeValue: hpace.value,
      awayValue: apace.value,
      unit: "seconds",
      higherIsBetter: false,
    });
    pace.explanation = "Compares neutral-script pass tendency, with prior-game seconds per play shown as pace context.";
    pace.limitations = hpace.value === null || apace.value === null
      ? ["Pace requires at least three valid cutoff-safe observations for each team."]
      : [];
  }

  const supported = assessments.filter((item) => (item.edge === "home" || item.edge === "away") && item.confidence !== "unavailable" && item.strength !== null);
  const summary = [...supported].sort((left, right) => (right.strength ?? 0) - (left.strength ?? 0)).slice(0, 3).map((item) => ({
    category: item.category,
    title: item.title,
    edge: item.edge,
    label: item.edge === "home" ? homeName : awayName,
    evidence: item.metrics[0]?.label ?? item.explanation,
    caveat: "Descriptive matchup evidence only; this does not change the Gridline prediction.",
  }));
  const available = assessments.filter((item) => item.edge !== "insufficient").length;
  return {
    status: available === assessments.length ? "available" as const : available ? "partial" as const : "unavailable" as const,
    sourceCutoff: input.sourceCutoff.toISOString(),
    completeness: { supportedCategories: available, totalCategories: assessments.length },
    sources: ["Gridline immutable pregame team features (nflverse play-by-play)", ...(personnelReady ? ["Gridline point-in-time personnel context"] : [])],
    methodology: "Only immutable persisted evidence generated strictly before the game cutoff is used. Categories require valid denominators and at least three prior games.",
    summary,
    assessments,
  };
}