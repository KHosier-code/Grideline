import assert from "node:assert/strict";
import test from "node:test";
import { sql } from "drizzle-orm";
import {
  db,
  depthChartSnapshotsTable,
  historicalDepthChartTable,
  sportsDataIoDepthEvidenceTable,
  sportsDataIoEvaluationRunsTable,
  sportsDataIoIdentityMappingsTable,
} from "@workspace/db";
import {
  auditSportsDataIoDepth,
  mapSportsDataIoRows,
  normalizeSportsDataIoRole,
  parseSportsDataIoDepthCharts,
  runSportsDataIoDepthEvaluation,
  sportsDataIoAccessPreflight,
} from "./sportsdataio-depth";
import { normalizePlayerName, type GridlineIdentityCandidate } from "./sleeper-identity";

const payload = [{
  TeamID: 1,
  Offense: [
    { DepthChartID: 10, TeamID: 1, PlayerID: 100, Name: "Exact Tackle", PositionCategory: "OFF", Position: "LT", DepthOrder: 1, Updated: "2026-09-17T08:00:00" },
  ],
  Defense: [
    { DepthChartID: 11, TeamID: 1, PlayerID: 101, Name: "Slot Corner", PositionCategory: "DEF", Position: "NB", DepthOrder: 1, Updated: "2026-09-17T08:00:00" },
  ],
  SpecialTeams: [
    { DepthChartID: 12, TeamID: 1, PlayerID: 102, Name: "Long Snapper", PositionCategory: "ST", Position: "LS", DepthOrder: 1, Updated: "2026-09-17T08:00:00" },
  ],
}];
const candidate = (id: string, name: string, position: string, externalIds: Record<string, string> = {}): GridlineIdentityCandidate => ({
  gridlinePlayerId: id, name, normalizedName: normalizePlayerName(name), normalizedTeam: "ARI",
  position, normalizedPosition: position, externalIds, crosswalkExternalIds: {},
  sources: ["test"], sourceCount: 1, latestSeason: 2026, latestWeek: 1, teamCodes: ["ARI"],
});

test("parser preserves exact provider roles, units, IDs, order, and timestamps", () => {
  const rows = parseSportsDataIoDepthCharts(payload, new Date("2026-09-17T12:00:00Z"));
  assert.equal(rows.length, 3);
  assert.deepEqual(rows.map((row) => [row.originalPosition, row.normalizedRole, row.unit]), [
    ["LT", "LT1", "offense"], ["NB", "SCB1", "defense"], ["LS", "LS1", "special_teams"],
  ]);
  assert.equal(normalizeSportsDataIoRole("SS", 1), "SS1");
  assert.equal(normalizeSportsDataIoRole("RDE", 1), "RDE1");
});

test("explicit provider ID precedes crosswalk and normalized name matching", () => {
  const rows = parseSportsDataIoDepthCharts(payload);
  const mappings = mapSportsDataIoRows(rows.slice(0, 1), [
    candidate("direct", "Different", "LT", { sportsdataio_id: "100" }),
    candidate("crosswalk", "Exact Tackle", "LT"),
  ], new Map([["1", "ARI"]]), new Map([["100", "crosswalk"]]));
  assert.equal(mappings[0]?.mappingStatus, "exact_provider_id");
  assert.equal(mappings[0]?.mappedGridlinePlayerId, "direct");
});

test("ambiguous names and target collisions fail closed", () => {
  const rows = parseSportsDataIoDepthCharts(payload);
  const ambiguity = mapSportsDataIoRows(rows.slice(0, 1), [
    candidate("a", "Exact Tackle", "LT"),
    candidate("b", "Exact Tackle", "LT"),
  ], new Map([["1", "ARI"]]));
  assert.equal(ambiguity[0]?.mappingStatus, "ambiguous");
  assert.equal(ambiguity[0]?.mappedGridlinePlayerId, null);
  const collisionRows = [rows[0]!, { ...rows[0]!, providerDepthChartId: "99" }];
  const collisions = mapSportsDataIoRows(collisionRows, [
    candidate("one", "Exact Tackle", "LT", { sportsdataio_id: "100" }),
  ], new Map([["1", "ARI"]]));
  assert.equal(collisions.every((mapping) => mapping.collision && !mapping.mappedGridlinePlayerId), true);
});

