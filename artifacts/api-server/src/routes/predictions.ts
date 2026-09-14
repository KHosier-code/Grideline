import { Router, type IRouter } from "express";
import { generateWeeklyLearningReport, generateLivePredictions, getCurrentWeekValidationReport, getLatestLearningReports, getLivePredictionBoard, getPredictionPerformance, getPredictionValidationFailures, gradeCompletedPredictions } from "../lib/live-predictions";
import { requireAdmin } from "../middlewares/admin";

const router: IRouter = Router();

router.get("/predictions/live", async (_req, res): Promise<void> => {
  try {
    res.json({ status: "success", predictions: await getLivePredictionBoard() });
  } catch (error) {
    res.status(500).json({ error: error instanceof Error ? error.message : "Live predictions unavailable" });
  }
});

router.get("/predictions/current-week", async (_req, res): Promise<void> => {
  try {
    res.json(await getCurrentWeekValidationReport());
  } catch (error) {
    res.status(500).json({ error: error instanceof Error ? error.message : "Current-week validation unavailable" });
  }
});

router.get("/predictions/validation-failures", async (req, res): Promise<void> => {
  try {
    const requestedLimit = Number(req.query.limit ?? 50);
    res.json({
      failures: await getPredictionValidationFailures(Number.isFinite(requestedLimit) ? requestedLimit : 50),
      note: "Validation failures are append-only audit records. They are excluded from official prediction views.",
    });
  } catch (error) {
    res.status(500).json({ error: error instanceof Error ? error.message : "Prediction validation audit unavailable" });
  }
});

router.get("/predictions/performance", async (_req, res): Promise<void> => {
  try {
    res.json(await getPredictionPerformance());
  } catch (error) {
    res.status(500).json({ error: error instanceof Error ? error.message : "Prediction performance unavailable" });
  }
});

router.get("/predictions/reports", async (_req, res): Promise<void> => {
  try {
    res.json({ reports: await getLatestLearningReports() });
  } catch (error) {
    res.status(500).json({ error: error instanceof Error ? error.message : "Learning reports unavailable" });
  }
});

router.post("/predictions/generate", requireAdmin, async (req, res): Promise<void> => {
  try {
    const result = await generateLivePredictions();
    req.log.info({ result }, "Live prediction generation completed");
    res.json(result);
  } catch (error) {
    req.log.error({ error }, "Live prediction generation failed");
    res.status(500).json({ error: error instanceof Error ? error.message : "Live prediction generation failed" });
  }
});

router.post("/predictions/grade", requireAdmin, async (req, res): Promise<void> => {
  try {
    res.json(await gradeCompletedPredictions());
  } catch (error) {
    req.log.error({ error }, "Prediction grading failed");
    res.status(500).json({ error: error instanceof Error ? error.message : "Prediction grading failed" });
  }
});

router.post("/predictions/reports/:season/:week", requireAdmin, async (req, res): Promise<void> => {
  try {
    const season = Number(req.params.season);
    const week = Number(req.params.week);
    if (!Number.isInteger(season) || !Number.isInteger(week)) {
      res.status(400).json({ error: "Season and week must be integers." });
      return;
    }
    res.json(await generateWeeklyLearningReport(season, week));
  } catch (error) {
    req.log.error({ error }, "Weekly learning report failed");
    res.status(500).json({ error: error instanceof Error ? error.message : "Weekly learning report failed" });
  }
});

export default router;