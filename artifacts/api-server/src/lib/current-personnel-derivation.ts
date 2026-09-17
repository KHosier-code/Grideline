import {
  normalizePosition,
  personnelUnit,
  type DateLike,
  type PersonnelHistoricalDepthRow,
  type PersonnelInjuryRow,
  type PersonnelQbRow,
  type PersonnelSnapRow,
} from "./personnel-context-derivation";

export type CurrentDepthSource = {
  playerId: string;
  playerName: string | null;
  teamId: string;
  sourceTeamId: string | null;
  position: string | null;
  role: string | null;
  depthOrder: number | null;
  source: "verified_published_depth" | "sleeper";
  classification: "official" | "published_secondary";
  capturedAt: DateLike;
  sourceUpdatedAt?: DateLike;
  mappingStatus?: string | null;
  mappingConfidence?: number | null;
  sourcePlayerId?: string | null;
  sourceTeamConflict?: boolean;
  mappingConflictReason?: string | null;
  sleeperStatus?: string | null;
  sleeperInjuryStatus?: string | null;
  sleeperPracticeParticipation?: string | null;
  sourceUrl?: string | null;
  verificationMethod?: string | null;
  observedAt?: DateLike | null;
  verifiedAt?: DateLike | null;
  evidenceId?: string | null;
  availability?: string | null;
  injuryStatus?: string | null;
  provenance?: Record<string, unknown> | null;
  season?: number | null;
};

export type PersonnelConflict = {
  type: "provider" | "team" | "depth_order" | "participation" | "injury" | "identity";
  playerId: string | null;
  position: string | null;
  severity: "warning" | "blocking";
  explanation: string;
};

export type InterpretedDepthPlayer = {
  playerId: string;
  playerName: string | null;
  teamId: string;
  position: string | null;
  unit: string;
  role: string | null;
  rank: number | null;
  starter: boolean;
  source: string;
  sourceClassification: "official" | "published_secondary" | "inferred";
  providerLabel: string;
  providerEvidence: Array<{
    source: string;
    classification: "official" | "published_secondary";
    rank: number | null;
    capturedAt: string | null;
  }>;
  recentSnapShare: number | null;
  recentGames: number;
  injuryState: {
    injury: string | null;
    practiceStatus: string | null;
    gameStatus: string | null;
    asOf: string | null;
    source: "espn" | "verified_depth" | "sleeper_supplemental" | null;
    sleeperStatus: string | null;
    sleeperInjuryStatus: string | null;
    sleeperPracticeParticipation: string | null;
  };
  confidence: number;
  freshness: "current" | "stale" | "unavailable";
  explanation: string[];
  conflicts: PersonnelConflict[];
  publishedStarter?: boolean;
  availability?: "available" | "questionable" | "doubtful" | "out" | "unknown";
  unavailableReason?: string | null;
  provenance?: {
    source: string;
    sourceUrl: string | null;
    observedAt: string | null;
    verifiedAt: string | null;
    verificationMethod: string | null;
    evidenceId: string | null;
  };
};

export type QbStarterInterpretation = {
  status: "available" | "conflict" | "unavailable";
  player: InterpretedDepthPlayer | null;
  confidence: number;
  supportingEvidence: string[];
  conflicts: PersonnelConflict[];
  unavailableReason: string | null;
};

export type InterpretedTeamDepth = {
  teamId: string;
  teamName: string | null;
  abbreviation: string | null;
  asOf: string;
  freshness: "current" | "stale" | "unavailable";
  sourcePrecedence: string[];
  depth: {
    offense: InterpretedDepthPlayer[];
    defense: InterpretedDepthPlayer[];
    specialTeams: InterpretedDepthPlayer[];
    unknown: InterpretedDepthPlayer[];
  };
  qbStarter: QbStarterInterpretation;
  wrRoles: InterpretedDepthPlayer[];
  cbRoles: InterpretedDepthPlayer[];
  conflicts: PersonnelConflict[];
  positionalCoverage: Record<string, number>;
  downstreamReady: boolean;
  unavailableReasons: string[];
  injuryReport: Array<{
    playerName: string | null;
    position: string | null;
    injury: string | null;
    practiceStatus: string | null;
    gameStatus: string | null;
    asOf: string | null;
    source: "espn";
  }>;
  expectedLineup?: {
    status: "available" | "partial" | "unavailable" | "ambiguous";
    players: Array<InterpretedDepthPlayer & {
      projected: boolean;
      replacementForPlayerId: string | null;
      projectionReason: string;
    }>;
    unavailableReasons: string[];
  };
};

const OFFENSE = new Set(["QB", "RB", "FB", "WR", "TE", "OL", "OT", "T", "LT", "RT", "G", "LG", "RG", "C"]);
const DEFENSE = new Set(["DL", "DE", "DT", "NT", "EDGE", "LB", "ILB", "OLB", "MLB", "CB", "S", "FS", "SS", "DB"]);
const SPECIAL_TEAMS = new Set(["K", "P", "LS", "KR", "PR"]);
const REQUIRED = ["QB", "RB", "WR", "TE", "OT", "OG", "C", "EDGE", "DT", "LB", "CB", "S"];
const REQUIRED_STARTER_ROLE_CARDS = [
  "QB1", "RB1", "WR1", "WR2", "WR3", "TE1",
  "LT1", "LG1", "C1", "RG1", "RT1",
  "DT1", "DT2", "LB1", "LB2", "CB1", "CB2", "CB3_OR_SLOT",
  "FS1", "SS1", "EDGE1", "EDGE2", "K1", "P1", "LS1",
] as const;
const CURRENT_INJURY_EVIDENCE_MS = 7 * 86_400_000;

