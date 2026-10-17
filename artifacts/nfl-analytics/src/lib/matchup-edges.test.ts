import test from "node:test";
import assert from "node:assert/strict";
import { formatMetric, funnel, ordinal, possessive, unitEdges, type MatchupReport, type MetricCell } from "./matchup-edges.ts";

const c = (rank: number, value = 0.1): MetricCell => ({ rank, value });
const name = (team: string) => ({ BUF: "Buffalo", MIA: "Miami", MIN: "Minnesota", LA: "Los Angeles" }[team] ?? team);

function report(teams: MatchupReport["teams"]): MatchupReport {
  return {
    season: 2026, throughWeek: 6, generatedAt: "2026-10-13T12:00:00Z",
    sources: { playByPlay: 6, ftnCharting: 5, pfrAdvanced: 5, nextGenStats: 6 },
    metrics: [
      { key: "epa_pass", label: "EPA per dropback", group: "Efficiency", format: "num2", offense: "high", defense: "low", help: "" },
      { key: "epa_rush", label: "EPA per rush", group: "Efficiency", format: "num2", offense: "high", defense: "low", help: "" },
      { key: "pressure_rate", label: "Pressure rate", group: "Pass rush", format: "pct", offense: "low", defense: "high", help: "" },
      { key: "blitz_rate", label: "Blitz rate", group: "Pass rush", format: "pct", offense: null, defense: null, help: "" },
      { key: "epa_vs_blitz", label: "EPA vs the blitz", group: "Pass rush", format: "num2", offense: "high", defense: "low", help: "" },
    ],
    league: { season: { offense: {}, defense: {} }, last4: { offense: {}, defense: {} } },
    teams,
  };
}

const side = (offense: Record<string, MetricCell>, defense: Record<string, MetricCell>) =>
  ({ season: { offense, defense }, last4: { offense, defense } });

test("a top offense against a bottom defense is an offense edge, and the reverse a defense edge", () => {
  const r = report([
    { team: "BUF", ...side({ epa_pass: c(3, 0.21), epa_rush: c(28, -0.2) }, {}) },
    { team: "MIA", ...side({}, { epa_pass: c(30, 0.25), epa_rush: c(4, -0.25) }) },
  ]);
  const edges = unitEdges(r, "BUF", "MIA", name);
  assert.equal(edges.length, 2);
  assert.equal(edges[0].favors, "offense");
  assert.equal(edges[0].topic, "Passing game");
  assert.equal(edges[0].strength, 27);
  assert.equal(edges[0].text, "Buffalo's passing game ranks 3rd in EPA per dropback (0.21); Miami's pass defense ranks 30th (0.25).");
  assert.equal(edges[1].text, "Miami's run defense ranks 4th in EPA per rush allowed (-0.25); Buffalo's run game ranks 28th (-0.20).");
  assert.equal(edges[1].favors, "defense");
  assert.equal(edges[1].topic, "Run game");
});

test("middle-of-the-pack ranks are not an edge", () => {
  const r = report([
    { team: "BUF", ...side({ epa_pass: c(11) }, {}) },
    { team: "MIA", ...side({}, { epa_pass: c(32) }) },
  ]);
  assert.deepEqual(unitEdges(r, "BUF", "MIA", name), []);
});

test("blitz-heavy defenses are flagged by how the offense handles the blitz", () => {
  const r = report([
    { team: "BUF", ...side({ epa_vs_blitz: c(26, -0.3) }, {}) },
    { team: "MIN", ...side({}, { blitz_rate: c(1, 0.7) }) },
  ]);
  const [edge] = unitEdges(r, "BUF", "MIN", name);
  assert.equal(edge.favors, "defense");
  assert.equal(edge.topic, "Blitz");
  assert.equal(edge.text, "Minnesota's defense blitzes on 70.0% of dropbacks (1st most); Buffalo's offense ranks 26th in EPA against the blitz (-0.30).");
});

test("schedule abbreviations map onto nflverse codes", () => {
  const r = report([
    { team: "LA", ...side({ epa_pass: c(1, 0.3) }, {}) },
    { team: "MIA", ...side({}, { epa_pass: c(32, 0.3) }) },
  ]);
  assert.equal(unitEdges(r, "LAR", "MIA", name).length, 1);
  assert.deepEqual(unitEdges(r, "XXX", "MIA", name), []);
});

test("funnels need a strong side and a weak side", () => {
  const r = report([
    { team: "MIA", ...side({}, { epa_pass: c(25), epa_rush: c(2) }) },
    { team: "BUF", ...side({}, { epa_pass: c(12), epa_rush: c(15) }) },
  ]);
  assert.equal(funnel(r, "MIA", name)?.kind, "pass");
  assert.equal(funnel(r, "BUF", name), null);
});

test("formatting, possessives and ordinals", () => {
  assert.deepEqual(["Texans", "49ers", "Bills"].map(possessive), ["Texans'", "49ers'", "Bills'"]);
  assert.equal(possessive("Miami"), "Miami's");
  assert.equal(formatMetric(0.3911, "pct"), "39.1%");
  assert.equal(formatMetric(2.714, "sec"), "2.71s");
  assert.equal(formatMetric(null, "num2"), "—");
  assert.deepEqual([1, 2, 3, 4, 11, 12, 13, 21, 22, 23].map(ordinal),
    ["1st", "2nd", "3rd", "4th", "11th", "12th", "13th", "21st", "22nd", "23rd"]);
});
