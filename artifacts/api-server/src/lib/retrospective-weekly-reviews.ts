import { createHash } from "node:crypto";
import { and, asc, eq, inArray, lt, sql } from "drizzle-orm";
import {
  db, gamesTable, initialLinePicksTable, initialWeeklyPicksTable, oddsApiRequestsTable,
  predictionSnapshotsTable, retrospectiveWeeklyReviewsTable, sportsbookOddsTable, teamsTable,
} from "@workspace/db";
import { rankInitialPicks, verifySavedPick } from "./initial-line-picks";

export const retrospectiveScope = (season: number, week: number) =>
  season === 2026 && Number.isInteger(week) && week >= 1 && week <= 3;

export class RetrospectiveReviewError extends Error {}

export function retrospectiveEvidenceId(rows: Array<{
  gameId: string; requestId: number; cutoffAt: Date; winnerTeamId: string | null; winnerProbability: number | null;
  models?: unknown; inputVector?: unknown; inputSourceEvidence?: unknown; quotes?: unknown; prediction?: unknown;
}>) {
  return createHash("sha256").update(JSON.stringify([...rows].sort((a, b) => a.gameId.localeCompare(b.gameId))
    .map((row) => [row.gameId, row.requestId, row.cutoffAt.toISOString(), row.winnerTeamId, row.winnerProbability,
      row.models, row.inputVector, row.inputSourceEvidence, row.quotes, row.prediction]))).digest("hex");
}

/** No current-model replay or bare probability is admitted. Every scheduled
 * game's original observation must be independently verified before ranking. */
export async function inspectRetrospectiveWeek(season: number, week: number) {
  if (!retrospectiveScope(season, week)) throw new Error("Retrospective review is limited to 2026 Weeks 1–3.");
  const [games, outcomes, official, saved] = await Promise.all([
    db.select().from(gamesTable).where(and(eq(gamesTable.season, season), eq(gamesTable.week, week)))
      .orderBy(asc(gamesTable.kickoffTime), asc(gamesTable.gameId)),
    db.select().from(initialLinePicksTable).where(and(eq(initialLinePicksTable.season, season), eq(initialLinePicksTable.week, week))),
    db.select().from(initialWeeklyPicksTable).where(and(eq(initialWeeklyPicksTable.season, season), eq(initialWeeklyPicksTable.week, week))).limit(1),
    db.select().from(retrospectiveWeeklyReviewsTable).where(and(eq(retrospectiveWeeklyReviewsTable.season, season), eq(retrospectiveWeeklyReviewsTable.week, week))).limit(1),
  ]);
  const snapshots = games.length ? await db.select({
    gameId: predictionSnapshotsTable.gameId, inputVector: predictionSnapshotsTable.inputVector,
    inputSourceEvidence: predictionSnapshotsTable.inputSourceEvidence,
  }).from(predictionSnapshotsTable).where(inArray(predictionSnapshotsTable.gameId, games.map((game) => game.gameId))) : [];
  const missing = games.filter((game) => !outcomes.some((row) => row.gameId === game.gameId));
  let reason: string | null = !games.length ? "No saved schedule exists for this week."
    : games.some((game) => !game.kickoffTime) ? "A game has no verified kickoff time."
    : missing.length ? `${missing.length} of ${games.length} scheduled games lack request-bound first-line outcomes. ${snapshots.length ? `${snapshots.filter((row) => row.inputVector && row.inputSourceEvidence).length} of ${snapshots.length} saved prediction snapshots have both input vectors and source evidence; bare probabilities cannot establish an original choice.` : "No saved prediction inputs can replace those outcomes."}`
    : week === 3 && games.some((game) => game.kickoffTime! >= new Date())
      ? "Week 3 is not yet entirely in the past; a retrospective weekly choice cannot be published before the slate has kicked off."
    : null;
  const eligible: typeof outcomes = [];
  if (!reason) {
    for (const game of games) {
      const row = outcomes.find((item) => item.gameId === game.gameId)!;
      const [request] = await db.select().from(oddsApiRequestsTable).where(eq(oddsApiRequestsTable.id, row.requestId)).limit(1);
      const [older] = await db.select({ id: sportsbookOddsTable.id }).from(sportsbookOddsTable)
        .where(and(eq(sportsbookOddsTable.gameId, game.gameId), lt(sportsbookOddsTable.capturedAt, row.requestedAt))).limit(1);
      const savedQuotes = await db.select().from(sportsbookOddsTable).where(and(
        eq(sportsbookOddsTable.gameId, game.gameId), eq(sportsbookOddsTable.capturedAt, row.observedAt)));
      const sources = (row.inputSourceEvidence as { rows?: Array<{ teamId?: string; isHome?: boolean }> } | null)?.rows;
      if (row.status !== "locked" || row.season !== game.season || row.week !== game.week
        || row.kickoffTime.getTime() !== game.kickoffTime!.getTime()
        || row.cutoffAt.getTime() !== row.observedAt.getTime() || row.observedAt >= game.kickoffTime!
        || row.requestedAt > row.observedAt || request?.status !== "success"
        || request.requestedAt.getTime() !== row.requestedAt.getTime() || older
        || row.quotes?.some((quote) => quote.sourceTimestamp && (Number.isNaN(Date.parse(quote.sourceTimestamp)) || Date.parse(quote.sourceTimestamp) > row.cutoffAt.getTime()))
        || !row.quotes?.every((quote) => savedQuotes.some((stored) =>
          stored.sportsbook === row.sportsbook && stored.market === quote.market
          && stored.selection === quote.selection && stored.point === quote.point
          && stored.price === quote.price && (stored.sourceTimestamp?.toISOString() ?? null) === quote.sourceTimestamp))
        || !Array.isArray(sources) || sources.length !== 2
        || !sources.some((source) => source.isHome === true && source.teamId === game.homeTeamId)
        || !sources.some((source) => source.isHome === false && source.teamId === game.awayTeamId)
        || !await verifySavedPick(row)) {
        reason = `Saved initial observation for ${game.gameId} is incomplete, stale, or cannot be verified at its original cutoff.`;
        break;
      }
      eligible.push(row);
    }
  }
  const chosen = reason ? null : rankInitialPicks(eligible);
  const teamIds = chosen ? [chosen.winnerTeamId!, games.find((item) => item.gameId === chosen.gameId)!.homeTeamId,
    games.find((item) => item.gameId === chosen.gameId)!.awayTeamId] : [];
  const teams = teamIds.length ? await db.select({ id: teamsTable.teamId, name: teamsTable.teamName, code: teamsTable.abbreviation })
    .from(teamsTable).where(inArray(teamsTable.teamId, teamIds)) : [];
  const team = teams.find((item) => item.id === chosen?.winnerTeamId);
  if (chosen && !team) reason = "The algorithmic winner has no saved team identity.";
  const game = games.find((item) => item.gameId === chosen?.gameId);
  return {
    season, week, reason,
    candidate: chosen && team && game ? {
      gameId: chosen.gameId, teamId: chosen.winnerTeamId!, teamName: team.name,
      matchup: `${teams.find((item) => item.id === game.awayTeamId)?.code ?? game.awayTeamId} at ${teams.find((item) => item.id === game.homeTeamId)?.code ?? game.homeTeamId}`,
      probability: chosen.winnerProbability!, cutoffAt: chosen.cutoffAt.toISOString(),
      evidenceId: retrospectiveEvidenceId(eligible),
    } : null,
    officialExists: Boolean(official[0]),
    review: saved[0] ? {
      status: saved[0].status, reason: saved[0].reason,
      gameId: saved[0].gameId, teamId: saved[0].winnerTeamId,
      probability: saved[0].winnerProbability, cutoffAt: saved[0].cutoffAt?.toISOString() ?? null,
      evidenceId: saved[0].evidenceId, reviewedAt: saved[0].reviewedAt.toISOString(),
      publishedAt: saved[0].publishedAt?.toISOString() ?? null,
    } : null,
  };
}

