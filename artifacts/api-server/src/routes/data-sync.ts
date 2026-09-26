import { Router, type IRouter } from "express";
import {
  CaptureOddsResponse,
  ListOddsAuditsQueryParams,
  ListOddsAuditsResponse,
  ListPlayerRecoveryReceiptsQueryParams,
  ListPlayerRecoveryReceiptsResponse,
  SyncScheduleBody,
  SyncScheduleResponse,
} from "@workspace/api-zod";
import { syncEspnDepthCharts, syncEspnInjuries } from "../lib/availability";
import { datasetUrl, syncNflverseHistory } from "../lib/nflverse";
import { captureOddsSnapshots, getOddsEventAudits } from "../lib/odds";
import { syncEspnScheduleCoverage } from "../lib/schedule";
import { requireAdmin } from "../middlewares/admin";
import { withFeedLock } from "../lib/feed-scheduler";
import { listPlayerRecoveryReceipts, PLAYER_RECOVERY_RECEIPT_RETENTION_DAYS } from "../lib/player-recovery-receipts";

const router: IRouter = Router();

const playerStats2026Url = datasetUrl("player_stats", 2026);

router.get("/admin/player-recovery/receipts", requireAdmin, async (req, res): Promise<void> => {
  const parsed = ListPlayerRecoveryReceiptsQueryParams.safeParse(req.query);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid receipt lookup." });
    return;
  }
  try {
    const receipts = await listPlayerRecoveryReceipts({
      receiptId: parsed.data.receiptId,
      limit: parsed.data.limit ?? 50,
    });
    res.json(ListPlayerRecoveryReceiptsResponse.parse({
      retentionDays: PLAYER_RECOVERY_RECEIPT_RETENTION_DAYS,
      receipts,
    }));
  } catch {
    req.log.error("Player recovery receipt read failed");
    res.status(500).json({ error: "Player recovery receipts are temporarily unavailable." });
  }
});

router.get("/data-sync/player-stats-2026", requireAdmin, (_req, res) => {
  res.json({ season: 2026, dataset: "player_stats", sourceUrl: playerStats2026Url });
});

router.post("/data-sync/player-stats-2026", requireAdmin, async (req, res): Promise<void> => {
  if (req.body?.sourceUrl !== playerStats2026Url || req.body?.confirmation !== "IMPORT_2026_PLAYER_STATS") {
    res.status(400).json({ error: "Confirm the exact 2026 weekly player-stat source before importing." });
    return;
  }
  try {
    req.log.info({ season: 2026, dataset: "player_stats", sourceUrl: playerStats2026Url }, "Scoped NFLverse import started");
    const result = await withFeedLock("nflverse", () =>
      syncNflverseHistory([2026], { datasets: ["player_stats"], refresh: true }));
    if (result === null) {
      res.status(409).json({ error: "NFLverse sync already running." });
      return;
    }
    req.log.info({ season: 2026, dataset: "player_stats", result }, "Scoped NFLverse import finished");
    res.status(result.status === "success" ? 200 : 502).json(result);
  } catch (error) {
    req.log.error({ error, season: 2026, dataset: "player_stats" }, "Scoped NFLverse import failed");
    res.status(502).json({ error: "2026 player-stat import failed; check the sync ledger." });
  }
});

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