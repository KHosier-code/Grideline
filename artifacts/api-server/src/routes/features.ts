import { Router, type IRouter } from "express";
import { getPregameFeatureHealth, getPregameFeaturesForGame, listPregameFeatureAudit, rebuildPregameFeatures } from "../lib/features";
import {
  getPersonnelContextForGame,
  listPersonnelContextAudit,
  PREGAME_PERSONNEL_CONTEXT_VERSION,
  rebuildPregamePersonnelContextFeatures,
} from "../lib/personnel-context";
import { requireAdmin } from "../middlewares/admin";

const router: IRouter = Router();

router.get("/features/pregame/health", async (req, res): Promise<void> => {
  const featureVersion = typeof req.query.featureVersion === "string" ? req.query.featureVersion : undefined;
  res.json(await getPregameFeatureHealth(featureVersion));
});

router.get("/features/pregame/game/:gameId", async (req, res): Promise<void> => {
  res.json(await getPregameFeaturesForGame(req.params.gameId));
});

router.get("/features/audit", async (req, res): Promise<void> => {
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

router.get("/features/personnel-context/game/:gameId", async (req, res): Promise<void> => {
  const gameId = Array.isArray(req.params.gameId) ? req.params.gameId[0] : req.params.gameId;
  const context = await getPersonnelContextForGame(gameId);
  if (!context) {
    res.status(404).json({ error: "Game not found" });
    return;
  }
  res.json(context);
});

router.get("/features/personnel-context/audit", async (req, res): Promise<void> => {
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

router.post("/features/pregame/build", requireAdmin, async (req, res): Promise<void> => {
  try {
    const version = typeof req.body?.featureVersion === "string" ? req.body.featureVersion.trim() : undefined;
    if (version === PREGAME_PERSONNEL_CONTEXT_VERSION) {
      res.json(await rebuildPregamePersonnelContextFeatures());
      return;
    }
    res.json(await rebuildPregameFeatures(version || undefined));
  } catch (error) {
    req.log.error({ error }, "Pregame feature build failed");
    res.status(500).json({ error: error instanceof Error ? error.message : "Pregame feature build failed" });
  }
});

export default router;