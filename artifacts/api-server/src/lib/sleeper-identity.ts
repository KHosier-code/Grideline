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
  identitySourceImportsTable,
  nflversePlayerIdentitiesTable,
  playerGameStatsTable,
  playerIdentityCrosswalkRevisionsTable,
  playersTable,
  sleeperIdentityMappingRunsTable,
  sleeperIdentityMappingsTable,
  sleeperPlayerCrosswalkEvidenceTable,
  sleeperPlayerSnapshotsTable,
  snapCountsTable,
  teamsTable,
} from "@workspace/db";
import { SLEEPER_ACTIVE_TEAM_CODES, type SleeperPlayer } from "./sleeper";
import {
  loadVerifiedPlayerCrosswalk,
  type VerifiedPlayerCrosswalk,
} from "./nflverse-player-crosswalk";
import { logger } from "./logger";

export const SLEEPER_MAPPING_VERSION = "sleeper-identity-v6-authoritative-role-cohorts";
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
  crosswalkExternalIds: Record<string, string>;
  sources: string[];
  sourceCount: number;
  latestSeason: number | null;
  latestWeek: number | null;
  teamCodes: string[];
};

export type VerifiedSleeperCrosswalk = {
  sleeperPlayerId: string;
  gridlinePlayerId: string;
  evidenceMethod: string;
  evidenceConfidence: number;
  firstObservedAt: Date;
  lastVerifiedAt: Date;
  evidenceFingerprint: string;
  ambiguous: boolean;
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
  LDE: "EDGE",
  RDE: "EDGE",
  EDGE: "EDGE",
  NT: "DT",
  LDT: "DT",
  RDT: "DT",
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
  LILB: "LB",
  RILB: "LB",
  MLB: "LB",
  LOLB: "LB",
  ROLB: "LB",
  SLB: "LB",
  WLB: "LB",
  LWR: "WR",
  RWR: "WR",
  SWR: "WR",
  LCB: "CB",
  RCB: "CB",
  NB: "CB",
  FS: "S",
  SS: "S",
  WS: "S",
  LS: "LS",
};

const POSITION_GROUPS = [
  "QB", "RB", "WR", "TE", "OL", "EDGE", "DE", "DT", "LB", "CB", "S", "K", "P",
] as const;

