import { createHash, randomUUID } from "node:crypto";
import { desc, eq } from "drizzle-orm";
import {
  db,
  sportsDataIoDepthEvidenceTable,
  sportsDataIoEvaluationRunsTable,
  sportsDataIoIdentityMappingsTable,
  playerIdentityCrosswalkRevisionsTable,
} from "@workspace/db";
import {
  normalizePlayerName,
  normalizePosition,
  normalizeTeamCode,
  positionCompatibility,
  loadGridlineIdentityCandidates,
  type GridlineIdentityCandidate,
} from "./sleeper-identity";
import { getCurrentDepthComparisonEvidence } from "./current-personnel";

export const SPORTSDATAIO_DEPTH_ENDPOINT =
  "https://api.sportsdata.io/v3/nfl/scores/json/DepthCharts";
export const SPORTSDATAIO_MAPPING_VERSION = "sportsdataio-depth-evaluation-v1";
export const SPORTSDATAIO_FINAL_VERDICTS = [
  "SPORTSDATAIO RECOMMENDED AS PRIMARY DEPTH SOURCE",
  "SPORTSDATAIO NOT RECOMMENDED AS PRIMARY DEPTH SOURCE",
] as const;

const NFL_TEAMS = [
  "ARI", "ATL", "BAL", "BUF", "CAR", "CHI", "CIN", "CLE",
  "DAL", "DEN", "DET", "GB", "HOU", "IND", "JAX", "KC",
  "LAC", "LAR", "LV", "MIA", "MIN", "NE", "NO", "NYG",
  "NYJ", "PHI", "PIT", "SEA", "SF", "TB", "TEN", "WSH",
] as const;
const REQUIRED_ROLES = [
  "QB1", "QB2", "RB1", "RB2", "WR1", "WR2", "WR3", "TE1",
  "LT1", "LG1", "C1", "RG1", "RT1",
  "DT1", "DT2", "LB1", "LB2", "CB1", "CB2", "CB3_OR_SLOT", "FS1", "SS1", "EDGE1", "EDGE2",
  "K1", "P1", "LS1",
] as const;
const EXACT_ROLES = new Set(["LT", "LG", "C", "RG", "RT", "FS", "SS"]);

type JsonRecord = Record<string, unknown>;
export type SportsDataIoDepthRow = {
  providerDepthChartId: string;
  providerTeamId: string;
  providerPlayerId: string | null;
  playerName: string | null;
  originalPosition: string | null;
  originalRole: string | null;
  normalizedRole: string | null;
  unit: "offense" | "defense" | "special_teams";
  depthOrder: number | null;
  statusFields: Record<string, string | null>;
  providerUpdatedAt: Date | null;
  providerVersion: string | null;
  capturedAt: Date;
  sourceHash: string;
};
export type SportsDataIoMapping = {
  providerDepthChartId: string;
  providerPlayerId: string | null;
  mappedGridlinePlayerId: string | null;
  mappingStatus: "exact_provider_id" | "exact_crosswalk" | "normalized_name_team_position" | "ambiguous" | "unmatched";
  mappingMethod: string;
  mappingConfidence: number;
  candidateGridlinePlayerIds: string[];
  ambiguityReason: string | null;
  unmatchedReason: string | null;
  collision: boolean;
};
type CurrentComparisonTeam = Awaited<ReturnType<typeof getCurrentDepthComparisonEvidence>>[number];

