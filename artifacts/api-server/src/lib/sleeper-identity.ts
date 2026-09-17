import { createHash, randomUUID } from "node:crypto";
import {
  desc,
  eq,
  lte,
  sql,
} from "drizzle-orm";
import {
  db,
  historicalDepthChartTable,
  playerGameStatsTable,
  playersTable,
  sleeperIdentityMappingRunsTable,
  sleeperIdentityMappingsTable,
  sleeperPlayerSnapshotsTable,
  snapCountsTable,
  teamsTable,
} from "@workspace/db";
import { SLEEPER_ACTIVE_TEAM_CODES, type SleeperPlayer } from "./sleeper";
import { logger } from "./logger";

export const SLEEPER_MAPPING_VERSION = "sleeper-identity-v3";
export const DEPTH_MAPPING_SUITABILITY_MIN_PERCENT = 90;

export type MappingStatus =
  | "exact_provider_id"
  | "exact_crosswalk"
  | "normalized_name_team_position"
  | "supported_name_match"
  | "ambiguous"
  | "unmatched";

export type MappingMethod = MappingStatus | "none";

export type TeamNormalization = {
  originalTeam: string | null;
  normalizedTeam: string | null;
  method: "canonical" | "legacy_alias" | "missing" | "unknown";
};

export type PositionNormalization = {
  originalPosition: string | null;
  normalizedPosition: string | null;
  compatibility: "compatible" | "incompatible" | "unknown";
};

export type GridlineIdentityCandidate = {
  gridlinePlayerId: string;
  name: string;
  normalizedName: string;
  normalizedTeam: string | null;
  position: string | null;
  normalizedPosition: string | null;
  externalIds: Record<string, string>;
  sources: string[];
  sourceCount: number;
  latestSeason: number | null;
  latestWeek: number | null;
  teamCodes: string[];
};

type SnapshotStateRow = {
  sleeperPlayerId: string;
  capturedAt: Date;
  id: number;
};

export type SleeperIdentityMapping = {
  sleeperPlayerId: string;
  sourceHash: string;
  mappedGridlinePlayerId: string | null;
  mappingStatus: MappingStatus;
  mappingMethod: MappingMethod;
  mappingConfidence: number;
  originalTeam: string | null;
  normalizedTeam: string | null;
  teamNormalizationMethod: TeamNormalization["method"];
  originalPosition: string | null;
  normalizedPosition: string | null;
  positionCompatibility: PositionNormalization["compatibility"];
  evidenceSummary: string;
  candidateGridlinePlayerIds: string[];
  candidateEvidence: Array<Record<string, unknown>>;
  ambiguityReason: string | null;
  unmatchedReason: string | null;
  teamChangeEvidence: Record<string, unknown> | null;
  depthRelevant: boolean;
};

type CandidateRecord = {
  gridlinePlayerId: string;
  name: string;
  position: string | null;
  team: string | null;
  source: string;
  externalIdType: string | null;
  externalIdValue: string | null;
  season?: number | null;
  week?: number | null;
};

const TEAM_ALIASES: Record<string, string> = {
  OAK: "LV",
  SD: "LAC",
  STL: "LAR",
  JAC: "JAX",
  WAS: "WSH",
};

const NFL_TEAMS = new Set([
  "ARI", "ATL", "BAL", "BUF", "CAR", "CHI", "CIN", "CLE",
  "DAL", "DEN", "DET", "GB", "HOU", "IND", "JAX", "KC",
  "LAC", "LAR", "LV", "MIA", "MIN", "NE", "NO", "NYG",
  "NYJ", "PHI", "PIT", "SEA", "SF", "TB", "TEN", "WSH",
]);

const POSITION_ALIASES: Record<string, string> = {
  PK: "K",
  DE: "EDGE",
  EDGE: "EDGE",
  NT: "DT",
  DL: "DL",
  T: "OT",
  LT: "OT",
  RT: "OT",
  G: "OG",
  LG: "OG",
  RG: "OG",
  FB: "RB",
  ILB: "LB",
  OLB: "LB",
  LS: "LS",
};

const POSITION_GROUPS = [
  "QB", "RB", "WR", "TE", "OL", "EDGE", "DE", "DT", "LB", "CB", "S", "K", "P",
] as const;

const STABLE_PROVIDER_ID_TYPES = new Set([
  "gsis_id",
  "espn_id",
  "pfr_id",
  "sportradar_id",
  "yahoo_id",
  "rotowire_id",
]);

function cleanId(value: unknown) {
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  if (typeof value === "string" && value.trim()) return value.trim();
  return null;
}

