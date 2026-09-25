import { and, desc, eq, inArray, lte } from "drizzle-orm";
import {
  db,
  gamesTable,
  modelEvaluationPredictionsTable,
  predictionGradesTable,
  predictionSnapshotsTable,
  weeklyLearningReportsTable,
} from "@workspace/db";
import { isCanonicalOfficialPrediction } from "./live-predictions";

type CheckStatus = "verified" | "unavailable" | "not_verifiable";

function check(status: CheckStatus, evidence: string) {
  return { status, evidence };
}

/**
 * This deliberately performs only persisted reads. It reports the evidence
 * that exists and leaves a lifecycle step unavailable when the database cannot
 * honestly prove it; it never runs a sync, freeze, grade, or report job.
 */
export async function getLifecycleVerificationReport(now = new Date()) {
  const rows = await db.select({
    game: gamesTable,
    snapshot: predictionSnapshotsTable,
    grade: predictionGradesTable,
  })
    .from(gamesTable)
    .leftJoin(
      predictionSnapshotsTable,
      and(
        eq(predictionSnapshotsTable.gameId, gamesTable.gameId),
        eq(predictionSnapshotsTable.officialFinalPrediction, true),
      ),
    )
    .leftJoin(predictionGradesTable, eq(predictionGradesTable.predictionId, predictionSnapshotsTable.id))
    .where(lte(gamesTable.kickoffTime, now))
    .orderBy(desc(gamesTable.kickoffTime), desc(predictionSnapshotsTable.predictionTimestamp))
    .limit(250);

  const latest = new Map<string, typeof rows[number]>();
  for (const row of rows) {
    if (!latest.has(row.game.gameId)) latest.set(row.game.gameId, row);
  }
  const games = [...latest.values()];
  const keys = games.map(({ game }) => [game.season, game.week] as const);
  const reports = keys.length
    ? await db.select().from(weeklyLearningReportsTable)
      .where(inArray(weeklyLearningReportsTable.season, [...new Set(keys.map(([season]) => season))]))
      .orderBy(desc(weeklyLearningReportsTable.generatedAt))
      .limit(250)
    : [];
  const reportByWeek = new Map(reports.map((report) => [`${report.season}:${report.week}`, report]));
  const evidenceCount = await db.select({ id: modelEvaluationPredictionsTable.id })
    .from(modelEvaluationPredictionsTable)
    .orderBy(desc(modelEvaluationPredictionsTable.id))
    .limit(1);

  const gamesReport = games.map(({ game, snapshot, grade }) => {
    const validPregame = Boolean(snapshot
      && isCanonicalOfficialPrediction(snapshot, game.kickoffTime, now));
    const finalScorePresent = game.finalHomeScore !== null && game.finalAwayScore !== null;
    const clv = grade?.clv as Record<string, unknown> | undefined;
    const report = reportByWeek.get(`${game.season}:${game.week}`);
    return {
      gameId: game.gameId,
      season: game.season,
      week: game.week,
      kickoffTime: game.kickoffTime?.toISOString() ?? null,
      pregameSnapshot: validPregame
        ? check("verified", "A valid persisted prediction precedes kickoff.")
        : check("unavailable", "No valid pre-kickoff official snapshot is stored."),
      kickoffFreeze: validPregame
        ? check("verified", "The selected official prediction has a persisted freeze timestamp.")
        : check("unavailable", "No persisted official freeze is available."),
      postKickoffImmutability: check(
        "not_verifiable",
        "Current retained rows prove the freeze selection but do not contain a mutation history that can prove no later change.",
      ),
      finalScore: finalScorePresent
        ? check("verified", "Final home and away scores are persisted.")
        : check("unavailable", "A final score is not persisted."),
      grading: validPregame && grade
        ? check("verified", "A persisted grade is linked to the official prediction.")
        : check("unavailable", "No persisted grade is linked to the official prediction."),
      eligibleClv: validPregame && clv?.status === "measured"
        ? check("verified", "A grade contains legitimate measured closing-line evidence.")
        : check("unavailable", "No legitimate measured closing reference is stored."),
      performanceUpdate: validPregame && grade && report && report.generatedAt >= grade.gradedAt
        ? check("verified", "A later persisted weekly performance report exists.")
        : check("unavailable", "No later persisted weekly performance report proves consumption."),
      weeklyChallengerConsumption: evidenceCount.length
        ? check(
          "not_verifiable",
          "Evaluation evidence exists, but it has no linkage to this production prediction; consumption is not inferred.",
        )
        : check("unavailable", "No retained evaluation evidence exists."),
    };
  });
  const verified = gamesReport.filter((game) =>
    Object.values(game).some((value) => typeof value === "object" && value !== null && "status" in value && value.status === "verified"),
  ).length;
  return {
    status: gamesReport.length ? "evidence_available" : "unavailable",
    readOnly: true,
    evaluatedAt: now.toISOString(),
    gamesExamined: gamesReport.length,
    gamesWithVerifiedEvidence: verified,
    games: gamesReport,
    limitation: "This is a read-only evidence report. It does not fabricate lifecycle success or trigger lifecycle work.",
  };
}