test("32-team audit reports missing roles and one required fail-closed verdict", () => {
  const rows = parseSportsDataIoDepthCharts(payload);
  const mappings = mapSportsDataIoRows(rows, [
    candidate("lt", "Exact Tackle", "LT", { sportsdataio_id: "100" }),
    candidate("cb", "Slot Corner", "CB", { sportsdataio_id: "101" }),
    candidate("ls", "Long Snapper", "LS", { sportsdataio_id: "102" }),
  ], new Map([["1", "ARI"]]));
  const audit = auditSportsDataIoDepth({ rows, mappings, providerTeamCodes: new Map([["1", "ARI"]]), capturedAt: new Date() });
  assert.equal(audit.teams.length, 32);
  assert.equal(audit.observedTeamCount, 1);
  assert.equal(audit.teams.find((team) => team.team === "ARI")?.missingRoles.includes("LT1"), false);
  assert.equal(audit.finalVerdict, "SPORTSDATAIO NOT RECOMMENDED AS PRIMARY DEPTH SOURCE");
  assert.equal(audit.hierarchyActivated, false);
});

test("database-backed successful capture persists parsed evidence and mappings only", async () => {
  const previous = process.env.SPORTSDATAIO_API_KEY;
  process.env.SPORTSDATAIO_API_KEY = "redacted-test-value";
  const [beforeEvidence] = await db.select({ count: sql<number>`count(*)::int` }).from(sportsDataIoDepthEvidenceTable);
  const [beforeMappings] = await db.select({ count: sql<number>`count(*)::int` }).from(sportsDataIoIdentityMappingsTable);
  const result = await runSportsDataIoDepthEvaluation({
    fetchImpl: async () => new Response(JSON.stringify(payload), { status: 200, headers: { "Content-Type": "application/json" } }),
    providerTeamCodes: new Map([["1", "ARI"]]),
    candidates: [
      candidate("lt", "Exact Tackle", "LT", { sportsdataio_id: "100" }),
      candidate("cb", "Slot Corner", "CB", { sportsdataio_id: "101" }),
      candidate("ls", "Long Snapper", "LS", { sportsdataio_id: "102" }),
    ],
  });
  const [afterEvidence] = await db.select({ count: sql<number>`count(*)::int` }).from(sportsDataIoDepthEvidenceTable);
  const [afterMappings] = await db.select({ count: sql<number>`count(*)::int` }).from(sportsDataIoIdentityMappingsTable);
  if (previous) process.env.SPORTSDATAIO_API_KEY = previous;
  else delete process.env.SPORTSDATAIO_API_KEY;
  assert.equal(result.preflight.status, "accessible");
  assert.equal(afterEvidence?.count, (beforeEvidence?.count ?? 0) + 3);
  assert.equal(afterMappings?.count, (beforeMappings?.count ?? 0) + 3);
  assert.equal(JSON.stringify(result).includes("redacted-test-value"), false);
});

test("missing secret stops before any request and never exposes credentials", async () => {
  const previous = process.env.SPORTSDATAIO_API_KEY;
  delete process.env.SPORTSDATAIO_API_KEY;
  let called = false;
  const result = await sportsDataIoAccessPreflight(async () => {
    called = true;
    throw new Error("must not call");
  });
  if (previous) process.env.SPORTSDATAIO_API_KEY = previous;
  assert.equal(result.status, "inaccessible");
  assert.equal(called, false);
  assert.equal(JSON.stringify(result).includes("key="), false);
});

test("database-backed inaccessible evaluation is append-only and does not overwrite production depth", async () => {
  const previous = process.env.SPORTSDATAIO_API_KEY;
  delete process.env.SPORTSDATAIO_API_KEY;
  const [beforeCurrent] = await db.select({ count: sql<number>`count(*)::int` }).from(depthChartSnapshotsTable);
  const [beforeHistorical] = await db.select({ count: sql<number>`count(*)::int` }).from(historicalDepthChartTable);
  const [beforeEvaluation] = await db.select({ count: sql<number>`count(*)::int` }).from(sportsDataIoEvaluationRunsTable);
  const result = await runSportsDataIoDepthEvaluation();
  const [afterCurrent] = await db.select({ count: sql<number>`count(*)::int` }).from(depthChartSnapshotsTable);
  const [afterHistorical] = await db.select({ count: sql<number>`count(*)::int` }).from(historicalDepthChartTable);
  const [afterEvaluation] = await db.select({ count: sql<number>`count(*)::int` }).from(sportsDataIoEvaluationRunsTable);
  if (previous) process.env.SPORTSDATAIO_API_KEY = previous;
  assert.equal(result.preflight.status, "inaccessible");
  assert.equal(afterCurrent?.count, beforeCurrent?.count);
  assert.equal(afterHistorical?.count, beforeHistorical?.count);
  assert.equal(afterEvaluation?.count, (beforeEvaluation?.count ?? 0) + 1);
  assert.equal(result.phase61Boundary.consumerPayloadExposed, false);
  assert.equal(result.phase61Boundary.productionDepthPrecedenceChanged, false);
});