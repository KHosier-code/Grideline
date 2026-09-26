import { and, eq, inArray, lte, or, sql, type SQLWrapper } from "drizzle-orm";
import {
  db, gamesTable, nflverseSourceFilesTable, playerGameStatsTable,
  redZonePlayerGameFactsTable, redZoneTeamGameFactsTable, teamsTable,
} from "@workspace/db";
import { buildUsageTeamMappings, usageSeasonAtCutoff } from "../routes/consumer";

export const POSITIONS = ["QB", "RB", "WR", "TE"] as const;
export const WINDOWS = ["season", "last3", "last5"] as const;
export type Position = typeof POSITIONS[number];
export type Window = typeof WINDOWS[number];
export const METRICS: Record<Position, string[]> = {
  QB: ["attempts", "passingYards", "passingTds", "interceptions", "rushingYards", "rushingTds"],
  RB: ["carries", "rushingYards", "rushingTds", "targets", "receptions", "receivingYards", "receivingTds", "rz20Carries", "rz10Carries", "rz20Targets", "rz10Targets"],
  WR: ["targets", "receptions", "receivingYards", "receivingTds", "rz20Targets", "rz10Targets"],
  TE: ["targets", "receptions", "receivingYards", "receivingTds", "rz20Targets", "rz10Targets"],
};
export const METRIC_LABELS: Record<string, string> = {
  attempts: "Pass attempts", passingYards: "Passing yards", passingTds: "Passing TDs",
  interceptions: "Interceptions", rushingYards: "Rushing yards", rushingTds: "Rushing TDs",
  carries: "Carries", targets: "Targets", receptions: "Receptions",
  receivingYards: "Receiving yards", receivingTds: "Receiving TDs",
  rz20Carries: "Inside 20 carries", rz10Carries: "Inside 10 carries",
  rz20Targets: "Inside 20 targets", rz10Targets: "Inside 10 targets",
};

type Game = { gameId: string; season: number; week: number; kickoffTime: Date | null; gameStatus: string; homeTeamId: string; awayTeamId: string };
type Stat = typeof playerGameStatsTable.$inferSelect;
type RzPlayer = typeof redZonePlayerGameFactsTable.$inferSelect;
type RzTeam = typeof redZoneTeamGameFactsTable.$inferSelect;
type Source = typeof nflverseSourceFilesTable.$inferSelect;
export type DefenseInputs = {
  games: Game[]; stats: Stat[]; rzPlayers: RzPlayer[]; rzTeams: RzTeam[];
  sources: Source[]; teams: Array<{ teamId: string; abbreviation: string }>;
};

/** A covered game requires a completed schedule, both PBP team rows, a successful
 * weekly-stat import, and player-stat evidence for both offenses. A null field
 * on any matching position player makes that metric unavailable for that game. */
