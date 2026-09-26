import { buildUsageTeamMappings } from "../routes/consumer";
import type { DefenseInputs, Position } from "./defense-vs-position";

export const EVALUATION_VERSION = "player-position-forward-research-v1";
const METRICS: Record<Position, string[]> = {
  QB: ["attempts", "passingYards"], RB: ["carries", "rushingYards", "targets", "receivingYards"],
  WR: ["targets", "receivingYards"], TE: ["targets", "receivingYards"],
};
type Example = { season: number; week: number; position: Position; metric: string; actual: number; player: number;
  league: number; defense: number | null; coveredDefenseGames: number };
const mae = (rows: Array<{ actual: number; estimate: number }>) =>
  rows.length ? rows.reduce((sum, row) => sum + Math.abs(row.actual - row.estimate), 0) / rows.length : null;
const estimate = (row: Example, weight: number) => Math.max(0, row.player
  * (1 + Math.max(-0.25, Math.min(0.25, weight * ((row.defense ?? row.league) / Math.max(1, row.league) - 1)
    * row.coveredDefenseGames / (row.coveredDefenseGames + 5)))));

/** Reconstructed football-time backtest; never claims that overwritten source
 * rows were already published before their historical kickoff. Train on one
 * season, score the next, and report an ablation on the identical cohort. */
