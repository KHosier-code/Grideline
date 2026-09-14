import { Router, type IRouter } from "express";
import { getPhase4ModelLab, trainPhase4Models } from "../lib/modeling";
import { requireAdmin } from "../middlewares/admin";

const router: IRouter = Router();

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

export default router;