function timestamp(value: DateLike) {
  if (value instanceof Date) return value.getTime();
  const parsed = typeof value === "string" ? Date.parse(value) : NaN;
  return Number.isFinite(parsed) ? parsed : null;
}

function asIso(value: DateLike) {
  const parsed = timestamp(value);
  return parsed === null ? null : new Date(parsed).toISOString();
}

function clean(value: string | null | undefined) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function clamp(value: number) {
  return Math.max(0, Math.min(100, Math.round(value)));
}

function normalizedSlot(value: string | null | undefined) {
  const position = normalizePosition(value);
  if (["LT", "RT", "T", "OT"].includes(position ?? "")) return "OT";
  if (["LG", "RG", "G", "OG"].includes(position ?? "")) return "OG";
  return position;
}

function normalizedRole(value: string | null | undefined) {
  const role = clean(value)?.toUpperCase() ?? null;
  if (role === "NB") return "NCB";
  return role;
}

const VERIFIED_ROLE_CARD = /^(?:QB[12]|RB[12]|WR[123]|TE1|LT1|LG1|C1|RG1|RT1|DT[12]|LB[12]|CB[12]|CB3_OR_SLOT|FS1|SS1|EDGE[12]|K1|P1|LS1)$/;

function exactVerifiedRole(row: Pick<CurrentDepthSource, "source" | "classification" | "role">) {
  const role = normalizedRole(row.role);
  return row.source === "verified_published_depth"
    && row.classification === "official"
    && role
    && VERIFIED_ROLE_CARD.test(role)
    ? role
    : null;
}

function interpretedPosition(row: Pick<CurrentDepthSource, "position" | "role">) {
  const exactRole = exactVerifiedRole(row as Pick<CurrentDepthSource, "source" | "classification" | "role">);
  if (exactRole && /^(?:LT1|LG1|C1|RG1|RT1|FS1|SS1)$/.test(exactRole)) {
    return exactRole.replace(/1$/, "");
  }
  const position = normalizedSlot(row.position);
  const role = normalizedRole(row.role);
  if (role && ["LCB", "RCB"].includes(role) && ["CB", "S"].includes(position ?? "")) return "CB";
  if (role && ["SCB", "NCB"].includes(role) && position === "CB") return "CB";
  if (role && ["FS", "SS"].includes(role) && ["CB", "S"].includes(position ?? "")) return "S";
  // An OLB role alone is not proof of edge usage. DE/E/EDGE roster evidence
  // is required before a left/right outside role is treated as EDGE.
  if (role && ["LOLB", "ROLB"].includes(role) && position !== "EDGE") return "LB";
  return position ?? normalizedSlot(row.role);
}

function depthSlot(row: Pick<CurrentDepthSource, "position" | "role">) {
  const exactRole = exactVerifiedRole(row as Pick<CurrentDepthSource, "source" | "classification" | "role">);
  if (exactRole) return exactRole;
  const position = interpretedPosition(row);
  const role = normalizedRole(row.role);
  if (position === "WR" && role && ["LWR", "RWR", "SWR", "WR"].includes(role)) return role;
  if (position === "CB" && role && ["LCB", "RCB", "SCB", "NCB", "CB"].includes(role)) return role;
  if (position === "S" && role && ["FS", "SS", "S"].includes(role)) return role;
  if (position === "EDGE" && role && ["LDE", "RDE", "EDGE", "DE"].includes(role)) return role;
  return position ?? normalizedSlot(row.role) ?? "UNKNOWN";
}

function publishedRoleIsStarter(row: Pick<CurrentDepthSource, "role" | "depthOrder">) {
  const role = normalizedRole(row.role);
  if (role && VERIFIED_ROLE_CARD.test(role)) {
    return role !== "QB2" && role !== "RB2" && row.depthOrder === 1;
  }
  return row.depthOrder === 1;
}

function isOffensiveLinePosition(value: string | null | undefined) {
  const upper = clean(value)?.toUpperCase() ?? "";
  return ["OL", "OT", "T", "LT", "RT", "OG", "G", "LG", "RG", "C"].includes(upper);
}

function snapShare(row: PersonnelSnapRow) {
  const position = normalizePosition(row.position);
  if (OFFENSE.has(position ?? "")) return row.offensePct ?? null;
  if (DEFENSE.has(position ?? "")) return row.defensePct ?? null;
  return row.specialTeamsPct ?? null;
}

