import { Router, type IRouter, type Request, type Response } from "express";
import { and, desc, eq, inArray } from "drizzle-orm";
import { db, modelPromotionHistoryTable, modelTrainingRunsTable } from "@workspace/db";
import { getAuth } from "@clerk/express";
import { generateLivePredictions, generatePhase61ShadowPredictions, getLiveModelInputIntegrityAudit, getModelDriftMonitoring } from "../lib/live-predictions";
import { getModelEvaluationAudit, getModelEvaluationReport, getPhase4ModelLab, recoverPhase61ArtifactBackedModels, refitPhase6ProductionModels, trainPhase4Models, validateProductionCandidate, verifyArtifactIntegrity, isFittedModelArtifact, PHASE6_VECTOR_FEATURE_NAMES, type Family } from "../lib/modeling";
import { PHASE61_RELEASE_MODEL_VERSIONS, getModelArtifactImmutabilityStatus, importPhase61ReleaseCandidates, verifyPersistedPhase61ReleaseCandidates } from "../lib/phase61-release";
import { PromotionSafetyGateError, runPromotionSafetyGate, type PromotionSafetyGateResult } from "../lib/promotion-safety-gate";
import { getAdminAuthStatus, requireAdmin } from "../middlewares/admin";
import { getLifecycleVerificationReport } from "../lib/lifecycle-verification";

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
  verifyCurrentInference: (run: TrainingRun) => Promise<{
    passed: boolean;
    returned: number;
    vectorsDiffer: boolean;
  }>;
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
  verifyCurrentInference: async (run) => {
    const rows = await db.select().from(modelTrainingRunsTable)
      .where(eq(modelTrainingRunsTable.status, "refit_candidate"))
      .orderBy(desc(modelTrainingRunsTable.trainedAt), desc(modelTrainingRunsTable.id));
    const byFamily = new Map<string, TrainingRun>();
    for (const candidate of rows) {
      if (!candidate.modelVersion.startsWith("phase6-1-")
        || !verifyArtifactIntegrity(candidate).valid
        || !isFittedModelArtifact(candidate.modelArtifact, PHASE6_VECTOR_FEATURE_NAMES.length)
        || byFamily.has(candidate.family)) continue;
      byFamily.set(candidate.family, candidate);
    }
    byFamily.set(run.family, run);
    const shadow = await generatePhase61ShadowPredictions([...byFamily.values()].map((candidate) => ({
      family: candidate.family,
      modelVersion: candidate.modelVersion,
      modelArtifact: isFittedModelArtifact(candidate.modelArtifact, PHASE6_VECTOR_FEATURE_NAMES.length) ? candidate.modelArtifact : null,
      artifactId: isFittedModelArtifact(candidate.modelArtifact, PHASE6_VECTOR_FEATURE_NAMES.length) ? candidate.modelArtifact.metadata?.artifactId ?? null : null,
      artifactChecksum: isFittedModelArtifact(candidate.modelArtifact, PHASE6_VECTOR_FEATURE_NAMES.length) ? candidate.modelArtifact.metadata?.artifactChecksum ?? null : null,
      artifactMetadata: isFittedModelArtifact(candidate.modelArtifact, PHASE6_VECTOR_FEATURE_NAMES.length) ? candidate.modelArtifact.metadata ?? null : null,
      featureVersion: candidate.featureVersion,
      vectorFeatureNames: candidate.vectorFeatureNames,
      vectorSchemaFingerprint: candidate.vectorSchemaFingerprint,
    })), new Date(), 6);
    return {
      passed: shadow.returned >= 6 && shadow.vectorsDiffer,
      returned: shadow.returned,
      vectorsDiffer: shadow.vectorsDiffer,
    };
  },
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
      const artifactIntegrity = verifyArtifactIntegrity(run);
      if (!artifactIntegrity.valid) {
        res.status(409).json({
          error: "Model promotion rejected: this run has no independently verifiable immutable artifact.",
          reason: "unverifiable_artifact",
          artifactIntegrity,
        });
        return;
      }
      if (run.status === "refit_candidate"
        && !["materially_consistent", "better"].includes(String(run.metrics?.historicalComparisonClassification ?? ""))) {
        res.status(409).json({
          error: "Model promotion rejected: the 2025 holdout comparison is not acceptably consistent with the retained Phase 6 reference.",
          reason: "historical_comparison",
          candidateValidation,
          artifactIntegrity,
        });
        return;
      }
      const currentInference = await dependencies.verifyCurrentInference(run);
      if (!currentInference.passed) {
        res.status(409).json({
          error: "Model promotion rejected: current complete game inputs did not produce six distinct shadow inferences.",
          reason: "current_game_inference",
          currentInference,
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
      res.status(201).json({
        promotion,
        activeProductionModel: promotion,
        revision: {
          status: "deferred",
          reason: "The durable worker will generate the first artifact-backed revision after this atomic promotion record is committed.",
        },
        safetyGate,
        currentInference,
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

router.get("/models/lab", requireAdmin, async (_req, res): Promise<void> => {
  try {
    res.json(await getPhase4ModelLab());
  } catch (error) {
    res.status(500).json({ error: error instanceof Error ? error.message : "Model Lab unavailable" });
  }
});

router.get("/models/evaluations/audit", requireAdmin, async (req, res): Promise<void> => {
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
      evaluationRunId: typeof req.query.evaluationRunId === "string" ? req.query.evaluationRunId.trim() || undefined : undefined,
      family,
      testSeason: integerQuery(req.query.testSeason),
      week: integerQuery(req.query.week),
      gameId: typeof req.query.gameId === "string" ? req.query.gameId.trim() || undefined : undefined,
      limit: integerQuery(req.query.limit),
      cursor: integerQuery(req.query.cursor),
    }));
  } catch (error) {
    res.status(500).json({ error: error instanceof Error ? error.message : "Model evaluation audit unavailable" });
  }
});

router.get("/models/evaluations/report", requireAdmin, async (req, res): Promise<void> => {
  try {
    const integerQuery = (value: unknown) => typeof value === "string" && /^\d+$/.test(value) ? Number(value) : undefined;
    const family = typeof req.query.family === "string" && ["spread", "moneyline", "totals"].includes(req.query.family)
      ? req.query.family as Family : undefined;
    res.json(await getModelEvaluationReport({
      evaluationRunId: typeof req.query.evaluationRunId === "string" ? req.query.evaluationRunId.trim() || undefined : undefined,
      modelVersion: typeof req.query.modelVersion === "string" ? req.query.modelVersion.trim() || undefined : undefined,
      family,
      testSeason: integerQuery(req.query.testSeason),
      week: integerQuery(req.query.week),
      gameId: typeof req.query.gameId === "string" ? req.query.gameId.trim() || undefined : undefined,
    }));
  } catch (error) {
    res.status(400).json({ error: error instanceof Error ? error.message : "Model evaluation report unavailable" });
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

router.post("/models/recover-phase6-1", requireAdmin, async (req, res): Promise<void> => {
  try {
    const featureVersion = typeof req.body?.featureVersion === "string" && req.body.featureVersion.trim()
      ? req.body.featureVersion.trim()
      : "pregame-v3";
    if (featureVersion !== "pregame-v3") {
      res.status(400).json({ error: "Phase 6.1 recovery is restricted to the approved pregame-v3 feature version." });
      return;
    }
    const report = await recoverPhase61ArtifactBackedModels(featureVersion);
    const versions = report.candidates.map((candidate) => candidate.modelVersion);
    const candidateRows = versions.length
      ? await db.select().from(modelTrainingRunsTable).where(inArray(modelTrainingRunsTable.modelVersion, versions))
      : [];
    const shadow = await generatePhase61ShadowPredictions(candidateRows.map((run) => ({
      family: run.family,
      modelVersion: run.modelVersion,
      modelArtifact: isFittedModelArtifact(run.modelArtifact, PHASE6_VECTOR_FEATURE_NAMES.length) ? run.modelArtifact : null,
      artifactId: isFittedModelArtifact(run.modelArtifact, PHASE6_VECTOR_FEATURE_NAMES.length) ? run.modelArtifact.metadata?.artifactId ?? null : null,
      artifactChecksum: isFittedModelArtifact(run.modelArtifact, PHASE6_VECTOR_FEATURE_NAMES.length) ? run.modelArtifact.metadata?.artifactChecksum ?? null : null,
      artifactMetadata: isFittedModelArtifact(run.modelArtifact, PHASE6_VECTOR_FEATURE_NAMES.length) ? run.modelArtifact.metadata as Record<string, unknown> ?? null : null,
      featureVersion: run.featureVersion,
      vectorFeatureNames: run.vectorFeatureNames,
      vectorSchemaFingerprint: run.vectorSchemaFingerprint,
    })), new Date(), 6);
    const safetyGate = await runPromotionSafetyGate("phase6.1-recovery");
    const shadowGatePassed = shadow.returned >= 6
      && shadow.vectorsDiffer
      && shadow.writes.predictionSnapshots === 0
      && shadow.writes.consumerPredictions === 0;
    const candidates = report.candidates.map((candidate) => ({
      ...candidate,
      safety: {
        ...candidate.safety,
        predictionSafety: safetyGate,
        currentGameInference: shadowGatePassed ? "passed" : "failed",
      },
      promotionEligibility: candidate.artifactEligibility
        && safetyGate.status === "passed"
        && shadowGatePassed,
    }));
    const readiness = await getLiveModelInputIntegrityAudit(new Date());
    res.status(201).json({
      ...report,
      candidates,
      currentUpcomingGameReadiness: {
        productionReadiness: readiness,
        candidateShadowReadiness: {
          status: shadow.status,
          completeInputsReturned: shadow.returned,
          requiredMinimum: 6,
          allInputsComplete: shadow.returned >= 6,
        },
      },
      shadowPredictions: shadow,
      recoverySafetyGate: safetyGate,
      noAutomaticPromotion: true,
      consumerVisiblePredictions: false,
    });
  } catch (error) {
    req.log.error({ error }, "Phase 6.1 artifact recovery failed");
    res.status(500).json({ error: error instanceof Error ? error.message : "Phase 6.1 artifact recovery failed" });
  }
});

async function phase61ReleaseStatus() {
  const candidateRows = await db.select().from(modelTrainingRunsTable)
    .where(inArray(modelTrainingRunsTable.modelVersion, PHASE61_RELEASE_MODEL_VERSIONS));
  const artifactVerification = verifyPersistedPhase61ReleaseCandidates(candidateRows);
  const exactArtifactsVerified = artifactVerification.length === 3
    && artifactVerification.every((item) => item.exactVerified);
  const verifiedRows = exactArtifactsVerified ? candidateRows : [];
  const shadow = await generatePhase61ShadowPredictions(verifiedRows.map((run) => ({
    family: run.family,
    modelVersion: run.modelVersion,
    modelArtifact: isFittedModelArtifact(run.modelArtifact, PHASE6_VECTOR_FEATURE_NAMES.length) ? run.modelArtifact : null,
    artifactId: isFittedModelArtifact(run.modelArtifact, PHASE6_VECTOR_FEATURE_NAMES.length) ? run.modelArtifact.metadata?.artifactId ?? null : null,
    artifactChecksum: isFittedModelArtifact(run.modelArtifact, PHASE6_VECTOR_FEATURE_NAMES.length) ? run.modelArtifact.metadata?.artifactChecksum ?? null : null,
    artifactMetadata: isFittedModelArtifact(run.modelArtifact, PHASE6_VECTOR_FEATURE_NAMES.length) ? run.modelArtifact.metadata ?? null : null,
    featureVersion: run.featureVersion,
    vectorFeatureNames: run.vectorFeatureNames,
    vectorSchemaFingerprint: run.vectorSchemaFingerprint,
  })), new Date(), 6, { season: 2026, week: 2 });
  const featureRecoveryComplete = shadow.targetGames === 16
    && shadow.readyGames === 16
    && shadow.returned >= 6
    && shadow.vectorsDiffer
    && exactArtifactsVerified;
  return {
    state: featureRecoveryComplete && candidateRows.length === 3 ? "ready_for_manual_promotion_review" : "worker_recovery_pending",
    artifactsPresent: candidateRows.length,
    artifactsRequired: 3,
    exactArtifactsVerified,
    artifactVerification,
    featureRecovery: {
      workerOwned: true,
      season: 2026,
      week: 2,
      gamesRequired: 16,
      gamesFound: shadow.targetGames,
      gamesReady: shadow.readyGames,
      complete: featureRecoveryComplete,
      readiness: shadow.inputReadiness,
    },
    shadowInference: shadow,
    immutability: await getModelArtifactImmutabilityStatus(),
    noRetrainingOrRefit: true,
    noAutomaticPromotion: true,
    consumerVisiblePredictions: false,
  };
}

router.get("/admin/releases/phase6-1/status", requireAdmin, async (req, res): Promise<void> => {
  try {
    res.json(await phase61ReleaseStatus());
  } catch (error) {
    req.log.error({ error }, "Phase 6.1 release status failed");
    res.status(503).json({ error: "Phase 6.1 release status is temporarily unavailable." });
  }
});

router.post("/admin/releases/phase6-1/import", requireAdmin, async (req, res): Promise<void> => {
  try {
    if (req.body?.confirmation !== "IMPORT_EXACT_PHASE6_1_ARTIFACTS") {
      res.status(400).json({ error: "Exact release confirmation is required." });
      return;
    }
    const imported = await importPhase61ReleaseCandidates();
    const status = await phase61ReleaseStatus();
    res.status(status.featureRecovery.complete ? 201 : 202).json({
      ...imported,
      ...status,
    });
  } catch (error) {
    req.log.error({ error }, "Phase 6.1 release artifact import failed");
    res.status(409).json({ error: error instanceof Error ? error.message : "Phase 6.1 release artifact import failed" });
  }
});

router.get("/models/promotions", requireAdmin, async (_req, res): Promise<void> => {
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

router.get("/models/drift", requireAdmin, async (_req, res): Promise<void> => {
  try {
    res.json(await getModelDriftMonitoring());
  } catch (error) {
    res.status(500).json({ error: error instanceof Error ? error.message : "Model drift unavailable" });
  }
});

router.get("/admin/lifecycle-verification", requireAdmin, async (req, res): Promise<void> => {
  try {
    res.json(await getLifecycleVerificationReport());
  } catch (error) {
    req.log.error({ error }, "Lifecycle verification read failed");
    res.status(503).json({ error: "Lifecycle verification is temporarily unavailable." });
  }
});

router.post("/models/promote", requireAdmin, createPromotionHandler());

export default router;