export function evaluatePlayerPositionMatchups(inputs: DefenseInputs[], trainSeason: number, holdoutSeason: number) {
  const teams = inputs[0]?.teams ?? [];
  const maps = buildUsageTeamMappings(teams);
  const examples: Example[] = [];
  const missing = { unreconciledRows: 0, partialDefensiveGames: 0, insufficientPlayerHistory: 0 };
  for (const input of inputs) {
    const statSource = input.sources.some(s => s.dataset === "player_stats" && s.status === "success");
    const pbpSource = input.sources.some(s => s.dataset === "pbp" && s.status === "success");
    const games = input.games.filter(g => [trainSeason, holdoutSeason].includes(g.season)
      && g.gameStatus === "STATUS_FINAL" && g.week >= 1 && g.week <= 18 && g.kickoffTime)
      .sort((a, b) => a.kickoffTime!.getTime() - b.kickoffTime!.getTime() || a.gameId.localeCompare(b.gameId));
    const byMatch = new Map<string, string[]>();
    for (const g of games) {
      const home = maps.canonical(g.homeTeamId), away = maps.canonical(g.awayTeamId);
      if (!home || !away || home === away) continue;
      for (const [team, opponent] of [[home, away], [away, home]]) {
        const key = `${g.season}:${g.week}:${team}:${opponent}`;
        byMatch.set(key, [...(byMatch.get(key) ?? []), g.gameId]);
      }
    }
    const gameById = new Map(games.map(g => [g.gameId, g]));
    const rows = input.stats.flatMap(row => {
      const position = row.position?.toUpperCase() as Position;
      if (row.seasonType.toUpperCase() !== "REG" || !METRICS[position] || !row.playerId) return [];
      const team = maps.canonical(row.teamId), opponent = maps.canonical(row.opponentTeamId);
      const ids = byMatch.get(`${row.season}:${row.week}:${team}:${opponent}`) ?? [];
      if (ids.length !== 1) { missing.unreconciledRows++; return []; }
      return [{ row, team: team!, opponent: opponent!, game: gameById.get(ids[0]!)!, position }];
    }).sort((a, b) => a.game.kickoffTime!.getTime() - b.game.kickoffTime!.getTime());
    const prior = new Map<string, typeof rows>();
    const league = new Map<string, number[]>();
    const defense = new Map<string, number[]>();
    // Process whole kickoff batches so simultaneous matchups cannot observe
    // one another's target-game results, even when source rows are unordered.
    const batches = new Map<number, typeof rows>();
    for (const item of rows) {
      const time = item.game.kickoffTime!.getTime();
      batches.set(time, [...(batches.get(time) ?? []), item]);
    }
    for (const batch of batches.values()) {
      for (const item of batch) {
        const playerKey = `${item.row.playerId}:${item.team}`;
        const history = prior.get(playerKey) ?? [];
        for (const metric of METRICS[item.position]) {
          const actual = item.row[metric as keyof typeof item.row];
          const values = history.slice(-5).map(h => h.row[metric as keyof typeof h.row])
            .filter((v): v is number => typeof v === "number" && Number.isFinite(v));
          const baseline = league.get(`${item.position}:${metric}`) ?? [];
          if (typeof actual !== "number" || !Number.isFinite(actual)) continue;
          if (values.length < 3 || baseline.length < 20) { missing.insufficientPlayerHistory++; continue; }
          const defensive = defense.get(`${item.opponent}:${item.position}:${metric}`) ?? [];
          if (defensive.length < 3) missing.partialDefensiveGames++;
          examples.push({ season: item.game.season, week: item.game.week, position: item.position, metric, actual,
            player: values.reduce((a, b) => a + b, 0) / values.length,
            league: baseline.reduce((a, b) => a + b, 0) / baseline.length,
            defense: defensive.length >= 3 ? defensive.reduce((a, b) => a + b, 0) / defensive.length : null,
            coveredDefenseGames: defensive.length });
        }
      }
      const gamePosition = new Map<string, { gameId: string; opponent: string; position: Position; metric: string; values: number[] }>();
      for (const item of batch) {
        const key = `${item.row.playerId}:${item.team}`;
        prior.set(key, [...(prior.get(key) ?? []), item]);
        for (const metric of METRICS[item.position]) {
          const value = item.row[metric as keyof typeof item.row];
          if (typeof value !== "number" || !Number.isFinite(value)) continue;
          league.set(`${item.position}:${metric}`, [...(league.get(`${item.position}:${metric}`) ?? []), value]);
          const id = `${item.game.gameId}:${item.team}:${item.position}:${metric}`;
          const entry = gamePosition.get(id) ?? { gameId: item.game.gameId, opponent: item.opponent,
            position: item.position, metric, values: [] };
          entry.values.push(value);
          gamePosition.set(id, entry);
        }
      }
      for (const entry of gamePosition.values()) {
        const game = gameById.get(entry.gameId)!;
        const a = maps.canonical(game.homeTeamId), b = maps.canonical(game.awayTeamId);
        const bothPbp = [a, b].every(team => input.rzTeams.some(f => f.gameId === entry.gameId
          && f.zone === 20 && maps.canonical(f.teamId) === team));
        const offenseRows = batch.filter(item => item.game.gameId === entry.gameId
          && item.team !== entry.opponent);
        const participants = offenseRows.filter(item => item.position === entry.position);
        if (!statSource || !pbpSource || !bothPbp || !participants.length
          || participants.some(item => item.row[entry.metric as keyof typeof item.row] == null)) continue;
        const key = `${entry.opponent}:${entry.position}:${entry.metric}`;
        defense.set(key, [...(defense.get(key) ?? []), entry.values.reduce((a, b) => a + b, 0)]);
      }
    }
  }
  const metrics = Object.fromEntries((["QB", "RB", "WR", "TE"] as Position[]).flatMap(position =>
    METRICS[position].map(metric => {
      const trainAll = examples.filter(row => row.season === trainSeason
        && (trainSeason !== holdoutSeason || row.week <= 9) && row.position === position && row.metric === metric);
      const train = trainAll.filter(row => row.defense !== null);
      const choices = [0, 0.1, 0.2, 0.4];
      const fittedWeight = choices.sort((a, b) =>
        (mae(train.map(row => ({ actual: row.actual, estimate: estimate(row, a) }))) ?? Infinity)
        - (mae(train.map(row => ({ actual: row.actual, estimate: estimate(row, b) }))) ?? Infinity))[0]!;
      const test = examples.filter(row => row.season === holdoutSeason
        && (trainSeason !== holdoutSeason || row.week >= 10) && row.position === position && row.metric === metric);
      const paired = test.filter(row => row.defense !== null);
      const summary = (sample: Example[], predictor: (r: Example) => number) => {
        const pairs = sample.map(r => ({ actual: r.actual, estimate: predictor(r) }));
        return { n: pairs.length, mae: mae(pairs),
          rmse: pairs.length ? Math.sqrt(pairs.reduce((s, p) => s + (p.actual - p.estimate) ** 2, 0) / pairs.length) : null,
          bias: pairs.length ? pairs.reduce((s, p) => s + p.estimate - p.actual, 0) / pairs.length : null };
      };
      const sorted = [...test].sort((a, b) => a.player - b.player);
      const calibration = [0, 1, 2].map(bucket => {
        const sample = sorted.slice(Math.floor(bucket * sorted.length / 3), Math.floor((bucket + 1) * sorted.length / 3));
        return { bucket: bucket + 1, n: sample.length,
          meanEstimate: sample.length ? sample.reduce((sum, row) => sum + row.player, 0) / sample.length : null,
          meanActual: sample.length ? sample.reduce((sum, row) => sum + row.actual, 0) / sample.length : null };
      });
      return [`${position}:${metric}`, {
        trainingN: trainAll.length, defenseTrainingN: train.length, holdoutN: test.length, defenseCoveredN: paired.length,
        fittedWeight, playerOnly: summary(test, r => r.player), leaguePosition: summary(test, r => r.league),
        pairedPlayerOnly: summary(paired, r => r.player),
        pairedDefenseContext: summary(paired, r => estimate(r, fittedWeight)),
        playerOnlyCalibration: calibration,
        enabledLive: false,
        reason: "Historical source revisions were not archived before their kickoffs; availability and roster evidence are not qualified for live counts.",
      }];
    })));
  return { version: EVALUATION_VERSION, trainSeason, holdoutSeason,
    split: trainSeason === holdoutSeason ? "Training weeks 1–9; forward holdout weeks 10–18" : "Prior season training; next season holdout",
    method: "Prior five player appearances on the same team; previous position-game opponent allowances shrink toward zero adjustment as n/(n+5), capped at 25%; coefficient chosen by training MAE. Holdout and ablation use identical eligible rows.",
    provenance: "Reconstructed game-time chronology only. Imported mutable source revisions cannot prove historical as-of availability.",
    missing, metrics };
}