function latestInjury(rows: PersonnelInjuryRow[], teamId: string, playerId: string, cutoff: number) {
  return rows
    .filter((row) => row.teamId === teamId && row.playerId === playerId)
    .filter((row) => (timestamp(row.snapshotTimestamp) ?? Infinity) <= cutoff)
    .filter((row) => (timestamp(row.sourceUpdatedAt ?? row.snapshotTimestamp) ?? Infinity) <= cutoff)
    // ESPN ingestion records currently reported injuries but has no removal
    // tombstone. Older omissions therefore cannot remain authoritative.
    .filter((row) => (timestamp(row.snapshotTimestamp) ?? -Infinity) >= cutoff - CURRENT_INJURY_EVIDENCE_MS)
    .sort((a, b) => (timestamp(b.snapshotTimestamp) ?? -1) - (timestamp(a.snapshotTimestamp) ?? -1))[0];
}

function recentParticipation(rows: PersonnelSnapRow[], teamId: string, playerId: string, cutoff: number) {
  const recent = rows
    .filter((row) => row.teamId === teamId && row.playerId === playerId)
    .filter((row) => (timestamp(row.kickoffTime) ?? Infinity) < cutoff)
    .filter((row) => (timestamp(row.sourceUpdatedAt) ?? Infinity) <= cutoff)
    .sort((a, b) => (timestamp(b.kickoffTime) ?? -1) - (timestamp(a.kickoffTime) ?? -1))
    .slice(0, 4);
  const shares = recent.map(snapShare).filter((value): value is number => value !== null && Number.isFinite(value));
  return {
    games: recent.length,
    share: shares.length ? shares.reduce((sum, value) => sum + value, 0) / shares.length : null,
  };
}

function unitGroup(position: string | null) {
  if (OFFENSE.has(position ?? "")) return "offense" as const;
  if (DEFENSE.has(position ?? "")) return "defense" as const;
  if (SPECIAL_TEAMS.has(position ?? "")) return "specialTeams" as const;
  return "unknown" as const;
}

function injuryUnavailable(value: string | null | undefined) {
  return /out|inactive|injured reserve|\bir\b|suspend|physically unable/i.test(value ?? "");
}

function explicitlyAvailable(value: string | null | undefined) {
  return /active|available|full|healthy|probable/i.test(value ?? "");
}

function availabilityState(value: string | null | undefined): InterpretedDepthPlayer["availability"] {
  if (!value) return "unknown";
  if (/out|inactive|injured reserve|\bir\b|suspend|physically unable/i.test(value)) return "out";
  if (/doubtful/i.test(value)) return "doubtful";
  if (/questionable|limited|day.to.day/i.test(value)) return "questionable";
  if (/active|available|full|healthy|probable/i.test(value)) return "available";
  return "unknown";
}

