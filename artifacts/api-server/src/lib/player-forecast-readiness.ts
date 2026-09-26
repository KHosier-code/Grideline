import { and, desc, eq, gte, inArray, lte } from "drizzle-orm";
import {
  db,
  pool,
  depthChartSnapshotsTable,
  gamesTable,
  injuriesTable,
  nflversePlayerIdentitiesTable,
  nflverseSourceFilesTable,
  playerGameStatsTable,
  playersTable,
  teamsTable,
} from "@workspace/db";

const SKILL_POSITIONS = new Set(["QB", "RB", "WR", "TE"]);
const FRESHNESS_WINDOW_MS = 48 * 60 * 60 * 1000;
const FINAL_OR_UNAVAILABLE = /final|complete|live|in.?progress|postponed|cancelled|canceled/i;

export type UpcomingReadinessResponse = {
  status: "unavailable" | "development_forecasts";
  message: string;
  asOf: string | null;
  upcomingGames: number;
  eligibility: {
    eligible: number;
    uncertain: number;
    excluded: number;
    reasons: Record<string, number>;
  };
  sourceFreshness: Record<"roster" | "injuries" | "playerStats", {
    latestSourceUpdatedAt: string | null;
    ageHours: number | null;
    status: string;
  }>;
  blockers: string[];
  forecasts: never[];
};

export type ReadinessGame = {
  gameId: string;
  season: number;
  week: number;
  kickoffTime: Date | string | null;
  gameStatus: string;
  homeTeamId: string;
  awayTeamId: string;
};

export type ReadinessPlayer = {
  playerId: string;
  teamId: string | null;
  position: string | null;
  activeStatus?: string | null;
  sourceUpdatedAt?: Date | string | null;
};

export type VerifiedRosterAssignment = {
  playerId: string;
  teamId: string;
  activeStatus: string | null;
  observedAt: Date | string;
};

export type ReadinessIdentity = {
  gsisId: string;
  espnId: string | null;
  observedAt: Date | string;
};

export type ReadinessStat = {
  playerId: string;
  season: number;
  week: number;
  seasonType: string;
  teamId?: string | null;
  opponentTeamId?: string | null;
};

export type ReadinessStatus = {
  playerId: string;
  teamId: string;
  gameStatus: string | null;
  sourceUpdatedAt: Date | string | null;
  snapshotTimestamp?: Date | string | null;
};

export type ReadinessDepth = {
  playerId: string;
  teamId: string;
  starter: boolean;
  snapshotTimestamp: Date | string;
};

function toDate(value: Date | string | null | undefined): Date | null {
  if (value == null) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isFinite(date.getTime()) ? date : null;
}

function ageHours(at: Date, now: Date): number | null {
  if (!Number.isFinite(at.getTime()) || at.getTime() > now.getTime()) return null;
  return (now.getTime() - at.getTime()) / 3_600_000;
}

export function measureFreshness(input: {
  timestamp: Date | string | null | undefined;
  asOf: Date;
  label: string;
  absentStatus?: string;
}): UpcomingReadinessResponse["sourceFreshness"]["roster"] {
  const timestamp = toDate(input.timestamp);
  const age = timestamp ? ageHours(timestamp, input.asOf) : null;
  const status = !timestamp
    ? input.absentStatus ?? `${input.label} timestamp is not recorded`
    : age === null
      ? `${input.label} timestamp is invalid or in the future`
      : age <= 48
        ? `${input.label} timestamp is within the 48-hour audit window`
        : `${input.label} timestamp is stale (over 48 hours old)`;
  return {
    latestSourceUpdatedAt: timestamp?.toISOString() ?? null,
    ageHours: age,
    status,
  };
}

function latestTimestamp<T extends { sourceUpdatedAt?: Date | string | null }>(rows: T[]) {
  return rows.map((row) => toDate(row.sourceUpdatedAt))
    .filter((date): date is Date => date !== null)
    .sort((a, b) => b.getTime() - a.getTime())[0] ?? null;
}

