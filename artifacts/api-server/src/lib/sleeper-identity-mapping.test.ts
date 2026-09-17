import assert from "node:assert/strict";
import test from "node:test";
import {
  calculateMappingCoverage,
  deduplicateGridlineCandidates,
  deriveDepthRelevantCandidates,
  buildValidationSample,
  mapSleeperPlayer,
  mapSleeperPlayers,
  inferCandidateProviderIdType,
  mappingCandidateFingerprint,
  normalizePlayerName,
  normalizePosition,
  normalizeTeamCode,
  positionCompatibility,
  reconstructLatestSleeperState,
  type GridlineIdentityCandidate,
} from "./sleeper-identity";
import type { SleeperPlayer } from "./sleeper";

function player(overrides: Partial<SleeperPlayer> = {}): SleeperPlayer {
  return {
    player_id: "sl-1",
    full_name: "A.J. Brown",
    first_name: "A.J.",
    last_name: "Brown",
    team: "OAK",
    position: "WR",
    fantasy_positions: ["WR"],
    depth_chart_position: "WR",
    depth_chart_order: 1,
    status: "Active",
    injury_status: null,
    practice_participation: null,
    years_exp: 5,
    age: 28,
    provider_ids: { espn_id: 123, gsis_id: "00-001" },
    ...overrides,
  };
}

function candidate(overrides: Partial<GridlineIdentityCandidate> = {}): GridlineIdentityCandidate {
  return {
    gridlinePlayerId: "grid-1",
    name: "A.J. Brown",
    normalizedName: normalizePlayerName("A.J. Brown"),
    normalizedTeam: "LV",
    position: "WR",
    normalizedPosition: "WR",
    externalIds: { gsis_id: "00-001", espn_id: "123" },
    sources: ["players", "historical_depth_charts"],
    sourceCount: 2,
    latestSeason: 2024,
    latestWeek: 22,
    teamCodes: ["LV", "PHI"],
    ...overrides,
  };
}

test("team aliases preserve the source code and normalize OAK to LV", () => {
  assert.deepEqual(normalizeTeamCode("OAK"), {
    originalTeam: "OAK",
    normalizedTeam: "LV",
    method: "legacy_alias",
  });
});

test("personnel team aliases preserve the source code and canonicalize historical labels", () => {
  assert.deepEqual(
    ["SD", "STL", "JAC", "WAS", "WSH"].map((team) => normalizeTeamCode(team)),
    [
      { originalTeam: "SD", normalizedTeam: "LAC", method: "legacy_alias" },
      { originalTeam: "STL", normalizedTeam: "LAR", method: "legacy_alias" },
      { originalTeam: "JAC", normalizedTeam: "JAX", method: "legacy_alias" },
      { originalTeam: "WAS", normalizedTeam: "WSH", method: "legacy_alias" },
      { originalTeam: "WSH", normalizedTeam: "WSH", method: "canonical" },
    ],
  );
});

test("name normalization handles suffixes, apostrophes, hyphens, accents, and initials", () => {
  assert.equal(normalizePlayerName("José O'Neil-Smith Jr."), "jose oneil smith");
  assert.equal(normalizePlayerName("Jean-Pierre"), normalizePlayerName("Jean Pierre"));
  assert.equal(normalizePlayerName("A.J. Brown"), "aj brown");
  assert.equal(normalizePlayerName("AJ Brown"), "aj brown");
});

test("position aliases are conservative", () => {
  assert.equal(normalizePosition("PK"), "K");
  assert.equal(normalizePosition("DE"), "EDGE");
  assert.equal(positionCompatibility("DB", "CB"), "incompatible");
  assert.equal(positionCompatibility("DE", "EDGE"), "compatible");
});

