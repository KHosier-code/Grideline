import assert from "node:assert/strict";
import test from "node:test";
import {
  calculateMappingCoverage,
  applyVerifiedPlayerCrosswalks,
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
import {
  canonicalNflverseRowsHash,
  deriveSleeperCrosswalks,
  parseNflversePlayersCsv,
  typedNflverseCrosswalks,
} from "./nflverse-players";

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
    crosswalkExternalIds: {},
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
  assert.equal(inferCandidateProviderIdType("players", "12345"), null);
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
  assert.equal(results.detectedCollisionCount, 1);
  assert.equal(results.collisionCount, 1);
  assert.equal(results.mappings.every((mapping) => mapping.mappingStatus === "ambiguous"), true);
  assert.equal(results.mappings.every((mapping) => mapping.mappedGridlinePlayerId === null), true);
});

test("rejected duplicate identities outside depth rows do not block depth suitability", () => {
  const results = mapSleeperPlayers([
    player({ player_id: "sl-a", depth_chart_order: null }),
    player({ player_id: "sl-b", depth_chart_order: null }),
  ], [candidate()]);
  assert.equal(results.detectedCollisionCount, 1);
  assert.equal(results.collisionCount, 0);
});

test("provider identity accepts common first-name variants but rejects different people", () => {
  const michael = candidate({ name: "Michael Jackson", normalizedName: normalizePlayerName("Michael Jackson") });
  assert.equal(mapSleeperPlayer(player({ full_name: "Mike Jackson" }), [michael]).mappingStatus, "exact_provider_id");
  assert.equal(
    mapSleeperPlayer(player({ full_name: "Isaiah Searight" }), [candidate({ name: "Quinnen Williams" })]).mappingStatus,
    "ambiguous",
  );
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

test("verified provider crosswalks collapse ESPN and PFR records into the GSIS identity", () => {
  const candidates = [
    candidate({
      gridlinePlayerId: "00-001",
      externalIds: { gsis_id: "00-001" },
      sources: ["player_game_stats"],
      sourceCount: 1,
    }),
    candidate({
      gridlinePlayerId: "123",
      externalIds: { espn_id: "123" },
      sources: ["players"],
      sourceCount: 1,
    }),
    candidate({
      gridlinePlayerId: "BrowAJ00",
      externalIds: { pfr_id: "BrowAJ00" },
      sources: ["snap_counts"],
      sourceCount: 1,
    }),
  ];
  const result = applyVerifiedPlayerCrosswalks(candidates, [{
    displayName: "A.J. Brown",
    position: "WR",
    latestTeam: "PHI",
    providerIds: { gsis_id: "00-001", espn_id: "123", pfr_id: "BrowAJ00" },
  }]);
  assert.equal(result.candidates.length, 1);
  assert.equal(result.candidates[0]?.gridlinePlayerId, "00-001");
  assert.deepEqual(result.candidates[0]?.externalIds, {
    gsis_id: "00-001",
    espn_id: "123",
    pfr_id: "BrowAJ00",
  });
  assert.deepEqual(result.candidates[0]?.crosswalkExternalIds, {
    espn_id: "123",
    pfr_id: "BrowAJ00",
  });
});

test("duplicate crosswalk provider IDs remain fail-closed", () => {
  const result = applyVerifiedPlayerCrosswalks([candidate()], [
    {
      displayName: "A.J. Brown",
      position: "WR",
      latestTeam: "PHI",
      providerIds: { gsis_id: "00-001", espn_id: "123" },
    },
    {
      displayName: "Other Brown",
      position: "WR",
      latestTeam: "BUF",
      providerIds: { gsis_id: "00-999", espn_id: "123" },
    },
  ]);
  assert.equal(result.appliedCrosswalkCount, 0);
  assert.equal(result.rejectedCrosswalkCount, 2);
  assert.deepEqual(result.candidates[0]?.externalIds, candidate().externalIds);
});

test("crosswalks reject provider IDs already owned by multiple candidates", () => {
  const result = applyVerifiedPlayerCrosswalks([
    candidate({ gridlinePlayerId: "grid-a", externalIds: { espn_id: "123" } }),
    candidate({ gridlinePlayerId: "grid-b", externalIds: { espn_id: "123" } }),
  ], [{
    displayName: "A.J. Brown",
    position: "WR",
    latestTeam: "PHI",
    providerIds: { espn_id: "123", gsis_id: "00-001" },
  }]);
  assert.equal(result.appliedCrosswalkCount, 0);
  assert.equal(result.rejectedCrosswalkCount, 1);
  assert.equal(result.candidates.length, 2);
});

test("crosswalk-introduced provider IDs are reported separately from native exact IDs", () => {
  const enriched = applyVerifiedPlayerCrosswalks([
    candidate({
      gridlinePlayerId: "00-001",
      externalIds: { gsis_id: "00-001" },
      crosswalkExternalIds: {},
    }),
  ], [{
    displayName: "A.J. Brown",
    position: "WR",
    latestTeam: "PHI",
    providerIds: { gsis_id: "00-001", espn_id: "123" },
  }]).candidates;
  assert.equal(
    mapSleeperPlayer(player({ provider_ids: { espn_id: "123" } }), enriched).mappingStatus,
    "exact_crosswalk",
  );
  assert.equal(
    mapSleeperPlayer(player({ provider_ids: { gsis_id: "00-001" } }), enriched).mappingStatus,
    "exact_provider_id",
  );
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

test("verified crosswalks map Sleeper IDs only when exact provider evidence is absent", () => {
  const sleeper = player({ provider_ids: {} });
  const result = mapSleeperPlayer(sleeper, [candidate()], [{
    sourceNamespace: "sleeper",
    sourcePlayerId: sleeper.player_id,
    targetNamespace: "gsis",
    targetPlayerId: "00-001",
    gridlinePlayerId: "grid-1",
    ambiguityFlag: false,
  }]);
  assert.equal(result.mappingStatus, "exact_crosswalk");
  assert.equal(result.mappedGridlinePlayerId, "grid-1");
});

test("current roster and QB1 gates are deterministic and conservative", () => {
  const players = [
    player({ player_id: "qb", team: "PHI", position: "QB", depth_chart_position: "QB", depth_chart_order: 1 }),
    player({ player_id: "inactive", team: "PHI", status: "Inactive", depth_chart_order: null, provider_ids: {} }),
  ];
  const mappings = [
    mapSleeperPlayer(players[0]!, [candidate({ position: "QB", normalizedPosition: "QB" })]),
    mapSleeperPlayer(players[1]!, []),
  ];
  const coverage = calculateMappingCoverage(players, mappings);
  assert.equal(coverage.currentTeamRows, 2);
  assert.equal(coverage.currentRosterRows, 1);
  assert.equal(coverage.currentRosterMappingPercentage, 100);
  assert.equal(coverage.qb1.percentage, 100);
  assert.equal(coverage.suitableForDepthLogic, true);
  assert.equal(coverage.suitabilityVerdict, "SLEEPER MAPPING SUITABLE FOR DEPTH LOGIC");
});

test("selected depth collisions block suitability after global collision rejection", () => {
  const players = [
    player({ player_id: "qb-a", team: "PHI", position: "QB", depth_chart_position: "QB", depth_chart_order: 1 }),
    player({ player_id: "qb-b", team: "DAL", position: "QB", depth_chart_position: "QB", depth_chart_order: 1 }),
  ];
  const mapped = mapSleeperPlayers(players, [candidate({ position: "QB", normalizedPosition: "QB" })]);
  const coverage = calculateMappingCoverage(players, mapped.mappings, mapped.collisionCount);
  assert.equal(coverage.selectedDepthStarterCollisionCount, 1);
  assert.equal(coverage.suitableForDepthLogic, false);
  assert.ok(coverage.blockerCategories.includes("selected_depth_starter_collisions"));
});

test("validation sample covers five priority roles for at least 20 teams", () => {
  const teams = [
    "ARI", "ATL", "BAL", "BUF", "CAR", "CHI", "CIN", "CLE", "DAL", "DEN",
    "DET", "GB", "HOU", "IND", "JAX", "KC", "LAC", "LAR", "LV", "MIA",
  ];
  const positions = ["QB", "RB", "WR", "TE", "CB"];
  const players = teams.flatMap((team) => positions.map((position) =>
    player({
      player_id: `${team}-${position}`,
      full_name: `${team} ${position}`,
      team,
      position,
      depth_chart_position: position,
      depth_chart_order: 1,
      provider_ids: {},
    })));
  const mappings = players.map((item) => mapSleeperPlayer(item, []));
  const sample = buildValidationSample(players, mappings);
  assert.equal(new Set(sample.map((row) => row.team)).size, 20);
  assert.equal(sample.length, 100);
});

test("nflverse parser validates headers, duplicate GSIS IDs, and canonical hashes", () => {
  const csv = [
    "gsis_id,display_name,position,latest_team,status,espn_id,pfr_id,pff_id,otc_id,esb_id,nfl_id,smart_id",
    '00-0000001,"Doe, Jane",QB,CHI,ACT,101,DoeJa00,201,301,DOE000001,401,smart-1',
  ].join("\n");
  const parsed = parseNflversePlayersCsv(csv);
  assert.equal(parsed.rows[0]?.display_name, "Doe, Jane");
  assert.equal(parsed.rows[0]?.espn_id, "101");
  assert.equal(canonicalNflverseRowsHash(parsed.rows), canonicalNflverseRowsHash([...parsed.rows]));
  assert.throws(() => parseNflversePlayersCsv("display_name\nJane Doe"), /missing required header/);
  assert.throws(
    () => parseNflversePlayersCsv(
      `${csv}\n00-0000001,Other Person,QB,CHI,ACT,102,OtherP00,202,302,OTH000001,402,smart-2`,
    ),
    /duplicate gsis_id/,
  );
});

test("typed nflverse crosswalks include GSIS self-links and preserve conflicting provider ambiguity", () => {
  const observedAt = new Date("2026-09-16T00:00:00.000Z");
  const identities = [
    {
      gsis_id: "00-0000001", espn_id: "101", pfr_id: null, pff_id: null,
      otc_id: null, esb_id: null, nfl_id: null, smart_id: null,
    },
    {
      gsis_id: "00-0000002", espn_id: "202", pfr_id: "SameP00", pff_id: null,
      otc_id: null, esb_id: null, nfl_id: null, smart_id: null,
    },
    {
      gsis_id: "00-0000003", espn_id: null, pfr_id: "SameP00", pff_id: null,
      otc_id: null, esb_id: null, nfl_id: null, smart_id: null,
    },
  ];
  const typed = typedNflverseCrosswalks(identities, 7, observedAt);
  assert.ok(typed.some((row) =>
    row.sourceNamespace === "gsis_id" && row.sourcePlayerId === "00-0000001"));
  const derived = deriveSleeperCrosswalks([
    {
      sleeperPlayerId: "safe",
      providerIds: { espn_id: 101 },
      capturedAt: observedAt,
    },
    {
      sleeperPlayerId: "conflict",
      providerIds: { pfr_id: "SameP00" },
      capturedAt: observedAt,
    },
  ], identities, 7);
  assert.equal(derived.find((row) => row.sourcePlayerId === "safe")?.ambiguityFlag, false);
  assert.equal(derived.find((row) => row.sourcePlayerId === "conflict")?.ambiguityFlag, true);
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