const STABLE_PROVIDER_ID_TYPES = new Set([
  "gsis_id",
  "espn_id",
  "pfr_id",
  "pff_id",
  "otc_id",
  "esb_id",
  "nfl_id",
  "smart_id",
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
  if (source === "players") return null;
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
        crosswalkExternalIds: {},
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

export function applyVerifiedPlayerCrosswalks(
  candidates: GridlineIdentityCandidate[],
  crosswalks: VerifiedPlayerCrosswalk[],
) {
  const providerOwners = new Map<string, Set<string>>();
  for (const candidate of candidates) {
    for (const [type, value] of Object.entries(candidate.externalIds)) {
      const key = `${type}:${value}`;
      const owners = providerOwners.get(key) ?? new Set<string>();
      owners.add(candidate.gridlinePlayerId);
      providerOwners.set(key, owners);
    }
  }
  const crosswalkOwners = new Map<string, number[]>();
  crosswalks.forEach((crosswalk, index) => {
    for (const [type, value] of Object.entries(crosswalk.providerIds)) {
      const key = `${type}:${value}`;
      const owners = crosswalkOwners.get(key) ?? [];
      owners.push(index);
      crosswalkOwners.set(key, owners);
    }
  });
  const aliases = new Map<string, string>();
  const merged = new Map(candidates.map((candidate) => [
    candidate.gridlinePlayerId,
    {
      ...candidate,
      externalIds: { ...candidate.externalIds },
      crosswalkExternalIds: { ...candidate.crosswalkExternalIds },
      sources: [...candidate.sources],
      teamCodes: [...candidate.teamCodes],
    },
  ]));
  let appliedCrosswalkCount = 0;
  let rejectedCrosswalkCount = 0;
  for (const crosswalk of crosswalks) {
    const keys = Object.entries(crosswalk.providerIds).map(([type, value]) => `${type}:${value}`);
    if (keys.some((key) =>
      (crosswalkOwners.get(key)?.length ?? 0) !== 1
      || (providerOwners.get(key)?.size ?? 0) > 1)) {
      rejectedCrosswalkCount += 1;
      continue;
    }
    const linkedIds = [...new Set(keys.flatMap((key) => [...(providerOwners.get(key) ?? [])]))];
    if (linkedIds.length === 0) continue;
    const linked = linkedIds.map((id) => merged.get(aliases.get(id) ?? id))
      .filter((candidate): candidate is GridlineIdentityCandidate => Boolean(candidate));
    const uniqueLinked = [...new Map(
      linked.map((candidate) => [candidate.gridlinePlayerId, candidate]),
    ).values()];
    const target = uniqueLinked.find((candidate) => candidate.externalIds.gsis_id)
      ?? uniqueLinked.find((candidate) => isGsisId(candidate.gridlinePlayerId))
      ?? uniqueLinked[0];
    if (!target) continue;
    for (const candidate of uniqueLinked) {
      if (candidate.gridlinePlayerId === target.gridlinePlayerId) continue;
      for (const [type, value] of Object.entries(candidate.externalIds)) {
        target.externalIds[type] = value;
        target.crosswalkExternalIds[type] = value;
      }
      for (const source of candidate.sources) {
        if (!target.sources.includes(source)) target.sources.push(source);
      }
      for (const team of candidate.teamCodes) {
        if (!target.teamCodes.includes(team)) target.teamCodes.push(team);
      }
      aliases.set(candidate.gridlinePlayerId, target.gridlinePlayerId);
      merged.delete(candidate.gridlinePlayerId);
    }
    for (const [type, value] of Object.entries(crosswalk.providerIds)) {
      target.externalIds[type] = value;
      if (!(providerOwners.get(`${type}:${value}`) ?? new Set()).has(target.gridlinePlayerId)) {
        target.crosswalkExternalIds[type] = value;
      }
    }
    if (!target.sources.includes("nflverse_player_crosswalk")) {
      target.sources.push("nflverse_player_crosswalk");
      target.sourceCount = target.sources.length;
    }
    const latestTeam = normalizeTeamCode(crosswalk.latestTeam).normalizedTeam;
    if (latestTeam) {
      target.normalizedTeam = latestTeam;
      if (!target.teamCodes.includes(latestTeam)) target.teamCodes.push(latestTeam);
    }
    if (crosswalk.position) {
      target.position = crosswalk.position;
      target.normalizedPosition = normalizePosition(crosswalk.position);
    }
    appliedCrosswalkCount += 1;
  }
  return {
    candidates: [...merged.values()].sort((left, right) =>
      left.gridlinePlayerId.localeCompare(right.gridlinePlayerId)),
    appliedCrosswalkCount,
    rejectedCrosswalkCount,
  };
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
    crosswalkExternalIds: Object.fromEntries(
      Object.entries(candidate.crosswalkExternalIds).sort(([left], [right]) =>
        left.localeCompare(right)),
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
  bySleeperCrosswalk: Map<string, GridlineIdentityCandidate[]>;
  byProviderId: Map<string, GridlineIdentityCandidate[]>;
  crosswalkProviderKeys: Set<string>;
  byName: Map<string, GridlineIdentityCandidate[]>;
};

function buildMappingIndexes(
  candidates: GridlineIdentityCandidate[],
  crosswalks: VerifiedSleeperCrosswalk[] = [],
): MappingIndexes {
  const candidateById = new Map(candidates.map((candidate) => [candidate.gridlinePlayerId, candidate]));
  const bySleeperCrosswalk = new Map<string, GridlineIdentityCandidate[]>();
  const byProviderId = new Map<string, GridlineIdentityCandidate[]>();
  const crosswalkProviderKeys = new Set<string>();
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
      if (candidate.crosswalkExternalIds[type] === value) {
        crosswalkProviderKeys.add(`${candidate.gridlinePlayerId}:${key}`);
      }
    }
  }
  for (const crosswalk of crosswalks) {
    if (crosswalk.ambiguous) continue;
    const candidate = candidateById.get(crosswalk.gridlinePlayerId);
    if (!candidate) continue;
    const group = bySleeperCrosswalk.get(crosswalk.sleeperPlayerId) ?? [];
    group.push(candidate);
    bySleeperCrosswalk.set(crosswalk.sleeperPlayerId, group);
  }
  return { bySleeperCrosswalk, byProviderId, crosswalkProviderKeys, byName };
}

function mapSleeperPlayerWithIndexes(
  player: SleeperPlayer,
  indexes: MappingIndexes,
): SleeperIdentityMapping {
  const team = normalizeTeamCode(player.team);
  const normalizedPosition = normalizePosition(player.position);
  const providerIds = new Map(providerIdEntries(player.provider_ids));
  const byExactProviderId = [...new Map(
    [...providerIds.entries()]
      .flatMap(([type, value]) => indexes.byProviderId.get(`${type}:${value}`) ?? [])
      .map((candidate) => [candidate.gridlinePlayerId, candidate] as const),
  ).values()];
  const byExactCrosswalk = [...new Map(
    (indexes.bySleeperCrosswalk.get(player.player_id) ?? [])
      .map((candidate) => [candidate.gridlinePlayerId, candidate] as const),
  ).values()];

  let status: MappingStatus = "unmatched";
  let selected: GridlineIdentityCandidate | null = null;
  let candidatesForEvidence = byExactProviderId;
  let ambiguityReason: string | null = null;
  let unmatchedReason: string | null = null;

  if (byExactProviderId.length > 0) {
    const exactIds = new Set(byExactProviderId.map((candidate) => candidate.gridlinePlayerId));
    if (exactIds.size === 1) {
      selected = byExactProviderId[0] ?? null;
      const hasNativeProviderEvidence = selected
        ? [...providerIds.entries()].some(([type, value]) =>
          selected?.externalIds[type] === value
          && !indexes.crosswalkProviderKeys.has(
            `${selected.gridlinePlayerId}:${type}:${value}`,
          ))
        : false;
      status = hasNativeProviderEvidence ? "exact_provider_id" : "exact_crosswalk";
    } else {
      status = "ambiguous";
      ambiguityReason = "The Sleeper provider ID resolves to multiple Gridline identities.";
    }
  } else if (byExactCrosswalk.length > 0) {
    candidatesForEvidence = byExactCrosswalk;
    const crosswalkIds = new Set(byExactCrosswalk.map((candidate) => candidate.gridlinePlayerId));
    if (crosswalkIds.size === 1) {
      selected = byExactCrosswalk[0] ?? null;
      status = "exact_crosswalk";
    } else {
      status = "ambiguous";
      ambiguityReason = "Multiple exact cross-provider IDs resolve to different Gridline identities.";
    }
  } else {
    const nameCandidates = (indexes.byName.get(normalizePlayerName(player.full_name)) ?? [])
      .filter((candidate) => positionCompatibility(player.position, candidate.position) === "compatible");
    const sameTeam = nameCandidates.filter((candidate) =>
      team.normalizedTeam !== null && candidate.normalizedTeam === team.normalizedTeam);
    const historicalTeam = nameCandidates.filter((candidate) =>
      team.normalizedTeam !== null
      && candidate.teamCodes.includes(team.normalizedTeam)
      && candidate.sourceCount >= 2);
    if (sameTeam.length === 1) {
      selected = sameTeam[0] ?? null;
      status = "normalized_name_team_position";
      candidatesForEvidence = sameTeam;
    } else if (sameTeam.length > 1) {
      status = "ambiguous";
      ambiguityReason = "Multiple Gridline identities share the normalized name, team, and compatible position.";
      candidatesForEvidence = sameTeam;
    } else if (historicalTeam.length === 1) {
      selected = historicalTeam[0] ?? null;
      status = "supported_name_match";
      candidatesForEvidence = historicalTeam;
    } else if (historicalTeam.length > 1) {
      status = "ambiguous";
      ambiguityReason = "Multiple Gridline identities have corroborated historical team and position evidence.";
      candidatesForEvidence = historicalTeam;
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
        explainableByStableIdentity: status === "exact_provider_id" || status === "exact_crosswalk",
      }
      : null,
    depthRelevant: player.depth_chart_order !== null,
  };
}

export function mapSleeperPlayer(
  player: SleeperPlayer,
  candidates: GridlineIdentityCandidate[],
  crosswalks: VerifiedSleeperCrosswalk[] = [],
): SleeperIdentityMapping {
  return mapSleeperPlayerWithIndexes(player, buildMappingIndexes(candidates, crosswalks));
}

export function mapSleeperPlayers(
  players: SleeperPlayer[],
  candidates: GridlineIdentityCandidate[],
  crosswalks: VerifiedSleeperCrosswalk[] = [],
) {
  const indexes = buildMappingIndexes(candidates, crosswalks);
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

export function providerNamespaceInventory(
  players: SleeperPlayer[],
  candidates: GridlineIdentityCandidate[],
) {
  const counts = new Map<string, Set<string>>();
  counts.set("sleeper_id", new Set(players.map((player) => player.player_id)));
  for (const player of players) {
    for (const [rawNamespace, rawValue] of Object.entries(player.provider_ids)) {
      const namespace = rawNamespace.toLowerCase();
      const value = cleanId(rawValue);
      const values = counts.get(namespace) ?? new Set<string>();
      if (value) values.add(value);
      counts.set(namespace, values);
    }
  }
  for (const candidate of candidates) {
    for (const [namespace, value] of Object.entries(candidate.externalIds)) {
      const values = counts.get(namespace) ?? new Set<string>();
      values.add(value);
      counts.set(namespace, values);
    }
  }
  return [...counts.entries()]
    .map(([namespace, values]) => ({
      namespace,
      playersWithId: values.size,
      trustworthyForExactEquality: STABLE_PROVIDER_ID_TYPES.has(namespace),
      note: namespace === "sleeper_id"
        ? "Sleeper IDs are provider-scoped and must never be assumed equal to an unnamespaced numeric Gridline ID."
        : STABLE_PROVIDER_ID_TYPES.has(namespace)
          ? "Accepted only when both sides explicitly identify this same stable namespace."
          : "Present in source evidence but not trusted for automatic identity matching.",
    }))
    .sort((left, right) => left.namespace.localeCompare(right.namespace));
}

const SUPPORTED_DEPTH_ROLE_POSITIONS = new Set([
  "QB", "RB", "WR", "TE", "CB", "S", "OT", "OG", "C", "OL", "EDGE", "LB",
]);

const AUTHORITATIVE_STARTER_ROLES = new Set<DepthRelevantCandidate["role"]>([
  "QB1", "RB1", "WR1", "WR2", "WR3", "TE1",
  "CB1", "CB2", "S1", "S2", "OL", "EDGE", "LB",
]);

function normalizedDepthRole(player: SleeperPlayer) {
  return normalizePosition(player.depth_chart_position);
}

function isAuthoritativeCurrentDepthRow(player: SleeperPlayer) {
  const team = normalizeTeamCode(player.team).normalizedTeam;
  const role = normalizedDepthRole(player);
  return team !== null
    && role !== null
    && SUPPORTED_DEPTH_ROLE_POSITIONS.has(role)
    && player.depth_chart_order !== null;
}

function coverageForPlayers(
  players: SleeperPlayer[],
  mappingById: Map<string, SleeperIdentityMapping>,
) {
  const relevantMappings = players.map((player) => mappingById.get(player.player_id));
  const mapped = relevantMappings.filter((mapping) => mapping?.mappedGridlinePlayerId).length;
  const ambiguous = relevantMappings.filter((mapping) => mapping?.mappingStatus === "ambiguous").length;
  const unresolved = players.length - mapped;
  return {
    total: players.length,
    mapped,
    percentage: percent(mapped, players.length),
    ambiguous,
    unmatched: relevantMappings.filter((mapping) => mapping?.mappingStatus === "unmatched").length,
    unresolved,
  };
}

type AuthoritativeRoleSlot = {
  team: string;
  role: DepthRelevantCandidate["role"];
  player: SleeperPlayer | null;
  mapping: SleeperIdentityMapping | null;
};

function authoritativeRoleSlots(
  players: SleeperPlayer[],
  mappings: SleeperIdentityMapping[],
) {
  const mappingById = new Map(mappings.map((mapping) => [mapping.sleeperPlayerId, mapping]));
  const result: AuthoritativeRoleSlot[] = [];
  const teams = [...SLEEPER_ACTIVE_TEAM_CODES]
    .map((team) => team === "WAS" ? "WSH" : team)
    .sort();
  const plans = [
    ["QB", ["QB1", "QB2", "QB3"]],
    ["RB", ["RB1", "RB2", "RB3"]],
    ["WR", ["WR1", "WR2", "WR3", "WR4", "WR5"]],
    ["TE", ["TE1", "TE2", "TE3"]],
    ["CB", ["CB1", "CB2", "CB3", "CB4"]],
    ["S", ["S1", "S2", "S3", "S4"]],
    ["EDGE", ["EDGE"]],
    ["LB", ["LB"]],
  ] as const;
  for (const team of teams) {
    const teamPlayers = players
      .filter((player) =>
        normalizeTeamCode(player.team).normalizedTeam === team
        && isAuthoritativeCurrentDepthRow(player))
      .sort((left, right) =>
        (left.depth_chart_order ?? 999) - (right.depth_chart_order ?? 999)
        || left.player_id.localeCompare(right.player_id));
    for (const [position, roles] of plans) {
      const candidates = teamPlayers.filter((player) => normalizedDepthRole(player) === position);
      roles.forEach((role, index) => {
        const player = candidates[index] ?? null;
        result.push({
          team,
          role,
          player,
          mapping: player ? mappingById.get(player.player_id) ?? null : null,
        });
      });
    }
    const olCandidates = teamPlayers.filter((player) =>
      ["OT", "OG", "C", "OL"].includes(normalizedDepthRole(player) ?? ""));
    const olPlayer = olCandidates.find((player) =>
      mappingById.get(player.player_id)?.mappedGridlinePlayerId) ?? olCandidates[0] ?? null;
    result.push({
      team,
      role: "OL",
      player: olPlayer,
      mapping: olPlayer ? mappingById.get(olPlayer.player_id) ?? null : null,
    });
  }
  return result;
}

function coverageForRoleSlots(slots: AuthoritativeRoleSlot[]) {
  const mapped = slots.filter((slot) => slot.mapping?.mappedGridlinePlayerId).length;
  const ambiguous = slots.filter((slot) => slot.mapping?.mappingStatus === "ambiguous").length;
  return {
    total: slots.length,
    mapped,
    percentage: percent(mapped, slots.length),
    ambiguous,
    unmatched: slots.filter((slot) => slot.mapping?.mappingStatus === "unmatched").length,
    unresolved: slots.length - mapped,
  };
}

export function calculateMappingCoverage(
  players: SleeperPlayer[],
  mappings: SleeperIdentityMapping[],
  collisionCount = 0,
  staleCrosswalkEvidenceCount = 0,
) {
  const total = players.length;
  const mappingById = new Map(mappings.map((mapping) => [mapping.sleeperPlayerId, mapping]));
  const mapped = mappings.filter((mapping) => mapping.mappedGridlinePlayerId);
  const countByStatus = (status: MappingStatus) =>
    mappings.filter((mapping) => mapping.mappingStatus === status).length;
  const authoritativeDepthPlayers = players.filter(isAuthoritativeCurrentDepthRow);
  const positionCoverage = Object.fromEntries(POSITION_GROUPS.map((position) => [
    position,
    coverageForPlayers(
      authoritativeDepthPlayers.filter((player) => normalizedDepthRole(player) === position),
      mappingById,
    ),
  ]));
  const aggregatePositionCoverage = (positions: string[]) => {
    return coverageForPlayers(
      authoritativeDepthPlayers.filter((player) =>
        positions.includes(normalizedDepthRole(player) ?? "")),
      mappingById,
    );
  };
  Object.assign(positionCoverage, {
    OL: aggregatePositionCoverage(["OT", "OG", "C"]),
    DL_LB_DB: aggregatePositionCoverage(["EDGE", "DE", "DT", "DL", "LB", "CB", "S", "DB"]),
  });
  const depthPlayers = authoritativeDepthPlayers;
  const depthOnePlayers = authoritativeDepthPlayers.filter((player) => player.depth_chart_order === 1);
  const currentTeamPlayers = players.filter((player) => normalizeTeamCode(player.team).normalizedTeam !== null);
  const mappedCountFor = (subset: SleeperPlayer[]) => subset.filter((player) =>
    mappingById.get(player.player_id)?.mappedGridlinePlayerId).length;
  const roleSlots = authoritativeRoleSlots(players, mappings);
  const slotsFor = (...roles: DepthRelevantCandidate["role"][]) =>
    roleSlots.filter((slot) => roles.includes(slot.role));
  const starterSlots = roleSlots.filter((slot) => AUTHORITATIVE_STARTER_ROLES.has(slot.role));
  const selectedStarterCollisionCount = starterSlots.filter((slot) =>
    slot.mapping?.ambiguityReason === "Multiple Sleeper players resolve to one Gridline identity.").length;
  const depthOrder = coverageForPlayers(depthPlayers, mappingById);
  const depthOrderOne = coverageForPlayers(depthOnePlayers, mappingById);
  const currentTeam = {
    total: currentTeamPlayers.length,
    mapped: mappedCountFor(currentTeamPlayers),
    percentage: percent(mappedCountFor(currentTeamPlayers), currentTeamPlayers.length),
  };
  const roleCoverage = {
    QB1: coverageForRoleSlots(slotsFor("QB1")),
    WR1: coverageForRoleSlots(slotsFor("WR1")),
    WR2: coverageForRoleSlots(slotsFor("WR2")),
    WR3: coverageForRoleSlots(slotsFor("WR3")),
    CB1: coverageForRoleSlots(slotsFor("CB1")),
    CB2: coverageForRoleSlots(slotsFor("CB2")),
    EDGE: coverageForRoleSlots(slotsFor("EDGE")),
    LB: coverageForRoleSlots(slotsFor("LB")),
    SAFETY_STARTERS: coverageForRoleSlots(slotsFor("S1", "S2")),
    OL_EVIDENCE: coverageForRoleSlots(slotsFor("OL")),
    ALL_STARTERS: coverageForRoleSlots(starterSlots),
  };
  const qbDepthOrderOne = roleCoverage.QB1;
  const minimumRoleCoverage = (metric: typeof roleCoverage.QB1) =>
    metric.total > 0 && metric.percentage >= DEPTH_MAPPING_SUITABILITY_MIN_PERCENT;
  const suitabilityGates = {
    currentTeamMapping: currentTeam.percentage >= DEPTH_MAPPING_SUITABILITY_MIN_PERCENT,
    depthOrderMapping: depthOrder.percentage >= DEPTH_MAPPING_SUITABILITY_MIN_PERCENT,
    depthOrderOneMapping: depthOrderOne.percentage >= DEPTH_MAPPING_SUITABILITY_MIN_PERCENT,
    qbDepthOrderOneMapping: qbDepthOrderOne.total > 0 && qbDepthOrderOne.percentage === 100,
    wr1Mapping: minimumRoleCoverage(roleCoverage.WR1),
    wr2Mapping: minimumRoleCoverage(roleCoverage.WR2),
    wr3Mapping: minimumRoleCoverage(roleCoverage.WR3),
    cb1Mapping: minimumRoleCoverage(roleCoverage.CB1),
    cb2Mapping: minimumRoleCoverage(roleCoverage.CB2),
    edgeMapping: minimumRoleCoverage(roleCoverage.EDGE),
    lbMapping: minimumRoleCoverage(roleCoverage.LB),
    safetyStarterMapping: minimumRoleCoverage(roleCoverage.SAFETY_STARTERS),
    olEvidenceMapping: minimumRoleCoverage(roleCoverage.OL_EVIDENCE),
    noAmbiguousStarterMappings: roleCoverage.ALL_STARTERS.ambiguous === 0,
    noSelectedStarterCollisions: selectedStarterCollisionCount === 0,
    freshCrosswalkEvidence: staleCrosswalkEvidenceCount === 0,
  };
  const blockerCategories = [
    ...(!suitabilityGates.currentTeamMapping ? ["current_team_mapping_below_90_percent"] : []),
    ...(!suitabilityGates.depthOrderMapping ? ["depth_order_mapping_below_90_percent"] : []),
    ...(!suitabilityGates.depthOrderOneMapping ? ["depth_order_one_mapping_below_90_percent"] : []),
    ...(!suitabilityGates.qbDepthOrderOneMapping ? ["qb1_mapping_below_100_percent"] : []),
    ...(!suitabilityGates.wr1Mapping ? ["wr1_mapping_below_90_percent"] : []),
    ...(!suitabilityGates.wr2Mapping ? ["wr2_mapping_below_90_percent"] : []),
    ...(!suitabilityGates.wr3Mapping ? ["wr3_mapping_below_90_percent"] : []),
    ...(!suitabilityGates.cb1Mapping ? ["cb1_mapping_below_90_percent"] : []),
    ...(!suitabilityGates.cb2Mapping ? ["cb2_mapping_below_90_percent"] : []),
    ...(!suitabilityGates.edgeMapping ? ["edge_mapping_below_90_percent"] : []),
    ...(!suitabilityGates.lbMapping ? ["lb_mapping_below_90_percent"] : []),
    ...(!suitabilityGates.safetyStarterMapping ? ["safety_starter_mapping_below_90_percent"] : []),
    ...(!suitabilityGates.olEvidenceMapping ? ["ol_evidence_mapping_below_90_percent"] : []),
    ...(!suitabilityGates.noAmbiguousStarterMappings ? ["ambiguous_starter_mappings"] : []),
    ...(!suitabilityGates.noSelectedStarterCollisions ? ["unresolved_selected_starter_collisions"] : []),
    ...(!suitabilityGates.freshCrosswalkEvidence ? ["stale_crosswalk_evidence"] : []),
  ];
  const suitableForDepthLogic = Object.values(suitabilityGates).every(Boolean);
  return {
    totalSleeperRows: total,
    currentTeamRows: currentTeamPlayers.length,
    currentTeam,
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
    qbDepthOrderOne,
    roleCoverage,
    authoritativeDepthCohortDefinition:
      "Canonical current NFL team, non-null depth order, and supported normalized depth_chart_position.",
    teamAliasNormalizationCount: mappings.filter((mapping) => mapping.teamNormalizationMethod === "legacy_alias").length,
    collisionCount,
    selectedStarterCollisionCount,
    unresolvedCount: mappings.filter((mapping) =>
      mapping.mappingStatus === "ambiguous" || mapping.mappingStatus === "unmatched").length,
    staleCrosswalkEvidenceCount,
    suitabilityMinimumPercentage: DEPTH_MAPPING_SUITABILITY_MIN_PERCENT,
    suitabilityGates,
    blockerCategories,
    suitableForDepthLogic,
    suitabilityVerdict: suitableForDepthLogic
      ? "SLEEPER MAPPING SUITABLE FOR DEPTH LOGIC"
      : "SLEEPER MAPPING NOT SUITABLE FOR DEPTH LOGIC",
  };
}

export type DepthRelevantCandidate = {
  team: string;
  role:
    | "QB1" | "QB2" | "QB3"
    | "RB1" | "RB2" | "RB3"
    | "WR1" | "WR2" | "WR3" | "WR4" | "WR5"
    | "TE1" | "TE2" | "TE3"
    | "CB1" | "CB2" | "CB3" | "CB4"
    | "S1" | "S2" | "S3" | "S4"
    | "OL" | "EDGE" | "LB";
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
  return authoritativeRoleSlots(players, mappings).map((slot) => ({
    team: slot.team,
    role: slot.role,
    sleeperPlayerId: slot.player?.player_id ?? null,
    sleeperName: slot.player?.full_name ?? null,
    position: slot.player?.position ?? null,
    depthOrder: slot.player?.depth_chart_order ?? null,
    mappedGridlinePlayerId: slot.mapping?.mappedGridlinePlayerId ?? null,
    mappingMethod: slot.mapping?.mappingMethod ?? "none",
    mappingConfidence: slot.mapping?.mappingConfidence ?? 0,
  }));
}

export function buildValidationSample(
  players: SleeperPlayer[],
  mappings: SleeperIdentityMapping[],
) {
  const mappingById = new Map(mappings.map((mapping) => [mapping.sleeperPlayerId, mapping]));
  const rolePositions = [
    ["QB1", "QB"],
    ["RB1", "RB"],
    ["WR1", "WR"],
    ["TE1", "TE"],
    ["CB1", "CB"],
  ] as const;
  const teams = [...SLEEPER_ACTIVE_TEAM_CODES]
    .map((team) => normalizeTeamCode(team).normalizedTeam)
    .filter((team): team is string => Boolean(team))
    .sort()
    .slice(0, 20);
  const sample: Array<Record<string, unknown>> = [];
  for (const team of teams) {
    const teamPlayers = players
      .filter((player) => normalizeTeamCode(player.team).normalizedTeam === team)
      .sort((left, right) =>
        (left.depth_chart_order ?? 999) - (right.depth_chart_order ?? 999)
        || left.player_id.localeCompare(right.player_id));
    for (const [role, position] of rolePositions) {
      const player = teamPlayers.find((candidate) =>
        normalizePosition(candidate.depth_chart_position ?? candidate.position) === position);
      const mapping = player ? mappingById.get(player.player_id) : undefined;
      sample.push({
        team,
        role,
        sleeperPlayerId: player?.player_id ?? null,
        sleeperName: player?.full_name ?? null,
        depthOrder: player?.depth_chart_order ?? null,
        mappedGridlinePlayerId: mapping?.mappedGridlinePlayerId ?? null,
        evidenceSources: mapping?.candidateEvidence.flatMap((item) =>
          Array.isArray(item.sources) ? item.sources.filter((source): source is string => typeof source === "string") : []) ?? [],
        mappingMethod: mapping?.mappingMethod ?? "none",
        mappingConfidence: mapping?.mappingConfidence ?? 0,
        conflict: mapping?.ambiguityReason ?? mapping?.unmatchedReason ?? mapping?.teamChangeEvidence ?? null,
      });
    }
  }
  return sample;
}

function crosswalkFingerprint(input: {
  sleeperPlayerId: string;
  gridlinePlayerId: string;
  sourceHash: string;
  matchedNamespaces: string[];
  observationId: string;
}) {
  return createHash("sha256").update(JSON.stringify({
    sleeperPlayerId: input.sleeperPlayerId,
    gridlinePlayerId: input.gridlinePlayerId,
    sourceHash: input.sourceHash,
    matchedNamespaces: [...input.matchedNamespaces].sort(),
    observationId: input.observationId,
    mappingVersion: SLEEPER_MAPPING_VERSION,
  })).digest("hex");
}

export function buildVerifiedCrosswalkEvidence(
  players: SleeperPlayer[],
  mappings: SleeperIdentityMapping[],
  verifiedAt: Date,
  prior: VerifiedSleeperCrosswalk[] = [],
  observationId = verifiedAt.toISOString(),
) {
  const mappingById = new Map(mappings.map((mapping) => [mapping.sleeperPlayerId, mapping]));
  const priorFirstObserved = new Map<string, Date>();
  for (const row of prior) {
    const key = `${row.sleeperPlayerId}:${row.gridlinePlayerId}`;
    const existing = priorFirstObserved.get(key);
    if (!existing || row.firstObservedAt < existing) priorFirstObserved.set(key, row.firstObservedAt);
  }
  return players.flatMap((player) => {
    const mapping = mappingById.get(player.player_id);
    if (
      !mapping?.mappedGridlinePlayerId
      || !["exact_provider_id", "exact_crosswalk", "supported_name_match"].includes(mapping.mappingStatus)
    ) return [];
    const matchedNamespaces = mapping.mappingStatus !== "supported_name_match"
      ? mapping.candidateEvidence.flatMap((evidence) => {
      const ids = evidence.externalIds;
      if (!ids || typeof ids !== "object" || Array.isArray(ids)) return [];
      return providerIdEntries(player.provider_ids)
        .filter(([namespace, value]) => (ids as Record<string, unknown>)[namespace] === value)
        .map(([namespace]) => namespace);
      })
      : [];
    const corroboratingSources = mapping.candidateEvidence.flatMap((evidence) =>
      Array.isArray(evidence.sources)
        ? evidence.sources.filter((source): source is string => typeof source === "string")
        : []);
    if (
      mapping.mappingStatus !== "supported_name_match" && matchedNamespaces.length === 0
      || mapping.mappingStatus === "supported_name_match" && new Set(corroboratingSources).size < 2
    ) return [];
    const evidenceMethod = mapping.mappingStatus === "exact_provider_id"
      ? "exact_named_provider_id_equality"
      : mapping.mappingStatus === "exact_crosswalk"
        ? "verified_nflverse_cross_provider_id"
        : "stable_historical_name_team_position_linkage";
    const key = `${player.player_id}:${mapping.mappedGridlinePlayerId}`;
    const evidenceFingerprint = crosswalkFingerprint({
      sleeperPlayerId: player.player_id,
      gridlinePlayerId: mapping.mappedGridlinePlayerId,
      sourceHash: mapping.sourceHash,
      matchedNamespaces,
      observationId,
    });
    return [{
      gridlinePlayerId: mapping.mappedGridlinePlayerId,
      sourceNamespace: "sleeper_id",
      sourcePlayerId: player.player_id,
      targetNamespace: "gridline_player_id",
      targetPlayerId: mapping.mappedGridlinePlayerId,
      evidenceMethod,
      evidenceConfidence: mapping.mappingConfidence,
      firstObservedAt: priorFirstObserved.get(key) ?? verifiedAt,
      lastVerifiedAt: verifiedAt,
      evidenceFingerprint,
      ambiguous: false,
      evidence: {
        matchedNamespaces: [...new Set(matchedNamespaces)].sort(),
        corroboratingSources: [...new Set(corroboratingSources)].sort(),
        sourceHash: mapping.sourceHash,
        mappingVersion: SLEEPER_MAPPING_VERSION,
      },
    }];
  });
}

export function countStaleEffectiveCrosswalks(
  prior: VerifiedSleeperCrosswalk[],
  current: Array<{ sourcePlayerId: string; gridlinePlayerId: string }>,
  staleBefore: Date,
) {
  const refreshedLinks = new Set(current.map((row) => `${row.sourcePlayerId}:${row.gridlinePlayerId}`));
  return prior.filter((row) =>
    row.lastVerifiedAt < staleBefore
    && !refreshedLinks.has(`${row.sleeperPlayerId}:${row.gridlinePlayerId}`)).length;
}

type CrosswalkEvidenceReadRow = {
  id: number;
  sourceNamespace: string;
  sourcePlayerId: string;
  gridlinePlayerId: string;
  evidenceMethod: string;
  evidenceConfidence: number;
  firstObservedAt: Date;
  lastVerifiedAt: Date;
  evidenceFingerprint: string;
  ambiguous: boolean;
};

export function effectiveVerifiedCrosswalks(rows: CrosswalkEvidenceReadRow[]) {
  const latestByLink = new Map<string, CrosswalkEvidenceReadRow>();
  for (const row of [...rows].sort((left, right) =>
    right.lastVerifiedAt.getTime() - left.lastVerifiedAt.getTime() || right.id - left.id)) {
    const key = `${row.sourceNamespace}:${row.sourcePlayerId}:${row.gridlinePlayerId}`;
    if (!latestByLink.has(key)) latestByLink.set(key, row);
  }
  return [...latestByLink.values()].map((row): VerifiedSleeperCrosswalk => ({
    sleeperPlayerId: row.sourcePlayerId,
    gridlinePlayerId: row.gridlinePlayerId,
    evidenceMethod: row.evidenceMethod,
    evidenceConfidence: row.evidenceConfidence,
    firstObservedAt: row.firstObservedAt,
    lastVerifiedAt: row.lastVerifiedAt,
    evidenceFingerprint: row.evidenceFingerprint,
    ambiguous: row.ambiguous,
  }));
}

async function sourceCandidates(crosswalks: VerifiedPlayerCrosswalk[]) {
  const [latestNflverseImport] = await db.select({
    id: identitySourceImportsTable.id,
  }).from(identitySourceImportsTable)
    .where(eq(identitySourceImportsTable.sourceNamespace, "nflverse"))
    .orderBy(desc(identitySourceImportsTable.id))
    .limit(1);
  const [players, stats, snaps, depth, nflverse] = await Promise.all([
    db.select({
      playerId: playersTable.playerId,
      name: playersTable.name,
      position: playersTable.position,
      team: teamsTable.abbreviation,
    }).from(playersTable).leftJoin(teamsTable, eq(playersTable.teamId, teamsTable.teamId)),
    db.select({
      playerId: playerGameStatsTable.playerId,
      name: playerGameStatsTable.playerName,
      position: playerGameStatsTable.position,
      team: playerGameStatsTable.teamId,
      season: sql<number>`max(${playerGameStatsTable.season})::int`,
      week: sql<number>`max(${playerGameStatsTable.week})::int`,
    }).from(playerGameStatsTable).groupBy(
      playerGameStatsTable.playerId,
      playerGameStatsTable.playerName,
      playerGameStatsTable.position,
      playerGameStatsTable.teamId,
    ),
    db.select({
      playerId: snapCountsTable.playerId,
      name: snapCountsTable.playerName,
      position: snapCountsTable.position,
      team: snapCountsTable.teamId,
      season: sql<number>`max(${snapCountsTable.season})::int`,
      week: sql<number>`max(${snapCountsTable.week})::int`,
    }).from(snapCountsTable).groupBy(
      snapCountsTable.playerId,
      snapCountsTable.playerName,
      snapCountsTable.position,
      snapCountsTable.teamId,
    ),
    db.select({
      playerId: historicalDepthChartTable.playerId,
      name: historicalDepthChartTable.playerName,
      position: historicalDepthChartTable.position,
      team: historicalDepthChartTable.teamId,
      season: sql<number>`max(${historicalDepthChartTable.season})::int`,
      week: sql<number>`max(${historicalDepthChartTable.week})::int`,
    }).from(historicalDepthChartTable).groupBy(
      historicalDepthChartTable.playerId,
      historicalDepthChartTable.playerName,
      historicalDepthChartTable.position,
      historicalDepthChartTable.teamId,
    ),
    latestNflverseImport
      ? db.select().from(nflversePlayerIdentitiesTable)
        .where(eq(nflversePlayerIdentitiesTable.importId, latestNflverseImport.id))
      : Promise.resolve([]),
  ]);
  const typedCanonicalTargets = new Map<string, Set<string>>();
  const canonicalByNameTeamPosition = new Map<string, Set<string>>();
  for (const row of nflverse) {
    for (const [type, value] of Object.entries({
      gsis_id: row.gsisId,
      espn_id: row.espnId,
      pfr_id: row.pfrId,
      pff_id: row.pffId,
      otc_id: row.otcId,
      esb_id: row.esbId,
      nfl_id: row.nflId,
      smart_id: row.smartId,
    })) {
      if (!value) continue;
      const key = `${type}:${value}`;
      const targets = typedCanonicalTargets.get(key) ?? new Set<string>();
      targets.add(row.gsisId);
      typedCanonicalTargets.set(key, targets);
    }
    const team = normalizeTeamCode(row.team).normalizedTeam;
    const position = normalizePosition(row.position);
    if (team && position) {
      const key = `${normalizePlayerName(row.displayName)}:${team}:${position}`;
      const targets = canonicalByNameTeamPosition.get(key) ?? new Set<string>();
      targets.add(row.gsisId);
      canonicalByNameTeamPosition.set(key, targets);
    }
  }
  const canonicalTypedId = (source: CandidateRecord["source"], playerId: string) => {
    const type = inferCandidateProviderIdType(source, playerId);
    if (!type) return null;
    const targets = typedCanonicalTargets.get(`${type}:${playerId}`);
    return targets?.size === 1 ? [...targets][0]! : null;
  };
  const canonicalUntypedObservation = (
    name: string,
    teamValue: string | null,
    positionValue: string | null,
  ) => {
    const team = normalizeTeamCode(teamValue).normalizedTeam;
    const position = normalizePosition(positionValue);
    if (!team || !position) return null;
    const targets = canonicalByNameTeamPosition.get(
      `${normalizePlayerName(name)}:${team}:${position}`,
    );
    return targets?.size === 1 ? [...targets][0]! : null;
  };
  const records: CandidateRecord[] = [
    ...nflverse.flatMap((row) => Object.entries({
      gsis_id: row.gsisId,
      espn_id: row.espnId,
      pfr_id: row.pfrId,
      pff_id: row.pffId,
      otc_id: row.otcId,
      esb_id: row.esbId,
      nfl_id: row.nflId,
      smart_id: row.smartId,
    }).flatMap(([externalIdType, externalIdValue]) => externalIdValue ? [{
      gridlinePlayerId: row.gsisId,
      name: row.displayName,
      position: row.position,
      team: row.team,
      source: "nflverse_players",
      externalIdType,
      externalIdValue,
    }] : [])),
    ...players.map((row) => ({
      gridlinePlayerId: canonicalUntypedObservation(row.name, row.team, row.position)
        ?? row.playerId,
      name: row.name,
      position: row.position,
      team: row.team,
      source: "players",
      externalIdType: inferCandidateProviderIdType("players", row.playerId),
      externalIdValue: inferCandidateProviderIdType("players", row.playerId) ? row.playerId : null,
    })),
    ...stats.map((row) => ({
      gridlinePlayerId: canonicalTypedId("player_game_stats", row.playerId)
        ?? row.playerId,
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
      gridlinePlayerId: canonicalTypedId("snap_counts", row.playerId)
        ?? row.playerId,
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
      gridlinePlayerId: canonicalTypedId("historical_depth_charts", row.playerId)
        ?? row.playerId,
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
  const enriched = applyVerifiedPlayerCrosswalks(
    deduplicateGridlineCandidates(records),
    crosswalks,
  );
  return {
    ...enriched,
    durableIdentityImportId: latestNflverseImport?.id ?? null,
    durableIdentityRowCount: nflverse.length,
  };
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

async function verifiedSleeperCrosswalks() {
  const rows = await db.select().from(sleeperPlayerCrosswalkEvidenceTable)
    .orderBy(
      sleeperPlayerCrosswalkEvidenceTable.sourcePlayerId,
      desc(sleeperPlayerCrosswalkEvidenceTable.lastVerifiedAt),
      desc(sleeperPlayerCrosswalkEvidenceTable.id),
    );
  return {
    crosswalks: effectiveVerifiedCrosswalks(rows),
    evidenceRowCount: rows.length,
    evidenceFingerprints: new Set(rows.map((row) => row.evidenceFingerprint)),
  };
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
    const [crosswalkState, verifiedPlayerCrosswalk, durableCrosswalkRows] = await Promise.all([
      verifiedSleeperCrosswalks(),
      loadVerifiedPlayerCrosswalk(),
      db.select({
        sourceNamespace: playerIdentityCrosswalkRevisionsTable.sourceNamespace,
        sourcePlayerId: playerIdentityCrosswalkRevisionsTable.sourcePlayerId,
        targetNamespace: playerIdentityCrosswalkRevisionsTable.targetNamespace,
        targetPlayerId: playerIdentityCrosswalkRevisionsTable.targetPlayerId,
        gridlinePlayerId: playerIdentityCrosswalkRevisionsTable.gridlinePlayerId,
        evidenceMethod: playerIdentityCrosswalkRevisionsTable.evidenceMethod,
        evidenceConfidence: playerIdentityCrosswalkRevisionsTable.evidenceConfidence,
        firstObserved: playerIdentityCrosswalkRevisionsTable.firstObserved,
        lastVerified: playerIdentityCrosswalkRevisionsTable.lastVerified,
        evidenceFingerprint: playerIdentityCrosswalkRevisionsTable.evidenceFingerprint,
        ambiguityFlag: playerIdentityCrosswalkRevisionsTable.ambiguityFlag,
      }).from(playerIdentityCrosswalkRevisionsTable)
        .where(eq(playerIdentityCrosswalkRevisionsTable.sourceNamespace, "sleeper")),
    ]);
    const enrichedCandidates = await sourceCandidates(
      verifiedPlayerCrosswalk.rows,
    );
    const candidates = enrichedCandidates.candidates;
    const durableCrosswalks: VerifiedSleeperCrosswalk[] = durableCrosswalkRows.map((row) => ({
      sleeperPlayerId: row.sourcePlayerId,
      gridlinePlayerId: row.gridlinePlayerId,
      evidenceMethod: row.evidenceMethod,
      evidenceConfidence: row.evidenceConfidence === "high" ? 0.98 : 0,
      firstObservedAt: row.firstObserved,
      lastVerifiedAt: row.lastVerified,
      evidenceFingerprint: row.evidenceFingerprint,
      ambiguous: row.ambiguityFlag,
    }));
    const crosswalks = effectiveVerifiedCrosswalks([
      ...crosswalkState.crosswalks.map((row, id) => ({
        id,
        sourceNamespace: "sleeper",
        sourcePlayerId: row.sleeperPlayerId,
        gridlinePlayerId: row.gridlinePlayerId,
        evidenceMethod: row.evidenceMethod,
        evidenceConfidence: row.evidenceConfidence,
        firstObservedAt: row.firstObservedAt,
        lastVerifiedAt: row.lastVerifiedAt,
        evidenceFingerprint: row.evidenceFingerprint,
        ambiguous: row.ambiguous,
      })),
      ...durableCrosswalks.map((row, index) => ({
        id: crosswalkState.crosswalks.length + index,
        sourceNamespace: "sleeper",
        sourcePlayerId: row.sleeperPlayerId,
        gridlinePlayerId: row.gridlinePlayerId,
        evidenceMethod: row.evidenceMethod,
        evidenceConfidence: row.evidenceConfidence,
        firstObservedAt: row.firstObservedAt,
        lastVerifiedAt: row.lastVerifiedAt,
        evidenceFingerprint: row.evidenceFingerprint,
        ambiguous: row.ambiguous,
      })),
    ]);
    const staleBefore = new Date(startedAt.getTime() - 30 * 24 * 60 * 60 * 1000);
    const usableCrosswalks = crosswalks.filter((row) => row.lastVerifiedAt >= staleBefore);
    const candidateSetFingerprint = mappingCandidateFingerprint(candidates);
    const mapped = mapSleeperPlayers(players, candidates, usableCrosswalks);
    const sourceHashByPlayer = new Map(sourceRows.map((row) => [row.sleeperPlayerId, row.sourceHash]));
    for (const mapping of mapped.mappings) {
      mapping.sourceHash = sourceHashByPlayer.get(mapping.sleeperPlayerId) ?? "";
    }
    const depthCandidates = deriveDepthRelevantCandidates(players, mapped.mappings);
    const validationSample = buildValidationSample(players, mapped.mappings);
    const namespaceInventory = providerNamespaceInventory(players, candidates);
    const crosswalkEvidence = buildVerifiedCrosswalkEvidence(
      players,
      mapped.mappings,
      startedAt,
      crosswalks,
      mappingRunId,
    );
    const insertableCrosswalkEvidence = crosswalkEvidence.filter((row) =>
      !crosswalkState.evidenceFingerprints.has(row.evidenceFingerprint));
    let effectiveCrosswalkLinkCount = new Set([
      ...crosswalks.map((row) => `${row.sleeperPlayerId}:${row.gridlinePlayerId}`),
      ...insertableCrosswalkEvidence.map((row) => `${row.sourcePlayerId}:${row.gridlinePlayerId}`),
    ]).size;
    let crosswalkEvidenceRowCount =
      crosswalkState.evidenceRowCount + insertableCrosswalkEvidence.length;
    const staleCrosswalkEvidenceCount = countStaleEffectiveCrosswalks(
      crosswalks,
      crosswalkEvidence,
      staleBefore,
    );
    const coverage = calculateMappingCoverage(
      players,
      mapped.mappings,
      mapped.collisionCount,
      staleCrosswalkEvidenceCount,
    );
    await db.transaction(async (tx) => {
      await tx.execute(sql`select pg_advisory_xact_lock(hashtext('sleeper-identity-mapping-run'))`);
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
      for (let index = 0; index < insertableCrosswalkEvidence.length; index += 500) {
        const rows = insertableCrosswalkEvidence.slice(index, index + 500);
        if (!rows.length) continue;
        await tx.insert(sleeperPlayerCrosswalkEvidenceTable)
          .values(rows)
          .onConflictDoNothing({
            target: sleeperPlayerCrosswalkEvidenceTable.evidenceFingerprint,
          });
      }
      const [crosswalkCounts] = await tx.select({
        evidenceRowCount: sql<number>`count(*)::int`,
        effectiveLinkCount: sql<number>`count(distinct (
          ${sleeperPlayerCrosswalkEvidenceTable.sourceNamespace},
          ${sleeperPlayerCrosswalkEvidenceTable.sourcePlayerId},
          ${sleeperPlayerCrosswalkEvidenceTable.gridlinePlayerId}
        ))::int`,
      }).from(sleeperPlayerCrosswalkEvidenceTable);
      crosswalkEvidenceRowCount = crosswalkCounts?.evidenceRowCount ?? 0;
      effectiveCrosswalkLinkCount = crosswalkCounts?.effectiveLinkCount ?? 0;
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
          providerNamespaceInventory: namespaceInventory,
          trustedIdNamespaces: namespaceInventory
            .filter((item) => item.trustworthyForExactEquality)
            .map((item) => item.namespace),
          crosswalkEvidenceCount: crosswalkEvidenceRowCount,
          effectiveCrosswalkLinkCount,
          candidateCount: candidates.length,
          candidateSetFingerprint,
          candidateSetCapturedAt: startedAt.toISOString(),
          mappingVersion: SLEEPER_MAPPING_VERSION,
          nflverseCrosswalkFingerprint: verifiedPlayerCrosswalk.fingerprint,
          nflverseCrosswalkSourceUrl: verifiedPlayerCrosswalk.sourceUrl,
          nflverseCrosswalkRows: verifiedPlayerCrosswalk.rows.length,
          appliedNflverseCrosswalkRows: enrichedCandidates.appliedCrosswalkCount,
          rejectedNflverseCrosswalkRows: enrichedCandidates.rejectedCrosswalkCount,
          durableIdentityImportId: enrichedCandidates.durableIdentityImportId,
          durableIdentityRowCount: enrichedCandidates.durableIdentityRowCount,
          durableSleeperCrosswalkRowCount: durableCrosswalkRows.length,
        },
      });
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
      providerNamespaceInventory: namespaceInventory,
      crosswalkEvidenceCount: crosswalkEvidenceRowCount,
      effectiveCrosswalkLinkCount,
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

export type SleeperIdentityHealth = {
  status: "current" | "stale" | "unavailable";
  mappingVersion: string | null;
  latestAttemptMappingVersion: string | null;
  mappingRunId: string | null;
  sourceSnapshotId: string | null;
  lastUpdated: string | null;
  lastAttempted: string | null;
  staleAgeMs: number | null;
  latestFailure: string | null;
  recentFailureCount: number;
  durationMs: number | null;
  metadata: Record<string, unknown>;
};

export async function getSleeperIdentityHealth(): Promise<SleeperIdentityHealth> {
  const [run] = await db.select().from(sleeperIdentityMappingRunsTable)
    .where(sql`${sleeperIdentityMappingRunsTable.status} = 'success'
      and ${sleeperIdentityMappingRunsTable.mappingVersion} = ${SLEEPER_MAPPING_VERSION}`)
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
    mappingVersion: run?.mappingVersion ?? null,
    latestAttemptMappingVersion: attempt?.mappingVersion ?? null,
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

export function formatSleeperIdentityReport(health: SleeperIdentityHealth) {
  const compatible = health.mappingVersion === SLEEPER_MAPPING_VERSION;
  const metadata = compatible ? health.metadata : {};
  const objectMetric = (key: string) => {
    const value = metadata[key];
    return value && typeof value === "object" && !Array.isArray(value)
      ? value as Record<string, unknown>
      : {};
  };
  const numberMetric = (key: string) =>
    typeof metadata[key] === "number" ? metadata[key] as number : 0;
  const nullableStringMetric = (key: string) =>
    typeof metadata[key] === "string" ? metadata[key] as string : null;
  const arrayMetric = (key: string) =>
    Array.isArray(metadata[key]) ? metadata[key] as unknown[] : [];
  const coverageMetric = (key: string) => {
    const value = objectMetric(key);
    return {
      total: typeof value.total === "number" ? value.total : 0,
      mapped: typeof value.mapped === "number" ? value.mapped : 0,
      percentage: typeof value.percentage === "number" ? value.percentage : 0,
    };
  };
  return {
    ...health,
    status: compatible ? health.status : "unavailable" as const,
    mappingRunId: compatible ? health.mappingRunId : null,
    sourceSnapshotId: compatible ? health.sourceSnapshotId : null,
    lastUpdated: compatible ? health.lastUpdated : null,
    mappingVersion: compatible ? health.mappingVersion : null,
    expectedMappingVersion: SLEEPER_MAPPING_VERSION,
    mappingHierarchy: [
      "exact_provider_id",
      "exact_crosswalk",
      "normalized_name_team_position",
      "ambiguous_or_unmatched",
    ],
    report: {
      providerNamespaceInventory: arrayMetric("providerNamespaceInventory"),
      trustedIdNamespaces: arrayMetric("trustedIdNamespaces"),
      totalSleeperRows: numberMetric("totalSleeperRows"),
      currentTeamRows: numberMetric("currentTeamRows"),
      mappedCount: numberMetric("mappedCount"),
      exactProviderIdCount: numberMetric("exactProviderIdCount"),
      crosswalkCount: numberMetric("crosswalkCount"),
      normalizedNameTeamPositionCount: numberMetric("normalizedNameTeamPositionCount"),
      ambiguousCount: numberMetric("ambiguousCount"),
      unmatchedCount: numberMetric("unmatchedCount"),
      unresolvedCount: numberMetric("unresolvedCount"),
      collisionCount: numberMetric("collisionCount"),
      selectedStarterCollisionCount: numberMetric("selectedStarterCollisionCount"),
      staleCrosswalkEvidenceCount: numberMetric("staleCrosswalkEvidenceCount"),
      crosswalkEvidenceCount: numberMetric("crosswalkEvidenceCount"),
      effectiveCrosswalkLinkCount: numberMetric("effectiveCrosswalkLinkCount"),
      nflverseCrosswalkFingerprint: nullableStringMetric("nflverseCrosswalkFingerprint"),
      nflverseCrosswalkSourceUrl: nullableStringMetric("nflverseCrosswalkSourceUrl"),
      nflverseCrosswalkRows: numberMetric("nflverseCrosswalkRows"),
      appliedNflverseCrosswalkRows: numberMetric("appliedNflverseCrosswalkRows"),
      rejectedNflverseCrosswalkRows: numberMetric("rejectedNflverseCrosswalkRows"),
      overallMappingPercentage: numberMetric("overallMappingPercentage"),
      currentTeam: coverageMetric("currentTeam"),
      depthOrder: coverageMetric("depthOrder"),
      depthOrderOne: coverageMetric("depthOrderOne"),
      qbDepthOrderOne: coverageMetric("qbDepthOrderOne"),
      byPosition: objectMetric("byPosition"),
      roleCoverage: objectMetric("roleCoverage"),
      authoritativeDepthCohortDefinition:
        typeof metadata.authoritativeDepthCohortDefinition === "string"
          ? metadata.authoritativeDepthCohortDefinition
          : "Canonical current NFL team, non-null depth order, and supported normalized depth_chart_position.",
      suitabilityGates: objectMetric("suitabilityGates"),
      blockerCategories: arrayMetric("blockerCategories"),
      depthRelevantCandidates: arrayMetric("depthRelevantCandidates"),
      validationSample: arrayMetric("validationSample"),
    },
    majorRisks: [
      "Provider IDs can be absent or can conflict across upstream records.",
      "Name, team, and position collisions remain ambiguous and require review.",
      "Team changes are retained as explicit evidence and are not silently treated as current-team agreement.",
      "Depth-order completeness and identity coverage can change with each immutable Sleeper snapshot.",
    ],
    suitableForDepthLogic: compatible && metadata.suitableForDepthLogic === true,
    suitabilityVerdict: typeof metadata.suitabilityVerdict === "string"
      ? metadata.suitabilityVerdict
      : "SLEEPER MAPPING NOT SUITABLE FOR DEPTH LOGIC",
    safety: {
      phase61Untouched: true,
      productionModelsUntouched: true,
      consumerApiExposed: false,
      canonicalPlayerIdsMutated: false,
      sleeperSnapshotsMutated: false,
    },
  };
}

export async function getSleeperIdentityReport() {
  return formatSleeperIdentityReport(await getSleeperIdentityHealth());
}