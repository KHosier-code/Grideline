import { buildDefenseVsPosition, METRICS, METRIC_LABELS, type DefenseInputs, type Position, type Window } from "./defense-vs-position";
import { buildUsageTeamMappings } from "../routes/consumer";

export const MATCHUP_SCORE_VERSION = "position-context-descriptive-v1";
export function attachQualifiedScoringTdProbability<T extends ReturnType<typeof buildPlayerPositionMatchup>>(
  matchup: T,
  report: { status: string; blockers?: string[]; forecasts: Array<{
    gameId: string; playerId: string; teamId: string; opponentTeamId: string;
    probability: number; modelVersion: string; cutoffAt: string;
  }> },
): T {
  if (!matchup?.selected) return matchup;
  const row = report.status === "forecasts" ? report.forecasts.find(f => f.gameId === matchup.gameId
    && f.playerId === matchup.selected!.playerId && f.teamId === matchup.selected!.team
    && f.opponentTeamId === matchup.selected!.opponent
    && Number.isFinite(f.probability) && f.probability >= 0 && f.probability <= 1
    && new Date(f.cutoffAt).getTime() <= new Date(matchup.asOf).getTime()
    && new Date(f.cutoffAt).getTime() < new Date(matchup.cutoff).getTime()) : undefined;
  const td = matchup.projections.scoringTdProbability;
  if (row && td) Object.assign(td, { value: row.probability, kind: "probability", modelVersion: row.modelVersion,
    cutoffAt: row.cutoffAt, quality: "Separately qualified weekly scoring-TD model", reason: null });
  else if (td && report.blockers?.length) td.reason = report.blockers[0]!;
  return matchup;
}
const DISPLAY: Record<Position, string[]> = {
  QB: ["attempts", "passingYards", "passingTds", "rushingYards", "rushingTds"],
  RB: ["carries", "rushingYards", "rushingTds", "targets", "receptions", "receivingYards", "receivingTds"],
  WR: ["targets", "receptions", "receivingYards", "receivingTds"],
  TE: ["targets", "receptions", "receivingYards", "receivingTds"],
};
type Game = DefenseInputs["games"][number];

/** The history is grouped by verified schedule game, then by GSIS player and
 * offense. No absent stat line is converted to a zero or a roster assertion. */
