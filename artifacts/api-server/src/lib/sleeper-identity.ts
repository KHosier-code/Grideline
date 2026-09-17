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
  playerGameStatsTable,
  playersTable,
  sleeperIdentityMappingRunsTable,
  sleeperIdentityMappingsTable,
  sleeperPlayerSnapshotsTable,
  nflversePlayerIdentitiesTable,
  playerIdentityCrosswalkRevisionsTable,
  snapCountsTable,
  teamsTable,
} from "@workspace/db";
import { SLEEPER_ACTIVE_TEAM_CODES, type SleeperPlayer } from "./sleeper";
import {
  loadVerifiedPlayerCrosswalk,
  type VerifiedPlayerCrosswalk,
} from "./nflverse-player-crosswalk";
import { logger } from "./logger";

export const SLEEPER_MAPPING_VERSION = "sleeper-identity-v5-verified-crosswalk";
export const DEPTH_MAPPING_SUITABILITY_MIN_PERCENT = 90;

export type MappingStatus =
  | "exact_provider_id"
  | "exact_crosswalk"
  | "normalized_name_team_position"
  | "supported_name_match"
  | "ambiguous"
  | "unmatched";

export type MappingMethod = MappingStatus | "none";

export type TrustedCrosswalk = {
  sourceNamespace: string;
  sourcePlayerId: string;
  targetNamespace: string;
  targetPlayerId: string;
  gridlinePlayerId: string;
  evidenceMethod?: string;
  evidenceConfidence?: string;
  ambiguityFlag?: boolean;
};

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
  // Gridline's players.player_id has no provider provenance. Numeric values
  // must not be silently interpreted as ESPN IDs.
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
    const linked = linkedIds.map((id) => merged.get(aliases.get(id) ?? id)).filter(
      (candidate): candidate is GridlineIdentityCandidate => Boolean(candidate),
    );
    const uniqueLinked = [...new Map(linked.map((candidate) => [candidate.gridlinePlayerId, candidate])).values()];
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
      Object.entries(candidate.crosswalkExternalIds).sort(([left], [right]) => left.localeCompare(right)),
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

function supportedPositionCompatibility(
  left: string | null | undefined,
  right: string | null | undefined,
) {
  if (positionCompatibility(left, right) === "compatible") return true;
  const normalizedLeft = normalizePosition(left);
  const normalizedRight = normalizePosition(right);
  const families = [
    new Set(["DB", "CB", "S"]),
    new Set(["DL", "EDGE", "DE", "DT"]),
    new Set(["OL", "OT", "OG", "C"]),
    new Set(["LB", "EDGE", "DE"]),
  ];
  return Boolean(normalizedLeft && normalizedRight
    && families.some((family) => family.has(normalizedLeft) && family.has(normalizedRight)));
}

type MappingIndexes = {
  byProviderId: Map<string, GridlineIdentityCandidate[]>;
  crosswalkProviderKeys: Set<string>;
  byName: Map<string, GridlineIdentityCandidate[]>;
};

function buildMappingIndexes(candidates: GridlineIdentityCandidate[]): MappingIndexes {
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
  return { byProviderId, crosswalkProviderKeys, byName };
}

