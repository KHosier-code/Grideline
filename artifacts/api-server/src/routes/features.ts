import { Router, type IRouter } from "express";
import { getPregameFeatureHealth, getPregameFeaturesForGame, listPregameFeatureAudit, rebuildPregameFeatures } from "../lib/features";
import {
  getPersonnelContextForGame,
  listPersonnelContextAudit,
  PREGAME_PERSONNEL_CONTEXT_VERSION,
  rebuildPregamePersonnelContextFeatures,
} from "../lib/personnel-context";
import { requireAdmin } from "../middlewares/admin";
import { getChallengerReadinessReport, getCurrentPersonnelCoverage } from "../lib/personnel-coverage";
import { getLiveModelInputIntegrityAudit } from "../lib/live-predictions";
import {
  getCurrentDepthValidationReport,
  getCurrentGamePersonnel,
  getCurrentQbEvidence,
  getCurrentTeamDepth,
  getCurrentWrCbEvidence,
} from "../lib/current-personnel";

const router: IRouter = Router();
type PersonnelCoverageResult = Awaited<ReturnType<typeof getCurrentPersonnelCoverage>>;
let personnelCoverageCache: { expiresAt: number; value: PersonnelCoverageResult } | null = null;
let personnelCoverageRequest: Promise<PersonnelCoverageResult> | null = null;
type ChallengerReadinessResult = Awaited<ReturnType<typeof getChallengerReadinessReport>>;
let challengerReadinessCache: { expiresAt: number; value: ChallengerReadinessResult } | null = null;
let challengerReadinessRequest: Promise<ChallengerReadinessResult> | null = null;

router.get("/features/pregame/health", requireAdmin, async (req, res): Promise<void> => {
  const featureVersion = typeof req.query.featureVersion === "string" ? req.query.featureVersion : undefined;
  res.json(await getPregameFeatureHealth(featureVersion));
});

router.get("/features/pregame/game/:gameId", requireAdmin, async (req, res): Promise<void> => {
  const featureVersion = typeof req.query.featureVersion === "string" ? req.query.featureVersion : undefined;
  const gameId = Array.isArray(req.params.gameId) ? req.params.gameId[0] : req.params.gameId;
  res.json(await getPregameFeaturesForGame(gameId, featureVersion));
});

router.get("/features/audit", requireAdmin, async (req, res): Promise<void> => {
  const numberParam = (key: string) => {
    const value = req.query[key];
    return typeof value === "string" && Number.isInteger(Number(value)) ? Number(value) : undefined;
  };
  const rows = await listPregameFeatureAudit({
    season: numberParam("season"),
    week: numberParam("week"),
    gameId: typeof req.query.gameId === "string" ? req.query.gameId : undefined,
    teamId: typeof req.query.teamId === "string" ? req.query.teamId : undefined,
    featureVersion: typeof req.query.featureVersion === "string" ? req.query.featureVersion : undefined,
  });
  const limit = numberParam("limit") ?? 600;
  res.json(rows.slice(0, Math.max(1, Math.min(limit, 2000))));
});

router.get("/features/live-input-integrity", requireAdmin, async (_req, res): Promise<void> => {
  res.json(await getLiveModelInputIntegrityAudit());
});

router.get("/features/personnel-context/game/:gameId", requireAdmin, async (req, res): Promise<void> => {
  const gameId = Array.isArray(req.params.gameId) ? req.params.gameId[0] : req.params.gameId;
  const context = await getPersonnelContextForGame(gameId);
  if (!context) {
    res.status(404).json({ error: "Game not found" });
    return;
  }
  res.json(context);
});

router.get("/features/personnel-context/audit", requireAdmin, async (req, res): Promise<void> => {
  const numberParam = (key: string) => {
    const value = req.query[key];
    return typeof value === "string" && Number.isInteger(Number(value)) ? Number(value) : undefined;
  };
  const rows = await listPersonnelContextAudit({
    gameId: typeof req.query.gameId === "string" ? req.query.gameId : undefined,
    teamId: typeof req.query.teamId === "string" ? req.query.teamId : undefined,
    season: numberParam("season"),
    week: numberParam("week"),
  });
  const limit = numberParam("limit") ?? 200;
  res.json(rows.slice(0, Math.max(1, Math.min(limit, 1000))));
});

router.get("/features/personnel-context/coverage", requireAdmin, async (_req, res): Promise<void> => {
  if (personnelCoverageCache && personnelCoverageCache.expiresAt > Date.now()) {
    res.json(personnelCoverageCache.value);
    return;
  }
  personnelCoverageRequest ??= getCurrentPersonnelCoverage().finally(() => {
    personnelCoverageRequest = null;
  });
  const value = await personnelCoverageRequest;
  personnelCoverageCache = { expiresAt: Date.now() + 60_000, value };
  res.json(value);
});

router.get("/features/personnel-context/challenger-readiness", requireAdmin, async (_req, res): Promise<void> => {
  if (challengerReadinessCache && challengerReadinessCache.expiresAt > Date.now()) {
    res.json(challengerReadinessCache.value);
    return;
  }
  challengerReadinessRequest ??= getChallengerReadinessReport().finally(() => {
    challengerReadinessRequest = null;
  });
  const value = await challengerReadinessRequest;
  challengerReadinessCache = { expiresAt: Date.now() + 5 * 60_000, value };
  res.json(value);
});

function routeParam(value: string | string[]) {
  return Array.isArray(value) ? value[0]! : value;
}

router.get("/features/personnel/current/team/:teamId", requireAdmin, async (req, res): Promise<void> => {
  const value = await getCurrentTeamDepth(routeParam(req.params.teamId));
  if (!value) {
    res.status(404).json({ error: "Team not found", code: "TEAM_NOT_FOUND" });
    return;
  }
  res.json(value);
});

router.get("/features/personnel/current/game/:gameId", requireAdmin, async (req, res): Promise<void> => {
  const value = await getCurrentGamePersonnel(routeParam(req.params.gameId));
  if (!value) {
    res.status(404).json({ error: "Game not found", code: "GAME_NOT_FOUND" });
    return;
  }
  res.json(value);
});

router.get("/features/personnel/current/team/:teamId/qb", requireAdmin, async (req, res): Promise<void> => {
  const value = await getCurrentQbEvidence(routeParam(req.params.teamId));
  if (!value) {
    res.status(404).json({ error: "Team not found", code: "TEAM_NOT_FOUND" });
    return;
  }
  res.json(value);
});

router.get("/features/personnel/current/team/:teamId/wr-cb", requireAdmin, async (req, res): Promise<void> => {
  const value = await getCurrentWrCbEvidence(routeParam(req.params.teamId));
  if (!value) {
    res.status(404).json({ error: "Team not found", code: "TEAM_NOT_FOUND" });
    return;
  }
  res.json(value);
});

router.get("/features/personnel/current/validation", requireAdmin, async (_req, res): Promise<void> => {
  res.json(await getCurrentDepthValidationReport());
});

router.post("/features/pregame/build", requireAdmin, async (req, res): Promise<void> => {
  try {
    const version = typeof req.body?.featureVersion === "string" ? req.body.featureVersion.trim() : undefined;
    if (version === PREGAME_PERSONNEL_CONTEXT_VERSION) {
      res.json(await rebuildPregamePersonnelContextFeatures());
      return;
    }
    res.json(await rebuildPregameFeatures(version || undefined, new Date(), { futureOnly: true }));
  } catch (error) {
    req.log.error({ error }, "Pregame feature build failed");
    res.status(500).json({ error: error instanceof Error ? error.message : "Pregame feature build failed" });
  }
});

export default router;