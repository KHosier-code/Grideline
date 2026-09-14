import { Router, type IRouter } from "express";
import { getPregameFeatureHealth, getPregameFeaturesForGame, listPregameFeatureAudit, rebuildPregameFeatures } from "../lib/features";
import { requireAdmin } from "../middlewares/admin";

const router: IRouter = Router();

router.get("/features/pregame/health", async (_req, res): Promise<void> => {
  res.json(await getPregameFeatureHealth());
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

router.post("/features/pregame/build", requireAdmin, async (req, res): Promise<void> => {
  try {
    const version = typeof req.body?.featureVersion === "string" ? req.body.featureVersion.trim() : undefined;
    res.json(await rebuildPregameFeatures(version || undefined));
  } catch (error) {
    req.log.error({ error }, "Pregame feature build failed");
    res.status(500).json({ error: error instanceof Error ? error.message : "Pregame feature build failed" });
  }
});

export default router;