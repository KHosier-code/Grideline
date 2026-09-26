import { readFile, stat } from "node:fs/promises";
import { resolve } from "node:path";
import { Router, type IRouter } from "express";
import {
  GetConsumerPlayerProjectionsResponse,
  GetConsumerUpcomingPlayerProjectionReadinessResponse,
} from "@workspace/api-zod";
import {
  readDevelopmentUpcomingPlayerReadiness,
} from "../lib/player-forecast-readiness";
import type { PlayerProjectionReport } from "../lib/player-projections";

const router: IRouter = Router();
const reportPath = resolve(process.cwd(), "../../reports/gridline-player-projection-baseline.json");
let cached: { mtimeMs: number; report: PlayerProjectionReport } | undefined;

async function readVerifiedDevelopmentReport(): Promise<PlayerProjectionReport> {
  const { mtimeMs } = await stat(reportPath);
  if (cached?.mtimeMs === mtimeMs) return cached.report;

  const report = JSON.parse(await readFile(reportPath, "utf8")) as PlayerProjectionReport;
  if (
    report.evaluationKind !== "historical_simulation"
    || report.provenance?.databaseScope !== "development"
    || report.config?.evaluationSeason !== 2024
    || !Array.isArray(report.predictions)
    || report.predictions.length === 0
  ) {
    throw new Error("The development player projection report is incomplete or not a historical simulation");
  }
  cached = { mtimeMs, report };
  return report;
}

router.get("/consumer/player-projections", async (req, res): Promise<void> => {
  if (process.env.NODE_ENV !== "development") {
    res.json(GetConsumerPlayerProjectionsResponse.parse({
      status: "unavailable",
      message: "Historical player simulations are available only in the development preview. No live player forecasts or betting props are offered.",
      season: null,
      generatedAt: null,
      eligiblePlayers: 0,
      models: [],
      projections: [],
    }));
    return;
  }

  try {
    const report = await readVerifiedDevelopmentReport();
    const week = Math.max(...report.predictions.map((row) => row.week));
    const rows = report.predictions.filter((row) => row.season === 2024 && row.week === week);
    const models = Object.entries(report.families).map(([family, result]) => ({
      family,
      statistic: family,
      modelVersion: result.modelVersion,
      trainSamples: result.trainingSamples,
      evaluationSamples: result.eligiblePredictions,
      mae: result.metrics.meanAbsoluteError,
      rmse: result.metrics.rootMeanSquaredError,
      bias: result.metrics.meanBias,
    }));
    if (!rows.length || models.some((model) => model.mae === null || model.rmse === null || model.bias === null)) {
      throw new Error("The development player projection report has no measured preview rows");
    }
    res.json(GetConsumerPlayerProjectionsResponse.parse({
      status: "historical_simulation",
      message: `2024 regular-season week ${week} historical simulation; models trained on 2021–2023 and evaluated chronologically on 2024. Schedule kickoff times are unavailable in this development dataset, so all same-day evidence was withheld. Source publication times were not independently archived.`,
      season: 2024,
      generatedAt: report.generatedAt,
      eligiblePlayers: new Set(rows.map((row) => row.playerId)).size,
      models,
      projections: rows.map((row) => ({
        playerId: row.playerId,
        playerName: row.player,
        position: row.position,
        teamId: row.team,
        opponentTeamId: row.opponent,
        gameId: row.gameId,
        gameDate: row.gameDate,
        kickoffTime: row.kickoffTime,
        cutoffAt: row.calculationTimestamp,
        cutoffBasis: row.cutoffBasis,
        season: row.season,
        week: row.week,
        statistic: row.family,
        projectedValue: row.projectedStatistic,
        actualValue: row.actualStatistic,
        recentAverage: row.last3Baseline,
        seasonAverage: row.seasonToDateBaseline,
        recentVolume3: row.featureValues.priorLast3VolumeMean,
        recentVolume8: row.featureValues.priorLast8VolumeMean,
        volumeUnit: row.family === "qbPassingYards" ? "pass attempts" : row.family === "rbRushingYards" ? "carries" : "targets",
        priorAppearances: row.historicalSampleQuality.priorAppearances,
        sampleQuality: row.historicalSampleQuality.label,
        warnings: row.missingDataWarnings,
        modelVersion: row.modelVersion,
        calculatedAt: report.generatedAt,
      })),
    }));
  } catch (error) {
    req.log.error({ error }, "Historical player projection report unavailable");
    res.status(503).json({ error: "Historical player projections are unavailable", code: "consumer_data_unavailable" });
  }
});

router.get("/consumer/player-projections/upcoming-readiness", async (req, res): Promise<void> => {
  if (process.env.NODE_ENV !== "development" || process.env.REPLIT_DEPLOYMENT) {
    res.json(GetConsumerUpcomingPlayerProjectionReadinessResponse.parse({
      status: "unavailable",
      message: "Upcoming player forecast readiness is available only in a local development preview. No forecasts are generated or published.",
      asOf: null,
      upcomingGames: 0,
      eligibility: { eligible: 0, uncertain: 0, excluded: 0, reasons: {} },
      sourceFreshness: {
        roster: { latestSourceUpdatedAt: null, ageHours: null, status: "Unavailable outside local development" },
        injuries: { latestSourceUpdatedAt: null, ageHours: null, status: "Unavailable outside local development" },
        playerStats: { latestSourceUpdatedAt: null, ageHours: null, status: "Unavailable outside local development" },
      },
      blockers: ["This development-only readiness audit is not exposed in production."],
      forecasts: [],
    }));
    return;
  }

  try {
    const report = await readDevelopmentUpcomingPlayerReadiness();
    res.json(GetConsumerUpcomingPlayerProjectionReadinessResponse.parse(report));
  } catch (error) {
    req.log.error({ error }, "Upcoming player forecast readiness audit unavailable");
    res.status(503).json({ error: "Upcoming player forecast readiness is unavailable", code: "consumer_data_unavailable" });
  }
});

export default router;