function latestPerPair<T extends { playerId: string; teamId: string }>(
  rows: T[],
  timestamp: (row: T) => Date | null,
): Map<string, T> {
  const latest = new Map<string, T>();
  for (const row of rows) {
    const key = `${row.playerId}:${row.teamId}`;
    const previous = latest.get(key);
    if (!previous || (timestamp(row)?.getTime() ?? 0) >= (timestamp(previous)?.getTime() ?? 0)) {
      latest.set(key, row);
    }
  }
  return latest;
}

function statusIsUnavailable(status: string | null | undefined) {
  return /\b(?:out|inactive|injured reserve|ir|suspended|released)\b/i.test(status ?? "");
}

function statusConfirmsAvailable(status: string | null | undefined) {
  return /\b(?:active|available|healthy|probable|full participation|cleared|playing)\b/i.test(status ?? "");
}

export function buildUpcomingPlayerReadinessAudit(input: {
  asOf: Date;
  games: ReadinessGame[];
  players: ReadinessPlayer[];
  identities: ReadinessIdentity[];
  stats: ReadinessStat[];
  injuries: ReadinessStatus[];
  depthCharts: ReadinessDepth[];
  playerStatsIngestedAt?: Date | string | null;
  allPlayerIds?: string[];
  // Only a complete, independently timestamped player/team observation can
  // verify an unchanged assignment; players.source_updated_at is change-only.
  verifiedRosterAssignments?: VerifiedRosterAssignment[];
}): UpcomingReadinessResponse {
  const verifiedUpcomingGames = input.games.filter((game) => {
    const kickoff = toDate(game.kickoffTime);
    return game.week >= 1 && game.week <= 18
      && kickoff !== null && kickoff.getTime() > input.asOf.getTime()
      && !FINAL_OR_UNAVAILABLE.test(game.gameStatus);
  });
  const firstUpcoming = [...verifiedUpcomingGames].sort((a, b) =>
    (toDate(a.kickoffTime)?.getTime() ?? 0) - (toDate(b.kickoffTime)?.getTime() ?? 0))[0];
  const targetSeason = firstUpcoming?.season ?? 0;
  const nearestWeek = firstUpcoming?.week;
  const slate = nearestWeek === undefined
    ? []
    : verifiedUpcomingGames.filter((game) => game.season === targetSeason && game.week === nearestWeek);
  const slateTeams = new Set(slate.flatMap((game) => [game.homeTeamId, game.awayTeamId]));

  // Resolve the latest observed identity row per GSIS ID; a tied, conflicting
  // mapping is treated as ambiguous rather than guessed.
  const byGsis = new Map<string, ReadinessIdentity[]>();
  for (const identity of input.identities) {
    const existing = byGsis.get(identity.gsisId) ?? [];
    const observedAt = toDate(identity.observedAt)?.getTime() ?? 0;
    const currentAt = Math.max(0, ...existing.map((row) => toDate(row.observedAt)?.getTime() ?? 0));
    if (observedAt > currentAt) byGsis.set(identity.gsisId, [identity]);
    else if (observedAt === currentAt) byGsis.set(identity.gsisId, [...existing, identity]);
  }
  const gsisByEspn = new Map<string, Set<string>>();
  const ambiguousEspnIds = new Set<string>();
  for (const [gsisId, latest] of byGsis) {
    const espnIds = new Set(latest.map((row) => row.espnId).filter((id): id is string => Boolean(id)));
    if (espnIds.size !== 1) {
      for (const espnId of espnIds) ambiguousEspnIds.add(espnId);
      continue;
    }
    const espnId = [...espnIds][0]!;
    const ids = gsisByEspn.get(espnId) ?? new Set<string>();
    ids.add(gsisId);
    gsisByEspn.set(espnId, ids);
  }

  const knownPlayerIds = new Set(input.allPlayerIds ?? input.players.map((player) => player.playerId));
  const statPlayerIds = new Set(input.stats
    .filter((stat) => stat.season === targetSeason && stat.seasonType.toUpperCase() === "REG")
    .map((stat) => stat.playerId));
  const mappedStatPlayerIds = [...statPlayerIds].filter((gsisId) => {
    const latest = byGsis.get(gsisId) ?? [];
    const ids = new Set(latest.map((row) => row.espnId).filter((id): id is string => Boolean(id)));
    return ids.size === 1 && knownPlayerIds.has([...ids][0]!);
  }).length;

  const verifiedRosterByPlayer = latestPerPair(input.verifiedRosterAssignments ?? [], (row) => toDate(row.observedAt));
  const rosterFreshness = measureFreshness({
    timestamp: latestTimestamp((input.verifiedRosterAssignments ?? []).map((row) => ({
      sourceUpdatedAt: row.observedAt,
    }))),
    asOf: input.asOf,
    label: "complete player/team roster observation",
    absentStatus: "No complete, independently timestamped current player/team roster observation is retained; players.source_updated_at records changes, not checks",
  });
  const rosterIsFresh = rosterFreshness.ageHours !== null && rosterFreshness.ageHours <= 48;
  const latestInjury = latestTimestamp(input.injuries);
  const injuryFreshness = measureFreshness({
    timestamp: latestInjury,
    asOf: input.asOf,
    label: "injuries.source_updated_at (ESPN payload observation when supplied)",
    absentStatus: "No ESPN injury source timestamp is recorded",
  });
  const statsFreshness = measureFreshness({
    timestamp: input.playerStatsIngestedAt,
    asOf: input.asOf,
    label: "nflverse_source_files.completed_at (import ingestion time, not provider publication time)",
    absentStatus: "No player-stat import timestamp is recorded",
  });
  statsFreshness.status += "; NFLverse upstream publication time is not independently archived";

  const injuriesByPair = latestPerPair(input.injuries, (row) =>
    toDate(row.snapshotTimestamp) ?? toDate(row.sourceUpdatedAt));
  const depthsByPair = latestPerPair(input.depthCharts, (row) => toDate(row.snapshotTimestamp));
  const candidatePlayers = input.players.filter((player) =>
    SKILL_POSITIONS.has((player.position ?? "").toUpperCase()));
  const candidateInjuryEvidence = candidatePlayers
    .map((player) => player.teamId ? injuriesByPair.get(`${player.playerId}:${player.teamId}`) : undefined)
    .filter((injury): injury is ReadinessStatus => injury !== undefined);
  const freshInjuryEvidence = candidateInjuryEvidence.filter((injury) => {
    const updatedAt = toDate(injury.sourceUpdatedAt);
    const age = updatedAt ? ageHours(updatedAt, input.asOf) : null;
    return age !== null && age <= 48;
  }).length;
  const reasons: Record<string, number> = {};
  let eligible = 0;
  let uncertain = 0;
  let excluded = 0;
  const countReason = (reason: string) => {
    reasons[reason] = (reasons[reason] ?? 0) + 1;
  };

  for (const player of candidatePlayers) {
    if (!player.teamId) {
      excluded += 1;
      countReason("missing_current_team_assignment");
      continue;
    }
    if (!slateTeams.has(player.teamId)) {
      excluded += 1;
      countReason("team_not_in_nearest_upcoming_week");
      continue;
    }
    const gsisIds = gsisByEspn.get(player.playerId);
    if (!gsisIds?.size || ambiguousEspnIds.has(player.playerId)) {
      excluded += 1;
      countReason(ambiguousEspnIds.has(player.playerId) ? "ambiguous_gsis_espn_mapping" : "missing_gsis_espn_mapping");
      continue;
    }
    const priorAppearanceCount = new Set(input.stats
      .filter((stat) => gsisIds.has(stat.playerId)
        && stat.seasonType.toUpperCase() === "REG"
        && (stat.season < targetSeason || (stat.season === targetSeason && stat.week < (nearestWeek ?? 1))))
      .map((stat) => `${stat.season}:${stat.week}:${stat.opponentTeamId ?? ""}`)).size;
    if (priorAppearanceCount < 3) {
      excluded += 1;
      countReason("fewer_than_three_strictly_prior_regular_season_appearances");
      continue;
    }

    const verifiedRoster = verifiedRosterByPlayer.get(`${player.playerId}:${player.teamId}`);
    const playerRosterTimestamp = toDate(verifiedRoster?.observedAt);
    const playerRosterAge = playerRosterTimestamp ? ageHours(playerRosterTimestamp, input.asOf) : null;
    const playerRosterIsFresh = playerRosterAge !== null && playerRosterAge <= 48;
    const injury = injuriesByPair.get(`${player.playerId}:${player.teamId}`);
    const injuryTimestamp = toDate(injury?.sourceUpdatedAt);
    const injuryAge = injuryTimestamp ? ageHours(injuryTimestamp, input.asOf) : null;
    const rosterStatusUnavailable = playerRosterIsFresh && statusIsUnavailable(verifiedRoster?.activeStatus);
    const injuryStatusUnavailable = injuryAge !== null && injuryAge <= 48
      && Boolean(injury && statusIsUnavailable(injury.gameStatus));
    if (rosterStatusUnavailable || injuryStatusUnavailable) {
      excluded += 1;
      countReason(rosterStatusUnavailable
        ? "confirmed_unavailable_roster_status"
        : "confirmed_unavailable_injury_status");
      continue;
    }

    const depth = depthsByPair.get(`${player.playerId}:${player.teamId}`);
    const depthTimestamp = toDate(depth?.snapshotTimestamp);
    const depthAge = depthTimestamp ? ageHours(depthTimestamp, input.asOf) : null;
    const reasonsForUncertainty: string[] = [];
    if (!depth || depthAge === null || depthAge > 48 || !depth.starter) {
      countReason(!depth ? "starter_status_unknown_no_depth_chart" : "starter_not_freshly_confirmed");
    }
    if (!rosterIsFresh || !playerRosterIsFresh) reasonsForUncertainty.push("roster_assignment_not_recently_verified");
    if (!injury || injuryAge === null || injuryAge > 48 || !statusConfirmsAvailable(injury.gameStatus)) {
      reasonsForUncertainty.push(!injury ? "injury_status_missing" : "injury_status_not_fresh_and_confirmed_available");
    }
    if (reasonsForUncertainty.length) {
      uncertain += 1;
      for (const reason of reasonsForUncertainty) countReason(reason);
      continue;
    }
    eligible += 1;
  }

  const candidateRosterEvidenceIsFresh = candidatePlayers
    .filter((player) => player.teamId && slateTeams.has(player.teamId))
    .every((player) => {
      const timestamp = toDate(verifiedRosterByPlayer.get(`${player.playerId}:${player.teamId}`)?.observedAt);
      const age = timestamp ? ageHours(timestamp, input.asOf) : null;
      return age !== null && age <= 48;
    });
  const blockers = !slate.length
    ? ["No verified future regular-season games with scheduled UTC kickoffs are available for a forecast audit."]
    : rosterIsFresh && candidateRosterEvidenceIsFresh
      ? []
      : ["Current player/team assignments lack recent per-player verification; change-only ESPN rows cannot establish upcoming eligibility or support forecasts."];
  const warnings = [
    injuryFreshness.ageHours === null || injuryFreshness.ageHours > 48
      ? "ESPN injury coverage is missing or stale; player availability remains uncertain."
      : null,
    input.depthCharts.length === 0
      ? "No depth-chart snapshots exist; starter status cannot be verified."
      : null,
  ].filter((warning): warning is string => warning !== null);
  const message = [
    `Read-only readiness audit for the nearest upcoming regular-season week${nearestWeek ? ` ${nearestWeek}` : ""}.`,
    `Source census: ${candidatePlayers.length} ESPN QB/RB/WR/TE roster rows; ${statPlayerIds.size} unique regular-season player-stat identities, ${mappedStatPlayerIds} linked through latest GSIS → ESPN identity to players.player_id.`,
    `The latest persisted ESPN skill-player row change was ${latestTimestamp(input.players)?.toISOString() ?? "not recorded"}; this is not the time of the latest complete provider check.`,
    `Injury evidence: ${candidateInjuryEvidence.length} of ${candidatePlayers.length} skill-player roster entries have a matching player/team record, ${freshInjuryEvidence} updated within 48 hours. Absence of a record does not establish health.`,
    "No forecasts are generated or published by this audit.",
    ...blockers,
    ...warnings,
  ].join(" ");

  return {
    status: "unavailable",
    message,
    asOf: input.asOf.toISOString(),
    upcomingGames: slate.length,
    eligibility: { eligible, uncertain, excluded, reasons },
    sourceFreshness: { roster: rosterFreshness, injuries: injuryFreshness, playerStats: statsFreshness },
    blockers,
    forecasts: [],
  };
}

