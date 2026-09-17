import { Router, type IRouter } from "express";
import { desc, eq } from "drizzle-orm";
import { db, confidenceMethodologiesTable, predictionConfidenceResultsTable } from "@workspace/db";
import { requireAdmin } from "../middlewares/admin";
import { CONFIDENCE_NORMALIZATION, CONFIDENCE_THRESHOLDS, CONFIDENCE_VERSION, CONFIDENCE_WEIGHTS, methodologyChecksum } from "../lib/confidence-framework";
import { captureConfidenceResults } from "../lib/confidence-capture";

const router: IRouter = Router();

router.get("/admin/confidence/audit", requireAdmin, async (_req, res): Promise<void> => {
  try {
    const [methodology] = await db.select().from(confidenceMethodologiesTable)
      .where(eq(confidenceMethodologiesTable.confidenceVersion, CONFIDENCE_VERSION)).limit(1);
    const results = await db.select().from(predictionConfidenceResultsTable)
      .where(eq(predictionConfidenceResultsTable.confidenceVersion, CONFIDENCE_VERSION))
      .orderBy(desc(predictionConfidenceResultsTable.calculatedAt), desc(predictionConfidenceResultsTable.id)).limit(5000);
    res.json({
      version: CONFIDENCE_VERSION,
      checksum: methodology?.checksum ?? methodologyChecksum(),
      weights: methodology?.weights ?? CONFIDENCE_WEIGHTS,
      thresholds: methodology?.thresholds ?? CONFIDENCE_THRESHOLDS,
      normalizationRules: methodology?.normalizationRules ?? CONFIDENCE_NORMALIZATION,
      historicalEvidence: methodology?.historicalEvidence ?? {
        status: "insufficient",
        source: "nflverse/nfldata games.csv",
        designation: "source_designated_recorded",
        limitations: ["Recorded lines have no sportsbook or observation timestamps; no closing, CLV, ROI, or profitability claim is made."],
      },
      results,
    });
  } catch (error) {
    _req.log.error({ error }, "Confidence audit read failed");
    res.status(503).json({ error: "Confidence audit is temporarily unavailable", code: "confidence_audit_unavailable" });
  }
});

router.post("/admin/confidence/calculate", requireAdmin, async (req, res): Promise<void> => {
  const season = req.query.season === undefined ? undefined : Number(req.query.season);
  const week = req.query.week === undefined ? undefined : Number(req.query.week);
  if ((season !== undefined && (!Number.isInteger(season) || season < 2000 || season > 2100))
    || (week !== undefined && (!Number.isInteger(week) || week < 1 || week > 25))) {
    res.status(400).json({ error: "season and week must be valid integers", code: "invalid_confidence_window" });
    return;
  }
  try {
    res.json(await captureConfidenceResults({ season, week }));
  } catch (error) {
    req.log.error({ error }, "Confidence calculation failed");
    res.status(503).json({ error: "Confidence calculation is temporarily unavailable", code: "confidence_calculation_unavailable" });
  }
});

export default router;