/**
 * Pure Phase 7 derivations.  This file intentionally has no database imports:
 * the same cutoff and derivations can be exercised with node/esbuild tests
 * without a configured database.
 */

export type DateLike = Date | string | null | undefined;

export type PersonnelGame = {
  gameId: string;
  season: number;
  week: number;
  kickoffTime: DateLike;
  homeTeamId: string;
  awayTeamId: string;
};

export type PersonnelDepthRow = {
  teamId: string;
  /** The identifier as supplied by the source (for example nflverse's CIN). */
  sourceTeamId?: string | null;
  playerId: string;
  playerName?: string | null;
  position?: string | null;
  depthPosition?: number | null;
  starter?: boolean | null;
  role?: string | null;
  snapshotTimestamp?: DateLike;
  sourceUpdatedAt?: DateLike;
  source?: string;
  classification?: "official" | "published_secondary" | "inferred" | string | null;
};

export type PersonnelHistoricalDepthRow = PersonnelDepthRow & {
  season?: number;
  week?: number;
  sourceSnapshotAt?: DateLike;
};

export type PersonnelInjuryRow = {
  playerId: string;
  teamId: string;
  position?: string | null;
  injury?: string | null;
  practiceStatus?: string | null;
  gameStatus?: string | null;
  snapshotTimestamp?: DateLike;
  sourceUpdatedAt?: DateLike;
};

export type PersonnelSnapRow = {
  gameId: string;
  season: number;
  week: number;
  playerId: string;
  playerName: string;
  position?: string | null;
  teamId: string;
  sourceTeamId?: string | null;
  offenseSnaps?: number | null;
  offensePct?: number | null;
  defenseSnaps?: number | null;
  defensePct?: number | null;
  specialTeamsSnaps?: number | null;
  specialTeamsPct?: number | null;
  sourceUpdatedAt?: DateLike;
  kickoffTime?: DateLike;
};

export type PersonnelQbRow = {
  gameId: string;
  season: number;
  week: number;
  playerId: string;
  teamId: string;
  sourceTeamId?: string | null;
  dropbacks: number;
  passAttempts: number;
  passEpa: number;
  passSuccesses: number;
  interceptions: number;
  sacks: number;
  rushAttempts: number;
  rushEpa: number;
  kickoffTime?: DateLike;
  sourceUpdatedAt?: DateLike;
};

export type PersonnelPriorGame = {
  gameId: string;
  teamId: string;
  kickoffTime: DateLike;
  isHome: boolean;
  finalHomeScore?: number | null;
  finalAwayScore?: number | null;
};

export type PersonnelOddsRow = {
  sportsbook: string;
  capturedAt: DateLike;
  sourceTimestamp?: DateLike;
  market: string;
  selection: string;
  point?: number | null;
  price: number;
};

export type PersonnelWeatherRow = {
  gameId: string;
  source: string;
  fetchedAt: DateLike;
  forecastGeneratedAt?: DateLike;
  validTime: DateLike;
  temperature?: number | null;
  sustainedWind?: number | null;
  windGust?: number | null;
  precipitationProbability?: number | null;
  precipitationType?: string | null;
  humidity?: number | null;
  weatherSummary?: string | null;
  indoorOutdoor: string;
  roofStatus?: string | null;
  sourceUrl?: string | null;
  office?: string | null;
  gridpoint?: string | null;
};

export type ProbableStarter = {
  playerId: string;
  teamId: string;
  playerName: string | null;
  position: string | null;
  unit: string;
  estimatedDepthPosition: number | null;
  source: string;
  classification: "official" | "published_secondary" | "inferred";
  official: boolean;
  inferred: boolean;
  confidence: number;
  snapshotTimestamp: string | null;
  dataFreshness: "fresh" | "stale" | "unavailable";
  recentSnapShare: number | null;
  recentStarterEvidence: string[];
  injuryStatus: {
    injury: string | null;
    practiceStatus: string | null;
    gameStatus: string | null;
    snapshotTimestamp: string | null;
  };
  priorWeekParticipation: {
    gameId: string | null;
    participated: boolean;
    snapShare: number | null;
  };
  evidence: string[];
  unavailableReason: string | null;
};

export type InjuryImpact = {
  playerId: string;
  teamId: string;
  playerName: string | null;
  position: string | null;
  unit: string;
  designation: string | null;
  practiceStatus: string | null;
  gameStatus: string | null;
  snapshotTimestamp: string | null;
  recentSnapShare: number | null;
  starterLikelihood: number | null;
  impactScore: number | null;
  replacementQuality: null;
  unavailableReasons: string[];
  derivation: string;
};

const OFFENSE = new Set(["QB", "RB", "FB", "WR", "TE", "OL", "OT", "T", "LT", "RT", "G", "LG", "RG", "C"]);
const DEFENSE = new Set(["DL", "DE", "DT", "NT", "EDGE", "LB", "ILB", "OLB", "MLB", "CB", "S", "FS", "SS", "DB"]);
const OL = new Set(["OL", "OT", "T", "LT", "RT", "G", "LG", "RG", "C"]);
export const REQUIRED_STARTER_POSITIONS = [
  "QB", "RB", "WR", "TE", "LT", "LG", "C", "RG", "RT",
  "EDGE", "DT", "LB", "CB", "S",
] as const;