export function normalizeTeamCode(team: string | null | undefined): TeamNormalization {
  const originalTeam = typeof team === "string" && team.trim() ? team.trim() : null;
  const canonicalTeam = originalTeam?.toUpperCase() ?? null;
  if (!canonicalTeam) {
    return { originalTeam, normalizedTeam: null, method: "missing" };
  }
  const aliased = TEAM_ALIASES[canonicalTeam];
  if (aliased) {
    return { originalTeam, normalizedTeam: aliased, method: "legacy_alias" };
  }
  return {
    originalTeam,
    normalizedTeam: NFL_TEAMS.has(canonicalTeam) ? canonicalTeam : null,
    method: NFL_TEAMS.has(canonicalTeam) ? "canonical" : "unknown",
  };
}

export function normalizePlayerName(name: string | null | undefined) {
  if (!name) return "";
  return name
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[’']/g, "")
    .replace(/-/g, " ")
    .replace(/\./g, "")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase()
    .split(" ")
    .filter((part) => !/^(jr|sr|ii|iii|iv|v)$/i.test(part))
    .join(" ");
}

export function normalizePosition(position: string | null | undefined): string | null {
  if (!position || !position.trim()) return null;
  const upper = position.trim().toUpperCase();
  return POSITION_ALIASES[upper] ?? upper;
}

export function positionCompatibility(
  left: string | null | undefined,
  right: string | null | undefined,
): PositionNormalization["compatibility"] {
  const normalizedLeft = normalizePosition(left);
  const normalizedRight = normalizePosition(right);
  if (!normalizedLeft || !normalizedRight) return "unknown";
  if (normalizedLeft === normalizedRight) return "compatible";
  if (
    (normalizedLeft === "EDGE" && normalizedRight === "DE")
    || (normalizedLeft === "DE" && normalizedRight === "EDGE")
    || (normalizedLeft === "DT" && normalizedRight === "DL")
    || (normalizedLeft === "DL" && normalizedRight === "DT")
  ) return "compatible";
  return "incompatible";
}

function providerIdEntries(providerIds: Record<string, unknown>) {
  return Object.entries(providerIds)
    .map(([type, value]) => [type.toLowerCase(), cleanId(value)] as const)
    .filter(([type, value]) => STABLE_PROVIDER_ID_TYPES.has(type) && value !== null);
}

function isGsisId(value: string) {
  return /^00-\d{7}$/.test(value);
}

function isNumericId(value: string) {
  return /^\d+$/.test(value);
}

function isLikelyPfrId(value: string) {
  return /^[A-Za-z]{4,}[A-Za-z0-9]*\d{2}$/.test(value) && !value.includes(":");
}

export function inferCandidateProviderIdType(
  source: CandidateRecord["source"],
  value: string,
) {
  if (source === "players") return isNumericId(value) ? "espn_id" : null;
  if (source === "player_game_stats") return isGsisId(value) ? "gsis_id" : null;
  if (source === "snap_counts") return isLikelyPfrId(value) ? "pfr_id" : null;
  if (source === "historical_depth_charts") {
    if (isGsisId(value)) return "gsis_id";
    return null;
  }
  return null;
}

function candidateEvidence(candidate: GridlineIdentityCandidate) {
  return {
    gridlinePlayerId: candidate.gridlinePlayerId,
    name: candidate.name,
    normalizedTeam: candidate.normalizedTeam,
    normalizedPosition: candidate.normalizedPosition,
    externalIds: candidate.externalIds,
    sources: candidate.sources,
    sourceCount: candidate.sourceCount,
    latestSeason: candidate.latestSeason,
    latestWeek: candidate.latestWeek,
    teamCodes: candidate.teamCodes,
  };
}

export function deduplicateGridlineCandidates(records: CandidateRecord[]) {
  const candidates = new Map<string, GridlineIdentityCandidate>();
  for (const record of records) {
    const id = cleanId(record.gridlinePlayerId);
    if (!id || !record.name.trim()) continue;
    const team = normalizeTeamCode(record.team);
    const position = normalizePosition(record.position);
    const normalizedName = normalizePlayerName(record.name);
    const existing = candidates.get(id);
    if (!existing) {
      candidates.set(id, {
        gridlinePlayerId: id,
        name: record.name,
        normalizedName,
        normalizedTeam: team.normalizedTeam,
        position: record.position,
        normalizedPosition: position,
        externalIds: record.externalIdType && record.externalIdValue
          ? { [record.externalIdType.toLowerCase()]: record.externalIdValue }
          : {},
        sources: [record.source],
        sourceCount: 1,
        latestSeason: record.season ?? null,
        latestWeek: record.week ?? null,
        teamCodes: team.normalizedTeam ? [team.normalizedTeam] : [],
      });
      continue;
    }
    if (record.externalIdType && record.externalIdValue) {
      existing.externalIds[record.externalIdType.toLowerCase()] = record.externalIdValue;
    }
    if (!existing.sources.includes(record.source)) {
      existing.sources.push(record.source);
      existing.sourceCount += 1;
    }
    if (team.normalizedTeam && !existing.teamCodes.includes(team.normalizedTeam)) {
      existing.teamCodes.push(team.normalizedTeam);
    }
    if (
      (record.season ?? -1) > (existing.latestSeason ?? -1)
      || ((record.season ?? -1) === (existing.latestSeason ?? -1) && (record.week ?? -1) > (existing.latestWeek ?? -1))
    ) {
      existing.latestSeason = record.season ?? null;
      existing.latestWeek = record.week ?? null;
      existing.normalizedTeam = team.normalizedTeam ?? existing.normalizedTeam;
      existing.position = record.position ?? existing.position;
      existing.normalizedPosition = position ?? existing.normalizedPosition;
    }
  }
  return [...candidates.values()].sort((left, right) =>
    left.gridlinePlayerId.localeCompare(right.gridlinePlayerId));
}

export function mappingCandidateFingerprint(
  candidates: GridlineIdentityCandidate[],
) {
  const material = candidates.map((candidate) => ({
    gridlinePlayerId: candidate.gridlinePlayerId,
    normalizedName: candidate.normalizedName,
    normalizedTeam: candidate.normalizedTeam,
    normalizedPosition: candidate.normalizedPosition,
    externalIds: Object.fromEntries(
      Object.entries(candidate.externalIds).sort(([left], [right]) => left.localeCompare(right)),
    ),
    sources: [...candidate.sources].sort(),
    latestSeason: candidate.latestSeason,
    latestWeek: candidate.latestWeek,
    teamCodes: [...candidate.teamCodes].sort(),
  }));
  return createHash("sha256").update(JSON.stringify(material)).digest("hex");
}

function confidenceFor(status: MappingStatus) {
  return status === "exact_provider_id"
    ? 1
    : status === "exact_crosswalk"
      ? 0.98
      : status === "normalized_name_team_position"
        ? 0.9
        : status === "supported_name_match"
          ? 0.72
          : 0;
}

type MappingIndexes = {
  byProviderId: Map<string, GridlineIdentityCandidate[]>;
  byName: Map<string, GridlineIdentityCandidate[]>;
};

function buildMappingIndexes(candidates: GridlineIdentityCandidate[]): MappingIndexes {
  const byProviderId = new Map<string, GridlineIdentityCandidate[]>();
  const byName = new Map<string, GridlineIdentityCandidate[]>();
  for (const candidate of candidates) {
    const nameGroup = byName.get(candidate.normalizedName) ?? [];
    nameGroup.push(candidate);
    byName.set(candidate.normalizedName, nameGroup);
    for (const [type, value] of Object.entries(candidate.externalIds)) {
      const key = `${type}:${value}`;
      const idGroup = byProviderId.get(key) ?? [];
      idGroup.push(candidate);
      byProviderId.set(key, idGroup);
    }
  }
  return { byProviderId, byName };
}

function mapSleeperPlayerWithIndexes(
  player: SleeperPlayer,
  indexes: MappingIndexes,
): SleeperIdentityMapping {
  const team = normalizeTeamCode(player.team);
  const normalizedPosition = normalizePosition(player.position);
  const providerIds = new Map(providerIdEntries(player.provider_ids));
  const byExactId = [...new Map(
    [...providerIds.entries()]
      .flatMap(([type, value]) => indexes.byProviderId.get(`${type}:${value}`) ?? [])
      .map((candidate) => [candidate.gridlinePlayerId, candidate] as const),
  ).values()];

  let status: MappingStatus = "unmatched";
  let selected: GridlineIdentityCandidate | null = null;
  let candidatesForEvidence = byExactId;
  let ambiguityReason: string | null = null;
  let unmatchedReason: string | null = null;

  if (byExactId.length > 0) {
    const exactIds = new Set(byExactId.map((candidate) => candidate.gridlinePlayerId));
    if (exactIds.size === 1) {
      selected = byExactId[0] ?? null;
      status = "exact_provider_id";
    } else {
      status = "ambiguous";
      ambiguityReason = "Multiple exact provider IDs resolve to different Gridline identities.";
    }
  } else {
    const nameCandidates = (indexes.byName.get(normalizePlayerName(player.full_name)) ?? [])
      .filter((candidate) => positionCompatibility(player.position, candidate.position) === "compatible");
    const sameTeam = nameCandidates.filter((candidate) =>
      team.normalizedTeam !== null && candidate.normalizedTeam === team.normalizedTeam);
    if (sameTeam.length === 1) {
      selected = sameTeam[0] ?? null;
      status = "normalized_name_team_position";
      candidatesForEvidence = sameTeam;
    } else if (sameTeam.length > 1) {
      status = "ambiguous";
      ambiguityReason = "Multiple Gridline identities share the normalized name, team, and compatible position.";
      candidatesForEvidence = sameTeam;
    } else if (nameCandidates.length > 0) {
      status = "ambiguous";
      ambiguityReason = "Name and position match, but latest team evidence is absent or conflicting.";
      candidatesForEvidence = nameCandidates;
    } else {
      unmatchedReason = "No stable provider ID or constrained name/team/position candidate was found.";
    }
  }

  const mappedTeamChanged = Boolean(
    selected
    && team.normalizedTeam
    && selected.teamCodes.length > 0
    && !selected.teamCodes.includes(team.normalizedTeam),
  );
  const mappingPositionCompatibility = selected
    ? positionCompatibility(player.position, selected.position)
    : normalizedPosition ? "unknown" : "unknown";

  return {
    sleeperPlayerId: player.player_id,
    sourceHash: "",
    mappedGridlinePlayerId: selected?.gridlinePlayerId ?? null,
    mappingStatus: status,
    mappingMethod: status,
    mappingConfidence: confidenceFor(status),
    originalTeam: team.originalTeam,
    normalizedTeam: team.normalizedTeam,
    teamNormalizationMethod: team.method,
    originalPosition: player.position,
    normalizedPosition,
    positionCompatibility: mappingPositionCompatibility,
    evidenceSummary: selected
      ? `${status} using ${candidatesForEvidence.length} candidate record(s).`
      : ambiguityReason ?? unmatchedReason ?? "No mapping evidence.",
    candidateGridlinePlayerIds: candidatesForEvidence.map((candidate) => candidate.gridlinePlayerId),
    candidateEvidence: candidatesForEvidence.map(candidateEvidence),
    ambiguityReason,
    unmatchedReason,
    teamChangeEvidence: mappedTeamChanged
      ? {
        sleeperTeam: team.normalizedTeam,
        gridlineTeams: selected?.teamCodes ?? [],
        explainableByStableIdentity: status === "exact_provider_id",
      }
      : null,
    depthRelevant: player.depth_chart_order !== null,
  };
}

export function mapSleeperPlayer(
  player: SleeperPlayer,
  candidates: GridlineIdentityCandidate[],
): SleeperIdentityMapping {
  return mapSleeperPlayerWithIndexes(player, buildMappingIndexes(candidates));
}

export function mapSleeperPlayers(
  players: SleeperPlayer[],
  candidates: GridlineIdentityCandidate[],
) {
  const indexes = buildMappingIndexes(candidates);
  const mappings = players.map((player) => mapSleeperPlayerWithIndexes(player, indexes));
  const mappedByGridline = new Map<string, SleeperIdentityMapping[]>();
  for (const mapping of mappings) {
    if (!mapping.mappedGridlinePlayerId || mapping.mappingStatus === "ambiguous") continue;
    const group = mappedByGridline.get(mapping.mappedGridlinePlayerId) ?? [];
    group.push(mapping);
    mappedByGridline.set(mapping.mappedGridlinePlayerId, group);
  }
  let collisionCount = 0;
  for (const group of mappedByGridline.values()) {
    if (group.length < 2) continue;
    collisionCount += 1;
    for (const mapping of group) {
      mapping.mappingStatus = "ambiguous";
      mapping.mappingMethod = "ambiguous";
      mapping.mappingConfidence = 0;
      mapping.mappedGridlinePlayerId = null;
      mapping.ambiguityReason = "Multiple Sleeper players resolve to one Gridline identity.";
      mapping.evidenceSummary = mapping.ambiguityReason;
    }
  }
  return { mappings, collisionCount };
}

function percent(numerator: number, denominator: number) {
  return denominator ? Number(((numerator / denominator) * 100).toFixed(2)) : 0;
}

export function calculateMappingCoverage(
  players: SleeperPlayer[],
  mappings: SleeperIdentityMapping[],
  collisionCount = 0,
) {
  const total = players.length;
  const mapped = mappings.filter((mapping) => mapping.mappedGridlinePlayerId);
  const countByStatus = (status: MappingStatus) =>
    mappings.filter((mapping) => mapping.mappingStatus === status).length;
  const positionCoverage = Object.fromEntries(POSITION_GROUPS.map((position) => {
    const relevant = mappings.filter((mapping) => mapping.normalizedPosition === position);
    const relevantMapped = relevant.filter((mapping) => mapping.mappedGridlinePlayerId);
    return [position, {
      total: relevant.length,
      mapped: relevantMapped.length,
      percentage: percent(relevantMapped.length, relevant.length),
      ambiguous: relevant.filter((mapping) => mapping.mappingStatus === "ambiguous").length,
      unmatched: relevant.filter((mapping) => mapping.mappingStatus === "unmatched").length,
    }];
  }));
  const depth = mappings.filter((mapping) => mapping.depthRelevant);
  const depthOne = mappings.filter((mapping, index) =>
    players[index]?.depth_chart_order === 1);
  const active = mappings.filter((mapping) => mapping.normalizedTeam);
  const depthOrder = {
    total: depth.length,
    mapped: depth.filter((mapping) => mapping.mappedGridlinePlayerId).length,
    percentage: percent(depth.filter((mapping) => mapping.mappedGridlinePlayerId).length, depth.length),
  };
  const depthOrderOne = {
    total: depthOne.length,
    mapped: depthOne.filter((mapping) => mapping.mappedGridlinePlayerId).length,
    percentage: percent(depthOne.filter((mapping) => mapping.mappedGridlinePlayerId).length, depthOne.length),
  };
  const suitableForDepthLogic = depthOrder.percentage >= DEPTH_MAPPING_SUITABILITY_MIN_PERCENT
    && depthOrderOne.percentage >= DEPTH_MAPPING_SUITABILITY_MIN_PERCENT
    && collisionCount === 0;
  return {
    totalSleeperRows: total,
    currentTeamRows: active.length,
    mappedCount: mapped.length,
    exactProviderIdCount: countByStatus("exact_provider_id"),
    crosswalkCount: countByStatus("exact_crosswalk"),
    normalizedNameTeamPositionCount: countByStatus("normalized_name_team_position"),
    supportedNameCount: countByStatus("supported_name_match"),
    ambiguousCount: countByStatus("ambiguous"),
    unmatchedCount: countByStatus("unmatched"),
    overallMappingPercentage: percent(mapped.length, total),
    exactProviderIdPercentage: percent(countByStatus("exact_provider_id"), total),
    crosswalkPercentage: percent(countByStatus("exact_crosswalk"), total),
    nameTeamPositionPercentage: percent(countByStatus("normalized_name_team_position"), total),
    supportedNamePercentage: percent(countByStatus("supported_name_match"), total),
    byPosition: positionCoverage,
    depthOrder,
    depthOrderOne,
    teamAliasNormalizationCount: mappings.filter((mapping) => mapping.teamNormalizationMethod === "legacy_alias").length,
    collisionCount,
    suitabilityMinimumPercentage: DEPTH_MAPPING_SUITABILITY_MIN_PERCENT,
    suitableForDepthLogic,
    suitabilityVerdict: suitableForDepthLogic
      ? "SLEEPER MAPPING SUITABLE FOR DEPTH LOGIC"
      : "SLEEPER MAPPING NOT SUITABLE FOR DEPTH LOGIC",
  };
}

export type DepthRelevantCandidate = {
  team: string;
  role: "QB1" | "QB2" | "RB1" | "WR" | "TE1" | "CB1" | "CB2";
  sleeperPlayerId: string | null;
  sleeperName: string | null;
  position: string | null;
  depthOrder: number | null;
  mappedGridlinePlayerId: string | null;
  mappingMethod: MappingMethod;
  mappingConfidence: number;
};

export function deriveDepthRelevantCandidates(
  players: SleeperPlayer[],
  mappings: SleeperIdentityMapping[],
) {
  const mappingById = new Map(mappings.map((mapping) => [mapping.sleeperPlayerId, mapping]));
  const result: DepthRelevantCandidate[] = [];
  const teams = [...SLEEPER_ACTIVE_TEAM_CODES]
    .map((team) => team === "WAS" ? "WSH" : team)
    .sort();
  for (const team of teams) {
    const teamPlayers = players
      .filter((player) => normalizeTeamCode(player.team).normalizedTeam === team && player.depth_chart_order !== null)
      .sort((left, right) => (left.depth_chart_order ?? 999) - (right.depth_chart_order ?? 999) || left.player_id.localeCompare(right.player_id));
    const add = (player: SleeperPlayer | undefined, role: DepthRelevantCandidate["role"]) => {
      if (!team) return;
      const mapping = player ? mappingById.get(player.player_id) : undefined;
      result.push({
        team,
        role,
        sleeperPlayerId: player?.player_id ?? null,
        sleeperName: player?.full_name ?? null,
        position: player?.position ?? null,
        depthOrder: player?.depth_chart_order ?? null,
        mappedGridlinePlayerId: mapping?.mappedGridlinePlayerId ?? null,
        mappingMethod: mapping?.mappingMethod ?? "none",
        mappingConfidence: mapping?.mappingConfidence ?? 0,
      });
    };
    const byPosition = (position: string) => teamPlayers.filter((player) =>
      normalizePosition(player.depth_chart_position ?? player.position) === position);
    add(byPosition("QB")[0], "QB1");
    add(byPosition("QB")[1], "QB2");
    add(byPosition("RB")[0], "RB1");
    for (const player of byPosition("WR").slice(0, 3)) add(player, "WR");
    add(byPosition("TE")[0], "TE1");
    add(byPosition("CB")[0], "CB1");
    add(byPosition("CB")[1], "CB2");
  }
  return result;
}

export function buildValidationSample(
  players: SleeperPlayer[],
  mappings: SleeperIdentityMapping[],
) {
  const mappingById = new Map(mappings.map((mapping) => [mapping.sleeperPlayerId, mapping]));
  const positionOrder = ["QB", "RB", "WR", "TE", "CB"];
  const teams = [...new Set(players
    .map((player) => normalizeTeamCode(player.team).normalizedTeam)
    .filter((team): team is string => Boolean(team)))].sort().slice(0, 10);
  const sample: Array<Record<string, unknown>> = [];
  const included = new Set<string>();
  const addPlayer = (player: SleeperPlayer, team: string, position: string) => {
    if (included.has(player.player_id)) return;
    included.add(player.player_id);
    const mapping = mappingById.get(player.player_id);
    sample.push({
      team,
      position,
      sleeperPlayerId: player.player_id,
      sleeperName: player.full_name,
      mappedGridlinePlayerId: mapping?.mappedGridlinePlayerId ?? null,
      mappingMethod: mapping?.mappingMethod ?? "none",
      mappingConfidence: mapping?.mappingConfidence ?? 0,
      ambiguityReason: mapping?.ambiguityReason ?? null,
      originalTeam: mapping?.originalTeam ?? null,
      teamNormalizationMethod: mapping?.teamNormalizationMethod ?? null,
    });
  };
  for (const team of teams) {
    const teamPlayers = players.filter((player) =>
      normalizeTeamCode(player.team).normalizedTeam === team
      && positionOrder.includes(normalizePosition(player.position) ?? ""));
    for (const position of positionOrder) {
      const player = teamPlayers
        .filter((candidate) => normalizePosition(candidate.position) === position)
        .sort((left, right) => left.player_id.localeCompare(right.player_id))[0];
      if (player) addPlayer(player, team, position);
    }
  }
  for (const requiredStatus of [
    "exact_provider_id",
    "normalized_name_team_position",
    "ambiguous",
    "unmatched",
  ] satisfies MappingStatus[]) {
    const index = mappings.findIndex((mapping) =>
      mapping.mappingStatus === requiredStatus
      && !included.has(mapping.sleeperPlayerId)
      && positionOrder.includes(mapping.normalizedPosition ?? ""));
    if (index < 0) continue;
    const mapping = mappings[index]!;
    const sourcePlayer = players.find((player) => player.player_id === mapping.sleeperPlayerId);
    if (sourcePlayer) {
      addPlayer(sourcePlayer, mapping.normalizedTeam ?? mapping.originalTeam ?? "UNKNOWN", mapping.normalizedPosition ?? "UNKNOWN");
    }
  }
  const aliasIndex = mappings.findIndex((mapping) =>
    mapping.teamNormalizationMethod === "legacy_alias" && !included.has(mapping.sleeperPlayerId));
  if (aliasIndex >= 0) {
    const mapping = mappings[aliasIndex]!;
    const sourcePlayer = players.find((player) => player.player_id === mapping.sleeperPlayerId);
    if (sourcePlayer) {
      addPlayer(sourcePlayer, mapping.normalizedTeam ?? "UNKNOWN", mapping.normalizedPosition ?? "UNKNOWN");
    }
  }
  return sample;
}

async function sourceCandidates() {
  const [players, stats, snaps, depth] = await Promise.all([
    db.select({
      playerId: playersTable.playerId,
      name: playersTable.name,
      position: playersTable.position,
      team: teamsTable.abbreviation,
    }).from(playersTable).leftJoin(teamsTable, eq(playersTable.teamId, teamsTable.teamId)),
    db.selectDistinctOn([playerGameStatsTable.playerId], {
      playerId: playerGameStatsTable.playerId,
      name: playerGameStatsTable.playerName,
      position: playerGameStatsTable.position,
      team: playerGameStatsTable.teamId,
      season: playerGameStatsTable.season,
      week: playerGameStatsTable.week,
    }).from(playerGameStatsTable).orderBy(
      playerGameStatsTable.playerId,
      desc(playerGameStatsTable.season),
      desc(playerGameStatsTable.week),
    ),
    db.selectDistinctOn([snapCountsTable.playerId], {
      playerId: snapCountsTable.playerId,
      name: snapCountsTable.playerName,
      position: snapCountsTable.position,
      team: snapCountsTable.teamId,
      season: snapCountsTable.season,
      week: snapCountsTable.week,
    }).from(snapCountsTable).orderBy(
      snapCountsTable.playerId,
      desc(snapCountsTable.season),
      desc(snapCountsTable.week),
    ),
    db.selectDistinctOn([historicalDepthChartTable.playerId], {
      playerId: historicalDepthChartTable.playerId,
      name: historicalDepthChartTable.playerName,
      position: historicalDepthChartTable.position,
      team: historicalDepthChartTable.teamId,
      season: historicalDepthChartTable.season,
      week: historicalDepthChartTable.week,
    }).from(historicalDepthChartTable).orderBy(
      historicalDepthChartTable.playerId,
      desc(historicalDepthChartTable.season),
      desc(historicalDepthChartTable.week),
    ),
  ]);
  const records: CandidateRecord[] = [
    ...players.map((row) => ({
      gridlinePlayerId: row.playerId,
      name: row.name,
      position: row.position,
      team: row.team,
      source: "players",
      externalIdType: inferCandidateProviderIdType("players", row.playerId),
      externalIdValue: inferCandidateProviderIdType("players", row.playerId) ? row.playerId : null,
    })),
    ...stats.map((row) => ({
      gridlinePlayerId: row.playerId,
      name: row.name,
      position: row.position,
      team: row.team,
      season: row.season,
      week: row.week,
      source: "player_game_stats",
      externalIdType: inferCandidateProviderIdType("player_game_stats", row.playerId),
      externalIdValue: inferCandidateProviderIdType("player_game_stats", row.playerId) ? row.playerId : null,
    })),
    ...snaps.map((row) => ({
      gridlinePlayerId: row.playerId,
      name: row.name,
      position: row.position,
      team: row.team,
      season: row.season,
      week: row.week,
      source: "snap_counts",
      externalIdType: inferCandidateProviderIdType("snap_counts", row.playerId),
      externalIdValue: inferCandidateProviderIdType("snap_counts", row.playerId) ? row.playerId : null,
    })),
    ...depth.map((row) => ({
      gridlinePlayerId: row.playerId,
      name: row.name,
      position: row.position,
      team: row.team,
      season: row.season,
      week: row.week,
      source: "historical_depth_charts",
      externalIdType: inferCandidateProviderIdType("historical_depth_charts", row.playerId),
      externalIdValue: inferCandidateProviderIdType("historical_depth_charts", row.playerId) ? row.playerId : null,
    })),
  ];
  return deduplicateGridlineCandidates(records);
}

export function reconstructLatestSleeperState<T extends SnapshotStateRow>(
  rows: T[],
  sourceCapturedAt: Date,
) {
  const latest = new Map<string, T>();
  for (const row of rows) {
    if (row.capturedAt.getTime() > sourceCapturedAt.getTime()) continue;
    const existing = latest.get(row.sleeperPlayerId);
    if (
      !existing
      || row.capturedAt.getTime() > existing.capturedAt.getTime()
      || (row.capturedAt.getTime() === existing.capturedAt.getTime() && row.id > existing.id)
    ) {
      latest.set(row.sleeperPlayerId, row);
    }
  }
  return [...latest.values()].sort((left, right) =>
    left.sleeperPlayerId.localeCompare(right.sleeperPlayerId));
}

async function latestSleeperSnapshot(sourceCapturedAt: Date) {
  return db.selectDistinctOn([sleeperPlayerSnapshotsTable.sleeperPlayerId])
    .from(sleeperPlayerSnapshotsTable)
    .where(lte(sleeperPlayerSnapshotsTable.capturedAt, sourceCapturedAt))
    .orderBy(
      sleeperPlayerSnapshotsTable.sleeperPlayerId,
      desc(sleeperPlayerSnapshotsTable.capturedAt),
      desc(sleeperPlayerSnapshotsTable.id),
    );
}

export async function refreshSleeperIdentityMappings(options: {
  sourceSnapshotId: string;
  sourceCapturedAt: Date;
  jobKey?: string;
  scheduledFor?: Date;
}) {
  const mappingRunId = randomUUID();
  const startedAt = new Date();
  let sourceCapturedAt: Date | null = null;
  try {
    sourceCapturedAt = options.sourceCapturedAt;
    const sourceRows = await latestSleeperSnapshot(sourceCapturedAt);
    const players: SleeperPlayer[] = sourceRows.map((row) => ({
      player_id: row.sleeperPlayerId,
      full_name: row.fullName,
      first_name: row.firstName,
      last_name: row.lastName,
      team: row.team,
      position: row.position,
      fantasy_positions: row.fantasyPositions,
      depth_chart_position: row.depthChartPosition,
      depth_chart_order: row.depthChartOrder,
      status: row.status,
      injury_status: row.injuryStatus,
      practice_participation: row.practiceParticipation,
      years_exp: row.yearsExp,
      age: row.age,
      provider_ids: row.providerIds,
    }));
    const candidates = await sourceCandidates();
    const candidateSetFingerprint = mappingCandidateFingerprint(candidates);
    const mapped = mapSleeperPlayers(players, candidates);
    const coverage = calculateMappingCoverage(players, mapped.mappings, mapped.collisionCount);
    const depthCandidates = deriveDepthRelevantCandidates(players, mapped.mappings);
    const validationSample = buildValidationSample(players, mapped.mappings);
    await db.transaction(async (tx) => {
      await tx.execute(sql`select pg_advisory_xact_lock(hashtext('sleeper-identity-mapping-run'))`);
      await tx.insert(sleeperIdentityMappingRunsTable).values({
        mappingRunId,
        sourceSnapshotId: options.sourceSnapshotId,
        sourceCapturedAt,
        mappingVersion: SLEEPER_MAPPING_VERSION,
        status: "success",
        completedAt: new Date(),
        recordsProcessed: mapped.mappings.length,
        totalSleeperRows: coverage.totalSleeperRows,
        mappedCount: coverage.mappedCount,
        ambiguousCount: coverage.ambiguousCount,
        unmatchedCount: coverage.unmatchedCount,
        collisionCount: mapped.collisionCount,
        metadata: {
          ...coverage,
          durationMs: Date.now() - startedAt.getTime(),
          depthRelevantCandidates: depthCandidates,
          validationSample,
          candidateCount: candidates.length,
          candidateSetFingerprint,
          candidateSetCapturedAt: startedAt.toISOString(),
          mappingVersion: SLEEPER_MAPPING_VERSION,
        },
      });
      for (let index = 0; index < mapped.mappings.length; index += 500) {
        const rows = mapped.mappings.slice(index, index + 500).map((mapping, offset) => {
          const sourceRow = sourceRows[index + offset]!;
          return {
            mappingRunId,
            sourceSnapshotId: options.sourceSnapshotId,
            sleeperPlayerId: mapping.sleeperPlayerId,
            sourceHash: sourceRow.sourceHash,
            mappedGridlinePlayerId: mapping.mappedGridlinePlayerId,
            mappingStatus: mapping.mappingStatus,
            mappingMethod: mapping.mappingMethod,
            mappingConfidence: mapping.mappingConfidence,
            originalTeam: mapping.originalTeam,
            normalizedTeam: mapping.normalizedTeam,
            teamNormalizationMethod: mapping.teamNormalizationMethod,
            originalPosition: mapping.originalPosition,
            normalizedPosition: mapping.normalizedPosition,
            positionCompatibility: mapping.positionCompatibility,
            evidenceSummary: mapping.evidenceSummary,
            candidateGridlinePlayerIds: mapping.candidateGridlinePlayerIds,
            candidateEvidence: mapping.candidateEvidence,
            ambiguityReason: mapping.ambiguityReason,
            unmatchedReason: mapping.unmatchedReason,
            teamChangeEvidence: mapping.teamChangeEvidence,
            depthRelevant: mapping.depthRelevant,
          };
        });
        if (rows.length) await tx.insert(sleeperIdentityMappingsTable).values(rows);
      }
    });
    return {
      status: "success",
      mappingRunId,
      sourceSnapshotId: options.sourceSnapshotId,
      ...coverage,
      durationMs: Date.now() - startedAt.getTime(),
      candidateSetFingerprint,
      depthRelevantCandidates: depthCandidates,
      validationSample,
    };
  } catch (error) {
    await db.insert(sleeperIdentityMappingRunsTable).values({
      mappingRunId,
      sourceSnapshotId: options.sourceSnapshotId,
      sourceCapturedAt,
      status: "failed",
      completedAt: new Date(),
      mappingVersion: SLEEPER_MAPPING_VERSION,
      errorMessage: "Sleeper identity mapping failed.",
      metadata: { durationMs: Date.now() - startedAt.getTime(), mappingVersion: SLEEPER_MAPPING_VERSION },
    });
    logger.error({ error, mappingRunId }, "Sleeper identity mapping failed");
    throw new Error("Sleeper identity mapping failed.", { cause: error });
  }
}

export async function getSleeperIdentityHealth() {
  const [run] = await db.select().from(sleeperIdentityMappingRunsTable)
    .where(eq(sleeperIdentityMappingRunsTable.status, "success"))
    .orderBy(desc(sleeperIdentityMappingRunsTable.startedAt))
    .limit(1);
  const [attempt] = await db.select().from(sleeperIdentityMappingRunsTable)
    .orderBy(desc(sleeperIdentityMappingRunsTable.startedAt))
    .limit(1);
  const recentAttempts = await db.select({
    status: sleeperIdentityMappingRunsTable.status,
  }).from(sleeperIdentityMappingRunsTable)
    .orderBy(desc(sleeperIdentityMappingRunsTable.startedAt))
    .limit(50);
  const ageMs = run?.completedAt ? Math.max(0, Date.now() - run.completedAt.getTime()) : null;
  const current = Boolean(run && ageMs !== null && ageMs <= 48 * 60 * 60 * 1000);
  return {
    status: current ? "current" : run ? "stale" : "unavailable",
    mappingRunId: run?.mappingRunId ?? null,
    sourceSnapshotId: run?.sourceSnapshotId ?? null,
    lastUpdated: run?.completedAt?.toISOString() ?? null,
    lastAttempted: attempt?.startedAt.toISOString() ?? null,
    staleAgeMs: ageMs,
    latestFailure: attempt?.status === "failed" ? attempt.errorMessage : null,
    recentFailureCount: recentAttempts.filter((row) => row.status === "failed").length,
    durationMs: typeof run?.metadata?.durationMs === "number" ? run.metadata.durationMs : null,
    metadata: run?.metadata ?? {},
  };
}