export async function readDevelopmentUpcomingPlayerReadiness(asOf = new Date()) {
  if (process.env.NODE_ENV !== "development" || process.env.REPLIT_DEPLOYMENT) {
    throw new Error("Upcoming player readiness inspection is restricted to a local development preview");
  }
  const identityResult = await pool.query(`
    SELECT current_database() AS database_name, current_user AS database_role,
           pg_is_in_recovery() AS replica, inet_server_addr() IS NULL AS local_proxy
  `);
  const identity = identityResult.rows[0] as
    | { database_name: string; database_role: string; replica: boolean; local_proxy: boolean }
    | undefined;
  if (identityResult.rows.length !== 1 || identity?.database_name !== "heliumdb"
    || identity.database_role !== "postgres" || identity.replica || !identity.local_proxy) {
    throw new Error("Refusing player readiness inspection: the connection is not the verified development database");
  }
  const [
    games,
    players,
    allPlayerRows,
    identities,
    stats,
    injuries,
    depthCharts,
    playerStatSources,
  ] = await Promise.all([
    db.select({
      gameId: gamesTable.gameId,
      season: gamesTable.season,
      week: gamesTable.week,
      kickoffTime: gamesTable.kickoffTime,
      gameStatus: gamesTable.gameStatus,
      homeTeamId: gamesTable.homeTeamId,
      awayTeamId: gamesTable.awayTeamId,
    }).from(gamesTable).where(gte(gamesTable.season, 2026)),
    db.select({
      playerId: playersTable.playerId,
      teamId: playersTable.teamId,
      position: playersTable.position,
      activeStatus: playersTable.activeStatus,
      sourceUpdatedAt: playersTable.sourceUpdatedAt,
    }).from(playersTable).where(inArray(playersTable.position, ["QB", "RB", "WR", "TE"])),
    db.select({ playerId: playersTable.playerId }).from(playersTable),
    db.select({
      gsisId: nflversePlayerIdentitiesTable.gsisId,
      espnId: nflversePlayerIdentitiesTable.espnId,
      observedAt: nflversePlayerIdentitiesTable.observedAt,
    }).from(nflversePlayerIdentitiesTable),
    db.select({
      playerId: playerGameStatsTable.playerId,
      season: playerGameStatsTable.season,
      week: playerGameStatsTable.week,
      seasonType: playerGameStatsTable.seasonType,
      opponentTeamId: playerGameStatsTable.opponentTeamId,
    }).from(playerGameStatsTable).where(and(
      gte(playerGameStatsTable.season, 2021),
      lte(playerGameStatsTable.season, 2026),
      eq(playerGameStatsTable.seasonType, "REG"),
      inArray(playerGameStatsTable.position, ["QB", "RB", "WR", "TE"]),
    )),
    db.select({
      playerId: injuriesTable.playerId,
      teamId: injuriesTable.teamId,
      gameStatus: injuriesTable.gameStatus,
      sourceUpdatedAt: injuriesTable.sourceUpdatedAt,
      snapshotTimestamp: injuriesTable.snapshotTimestamp,
    }).from(injuriesTable).orderBy(desc(injuriesTable.snapshotTimestamp), desc(injuriesTable.id)),
    db.select({
      playerId: depthChartSnapshotsTable.playerId,
      teamId: depthChartSnapshotsTable.teamId,
      starter: depthChartSnapshotsTable.starter,
      snapshotTimestamp: depthChartSnapshotsTable.snapshotTimestamp,
    }).from(depthChartSnapshotsTable).orderBy(desc(depthChartSnapshotsTable.snapshotTimestamp)),
    db.select({
      completedAt: nflverseSourceFilesTable.completedAt,
    }).from(nflverseSourceFilesTable)
      .where(and(eq(nflverseSourceFilesTable.dataset, "player_stats"), gte(nflverseSourceFilesTable.season, 2026)))
      .orderBy(desc(nflverseSourceFilesTable.completedAt)),
  ]);
  const latestStatImport = playerStatSources.find((source) => source.completedAt)?.completedAt ?? null;
  // Touch team data in the same read-only audit to ensure schedule team IDs can
  // be verified against persisted canonical teams; missing rows fail closed.
  const teamRows = await db.select({ teamId: teamsTable.teamId }).from(teamsTable);
  const knownTeams = new Set(teamRows.map((team) => team.teamId));
  const verifiedGames = (games as ReadinessGame[]).filter((game) =>
    knownTeams.has(game.homeTeamId) && knownTeams.has(game.awayTeamId));
  return buildUpcomingPlayerReadinessAudit({
    asOf,
    games: verifiedGames,
    players,
    identities,
    stats,
    injuries,
    depthCharts,
    playerStatsIngestedAt: latestStatImport,
    allPlayerIds: allPlayerRows.map((player) => player.playerId),
    // The current change-only tables do not preserve a complete as-of roster
    // observation, even when a sync successfully fetched unchanged rows.
  });
}