function time(value: DateLike) {
  if (value instanceof Date) return value.getTime();
  if (typeof value === "string") {
    const parsed = Date.parse(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function iso(value: DateLike) {
  const parsed = time(value);
  return parsed === null ? null : new Date(parsed).toISOString();
}

function clamp(value: number, low = 0, high = 100) {
  return Math.max(low, Math.min(high, Math.round(value)));
}

function text(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

export function asOfCutoff(kickoffTime: DateLike, now = new Date()) {
  const current = time(now) ?? Date.now();
  const kickoff = time(kickoffTime);
  return new Date(Math.min(current, kickoff === null ? current : kickoff - 1));
}

export function normalizePosition(position: string | null | undefined) {
  const normalized = text(position)?.toUpperCase() ?? null;
  if (normalized && ["DE", "EDGE", "E"].includes(normalized)) return "EDGE";
  if (normalized && ["DL", "NT", "NOSE"].includes(normalized)) return "DT";
  if (normalized && ["ILB", "OLB", "MLB"].includes(normalized)) return "LB";
  if (normalized && ["FS", "SS", "DB"].includes(normalized)) return "S";
  return normalized;
}

/**
 * Convert an nflverse abbreviation to the schedule's canonical team ID.
 * Source IDs are deliberately retained on rows by the database adapter.
 */
export function normalizeTeamId(
  sourceId: string,
  abbreviationToTeamId: ReadonlyMap<string, string>,
) {
  const normalized = sourceId.trim().toUpperCase();
  const alias = NFLVERSE_TEAM_ALIASES[normalized] ?? normalized;
  return abbreviationToTeamId.get(alias) ?? abbreviationToTeamId.get(normalized) ?? sourceId;
}

/** nflverse franchise aliases retained across historical seasons. */
export const NFLVERSE_TEAM_ALIASES: Record<string, string> = {
  LA: "LAR", LAR: "LAR",
  OAK: "LV", LV: "LV",
  SD: "LAC", LAC: "LAC",
  STL: "LAR",
  JAX: "JAX", JAC: "JAX",
  WSH: "WAS", WAS: "WAS",
  ARI: "ARI", ATL: "ATL", BAL: "BAL", BUF: "BUF", CAR: "CAR",
  CHI: "CHI", CIN: "CIN", CLE: "CLE", DAL: "DAL", DEN: "DEN",
  DET: "DET", GB: "GB", HOU: "HOU", IND: "IND", KC: "KC",
  MIA: "MIA", MIN: "MIN", NE: "NE", NO: "NO", NYG: "NYG",
  NYJ: "NYJ", PHI: "PHI", PIT: "PIT", SEA: "SEA", SF: "SF",
  TB: "TB", TEN: "TEN",
};

export function nflverseTeamCandidates(abbreviation: string | null | undefined) {
  const stable = abbreviation?.trim().toUpperCase() ?? "";
  const aliases = Object.entries(NFLVERSE_TEAM_ALIASES)
    .filter(([, canonical]) => canonical === stable)
    .map(([alias]) => alias);
  return [...new Set([stable, ...aliases].filter(Boolean))];
}

export function personnelUnit(position: string | null | undefined): string {
  const normalized = normalizePosition(position);
  if (normalized === "QB") return "quarterback";
  if (OL.has(normalized ?? "")) return "offensive_line";
  if (["RB", "FB"].includes(normalized ?? "")) return "running_back";
  if (["WR", "TE"].includes(normalized ?? "")) return "skill";
  if (["K", "P", "LS"].includes(normalized ?? "")) return "special_teams";
  if (DEFENSE.has(normalized ?? "")) {
    if (["CB", "S", "FS", "SS", "DB"].includes(normalized ?? "")) return "secondary";
    if (["DL", "DE", "DT", "NT", "EDGE"].includes(normalized ?? "")) return "defensive_front";
    return "linebacker";
  }
  return "unknown";
}

function freshness(snapshot: DateLike, cutoff: Date) {
  const at = time(snapshot);
  if (at === null) return { label: "unavailable" as const, confidence: 0, timestamp: null };
  const age = Math.max(0, cutoff.getTime() - at) / 86_400_000;
  return {
    label: age <= 8 ? "fresh" as const : "stale" as const,
    confidence: age <= 8 ? 10 : 4,
    timestamp: new Date(at).toISOString(),
  };
}

function latestBy<T>(rows: T[], key: (row: T) => string, timestamp: (row: T) => DateLike) {
  const result = new Map<string, T>();
  for (const row of rows) {
    const prior = result.get(key(row));
    if (!prior || (time(timestamp(row)) ?? -1) > (time(timestamp(prior)) ?? -1)) result.set(key(row), row);
  }
  return result;
}

function recentSnaps(
  teamId: string,
  playerId: string,
  snaps: PersonnelSnapRow[],
  cutoff: Date,
) {
  return snaps
    .filter((row) =>
      row.teamId === teamId &&
      row.playerId === playerId &&
      time(row.sourceUpdatedAt) !== null &&
      time(row.sourceUpdatedAt)! <= cutoff.getTime() &&
      (time(row.kickoffTime) ?? -1) < cutoff.getTime())
    .sort((a, b) => (time(b.kickoffTime) ?? -1) - (time(a.kickoffTime) ?? -1))
    .slice(0, 5);
}

function snapShare(rows: PersonnelSnapRow[]) {
  const values = rows
    .map((row) => row.offensePct ?? row.defensePct ?? row.specialTeamsPct)
    .filter((value): value is number => typeof value === "number" && Number.isFinite(value));
  return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null;
}

function unavailableStatus(value: string | null) {
  return /out|inactive|ir|reserve|suspend/i.test(value ?? "");
}

function injuryByPlayer(rows: PersonnelInjuryRow[], cutoff: Date) {
  return latestBy(
    rows.filter((row) =>
      (time(row.snapshotTimestamp) ?? -1) <= cutoff.getTime() &&
      (time(row.sourceUpdatedAt) ?? time(row.snapshotTimestamp) ?? -1) <= cutoff.getTime()),
    (row) => `${row.teamId}:${row.playerId}`,
    (row) => row.snapshotTimestamp,
  );
}

function depthForTeam(
  teamId: string,
  depth: PersonnelDepthRow[],
  historicalDepth: PersonnelHistoricalDepthRow[],
  cutoff: Date,
  snaps: PersonnelSnapRow[],
  injuries: Map<string, PersonnelInjuryRow>,
): ProbableStarter[] {
  const current = depth.filter((row) =>
    row.teamId === teamId &&
    (row.source === "official_depth_chart" || row.source === "espn_depth_chart") &&
    (time(row.snapshotTimestamp) ?? -1) <= cutoff.getTime() &&
    (time(row.sourceUpdatedAt) ?? time(row.snapshotTimestamp) ?? -1) <= cutoff.getTime(),
  );
  const latest = latestBy(
    current.filter((row) => (row.depthPosition ?? 99) === 1 || row.starter === true),
    (row) => normalizePosition(row.position) ?? "UNK",
    (row) => row.snapshotTimestamp,
  );
  const rows = [...latest.values()];
  const positionRows = new Set(rows.map((row) => normalizePosition(row.position)).filter(Boolean));
  // A current snapshot can be incomplete.  Participation is a legal,
  // auditable fallback, never an official depth chart.
  const recent = snaps
    .filter((row) =>
      row.teamId === teamId &&
      time(row.sourceUpdatedAt) !== null &&
      time(row.sourceUpdatedAt)! <= cutoff.getTime() &&
      (time(row.kickoffTime) ?? -1) < cutoff.getTime())
    .sort((a, b) => (time(b.kickoffTime) ?? -1) - (time(a.kickoffTime) ?? -1));
  const byPosition = new Map<string, PersonnelSnapRow[]>();
  for (const row of recent) {
    const position = normalizePosition(row.position);
    if (position) byPosition.set(position, [...(byPosition.get(position) ?? []), row]);
  }
  for (const [position, positionSnaps] of byPosition) {
    if (positionRows.has(position)) continue;
    const byPlayer = new Map<string, PersonnelSnapRow[]>();
    for (const row of positionSnaps) byPlayer.set(row.playerId, [...(byPlayer.get(row.playerId) ?? []), row]);
    const candidate = [...byPlayer.entries()]
      .map(([playerId, playerRows]) => ({ playerId, playerRows, share: snapShare(playerRows) ?? -1 }))
      .sort((a, b) => b.share - a.share)[0];
    if (candidate) {
      const row = candidate.playerRows[0];
      rows.push({
        teamId,
        playerId: candidate.playerId,
        playerName: row.playerName,
        position,
        depthPosition: 1,
        starter: false,
        snapshotTimestamp: row.sourceUpdatedAt,
        sourceUpdatedAt: row.sourceUpdatedAt,
        source: "snap_counts_inference",
      });
    }
  }
  // Historical depth is the last fallback, after current participation
  // inference has had a chance to support a missing position.
  const inferredPositions = new Set(rows.map((row) => normalizePosition(row.position)).filter(Boolean));
  const historical = historicalDepth.filter((row) =>
    row.teamId === teamId &&
    (time(row.sourceSnapshotAt ?? row.sourceUpdatedAt) ?? -1) <= cutoff.getTime(),
  );
  const latestHistorical = latestBy(
    historical.filter((row) => (row.depthPosition ?? 99) === 1),
    (row) => normalizePosition(row.position) ?? "UNK",
    (row) => row.sourceSnapshotAt ?? row.sourceUpdatedAt,
  );
  for (const row of latestHistorical.values()) {
    const position = normalizePosition(row.position);
    if (position && !inferredPositions.has(position) && (row.depthPosition ?? 99) <= 2) rows.push({ ...row, source: "historical_depth_charts" });
  }
  return rows
    .filter((row) => (row.depthPosition ?? 99) === 1 || row.starter === true || row.source === "snap_counts_inference")
    .map((row) => {
      const position = normalizePosition(row.position);
      const share = snapShare(recentSnaps(teamId, row.playerId, snaps, cutoff));
      const fresh = freshness(row.snapshotTimestamp ?? row.sourceUpdatedAt, cutoff);
      const official = row.classification === "official" && row.source === "official_depth_chart";
      const injury = injuries.get(`${teamId}:${row.playerId}`);
      const unavailableReason = unavailableStatus(injury?.gameStatus ?? null)
        ? `Latest injury status is ${injury?.gameStatus}.`
        : null;
      return {
        playerId: row.playerId,
        teamId,
        playerName: text(row.playerName),
        position,
        unit: personnelUnit(position),
        estimatedDepthPosition: row.depthPosition ?? null,
        source: row.source ?? (official ? "depth_chart_snapshots" : "depth_chart_snapshot"),
        classification: row.classification === "official" && row.source === "official_depth_chart"
          ? "official"
          : row.source === "snap_counts_inference" || row.source === "historical_depth_charts"
            ? "inferred"
            : "published_secondary",
        official: row.classification === "official" && row.source === "official_depth_chart",
        inferred: row.source === "snap_counts_inference" || row.source === "historical_depth_charts",
        confidence: clamp(35 + (official ? 35 : 15) + (share === null ? 0 : Math.min(20, share * 20)) + fresh.confidence - (unavailableReason ? 18 : 0)),
        snapshotTimestamp: fresh.timestamp,
        dataFreshness: fresh.label,
        recentSnapShare: share,
        recentStarterEvidence: row.classification !== "inferred" && row.source !== "snap_counts_inference" && row.source !== "historical_depth_charts"
          ? [`${row.source ?? "published depth chart"} lists this player first at ${position ?? "an unspecified position"}.`]
          : share === null
            ? []
            : [`Recent participation averaged ${Math.round(share * 100)}% of available snaps.`],
        injuryStatus: {
          injury: text(injury?.injury),
          practiceStatus: text(injury?.practiceStatus),
          gameStatus: text(injury?.gameStatus),
          snapshotTimestamp: iso(injury?.snapshotTimestamp),
        },
        priorWeekParticipation: (() => {
          const previous = recentSnaps(teamId, row.playerId, snaps, cutoff)[0];
          return {
            gameId: previous?.gameId ?? null,
            participated: Boolean(previous),
            snapShare: previous ? snapShare([previous]) : null,
          };
        })(),
        evidence: [
          `Source: ${row.source ?? "depth_chart_snapshots"}.`,
          fresh.timestamp ? `Snapshot timestamp: ${fresh.timestamp}.` : "Snapshot timestamp unavailable.",
          ...(share === null ? [] : [`Recent snap share: ${Math.round(share * 100)}%.`]),
          ...(injury ? [`Injury feed status: ${injury.gameStatus ?? injury.practiceStatus ?? "reported"}.`] : ["No injury row reported as of cutoff."]),
        ],
        unavailableReason,
      };
    });
}

function deriveInjuries(
  teamId: string,
  injuries: Map<string, PersonnelInjuryRow>,
  starters: ProbableStarter[],
  snaps: PersonnelSnapRow[],
  cutoff: Date,
): InjuryImpact[] {
  return [...injuries.values()]
    .filter((row) => row.teamId === teamId)
    .map((row) => {
      const starter = starters.find((item) => item.playerId === row.playerId);
      const share = snapShare(recentSnaps(teamId, row.playerId, snaps, cutoff));
      const starterLikelihood = starter ? (starter.official ? 1 : 0.75) : share === null ? null : Math.min(1, share);
      const designation = text(row.gameStatus) ?? text(row.practiceStatus);
      const designationWeight = /out|inactive|ir|reserve/i.test(designation ?? "") ? 1
        : /doubtful/i.test(designation ?? "") ? 0.75
          : /questionable|limited/i.test(designation ?? "") ? 0.5 : 0.25;
      const reasons: string[] = [];
      if (starterLikelihood === null) reasons.push("Starter likelihood unavailable: no depth or snap evidence.");
      if (share === null) reasons.push("Recent snap share unavailable.");
      if (!designation) reasons.push("Game/practice designation unavailable.");
      const impactScore = starterLikelihood === null || share === null
        ? null
        : clamp(100 * starterLikelihood * Math.max(share, 0.2) * designationWeight);
      return {
        playerId: row.playerId,
        teamId,
        playerName: starter?.playerName ?? null,
        position: normalizePosition(row.position),
        unit: personnelUnit(row.position),
        designation,
        practiceStatus: text(row.practiceStatus),
        gameStatus: text(row.gameStatus),
        snapshotTimestamp: iso(row.snapshotTimestamp),
        recentSnapShare: share,
        starterLikelihood,
        impactScore,
        replacementQuality: null,
        unavailableReasons: reasons,
        derivation: "Contextual impact = starter likelihood × recent snap share × designation weight; replacement quality is not available in immutable sources.",
      };
    });
}

function injurySummary(rows: InjuryImpact[]) {
  const units = ["offense", "defense", "defensiveFront", "specialTeams", "quarterback", "offensiveLine", "secondary", "skillPosition"] as const;
  const result: Record<string, { impactScore: number | null; players: InjuryImpact[] }> = {};
  for (const unit of units) {
    const players = rows.filter((row) => {
      if (unit === "offense") return OFFENSE.has(normalizePosition(row.position) ?? "");
      if (unit === "defense") return DEFENSE.has(normalizePosition(row.position) ?? "");
      if (unit === "defensiveFront") return row.unit === "defensive_front";
      if (unit === "specialTeams") return row.unit === "special_teams";
      if (unit === "quarterback") return row.unit === "quarterback";
      if (unit === "offensiveLine") return row.unit === "offensive_line";
      if (unit === "secondary") return row.unit === "secondary";
      return ["skill", "running_back"].includes(row.unit);
    });
    result[unit] = {
      impactScore: players.some((row) => row.impactScore === null) ? null : clamp(players.reduce((sum, row) => sum + (row.impactScore ?? 0), 0)),
      players,
    };
  }
  return result;
}

function deriveQb(
  teamId: string,
  starters: ProbableStarter[],
  qbs: PersonnelQbRow[],
  snaps: PersonnelSnapRow[],
  cutoff: Date,
) {
  const teamRows = qbs.filter((row) =>
    row.teamId === teamId
    && (time(row.kickoffTime) ?? -1) < cutoff.getTime()
    && time(row.sourceUpdatedAt) !== null
    && time(row.sourceUpdatedAt)! <= cutoff.getTime(),
  );
  const byGame = new Map<string, PersonnelQbRow[]>();
  for (const row of teamRows) byGame.set(row.gameId, [...(byGame.get(row.gameId) ?? []), row]);
  const primary = [...byGame.values()]
    .map((rows) => rows.sort((a, b) => b.dropbacks - a.dropbacks)[0])
    .filter((row) => row.dropbacks > 0)
    .sort((a, b) => (time(b.kickoffTime) ?? -1) - (time(a.kickoffTime) ?? -1));
  const projected = starters.find((row) => row.position === "QB") ?? (primary[0] ? {
    playerId: primary[0].playerId,
    teamId,
    playerName: null,
    position: "QB",
    unit: "quarterback",
    estimatedDepthPosition: null,
    source: "qb_game_stats_inference",
    classification: "inferred" as const,
    official: false,
    inferred: true,
    confidence: 48,
    snapshotTimestamp: iso(primary[0].kickoffTime),
    dataFreshness: "stale" as const,
    recentSnapShare: snapShare(recentSnaps(teamId, primary[0].playerId, snaps, cutoff)),
    recentStarterEvidence: ["Most recent pre-cutoff QB participation had the highest dropback volume."],
    injuryStatus: { injury: null, practiceStatus: null, gameStatus: null, snapshotTimestamp: null },
    priorWeekParticipation: {
      gameId: primary[0].gameId,
      participated: true,
      snapShare: snapShare(recentSnaps(teamId, primary[0].playerId, snaps, cutoff)),
    },
    evidence: ["qb_game_stats participation inference", `Most recent pre-cutoff game: ${iso(primary[0].kickoffTime) ?? "unknown"}.`],
    unavailableReason: "No current depth-chart QB starter was available.",
  } : null);
  const recent = projected ? primary.filter((row) => row.playerId === projected.playerId).slice(0, 5) : [];
  const totals = recent.reduce((sum, row) => ({
    dropbacks: sum.dropbacks + row.dropbacks,
    passAttempts: sum.passAttempts + row.passAttempts,
    passEpa: sum.passEpa + row.passEpa,
    passSuccesses: sum.passSuccesses + row.passSuccesses,
    interceptions: sum.interceptions + row.interceptions,
    sacks: sum.sacks + row.sacks,
    rushAttempts: sum.rushAttempts + row.rushAttempts,
    rushEpa: sum.rushEpa + row.rushEpa,
  }), { dropbacks: 0, passAttempts: 0, passEpa: 0, passSuccesses: 0, interceptions: 0, sacks: 0, rushAttempts: 0, rushEpa: 0 });
  let consecutiveStarts = 0;
  for (const row of primary) {
    if (!projected || row.playerId !== projected.playerId) break;
    consecutiveStarts += 1;
  }
  const prior = primary[0] ?? null;
  const historicalStarts = new Set(primary.map((row) => row.playerId)).size ? primary.filter((row) => row.playerId === projected?.playerId).length : 0;
  const certainty = projected
    ? clamp((projected.official ? 88 : 62) + (recent.length >= 3 ? 8 : recent.length ? 2 : -15) - (projected.unavailableReason ? 20 : 0))
    : 0;
  const qbSnapShare = projected
    ? snapShare(recentSnaps(teamId, projected.playerId, snaps, cutoff))
    : null;
  return {
    projectedStarter: projected,
    starterCertainty: certainty,
    priorGameStarter: prior?.playerId ?? null,
    starterChange: projected && prior ? projected.playerId !== prior.playerId : null,
    consecutiveStarts,
    recentSnapShare: qbSnapShare,
    recentDropbacks: totals.dropbacks || null,
    recentEpaPerDropback: totals.dropbacks ? totals.passEpa / totals.dropbacks : null,
    recentSuccessRate: totals.dropbacks ? totals.passSuccesses / totals.dropbacks : null,
    interceptionRate: totals.passAttempts ? totals.interceptions / totals.passAttempts : null,
    sackRate: totals.dropbacks ? totals.sacks / totals.dropbacks : null,
    rushingContribution: totals.rushAttempts ? totals.rushEpa / totals.rushAttempts : null,
    historicalStarts,
    backupExperience: new Set(primary.filter((row) => row.playerId !== projected?.playerId).map((row) => row.playerId)).size,
    qbContinuityScore: projected ? clamp(certainty * 0.7 + Math.min(consecutiveStarts, 5) * 6) : null,
    metricsSampleGames: recent.length,
    unavailableReasons: projected ? [] : ["No prior QB participation or depth-chart evidence was available."],
  };
}

function deriveOl(teamId: string, starters: ProbableStarter[], snaps: PersonnelSnapRow[], cutoff: Date) {
  const line = starters.filter((row) => row.teamId === teamId && row.unit === "offensive_line");
  const previousGame = snaps
    .filter((row) => row.teamId === teamId
      && OL.has(normalizePosition(row.position) ?? "")
      && (time(row.kickoffTime) ?? -1) < cutoff.getTime()
      && time(row.sourceUpdatedAt) !== null
      && time(row.sourceUpdatedAt)! <= cutoff.getTime())
    .sort((a, b) => (time(b.kickoffTime) ?? -1) - (time(a.kickoffTime) ?? -1))[0]?.gameId;
  const priorLine = new Set(snaps
    .filter((row) => row.teamId === teamId
      && row.gameId === previousGame
      && OL.has(normalizePosition(row.position) ?? "")
      && time(row.sourceUpdatedAt) !== null
      && time(row.sourceUpdatedAt)! <= cutoff.getTime())
    .sort((a, b) => (b.offenseSnaps ?? -1) - (a.offenseSnaps ?? -1))
    .slice(0, 5)
    .map((row) => row.playerId));
  const returning = line.filter((row) => priorLine.has(row.playerId)).length;
  const shares = line.map((row) => snapShare(recentSnaps(teamId, row.playerId, snaps, cutoff))).filter((value): value is number => value !== null);
  const has = (position: string) => line.find((row) => ["LT", "T"].includes(position) ? ["LT", "T"].includes(row.position ?? "") : row.position === position) ?? null;
  return {
    projectedStartingFive: line.slice(0, 5),
    returningStartersFromPriorWeek: previousGame ? returning : null,
    olSnapContinuity: shares.length ? shares.reduce((sum, value) => sum + value, 0) / shares.length : null,
    lineupChanges: previousGame ? Math.max(0, 5 - returning) : line.length ? Math.max(0, 5 - line.length) : null,
    starterGamesMissed: null,
    leftTackleAvailable: has("LT") ? has("LT")!.unavailableReason === null : null,
    rightTackleAvailable: has("RT") ? has("RT")!.unavailableReason === null : null,
    centerContinuity: has("C")?.playerId ?? null,
    recentSackRateAllowed: null,
    recentPressureProxy: null,
    proxyNotes: [
      "Returning starter and lineup continuity use recent snap participation as a proxy when prior depth data is absent.",
      "Starter games missed, sack rate, and true pressure data are unavailable in the requested immutable sources.",
    ],
  };
}

function deriveRest(teamId: string, game: PersonnelGame, priorGames: PersonnelPriorGame[]) {
  const history = priorGames
    .filter((row) => row.teamId === teamId && (time(row.kickoffTime) ?? -1) < (time(game.kickoffTime) ?? Number.MAX_SAFE_INTEGER))
    .sort((a, b) => (time(b.kickoffTime) ?? -1) - (time(a.kickoffTime) ?? -1));
  const prior = history[0];
  const kickoff = time(game.kickoffTime);
  const priorKickoff = time(prior?.kickoffTime);
  const daysRest = kickoff !== null && priorKickoff !== null ? (kickoff - priorKickoff) / 86_400_000 : null;
  const weekday = kickoff === null ? null : new Date(kickoff).getUTCDay();
  const priorWeekday = priorKickoff === null ? null : new Date(priorKickoff).getUTCDay();
  let consecutiveRoadGames = kickoff === null ? null : game.homeTeamId === teamId ? 0 : 1;
  if (consecutiveRoadGames !== null) {
    for (const row of history) {
      if (row.isHome) break;
      consecutiveRoadGames += 1;
    }
  }
  return {
    daysRest,
    shortWeek: daysRest === null ? null : daysRest < 6,
    thursdayGame: weekday === 4,
    mondayToSundayTurnaround: priorWeekday === null || weekday === null ? null : priorWeekday === 1 && weekday === 0,
    byeWeekReturn: daysRest === null ? null : daysRest >= 13,
    consecutiveRoadGames,
    travelDistance: null,
    timezoneChange: null,
    internationalGame: null,
    previousOvertime: null,
    priorGameSnapBurden: null,
    unsupported: {
      travelDistance: "No reliable venue coordinates or travel source exists.",
      timezoneChange: "No reliable venue timezone source exists.",
      internationalGame: "International venue metadata is not normalized.",
      previousOvertime: "Final scores do not identify overtime without a game-status source.",
      priorGameSnapBurden: "Snap counts are available by player but no complete team burden denominator is stored.",
    },
  };
}

function sourceConflicts(starters: ProbableStarter[]) {
  const byPosition = new Map<string, ProbableStarter[]>();
  for (const starter of starters) {
    if (!starter.position) continue;
    byPosition.set(starter.position, [...(byPosition.get(starter.position) ?? []), starter]);
  }
  return [...byPosition.entries()]
    .filter(([, rows]) => new Set(rows.map((row) => row.playerId)).size > 1)
    .map(([position, rows]) => ({
      position,
      players: [...new Set(rows.map((row) => row.playerName ?? row.playerId))],
      sources: [...new Set(rows.map((row) => row.source))],
      reason: "Multiple pre-cutoff source rows identify different first-choice players; source hierarchy was preserved.",
    }));
}

function americanImplied(price: number) {
  return price < 0 ? -price / (-price + 100) : 100 / (price + 100);
}

function deriveMarket(odds: PersonnelOddsRow[], cutoff: Date, kickoff: DateLike) {
  const rows = odds.filter((row) => (time(row.capturedAt) ?? -1) <= cutoff.getTime()).sort((a, b) => (time(a.capturedAt) ?? -1) - (time(b.capturedAt) ?? -1));
  const groups = new Map<string, PersonnelOddsRow[]>();
  for (const row of rows) groups.set(`${row.sportsbook}:${row.market}:${row.selection}`, [...(groups.get(`${row.sportsbook}:${row.market}:${row.selection}`) ?? []), row]);
  const lines = [...groups.entries()].map(([key, quotes]) => {
    const first = quotes[0];
    const current = quotes[quotes.length - 1];
    return {
      key,
      sportsbook: current.sportsbook,
      market: current.market,
      selection: current.selection,
      firstObserved: { point: first.point ?? null, price: first.price, capturedAt: iso(first.capturedAt) },
      current: { point: current.point ?? null, price: current.price, capturedAt: iso(current.capturedAt) },
      finalPreKickoff: { point: current.point ?? null, price: current.price, capturedAt: iso(current.capturedAt) },
      pointMovement: first.point !== null && first.point !== undefined && current.point !== null && current.point !== undefined ? current.point - first.point : null,
      priceMovement: current.price - first.price,
      observations: quotes.length,
      timeSinceLastUpdateHours: time(current.capturedAt) === null ? null : Math.max(0, (cutoff.getTime() - (time(current.capturedAt) ?? cutoff.getTime())) / 3_600_000),
      firstObservedLabel: "Gridline first observed (not an official opener)",
    };
  });
  const byMarket = (market: string) => lines.filter((line) => line.market.toLowerCase() === market);
  const books = new Set(rows.map((row) => row.sportsbook.toLowerCase()));
  const disagreement = ["spread", "total", "moneyline"].map((market) => {
    const marketRows = rows.filter((row) => row.market.toLowerCase() === market);
    const byBook = [...new Set(marketRows.map((row) => row.sportsbook))].map((book) => {
      const quote = marketRows.filter((row) => row.sportsbook === book).at(-1);
      return quote ? { sportsbook: book, point: quote.point ?? null, price: quote.price } : null;
    }).filter(Boolean);
    const points = byBook.map((row) => row!.point).filter((value): value is number => value !== null);
    return { market, books: byBook, pointDifference: points.length > 1 ? Math.max(...points) - Math.min(...points) : null };
  });
  const moneylines = rows.filter((row) => row.market.toLowerCase() === "moneyline");
  const favoriteAt = (quotes: PersonnelOddsRow[]) => quotes.length
    ? quotes.sort((a, b) => americanImplied(b.price) - americanImplied(a.price))[0]?.selection ?? null
    : null;
  const favorite = favoriteAt(moneylines);
  const firstQuotes = new Map<string, PersonnelOddsRow>();
  for (const row of moneylines) {
    const existing = firstQuotes.get(row.selection);
    if (!existing || (time(row.capturedAt) ?? -1) < (time(existing.capturedAt) ?? -1)) firstQuotes.set(row.selection, row);
  }
  const firstFavorite = favoriteAt([...firstQuotes.values()]);
  const bestBettorAvailableNumber = lines.reduce<Record<string, { point: number | null; price: number; sportsbook: string }>>((result, line) => {
    const key = `${line.market}:${line.selection}`;
    const current = result[key];
    const point = line.current.point;
    const isOver = /over/i.test(line.selection);
    const isUnder = /under/i.test(line.selection);
    const better = !current
      || (point !== null && current.point !== null && (isOver ? point < current.point : isUnder ? point > current.point : point > current.point))
      || (point === current?.point && line.current.price > current.price);
    if (better) result[key] = { point, price: line.current.price, sportsbook: line.sportsbook };
    return result;
  }, {});
  return {
    cutoff: cutoff.toISOString(),
    firstGridlineObserved: lines.length ? lines.map((line) => line.firstObserved.capturedAt).sort()[0] : null,
    current: lines,
    finalPreKickoff: time(kickoff) !== null && time(kickoff)! <= cutoff.getTime() ? lines : lines,
    pointMovement: lines,
    priceMovement: lines,
    observations: rows.length,
    sportsbookDisagreement: disagreement,
    bestBettorAvailableNumber: Object.keys(bestBettorAvailableNumber).length ? bestBettorAvailableNumber : null,
    bestNumberUnavailableReason: Object.keys(bestBettorAvailableNumber).length ? null : "No current market number was available.",
    favorite,
    favoriteFlip: firstFavorite && favorite ? firstFavorite !== favorite : null,
    keyNumberMovement: lines.some((line) => line.pointMovement !== null && [3, 7, 10].some((key) =>
      Math.min(Math.abs(line.firstObserved.point ?? NaN), Math.abs(line.current.point ?? NaN)) < key &&
      Math.max(Math.abs(line.firstObserved.point ?? NaN), Math.abs(line.current.point ?? NaN)) >= key)),
    timeSinceLastOddsUpdateHours: rows.length ? Math.max(0, (cutoff.getTime() - (time(rows.at(-1)?.capturedAt) ?? cutoff.getTime())) / 3_600_000) : null,
    marketCoverage: { rows: rows.length, sportsbooks: [...books] },
    unavailableReason: rows.length ? null : "No immutable sportsbook observations were available as of the cutoff.",
  };
}

function confidence(
  teams: Record<string, { starters: ProbableStarter[]; injuries: InjuryImpact[]; qb: ReturnType<typeof deriveQb>; market: ReturnType<typeof deriveMarket> }>,
  weather: { available: boolean },
) {
  const values = Object.values(teams);
  const personnelCompleteness = values.length
    ? clamp(values.reduce((sum, value) => sum + REQUIRED_STARTER_POSITIONS.filter((position) =>
      value.starters.some((starter) => starter.position === position),
    ).length / REQUIRED_STARTER_POSITIONS.length * 100, 0) / values.length)
    : 0;
  // No injury rows are not proof of a fresh clean report.
  const injuryFreshness = values.length ? clamp(values.reduce((sum, value) => {
    const rows = value.injuries;
    return sum + (rows.length ? rows.filter((row) => row.snapshotTimestamp).length / rows.length * 100 : 0);
  }, 0) / values.length) : 0;
  const qbCertainty = values.length ? clamp(values.reduce((sum, value) => sum + value.qb.starterCertainty, 0) / values.length) : 0;
  const marketFreshness = values.length ? clamp(values.reduce((sum, value) => sum + (value.market.observations
    ? Math.max(0, 100 - Math.min(100, (value.market.timeSinceLastOddsUpdateHours ?? 999) * 4))
    : 0), 0) / values.length) : 0;
  const marketCoverage = values.length ? clamp(values.reduce((sum, value) =>
    sum + Math.min(100, value.market.marketCoverage.sportsbooks.length * 50), 0) / values.length) : 0;
  const sampleSize = values.length ? clamp(values.reduce((sum, value) => sum + Math.min(100, value.qb.metricsSampleGames * 20), 0) / values.length) : 0;
  const weights = {
    qbCertainty: 0.2,
    personnelCompleteness: 0.2,
    injuryFreshness: 0.15,
    sportsbookFreshness: 0.15,
    weatherAvailability: 0.1,
    sampleQuality: 0.2,
  } as const;
  const components = {
    qbCertainty,
    personnelCompleteness,
    injuryFreshness,
    sportsbookFreshness: marketFreshness,
    weatherAvailability: weather.available ? 100 : 0,
    sampleQuality: sampleSize,
    sportsbookCoverage: marketCoverage,
  };
  const overall = clamp(
    components.qbCertainty * weights.qbCertainty
    + components.personnelCompleteness * weights.personnelCompleteness
    + components.injuryFreshness * weights.injuryFreshness
    + components.sportsbookFreshness * weights.sportsbookFreshness
    + components.weatherAvailability * weights.weatherAvailability
    + components.sampleQuality * weights.sampleQuality,
  );
  return { overall, label: "Data Confidence (not betting confidence)", notBetting: true, weights, components };
}

export type PersonnelContext = {
  version: "pregame-v4-personnel-context";
  gameId: string;
  kickoffTime: string | null;
  sourceCutoff: string;
  teams: Record<string, {
    teamId: string;
    starters: ProbableStarter[];
    personnelCompleteness: number;
    missingRequiredPositions: string[];
    sourceConflicts: Array<{
      position: string;
      players: string[];
      sources: string[];
      reason: string;
    }>;
    sourceHierarchy: string[];
    unavailableReasons: string[];
    qb: ReturnType<typeof deriveQb>;
    injuries: ReturnType<typeof injurySummary>;
    injuryPlayers: InjuryImpact[];
    olContinuity: ReturnType<typeof deriveOl>;
    rest: ReturnType<typeof deriveRest>;
  }>;
  matchup: Array<{ offenseTeamId: string; defenseTeamId: string; unitContext: Record<string, unknown>; unavailableReasons: string[] }>;
  weather: {
    available: boolean;
    indoorOutdoor: string | null;
    temperature: number | null;
    windSpeed: number | null;
    windGusts: number | null;
    precipitationProbability: number | null;
    precipitationType: string | null;
    humidity: number | null;
    roofStatus: string | null;
    severeWeather: null;
    unavailableReason: string | null;
    source?: string | null;
    fetchedAt?: string | null;
    validTime?: string | null;
    sourceUrl?: string | null;
    office?: string | null;
    gridpoint?: string | null;
  };
  market: ReturnType<typeof deriveMarket>;
  dataConfidence: ReturnType<typeof confidence>;
  sources: string[];
  limitations: string[];
};

export function derivePersonnelContext(input: {
  game: PersonnelGame;
  now?: DateLike;
  depth: PersonnelDepthRow[];
  historicalDepth?: PersonnelHistoricalDepthRow[];
  injuries: PersonnelInjuryRow[];
  snaps: PersonnelSnapRow[];
  qbs: PersonnelQbRow[];
  priorGames: PersonnelPriorGame[];
  odds: PersonnelOddsRow[];
  weather?: PersonnelWeatherRow[];
}): PersonnelContext {
  const cutoff = asOfCutoff(input.game.kickoffTime, input.now instanceof Date ? input.now : input.now ? new Date(input.now) : new Date());
  const injuryMap = injuryByPlayer(input.injuries, cutoff);
  const teamIds = [input.game.homeTeamId, input.game.awayTeamId];
  const teams: PersonnelContext["teams"] = {};
  for (const teamId of teamIds) {
    const starters = depthForTeam(teamId, input.depth, input.historicalDepth ?? [], cutoff, input.snaps, injuryMap);
    const injuryPlayers = deriveInjuries(teamId, injuryMap, starters, input.snaps, cutoff);
    const qb = deriveQb(teamId, starters, input.qbs, input.snaps, cutoff);
    const olContinuity = deriveOl(teamId, starters, input.snaps, cutoff);
    const rest = deriveRest(teamId, input.game, input.priorGames);
    const missingRequiredPositions = REQUIRED_STARTER_POSITIONS.filter((position) =>
      !starters.some((starter) => starter.position === position),
    );
    teams[teamId] = {
      teamId,
      starters,
      personnelCompleteness: clamp((REQUIRED_STARTER_POSITIONS.length - missingRequiredPositions.length)
        / REQUIRED_STARTER_POSITIONS.length * 100),
      missingRequiredPositions: [...missingRequiredPositions],
      sourceConflicts: sourceConflicts(starters),
      sourceHierarchy: [
        "persisted verified official/published depth (only when explicitly sourced and permitted)",
        "ESPN existing best-effort secondary structured endpoint (terms status not verified for production reuse)",
        "nflverse recent snap-count/participation inference",
        "historical nflverse depth chart",
      ],
      unavailableReasons: starters.length
        ? missingRequiredPositions.map((position) => `Required position ${position} was unavailable as of the cutoff.`)
        : ["No depth-chart or recent participation evidence was available as of the cutoff."],
      qb,
      injuries: injurySummary(injuryPlayers),
      injuryPlayers,
      olContinuity,
      rest,
    };
  }
  const matchup = [
    { offenseTeamId: input.game.homeTeamId, defenseTeamId: input.game.awayTeamId },
    { offenseTeamId: input.game.awayTeamId, defenseTeamId: input.game.homeTeamId },
  ].map(({ offenseTeamId, defenseTeamId }) => {
    const offense = teams[offenseTeamId];
    const defense = teams[defenseTeamId];
    return {
      offenseTeamId,
      defenseTeamId,
      unitContext: {
        receiverAvailability: offense.injuries.skillPosition,
        opposingSecondaryAvailability: defense.injuries.secondary,
        tightEndVsLinebackerAvailability: {
          offenseTightEnd: offense.injuryPlayers.filter((row) => row.position === "TE"),
          opposingLinebacker: defense.injuryPlayers.filter((row) => row.unit === "linebacker"),
        },
        passRusherVsOlContinuity: {
          opposingDefensiveFront: defense.injuries.defense,
          offensiveLineContinuity: offense.olContinuity.olSnapContinuity,
        },
        rushingVsFrontAvailability: {
          opposingDefensiveFront: defense.injuries.defensiveFront,
          offenseRunningBack: offense.injuryPlayers.filter((row) => row.unit === "running_back"),
        },
        directAssignments: null,
      },
      unavailableReasons: ["Direct player-vs-player assignments are not supported by immutable sources."],
    };
  });
  const weatherRow = (input.weather ?? [])
    .filter((row) => (time(row.fetchedAt) ?? -1) <= cutoff.getTime())
    .filter((row) => {
      const valid = time(row.validTime);
      const kickoff = time(input.game.kickoffTime);
      return valid !== null && (kickoff === null || Math.abs(valid - kickoff) <= 12 * 60 * 60 * 1000);
    })
    .sort((a, b) => (time(b.fetchedAt) ?? -1) - (time(a.fetchedAt) ?? -1))[0];
  const weather = weatherRow ? {
    available: true,
    indoorOutdoor: weatherRow.indoorOutdoor,
    temperature: weatherRow.temperature ?? null,
    windSpeed: weatherRow.sustainedWind ?? null,
    windGusts: weatherRow.windGust ?? null,
    precipitationProbability: weatherRow.precipitationProbability ?? null,
    precipitationType: weatherRow.precipitationType ?? null,
    humidity: weatherRow.humidity ?? null,
    roofStatus: weatherRow.roofStatus ?? null,
    severeWeather: null,
    unavailableReason: null,
    source: weatherRow.source,
    fetchedAt: iso(weatherRow.fetchedAt),
    validTime: iso(weatherRow.validTime),
    sourceUrl: weatherRow.sourceUrl ?? null,
    office: weatherRow.office ?? null,
    gridpoint: weatherRow.gridpoint ?? null,
  } : {
    available: false,
    indoorOutdoor: null,
    temperature: null,
    windSpeed: null,
    windGusts: null,
    precipitationProbability: null,
    precipitationType: null,
    humidity: null,
    roofStatus: null,
    severeWeather: null,
    unavailableReason: "Weather is unavailable: no valid pre-cutoff NWS forecast snapshot exists.",
  };
  const market = deriveMarket(input.odds, cutoff, input.game.kickoffTime);
  const contextTeams = Object.fromEntries(Object.entries(teams).map(([teamId, team]) => [teamId, { starters: team.starters, injuries: team.injuryPlayers, qb: team.qb, market }]));
  return {
    version: "pregame-v4-personnel-context",
    gameId: input.game.gameId,
    kickoffTime: iso(input.game.kickoffTime),
    sourceCutoff: cutoff.toISOString(),
    teams,
    matchup,
    weather,
    market,
    dataConfidence: confidence(contextTeams, weather),
    sources: ["injuries", "depth_chart_snapshots", "historical_depth_charts", "snap_counts", "qb_game_stats", "games", "teams", "sportsbook_odds"],
    limitations: [
      ...(weather.available ? [] : ["Weather is explicitly unavailable because no valid pre-cutoff NWS forecast snapshot exists."]),
      "Travel distance, timezone change, international designation, overtime, and complete snap burden are unsupported.",
      "Replacement quality and player-vs-player coverage assignments are unavailable; no values were imputed.",
      "Gridline first odds observation is not an official opener.",
    ],
  };
}

export function personnelNumericFeatures(context: PersonnelContext) {
  const numeric: Record<string, number | null> = {
    "personnel.data_confidence": context.dataConfidence.overall,
    "personnel.weather_available": context.weather.available ? 1 : 0,
    "personnel.weather_temperature": context.weather.temperature,
    "personnel.weather_wind_speed": context.weather.windSpeed,
    "personnel.weather_wind_gust": context.weather.windGusts,
    "personnel.weather_precipitation_probability": context.weather.precipitationProbability,
    "personnel.weather_humidity": context.weather.humidity,
    "market.observations": context.market.observations,
    "market.time_since_last_odds_update_hours": context.market.timeSinceLastOddsUpdateHours,
  };
  for (const [teamId, team] of Object.entries(context.teams)) {
    const prefix = `personnel.${teamId}`;
    numeric[`${prefix}.starter_count`] = team.starters.length;
    numeric[`${prefix}.personnel_completeness`] = team.personnelCompleteness;
    numeric[`${prefix}.qb_starter_certainty`] = team.qb.starterCertainty;
    numeric[`${prefix}.qb_recent_dropbacks`] = team.qb.recentDropbacks;
    numeric[`${prefix}.qb_recent_snap_share`] = team.qb.recentSnapShare;
    numeric[`${prefix}.qb_recent_epa_per_dropback`] = team.qb.recentEpaPerDropback;
    numeric[`${prefix}.qb_recent_success_rate`] = team.qb.recentSuccessRate;
    numeric[`${prefix}.qb_interception_rate`] = team.qb.interceptionRate;
    numeric[`${prefix}.qb_sack_rate`] = team.qb.sackRate;
    numeric[`${prefix}.qb_rushing_contribution`] = team.qb.rushingContribution;
    numeric[`${prefix}.qb_continuity_score`] = team.qb.qbContinuityScore;
    numeric[`${prefix}.injury_offense_impact`] = team.injuries.offense.impactScore;
    numeric[`${prefix}.injury_defense_impact`] = team.injuries.defense.impactScore;
    numeric[`${prefix}.injury_special_teams_impact`] = team.injuries.specialTeams.impactScore;
    numeric[`${prefix}.injury_qb_impact`] = team.injuries.quarterback.impactScore;
    numeric[`${prefix}.injury_ol_impact`] = team.injuries.offensiveLine.impactScore;
    numeric[`${prefix}.injury_secondary_impact`] = team.injuries.secondary.impactScore;
    numeric[`${prefix}.injury_skill_impact`] = team.injuries.skillPosition.impactScore;
    numeric[`${prefix}.ol_snap_continuity`] = team.olContinuity.olSnapContinuity;
    numeric[`${prefix}.ol_lineup_changes`] = team.olContinuity.lineupChanges;
    numeric[`${prefix}.rest_days`] = team.rest.daysRest;
    numeric[`${prefix}.short_week`] = team.rest.shortWeek === null ? null : team.rest.shortWeek ? 1 : 0;
    numeric[`${prefix}.thursday_game`] = team.rest.thursdayGame ? 1 : 0;
    numeric[`${prefix}.monday_to_sunday_turnaround`] = team.rest.mondayToSundayTurnaround === null ? null : team.rest.mondayToSundayTurnaround ? 1 : 0;
    numeric[`${prefix}.bye_week_return`] = team.rest.byeWeekReturn === null ? null : team.rest.byeWeekReturn ? 1 : 0;
    numeric[`${prefix}.consecutive_road_games`] = team.rest.consecutiveRoadGames;
    numeric[`${prefix}.travel_distance`] = null;
    numeric[`${prefix}.timezone_change`] = null;
  }
  return numeric;
}
