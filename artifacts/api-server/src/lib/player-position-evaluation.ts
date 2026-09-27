import { buildUsageTeamMappings } from "../routes/consumer";
import { completePositionGame, type DefenseInputs, type Position } from "./defense-vs-position";
import { publisherEvidenceBeforeKickoff, type PositionRelease } from "./player-position-releases";

export const EVALUATION_VERSION = "player-position-forward-research-v3";
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

/** Rebuild feature rows from the latest release actually captured before each
 * kickoff. The outcome comes from the later final stat import, never from the
 * pregame snapshot. Unreconciled schedules/identities do not become zeros. */
function archivedExamples(truth: DefenseInputs[], releases: PositionRelease[], seasons: number[]): Example[] {
  const examples: Example[] = [];
  const maps = buildUsageTeamMappings(truth[0]?.teams ?? []);
  for (const input of truth) for (const game of input.games) {
    if (!seasons.includes(game.season) || game.gameStatus !== "STATUS_FINAL"
      || game.week < 1 || game.week > 18 || !game.kickoffTime) continue;
    const home = maps.canonical(game.homeTeamId), away = maps.canonical(game.awayTeamId);
    if (!home || !away || home === away) continue;
     const release = releases.filter(r => r.input.games.length && r.capturedAt < game.kickoffTime!
       && publisherEvidenceBeforeKickoff(r, game.season, game.kickoffTime!)
      && JSON.stringify(r.input.teams) === JSON.stringify(input.teams)
      && ["pbp", "player_stats"].every(dataset => r.input.sources.some(s =>
        s.dataset === dataset && s.season === game.season && s.status === "success"
        && s.completedAt && s.completedAt <= r.capturedAt)))
      .sort((a, b) => a.capturedAt.getTime() - b.capturedAt.getTime()).at(-1);
    if (!release) continue;
    const historical = release.input;
    const schedule = historical.games.filter(g => g.season === game.season && g.week <= 18
      && g.gameStatus === "STATUS_FINAL" && g.kickoffTime && g.kickoffTime < game.kickoffTime!);
    const byMatch = new Map<string, typeof schedule>();
    for (const g of schedule) {
      const a = maps.canonical(g.homeTeamId), b = maps.canonical(g.awayTeamId);
      if (!a || !b || a === b) continue;
      for (const [team, opponent] of [[a, b], [b, a]]) {
        const key = `${g.week}:${team}:${opponent}`;
        byMatch.set(key, [...(byMatch.get(key) ?? []), g]);
      }
    }
    const prior = historical.stats.flatMap(row => {
      if (row.season !== game.season || row.seasonType.toUpperCase() !== "REG"
        || !row.playerId || !row.position || row.sourceUpdatedAt > release.capturedAt) return [];
      const team = maps.canonical(row.teamId), opponent = maps.canonical(row.opponentTeamId);
      const matches = byMatch.get(`${row.week}:${team}:${opponent}`) ?? [];
      if (matches.length !== 1) return [];
      return [{ row, game: matches[0]!, team, opponent }];
    });
    const priorIdentityCounts = new Map<string, number>();
    for (const p of prior) {
      const key = `${p.game.gameId}:${p.team}:${p.row.playerId}`;
      priorIdentityCounts.set(key, (priorIdentityCounts.get(key) ?? 0) + 1);
    }
    const uniquePrior = prior.filter(p =>
      priorIdentityCounts.get(`${p.game.gameId}:${p.team}:${p.row.playerId}`) === 1);
    const outcomes = input.stats.filter(row => row.season === game.season && row.week === game.week
      && row.seasonType.toUpperCase() === "REG" && row.playerId
      && [[home, away], [away, home]].some(([team, opponent]) =>
        maps.canonical(row.teamId) === team && maps.canonical(row.opponentTeamId) === opponent));
    const outcomesByIdentity = new Map<string, number>();
    for (const row of outcomes) {
      const key = `${row.playerId}:${maps.canonical(row.teamId)}`;
      outcomesByIdentity.set(key, (outcomesByIdentity.get(key) ?? 0) + 1);
    }
    const unique = new Set<string>();
    for (const row of outcomes) {
      const team = maps.canonical(row.teamId)!, opponent = maps.canonical(row.opponentTeamId)!;
      const position = row.position?.toUpperCase() as Position;
      if (!METRICS[position] || unique.has(`${row.playerId}:${team}`)
        || outcomesByIdentity.get(`${row.playerId}:${team}`) !== 1) continue;
      unique.add(`${row.playerId}:${team}`);
      const playerHistory = uniquePrior.filter(p => p.row.playerId === row.playerId && p.team === team
        && p.row.position?.toUpperCase() === position)
        .sort((a, b) => a.game.kickoffTime!.getTime() - b.game.kickoffTime!.getTime()).slice(-5);
      for (const metric of METRICS[position]) {
        const actual = row[metric as keyof typeof row];
        if (typeof actual !== "number" || !Number.isFinite(actual)) continue;
        const values = playerHistory.map(p => p.row[metric as keyof typeof p.row])
          .filter((v): v is number => typeof v === "number" && Number.isFinite(v));
        const league = uniquePrior.filter(p => p.row.position?.toUpperCase() === position)
          .map(p => p.row[metric as keyof typeof p.row])
          .filter((v): v is number => typeof v === "number" && Number.isFinite(v));
        if (values.length < 3 || league.length < 20) continue;
        const defense = schedule.filter(g =>
          [maps.canonical(g.homeTeamId), maps.canonical(g.awayTeamId)].includes(opponent))
          .map(g => {
            const offense = maps.canonical(g.homeTeamId) === opponent
              ? maps.canonical(g.awayTeamId) : maps.canonical(g.homeTeamId);
            return offense && (byMatch.get(`${g.week}:${offense}:${opponent}`)?.length ?? 0) === 1
              ? completePositionGame(historical, g, offense, opponent, position, metric, maps.canonical) : null;
          }).filter((v): v is { value: number; participants: number } => v !== null);
        examples.push({ season: game.season, week: game.week, position, metric, actual,
          player: values.reduce((a, b) => a + b, 0) / values.length,
          league: league.reduce((a, b) => a + b, 0) / league.length,
          defense: defense.length >= 3
            ? defense.reduce((a, b) => a + b.value, 0) / defense.length : null,
          coveredDefenseGames: defense.length });
      }
    }
  }
  return examples;
}

