import { and, asc, desc, eq, gt, inArray, lt, sql } from "drizzle-orm";
import {
  db, gamesTable, initialLinePicksTable, initialWeeklyPicksTable,
  modelPromotionHistoryTable, modelTrainingRunsTable, oddsApiRequestsTable, sportsbookOddsTable, teamsTable,
} from "@workspace/db";
import { artifactMetadataMatchesTrainingRun, isFittedModelArtifact, PHASE6_VECTOR_FEATURE_NAMES, predictPersistedModelArtifact, verifyArtifactIntegrity } from "./modeling";
import { inferInitialLineGame, isEligiblePredictionSnapshot } from "./live-predictions";

export type InitialQuote = {
  sportsbook: string; market: string; selection: string;
  point: number | null; price: number; sourceTimestamp: Date | null;
};

/** Only a single book supplying both *sides* of both markets qualifies. */
export function completeInitialQuotes(quotes: InitialQuote[], home: string, away: string) {
  for (const sportsbook of ["DraftKings", "FanDuel"]) {
    const selected: InitialQuote[] = [];
    for (const market of ["moneyline", "spread"]) {
      for (const side of [home, away]) {
        const candidates = quotes.filter((q) => q.sportsbook === sportsbook && q.market === market
          && q.selection === side
          && Number.isInteger(q.price) && (q.price <= -100 || q.price >= 100)
          && (market === "moneyline" ? q.point === null : q.point !== null && Number.isFinite(q.point)));
        if (candidates.length !== 1) break;
        selected.push(candidates[0]!);
      }
    }
    if (selected.length === 4
      && Math.abs(selected[2]!.point! + selected[3]!.point!) < 1e-6) {
      return { sportsbook, quotes: selected };
    }
  }
  return null;
}

export function rankInitialPicks<T extends { gameId: string; winnerProbability: number | null; kickoffTime: Date }>(rows: T[]) {
  return [...rows].sort((a, b) => (b.winnerProbability ?? 0) - (a.winnerProbability ?? 0)
    || a.kickoffTime.getTime() - b.kickoffTime.getTime() || a.gameId.localeCompare(b.gameId))[0] ?? null;
}

export function nextInitialSlate<T extends { season: number; week: number; kickoffTime: Date | null; gameStatus: string | null }>(
  schedule: T[], now: Date,
) {
  const upcoming = schedule.filter((game) => game.kickoffTime && game.kickoffTime > now
    && !/final|completed|postponed|cancel/i.test(game.gameStatus ?? ""))
    .sort((a, b) => a.kickoffTime!.getTime() - b.kickoffTime!.getTime());
  const first = upcoming[0];
  return first ? upcoming.filter((game) => game.season === first.season && game.week === first.week) : [];
}

