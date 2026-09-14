import { Router, type IRouter } from "express";
import { syncEspnDepthCharts, syncEspnInjuries } from "../lib/availability";
import { syncNflverseHistory } from "../lib/nflverse";

const router: IRouter = Router();

router.post("/data-sync/nflverse", async (req, res): Promise<void> => {
  try {
    const seasons = Array.isArray(req.body?.seasons)
      ? req.body.seasons.map(Number).filter((value: number) => Number.isInteger(value) && value >= 2021 && value <= 2026)
      : undefined;
    res.json(await syncNflverseHistory(seasons));
  } catch (error) {
    req.log.error({ error }, "NFLverse synchronization failed");
    res.status(500).json({ error: error instanceof Error ? error.message : "NFLverse synchronization failed" });
  }
});

router.post("/data-sync/injuries", async (req, res): Promise<void> => {
  try {
    res.json(await syncEspnInjuries());
  } catch (error) {
    req.log.error({ error }, "Injury synchronization failed");
    res.status(502).json({ error: error instanceof Error ? error.message : "Injury synchronization failed" });
  }
});

router.post("/data-sync/depth-charts", async (req, res): Promise<void> => {
  try {
    const result = await syncEspnDepthCharts();
    res.status(result.status === "failed" ? 502 : 200).json(result);
  } catch (error) {
    req.log.error({ error }, "Depth-chart synchronization failed");
    res.status(502).json({ error: error instanceof Error ? error.message : "Depth-chart synchronization failed" });
  }
});

export default router;