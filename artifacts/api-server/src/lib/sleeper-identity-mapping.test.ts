import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { eq } from "drizzle-orm";
import { GetSleeperIdentityReportResponse } from "@workspace/api-zod";
import { db, sleeperPlayerCrosswalkEvidenceTable } from "@workspace/db";
import {
  calculateMappingCoverage,
  SLEEPER_MAPPING_VERSION,
  applyVerifiedPlayerCrosswalks,
  buildVerifiedCrosswalkEvidence,
  countStaleEffectiveCrosswalks,
  effectiveVerifiedCrosswalks,
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
  providerNamespaceInventory,
  positionCompatibility,
  reconstructLatestSleeperState,
  formatSleeperIdentityReport,
  type GridlineIdentityCandidate,
  type VerifiedSleeperCrosswalk,
} from "./sleeper-identity";
import type { SleeperPlayer } from "./sleeper";
import { parseVerifiedPlayerCrosswalkCsv } from "./nflverse-player-crosswalk";

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

function crosswalk(overrides: Partial<VerifiedSleeperCrosswalk> = {}): VerifiedSleeperCrosswalk {
  return {
    sleeperPlayerId: "sl-1",
    gridlinePlayerId: "grid-1",
    evidenceMethod: "exact_named_provider_id_equality",
    evidenceConfidence: 1,
    firstObservedAt: new Date("2025-09-01T00:00:00.000Z"),
    lastVerifiedAt: new Date("2025-09-02T00:00:00.000Z"),
    evidenceFingerprint: "verified-crosswalk",
    ambiguous: false,
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
  assert.equal(normalizePosition("LDE"), "EDGE");
  assert.equal(normalizePosition("SWR"), "WR");
  assert.equal(normalizePosition("NB"), "CB");
  assert.equal(normalizePosition("FS"), "S");
  assert.equal(normalizePosition("ROLB"), "LB");
  assert.equal(positionCompatibility("DB", "CB"), "incompatible");
  assert.equal(positionCompatibility("DE", "EDGE"), "compatible");
});

test("exact named provider ID takes precedence over crosswalk and name matching", () => {
  const result = mapSleeperPlayer(player(), [
    candidate({ gridlinePlayerId: "grid-exact", normalizedTeam: "PHI", teamCodes: ["PHI"] }),
    candidate({
      gridlinePlayerId: "grid-name",
      externalIds: {},
      normalizedTeam: "LV",
      teamCodes: ["LV"],
    }),
  ], [crosswalk({ gridlinePlayerId: "grid-name" })]);
  assert.equal(result.mappingStatus, "exact_provider_id");
  assert.equal(result.mappedGridlinePlayerId, "grid-exact");
  assert.deepEqual(result.teamChangeEvidence, {
    sleeperTeam: "LV",
    gridlineTeams: ["PHI"],
    explainableByStableIdentity: true,
  });
});

test("an exact supported cross-provider ID is classified as an exact crosswalk", () => {
  const result = mapSleeperPlayer(player({ provider_ids: {} }), [candidate()], [crosswalk()]);
  assert.equal(result.mappingStatus, "exact_crosswalk");
  assert.equal(result.mappedGridlinePlayerId, "grid-1");
  assert.equal(result.mappingConfidence, 0.98);
});

test("raw numeric Sleeper IDs never match unnamespaced Gridline candidate IDs", () => {
  const result = mapSleeperPlayer(
    player({ player_id: "123", full_name: "Different Person", provider_ids: {}, team: "BUF" }),
    [candidate({ gridlinePlayerId: "123", normalizedName: "someone else", normalizedTeam: "MIA", externalIds: {} })],
  );
  assert.equal(result.mappingStatus, "unmatched");
  assert.equal(result.mappedGridlinePlayerId, null);
});