test("exact stable provider ID takes precedence over name matching and allows team changes", () => {
  const result = mapSleeperPlayer(player(), [
    candidate({ gridlinePlayerId: "grid-exact", normalizedTeam: "PHI", teamCodes: ["PHI"] }),
    candidate({
      gridlinePlayerId: "grid-name",
      externalIds: {},
      normalizedTeam: "LV",
      teamCodes: ["LV"],
    }),
  ]);
  assert.equal(result.mappingStatus, "exact_provider_id");
  assert.equal(result.mappedGridlinePlayerId, "grid-exact");
  assert.deepEqual(result.teamChangeEvidence, {
    sleeperTeam: "LV",
    gridlineTeams: ["PHI"],
    explainableByStableIdentity: true,
  });
});

test("conflicting exact provider IDs remain ambiguous even when names agree", () => {
  const result = mapSleeperPlayer(player(), [
    candidate({ gridlinePlayerId: "grid-gsis", externalIds: { gsis_id: "00-001" } }),
    candidate({ gridlinePlayerId: "grid-espn", externalIds: { espn_id: "123" } }),
  ]);
  assert.equal(result.mappingStatus, "ambiguous");
  assert.equal(result.mappedGridlinePlayerId, null);
  assert.equal(result.candidateGridlinePlayerIds.length, 2);
});

test("provider ID inference never fabricates exact IDs from fallback source identifiers", () => {
  assert.equal(inferCandidateProviderIdType("players", "12345"), "espn_id");
  assert.equal(inferCandidateProviderIdType("players", "PHI:aj-brown"), null);
  assert.equal(inferCandidateProviderIdType("player_game_stats", "00-0012345"), "gsis_id");
  assert.equal(inferCandidateProviderIdType("player_game_stats", "BrowA.00"), null);
  assert.equal(inferCandidateProviderIdType("snap_counts", "BrowA00"), "pfr_id");
  assert.equal(inferCandidateProviderIdType("historical_depth_charts", "00-0012345"), "gsis_id");
  assert.equal(inferCandidateProviderIdType("historical_depth_charts", "12345"), null);
  assert.equal(inferCandidateProviderIdType("historical_depth_charts", "PHI:aj-brown"), null);
});

test("same-name candidates without sufficient team evidence remain ambiguous", () => {
  const result = mapSleeperPlayer(player({ provider_ids: {} }), [
    candidate({ gridlinePlayerId: "grid-a", externalIds: {}, normalizedTeam: "BUF", teamCodes: ["BUF"] }),
    candidate({ gridlinePlayerId: "grid-b", externalIds: {}, normalizedTeam: "MIA", teamCodes: ["MIA"] }),
  ]);
  assert.equal(result.mappingStatus, "ambiguous");
  assert.equal(result.mappedGridlinePlayerId, null);
  assert.match(result.ambiguityReason ?? "", /team evidence/i);
});

test("multiple historical sources cannot turn a team mismatch into a supported name match", () => {
  const result = mapSleeperPlayer(player({ provider_ids: {}, team: "LV" }), [
    candidate({
      externalIds: {},
      normalizedTeam: "PHI",
      teamCodes: ["LV", "PHI"],
      sources: ["player_game_stats", "snap_counts"],
      sourceCount: 2,
    }),
  ]);
  assert.equal(result.mappingStatus, "ambiguous");
  assert.equal(result.mappedGridlinePlayerId, null);
  assert.match(result.ambiguityReason ?? "", /latest team evidence/i);
});

test("candidate evidence fingerprints are deterministic and change with evidence", () => {
  const first = candidate();
  const equivalent = {
    ...candidate(),
    sources: [...candidate().sources].reverse(),
    teamCodes: [...candidate().teamCodes].reverse(),
    externalIds: { espn_id: "123", gsis_id: "00-001" },
  };
  assert.equal(mappingCandidateFingerprint([first]), mappingCandidateFingerprint([equivalent]));
  assert.notEqual(
    mappingCandidateFingerprint([first]),
    mappingCandidateFingerprint([{ ...first, normalizedTeam: "BUF" }]),
  );
});

