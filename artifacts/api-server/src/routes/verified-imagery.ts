import { Router, type IRouter } from "express";
import { db, imageryReviewsTable, nflversePlayerIdentitiesTable, playerGameStatsTable, playersTable, teamsTable } from "@workspace/db";
import { desc, eq } from "drizzle-orm";
import { getAuth } from "@clerk/express";
import { requireAdmin } from "../middlewares/admin";
import { approvedPlayerHeadshotUrl, currentImageEvidence, fetchCandidateImage, imageryFailure, invalidateImageEvidence, latestImageReviews, playerHeadshot, PLAYER_HEADSHOT_RIGHTS, resolvePlayerImageId, safeVerifiedImages } from "../lib/verified-imagery";

const router: IRouter = Router();

/** Explicitly reviewable source reconciliation; no assignments or database writes. */
router.get("/admin/verified-imagery/report", requireAdmin, async (_req, res): Promise<void> => {
  try {
    const [teams, players, statPlayers] = await Promise.all([
      db.select({ teamId: teamsTable.teamId, abbreviation: teamsTable.abbreviation, name: teamsTable.teamName }).from(teamsTable),
      db.select({ playerId: playersTable.playerId }).from(playersTable),
      db.selectDistinct({ playerId: playerGameStatsTable.playerId }).from(playerGameStatsTable),
    ]);
    const imagery = await safeVerifiedImages(teams);
    if (!imagery) {
      res.status(503).json({ status: "unavailable", reason: imageryFailure(), sources: null });
      return;
    }
    const unresolvedConsumerIds = [...new Set([...players, ...statPlayers].map(row => row.playerId))]
      .filter(id => !playerHeadshot(id, imagery.players, imagery.sources.roster?.sha256, imagery.approvals))
      .map(id => ({ id, reason: "no uniquely matched, rights-cleared and human-approved headshot" }));
    const reviews = await latestImageReviews();
    const identities = imagery.sources.players
      ? await db.select({ gsisId: nflversePlayerIdentitiesTable.gsisId, displayName: nflversePlayerIdentitiesTable.displayName,
        espnId: nflversePlayerIdentitiesTable.espnId })
        .from(nflversePlayerIdentitiesTable)
        .where(eq(nflversePlayerIdentitiesTable.importId, imagery.sources.players.importId!))
      : [];
    const identityById = new Map(identities.map(row => [row.gsisId, row]));
    const candidates = [...imagery.players.photos].map(([playerId, imageUrl]) => {
      const review = reviews.get(playerId);
      const current = Boolean(review && review.sourceHash === imagery.sources.roster?.sha256 && review.imageUrl === imageUrl);
      return { playerId, playerName: identityById.get(playerId)?.displayName ?? null,
        sourceEspnId: identityById.get(playerId)?.espnId ?? null,
        imageUrl, provider: "nflverse roster / linked photo host",
        sourceHash: imagery.sources.roster?.sha256 ?? null,
        rightsEvidence: PLAYER_HEADSHOT_RIGHTS,
        review: review ? { decision: current ? review.decision : "needs_review",
          previousDecision: review.decision, reason: review.reason, reviewerId: review.reviewerId,
          reviewedAt: review.reviewedAt.toISOString(), imageHash: review.imageHash,
          sourceHash: review.sourceHash, imageUrl: review.imageUrl } : null };
    });
    const categories = {
      unmatchedTeams: imagery.teams.unmatched,
      ambiguousTeams: imagery.teams.ambiguous,
      unresolvedRosterIds: imagery.players.unmatched,
      ambiguousIdentities: imagery.players.ambiguous,
      duplicateRosterIds: imagery.players.duplicateRosterIds,
      missingHeadshotUrls: imagery.players.missingUrl,
      unapprovedHeadshotHosts: imagery.players.unapprovedHosts,
      unresolvedConsumerIds,
    };
    res.set("Cache-Control", "no-store");
    res.json({
      status: imageryFailure() || imagery.sources.teams?.stale || imagery.sources.roster?.stale
        ? "stale" : imagery.crosswalkError || imagery.sourceErrors.length || !PLAYER_HEADSHOT_RIGHTS.approvedHosts.length ? "partial" : "ready",
      reason: imageryFailure() ?? ([imagery.crosswalkError, ...imagery.sourceErrors, PLAYER_HEADSHOT_RIGHTS.review].filter(Boolean).join("; ") || null),
      sources: imagery.sources,
      sourceNotice: "nflverse-data is published under CC BY 4.0 (https://github.com/nflverse/nflverse-data/blob/main/LICENSE.md). This covers the roster data, not the linked NFL-hosted photographs. Headshot display is disabled pending separate permission. Team-logo handling is a separate review.",
      playerHeadshotRights: PLAYER_HEADSHOT_RIGHTS,
      counts: Object.fromEntries(Object.entries(categories).map(([key, rows]) => [key, rows.length])),
      categories,
       candidates,
    });
  } catch (error) {
    res.status(503).json({ status: "unavailable", reason: error instanceof Error ? error.message : "Report unavailable" });
  }
});