/** Atomic one-time insert. Reread the evidence under a slate lock so a stale
 * preview cannot authorize a different candidate. */
export async function recordRetrospectiveReview(season: number, week: number, reviewerId: string, evidenceId: string | null, publish: boolean) {
  if (!retrospectiveScope(season, week) || publish !== (week === 3))
    throw new RetrospectiveReviewError("Only Week 3 can be manually published.");
  await db.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`retrospective:${season}:${week}`}))`);
    const [existing] = await tx.select().from(retrospectiveWeeklyReviewsTable)
      .where(and(eq(retrospectiveWeeklyReviewsTable.season, season), eq(retrospectiveWeeklyReviewsTable.week, week))).limit(1);
    if (existing) throw new RetrospectiveReviewError("This week already has an immutable retrospective review.");
    const report = await inspectRetrospectiveWeek(season, week);
    if (report.candidate ? report.candidate.evidenceId !== evidenceId : publish || evidenceId !== null)
      throw new RetrospectiveReviewError(report.reason ?? "Evidence has changed; refresh the review before submitting.");
    const now = new Date();
    await tx.insert(retrospectiveWeeklyReviewsTable).values({
      season, week, reviewerId, reviewedAt: now, publishedAt: publish ? now : null,
      status: publish ? "published" : report.candidate ? "reviewed" : "unavailable",
      reason: report.candidate ? null : report.reason,
      gameId: report.candidate?.gameId ?? null,
      winnerTeamId: report.candidate?.teamId ?? null,
      winnerProbability: report.candidate?.probability ?? null,
      cutoffAt: report.candidate ? new Date(report.candidate.cutoffAt) : null,
      evidenceId: report.candidate ? evidenceId : null,
    });
  });
  // A separate read is deliberate: global db queries cannot see an uncommitted
  // review inside the transaction, even though its insert has succeeded.
  return inspectRetrospectiveWeek(season, week);
}