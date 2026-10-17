import { and, gte, inArray, isNotNull } from "drizzle-orm";
import { db, injuriesTable, nflversePlayerIdentitiesTable } from "@workspace/db";
import { INJURY_STATUS_WINDOW_MS, statusAt, type InjuryStatusAt, type StatusRow } from "./touchdown-board";

/**
 * The TD board's players (nflverse ids) matched to ESPN's injury report
 * through the nflverse id map. The weekly picks job reads nflverse's injury
 * file, which can post days late; this is the site's own ESPN capture.
 */
export async function injuryTimeline(gsisIds: string[], since: Date): Promise<InjuryStatusAt> {
  if (!gsisIds.length) return () => null;
  const identities = await db.selectDistinct({ gsisId: nflversePlayerIdentitiesTable.gsisId, espnId: nflversePlayerIdentitiesTable.espnId })
    .from(nflversePlayerIdentitiesTable)
    .where(and(inArray(nflversePlayerIdentitiesTable.gsisId, gsisIds), isNotNull(nflversePlayerIdentitiesTable.espnId)));
  const espnByGsis = new Map(identities.map((row) => [row.gsisId, row.espnId!]));
  if (!espnByGsis.size) return () => null;
  const rows = await db.select({ playerId: injuriesTable.playerId, gameStatus: injuriesTable.gameStatus, snapshotTimestamp: injuriesTable.snapshotTimestamp })
    .from(injuriesTable)
    .where(and(inArray(injuriesTable.playerId, [...new Set(espnByGsis.values())]), gte(injuriesTable.snapshotTimestamp, new Date(since.getTime() - INJURY_STATUS_WINDOW_MS))));
  const byEspn = new Map<string, StatusRow[]>();
  for (const row of rows) byEspn.set(row.playerId, [...(byEspn.get(row.playerId) ?? []), row]);
  for (const list of byEspn.values()) list.sort((a, b) => a.snapshotTimestamp.getTime() - b.snapshotTimestamp.getTime());
  return (playerId, at) => {
    const espnId = espnByGsis.get(playerId);
    return espnId ? statusAt(byEspn.get(espnId) ?? [], at) : null;
  };
}