/** Reconstructed football-time backtest; never claims that overwritten source
 * rows were already published before their historical kickoff. Train on one
 * season, score the next, and report an ablation on the identical cohort. */
export function evaluatePlayerPositionMatchups(inputs: DefenseInputs[], trainSeason: number, holdoutSeason: number,
  releases: PositionRelease[] = []) {
  const teams = inputs[0]?.teams ?? [];
  const maps = buildUsageTeamMappings(teams);
  const archived = archivedExamples(inputs, releases, [trainSeason, holdoutSeason]);
   // Only immutable, publisher-verified pregame snapshots enter scored cohorts.
   // The loop below audits reconstruction gaps; it never scores its later rows.
   const examples = archived;
  const missing = { unreconciledRows: 0, partialDefensiveGames: 0, insufficientPlayerHistory: 0,
    archivedPregameReleaseMissing: 0 };
  for (const input of inputs) {
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
       if (ids.length !== 1 || !team || !opponent || !row.position?.trim()
         || row.season !== gameById.get(ids[0]!)?.season) { missing.unreconciledRows++; return []; }
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
           if (!releases.some(release => release.input.games.some(g => g.gameId === item.game.gameId)
             && release.capturedAt < item.game.kickoffTime!
             && publisherEvidenceBeforeKickoff(release, item.game.season, item.game.kickoffTime!)))
             missing.archivedPregameReleaseMissing++;
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
        const offense = batch.find(item => item.game.gameId === entry.gameId
          && item.opponent === entry.opponent)?.team;
        if (!offense || (byMatch.get(`${game.season}:${game.week}:${offense}:${entry.opponent}`)?.length ?? 0) !== 1) continue;
        const verified = completePositionGame(input, game, offense, entry.opponent,
          entry.position, entry.metric, maps.canonical);
        if (!verified || verified.value !== entry.values.reduce((a, b) => a + b, 0)
          || verified.participants !== entry.values.length) continue;
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
       const fittedWeight = !train.length ? null : choices.sort((a, b) =>
        (mae(train.map(row => ({ actual: row.actual, estimate: estimate(row, a) }))) ?? Infinity)
         - (mae(train.map(row => ({ actual: row.actual, estimate: estimate(row, b) }))) ?? Infinity))[0]!;
      const test = examples.filter(row => row.season === holdoutSeason
        && (trainSeason !== holdoutSeason || row.week >= 10) && row.position === position && row.metric === metric);
      const paired = test.filter(row => row.defense !== null);
       const asOfTrain = archived.filter(row => row.season === trainSeason
         && (trainSeason !== holdoutSeason || row.week <= 9) && row.position === position
         && row.metric === metric && row.defense !== null);
       const asOfTest = archived.filter(row => row.season === holdoutSeason
         && (trainSeason !== holdoutSeason || row.week >= 10) && row.position === position
         && row.metric === metric && row.defense !== null);
       const asOfWeight = asOfTrain.length ? [0, 0.1, 0.2, 0.4].sort((a, b) =>
         (mae(asOfTrain.map(r => ({ actual: r.actual, estimate: estimate(r, a) }))) ?? Infinity)
         - (mae(asOfTrain.map(r => ({ actual: r.actual, estimate: estimate(r, b) }))) ?? Infinity))[0]! : null;
      const summary = (sample: Example[], predictor: (r: Example) => number) => {
        const pairs = sample.map(r => ({ actual: r.actual, estimate: predictor(r) }));
        return { n: pairs.length, mae: mae(pairs),
          rmse: pairs.length ? Math.sqrt(pairs.reduce((s, p) => s + (p.actual - p.estimate) ** 2, 0) / pairs.length) : null,
          bias: pairs.length ? pairs.reduce((s, p) => s + p.estimate - p.actual, 0) / pairs.length : null };
      };
       const calibrationFor = (sampleRows: Example[], predictor: (row: Example) => number) => [0, 1, 2].map(bucket => {
         const ordered = [...sampleRows].sort((a, b) => predictor(a) - predictor(b));
         const sample = ordered.slice(Math.floor(bucket * ordered.length / 3), Math.floor((bucket + 1) * ordered.length / 3));
        return { bucket: bucket + 1, n: sample.length,
           meanEstimate: sample.length ? sample.reduce((sum, row) => sum + predictor(row), 0) / sample.length : null,
          meanActual: sample.length ? sample.reduce((sum, row) => sum + row.actual, 0) / sample.length : null };
      });
      return [`${position}:${metric}`, {
        trainingN: trainAll.length, defenseTrainingN: train.length, holdoutN: test.length, defenseCoveredN: paired.length,
        fittedWeight, playerOnly: summary(test, r => r.player), leaguePosition: summary(test, r => r.league),
        pairedPlayerOnly: summary(paired, r => r.player),
         pairedDefenseContext: fittedWeight === null ? summary([], r => r.player)
           : summary(paired, r => estimate(r, fittedWeight)),
         playerOnlyCalibration: calibrationFor(test, r => r.player),
         pairedPlayerOnlyCalibration: calibrationFor(paired, r => r.player),
         pairedDefenseCalibration: calibrationFor(paired, r => estimate(r, fittedWeight ?? 0)),
         archivedAsOf: {
           trainingN: asOfTrain.length, pairedHoldoutN: asOfTest.length, fittedWeight: asOfWeight,
           playerOnly: summary(asOfTest, r => r.player),
           defenseContext: summary(asOfWeight === null ? [] : asOfTest, r => estimate(r, asOfWeight ?? 0)),
           playerOnlyCalibration: calibrationFor(asOfTest, r => r.player),
           defenseCalibration: calibrationFor(asOfWeight === null ? [] : asOfTest, r => estimate(r, asOfWeight ?? 0)),
         },
         enabledLive: false,
          releaseReadiness: {
            archivedPregameTrainingN: asOfTrain.length, archivedPairedHoldoutN: asOfTest.length,
            publicationChronologyVerified: false,
            currentRosterAndGameStatusVerified: false,
            calibratedHoldoutImprovementVerified: false,
            // Publisher-attested examples can enter research, but sufficient
            // full-cohort coverage and per-player availability are not approved.
            blockers: [
              "Sufficient publisher-verified pregame training and holdout coverage has not been approved.",
              "Complete same-cohort defensive coverage and calibrated holdout improvement have not been approved.",
              "Current team, game roster and affirmative injury clearance have not been verified at the forecast cutoff.",
            ],
          },
          reason: "Research only: publisher chronology coverage, paired defensive improvement, calibration and current player eligibility are independent release blockers.",
      }];
    })));
  return { version: EVALUATION_VERSION, trainSeason, holdoutSeason,
    split: trainSeason === holdoutSeason ? "Training weeks 1–9; forward holdout weeks 10–18" : "Prior season training; next season holdout",
     method: "Publisher-verified pregame archives only; prior five player appearances on the same team. Position-game opponent allowances shrink toward zero adjustment as n/(n+5), capped at 25%; coefficient chosen by training MAE. Holdout and ablation use identical eligible rows.",
      provenance: "Scored games require exact SHA-256 matched GitHub release assets for both weekly player stats and PBP, last updated strictly before kickoff, and an immutable local capture before kickoff. Missing or replaced versions are excluded.",
      archivedReleases: releases.map(r => ({ fingerprint: r.fingerprint, capturedAt: r.capturedAt.toISOString(),
        publisherEvidence: r.publisherEvidence })),
    missing, metrics };
}