function record(value: unknown): JsonRecord {
  return value && typeof value === "object" && !Array.isArray(value) ? value as JsonRecord : {};
}
function text(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}
function id(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? String(value) : text(value);
}
function date(value: unknown) {
  const valueText = text(value);
  if (!valueText) return null;
  const parsed = new Date(valueText);
  return Number.isFinite(parsed.getTime()) ? parsed : null;
}
function hash(value: unknown) {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

export function normalizeSportsDataIoRole(position: string | null, depthOrder: number | null) {
  const upper = text(position)?.toUpperCase() ?? null;
  if (!upper) return null;
  const role = upper === "NB" || upper === "NCB" || upper === "SLOT"
    ? "SCB"
    : ["DE", "EDGE"].includes(upper)
      ? "EDGE"
      : upper;
  return depthOrder === null ? role : `${role}${depthOrder}`;
}

function canonicalAuditRoles(rows: SportsDataIoDepthRow[]) {
  const roles = new Map<string, SportsDataIoDepthRow>();
  const put = (role: string, row: SportsDataIoDepthRow) => {
    if (!roles.has(role)) roles.set(role, row);
  };
  for (const row of rows) {
    const sourceRole = row.normalizedRole;
    if (!sourceRole) continue;
    put(sourceRole, row);
    const position = row.originalPosition?.toUpperCase();
    if (position === "LCB" || position === "RCB") continue;
    if (position === "NB" || position === "NCB" || position === "SLOT") {
      put("CB3_OR_SLOT", row);
      continue;
    }
    if (position === "LDE" || position === "RDE") continue;
    if (position === "LDT" || position === "RDT") continue;
    if (["LILB", "RILB", "LOLB", "ROLB"].includes(position ?? "")) continue;
    if (position === "LWR" || position === "RWR" || position === "SWR") continue;
    if (position === "CB" && row.depthOrder) put(`CB${row.depthOrder}`, row);
    if ((position === "DE" || position === "EDGE") && row.depthOrder) put(`EDGE${row.depthOrder}`, row);
  }
  const assignSided = (positions: string[], prefix: string) => {
    rows.filter((row) => row.depthOrder === 1 && positions.includes(row.originalPosition?.toUpperCase() ?? ""))
      .sort((left, right) => (left.originalPosition ?? "").localeCompare(right.originalPosition ?? ""))
      .forEach((row, index) => put(`${prefix}${index + 1}`, row));
  };
  assignSided(["LCB", "RCB"], "CB");
  assignSided(["LDE", "RDE"], "EDGE");
  assignSided(["LDT", "RDT"], "DT");
  assignSided(["LILB", "RILB", "LOLB", "ROLB"], "LB");
  assignSided(["LWR", "RWR", "SWR"], "WR");
  return roles;
}

export function parseSportsDataIoDepthCharts(payload: unknown, capturedAt = new Date()) {
  if (!Array.isArray(payload)) throw new Error("SportsDataIO depth response must be an array");
  const rows: SportsDataIoDepthRow[] = [];
  for (const teamValue of payload) {
    const team = record(teamValue);
    const providerTeamId = id(team.TeamID);
    if (!providerTeamId) continue;
    for (const [providerUnit, unit] of [
      ["Offense", "offense"],
      ["Defense", "defense"],
      ["SpecialTeams", "special_teams"],
    ] as const) {
      const entries = Array.isArray(team[providerUnit]) ? team[providerUnit] as unknown[] : [];
      for (const entryValue of entries) {
        const entry = record(entryValue);
        const providerDepthChartId = id(entry.DepthChartID);
        if (!providerDepthChartId) continue;
        const originalPosition = text(entry.Position);
        const depthOrder = typeof entry.DepthOrder === "number" && Number.isInteger(entry.DepthOrder)
          ? entry.DepthOrder : null;
        const material = {
          providerDepthChartId,
          providerTeamId,
          providerPlayerId: id(entry.PlayerID),
          playerName: text(entry.Name),
          originalPosition,
          originalRole: text(entry.PositionCategory),
          depthOrder,
          unit,
          providerUpdatedAt: text(entry.Updated),
        };
        rows.push({
          ...material,
          normalizedRole: normalizeSportsDataIoRole(originalPosition, depthOrder),
          statusFields: Object.fromEntries(Object.entries(entry)
            .filter(([key]) => /status|injury|active/i.test(key))
            .map(([key, value]) => [key, text(value)])),
          providerUpdatedAt: date(entry.Updated),
          providerVersion: text(entry.Version),
          capturedAt,
          sourceHash: hash(material),
        });
      }
    }
  }
  return rows;
}

function compatibleCandidate(row: SportsDataIoDepthRow, candidate: GridlineIdentityCandidate, team: string | null) {
  return normalizePlayerName(row.playerName) === candidate.normalizedName
    && Boolean(team && candidate.teamCodes.includes(team))
    && positionCompatibility(row.originalPosition, candidate.position) !== "incompatible";
}

export function mapSportsDataIoRows(
  rows: SportsDataIoDepthRow[],
  candidates: GridlineIdentityCandidate[],
  providerTeamCodes: ReadonlyMap<string, string>,
  crosswalks: ReadonlyMap<string, string> = new Map(),
) {
  const candidateById = new Map(candidates.map((candidate) => [candidate.gridlinePlayerId, candidate]));
  const mappings: SportsDataIoMapping[] = rows.map((row) => {
    const providerId = row.providerPlayerId;
    const direct = providerId
      ? candidates.filter((candidate) =>
        (candidate.externalIds.sportsdataio_id === providerId
          && candidate.crosswalkExternalIds.sportsdataio_id !== providerId)
        || (candidate.externalIds.sportsdata_id === providerId
          && candidate.crosswalkExternalIds.sportsdata_id !== providerId))
      : [];
    const crosswalkTarget = providerId ? crosswalks.get(providerId) : null;
    const crosswalkCandidate = crosswalkTarget ? candidateById.get(crosswalkTarget) : null;
    const candidateCrosswalkMatches = providerId
      ? candidates.filter((candidate) =>
        candidate.crosswalkExternalIds.sportsdataio_id === providerId
        || candidate.crosswalkExternalIds.sportsdata_id === providerId)
      : [];
    const normalizedTeam = normalizeTeamCode(providerTeamCodes.get(row.providerTeamId)).normalizedTeam;
    const nameMatches = candidates.filter((candidate) => compatibleCandidate(row, candidate, normalizedTeam));
    const selected = direct.length === 1
      ? { candidates: direct, status: "exact_provider_id" as const, confidence: 1 }
      : direct.length > 1
        ? { candidates: direct, status: "ambiguous" as const, confidence: 0 }
        : crosswalkCandidate || candidateCrosswalkMatches.length === 1
          ? { candidates: crosswalkCandidate ? [crosswalkCandidate] : candidateCrosswalkMatches, status: "exact_crosswalk" as const, confidence: 0.98 }
          : candidateCrosswalkMatches.length > 1
            ? { candidates: candidateCrosswalkMatches, status: "ambiguous" as const, confidence: 0 }
          : nameMatches.length === 1
            ? { candidates: nameMatches, status: "normalized_name_team_position" as const, confidence: 0.9 }
            : nameMatches.length > 1
              ? { candidates: nameMatches, status: "ambiguous" as const, confidence: 0 }
              : { candidates: [], status: "unmatched" as const, confidence: 0 };
    return {
      providerDepthChartId: row.providerDepthChartId,
      providerPlayerId: row.providerPlayerId,
      mappedGridlinePlayerId: selected.status === "ambiguous" || selected.status === "unmatched"
        ? null : selected.candidates[0]!.gridlinePlayerId,
      mappingStatus: selected.status,
      mappingMethod: selected.status,
      mappingConfidence: selected.confidence,
      candidateGridlinePlayerIds: selected.candidates.map((candidate) => candidate.gridlinePlayerId),
      ambiguityReason: selected.status === "ambiguous"
        ? "Multiple compatible identities remain after applying the strongest available evidence." : null,
      unmatchedReason: selected.status === "unmatched"
        ? "No explicit provider/crosswalk ID or exact normalized name, team, and compatible-position match." : null,
      collision: false,
    };
  });
  const owners = new Map<string, SportsDataIoMapping[]>();
  for (const mapping of mappings) {
    if (!mapping.mappedGridlinePlayerId) continue;
    owners.set(mapping.mappedGridlinePlayerId, [
      ...(owners.get(mapping.mappedGridlinePlayerId) ?? []), mapping,
    ]);
  }
  for (const group of owners.values()) {
    if (group.length < 2) continue;
    for (const mapping of group) {
      mapping.mappingStatus = "ambiguous";
      mapping.mappingMethod = "collision";
      mapping.mappingConfidence = 0;
      mapping.mappedGridlinePlayerId = null;
      mapping.ambiguityReason = "Multiple SportsDataIO rows map to the same Gridline identity.";
      mapping.collision = true;
    }
  }
  return mappings;
}

export function auditSportsDataIoDepth(input: {
  rows: SportsDataIoDepthRow[];
  mappings: SportsDataIoMapping[];
  providerTeamCodes: ReadonlyMap<string, string>;
  currentCoverage?: Partial<Record<string, number>>;
  capturedAt: Date;
  productionUseVerified?: boolean;
  commercialLicenseVerified?: boolean;
  currentComparison?: CurrentComparisonTeam[];
}) {
  const mappingByRow = new Map(input.mappings.map((mapping) => [mapping.providerDepthChartId, mapping]));
  const teams = NFL_TEAMS.map((team) => {
    const teamRows = input.rows.filter((row) =>
      normalizeTeamCode(input.providerTeamCodes.get(row.providerTeamId)).normalizedTeam === team);
    const mappedRows = teamRows.filter((row) => mappingByRow.get(row.providerDepthChartId)?.mappedGridlinePlayerId);
    const roles = canonicalAuditRoles(mappedRows);
    return {
      team,
      eligibleRows: teamRows.length,
      mappedRows: mappedRows.length,
      missingRoles: REQUIRED_ROLES.filter((role) => !roles.has(role)),
      missingRoleCount: REQUIRED_ROLES.filter((role) => !roles.has(role)).length,
      wrCbReady: ["WR1", "WR2", "WR3", "CB1", "CB2"].every((role) => roles.has(role)),
    };
  });
  const roleCoverage = Object.fromEntries(REQUIRED_ROLES.map((role) => {
    const eligible = teams.flatMap((team) => {
      const teamRows = input.rows.filter((row) =>
        normalizeTeamCode(input.providerTeamCodes.get(row.providerTeamId)).normalizedTeam === team.team);
      const source = canonicalAuditRoles(teamRows).get(role);
      return source ? [source] : [];
    });
    const mapped = eligible.filter((row) => mappingByRow.get(row.providerDepthChartId)?.mappedGridlinePlayerId);
    return [role, { mapped: mapped.length, eligible: eligible.length }];
  }));
  const mappedCount = input.mappings.filter((mapping) => mapping.mappedGridlinePlayerId).length;
  const ambiguousCount = input.mappings.filter((mapping) => mapping.mappingStatus === "ambiguous").length;
  const unmatchedCount = input.mappings.filter((mapping) => mapping.mappingStatus === "unmatched").length;
  const current = input.currentCoverage ?? currentCoverageFromComparison(input.currentComparison ?? []);
  const candidate = {
    overall: mappedCount,
    starters: input.rows.filter((row) => row.depthOrder === 1
      && mappingByRow.get(row.providerDepthChartId)?.mappedGridlinePlayerId).length,
    cb1: roleCoverage.CB1.mapped,
    cb2: roleCoverage.CB2.mapped,
    safeties: roleCoverage.FS1.mapped + roleCoverage.SS1.mapped,
    edge: roleCoverage.EDGE1.mapped + roleCoverage.EDGE2.mapped,
    exactOffensiveLine: ["LT1", "LG1", "C1", "RG1", "RT1"]
      .reduce((sum, role) => sum + roleCoverage[role].mapped, 0),
    wrCbReadyTeams: teams.filter((team) => team.wrCbReady).length,
  };
  const complete = input.rows.length > 0 && teams.every((team) => team.eligibleRows > 0);
  const requiredEvidenceRows = teams.flatMap((team) => {
    const teamRows = input.rows.filter((row) =>
      normalizeTeamCode(input.providerTeamCodes.get(row.providerTeamId)).normalizedTeam === team.team);
    const roles = canonicalAuditRoles(teamRows.filter((row) =>
      mappingByRow.get(row.providerDepthChartId)?.mappedGridlinePlayerId));
    return REQUIRED_ROLES.flatMap((role) => roles.get(role) ? [roles.get(role)!] : []);
  });
  const providerTimes = requiredEvidenceRows
    .map((row) => row.providerUpdatedAt?.getTime())
    .filter((value): value is number => value !== undefined && value !== null);
  const oldestRequiredProviderUpdate = providerTimes.sort((a, b) => a - b)[0] ?? null;
  const fresh = requiredEvidenceRows.length === 32 * REQUIRED_ROLES.length
    && providerTimes.length === requiredEvidenceRows.length
    && oldestRequiredProviderUpdate !== null
    && input.capturedAt.getTime() - oldestRequiredProviderUpdate <= 24 * 60 * 60 * 1000;
  const disagreements = input.currentComparison?.flatMap((currentTeam) => {
    const teamRows = input.rows.filter((row) =>
      normalizeTeamCode(input.providerTeamCodes.get(row.providerTeamId)).normalizedTeam === currentTeam.team);
    const candidateRoles = canonicalAuditRoles(teamRows.filter((row) =>
      mappingByRow.get(row.providerDepthChartId)?.mappedGridlinePlayerId));
    return [...candidateRoles.entries()].flatMap(([role, row]) => {
      const currentIds = currentTeam.players
        .filter((player) => player.starter && (
          normalizePosition(player.position) === normalizePosition(row.originalPosition)
          || player.role?.toUpperCase() === row.originalPosition?.toUpperCase()))
        .map((player) => player.playerId);
      const candidateId = mappingByRow.get(row.providerDepthChartId)?.mappedGridlinePlayerId ?? null;
      return currentIds.length && candidateId && !currentIds.includes(candidateId)
        ? [{ team: currentTeam.team, role, candidatePlayerId: candidateId, currentPlayerIds: currentIds }]
        : [];
    });
  }) ?? [];
  const materialImprovement = complete
    && teams.every((team) => team.missingRoleCount === 0)
    && candidate.cb1 > (current.cb1 ?? Infinity)
    && candidate.cb2 > (current.cb2 ?? Infinity)
    && candidate.safeties > (current.safeties ?? Infinity)
    && candidate.edge > (current.edge ?? Infinity)
    && candidate.exactOffensiveLine > (current.exactOffensiveLine ?? Infinity)
    && ambiguousCount === 0
    && fresh
    && input.productionUseVerified === true
    && input.commercialLicenseVerified === true;
  return {
    expectedTeamCount: 32,
    observedTeamCount: teams.filter((team) => team.eligibleRows > 0).length,
    rows: { eligible: input.rows.length, mapped: mappedCount, ambiguous: ambiguousCount, unmatched: unmatchedCount },
    teams,
    roleCoverage,
    currentVersusCandidate: { current, candidate },
    freshness: {
      capturedAt: input.capturedAt.toISOString(),
      oldestProviderUpdate: input.rows.map((row) => row.providerUpdatedAt?.getTime())
        .filter((value): value is number => value !== undefined && value !== null)
        .sort((a, b) => a - b)[0] ?? null,
      oldestRequiredProviderUpdate,
      current: fresh,
    },
    sourceConflicts: {
      identityAmbiguities: ambiguousCount,
      collisions: input.mappings.filter((item) => item.collision).length,
      disagreements,
      currentPersonnelConflicts: input.currentComparison?.flatMap((team) =>
        team.conflicts.map((conflict) => ({ team: team.team, ...conflict }))) ?? [],
    },
    proposedHierarchy: ["official_team_or_nfl", "sportsdataio_candidate", "sleeper", "participation", "historical"],
    hierarchyActivated: false,
    finalVerdict: materialImprovement
      ? SPORTSDATAIO_FINAL_VERDICTS[0] : SPORTSDATAIO_FINAL_VERDICTS[1],
  };
}

function currentCoverageFromComparison(teams: CurrentComparisonTeam[]) {
  const all = teams.flatMap((team) => team.players);
  const cbStarters = teams.flatMap((team) =>
    team.players.filter((player) => normalizePosition(player.position) === "CB" && player.starter)
      .sort((left, right) => (left.rank ?? 999) - (right.rank ?? 999)));
  return {
    overall: all.length,
    starters: all.filter((player) => player.starter).length,
    cb1: teams.filter((team) =>
      team.players.some((player) => normalizePosition(player.position) === "CB" && player.starter)).length,
    cb2: teams.filter((team) =>
      team.players.filter((player) => normalizePosition(player.position) === "CB" && player.starter).length >= 2).length,
    safeties: all.filter((player) => normalizePosition(player.position) === "S" && player.starter).length,
    edge: all.filter((player) => normalizePosition(player.position) === "EDGE" && player.starter).length,
    exactOffensiveLine: all.filter((player) =>
      ["LT", "LG", "C", "RG", "RT"].includes(player.role?.toUpperCase() ?? "")
      && player.starter).length,
    wrCbReadyTeams: teams.filter((team) =>
      team.players.filter((player) => normalizePosition(player.position) === "WR" && player.starter).length >= 3
      && team.players.filter((player) => normalizePosition(player.position) === "CB" && player.starter).length >= 2).length,
    cbStarterRows: cbStarters.length,
  };
}

export async function sportsDataIoAccessPreflight(fetchImpl: typeof fetch = fetch) {
  const apiKey = process.env.SPORTSDATAIO_API_KEY;
  const facts = {
    endpoint: SPORTSDATAIO_DEPTH_ENDPOINT,
    authenticationMethod: "Ocp-Apim-Subscription-Key request header (query key is documented but not used)",
    documentedCallInterval: "15 Minutes",
    accountTierAccess: "Not verified",
    productionUseAllowance: "Not verified; SportsDataIO states production keys are provisioned by sales",
    commercialLicensingLimitation: "Commercial redistribution/use is not assumed; written plan/license confirmation is required",
  };
  if (!apiKey) return {
    status: "inaccessible" as const,
    ...facts,
    limitation: "SPORTSDATAIO_API_KEY is not configured; no provider request was made.",
  };
  const response = await fetchImpl(SPORTSDATAIO_DEPTH_ENDPOINT, {
    headers: {
      Accept: "application/json",
      "Ocp-Apim-Subscription-Key": apiKey,
      "User-Agent": "Gridline/0.2 (depth evaluation)",
    },
    signal: AbortSignal.timeout(30_000),
  });
  if (!response.ok) return {
    status: "inaccessible" as const,
    ...facts,
    limitation: `SportsDataIO depth preflight returned HTTP ${response.status}; no payload was retained.`,
  };
  return { status: "accessible" as const, ...facts, limitation: null, response };
}

export async function runSportsDataIoDepthEvaluation(options?: {
  fetchImpl?: typeof fetch;
  providerTeamCodes?: ReadonlyMap<string, string>;
  candidates?: GridlineIdentityCandidate[];
  crosswalks?: ReadonlyMap<string, string>;
  currentCoverage?: Partial<Record<string, number>>;
  productionUseVerified?: boolean;
  commercialLicenseVerified?: boolean;
}) {
  const runId = randomUUID();
  const preflight = await sportsDataIoAccessPreflight(options?.fetchImpl);
  await db.insert(sportsDataIoEvaluationRunsTable).values({
    runId,
    status: preflight.status,
    endpoint: preflight.endpoint,
    authenticationMethod: preflight.authenticationMethod,
    accountAccess: preflight.accountTierAccess,
    documentedCallInterval: preflight.documentedCallInterval,
    productionUseVerified: false,
    commercialLicenseVerified: false,
    limitation: preflight.limitation,
    completedAt: preflight.status === "inaccessible" ? new Date() : null,
    metadata: { mappingVersion: SPORTSDATAIO_MAPPING_VERSION, rawProviderPayloadStored: false },
  });
  if (preflight.status === "inaccessible") return {
    runId,
    preflight,
    audit: null,
    publishRequired: false,
    phase61Boundary: {
      featureSchemaChanged: false, modelChanged: false, predictionPathChanged: false,
      productionDepthPrecedenceChanged: false, consumerPayloadExposed: false,
    },
    finalVerdict: SPORTSDATAIO_FINAL_VERDICTS[1],
  };
  const capturedAt = new Date();
  const rows = parseSportsDataIoDepthCharts(await preflight.response.json(), capturedAt);
  const providerTeamCodes = options?.providerTeamCodes ?? await fetchSportsDataIoTeamCodes(options?.fetchImpl);
  const [candidateEvidence, currentComparison, verifiedCrosswalks] = await Promise.all([
    options?.candidates ? Promise.resolve(null) : loadGridlineIdentityCandidates(),
    getCurrentDepthComparisonEvidence(capturedAt),
    options?.crosswalks ? Promise.resolve(options.crosswalks) : loadSportsDataIoCrosswalks(),
  ]);
  const loadedCandidates = options?.candidates ?? candidateEvidence!.candidates;
  const mappings = mapSportsDataIoRows(
    rows,
    loadedCandidates,
    providerTeamCodes,
    verifiedCrosswalks,
  );
  await db.transaction(async (tx) => {
    if (rows.length) await tx.insert(sportsDataIoDepthEvidenceTable).values(rows.map((row) => ({ runId, ...row })));
    if (mappings.length) await tx.insert(sportsDataIoIdentityMappingsTable).values(mappings.map((mapping) => ({ runId, ...mapping })));
    await tx.update(sportsDataIoEvaluationRunsTable).set({
      status: "completed",
      capturedAt,
      completedAt: new Date(),
      metadata: { mappingVersion: SPORTSDATAIO_MAPPING_VERSION, rowCount: rows.length, rawProviderPayloadStored: false },
    }).where(eq(sportsDataIoEvaluationRunsTable.runId, runId));
  });
  const audit = auditSportsDataIoDepth({
    rows, mappings, capturedAt,
    providerTeamCodes,
    currentCoverage: options?.currentCoverage,
    productionUseVerified: options?.productionUseVerified,
    commercialLicenseVerified: options?.commercialLicenseVerified,
    currentComparison,
  });
  return {
    runId, preflight: { ...preflight, response: undefined }, audit,
    publishRequired: false,
    phase61Boundary: {
      featureSchemaChanged: false, modelChanged: false, predictionPathChanged: false,
      productionDepthPrecedenceChanged: false, consumerPayloadExposed: false,
    },
    finalVerdict: audit.finalVerdict,
  };
}

async function loadSportsDataIoCrosswalks() {
  const rows = await db.select().from(playerIdentityCrosswalkRevisionsTable)
    .where(eq(playerIdentityCrosswalkRevisionsTable.sourceNamespace, "sportsdataio"))
    .orderBy(
      playerIdentityCrosswalkRevisionsTable.sourcePlayerId,
      desc(playerIdentityCrosswalkRevisionsTable.revision),
      desc(playerIdentityCrosswalkRevisionsTable.id),
    );
  const latest = new Map<string, string>();
  const seen = new Set<string>();
  for (const row of rows) {
    if (seen.has(row.sourcePlayerId)) continue;
    seen.add(row.sourcePlayerId);
    if (row.ambiguityFlag) continue;
    latest.set(row.sourcePlayerId, row.gridlinePlayerId);
  }
  return latest;
}

async function fetchSportsDataIoTeamCodes(fetchImpl: typeof fetch = fetch) {
  const apiKey = process.env.SPORTSDATAIO_API_KEY;
  if (!apiKey) throw new Error("SportsDataIO team metadata requires configured access");
  const response = await fetchImpl("https://api.sportsdata.io/v3/nfl/scores/json/Teams", {
    headers: {
      Accept: "application/json",
      "Ocp-Apim-Subscription-Key": apiKey,
      "User-Agent": "Gridline/0.2 (depth evaluation)",
    },
    signal: AbortSignal.timeout(30_000),
  });
  if (!response.ok) throw new Error(`SportsDataIO team metadata returned HTTP ${response.status}`);
  const payload = await response.json();
  if (!Array.isArray(payload)) throw new Error("SportsDataIO team metadata must be an array");
  return new Map(payload.flatMap((value) => {
    const team = record(value);
    const providerId = id(team.TeamID);
    const code = text(team.Key);
    return providerId && code ? [[providerId, code] as const] : [];
  }));
}

export function isExactSportsDataIoRole(role: string | null) {
  return Boolean(role && EXACT_ROLES.has(role.replace(/\d+$/, "")));
}