export function buildDefenseVsPosition(input: DefenseInputs, season: number, cutoff: Date, excludedGameId?: string, window: Window = "season") {
  const maps = buildUsageTeamMappings(input.teams);
  const eligible = input.games.filter((g) => g.season === season && g.week <= 18
    && g.gameStatus === "STATUS_FINAL" && g.kickoffTime && g.kickoffTime < cutoff && g.gameId !== excludedGameId)
    .sort((a, b) => a.kickoffTime!.getTime() - b.kickoffTime!.getTime() || a.gameId.localeCompare(b.gameId));
  const sourceOk = (dataset: string) => input.sources.some((s) => s.dataset === dataset && s.season === season && s.status === "success");
  const statSource = sourceOk("player_stats");
  const pbpSource = sourceOk("pbp");
  const byMatchup = new Map<string, { game: Game; offense: string; defense: string }>();
  const schedules = new Map<string, Game[]>();
  for (const game of eligible) {
    const home = maps.canonical(game.homeTeamId);
    const away = maps.canonical(game.awayTeamId);
    if (!home || !away || home === away) continue;
    for (const [offense, defense] of [[home, away], [away, home]]) {
      byMatchup.set(`${season}:${game.week}:${offense}:${defense}`, { game, offense, defense });
      schedules.set(defense, [...(schedules.get(defense) ?? []), game]);
    }
  }
  const stats = new Map<string, Stat[]>();
  for (const row of input.stats) {
    if (row.season !== season || row.seasonType.toUpperCase() !== "REG" || !row.playerId
      || row.sourceUpdatedAt >= cutoff) continue;
    const offense = maps.canonical(row.teamId), defense = maps.canonical(row.opponentTeamId);
    const match = byMatchup.get(`${season}:${row.week}:${offense}:${defense}`);
    if (!match) continue;
    const key = `${match.game.gameId}:${offense}`;
    const existing = stats.get(key) ?? [];
    // The source uniqueness key includes opponent; protect against alias duplicates.
    if (!existing.some((item) => item.playerId === row.playerId)) stats.set(key, [...existing, row]);
  }
  const rzTeam = new Set(input.rzTeams.filter((r) => {
    const offense = maps.canonical(r.teamId), defense = maps.canonical(r.opponentTeamId);
    return r.season === season && r.seasonType === "REG" && r.ingestedAt < cutoff
      && byMatchup.get(`${season}:${r.week}:${offense}:${defense}`)?.game.gameId === r.gameId;
  }).map((r) => `${r.gameId}:${maps.canonical(r.teamId)}:${r.zone}`));
  const rzPlayers = new Map<string, RzPlayer[]>();
  for (const fact of input.rzPlayers) {
    if (fact.season !== season || fact.seasonType !== "REG" || fact.ingestedAt >= cutoff) continue;
    const key = `${fact.gameId}:${maps.canonical(fact.teamId)}:${fact.zone}`;
    rzPlayers.set(key, [...(rzPlayers.get(key) ?? []), fact]);
  }
  const results = input.teams.map((team) => {
    const defense = maps.canonical(team.teamId)!;
    const allGames = schedules.get(defense) ?? [];
    const positions = Object.fromEntries(POSITIONS.map((position) => {
      const metrics = Object.fromEntries(METRICS[position].map((name) => {
        const covered = allGames.flatMap((game) => {
          const offense = maps.canonical(game.homeTeamId) === defense
            ? maps.canonical(game.awayTeamId)! : maps.canonical(game.homeTeamId)!;
          const key = `${game.gameId}:${offense}`;
          // PBP team_game_stats uses nflverse's source game ID, whereas the
          // derived red-zone team facts retain the verified ESPN game ID.
          const bothPbp = rzTeam.has(`${game.gameId}:${offense}:20`)
            && rzTeam.has(`${game.gameId}:${defense}:20`);
          const bothStats = (stats.get(key)?.length ?? 0) > 0 && (stats.get(`${game.gameId}:${defense}`)?.length ?? 0) > 0;
          if (!pbpSource || !statSource || !bothPbp || !bothStats) return [];
          const offenseRows = stats.get(key) ?? [];
          const participants = offenseRows.filter((row) => row.position?.toUpperCase() === position);
          // A complete PBP game does not establish that a missing position's
          // weekly player rows were delivered. Only actual identified position
          // rows can certify an observed zero; ambiguous identities can hide a
          // participant, so fail closed for this position in that game.
          if (!participants.length || offenseRows.some((row) => !row.position?.trim())) return [];
          let value: number;
          if (name.startsWith("rz")) {
            const zone = name.includes("10") ? 10 : 20;
            const rzKey = `${game.gameId}:${offense}:${zone}`;
            if (!rzTeam.has(rzKey) || !rzTeam.has(`${game.gameId}:${defense}:${zone}`)) return [];
            const facts = rzPlayers.get(rzKey) ?? [];
            if (facts.some((fact) => !fact.position)) return [];
            value = facts.filter((fact) => fact.position?.toUpperCase() === position)
              .reduce((total, fact) => total + (name.endsWith("Carries") ? fact.carries : fact.targets), 0);
          } else {
            if (participants.some((row) => row[name as keyof Stat] === null)) return [];
            value = participants.reduce((total, row) => total + Number(row[name as keyof Stat] ?? 0), 0);
          }
          return [{ gameId: game.gameId, week: game.week, value }];
        });
        const selected = window === "season" ? covered : covered.slice(-Number(window.slice(4)));
        const selectedIds = new Set(selected.map((g) => g.gameId));
        const firstSelected = selected[0] && allGames.find((g) => g.gameId === selected[0].gameId);
        const missing = allGames.filter((g) => !selectedIds.has(g.gameId) &&
          (window === "season" || !firstSelected || g.kickoffTime! >= firstSelected.kickoffTime!));
        return [name, {
          label: METRIC_LABELS[name], unit: name.toLowerCase().includes("yards") ? "yards" : "count",
          perGame: selected.length ? selected.reduce((sum, g) => sum + g.value, 0) / selected.length : null,
          total: selected.length ? selected.reduce((sum, g) => sum + g.value, 0) : null,
          coveredGames: selected.length, coveredWeeks: selected.map((g) => g.week),
          missingWeeks: missing.map((g) => g.week), missingGames: missing.map((g) => g.gameId),
          completedGames: allGames.length,
          reason: !selected.length ? (statSource && pbpSource ? "No completed defensive game has verified metric coverage" : "Weekly stats or PBP source import is unavailable") : missing.length ? "Some completed games lack metric-specific coverage" : null,
        }];
      }));
      return [position, metrics];
    }));
    return { teamId: team.teamId, abbreviation: team.abbreviation, positions };
  });
  const latest = (values: Array<Date | null | undefined>) => values.filter((v): v is Date => v instanceof Date)
    .sort((a, b) => b.getTime() - a.getTime())[0]?.toISOString() ?? null;
  return {
    season, seasonType: "REG", window, cutoff: cutoff.toISOString(),
    source: "NFLverse weekly player stats; NFLverse PBP for game verification and red-zone opportunities; ESPN final schedule",
    sourceUpdatedAt: null,
    ingestedAt: latest([...input.stats.map((r) => r.sourceUpdatedAt), ...input.rzTeams.map((r) => r.ingestedAt)]),
    note: "Observed history, not a player forecast. Rows ingested at or after the displayed cutoff are excluded; older source revisions are not retained, so historical samples may be unavailable after a later reimport. Small samples are descriptive only. Missing injury entries do not confirm health or starting status.",
    unsupported: {
      airYards: "Not retained in player-game stats", routes: "No verified route assignments",
      efficiency: "Position-level play attribution is not verified", namedCoverage: "No verified defender assignment",
    },
    defenses: results,
  };
}