export function buildPlayerPositionMatchup(input: DefenseInputs, game: Game, now: Date, position: Position, window: Exclude<Window, "last2Weeks">, selectedId?: string) {
  if (!game.kickoffTime || game.kickoffTime <= now || game.week < 1 || game.week > 18
    || !/scheduled|pregame/i.test(game.gameStatus)) {
    return null;
  }
  const cutoff = game.kickoffTime;
  const maps = buildUsageTeamMappings(input.teams);
  const home = maps.canonical(game.homeTeamId);
  const away = maps.canonical(game.awayTeamId);
  if (!home || !away || home === away) return null;
  const schedules = input.games.filter((row) => row.season === game.season && row.week >= 1 && row.week <= 18
    && row.gameId !== game.gameId && row.gameStatus === "STATUS_FINAL"
    && row.kickoffTime && row.kickoffTime < now)
    .sort((a, b) => a.kickoffTime!.getTime() - b.kickoffTime!.getTime() || a.gameId.localeCompare(b.gameId));
  const byKey = new Map<string, Game[]>();
  for (const row of schedules) {
    const a = maps.canonical(row.homeTeamId), b = maps.canonical(row.awayTeamId);
    if (!a || !b || a === b) continue;
    for (const [team, opponent] of [[a, b], [b, a]]) {
      const key = `${row.week}:${team}:${opponent}`;
      byKey.set(key, [...(byKey.get(key) ?? []), row]);
    }
  }
  const statsSource = input.sources.some((s) => s.season === game.season && s.dataset === "player_stats" && s.status === "success");
  const histories = new Map<string, Array<{ row: DefenseInputs["stats"][number]; game: Game; team: string }>>();
  if (statsSource) for (const row of input.stats) {
    if (row.season !== game.season || row.seasonType.toUpperCase() !== "REG"
      || row.position?.toUpperCase() !== position || !row.playerId
      || !(row.sourceUpdatedAt instanceof Date) || row.sourceUpdatedAt > now) continue;
    const team = maps.canonical(row.teamId), opponent = maps.canonical(row.opponentTeamId);
    if (!team || !opponent || ![home, away].includes(team)) continue;
    const matches = byKey.get(`${row.week}:${team}:${opponent}`) ?? [];
    if (matches.length !== 1) continue;
    const key = `${row.playerId}:${team}`;
    const previous = histories.get(key) ?? [];
    if (!previous.some((item) => item.game.gameId === matches[0]!.gameId)) {
      histories.set(key, [...previous, { row, game: matches[0]!, team }]);
    }
  }
  const defense = buildDefenseVsPosition(input, game.season, now, game.gameId, window);
  const candidates = [...histories.entries()].map(([key, unsorted]) => {
    const appearances = [...unsorted].sort((a, b) => a.game.kickoffTime!.getTime() - b.game.kickoffTime!.getTime());
    const [playerId, team] = [appearances[0]!.row.playerId, appearances[0]!.team];
    const opponent = team === home ? away : home;
    return { playerId, playerName: appearances.at(-1)!.row.playerName, team, opponent, position,
      appearances: appearances.length, key };
  }).sort((a, b) => b.appearances - a.appearances || a.playerId.localeCompare(b.playerId)).slice(0, 80);
  const selected = candidates.find((p) => p.key === selectedId);
  const history = selected ? histories.get(selected.key)! : [];
  const teamGames = selected ? schedules.filter((row) =>
    maps.canonical(row.homeTeamId) === selected.team || maps.canonical(row.awayTeamId) === selected.team) : [];
  const selectedTeamGames = window === "season" ? teamGames : teamGames.slice(-Number(window.slice(4)));
  const chosen = history.filter((item) => selectedTeamGames.some((g) => g.gameId === item.game.gameId));
  const metricData = selected ? Object.fromEntries(DISPLAY[position].map((name) => {
    const valid = chosen.filter(({ row }) => typeof row[name as keyof typeof row] === "number"
      && Number.isFinite(row[name as keyof typeof row]));
    const total = valid.length ? valid.reduce((sum, { row }) => sum + Number(row[name as keyof typeof row]), 0) : null;
    const opponentRow = defense.defenses.find((d) => d.abbreviation === selected.opponent);
    return [name, {
      label: METRIC_LABELS[name], player: {
        total, perGame: total === null ? null : total / valid.length,
        coveredGames: valid.length, requestedGames: selectedTeamGames.length,
        coveredWeeks: valid.map(({ game: g }) => g.week),
        missingWeeks: selectedTeamGames.filter((g) => !valid.some((v) => v.game.gameId === g.gameId)).map((g) => g.week),
        reason: valid.length ? null : "No verified player appearance with this statistic in the selected team-game window",
      },
      defense: opponentRow?.positions[position]?.[name] ?? null,
    }];
  })) : {};
  const primary = position === "QB" ? "passingYards" : position === "RB" ? "rushingYards" : "receivingYards";
  const role = position === "QB" ? "attempts" : position === "RB" ? "carries" : "targets";
  const playerYards = metricData[primary]?.player;
  const playerRole = metricData[role]?.player;
  const opponentYards = metricData[primary]?.defense;
  const sufficient = Boolean(playerYards && playerRole && opponentYards
    && playerYards.perGame !== null && playerRole.perGame !== null
    && opponentYards.perGame !== null && playerYards.coveredGames >= 3
    && playerRole.coveredGames >= 3 && opponentYards.coveredGames >= 3
    && playerYards.coveredGames / Math.max(1, playerYards.requestedGames) >= 0.75
    && playerRole.coveredGames / Math.max(1, playerRole.requestedGames) >= 0.75
    && opponentYards.coveredGames / Math.max(1, opponentYards.completedGames) >= 0.75);
  // This is a centered, bounded comparison index, NOT a trained predictor:
  // the defense contribution is a shrunk position-total context, never a
  // player-level estimate. Its 20% cap avoids amplifying small samples.
  const roleMean = playerRole?.perGame ?? null;
  const yardMean = playerYards?.perGame ?? null;
  const allowance = opponentYards?.perGame ?? null;
  const defenseAdjustment = sufficient && allowance !== null
    ? Math.max(-0.2, Math.min(0.2, (allowance / Math.max(1, allowance + yardMean!) - 0.5)
      * 2 * 0.2 * opponentYards!.coveredGames / (opponentYards!.coveredGames + 5))) : null;
  const score = sufficient ? Math.round(Math.max(0, Math.min(100,
    50 + 20 * (yardMean! / Math.max(1, yardMean! + roleMean!) - 0.5) + 100 * defenseAdjustment!))) : null;
  return {
    status: selected ? "selected" : "empty", season: game.season, week: game.week, gameId: game.gameId,
    cutoff: cutoff.toISOString(), asOf: now.toISOString(), window, position, candidates: candidates.map(({ key, ...p }) => ({ ...p, selectionKey: key })),
    selected: selected ? { selectionKey: selected.key, playerId: selected.playerId, playerName: selected.playerName, team: selected.team,
      opponent: selected.opponent, position, appearances: history.length } : null,
    metrics: metricData, source: defense.source, sourceUpdatedAt: defense.sourceUpdatedAt, ingestedAt: defense.ingestedAt,
    score: { version: MATCHUP_SCORE_VERSION, value: score, kind: "descriptive_index",
      direction: "Higher means stronger observed player production with a modest, shrunk position-level allowance context; not a predicted result.",
      ingredients: { roleMetric: role, rolePerAppearance: roleMean, yardMetric: primary,
        yardsPerAppearance: yardMean, opponentPositionYardsPerGame: allowance,
        defenseAdjustment, playerAppearances: playerYards?.coveredGames ?? 0,
        defenseGames: opponentYards?.coveredGames ?? 0 },
      reason: score === null ? "Needs at least three covered player appearances and three opponent defensive games, each with at least 75% metric coverage of its team-game window." : null },
    projections: Object.fromEntries([...new Set([...DISPLAY[position], "scoringTdProbability"])].map((metric) => [
      metric, { value: null, kind: metric === "scoringTdProbability" ? "probability" : "expected_count",
        modelVersion: null, cutoffAt: null, quality: null,
        recentAverage: metricData[metric]?.player?.perGame ?? null, leaguePositionBaseline: null,
        reason: metric === "scoringTdProbability"
          ? "The separate weekly scoring-TD forecast is not qualified for this player and game."
          : "No independently approved, point-in-time pregame model and availability evidence for this statistic." },
    ])),
    note: "Player averages divide by verified appearances; defensive position allowances divide by covered defensive team-games. Missing player rows are not zeroes. Historical imports are mutable and do not establish source publication before old kickoffs. This does not confirm active, healthy or starting status.",
  };
}