export function deriveCurrentTeamDepth(input: {
  teamId: string;
  teamName?: string | null;
  abbreviation?: string | null;
  cutoff?: Date;
  publishedDepth: CurrentDepthSource[];
  snaps: PersonnelSnapRow[];
  historicalDepth: PersonnelHistoricalDepthRow[];
  injuries: PersonnelInjuryRow[];
  qbs?: PersonnelQbRow[];
  season?: number;
  playerNames?: Record<string, string>;
}): InterpretedTeamDepth {
  const cutoff = input.cutoff ?? new Date();
  const cutoffTime = cutoff.getTime();
  const conflicts: PersonnelConflict[] = [];
  const evidenceSeason = (value: DateLike) => {
    const parsed = timestamp(value);
    if (parsed === null) return null;
    const date = new Date(parsed);
    return date.getUTCMonth() < 2 ? date.getUTCFullYear() - 1 : date.getUTCFullYear();
  };
  const sourceRows = input.publishedDepth
    .filter((row) => row.teamId === input.teamId)
    .filter((row) => input.season === undefined
      || (row.season ?? evidenceSeason(row.capturedAt)) === input.season)
    .filter((row) => (timestamp(row.capturedAt) ?? Infinity) <= cutoffTime)
    .filter((row) => (timestamp(row.sourceUpdatedAt ?? row.capturedAt) ?? Infinity) <= cutoffTime);
  const latestByProviderPlayerSlot = new Map<string, CurrentDepthSource>();
  for (const row of sourceRows) {
    const key = `${row.source}:${row.playerId}:${depthSlot(row)}`;
    const prior = latestByProviderPlayerSlot.get(key);
    if (!prior || (timestamp(row.capturedAt) ?? -1) > (timestamp(prior.capturedAt) ?? -1)) {
      latestByProviderPlayerSlot.set(key, row);
    }
  }
  const latestRows = [...latestByProviderPlayerSlot.values()];
  const rows: CurrentDepthSource[] = [...latestRows];

  for (const row of latestRows) {
    if (row.sourceTeamConflict) conflicts.push({
      type: "team", playerId: row.playerId, position: normalizePosition(row.position),
      severity: "warning", explanation: "Mapped identity team evidence disagrees with the current published team.",
    });
    if (row.mappingConflictReason) conflicts.push({
      type: "identity", playerId: row.playerId, position: normalizePosition(row.position),
      severity: "blocking", explanation: row.mappingConflictReason,
    });
  }

  const availableSlots = new Set(rows.map((row) => normalizedSlot(row.position ?? row.role)).filter(Boolean));
  const recentByPosition = new Map<string, PersonnelSnapRow[]>();
  for (const row of input.snaps.filter((item) =>
    item.teamId === input.teamId && (input.season === undefined || item.season === input.season))) {
    const position = normalizedSlot(row.position);
    if (!position || isOffensiveLinePosition(row.position) || availableSlots.has(position)) continue;
    if ((timestamp(row.kickoffTime) ?? Infinity) >= cutoffTime || (timestamp(row.sourceUpdatedAt) ?? Infinity) > cutoffTime) continue;
    recentByPosition.set(position, [...(recentByPosition.get(position) ?? []), row]);
  }
  for (const [position, candidates] of recentByPosition) {
    const byPlayer = new Map<string, PersonnelSnapRow[]>();
    for (const row of candidates) byPlayer.set(row.playerId, [...(byPlayer.get(row.playerId) ?? []), row]);
    const winner = [...byPlayer.entries()]
      .map(([playerId, playerRows]) => ({ playerId, playerRows, evidence: recentParticipation(input.snaps, input.teamId, playerId, cutoffTime) }))
      .sort((a, b) => (b.evidence.share ?? -1) - (a.evidence.share ?? -1))[0];
    if (winner) {
      const row = winner.playerRows[0]!;
      rows.push({
        playerId: winner.playerId, playerName: row.playerName, teamId: input.teamId,
        sourceTeamId: row.sourceTeamId ?? null, position, role: null, depthOrder: 1,
        source: "sleeper", classification: "published_secondary",
        capturedAt: row.sourceUpdatedAt, sourceUpdatedAt: row.sourceUpdatedAt,
        mappingStatus: "participation_inference", mappingConfidence: null,
      });
    }
  }

  const inferredSlots = new Set(rows.map((row) => normalizedSlot(row.position ?? row.role)).filter(Boolean));
  for (const historical of [...input.historicalDepth]
    .filter((row) => row.teamId === input.teamId && (row.depthPosition ?? 99) <= 2)
    .filter((row) => input.season === undefined || row.season === input.season)
    .filter((row) => (timestamp(row.sourceSnapshotAt ?? row.sourceUpdatedAt) ?? Infinity) <= cutoffTime)
    .sort((a, b) => (timestamp(b.sourceSnapshotAt ?? b.sourceUpdatedAt) ?? -1) - (timestamp(a.sourceSnapshotAt ?? a.sourceUpdatedAt) ?? -1))) {
    const position = normalizedSlot(historical.position);
    if (!position || isOffensiveLinePosition(historical.position) || inferredSlots.has(position)) continue;
    inferredSlots.add(position);
    rows.push({
      playerId: historical.playerId, playerName: historical.playerName ?? null, teamId: input.teamId,
      sourceTeamId: historical.sourceTeamId ?? null, position: historical.position ?? null,
      role: historical.role ?? null, depthOrder: historical.depthPosition ?? null,
      source: "sleeper", classification: "published_secondary",
      capturedAt: historical.sourceSnapshotAt ?? historical.sourceUpdatedAt,
      mappingStatus: "historical_inference", mappingConfidence: null,
    });
  }

  const reconciledRows = new Map<string, CurrentDepthSource>();
  for (const row of rows) {
    const slot = depthSlot(row);
    const key = `${slot}:${row.playerId}`;
    const prior = reconciledRows.get(key);
    if (!prior || (row.classification === "official" && prior.classification !== "official")) {
      reconciledRows.set(key, row);
    }
  }
  const bySlot = new Map<string, CurrentDepthSource[]>();
  for (const row of reconciledRows.values()) {
    const slot = depthSlot(row);
    bySlot.set(slot, [...(bySlot.get(slot) ?? []), row]);
  }
  const interpreted: InterpretedDepthPlayer[] = [];
  for (const [slot, candidates] of bySlot) {
    const position = candidates[0] ? interpretedPosition(candidates[0]) : null;
    const officialFirst = candidates.filter((row) =>
      row.classification === "official" && row.depthOrder === 1);
    const sleeperFirst = candidates.filter((row) =>
      row.source === "sleeper" && row.mappingStatus !== "participation_inference"
      && row.mappingStatus !== "historical_inference" && row.depthOrder === 1);
    if (officialFirst.length && sleeperFirst.some((row) =>
      !officialFirst.some((official) => official.playerId === row.playerId))) {
      conflicts.push({
        type: "provider",
        playerId: officialFirst[0]?.playerId ?? null,
        position,
        severity: "warning",
        explanation: `Verified published depth and Sleeper identify different rank-1 players at ${slot}; verified depth retains precedence.`,
      });
    }
    const ordered = candidates.sort((a, b) =>
      (a.depthOrder ?? 999) - (b.depthOrder ?? 999)
      || (b.mappingConfidence ?? 0) - (a.mappingConfidence ?? 0)
      || a.playerId.localeCompare(b.playerId));
    const duplicateRanks = new Map<number, CurrentDepthSource[]>();
    for (const row of ordered) {
      if (row.depthOrder !== null) duplicateRanks.set(row.depthOrder, [...(duplicateRanks.get(row.depthOrder) ?? []), row]);
    }
    for (const [rank, tied] of duplicateRanks) {
      if (tied.length > 1) conflicts.push({
        type: "depth_order", playerId: null, position,
        severity: rank === 1 ? "blocking" : "warning",
        explanation: `${tied.length} players share published depth rank ${rank} at ${slot}.`,
      });
    }
    const topParticipation = ordered
      .map((row) => ({ row, evidence: recentParticipation(
        input.season === undefined ? input.snaps : input.snaps.filter((snap) => snap.season === input.season),
        input.teamId, row.playerId, cutoffTime,
      ) }))
      .sort((a, b) => (b.evidence.share ?? -1) - (a.evidence.share ?? -1))[0];
    for (const row of ordered) {
      const providerEvidence = rows
        .filter((source) =>
          source.playerId === row.playerId
          && depthSlot(source) === slot
          && source.mappingStatus !== "participation_inference"
          && source.mappingStatus !== "historical_inference")
        .map((source) => ({
          source: source.source,
          classification: source.classification,
          rank: source.depthOrder,
          capturedAt: asIso(source.capturedAt),
        }));
      const participation = recentParticipation(
        input.season === undefined ? input.snaps : input.snaps.filter((snap) => snap.season === input.season),
        input.teamId, row.playerId, cutoffTime,
      );
      const injury = latestInjury(input.injuries, input.teamId, row.playerId, cutoffTime);
      const sleeperAvailability = rows
        .filter((source) => source.playerId === row.playerId && source.source === "sleeper")
        .sort((a, b) => (timestamp(b.capturedAt) ?? -1) - (timestamp(a.capturedAt) ?? -1))[0];
      const sleeperUnavailableValue = sleeperAvailability?.sleeperInjuryStatus
        ?? sleeperAvailability?.sleeperStatus
        ?? null;
      const espnUnavailable = injuryUnavailable(injury?.gameStatus ?? injury?.practiceStatus);
      const sleeperUnavailable = injuryUnavailable(sleeperUnavailableValue);
      const verifiedAvailabilityInput = row.availability && row.availability.toLowerCase() !== "unknown"
        ? row.availability
        : row.injuryStatus;
      const verifiedAvailability = availabilityState(verifiedAvailabilityInput);
      const hasConclusiveVerifiedAvailability = Boolean(
        verifiedAvailabilityInput && verifiedAvailability !== "unknown",
      );
      const verifiedObservedAt = timestamp(row.observedAt ?? row.sourceUpdatedAt ?? row.capturedAt) ?? -1;
      const injuryObservedAt = timestamp(injury?.sourceUpdatedAt ?? injury?.snapshotTimestamp) ?? -1;
      const evidenceAt = timestamp(row.observedAt ?? row.sourceUpdatedAt ?? row.capturedAt);
      const ageDays = evidenceAt === null ? Infinity : Math.max(0, cutoffTime - evidenceAt) / 86_400_000;
      const freshness = evidenceAt === null ? "unavailable" as const
        : ageDays <= 8 ? "current" as const : "stale" as const;
      const verifiedAvailabilityWins = hasConclusiveVerifiedAvailability
        && freshness === "current"
        && (!injury || verifiedObservedAt >= injuryObservedAt);
      const unavailable = verifiedAvailabilityWins
        ? verifiedAvailability === "out"
        : injury ? espnUnavailable : freshness === "current" && sleeperUnavailable;
      const rowConflicts = conflicts.filter((conflict) => conflict.playerId === row.playerId || (conflict.playerId === null && conflict.position === position));
      if (row.depthOrder === 1 && topParticipation?.row.playerId !== row.playerId
        && (topParticipation?.evidence.share ?? 0) - (participation.share ?? 0) >= 0.25) {
        const conflict: PersonnelConflict = {
          type: "participation", playerId: row.playerId, position, severity: "warning",
          explanation: `Published rank 1 disagrees with recent participation leader ${topParticipation?.row.playerName ?? topParticipation?.row.playerId}.`,
        };
        conflicts.push(conflict);
        rowConflicts.push(conflict);
      }
      if (injury && sleeperAvailability && (
        (espnUnavailable && explicitlyAvailable(sleeperAvailability.sleeperStatus))
        || (!espnUnavailable && sleeperUnavailable)
      )) {
        const conflict: PersonnelConflict = {
          type: "injury", playerId: row.playerId, position, severity: "warning",
          explanation: "ESPN injury evidence and Sleeper supplemental availability disagree; ESPN retains precedence.",
        };
        conflicts.push(conflict);
        rowConflicts.push(conflict);
      }
      if (publishedRoleIsStarter(row) && unavailable) {
        const conflict: PersonnelConflict = {
          type: "injury", playerId: row.playerId, position, severity: "warning",
          explanation: `${verifiedAvailabilityWins ? "Verified depth" : injury ? "ESPN" : "Sleeper supplemental"} availability marks a published starter out; published depth is preserved while expected lineup is evaluated separately.`,
        };
        conflicts.push(conflict);
        rowConflicts.push(conflict);
      }
      const inferred = row.mappingStatus === "participation_inference" || row.mappingStatus === "historical_inference";
      const confidence = clamp(
        (row.classification === "official" ? 90 : inferred ? 48 : 72)
        + (row.mappingConfidence == null ? 0 : row.mappingConfidence * 12)
        + (participation.share == null ? 0 : Math.min(10, participation.share * 10))
        - (ageDays > 8 ? 15 : 0)
        - rowConflicts.reduce((sum, conflict) => sum + (conflict.severity === "blocking" ? 22 : 10), 0),
      );
      const availability = verifiedAvailabilityWins
        ? verifiedAvailability
        : availabilityState(injury?.gameStatus ?? injury?.practiceStatus
          ?? (freshness === "current" ? sleeperUnavailableValue : null));
      const availabilitySource = verifiedAvailabilityWins ? "verified_depth"
        : injury ? "espn"
          : sleeperAvailability && freshness === "current" ? "sleeper_supplemental" : null;
      const availabilityAsOf = verifiedAvailabilityWins
        ? row.observedAt ?? row.sourceUpdatedAt ?? row.capturedAt
        : injury
          ? injury.sourceUpdatedAt ?? injury.snapshotTimestamp
          : freshness === "current" ? sleeperAvailability?.capturedAt ?? null : null;
      interpreted.push({
        playerId: row.playerId,
        playerName: clean(row.playerName),
        teamId: input.teamId,
        position: position === "UNKNOWN" ? null : position,
        unit: personnelUnit(position),
        role: clean(row.role),
        rank: row.depthOrder,
        starter: publishedRoleIsStarter(row)
          && (!officialFirst.length || row.classification === "official")
          && !unavailable,
        source: inferred ? row.mappingStatus! : row.source,
        sourceClassification: inferred ? "inferred" : row.classification,
        providerLabel: row.source === "sleeper" && !inferred ? "Sleeper published secondary depth signal" : inferred ? "Gridline inference" : "Verified published depth",
        providerEvidence,
        recentSnapShare: participation.share,
        recentGames: participation.games,
        injuryState: {
          injury: verifiedAvailabilityWins ? clean(row.injuryStatus) : clean(injury?.injury),
          practiceStatus: verifiedAvailabilityWins ? null : clean(injury?.practiceStatus),
          gameStatus: verifiedAvailabilityWins
            ? clean(verifiedAvailabilityInput)
            : clean(injury?.gameStatus ?? sleeperUnavailableValue),
          asOf: asIso(availabilityAsOf),
          source: availabilitySource,
          sleeperStatus: clean(sleeperAvailability?.sleeperStatus),
          sleeperInjuryStatus: clean(sleeperAvailability?.sleeperInjuryStatus),
          sleeperPracticeParticipation: clean(sleeperAvailability?.sleeperPracticeParticipation),
        },
        confidence,
        freshness,
        explanation: [
          inferred
            ? `${row.mappingStatus === "participation_inference" ? "Recent participation" : "Historical depth"} filled a missing published position.`
            : `${row.source === "sleeper" ? "Sleeper" : "Verified published depth"} lists rank ${row.depthOrder ?? "unknown"} at ${position}.`,
          participation.share === null ? "Recent snap evidence is unavailable." : `Recent snap share averages ${Math.round(participation.share * 100)}% across ${participation.games} game(s).`,
          injury
            ? `ESPN injury evidence is ${injury.gameStatus ?? injury.practiceStatus ?? "reported"}.`
            : sleeperAvailability && (sleeperAvailability.sleeperStatus || sleeperAvailability.sleeperInjuryStatus || sleeperAvailability.sleeperPracticeParticipation)
              ? `Sleeper supplemental availability is ${sleeperUnavailableValue ?? sleeperAvailability.sleeperPracticeParticipation}.`
              : "No current ESPN or Sleeper availability evidence was available at the cutoff.",
        ],
        conflicts: rowConflicts,
        publishedStarter: publishedRoleIsStarter(row) && !inferred
          && (row.classification === "official" || row.classification === "published_secondary"),
        availability,
        unavailableReason: unavailable
          ? `${verifiedAvailabilityWins ? "Verified depth" : injury ? "ESPN" : "Sleeper supplemental"} availability evidence marks this player unavailable.`
          : null,
        provenance: {
          source: row.source,
          sourceUrl: row.sourceUrl ?? null,
          observedAt: asIso(row.observedAt ?? row.capturedAt),
          verifiedAt: asIso(row.verifiedAt ?? row.capturedAt),
          verificationMethod: row.verificationMethod ?? null,
          evidenceId: row.evidenceId ?? null,
        },
      });
    }
  }
  interpreted.sort((a, b) => (a.position ?? "").localeCompare(b.position ?? "") || (a.rank ?? 999) - (b.rank ?? 999));
  const qbRows = (input.qbs ?? [])
    .filter((row) => row.teamId === input.teamId)
    .filter((row) => input.season === undefined || row.season === input.season)
    .filter((row) => (timestamp(row.kickoffTime) ?? Infinity) < cutoffTime)
    .filter((row) => (timestamp(row.sourceUpdatedAt) ?? Infinity) <= cutoffTime)
    .sort((a, b) => (timestamp(b.kickoffTime) ?? -1) - (timestamp(a.kickoffTime) ?? -1));
  const latestQbGameId = qbRows[0]?.gameId ?? null;
  const recentQbLeader = latestQbGameId
    ? qbRows.filter((row) => row.gameId === latestQbGameId)
      .sort((a, b) => b.dropbacks - a.dropbacks || a.playerId.localeCompare(b.playerId))[0] ?? null
    : null;
  const qbCandidates = interpreted.filter((row) =>
    row.position === "QB" && row.rank === 1 && row.freshness === "current");
  const qbPlayer = qbCandidates
    .sort((a, b) =>
      (b.sourceClassification === "official" ? 1 : 0) - (a.sourceClassification === "official" ? 1 : 0)
      || b.confidence - a.confidence)[0] ?? null;
  const qbConflict = qbCandidates.length > 1
    || Boolean(qbPlayer?.conflicts.some((conflict) => conflict.severity === "blocking"))
    || Boolean(recentQbLeader && qbPlayer && recentQbLeader.playerId !== qbPlayer.playerId);
  if (recentQbLeader && qbPlayer && recentQbLeader.playerId !== qbPlayer.playerId) {
    const conflict: PersonnelConflict = {
      type: "participation", playerId: qbPlayer.playerId, position: "QB", severity: "warning",
      explanation: `Published QB1 disagrees with the most recent dropback leader (${recentQbLeader.playerName ?? recentQbLeader.playerId}).`,
    };
    conflicts.push(conflict);
    qbPlayer.conflicts.push(conflict);
    qbPlayer.confidence = clamp(qbPlayer.confidence - 12);
  }
  const qbStarter: QbStarterInterpretation = {
    status: !qbPlayer ? "unavailable" : qbConflict ? "conflict" : "available",
    player: qbPlayer,
    confidence: qbPlayer ? clamp(qbPlayer.confidence + (recentQbLeader?.playerId === qbPlayer.playerId ? 8 : 0)) : 0,
    supportingEvidence: [
      ...(qbPlayer?.explanation ?? []),
      ...(recentQbLeader ? [`Most recent pre-cutoff QB participation: ${recentQbLeader.playerName ?? recentQbLeader.playerId}, ${recentQbLeader.dropbacks} dropbacks.`] : ["Recent QB dropback evidence is unavailable."]),
    ],
    conflicts: conflicts.filter((conflict) => conflict.position === "QB"),
    unavailableReason: !qbPlayer
      ? "No mapped published or participation-supported QB1 is available."
      : qbConflict ? "QB evidence contains a blocking conflict." : null,
  };
  const positionalCoverage = Object.fromEntries(REQUIRED.map((position) => [
    position,
    interpreted.some((row) => row.position === position && row.freshness === "current") ? 100 : 0,
  ]));
  const teamFreshness: InterpretedTeamDepth["freshness"] = interpreted.length === 0 ? "unavailable"
    : interpreted.some((player) => player.freshness === "stale") ? "stale"
      : interpreted.some((player) => player.freshness === "unavailable") ? "unavailable"
        : "current";
  const playerNames = new Map<string, string | null>([
    ...Object.entries(input.playerNames ?? {}),
    ...sourceRows.map((row) => [row.playerId, clean(row.playerName)] as const),
  ]);
  const latestTeamInjuries = new Map<string, PersonnelInjuryRow>();
  for (const row of input.injuries
    .filter((injury) => injury.teamId === input.teamId)
    .filter((injury) => (timestamp(injury.snapshotTimestamp) ?? Infinity) <= cutoffTime)
    .filter((injury) => (timestamp(injury.sourceUpdatedAt ?? injury.snapshotTimestamp) ?? Infinity) <= cutoffTime)
    .filter((injury) => (timestamp(injury.snapshotTimestamp) ?? -Infinity) >= cutoffTime - CURRENT_INJURY_EVIDENCE_MS)) {
    const prior = latestTeamInjuries.get(row.playerId);
    if (!prior || (timestamp(row.snapshotTimestamp) ?? -1) > (timestamp(prior.snapshotTimestamp) ?? -1)) {
      latestTeamInjuries.set(row.playerId, row);
    }
  }
  const expectedPlayers: Array<InterpretedDepthPlayer & {
    projected: boolean;
    replacementForPlayerId: string | null;
    projectionReason: string;
  }> = [];
  const expectedReasons: string[] = [];
  const publishedStarters = interpreted.filter((item) => item.publishedStarter);
  for (const player of publishedStarters) {
    if (player.freshness !== "current") {
      expectedReasons.push(`${normalizedRole(player.role) ?? player.position ?? "Position"} published depth evidence is ${player.freshness}; Gridline will not present the player as expected.`);
      continue;
    }
    if (player.availability === "unknown") {
      expectedReasons.push(`${player.position ?? "Position"} availability is unknown; Gridline will not present the player as expected.`);
      continue;
    }
    if (player.availability !== "out") {
      expectedPlayers.push({
        ...player,
        projected: false,
        replacementForPlayerId: null,
        projectionReason: "Published starter remains expected to play based on current availability evidence.",
      });
      continue;
    }
    const playerRole = normalizedRole(player.role);
    const replacement = interpreted
      .filter((candidate) => {
        const candidateRole = normalizedRole(candidate.role);
        const sameVacatedSlot = candidateRole === playerRole
          || (playerRole === "QB1" && candidateRole === "QB2")
          || (playerRole === "RB1" && candidateRole === "RB2");
        return candidate.position === player.position
        && candidate.playerId !== player.playerId
        && !candidate.publishedStarter
        && sameVacatedSlot
        && (candidate.rank ?? 99) > (player.rank ?? 0)
        && candidate.freshness === "current"
        && candidate.availability !== "unknown"
        && candidate.availability !== "out"
        && (candidate.sourceClassification !== "inferred" || candidate.recentGames > 0);
      })
      .sort((left, right) => (left.rank ?? 99) - (right.rank ?? 99)
        || right.confidence - left.confidence)[0];
    if (!replacement) {
      expectedReasons.push(`${player.position ?? "Position"} replacement is unavailable; no evidence-backed replacement was found.`);
      continue;
    }
    expectedPlayers.push({
      ...replacement,
      projected: true,
      replacementForPlayerId: player.playerId,
      projectionReason: `Projected replacement for published starter ${player.playerName ?? player.playerId}; published depth is unchanged.`,
    });
  }
  if (!publishedStarters.length) {
    const inferredCandidates = interpreted.filter((player) =>
      player.sourceClassification === "inferred"
      && player.rank === 1
      && player.freshness === "current"
      && player.availability !== "out"
      && player.recentGames > 0);
    expectedPlayers.push(...inferredCandidates.map((player) => ({
      ...player,
      projected: true,
      replacementForPlayerId: null,
      projectionReason: "Projected from cutoff-safe participation evidence; no published depth is available and this is not official.",
    })));
    expectedReasons.push("Published starter depth is unavailable; any listed players are Gridline projections, not official depth.");
  }
  const publishedStarterRoles = new Set(publishedStarters
    .filter((player) => player.freshness === "current")
    .map((player) => normalizedRole(player.role)));
  const missingStarterRoles = REQUIRED_STARTER_ROLE_CARDS.filter((role) => !publishedStarterRoles.has(role));
  if (missingStarterRoles.length) {
    expectedReasons.push(`Expected lineup is missing published evidence for: ${missingStarterRoles.join(", ")}.`);
  }
  const expectedStatus: NonNullable<InterpretedTeamDepth["expectedLineup"]>["status"] =
    !expectedPlayers.length && !interpreted.length ? "unavailable" :
      !expectedPlayers.length ? "ambiguous" :
        !publishedStarters.length ? "partial" :
      expectedReasons.length && expectedPlayers.length ? "partial" :
        expectedReasons.length ? "ambiguous" : "available";
  return {
    teamId: input.teamId,
    teamName: input.teamName ?? null,
    abbreviation: input.abbreviation ?? null,
    asOf: cutoff.toISOString(),
    freshness: teamFreshness,
    sourcePrecedence: [
      "verified permitted published depth",
      "Sleeper published secondary depth signal with mapped identity",
      "recent nflverse participation inference",
      "historical nflverse depth inference",
      "ESPN injury status overrides availability but never silently replaces depth order",
    ],
    depth: {
      offense: interpreted.filter((row) => unitGroup(row.position) === "offense"),
      defense: interpreted.filter((row) => unitGroup(row.position) === "defense"),
      specialTeams: interpreted.filter((row) => unitGroup(row.position) === "specialTeams"),
      unknown: interpreted.filter((row) => unitGroup(row.position) === "unknown"),
    },
    qbStarter,
    wrRoles: interpreted.filter((row) => row.position === "WR"),
    cbRoles: interpreted.filter((row) => row.position === "CB"),
    conflicts,
    positionalCoverage,
    downstreamReady: qbStarter.status === "available"
      && REQUIRED.every((position) => positionalCoverage[position] > 0)
      && !conflicts.some((conflict) => conflict.severity === "blocking")
      && teamFreshness === "current",
    unavailableReasons: [
      ...(!interpreted.length ? ["No current mapped published depth snapshot is available."] : []),
      ...(interpreted.some((player) => player.freshness === "stale")
        ? ["At least one published depth row is stale."] : []),
      ...(interpreted.some((player) => player.freshness === "unavailable")
        ? ["At least one published depth row has no usable evidence timestamp."] : []),
      ...(qbStarter.status !== "available" ? [qbStarter.unavailableReason ?? "QB starter evidence remains conflicted."] : []),
      ...REQUIRED.filter((position) => positionalCoverage[position] === 0).map((position) => `${position} depth is unavailable.`),
    ],
    injuryReport: [...latestTeamInjuries.values()]
      .filter((injury) =>
        Boolean(clean(injury.injury))
        || Boolean(clean(injury.practiceStatus))
        || !/^(active|available|healthy)$/i.test(clean(injury.gameStatus) ?? ""))
      .map((injury) => ({
        playerName: playerNames.get(injury.playerId) ?? null,
        position: normalizePosition(injury.position),
        injury: clean(injury.injury),
        practiceStatus: clean(injury.practiceStatus),
        gameStatus: clean(injury.gameStatus),
        asOf: asIso(injury.snapshotTimestamp),
        source: "espn" as const,
      })),
    expectedLineup: {
      status: expectedStatus,
      players: expectedPlayers,
      unavailableReasons: expectedReasons,
    },
  };
}