// Short-lived cache. The lightweight fingerprint reads are repeated on every
// request; a changed final game or reimport invalidates the batched result.
let cache: { key: string; data: DefenseInputs } | null = null;
export async function readDefenseInputs(season: number, cutoff: Date): Promise<DefenseInputs> {
  const [games, teams, sources, statRevision, rzRevision, rzPlayerRevision] = await Promise.all([
    db.select().from(gamesTable).where(and(eq(gamesTable.season, season), lte(gamesTable.kickoffTime, cutoff))),
    db.select({ teamId: teamsTable.teamId, abbreviation: teamsTable.abbreviation }).from(teamsTable),
    db.select().from(nflverseSourceFilesTable).where(eq(nflverseSourceFilesTable.season, season)),
    db.select({ count: sql<number>`count(*)`, revision: sql<string | null>`max(source_updated_at)` })
      .from(playerGameStatsTable).where(eq(playerGameStatsTable.season, season)),
    db.select({ count: sql<number>`count(*)`, revision: sql<string | null>`max(ingested_at)` })
      .from(redZoneTeamGameFactsTable).where(eq(redZoneTeamGameFactsTable.season, season)),
    db.select({ count: sql<number>`count(*)`, revision: sql<string | null>`max(ingested_at)` })
      .from(redZonePlayerGameFactsTable).where(eq(redZonePlayerGameFactsTable.season, season)),
  ]);
  const key = JSON.stringify([
    season, games.map((g) => [g.gameId, g.gameStatus, g.sourceUpdatedAt?.getTime()]),
    sources.map((s) => [s.dataset, s.status, s.completedAt?.getTime()]),
    statRevision, rzRevision, rzPlayerRevision,
  ]);
  if (cache?.key === key) return cache.data;
  const [stats, rzPlayers, rzTeams] = await Promise.all([
    db.select().from(playerGameStatsTable).where(eq(playerGameStatsTable.season, season)),
    db.select().from(redZonePlayerGameFactsTable).where(eq(redZonePlayerGameFactsTable.season, season)),
    db.select().from(redZoneTeamGameFactsTable).where(eq(redZoneTeamGameFactsTable.season, season)),
  ]);
  const data = { games, teams, sources, stats, rzPlayers, rzTeams };
  cache = { key, data };
  return data;
}

