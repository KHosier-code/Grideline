import { Router, type IRouter } from "express";
import {
  CaptureOddsResponse,
  ListOddsAuditsQueryParams,
  ListOddsAuditsResponse,
  ListPlayerRecoveryReceiptsQueryParams,
  ListPlayerRecoveryReceiptsResponse,
  GetPlayerRecoveryReceiptCleanupHealthResponse,
  SyncScheduleBody,
  SyncScheduleResponse,
} from "@workspace/api-zod";
import { syncEspnDepthCharts, syncEspnInjuries } from "../lib/availability";
import { datasetUrl, syncNflverseHistory } from "../lib/nflverse";
import { ODDS_EXPECTED_REQUEST_COST, approveNextOddsSpend, captureOddsSnapshots, getFreeOddsQuota, getOddsEventAudits, reconcileOddsRequest } from "../lib/odds";
import { randomUUID } from "node:crypto";
import { syncEspnScheduleCoverage } from "../lib/schedule";
import { getAdminAuthStatus, requireAdmin } from "../middlewares/admin";
import { withFeedLock } from "../lib/feed-scheduler";
import { getPlayerRecoveryReceiptCleanupHealth, listPlayerRecoveryReceipts, PLAYER_RECOVERY_RECEIPT_RETENTION_DAYS } from "../lib/player-recovery-receipts";

const router: IRouter = Router();

const playerStats2026Url = datasetUrl("player_stats", 2026);

router.get("/admin/player-recovery/cleanup-health", requireAdmin, async (req, res): Promise<void> => {
  try {
    res.json(GetPlayerRecoveryReceiptCleanupHealthResponse.parse(await getPlayerRecoveryReceiptCleanupHealth()));
  } catch {
    req.log.error("Player recovery receipt cleanup health read failed");
    res.status(500).json({ error: "Player recovery receipt cleanup health is temporarily unavailable." });
  }
});

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

// This does not mark the earlier request resolved. It authorizes a single
// separately logged attempt only when the administrator accepts duplicate
// billing risk and a current zero-cost quota check confirms enough credits.
router.post("/admin/odds/one-time-risk-capture", requireAdmin, async (req, res): Promise<void> => {
  const body = req.body;
  if (body?.confirmation !== "I_ACCEPT_A_POSSIBLE_DUPLICATE_CHARGE_FOR_ONE_ODDS_CALL"
    || !Number.isSafeInteger(body.requestId) || body.requestId <= 0
    || body.maxCredits !== ODDS_EXPECTED_REQUEST_COST) {
    res.status(400).json({ error: "Confirm the blocked request and one three-credit call." });
    return;
  }
  try {
    const quota = await getFreeOddsQuota();
    if (quota.remaining < body.maxCredits) {
      res.status(409).json({ error: "Insufficient verified credits; no paid request was started." });
      return;
    }
    const result = await captureOddsSnapshots({
      intentKey: `operator-one-time:${randomUUID()}`,
      riskApproval: {
        blockedRequestId: body.requestId, maxCredits: body.maxCredits,
        verifiedRemaining: quota.remaining, verifiedAt: quota.checkedAt,
        approvedBy: getAdminAuthStatus(req).userId!,
      },
    });
    req.log.info({ requestId: result.requestId, blockedRequestId: body.requestId,
      status: result.status, creditsUsed: result.creditsUsed },
    "One-time risk-accepted odds capture completed");
    res.status(result.status === "failed" ? 502 : result.status === "skipped" ? 409 : 200)
      .json(CaptureOddsResponse.parse(result));
  } catch (error) {
    req.log.error({ error: error instanceof Error ? error.message : "Odds capture failed" },
      "One-time risk-accepted capture failed");
    res.status(502).json({ error: "No confirmed capture; inspect the paid request ledger before retrying." });
  }
});

// These operator-only attestations do not call the provider. The confirmation
// requires a reviewed receipt and independent assurance the old worker stopped.
router.post("/admin/odds/reconcile", requireAdmin, async (req, res): Promise<void> => {
  const body = req.body;
  if (body?.confirmation !== "PROVIDER_RECEIPT_VERIFIED_AND_OLD_REQUEST_STOPPED"
    || !Number.isSafeInteger(body.requestId) || !Number.isSafeInteger(body.billedCredits)
    || !Number.isSafeInteger(body.verifiedRemaining)
    || !["completed", "failed"].includes(body.providerOutcome)
    || typeof body.evidenceReference !== "string" || typeof body.evidenceCheckedAt !== "string") {
    res.status(400).json({ error: "A verified provider receipt and stopped-request attestation are required." });
    return;
  }
  try {
    const id = await reconcileOddsRequest({
      requestId: body.requestId, providerOutcome: body.providerOutcome,
      billedCredits: body.billedCredits, verifiedRemaining: body.verifiedRemaining,
      evidenceReference: body.evidenceReference, evidenceCheckedAt: new Date(body.evidenceCheckedAt),
      approvedBy: getAdminAuthStatus(req).userId!,
    });
    req.log.info({ requestId: body.requestId, resolutionId: id }, "Odds request reconciled without provider contact");
    res.status(201).json({ resolutionId: id, captureAuthorized: false });
  } catch (error) {
    req.log.warn({ error }, "Odds request reconciliation refused");
    res.status(409).json({ error: "Reconciliation refused; check request state and evidence." });
  }
});

router.post("/admin/odds/approve-spend", requireAdmin, async (req, res): Promise<void> => {
  const body = req.body;
  if (body?.confirmation !== "APPROVE_ONE_FUTURE_SCHEDULED_PAID_ODDS_REQUEST"
    || !Number.isSafeInteger(body.requestId) || !Number.isSafeInteger(body.maxCredits)
    || typeof body.intentKey !== "string" || typeof body.approvalReference !== "string") {
    res.status(400).json({ error: "An exact future intent and explicit credit budget are required." });
    return;
  }
  try {
    const id = await approveNextOddsSpend({
      requestId: body.requestId, intentKey: body.intentKey, maxCredits: body.maxCredits,
      approvalReference: body.approvalReference, approvedBy: getAdminAuthStatus(req).userId!,
    });
    req.log.info({ requestId: body.requestId, approvalId: id }, "One future paid odds intent approved");
    res.status(201).json({ approvalId: id, intentKey: body.intentKey, maxCredits: body.maxCredits });
  } catch (error) {
    req.log.warn({ error }, "Odds spend approval refused");
    res.status(409).json({ error: "Approval refused; check resolution, budget and future intent." });
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