const candidate = (playerId: string) => {
  const state = currentImageEvidence();
  const imageUrl = state?.players.photos.get(playerId);
  return state && imageUrl && state.sources.roster ? { state, imageUrl, sourceHash: state.sources.roster.sha256 } : null;
};

router.get("/admin/verified-imagery/candidates/:playerId/image", requireAdmin, async (req, res): Promise<void> => {
  const id = String(req.params.playerId);
  const evidence = candidate(id);
  if (!evidence || req.query.sourceHash !== evidence.sourceHash) {
    res.status(409).json({ error: "Candidate changed; reload review queue" }); return;
  }
  try {
    const image = await fetchCandidateImage(evidence.imageUrl);
    res.set({ "Cache-Control": "no-store", "X-Image-SHA256": image.hash, "Content-Type": image.type,
      "X-Content-Type-Options": "nosniff" });
    res.send(image.bytes);
  } catch {
    res.status(502).json({ error: "Candidate image unavailable" });
  }
});

router.get("/admin/verified-imagery/candidates/:playerId/history", requireAdmin, async (req, res): Promise<void> => {
  const id = String(req.params.playerId);
  if (!/^[\w.-]{1,100}$/.test(id)) { res.sendStatus(400); return; }
  const reviews = await db.select().from(imageryReviewsTable)
    .where(eq(imageryReviewsTable.playerId, id))
    .orderBy(imageryReviewsTable.id);
  res.set("Cache-Control", "no-store");
  res.json(reviews.map(review => ({
    ...review, reviewedAt: review.reviewedAt.toISOString(),
  })));
});

router.post("/admin/verified-imagery/candidates/:playerId/review", requireAdmin, async (req, res): Promise<void> => {
  const id = String(req.params.playerId);
  const { sourceHash, imageHash, decision, reason } = req.body ?? {};
  if (typeof sourceHash !== "string" || !/^[a-f0-9]{64}$/.test(imageHash) ||
    !["approved", "rejected"].includes(decision) || typeof reason !== "string" || !reason.trim() || reason.length > 1000) {
    res.status(400).json({ error: "Source hash, preview image hash, decision and review reason required" }); return;
  }
  const evidence = candidate(id);
  if (!evidence || evidence.sourceHash !== sourceHash || evidence.state.sources.roster?.stale) {
    res.status(409).json({ error: "Source changed or is stale; refresh before review" }); return;
  }
  if (decision === "approved" && !approvedPlayerHeadshotUrl(evidence.imageUrl)) {
    res.status(409).json({ error: "Public display rights are not approved for this image host" }); return;
  }
  try {
    const image = await fetchCandidateImage(evidence.imageUrl);
    if (image.hash !== imageHash) {
      res.status(409).json({ error: "Image bytes changed since preview; inspect the new image" }); return;
    }
    const [saved] = await db.insert(imageryReviewsTable).values({
      playerId: id, provider: "nflverse roster / linked photo host",
      sourceHash, imageUrl: evidence.imageUrl, imageHash, decision, reason: reason.trim(),
      rightsEvidence: JSON.stringify(PLAYER_HEADSHOT_RIGHTS),
      reviewerId: getAuth(req).userId!,
    }).returning({ id: imageryReviewsTable.id });
    invalidateImageEvidence();
    res.set("Cache-Control", "no-store");
    res.status(201).json({ reviewId: saved!.id, decision });
  } catch {
    res.status(503).json({ error: "Could not verify image or save review" });
  }
});

/** Never redirect to the provider: check rights, latest decision, and actual bytes every time. */
router.get("/verified-imagery/player/:playerId", async (req, res): Promise<void> => {
  const requestedId = String(req.params.playerId);
  const state = currentImageEvidence();
  const id = state && resolvePlayerImageId(requestedId, state.players);
  if (!id) { res.sendStatus(404); return; }
  const evidence = candidate(id);
  if (!evidence || !approvedPlayerHeadshotUrl(evidence.imageUrl)) { res.sendStatus(404); return; }
  try {
    const [review] = await db.select().from(imageryReviewsTable)
      .where(eq(imageryReviewsTable.playerId, id))
      .orderBy(desc(imageryReviewsTable.id)).limit(1);
    if (!review || review.decision !== "approved" || review.sourceHash !== evidence.sourceHash ||
      review.imageUrl !== evidence.imageUrl) { res.sendStatus(404); return; }
    const image = await fetchCandidateImage(evidence.imageUrl);
    if (image.hash !== review.imageHash) { res.sendStatus(404); return; }
    res.set({ "Cache-Control": "no-store", "Content-Type": image.type, "X-Content-Type-Options": "nosniff" });
    res.send(image.bytes);
  } catch { res.sendStatus(404); }
});
export default router;
