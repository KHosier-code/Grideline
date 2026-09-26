import { and, desc, eq, lt, sql } from "drizzle-orm";
import { Router, type IRouter } from "express";
import { db, gamesTable, predictionGradesTable, predictionSnapshotsTable } from "@workspace/db";
import { isEligiblePredictionSnapshot } from "../lib/live-predictions";
import { aggregateGradedCharts, isUsableGradedChartRow } from "../lib/consumer-graded-charts";

const router: IRouter = Router();
const MAX_GAMES_PER_SEASON = 512;
const SEASON_HISTORY = 20;
const MAX_HISTORY_GAMES = MAX_GAMES_PER_SEASON * SEASON_HISTORY;

router.get("/consumer/graded-charts", async (req, res): Promise<void> => {
  const rawSeason = req.query.season;
  let season: number | null = null;
  if (rawSeason !== undefined) {
    if (typeof rawSeason !== "string" || !/^\d{4}$/.test(rawSeason)) {
      res.status(400).json({ error: "season must be a four-digit year" });
      return;
    }
    season = Number(rawSeason);
  }

  try {
    const currentYear = new Date().getUTCFullYear();
    const firstIncludedSeason = currentYear - SEASON_HISTORY + 1;
    const filter = and(
      eq(predictionSnapshotsTable.officialFinalPrediction, true),
      season === null ? sql`${gamesTable.season} >= ${firstIncludedSeason}` : eq(gamesTable.season, season),
      sql`${predictionSnapshotsTable.predictionTimestamp} < ${gamesTable.kickoffTime}`,
      sql`${gamesTable.kickoffTime} is not null`,
      sql`${gamesTable.finalHomeScore} is not null`,
      sql`${gamesTable.finalAwayScore} is not null`,
      sql`(lower(${gamesTable.gameStatus}) like '%final%' or lower(${gamesTable.gameStatus}) like '%completed%')`,
    );
    const limit = season === null ? MAX_HISTORY_GAMES + 1 : MAX_GAMES_PER_SEASON + 1;
    const selectedRows = await db
      .select({ prediction: predictionSnapshotsTable, grade: predictionGradesTable, game: gamesTable })
      .from(predictionSnapshotsTable)
      .innerJoin(predictionGradesTable, eq(predictionGradesTable.predictionId, predictionSnapshotsTable.id))
      .innerJoin(gamesTable, eq(gamesTable.gameId, predictionSnapshotsTable.gameId))
      .where(filter)
      .orderBy(
        desc(gamesTable.season),
        desc(gamesTable.kickoffTime),
        desc(gamesTable.week),
        desc(gamesTable.gameId),
      )
      .limit(limit);

    const countTruncated = selectedRows.length > limit - 1;
    const boundedRows = selectedRows.slice(0, limit - 1);
    let historyTruncated = false;
    if (season === null) {
      const olderSeasonRows = await db.select({ predictionId: predictionSnapshotsTable.id })
        .from(predictionSnapshotsTable)
        .innerJoin(predictionGradesTable, eq(predictionGradesTable.predictionId, predictionSnapshotsTable.id))
        .innerJoin(gamesTable, eq(gamesTable.gameId, predictionSnapshotsTable.gameId))
        .where(and(
          eq(predictionSnapshotsTable.officialFinalPrediction, true),
          lt(gamesTable.season, firstIncludedSeason),
          sql`${predictionSnapshotsTable.predictionTimestamp} < ${gamesTable.kickoffTime}`,
          sql`${gamesTable.finalHomeScore} is not null`,
          sql`${gamesTable.finalAwayScore} is not null`,
          sql`(lower(${gamesTable.gameStatus}) like '%final%' or lower(${gamesTable.gameStatus}) like '%completed%')`,
        ))
        .limit(1);
      historyTruncated = olderSeasonRows.length > 0;
    }
    const eligibleRows = boundedRows
      .filter((row) => isEligiblePredictionSnapshot(row.prediction))
      .filter(isUsableGradedChartRow);
    const result = aggregateGradedCharts(eligibleRows, countTruncated || historyTruncated);
    res.json({
      ...result,
      season,
      note: historyTruncated
        ? `${result.note} History is limited to the latest ${SEASON_HISTORY} seasons; older seasons exist.`
        : result.note,
      truncated: countTruncated || historyTruncated,
    });
  } catch (error) {
    req.log.error({ error }, "Consumer graded charts read failed");
    res.status(503).json({ error: "Graded chart data is being refreshed", code: "consumer_data_unavailable" });
  }
});

export default router;