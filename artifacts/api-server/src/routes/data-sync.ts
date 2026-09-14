import { Router, type IRouter } from "express";
import {
  CaptureOddsResponse,
  ListOddsAuditsQueryParams,
  ListOddsAuditsResponse,
  SyncScheduleBody,
  SyncScheduleResponse,
} from "@workspace/api-zod";
import { syncEspnDepthCharts, syncEspnInjuries } from "../lib/availability";
import { syncNflverseHistory } from "../lib/nflverse";
import { captureOddsSnapshots, getOddsEventAudits } from "../lib/odds";
import { syncEspnScheduleCoverage } from "../lib/schedule";
import { requireAdmin } from "../middlewares/admin";
import { withFeedLock } from "../lib/feed-scheduler";

const router: IRouter = Router();

router.post("/data-sync/nflverse", requireAdmin, async (req, res): Promise<void> => {
  try {
    const seasons = Array.isArray(req.body?.seasons)
      ? req.body.seasons.map(Number).filter((value: number) => Number.isInteger(value) && value >= 2021 && value <= 2026)
      : undefined;
    const result = await withFeedLock("nflverse", () => syncNflverseHistory(seasons));
    if (result === null) { res.status(409).json({ error: "NFLverse sync already running" }); return; }
    res.json(result);
  } catch (error) {
    req.log.error({ error }, "NFLverse synchronization failed");
    res.status(500).json({ error: error instanceof Error ? error.message : "NFLverse synchronization failed" });
  }
});

router.post("/data-sync/injuries", requireAdmin, async (req, res): Promise<void> => {
  try {
    const result = await withFeedLock("injuries", () => syncEspnInjuries());
    if (result === null) { res.status(409).json({ error: "Injury sync already running" }); return; }
    res.json(result);
  } catch (error) {
    req.log.error({ error }, "Injury synchronization failed");
    res.status(502).json({ error: error instanceof Error ? error.message : "Injury synchronization failed" });
  }
});

router.post("/data-sync/depth-charts", requireAdmin, async (req, res): Promise<void> => {
  try {
    const result = await syncEspnDepthCharts();
    res.status(result.status === "failed" ? 502 : 200).json(result);
  } catch (error) {
    req.log.error({ error }, "Depth-chart synchronization failed");
    res.status(502).json({ error: error instanceof Error ? error.message : "Depth-chart synchronization failed" });
  }
});

router.post("/data-sync/schedule", requireAdmin, async (req, res): Promise<void> => {
  try {
    const parsed = SyncScheduleBody.safeParse(req.body ?? {});
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.message });
      return;
    }
    const input = parsed.data.season !== undefined && parsed.data.currentWeek !== undefined
      ? parsed.data
      : undefined;
    const result = await syncEspnScheduleCoverage(input);
    res.status(result.status === "failed" ? 502 : 200).json(SyncScheduleResponse.parse(result));
  } catch (error) {
    req.log.error({ error }, "Schedule synchronization failed");
    res.status(502).json({ error: error instanceof Error ? error.message : "Schedule synchronization failed" });
  }
});

router.post("/odds/capture", requireAdmin, async (req, res): Promise<void> => {
  try {
    const result = await captureOddsSnapshots();
    res
      .status(result.status === "failed" ? 502 : 200)
      .json(CaptureOddsResponse.parse(result));
  } catch (error) {
    // The adapter records provider failures without including the secret or
    // the keyed URL in the response/log.
    req.log.error(
      { error: error instanceof Error ? error.message : "Odds capture failed" },
      "Odds capture failed",
    );
    res.status(502).json({ error: "Odds capture failed." });
  }
});

router.get("/odds/audit", requireAdmin, async (req, res): Promise<void> => {
  const parsed = ListOddsAuditsQueryParams.safeParse(req.query);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  try {
    const audits = await getOddsEventAudits(parsed.data);
    res.json(ListOddsAuditsResponse.parse(audits));
  } catch (error) {
    req.log.error({ error }, "Odds audit read failed");
    res.status(500).json({ error: "Odds audit is temporarily unavailable." });
  }
});

export default router;