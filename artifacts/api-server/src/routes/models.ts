import { Router, type IRouter, type Request, type Response } from "express";
import { and, desc, eq } from "drizzle-orm";
import { db, modelPromotionHistoryTable, modelTrainingRunsTable } from "@workspace/db";
import { getAuth } from "@clerk/express";
import { generateLivePredictions, getModelDriftMonitoring } from "../lib/live-predictions";
import { getModelEvaluationAudit, getPhase4ModelLab, refitPhase6ProductionModels, trainPhase4Models, validateProductionCandidate, type Family } from "../lib/modeling";
import { PromotionSafetyGateError, runPromotionSafetyGate, type PromotionSafetyGateResult } from "../lib/promotion-safety-gate";
import { getAdminAuthStatus, requireAdmin } from "../middlewares/admin";

const router: IRouter = Router();
type TrainingRun = typeof modelTrainingRunsTable.$inferSelect;
type Promotion = typeof modelPromotionHistoryTable.$inferSelect;

type PromotionDependencies = {
  findRun: (modelVersion: string) => Promise<TrainingRun | undefined>;
  runSafetyGate: (modelVersion: string) => Promise<PromotionSafetyGateResult>;
  insertPromotion: (input: {
    run: TrainingRun;
    trainingCutoff: string;
    promotedBy: string;
    reason: string | null;
  }) => Promise<Promotion>;
  findCurrentPromotion: (family: string) => Promise<Promotion | null>;
  generateRevision: (now: Date) => ReturnType<typeof generateLivePredictions>;
  getPromotedBy: (req: Request) => string;
};

const defaultPromotionDependencies: PromotionDependencies = {
  findRun: async (modelVersion) => {
    const [run] = await db.select().from(modelTrainingRunsTable)
      .where(eq(modelTrainingRunsTable.modelVersion, modelVersion)).limit(1);
    return run;
  },
  runSafetyGate: runPromotionSafetyGate,
  insertPromotion: async ({ run, trainingCutoff, promotedBy, reason }) => {
    const [promotion] = await db.insert(modelPromotionHistoryTable).values({
      family: run.family,
      modelVersion: run.modelVersion,
      algorithm: run.algorithm,
      featureVersion: run.featureVersion,
      trainingCutoff,
      role: "production",
      promotedBy,
      reason,
    }).returning();
    return promotion;
  },
  findCurrentPromotion: async (family) => {
    const [current] = await db.select().from(modelPromotionHistoryTable)
      .where(and(eq(modelPromotionHistoryTable.family, family), eq(modelPromotionHistoryTable.role, "production")))
      .orderBy(desc(modelPromotionHistoryTable.promotedAt), desc(modelPromotionHistoryTable.id))
      .limit(1);
    return current ?? null;
  },
  generateRevision: generateLivePredictions,
  getPromotedBy: (req) => getAuth(req).userId ?? "unknown-admin",
};

export function createPromotionHandler(
  dependencies: PromotionDependencies = defaultPromotionDependencies,
) {
  return async (req: Request, res: Response): Promise<void> => {
    try {
      const modelVersion = typeof req.body?.modelVersion === "string" ? req.body.modelVersion.trim() : "";
      if (!modelVersion) {
        res.status(400).json({ error: "modelVersion is required." });
        return;
      }
      const run = await dependencies.findRun(modelVersion);
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
      const safetyGate = await dependencies.runSafetyGate(modelVersion);
      const promotion = await dependencies.insertPromotion({
        run,
        trainingCutoff: candidateValidation.trainingCutoff ?? "unavailable",
        promotedBy: dependencies.getPromotedBy(req),
        reason: typeof req.body?.notes === "string" ? req.body.notes.trim() || null : null,
      });
      const activeProductionModel = await dependencies.findCurrentPromotion(run.family);
      const revision = await dependencies.generateRevision(new Date());
      res.status(201).json({
        promotion,
        activeProductionModel,
        revision,
        safetyGate,
        candidateValidation,
        note: "Promotion is explicit and append-only. The latest production promotion for this family is used; no automatic promotion occurred.",
      });
    } catch (error) {
      req.log.error({ error }, "Model promotion failed");
      if (error instanceof PromotionSafetyGateError) {
        res.status(412).json({
          error: "Promotion blocked: the prediction safety gate failed. No promotion was recorded.",
          safetyGate: error.result,
        });
        return;
      }
      res.status(500).json({
        error: error instanceof Error ? error.message : "Model promotion failed",
        safetyGate: "not_run",
      });
    }
  };
}

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

router.get("/models/evaluations/audit", async (req, res): Promise<void> => {
  try {
    const family = typeof req.query.family === "string" && ["spread", "moneyline", "totals"].includes(req.query.family)
      ? req.query.family as Family
      : undefined;
    const integerQuery = (value: unknown) => {
      if (typeof value !== "string" || !/^\d+$/.test(value)) return undefined;
      return Number(value);
    };
    res.json(await getModelEvaluationAudit({
      modelVersion: typeof req.query.modelVersion === "string" ? req.query.modelVersion.trim() || undefined : undefined,
      family,
      testSeason: integerQuery(req.query.testSeason),
      week: integerQuery(req.query.week),
      limit: integerQuery(req.query.limit),
      cursor: integerQuery(req.query.cursor),
    }));
  } catch (error) {
    res.status(500).json({ error: error instanceof Error ? error.message : "Model evaluation audit unavailable" });
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

router.post("/models/promote", requireAdmin, createPromotionHandler());

export default router;