test("duplicate Sleeper mappings to one Gridline target are rejected as collisions", () => {
  const results = mapSleeperPlayers([
    player({ player_id: "sl-a" }),
    player({ player_id: "sl-b", full_name: "A.J. Brown", provider_ids: { gsis_id: "00-001" } }),
  ], [candidate()]);
  assert.equal(results.collisionCount, 1);
  assert.equal(results.mappings.every((mapping) => mapping.mappingStatus === "ambiguous"), true);
  assert.equal(results.mappings.every((mapping) => mapping.mappedGridlinePlayerId === null), true);
});

test("candidate sources deduplicate into one identity while preserving evidence", () => {
  const candidates = deduplicateGridlineCandidates([
    {
      gridlinePlayerId: "00-001",
      name: "A.J. Brown",
      position: "WR",
      team: "PHI",
      source: "historical_depth_charts",
      externalIdType: "gsis_id",
      externalIdValue: "00-001",
      season: 2024,
      week: 22,
    },
    {
      gridlinePlayerId: "00-001",
      name: "A.J. Brown",
      position: "WR",
      team: "TEN",
      source: "snap_counts",
      externalIdType: "gsis_id",
      externalIdValue: "00-001",
      season: 2022,
      week: 10,
    },
  ]);
  assert.equal(candidates.length, 1);
  assert.equal(candidates[0]?.sourceCount, 2);
  assert.deepEqual(candidates[0]?.teamCodes, ["PHI", "TEN"]);
});

test("coverage metrics expose status, depth, aliases, and position dimensions", () => {
  const players = [
    player({ player_id: "one", depth_chart_order: 1 }),
    player({ player_id: "two", full_name: "Nobody Else", provider_ids: {}, depth_chart_order: 2 }),
  ];
  const mappings = [
    mapSleeperPlayer(players[0]!, [candidate()]),
    mapSleeperPlayer(players[1]!, []),
  ];
  const coverage = calculateMappingCoverage(players, mappings, 0);
  assert.equal(coverage.totalSleeperRows, 2);
  assert.equal(coverage.mappedCount, 1);
  assert.equal(coverage.depthOrderOne.total, 1);
  assert.equal(coverage.teamAliasNormalizationCount, 2);
  assert.equal(coverage.byPosition.WR.total, 2);
  assert.equal(coverage.suitableForDepthLogic, false);
  assert.equal(coverage.suitabilityVerdict, "SLEEPER MAPPING NOT SUITABLE FOR DEPTH LOGIC");
});

test("depth diagnostics enumerate all 32 canonical teams without choosing starters", () => {
  const players = [player({ player_id: "depth-qb", team: "OAK", position: "QB", depth_chart_position: "QB" })];
  const mapping = mapSleeperPlayer(players[0]!, [candidate({ gridlinePlayerId: "depth-grid", externalIds: {} })]);
  const candidates = deriveDepthRelevantCandidates(players, [mapping]);
  assert.equal(new Set(candidates.map((item) => item.team)).size, 32);
  assert.equal(candidates.find((item) => item.team === "LV")?.role, "QB1");
  assert.equal(buildValidationSample(players, [mapping]).length, 1);
});

test("latest-state reconstruction handles unchanged and partial cycles by capture time", () => {
  const first = new Date("2025-09-01T00:00:00.000Z");
  const second = new Date("2025-09-02T00:00:00.000Z");
  const rows = reconstructLatestSleeperState([
    { sleeperPlayerId: "a", capturedAt: first, id: 1, marker: "old-a" },
    { sleeperPlayerId: "b", capturedAt: first, id: 2, marker: "old-b" },
    { sleeperPlayerId: "a", capturedAt: second, id: 3, marker: "new-a" },
    { sleeperPlayerId: "future", capturedAt: new Date("2025-09-03T00:00:00.000Z"), id: 4, marker: "future" },
  ], second);
  assert.deepEqual(rows.map((row) => [row.sleeperPlayerId, row.marker]), [
    ["a", "new-a"],
    ["b", "old-b"],
  ]);
});