test("conflicting exact cross-provider IDs remain ambiguous even when names agree", () => {
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

test("verified provider crosswalks collapse ESPN and PFR records into a GSIS identity", () => {
  const result = applyVerifiedPlayerCrosswalks([
    candidate({
      gridlinePlayerId: "00-001",
      externalIds: { gsis_id: "00-001" },
      sources: ["player_game_stats"],
      sourceCount: 1,
    }),
    candidate({
      gridlinePlayerId: "123",
      externalIds: { espn_id: "123" },
      sources: ["verified_espn_source"],
      sourceCount: 1,
    }),
    candidate({
      gridlinePlayerId: "BrowAJ00",
      externalIds: { pfr_id: "BrowAJ00" },
      sources: ["snap_counts"],
      sourceCount: 1,
    }),
  ], [{
    displayName: "A.J. Brown",
    position: "WR",
    latestTeam: "PHI",
    providerIds: { gsis_id: "00-001", espn_id: "123", pfr_id: "BrowAJ00" },
  }]);
  assert.equal(result.candidates.length, 1);
  assert.equal(result.candidates[0]?.gridlinePlayerId, "00-001");
  assert.deepEqual(result.candidates[0]?.crosswalkExternalIds, {
    espn_id: "123",
    pfr_id: "BrowAJ00",
  });
});

test("verified nflverse crosswalk parser retains explicit provider namespaces", () => {
  const rows = parseVerifiedPlayerCrosswalkCsv([
    "display_name,position,latest_team,gsis_id,espn_id,pfr_id",
    '"Brown, A.J.",WR,PHI,00-001,123,BrowAJ00',
  ].join("\n"));
  assert.deepEqual(rows, [{
    displayName: "Brown, A.J.",
    position: "WR",
    latestTeam: "PHI",
    providerIds: { gsis_id: "00-001", espn_id: "123", pfr_id: "BrowAJ00" },
  }]);
});

test("duplicate verified crosswalk provider IDs remain fail-closed", () => {
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
});

test("crosswalk-introduced IDs are classified separately from native exact IDs", () => {
  const enriched = applyVerifiedPlayerCrosswalks([
    candidate({
      gridlinePlayerId: "00-001",
      externalIds: { gsis_id: "00-001" },
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

test("provider inventory reports unsupported namespaces as present but untrusted", () => {
  const inventory = providerNamespaceInventory([
    player({ provider_ids: { espn_id: "123", mystery_numeric_id: "456" } }),
  ], [candidate()]);
  assert.equal(inventory.find((item) => item.namespace === "espn_id")?.trustworthyForExactEquality, true);
  assert.equal(inventory.find((item) => item.namespace === "mystery_numeric_id")?.playersWithId, 1);
  assert.equal(inventory.find((item) => item.namespace === "mystery_numeric_id")?.trustworthyForExactEquality, false);
  assert.equal(inventory.find((item) => item.namespace === "sleeper_id")?.trustworthyForExactEquality, false);
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

test("corroborated historical team evidence can recover a current team mismatch", () => {
  const result = mapSleeperPlayer(player({ provider_ids: {}, team: "LV" }), [
    candidate({
      externalIds: {},
      normalizedTeam: "PHI",
      teamCodes: ["LV", "PHI"],
      sources: ["player_game_stats", "snap_counts"],
      sourceCount: 2,
    }),
  ]);
  assert.equal(result.mappingStatus, "supported_name_match");
  assert.equal(result.mappedGridlinePlayerId, "grid-1");
  result.sourceHash = "historical-source";
  const evidence = buildVerifiedCrosswalkEvidence(
    [player({ provider_ids: {}, team: "LV" })],
    [result],
    new Date("2025-09-03T00:00:00.000Z"),
  );
  assert.equal(evidence[0]?.evidenceMethod, "stable_historical_name_team_position_linkage");
});

test("candidate evidence fingerprints are deterministic and change with evidence", () => {
  const first = candidate({ gridlinePlayerId: "sl-1" });
  const equivalent = {
    ...candidate({ gridlinePlayerId: "sl-1" }),
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
  assert.equal(coverage.currentTeam.percentage, 50);
  assert.equal(coverage.mappedCount, 1);
  assert.equal(coverage.depthOrderOne.total, 1);
  assert.equal(coverage.qbDepthOrderOne.percentage, 0);
  assert.equal(coverage.blockerCategories.includes("current_team_mapping_below_90_percent"), true);
  assert.equal(coverage.blockerCategories.includes("depth_order_mapping_below_90_percent"), true);
  assert.equal(coverage.blockerCategories.includes("qb1_mapping_below_100_percent"), true);
  assert.equal(coverage.teamAliasNormalizationCount, 2);
  assert.equal(coverage.byPosition.WR.total, 2);
  assert.equal(coverage.suitableForDepthLogic, false);
  assert.equal(coverage.suitabilityVerdict, "SLEEPER MAPPING NOT SUITABLE FOR DEPTH LOGIC");
});

test("authoritative depth cohorts exclude teamless, unknown-team, and unsupported depth roles", () => {
  const players = [
    player({
      player_id: "valid",
      team: "PHI",
      position: "QB",
      depth_chart_position: "QB",
      depth_chart_order: 1,
    }),
    player({
      player_id: "teamless",
      team: null,
      position: "QB",
      depth_chart_position: "QB",
      depth_chart_order: 1,
      provider_ids: {},
    }),
    player({
      player_id: "unknown-team",
      team: "FA",
      position: "QB",
      depth_chart_position: "QB",
      depth_chart_order: 1,
      provider_ids: {},
    }),
    player({
      player_id: "unsupported-role",
      team: "PHI",
      position: "QB",
      depth_chart_position: "LS",
      depth_chart_order: 1,
      provider_ids: {},
    }),
  ];
  const mappings = [
    mapSleeperPlayer(players[0]!, [
      candidate({ position: "QB", normalizedPosition: "QB", normalizedTeam: "PHI" }),
    ]),
    ...players.slice(1).map((item) => mapSleeperPlayer(item, [])),
  ];
  const coverage = calculateMappingCoverage(players, mappings);
  assert.equal(coverage.depthOrder.total, 1);
  assert.equal(coverage.depthOrderOne.total, 1);
  assert.equal(coverage.byPosition.QB.total, 1);
  assert.equal(coverage.byPosition.LS?.total ?? 0, 0);
  assert.match(coverage.authoritativeDepthCohortDefinition, /depth_chart_position/);
});

test("every required starter-role metric is persisted and blocks readiness when it fails", () => {
  const rolePlan = [
    ["QB1", "QB", 1],
    ["RB1", "RB", 1],
    ["WR1", "WR", 1],
    ["WR2", "WR", 2],
    ["WR3", "WR", 3],
    ["TE1", "TE", 1],
    ["CB1", "CB", 1],
    ["CB2", "CB", 2],
    ["EDGE", "DE", 1],
    ["LB", "LB", 1],
    ["S1", "S", 1],
    ["S2", "S", 2],
    ["OL", "LT", 1],
  ] as const;
  const teams = [
    "ARI", "ATL", "BAL", "BUF", "CAR", "CHI", "CIN", "CLE",
    "DAL", "DEN", "DET", "GB", "HOU", "IND", "JAX", "KC",
    "LAC", "LAR", "LV", "MIA", "MIN", "NE", "NO", "NYG",
    "NYJ", "PHI", "PIT", "SEA", "SF", "TB", "TEN", "WSH",
  ];
  const players = teams.flatMap((team) => rolePlan.map(([role, position, order]) =>
    player({
      player_id: `${team}-${role}`,
      full_name: `${team} ${role}`,
      first_name: team,
      last_name: role,
      team,
      position,
      depth_chart_position: position,
      depth_chart_order: order,
      provider_ids: { gsis_id: `00-${team}-${role}` },
    })));
  const mappings = players.map((item) => mapSleeperPlayer(item, [
    candidate({
      gridlinePlayerId: `grid-${item.player_id}`,
      name: item.full_name ?? "",
      normalizedName: normalizePlayerName(item.full_name),
      normalizedTeam: item.team,
      position: item.position,
      normalizedPosition: normalizePosition(item.position),
      externalIds: { gsis_id: String(item.provider_ids.gsis_id) },
      teamCodes: [item.team!],
    }),
  ]));
  const complete = calculateMappingCoverage(players, mappings);
  assert.equal(complete.suitableForDepthLogic, true);
  for (const metric of [
    "QB1", "WR1", "WR2", "WR3", "CB1", "CB2", "EDGE", "LB",
    "SAFETY_STARTERS", "OL_EVIDENCE", "ALL_STARTERS",
  ] as const) {
    assert.equal(complete.roleCoverage[metric].unresolved, 0);
    assert.equal(complete.roleCoverage[metric].ambiguous, 0);
  }

  const failures = [
    ["QB1", 1, "qb1_mapping_below_100_percent"],
    ["WR1", 4, "wr1_mapping_below_90_percent"],
    ["WR2", 4, "wr2_mapping_below_90_percent"],
    ["WR3", 4, "wr3_mapping_below_90_percent"],
    ["CB1", 4, "cb1_mapping_below_90_percent"],
    ["CB2", 4, "cb2_mapping_below_90_percent"],
    ["EDGE", 4, "edge_mapping_below_90_percent"],
    ["LB", 4, "lb_mapping_below_90_percent"],
    ["S", 7, "safety_starter_mapping_below_90_percent"],
    ["OL", 4, "ol_evidence_mapping_below_90_percent"],
  ] as const;
  for (const [rolePrefix, failureCount, blocker] of failures) {
    let remaining: number = failureCount;
    const failedMappings = mappings.map((mapping) => {
      if (remaining === 0 || !mapping.sleeperPlayerId.split("-").at(-1)?.startsWith(rolePrefix)) {
        return mapping;
      }
      remaining -= 1;
      return {
        ...mapping,
        mappedGridlinePlayerId: null,
        mappingStatus: "unmatched" as const,
        mappingMethod: "unmatched" as const,
        mappingConfidence: 0,
        unmatchedReason: "test required-role failure",
      };
    });
    const coverage = calculateMappingCoverage(players, failedMappings);
    assert.equal(coverage.suitableForDepthLogic, false, rolePrefix);
    assert.ok(coverage.blockerCategories.includes(blocker), rolePrefix);
  }

  const ambiguousMappings = mappings.map((mapping, index) => index === 0
    ? {
        ...mapping,
        mappedGridlinePlayerId: null,
        mappingStatus: "ambiguous" as const,
        mappingMethod: "ambiguous" as const,
        mappingConfidence: 0,
      }
    : mapping);
  const ambiguous = calculateMappingCoverage(players, ambiguousMappings);
  assert.equal(ambiguous.roleCoverage.ALL_STARTERS.ambiguous, 1);
  assert.ok(ambiguous.blockerCategories.includes("ambiguous_starter_mappings"));
  assert.equal(ambiguous.suitableForDepthLogic, false);
});

test("depth diagnostics enumerate all 32 canonical teams without choosing starters", () => {
  const players = [player({ player_id: "depth-qb", team: "OAK", position: "QB", depth_chart_position: "QB" })];
  const mapping = mapSleeperPlayer(players[0]!, [candidate({ gridlinePlayerId: "depth-grid", externalIds: {} })]);
  const candidates = deriveDepthRelevantCandidates(players, [mapping]);
  assert.equal(new Set(candidates.map((item) => item.team)).size, 32);
  assert.equal(candidates.find((item) => item.team === "LV")?.role, "QB1");
  assert.equal(candidates.some((item) => item.role === "QB3"), true);
  assert.equal(candidates.some((item) => item.role === "WR5"), true);
  assert.equal(candidates.some((item) => item.role === "S4"), true);
  const sample = buildValidationSample(players, [mapping]);
  assert.equal(new Set(sample.map((item) => item.team)).size, 20);
  assert.equal(sample.length, 100);
  assert.equal(sample.find((item) => item.team === "LV" && item.role === "QB1")?.depthOrder, 1);
});

test("verified crosswalk evidence is namespace-aware and reproducible", () => {
  const sourcePlayer = player();
  const mapping = mapSleeperPlayer(sourcePlayer, [candidate()]);
  mapping.sourceHash = "source-hash";
  const observedAt = new Date("2025-09-03T00:00:00.000Z");
  const rows = buildVerifiedCrosswalkEvidence([sourcePlayer], [mapping], observedAt);
  assert.equal(rows.length, 1);
  assert.equal(rows[0]?.sourceNamespace, "sleeper_id");
  assert.equal(rows[0]?.targetNamespace, "gridline_player_id");
  assert.deepEqual(rows[0]?.evidence, {
    corroboratingSources: ["historical_depth_charts", "players"],
    matchedNamespaces: ["espn_id", "gsis_id"],
    sourceHash: "source-hash",
    mappingVersion: "sleeper-identity-v6-authoritative-role-cohorts",
  });
  assert.equal(
    buildVerifiedCrosswalkEvidence([sourcePlayer], [mapping], observedAt)[0]?.evidenceFingerprint,
    rows[0]?.evidenceFingerprint,
  );
});

test("fresh verification removes the same link from stale crosswalk diagnostics", () => {
  const old = crosswalk({
    lastVerifiedAt: new Date("2025-01-01T00:00:00.000Z"),
  });
  const cutoff = new Date("2025-08-01T00:00:00.000Z");
  assert.equal(countStaleEffectiveCrosswalks([old], [], cutoff), 1);
  assert.equal(countStaleEffectiveCrosswalks([old], [{
    sourcePlayerId: old.sleeperPlayerId,
    gridlinePlayerId: old.gridlinePlayerId,
  }], cutoff), 0);
});

test("repeated verification appends a distinct observation and readback uses the latest timestamp", () => {
  const sourcePlayer = player();
  const mapping = mapSleeperPlayer(sourcePlayer, [candidate()]);
  mapping.sourceHash = "unchanged-source-hash";
  const firstAt = new Date("2025-09-03T00:00:00.000Z");
  const secondAt = new Date("2025-09-04T00:00:00.000Z");
  const first = buildVerifiedCrosswalkEvidence([sourcePlayer], [mapping], firstAt)[0]!;
  const second = buildVerifiedCrosswalkEvidence([sourcePlayer], [mapping], secondAt, [{
    ...crosswalk(),
    firstObservedAt: first.firstObservedAt,
    lastVerifiedAt: first.lastVerifiedAt,
    evidenceFingerprint: first.evidenceFingerprint,
  }])[0]!;
  assert.notEqual(first.evidenceFingerprint, second.evidenceFingerprint);
  const readback = effectiveVerifiedCrosswalks([
    { ...first, id: 1 },
    { ...second, id: 2 },
  ]);
  assert.equal(readback.length, 1);
  assert.equal(readback[0]?.firstObservedAt.toISOString(), firstAt.toISOString());
  assert.equal(readback[0]?.lastVerifiedAt.toISOString(), secondAt.toISOString());
});

test("database readback preserves repeated append-only verification chronology", async (t) => {
  if (!process.env.DATABASE_URL) {
    t.skip("DATABASE_URL is not configured");
    return;
  }
  const sourcePlayer = player({ player_id: `task59-test-${randomUUID()}` });
  const mapping = mapSleeperPlayer(sourcePlayer, [candidate()]);
  mapping.sourceHash = "unchanged-source-hash";
  const firstAt = new Date("2025-09-03T00:00:00.000Z");
  const secondAt = new Date("2025-09-04T00:00:00.000Z");
  const first = buildVerifiedCrosswalkEvidence([sourcePlayer], [mapping], firstAt)[0]!;
  const second = buildVerifiedCrosswalkEvidence([sourcePlayer], [mapping], secondAt, [{
    ...crosswalk(),
    sleeperPlayerId: sourcePlayer.player_id,
    firstObservedAt: first.firstObservedAt,
    lastVerifiedAt: first.lastVerifiedAt,
    evidenceFingerprint: first.evidenceFingerprint,
  }])[0]!;
  const rollback = new Error("rollback task 59 persistence test");
  await assert.rejects(db.transaction(async (tx) => {
    await tx.insert(sleeperPlayerCrosswalkEvidenceTable).values([first, second]);
    const persisted = await tx.select().from(sleeperPlayerCrosswalkEvidenceTable)
      .where(eq(sleeperPlayerCrosswalkEvidenceTable.sourcePlayerId, sourcePlayer.player_id));
    assert.equal(persisted.length, 2);
    const effective = effectiveVerifiedCrosswalks(persisted);
    assert.equal(effective.length, 1);
    assert.equal(effective[0]?.lastVerifiedAt.toISOString(), secondAt.toISOString());
    throw rollback;
  }), (error) => error === rollback);
});

test("admin report is schema-valid with no compatible mapping run", () => {
  const report = formatSleeperIdentityReport({
    status: "unavailable",
    mappingVersion: null,
    latestAttemptMappingVersion: null,
    mappingRunId: null,
    sourceSnapshotId: null,
    lastUpdated: null,
    lastAttempted: null,
    staleAgeMs: null,
    latestFailure: null,
    recentFailureCount: 0,
    durationMs: null,
    metadata: {},
  });
  assert.equal(GetSleeperIdentityReportResponse.safeParse(report).success, true);
  assert.deepEqual(report.report.currentTeam, { total: 0, mapped: 0, percentage: 0 });
  assert.equal(report.suitableForDepthLogic, false);
});

test("admin report exposes reproducible authoritative role metrics from a compatible run", () => {
  const roleMetric = {
    total: 32,
    mapped: 31,
    percentage: 96.88,
    ambiguous: 0,
    unmatched: 1,
    unresolved: 1,
  };
  const report = formatSleeperIdentityReport({
    status: "current",
    mappingVersion: SLEEPER_MAPPING_VERSION,
    latestAttemptMappingVersion: SLEEPER_MAPPING_VERSION,
    mappingRunId: "current-run",
    sourceSnapshotId: "immutable-snapshot",
    lastUpdated: "2026-09-17T00:00:00.000Z",
    lastAttempted: "2026-09-17T00:00:00.000Z",
    staleAgeMs: 0,
    latestFailure: null,
    recentFailureCount: 0,
    durationMs: 1,
    metadata: {
      roleCoverage: { WR3: roleMetric },
      authoritativeDepthCohortDefinition:
        "Canonical current NFL team, non-null depth order, and supported normalized depth_chart_position.",
      suitabilityGates: { wr3Mapping: true },
      blockerCategories: [],
      suitableForDepthLogic: true,
      suitabilityVerdict: "SLEEPER MAPPING SUITABLE FOR DEPTH LOGIC",
    },
  });
  assert.equal(GetSleeperIdentityReportResponse.safeParse(report).success, true);
  assert.deepEqual(report.report.roleCoverage.WR3, roleMetric);
  assert.match(report.report.authoritativeDepthCohortDefinition, /depth_chart_position/);
  assert.equal(report.suitableForDepthLogic, true);
});

test("legacy mapping metadata is not presented under current report semantics", () => {
  const report = formatSleeperIdentityReport({
    status: "stale",
    mappingVersion: "sleeper-identity-v3",
    latestAttemptMappingVersion: "sleeper-identity-v3",
    mappingRunId: "legacy-run",
    sourceSnapshotId: "legacy-snapshot",
    lastUpdated: "2025-09-01T00:00:00.000Z",
    lastAttempted: "2025-09-01T00:00:00.000Z",
    staleAgeMs: 1,
    latestFailure: null,
    recentFailureCount: 0,
    durationMs: 1,
    metadata: { suitableForDepthLogic: true, currentTeam: { total: 1, mapped: 1, percentage: 100 } },
  });
  assert.equal(GetSleeperIdentityReportResponse.safeParse(report).success, true);
  assert.equal(report.status, "unavailable");
  assert.equal(report.mappingRunId, null);
  assert.equal(report.mappingVersion, null);
  assert.equal(report.suitableForDepthLogic, false);
  assert.deepEqual(report.report.currentTeam, { total: 0, mapped: 0, percentage: 0 });
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