function mapSleeperPlayerWithIndexes(
  player: SleeperPlayer,
  indexes: MappingIndexes,
  crosswalks: TrustedCrosswalk[] = [],
): SleeperIdentityMapping {
  const team = normalizeTeamCode(player.team);
  const normalizedPosition = normalizePosition(player.position);
  const providerIds = new Map(providerIdEntries(player.provider_ids));
  const byExactId = [...new Map(
    [...providerIds.entries()]
      .flatMap(([type, value]) => indexes.byProviderId.get(`${type}:${value}`) ?? [])
      .map((candidate) => [candidate.gridlinePlayerId, candidate] as const),
  ).values()];
  const exactName = byExactId.filter((candidate) =>
    providerIdentityNameCompatible(candidate.name, player.full_name));

  let status: MappingStatus = "unmatched";
  let selected: GridlineIdentityCandidate | null = null;
  let candidatesForEvidence = byExactId;
  let ambiguityReason: string | null = null;
  let unmatchedReason: string | null = null;

  const trusted = [...new Map(crosswalks
    .filter((row) => !row.ambiguityFlag
      && row.sourceNamespace.toLowerCase() === "sleeper"
      && row.sourcePlayerId === player.player_id
      && row.targetNamespace.toLowerCase() === "gsis")
    .map((row) => [row.gridlinePlayerId, row] as const)).values()];

  if (exactName.length > 0) {
    const exactIds = new Set(exactName.map((candidate) => candidate.gridlinePlayerId));
    candidatesForEvidence = exactName;
    if (exactIds.size === 1) {
      selected = exactName[0] ?? null;
      const selectedId = selected?.gridlinePlayerId;
      const hasNativeProviderEvidence = selectedId
        ? [...providerIds.entries()].some(([type, value]) =>
            selected?.externalIds[type] === value
            && !indexes.crosswalkProviderKeys.has(`${selectedId}:${type}:${value}`))
        : false;
      status = hasNativeProviderEvidence ? "exact_provider_id" : "exact_crosswalk";
    } else {
      status = "ambiguous";
      ambiguityReason = "Multiple exact provider IDs resolve to different Gridline identities.";
    }
  } else if (byExactId.length > 0) {
    status = "ambiguous";
    ambiguityReason = "Exact provider ID evidence conflicts with the player name.";
  } else if (trusted.length === 1) {
    const crosswalk = trusted[0]!;
    selected = indexes.byProviderId.get(`gsis_id:${crosswalk.targetPlayerId}`)?.[0] ?? null;
    if (selected) {
      status = "exact_crosswalk";
      candidatesForEvidence = [selected];
    } else {
      unmatchedReason = "Trusted crosswalk target is absent from Gridline candidates.";
    }
  } else if (trusted.length > 1) {
    status = "ambiguous";
    ambiguityReason = "Multiple trusted crosswalk identities resolve to one Sleeper player.";
  } else {
    const allNameCandidates = indexes.byName.get(normalizePlayerName(player.full_name)) ?? [];
    const nameCandidates = allNameCandidates
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
    } else {
      const supportedSameTeam = allNameCandidates.filter((candidate) =>
        team.normalizedTeam !== null
        && candidate.normalizedTeam === team.normalizedTeam
        && supportedPositionCompatibility(player.position, candidate.position)
        && (
          candidate.sources.includes("nflverse_player_crosswalk")
          || candidate.sources.includes("historical_depth_charts")
        ));
      if (supportedSameTeam.length === 1) {
        selected = supportedSameTeam[0] ?? null;
        status = "supported_name_match";
        candidatesForEvidence = supportedSameTeam;
      } else if (supportedSameTeam.length > 1) {
        status = "ambiguous";
        ambiguityReason = "Multiple verified identities share the normalized name, team, and supported position family.";
        candidatesForEvidence = supportedSameTeam;
      } else if (nameCandidates.length > 0) {
        status = "ambiguous";
        ambiguityReason = "Name and position match, but latest team evidence is absent or conflicting.";
        candidatesForEvidence = nameCandidates;
      } else {
        unmatchedReason = "No stable provider ID or constrained name/team/position candidate was found.";
      }
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
  crosswalks?: TrustedCrosswalk[],
): SleeperIdentityMapping {
  return mapSleeperPlayerWithIndexes(player, buildMappingIndexes(candidates), crosswalks);
}

export function mapSleeperPlayers(
  players: SleeperPlayer[],
  candidates: GridlineIdentityCandidate[],
  crosswalks?: TrustedCrosswalk[],
) {
  const indexes = buildMappingIndexes(candidates);
  const mappings = players.map((player) => mapSleeperPlayerWithIndexes(player, indexes, crosswalks));
  const mappedByGridline = new Map<string, SleeperIdentityMapping[]>();
  for (const mapping of mappings) {
    if (!mapping.mappedGridlinePlayerId || mapping.mappingStatus === "ambiguous") continue;
    const group = mappedByGridline.get(mapping.mappedGridlinePlayerId) ?? [];
    group.push(mapping);
    mappedByGridline.set(mapping.mappedGridlinePlayerId, group);
  }
  let collisionCount = 0;
  let detectedCollisionCount = 0;
  for (const group of mappedByGridline.values()) {
    if (group.length < 2) continue;
    detectedCollisionCount += 1;
    if (group.some((mapping) => mapping.depthRelevant)) collisionCount += 1;
    for (const mapping of group) {
      mapping.mappingStatus = "ambiguous";
      mapping.mappingMethod = "ambiguous";
      mapping.mappingConfidence = 0;
      mapping.mappedGridlinePlayerId = null;
      mapping.ambiguityReason = "Multiple Sleeper players resolve to one Gridline identity.";
      mapping.evidenceSummary = mapping.ambiguityReason;
    }
  }
  return {
    mappings,
    collisionCount,
    detectedCollisionCount,
  };
}

function percent(numerator: number, denominator: number) {
  return denominator ? Number(((numerator / denominator) * 100).toFixed(2)) : 0;
}

function depthRolePosition(player: SleeperPlayer) {
  const position = normalizePosition(player.depth_chart_position ?? player.position);
  if (position === "FS" || position === "SS" || position === "DB") return "S";
  if (position === "OT" || position === "OG" || position === "C") return "OL";
  return position;
}

export function calculateMappingCoverage(
  players: SleeperPlayer[],
  mappings: SleeperIdentityMapping[],
  collisionCount = 0,
  crosswalks: Array<{ lastVerified?: Date | string; ambiguityFlag?: boolean }> = [],
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
  const currentRosterPlayers = players.filter((player) => {
    const canonicalTeam = normalizeTeamCode(player.team).normalizedTeam;
    const status = player.status?.toLowerCase();
    const activeStatus = status === "active" || status === "current" || status === "act";
    return Boolean(canonicalTeam && (activeStatus || player.depth_chart_order !== null));
  });
  const currentRosterIds = new Set(currentRosterPlayers.map((player) => player.player_id));
  const currentTeam = mappings.filter((mapping) => mapping.normalizedTeam);
  const currentRoster = mappings.filter((mapping) => currentRosterIds.has(mapping.sleeperPlayerId));
  const mapPercent = (rows: SleeperIdentityMapping[]) =>
    percent(rows.filter((row) => row.mappedGridlinePlayerId).length, rows.length);
  const priority = new Set(players.filter((player) => {
    const pos = depthRolePosition(player);
    const order = player.depth_chart_order ?? 999;
    const max = pos === "QB" || pos === "RB" || pos === "TE" ? 3
      : pos === "WR" ? 5
        : pos === "CB" || pos === "S" ? 4
          : pos === "OL" || pos === "EDGE" || pos === "LB" ? 1
            : 0;
    return max > 0 && order >= 1 && order <= max;
  }).map((player) => player.player_id));
  const priorityRows = mappings.filter((row) => priority.has(row.sleeperPlayerId));
  const qb1Ids = new Set(players.filter((player) =>
    depthRolePosition(player) === "QB" && player.depth_chart_order === 1,
  ).map((player) => player.player_id));
  const qb1Rows = mappings.filter((row) => qb1Ids.has(row.sleeperPlayerId));
  const selectedSleeperIds = new Set(deriveDepthRelevantCandidates(players, mappings)
    .flatMap((row) => row.sleeperPlayerId ? [row.sleeperPlayerId] : []));
  const selectedIds = new Map<string, string[]>();
  for (const mapping of mappings) {
    if (!selectedSleeperIds.has(mapping.sleeperPlayerId)) continue;
    const possibleId = mapping.mappedGridlinePlayerId
      ?? (mapping.ambiguityReason === "Multiple Sleeper players resolve to one Gridline identity."
        ? mapping.candidateGridlinePlayerIds[0] ?? null
        : null);
    if (!possibleId) continue;
    const ids = selectedIds.get(possibleId) ?? [];
    ids.push(mapping.sleeperPlayerId);
    selectedIds.set(possibleId, ids);
  }
  const selectedDepthStarterCollisionCount = [...selectedIds.values()].filter((ids) => ids.length > 1).length;
  const staleCutoff = Date.now() - 30 * 24 * 60 * 60 * 1000;
  const staleCrosswalkCount = crosswalks.filter((row) =>
    row.lastVerified && new Date(row.lastVerified).getTime() < staleCutoff).length;
  const blockers = [
    ...(depthOrder.percentage < 90 ? ["depth_order_below_90"] : []),
    ...(depthOrderOne.percentage < 90 ? ["depth_order_one_below_90"] : []),
    ...(mapPercent(qb1Rows) < 100 ? ["qb1_not_100"] : []),
    ...(selectedDepthStarterCollisionCount > 0 ? ["selected_depth_starter_collisions"] : []),
    ...(staleCrosswalkCount > 0 ? ["stale_crosswalk_evidence"] : []),
  ];
  const suitableForDepthLogic = depthOrder.percentage >= DEPTH_MAPPING_SUITABILITY_MIN_PERCENT
    && depthOrderOne.percentage >= DEPTH_MAPPING_SUITABILITY_MIN_PERCENT
    && mapPercent(qb1Rows) === 100
    && selectedDepthStarterCollisionCount === 0;
  return {
    totalSleeperRows: total,
    currentTeamRows: active.length,
    currentRosterRows: currentRoster.length,
    mappedCount: mapped.length,
    exactProviderIdCount: countByStatus("exact_provider_id"),
    crosswalkCount: countByStatus("exact_crosswalk"),
    normalizedNameTeamPositionCount: countByStatus("normalized_name_team_position"),
    supportedNameCount: countByStatus("supported_name_match"),
    ambiguousCount: countByStatus("ambiguous"),
    unmatchedCount: countByStatus("unmatched"),
    overallMappingPercentage: percent(mapped.length, total),
    currentTeamMappingPercentage: mapPercent(currentTeam),
    currentRosterMappingPercentage: mapPercent(currentRoster),
    exactProviderIdPercentage: percent(countByStatus("exact_provider_id"), total),
    crosswalkPercentage: percent(countByStatus("exact_crosswalk"), total),
    nameTeamPositionPercentage: percent(countByStatus("normalized_name_team_position"), total),
    supportedNamePercentage: percent(countByStatus("supported_name_match"), total),
    byPosition: positionCoverage,
    depthOrder,
    depthOrderOne,
    depthPriority: {
      total: priorityRows.length, mapped: priorityRows.filter((row) => row.mappedGridlinePlayerId).length,
      percentage: mapPercent(priorityRows),
    },
    qb1: { total: qb1Rows.length, mapped: qb1Rows.filter((row) => row.mappedGridlinePlayerId).length, percentage: mapPercent(qb1Rows) },
    teamAliasNormalizationCount: mappings.filter((mapping) => mapping.teamNormalizationMethod === "legacy_alias").length,
    collisionCount,
    selectedDepthStarterCollisionCount,
    staleCrosswalkCount,
    blockerCategories: blockers,
    suitabilityMinimumPercentage: DEPTH_MAPPING_SUITABILITY_MIN_PERCENT,
    suitableForDepthLogic,
    suitabilityVerdict: suitableForDepthLogic
      ? "SLEEPER MAPPING SUITABLE FOR DEPTH LOGIC"
      : "SLEEPER MAPPING NOT SUITABLE FOR DEPTH LOGIC",
  };
}

export type DepthRelevantCandidate = {
  team: string;
  role: "QB1" | "QB2" | "RB1" | "WR" | "TE1" | "CB1" | "CB2" | "S1" | "OL1" | "EDGE1" | "LB1";
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
      depthRolePosition(player) === position);
    add(byPosition("QB")[0], "QB1");
    add(byPosition("QB")[1], "QB2");
    add(byPosition("RB")[0], "RB1");
    for (const player of byPosition("WR").slice(0, 5)) add(player, "WR");
    add(byPosition("TE")[0], "TE1");
    add(byPosition("CB")[0], "CB1");
    add(byPosition("CB")[1], "CB2");
    add(byPosition("S")[0], "S1");
    add(byPosition("OL")[0], "OL1");
    add(byPosition("EDGE")[0], "EDGE1");
    add(byPosition("LB")[0], "LB1");
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
    .filter((team): team is string => Boolean(team)))].sort().slice(0, 20);
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
      evidenceSource: mapping?.mappingMethod === "exact_provider_id" ? "typed provider ID"
        : mapping?.mappingMethod === "exact_crosswalk" ? "verified crosswalk" : "roster evidence",
      conflict: mapping?.ambiguityReason ?? null,
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
        .sort((left, right) =>
          (left.depth_chart_order ?? 999) - (right.depth_chart_order ?? 999)
          || left.player_id.localeCompare(right.player_id))[0];
      if (player) addPlayer(player, team, position);
    }
  }
  return sample;
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
  return applyVerifiedPlayerCrosswalks(
    deduplicateGridlineCandidates(records),
    crosswalks,
  );
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
    const verifiedCrosswalk = await loadVerifiedPlayerCrosswalk();
    const enriched = await sourceCandidates(verifiedCrosswalk.rows);
    const candidates = enriched.candidates;
    const trustedCrosswalks = await db.select({
      sourceNamespace: playerIdentityCrosswalkRevisionsTable.sourceNamespace,
      sourcePlayerId: playerIdentityCrosswalkRevisionsTable.sourcePlayerId,
      targetNamespace: playerIdentityCrosswalkRevisionsTable.targetNamespace,
      targetPlayerId: playerIdentityCrosswalkRevisionsTable.targetPlayerId,
      gridlinePlayerId: playerIdentityCrosswalkRevisionsTable.gridlinePlayerId,
      ambiguityFlag: playerIdentityCrosswalkRevisionsTable.ambiguityFlag,
      lastVerified: playerIdentityCrosswalkRevisionsTable.lastVerified,
    }).from(playerIdentityCrosswalkRevisionsTable);
    const crosswalkEvidenceFingerprint = createHash("sha256").update(JSON.stringify(
      trustedCrosswalks.map((row) => Object.values(row)).sort(),
    )).digest("hex");
    const candidateSetFingerprint = mappingCandidateFingerprint(candidates);
    const mapped = mapSleeperPlayers(players, candidates, trustedCrosswalks);
    const coverage = calculateMappingCoverage(players, mapped.mappings, mapped.collisionCount, trustedCrosswalks);
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
           crosswalkEvidenceFingerprint,
           crosswalkSourceUrl: verifiedCrosswalk.sourceUrl,
           crosswalkFingerprint: verifiedCrosswalk.fingerprint,
           appliedCrosswalkCount: enriched.appliedCrosswalkCount,
           rejectedCrosswalkCount: enriched.rejectedCrosswalkCount,
           detectedCollisionCount: mapped.detectedCollisionCount,
           mappingInputFingerprint: createHash("sha256").update(JSON.stringify({
             mappingVersion: SLEEPER_MAPPING_VERSION,
             sourceRows: sourceRows.map((row) => row.sourceHash),
             candidateSetFingerprint,
             crosswalkEvidenceFingerprint,
              crosswalkFingerprint: verifiedCrosswalk.fingerprint,
           })).digest("hex"),
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
      crosswalkEvidenceFingerprint,
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

function providerIdentityNameCompatible(
  left: string | null | undefined,
  right: string | null | undefined,
) {
  const leftParts = normalizePlayerName(left).split(" ").filter(Boolean);
  const rightParts = normalizePlayerName(right).split(" ").filter(Boolean);
  if (leftParts.join(" ") === rightParts.join(" ")) return true;
  return leftParts.length >= 2
    && rightParts.length >= 2
    && leftParts[0]?.[0] === rightParts[0]?.[0]
    && leftParts.at(-1) === rightParts.at(-1);
}