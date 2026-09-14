import { Router, type IRouter } from "express";
import { getPregameFeatureHealth, getPregameFeaturesForGame, rebuildPregameFeatures } from "../lib/features";
import { requireAdmin } from "../middlewares/admin";

const router: IRouter = Router();

router.get("/features/pregame/health", async (_req, res): Promise<void> => {
  res.json(await getPregameFeatureHealth());
});

router.get("/features/pregame/game/:gameId", async (req, res): Promise<void> => {
  res.json(await getPregameFeaturesForGame(req.params.gameId));
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