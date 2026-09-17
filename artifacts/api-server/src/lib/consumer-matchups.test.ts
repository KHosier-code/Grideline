import test from "node:test";
import assert from "node:assert/strict";
import { buildConsumerMatchupBoard } from "./consumer-matchups";

const evidence = (overrides: Record<string, number | null> = {}, sampleOverrides: Record<string, number> = {}) => {
  const values = {
    pass_epa_per_dropback: 0.2, rush_epa_per_rush: 0.05, pass_epa_allowed: -0.05, rush_epa_allowed: 0.01,
    sack_rate_allowed: 0.04, defensive_sack_rate: 0.08, explosive_pass_rate: 0.12,
    explosive_pass_rate_allowed: 0.09, red_zone_touchdown_rate: 0.6, neutral_script_pass_rate: 0.6,
    ...overrides,
  };
  return {
    features: Object.fromEntries(Object.entries(values).map(([key, value]) => [`season_to_date.${key}`, value])),
    sampleCounts: Object.fromEntries(Object.keys(values).map((key) => [`season_to_date.${key}`, sampleOverrides[key] ?? 5])),
  };
};

const personnel = [
  { side: "home" as const, qbCertainty: 85, qbChange: false, qbEvidenceAvailable: true, personnelCompleteness: 90, offenseInjuryImpact: 5, defenseInjuryImpact: 8, injuryEvidenceAvailable: true, depth: [] },
  { side: "away" as const, qbCertainty: 65, qbChange: true, qbEvidenceAvailable: true, personnelCompleteness: 80, offenseInjuryImpact: 20, defenseInjuryImpact: 15, injuryEvidenceAvailable: true, depth: [] },
];

test("matchup board identifies supported directional edges without predictions", () => {
  const board = buildConsumerMatchupBoard({
    homeEvidence: evidence(),
    awayEvidence: evidence({ pass_epa_per_dropback: -0.15, pass_epa_allowed: 0.2, red_zone_touchdown_rate: 0.4 }),
    personnelTeams: personnel, homeName: "HME", awayName: "AWY", sourceCutoff: new Date("2026-09-20T17:00:00Z"),
  });
  assert.equal(board.assessments.length, 10);
  assert.equal(board.assessments.find((item) => item.category === "passing")?.edge, "home");
  assert.equal(board.assessments.find((item) => item.category === "wr_secondary")?.edge, "insufficient");
  assert.ok(board.summary.every((item) => item.caveat.includes("does not change")));
  assert.doesNotMatch(JSON.stringify(board), /\bbet\b|betting|wager|recommendation/i);
});

test("sparse and missing denominator evidence stays insufficient instead of zero", () => {
  const board = buildConsumerMatchupBoard({
    homeEvidence: evidence({}, { pass_epa_per_dropback: 2 }),
    awayEvidence: evidence({ pass_epa_allowed: null }),
    personnelTeams: [], homeName: "HME", awayName: "AWY", sourceCutoff: new Date("2026-09-20T17:00:00Z"),
  });
  const passing = board.assessments.find((item) => item.category === "passing");
  assert.equal(passing?.edge, "insufficient");
  assert.equal(passing?.strength, null);
  assert.equal(passing?.metrics[0]?.homeValue, null);
  assert.equal(board.assessments.find((item) => item.category === "qb_stability")?.confidence, "unavailable");
});

test("assessment source cutoff is serialized exactly", () => {
  const cutoff = new Date("2026-09-20T16:59:59.999Z");
  const board = buildConsumerMatchupBoard({
    homeEvidence: null, awayEvidence: null, personnelTeams: [], homeName: "HME", awayName: "AWY", sourceCutoff: cutoff,
  });
  assert.equal(board.sourceCutoff, cutoff.toISOString());
  assert.equal(board.status, "unavailable");
});

test("missing injury values never become a zero-burden edge", () => {
  const board = buildConsumerMatchupBoard({
    homeEvidence: evidence(), awayEvidence: evidence(),
    personnelTeams: [
      { ...personnel[0], offenseInjuryImpact: null },
      personnel[1],
    ],
    homeName: "HME", awayName: "AWY", sourceCutoff: new Date("2026-09-20T17:00:00Z"),
  });
  const injury = board.assessments.find((item) => item.category === "injury_burden");
  assert.equal(injury?.edge, "insufficient");
  assert.equal(injury?.metrics.length, 0);
});

test("confidence and coverage use valid per-metric samples", () => {
  const board = buildConsumerMatchupBoard({
    homeEvidence: evidence({}, { pass_epa_per_dropback: 3 }),
    awayEvidence: evidence({}, { pass_epa_per_dropback: 4 }),
    personnelTeams: [], homeName: "HME", awayName: "AWY", sourceCutoff: new Date("2026-09-20T17:00:00Z"),
  });
  const passing = board.assessments.find((item) => item.category === "passing");
  assert.equal(passing?.confidence, "low");
  assert.equal(passing?.coverage, "Home 3 games · Away 4 games");
});

test("personnel assessments use point-in-time coverage rather than invented game samples", () => {
  const board = buildConsumerMatchupBoard({
    homeEvidence: evidence(), awayEvidence: evidence(), personnelTeams: personnel,
    homeName: "HME", awayName: "AWY", sourceCutoff: new Date("2026-09-20T17:00:00Z"),
  });
  const qb = board.assessments.find((item) => item.category === "qb_stability");
  assert.equal(qb?.coverage, "Point-in-time personnel context for both teams");
  assert.equal(qb?.confidence, "medium");
  assert.doesNotMatch(qb?.coverage ?? "", /games/);
});

test("pace card returns seconds-per-play context when supported", () => {
  const board = buildConsumerMatchupBoard({
    homeEvidence: evidence({ seconds_per_play: 25 }),
    awayEvidence: evidence({ seconds_per_play: 29 }),
    personnelTeams: [], homeName: "HME", awayName: "AWY", sourceCutoff: new Date("2026-09-20T17:00:00Z"),
  });
  const pace = board.assessments.find((item) => item.category === "pace_tendency");
  assert.equal(pace?.metrics.find((item) => item.label === "Seconds per play")?.homeValue, 25);
});

test("derived zeroes without QB or injury source evidence remain insufficient", () => {
  const board = buildConsumerMatchupBoard({
    homeEvidence: evidence(), awayEvidence: evidence(),
    personnelTeams: [
      { ...personnel[0], qbCertainty: 0, qbEvidenceAvailable: false, offenseInjuryImpact: 0, defenseInjuryImpact: 0, injuryEvidenceAvailable: false },
      personnel[1],
    ],
    homeName: "HME", awayName: "AWY", sourceCutoff: new Date("2026-09-20T17:00:00Z"),
  });
  assert.equal(board.assessments.find((item) => item.category === "qb_stability")?.edge, "insufficient");
  assert.equal(board.assessments.find((item) => item.category === "injury_burden")?.edge, "insufficient");
});