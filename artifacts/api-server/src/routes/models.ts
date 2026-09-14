import { Router, type IRouter } from "express";
import { and, desc, eq } from "drizzle-orm";
import { db, modelPromotionHistoryTable, modelTrainingRunsTable } from "@workspace/db";
import { getAuth } from "@clerk/express";
import { generateLivePredictions, getModelDriftMonitoring } from "../lib/live-predictions";
import { getPhase4ModelLab, refitPhase6ProductionModels, trainPhase4Models, validateProductionCandidate } from "../lib/modeling";
import { runPromotionSafetyGate } from "../lib/promotion-safety-gate";
import { getAdminAuthStatus, requireAdmin } from "../middlewares/admin";

const router: IRouter = Router();

router.get("/auth/admin-status", (req, res): void => {
  res.json(getAdminAuthStatus(req));
});

router.get("/models/lab", async (_req, res): Promise<void> => {
  try {
    res.json(await getPhase4ModelLab());
  } catch (error) {
    res.status(500).json({ error: error instanceof Error ? error.message : "Model Lab unavailable" });
  }
});

router.post("/models/train", requireAdmin, async (req, res): Promise<void> => {
  try {
    const featureVersion = typeof req.body?.featureVersion === "string" ? req.body.featureVersion.trim() : undefined;
    res.json(await trainPhase4Models(featureVersion));
  } catch (error) {
    req.log.error({ error }, "Phase 4 model training failed");
    res.status(500).json({ error: error instanceof Error ? error.message : "Phase 4 model training failed" });
  }
});

router.post("/models/refit-production", requireAdmin, async (req, res): Promise<void> => {
  try {
    const featureVersion = typeof req.body?.featureVersion === "string" ? req.body.featureVersion.trim() : undefined;
    res.status(201).json(await refitPhase6ProductionModels(featureVersion));
  } catch (error) {
    req.log.error({ error }, "Phase 6 production refit failed");
    res.status(500).json({ error: error instanceof Error ? error.message : "Phase 6 production refit failed" });
  }
});

router.get("/models/promotions", async (_req, res): Promise<void> => {
  try {
    const history = await db.select().from(modelPromotionHistoryTable)
      .orderBy(desc(modelPromotionHistoryTable.promotedAt), desc(modelPromotionHistoryTable.id));
    const current: Record<string, typeof history[number]> = {};
    for (const promotion of history) if (!current[promotion.family]) current[promotion.family] = promotion;
    res.json({ history, current, automatic: false });
  } catch (error) {
    res.status(500).json({ error: error instanceof Error ? error.message : "Promotion history unavailable" });
  }
});

router.get("/models/drift", async (_req, res): Promise<void> => {
  try {
    res.json(await getModelDriftMonitoring());
  } catch (error) {
    res.status(500).json({ error: error instanceof Error ? error.message : "Model drift unavailable" });
  }
});

router.post("/models/promote", requireAdmin, async (req, res): Promise<void> => {
  try {
    const modelVersion = typeof req.body?.modelVersion === "string" ? req.body.modelVersion.trim() : "";
    if (!modelVersion) {
      res.status(400).json({ error: "modelVersion is required." });
      return;
    }
    const [run] = await db.select().from(modelTrainingRunsTable)
      .where(eq(modelTrainingRunsTable.modelVersion, modelVersion)).limit(1);
    if (!run) {
      res.status(404).json({ error: "The requested model run does not exist." });
      return;
    }
    const candidateValidation = validateProductionCandidate(run);
    if (!candidateValidation.valid) {
      res.status(409).json({
        error: "Model promotion rejected: the selected run is not compatible with the production model policy.",
        reason: "incompatible_model",
        candidateValidation,
      });
      return;
    }
    const safetyGate = await runPromotionSafetyGate();
    const auth = getAuth(req);
    const trainingCutoff = candidateValidation.trainingCutoff ?? "unavailable";
    const [promotion] = await db.insert(modelPromotionHistoryTable).values({
      family: run.family,
      modelVersion: run.modelVersion,
      algorithm: run.algorithm,
      featureVersion: run.featureVersion,
      trainingCutoff,
      role: "production",
      promotedBy: auth.userId ?? "unknown-admin",
      reason: typeof req.body?.notes === "string" ? req.body.notes.trim() || null : null,
    }).returning();
    const current = await db.select().from(modelPromotionHistoryTable)
      .where(and(eq(modelPromotionHistoryTable.family, run.family), eq(modelPromotionHistoryTable.role, "production")))
      .orderBy(desc(modelPromotionHistoryTable.promotedAt), desc(modelPromotionHistoryTable.id))
      .limit(1);
    const revision = await generateLivePredictions(new Date());
    res.status(201).json({
      promotion,
      activeProductionModel: current[0] ?? null,
      revision,
      safetyGate,
      candidateValidation,
      note: "Promotion is explicit and append-only. The latest production promotion for this family is used; no automatic promotion occurred.",
    });
  } catch (error) {
    req.log.error({ error }, "Model promotion failed");
    const message = error instanceof Error ? error.message : "Model promotion failed";
    const safetyGateFailure = message.startsWith("Promotion safety gate failed.");
    res.status(safetyGateFailure ? 412 : 500).json({
      error: safetyGateFailure ? "Promotion blocked: the prediction safety gate failed. No promotion was recorded." : message,
      safetyGate: safetyGateFailure ? "failed" : "not_run",
      detail: safetyGateFailure ? message : undefined,
    });
  }
});

export default router;