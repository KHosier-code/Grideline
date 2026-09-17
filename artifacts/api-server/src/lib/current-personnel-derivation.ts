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
    source: "espn" | "sleeper_supplemental" | null;
    sleeperStatus: string | null;
    sleeperInjuryStatus: string | null;
    sleeperPracticeParticipation: string | null;
  };
  confidence: number;
  explanation: string[];
  conflicts: PersonnelConflict[];
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
};

const OFFENSE = new Set(["QB", "RB", "FB", "WR", "TE", "OL", "OT", "T", "LT", "RT", "G", "LG", "RG", "C"]);
const DEFENSE = new Set(["DL", "DE", "DT", "NT", "EDGE", "LB", "ILB", "OLB", "MLB", "CB", "S", "FS", "SS", "DB"]);
const SPECIAL_TEAMS = new Set(["K", "P", "LS", "KR", "PR"]);
const REQUIRED = ["QB", "RB", "WR", "TE", "OT", "OG", "C", "EDGE", "DT", "LB", "CB", "S"];
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

function interpretedPosition(row: Pick<CurrentDepthSource, "position" | "role">) {
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
  const position = interpretedPosition(row);
  const role = normalizedRole(row.role);
  if (position === "WR" && role && ["LWR", "RWR", "SWR", "WR"].includes(role)) return role;
  if (position === "CB" && role && ["LCB", "RCB", "SCB", "NCB", "CB"].includes(role)) return role;
  if (position === "S" && role && ["FS", "SS", "S"].includes(role)) return role;
  if (position === "EDGE" && role && ["LDE", "RDE", "EDGE", "DE"].includes(role)) return role;
  return position ?? normalizedSlot(row.role) ?? "UNKNOWN";
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
}): InterpretedTeamDepth {
  const cutoff = input.cutoff ?? new Date();
  const cutoffTime = cutoff.getTime();
  const conflicts: PersonnelConflict[] = [];
  const sourceRows = input.publishedDepth
    .filter((row) => row.teamId === input.teamId)
    .filter((row) => (timestamp(row.capturedAt) ?? Infinity) <= cutoffTime)
    .filter((row) => (timestamp(row.sourceUpdatedAt ?? row.capturedAt) ?? Infinity) <= cutoffTime);
  const latestSourceAt = Math.max(-1, ...sourceRows.map((row) => timestamp(row.capturedAt) ?? -1));
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
  for (const row of input.snaps.filter((item) => item.teamId === input.teamId)) {
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
      .map((row) => ({ row, evidence: recentParticipation(input.snaps, input.teamId, row.playerId, cutoffTime) }))
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
      const participation = recentParticipation(input.snaps, input.teamId, row.playerId, cutoffTime);
      const injury = latestInjury(input.injuries, input.teamId, row.playerId, cutoffTime);
      const sleeperAvailability = rows
        .filter((source) => source.playerId === row.playerId && source.source === "sleeper")
        .sort((a, b) => (timestamp(b.capturedAt) ?? -1) - (timestamp(a.capturedAt) ?? -1))[0];
      const sleeperUnavailableValue = sleeperAvailability?.sleeperInjuryStatus
        ?? sleeperAvailability?.sleeperStatus
        ?? null;
      const espnUnavailable = injuryUnavailable(injury?.gameStatus ?? injury?.practiceStatus);
      const sleeperUnavailable = injuryUnavailable(sleeperUnavailableValue);
      const unavailable = injury ? espnUnavailable : sleeperUnavailable;
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
      if (row.depthOrder === 1 && unavailable) {
        const conflict: PersonnelConflict = {
          type: "injury", playerId: row.playerId, position, severity: "blocking",
          explanation: injury
            ? `ESPN injury status (${injury.gameStatus ?? injury.practiceStatus}) contradicts starter availability.`
            : `Sleeper supplemental availability (${sleeperUnavailableValue}) contradicts starter availability; no current ESPN row is available.`,
        };
        conflicts.push(conflict);
        rowConflicts.push(conflict);
      }
      const inferred = row.mappingStatus === "participation_inference" || row.mappingStatus === "historical_inference";
      const ageDays = latestSourceAt < 0 ? Infinity : Math.max(0, cutoffTime - (timestamp(row.capturedAt) ?? 0)) / 86_400_000;
      const confidence = clamp(
        (row.classification === "official" ? 90 : inferred ? 48 : 72)
        + (row.mappingConfidence == null ? 0 : row.mappingConfidence * 12)
        + (participation.share == null ? 0 : Math.min(10, participation.share * 10))
        - (ageDays > 8 ? 15 : 0)
        - rowConflicts.reduce((sum, conflict) => sum + (conflict.severity === "blocking" ? 22 : 10), 0),
      );
      interpreted.push({
        playerId: row.playerId,
        playerName: clean(row.playerName),
        teamId: input.teamId,
        position: position === "UNKNOWN" ? null : position,
        unit: personnelUnit(position),
        role: clean(row.role),
        rank: row.depthOrder,
        starter: row.depthOrder === 1
          && (!officialFirst.length || row.classification === "official")
          && !unavailable,
        source: inferred ? row.mappingStatus! : row.source,
        sourceClassification: inferred ? "inferred" : row.classification,
        providerLabel: row.source === "sleeper" && !inferred ? "Sleeper published secondary depth signal" : inferred ? "Gridline inference" : "Verified published depth",
        providerEvidence,
        recentSnapShare: participation.share,
        recentGames: participation.games,
        injuryState: {
          injury: clean(injury?.injury),
          practiceStatus: clean(injury?.practiceStatus),
          gameStatus: clean(injury?.gameStatus),
          asOf: asIso(injury?.snapshotTimestamp),
          source: injury ? "espn" : sleeperAvailability ? "sleeper_supplemental" : null,
          sleeperStatus: clean(sleeperAvailability?.sleeperStatus),
          sleeperInjuryStatus: clean(sleeperAvailability?.sleeperInjuryStatus),
          sleeperPracticeParticipation: clean(sleeperAvailability?.sleeperPracticeParticipation),
        },
        confidence,
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
      });
    }
  }
  interpreted.sort((a, b) => (a.position ?? "").localeCompare(b.position ?? "") || (a.rank ?? 999) - (b.rank ?? 999));
  const qbRows = (input.qbs ?? [])
    .filter((row) => row.teamId === input.teamId)
    .filter((row) => (timestamp(row.kickoffTime) ?? Infinity) < cutoffTime)
    .filter((row) => (timestamp(row.sourceUpdatedAt) ?? Infinity) <= cutoffTime)
    .sort((a, b) => (timestamp(b.kickoffTime) ?? -1) - (timestamp(a.kickoffTime) ?? -1));
  const latestQbGameId = qbRows[0]?.gameId ?? null;
  const recentQbLeader = latestQbGameId
    ? qbRows.filter((row) => row.gameId === latestQbGameId)
      .sort((a, b) => b.dropbacks - a.dropbacks || a.playerId.localeCompare(b.playerId))[0] ?? null
    : null;
  const qbCandidates = interpreted.filter((row) => row.position === "QB" && row.rank === 1);
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
    interpreted.some((row) => row.position === position) ? 100 : 0,
  ]));
  const ageDays = latestSourceAt < 0 ? Infinity : Math.max(0, cutoffTime - latestSourceAt) / 86_400_000;
  return {
    teamId: input.teamId,
    teamName: input.teamName ?? null,
    abbreviation: input.abbreviation ?? null,
    asOf: cutoff.toISOString(),
    freshness: latestSourceAt < 0 ? "unavailable" : ageDays <= 8 ? "current" : "stale",
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
      && ageDays <= 8,
    unavailableReasons: [
      ...(latestSourceAt < 0 ? ["No current mapped published depth snapshot is available."] : []),
      ...(ageDays > 8 ? ["Latest published depth evidence is stale."] : []),
      ...(qbStarter.status !== "available" ? [qbStarter.unavailableReason ?? "QB starter evidence remains conflicted."] : []),
      ...REQUIRED.filter((position) => positionalCoverage[position] === 0).map((position) => `${position} depth is unavailable.`),
    ],
  };
}