/** Only teams in the selected matchup can appear in the player's history or
 * the two opposing defensive histories. Include every source alias for those
 * teams, then let the builders verify the exact schedule opponent and week.
 * In particular, do not filter out null-position rows: they invalidate
 * position coverage for an otherwise complete defensive team-game. */
export async function readMatchupDefenseInputs(
  season: number, cutoff: Date, homeTeamId: string, awayTeamId: string,
): Promise<DefenseInputs> {
  const [games, teams, sources] = await Promise.all([
    db.select().from(gamesTable).where(and(eq(gamesTable.season, season), lte(gamesTable.kickoffTime, cutoff))),
    db.select({ teamId: teamsTable.teamId, abbreviation: teamsTable.abbreviation }).from(teamsTable),
    db.select().from(nflverseSourceFilesTable).where(eq(nflverseSourceFilesTable.season, season)),
  ]);
  const maps = buildUsageTeamMappings(teams);
  const selected = new Set([maps.canonical(homeTeamId), maps.canonical(awayTeamId)]);
  if (selected.size !== 2 || selected.has(null)) {
    return { games, teams, sources, stats: [], rzPlayers: [], rzTeams: [] };
  }
  const aliases = [...new Set([
    ...[homeTeamId, awayTeamId],
    ...teams.filter((team) => selected.has(maps.canonical(team.teamId))).map((team) => team.teamId),
    ...[...maps.sourceToAbbreviation].filter(([, canonical]) => selected.has(canonical)).map(([alias]) => alias),
  ].map((alias) => alias.trim().toUpperCase()))];
  // Source spellings are not guaranteed to be uppercase. Normalizing in SQL
  // matches buildUsageTeamMappings without assuming an import's casing.
  const teamMatch = (column: SQLWrapper) =>
    inArray(sql<string>`upper(trim(${column}))`, aliases);
  const [stats, rzPlayers, rzTeams] = await Promise.all([
    db.select().from(playerGameStatsTable).where(and(
      eq(playerGameStatsTable.season, season),
      or(teamMatch(playerGameStatsTable.teamId), teamMatch(playerGameStatsTable.opponentTeamId)),
    )),
    db.select().from(redZonePlayerGameFactsTable).where(and(
      eq(redZonePlayerGameFactsTable.season, season),
      or(teamMatch(redZonePlayerGameFactsTable.teamId), teamMatch(redZonePlayerGameFactsTable.opponentTeamId)),
    )),
    db.select().from(redZoneTeamGameFactsTable).where(and(
      eq(redZoneTeamGameFactsTable.season, season),
      or(teamMatch(redZoneTeamGameFactsTable.teamId), teamMatch(redZoneTeamGameFactsTable.opponentTeamId)),
    )),
  ]);
  return { games, teams, sources, stats, rzPlayers, rzTeams };
}

export function defaultDefenseSeason() { return usageSeasonAtCutoff(new Date()); }