export async function captureInitialLineOutcome(input: {
  gameId: string; requestId: number; requestedAt: Date; observedAt: Date; quotes: InitialQuote[];
}) {
  const [game] = await db.select().from(gamesTable).where(eq(gamesTable.gameId, input.gameId)).limit(1);
  if (!game?.kickoffTime || input.observedAt >= game.kickoffTime || input.requestedAt > input.observedAt) return;
  const kickoffTime = game.kickoffTime;
  // Preparation happens outside the transaction; the first writer wins and
  // the primary key plus advisory lock resolve cross-worker retries.
  const lines = completeInitialQuotes(input.quotes, (await db.select({ abbreviation: teamsTable.abbreviation })
    .from(teamsTable).where(eq(teamsTable.teamId, game.homeTeamId)).limit(1))[0]?.abbreviation ?? "",
    (await db.select({ abbreviation: teamsTable.abbreviation })
      .from(teamsTable).where(eq(teamsTable.teamId, game.awayTeamId)).limit(1))[0]?.abbreviation ?? "");
  const chronologicalLines = lines && lines.quotes.every((quote) =>
    !quote.sourceTimestamp || quote.sourceTimestamp <= input.observedAt);
  const inference = chronologicalLines ? await inferInitialLineGame(game.gameId, input.requestedAt, input.observedAt) : null;
  return db.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`initial-line:${game.gameId}`}))`);
    const [existing] = await tx.select({ gameId: initialLinePicksTable.gameId })
      .from(initialLinePicksTable).where(eq(initialLinePicksTable.gameId, game.gameId)).limit(1);
    if (existing) return false;
    const [request] = await tx.select({ status: oddsApiRequestsTable.status, requestedAt: oddsApiRequestsTable.requestedAt })
      .from(oddsApiRequestsTable).where(eq(oddsApiRequestsTable.id, input.requestId)).limit(1);
    if (request?.status !== "success" || request.requestedAt.getTime() !== input.requestedAt.getTime())
      throw new Error("Initial-line decision requires a persisted successful request at its original cutoff.");
    if (lines) {
      const stored = await tx.select().from(sportsbookOddsTable)
        .where(and(eq(sportsbookOddsTable.gameId, game.gameId), eq(sportsbookOddsTable.capturedAt, input.observedAt)));
      if (!lines.quotes.every((quote) => stored.some((saved) => saved.sportsbook === quote.sportsbook
        && saved.market === quote.market && saved.selection === quote.selection
        && saved.point === quote.point && saved.price === quote.price
        && saved.sourceTimestamp?.getTime() === quote.sourceTimestamp?.getTime())))
        throw new Error("Initial-line quotes must be saved by this observation before the decision.");
    }
    // Existing history predating this request cannot be labeled "initial" by
    // a new version of the worker. Includes duplicate-state quote histories.
    const [older] = await tx.select({ id: sportsbookOddsTable.id }).from(sportsbookOddsTable)
      .where(and(eq(sportsbookOddsTable.gameId, game.gameId), lt(sportsbookOddsTable.capturedAt, input.requestedAt))).limit(1);
    const status = older ? "legacy_unattributed" : !input.quotes.length ? "no_line"
      : !chronologicalLines ? "incomplete_market" : inference!.status;
    await tx.insert(initialLinePicksTable).values({
      gameId: game.gameId, season: game.season, week: game.week,
      requestId: input.requestId, requestedAt: input.requestedAt,
      observedAt: input.observedAt, kickoffTime, cutoffAt: input.observedAt,
      status,
      reason: older ? "Earlier odds history has no request-bound initial-line evidence."
        : status === "no_line" ? "The first observed event supplied no valid winner or spread lines."
        : status === "incomplete_market" ? "The first observed event lacked both sides of moneyline and spread at one sportsbook."
        : inference?.reason ?? null,
      winnerTeamId: status === "locked" && inference?.status === "locked" ? inference.winnerTeamId : null,
      winnerProbability: status === "locked" && inference?.status === "locked" ? inference.winnerProbability : null,
      sportsbook: status === "locked" ? lines?.sportsbook : null,
      quotes: status === "locked" ? lines?.quotes.map(({ market, selection, point, price, sourceTimestamp }) => ({
        market, selection, point, price, sourceTimestamp: sourceTimestamp?.toISOString() ?? null,
      })) : null,
      models: status === "locked" && inference?.status === "locked" ? inference.models : null,
      featureVersion: status === "locked" && inference?.status === "locked" ? inference.featureVersion : null,
      vectorFeatureNames: status === "locked" && inference?.status === "locked" ? inference.vectorFeatureNames : null,
      vectorSchemaFingerprint: status === "locked" && inference?.status === "locked" ? inference.vectorSchemaFingerprint : null,
      inputVector: status === "locked" && inference?.status === "locked" ? inference.inputVector : null,
      inputSourceEvidence: status === "locked" && inference?.status === "locked" ? inference.inputSourceEvidence : null,
      prediction: status === "locked" && inference?.status === "locked" ? inference.prediction : null,
    }).onConflictDoNothing();
    return true;
  });
}

export async function selectInitialWeeklyPick(season: number, week: number, now = new Date()) {
  const games = await db.select().from(gamesTable).where(and(eq(gamesTable.season, season), eq(gamesTable.week, week)));
  const upcoming = games.filter((game) => game.kickoffTime && game.kickoffTime > now
    && !/final|completed|postponed|cancel/i.test(game.gameStatus));
  if (!upcoming.length) return;
  const outcomes = await db.select().from(initialLinePicksTable)
    .where(and(eq(initialLinePicksTable.season, season), eq(initialLinePicksTable.week, week)));
  // Choose from the locks available after this successful weekly pull. A
  // provider may omit some games indefinitely; they must not strand a valid
  // selection, nor may a later pull revise the already saved weekly choice.
  const verified = [];
  for (const row of outcomes) {
    if (row.status === "locked" && row.winnerProbability !== null && await verifySavedPick(row)) verified.push(row);
  }
  const chosen = rankInitialPicks(verified);
  if (!chosen) return;
  await db.insert(initialWeeklyPicksTable).values({ season, week, gameId: chosen.gameId })
    .onConflictDoNothing();
}

export async function verifySavedPick(row: typeof initialLinePicksTable.$inferSelect) {
  const [game] = await db.select().from(gamesTable).where(eq(gamesTable.gameId, row.gameId)).limit(1);
  if (!game?.kickoffTime || game.kickoffTime.getTime() !== row.kickoffTime.getTime()
    || row.status !== "locked" || !row.models || !row.prediction || !row.quotes
    || row.winnerTeamId !== game.homeTeamId && row.winnerTeamId !== game.awayTeamId
    || !row.inputVector || !row.vectorFeatureNames || !row.vectorSchemaFingerprint) return false;
  const versions = Object.values(row.models).map((model) => model.version);
  if (versions.length !== 3) return false;
  const [runs, promotions] = await Promise.all([
    db.select().from(modelTrainingRunsTable).where(inArray(modelTrainingRunsTable.modelVersion, versions)),
    db.select().from(modelPromotionHistoryTable).where(inArray(modelPromotionHistoryTable.modelVersion, versions)),
  ]);
  if (!["spread", "moneyline", "totals"].every((family) => {
    const saved = row.models?.[family];
    const run = runs.find((candidate) => candidate.family === family && candidate.modelVersion === saved?.version);
    return Boolean(saved && run && run.trainedAt <= row.requestedAt
      && run.featureVersion === row.featureVersion
      && run.vectorSchemaFingerprint === row.vectorSchemaFingerprint
      && JSON.stringify(run.vectorFeatureNames) === JSON.stringify(row.vectorFeatureNames)
      && verifyArtifactIntegrity(run).valid && artifactMetadataMatchesTrainingRun(run)
      && isFittedModelArtifact(run.modelArtifact, PHASE6_VECTOR_FEATURE_NAMES.length)
      && run.modelArtifact.metadata?.artifactId === saved.artifactId
      && run.modelArtifact.metadata?.artifactChecksum === saved.checksum
      && promotions.some((promotion) => promotion.family === family && promotion.role === "production"
        && promotion.modelVersion === saved.version && promotion.promotedAt.toISOString() === saved.promotedAt
        && promotion.promotedAt <= row.requestedAt && promotion.trainingCutoff === saved.trainingCutoff
        && promotion.featureVersion === row.featureVersion && promotion.algorithm === run.algorithm));
  })) return false;
  const fitted = Object.fromEntries(runs.map((run) => [run.family, run]));
  const margin = predictPersistedModelArtifact(fitted.spread as Parameters<typeof predictPersistedModelArtifact>[0], row.inputVector);
  const total = predictPersistedModelArtifact(fitted.totals as Parameters<typeof predictPersistedModelArtifact>[0], row.inputVector);
  const rawHome = predictPersistedModelArtifact(fitted.moneyline as Parameters<typeof predictPersistedModelArtifact>[0], row.inputVector);
  const homePrediction = rawHome === null ? null : Math.max(0.001, Math.min(0.999, rawHome));
  if (margin === null || total === null || homePrediction === null
    || row.prediction.projectedMargin !== margin || row.prediction.projectedTotal !== total
    || row.prediction.homeWinProbability !== homePrediction
    || row.prediction.awayWinProbability !== 1 - homePrediction
    || row.prediction.projectedHomeScore !== (total + margin) / 2
    || row.prediction.projectedAwayScore !== (total - margin) / 2) return false;
  const home = row.prediction.homeWinProbability;
  const away = row.prediction.awayWinProbability;
  if (row.winnerTeamId !== (home > away ? game.homeTeamId : game.awayTeamId)
    || row.winnerProbability !== Math.max(home, away)) return false;
  const [homeTeam, awayTeam] = await Promise.all([game.homeTeamId, game.awayTeamId].map((id) =>
    db.select({ abbreviation: teamsTable.abbreviation }).from(teamsTable).where(eq(teamsTable.teamId, id)).limit(1)));
  if (!completeInitialQuotes(row.quotes.map((quote) => ({ ...quote, sportsbook: row.sportsbook!,
    sourceTimestamp: quote.sourceTimestamp ? new Date(quote.sourceTimestamp) : null })),
    homeTeam[0]?.abbreviation ?? "", awayTeam[0]?.abbreviation ?? "")) return false;
  return isEligiblePredictionSnapshot({
    gameId: row.gameId, kickoffTime: row.kickoffTime, predictionTimestamp: row.requestedAt,
    snapshotKey: `initial:input-integrity-v3:${row.vectorSchemaFingerprint}`,
    spreadModelVersion: row.models.spread.version, moneylineModelVersion: row.models.moneyline.version,
    totalsModelVersion: row.models.totals.version,
    inputFeatureCount: row.inputVector.length, inputMissingFeatureCount: 0,
    inputVector: row.inputVector, vectorFeatureNames: row.vectorFeatureNames,
    vectorSchemaFingerprint: row.vectorSchemaFingerprint, inputSourceEvidence: row.inputSourceEvidence,
    projectedHomeScore: row.prediction.projectedHomeScore, projectedAwayScore: row.prediction.projectedAwayScore,
    projectedMargin: row.prediction.projectedMargin, projectedTotal: row.prediction.projectedTotal,
    homeWinProbability: home, awayWinProbability: away,
  });
}

export async function readInitialWeeklyPick(now = new Date()) {
  const schedule = await db.select({
    gameId: gamesTable.gameId, season: gamesTable.season, week: gamesTable.week,
    kickoffTime: gamesTable.kickoffTime, gameStatus: gamesTable.gameStatus,
  }).from(gamesTable).where(gt(gamesTable.kickoffTime, now))
    .orderBy(asc(gamesTable.kickoffTime)).limit(100);
  const upcoming = nextInitialSlate(schedule, now);
  if (!upcoming.length) return { pick: null, reason: "No upcoming slate is on the schedule." };
  const { season, week } = upcoming[0]!;
  const [selection] = await db.select().from(initialWeeklyPicksTable)
    .where(and(eq(initialWeeklyPicksTable.season, season), eq(initialWeeklyPicksTable.week, week))).limit(1);
  if (selection) {
    const [row] = await db.select().from(initialLinePicksTable)
      .where(eq(initialLinePicksTable.gameId, selection.gameId)).limit(1);
    if (!row || row.season !== season || row.week !== week || !await verifySavedPick(row))
      return { pick: null, reason: "Saved initial-line evidence could not be verified." };
    const [team] = await db.select({ name: teamsTable.teamName }).from(teamsTable)
      .where(eq(teamsTable.teamId, row.winnerTeamId!)).limit(1);
    return team ? { pick: { gameId: row.gameId, teamName: team.name, season, week,
      probability: row.winnerProbability!, observedAt: row.observedAt.toISOString() }, reason: null }
      : { pick: null, reason: "The saved winner's team identity is unavailable." };
  }
  const games = upcoming;
  const outcomes = await db.select().from(initialLinePicksTable)
    .where(and(eq(initialLinePicksTable.season, season), eq(initialLinePicksTable.week, week)));
  const scheduledIds = new Set(games.map((game) => game.gameId));
  const reasons = new Set(outcomes.filter((row) => scheduledIds.has(row.gameId)).map((row) => row.status));
  const reason = reasons.has("missing_input") ? "Cutoff-safe model inputs were unavailable at the first observed lines."
    : reasons.has("invalid_model") ? "A valid promoted model was unavailable at the first observed lines."
    : reasons.has("incomplete_market") ? "The first observed lines lacked complete same-sportsbook winner and spread quotes."
    : reasons.has("legacy_unattributed") ? "Earlier lines cannot be verified as initial-line pick evidence."
    : reasons.has("no_line") ? "The first observed pull supplied no qualifying lines."
    : games.some((game) => !outcomes.some((row) => row.gameId === game.gameId))
      ? "Waiting for first verified lines for the upcoming slate."
      : "No qualifying initial-line pick is available for this slate.";
  return { pick: null, reason };
}

/** Archive only weeks whose entire saved slate has kicked off. Never derive a
 * winner from a later snapshot when the original weekly selection is absent. */
export async function readInitialWeeklyPickArchive(requestedSeason?: number, now = new Date()) {
  const slates = await db.select({
    season: gamesTable.season, week: gamesTable.week,
  }).from(gamesTable)
    .groupBy(gamesTable.season, gamesTable.week)
    .having(sql`count(*) = count(${gamesTable.kickoffTime}) and max(${gamesTable.kickoffTime}) < ${now}`)
    .orderBy(desc(gamesTable.season), desc(gamesTable.week));
  const seasons = [...new Set(slates.map((slate) => slate.season))];
  const season = requestedSeason ?? seasons[0] ?? null;
  const weeks = slates.filter((slate) => slate.season === season);
  if (!weeks.length) return { seasons, season, weeks: [] };
  const selections = await db.select().from(initialWeeklyPicksTable)
    .where(eq(initialWeeklyPicksTable.season, season!));
  const rows = selections.length ? await db.select().from(initialLinePicksTable)
    .where(inArray(initialLinePicksTable.gameId, selections.map((selection) => selection.gameId))) : [];
  const winners = rows.length ? await db.select({ id: teamsTable.teamId, name: teamsTable.teamName })
    .from(teamsTable).where(inArray(teamsTable.teamId, rows.map((row) => row.winnerTeamId).filter((id): id is string => id !== null))) : [];
  const outcomes = [];
  for (const slate of weeks) {
    const selection = selections.find((item) => item.week === slate.week);
    const row = rows.find((item) => item.gameId === selection?.gameId && item.season === season && item.week === slate.week);
    const verified = row && await verifySavedPick(row);
    const team = verified ? winners.find((item) => item.id === row.winnerTeamId) : null;
    outcomes.push({
      season: slate.season, week: slate.week,
      pick: team ? { gameId: row!.gameId, teamName: team.name, season: slate.season, week: slate.week,
        probability: row!.winnerProbability!, observedAt: row!.observedAt.toISOString() } : null,
      reason: team ? null : selection
        ? "Saved official weekly pick evidence could not be verified."
        : "No persisted official weekly selection is available for this week.",
    });
  }
  return { seasons, season, weeks: outcomes };
}