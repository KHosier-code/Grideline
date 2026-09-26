import { Router, type IRouter } from "express";
import { db, playerGameStatsTable, playersTable, teamsTable } from "@workspace/db";
import { requireAdmin } from "../middlewares/admin";
import { imageryFailure, playerHeadshot, PLAYER_HEADSHOT_RIGHTS, safeVerifiedImages } from "../lib/verified-imagery";

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
      .filter(id => !playerHeadshot(id, imagery.players))
      .map(id => ({ id, reason: "no uniquely matched headshot with approved display rights" }));
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
    });
  } catch (error) {
    res.status(503).json({ status: "unavailable", reason: error instanceof Error ? error.message : "Report unavailable" });
  }
});
export default router;