export function renderUpcomingPlayerReadinessMarkdown(report: UpcomingReadinessResponse) {
  const { sourceFreshness, eligibility } = report;
  const rows = Object.entries(sourceFreshness).map(([source, item]) =>
    `| ${source} | ${item.latestSourceUpdatedAt ?? "not recorded"} | ${item.ageHours === null ? "unknown" : item.ageHours.toFixed(1)} | ${item.status} |`);
  const reasons = Object.entries(eligibility.reasons).sort(([a], [b]) => a.localeCompare(b));
  return [
    "# Upcoming Player Forecast Readiness",
    "",
    `**Status:** ${report.status} — no forecasts generated`,
    `**Audit as of:** ${report.asOf ?? "not available"}`,
    `**Nearest upcoming regular-season week games:** ${report.upcomingGames}`,
    "",
    report.message,
    "",
    "## Why the audit is scoped to one week",
    "",
    "The audit uses only the nearest future regular-season week with verified scheduled kickoff times. It deliberately does not describe later weeks: player team assignments, participation, injuries, and starter roles can change before those games, so extending eligibility claims to far-future schedule rows would overstate what current evidence supports.",
    "",
    "## Source freshness",
    "",
    "| Source | Latest timestamp | Age (hours) | Timestamp meaning / status |",
    "|---|---|---:|---|",
    ...rows,
    "",
    "Roster freshness is unavailable because no complete timestamped player/team observation is retained. The latest persisted row-change time in the census is not the last provider check and cannot prove assignments were stale or fresh. Injury `source_updated_at` is also change-only and may contain a provider payload time or synchronization fallback; it does not prove the latest successful check. Player-stat source-file completion time represents import ingestion, not independently verified NFLverse publication time.",
    "",
    "## Candidate eligibility",
    "",
    `| Eligible | Uncertain | Excluded |`,
    `|---:|---:|---:|`,
    `| ${eligibility.eligible} | ${eligibility.uncertain} | ${eligibility.excluded} |`,
    "",
    reasons.length
      ? ["| Reason | Count |", "|---|---:|", ...reasons.map(([reason, count]) => `| ${reason} | ${count} |`)].join("\n")
      : "No candidate classification reasons were recorded.",
    "",
    "Player identity evidence is joined as latest nflverse `gsis_id` → `espn_id` → `players.player_id`. Player statistics contribute to the prior-appearance eligibility count only when the regular-season week is strictly earlier than the target week (or the season is earlier); same-week rows are withheld. Current roster team assignment, rather than historical stat team, is used to join a player to the upcoming slate, so transferred players are not carried forward under an old team.",
    "",
    "## Readiness decision",
    "",
    report.blockers.length ? report.blockers.map((blocker) => `- **Critical blocker:** ${blocker}`).join("\n") : "- No critical roster freshness blocker was measured.",
    "- This endpoint and report are read-only; no synchronization, persistence, model fitting, or forecast generation occurs.",
    "- Historical observed outcomes are used only to count prior appearances when their season/week strictly precedes the target. No future-week statistic or upcoming-game outcome is used.",
    "",
  ].join("\n");
}