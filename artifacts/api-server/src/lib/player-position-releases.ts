import { createHash } from "node:crypto";
import { and, asc, eq, lte } from "drizzle-orm";
import { db, playerPositionSourceReleasesTable } from "@workspace/db";
import { readDefenseInputs, type DefenseInputs } from "./defense-vs-position";

export type PositionRelease = {
  capturedAt: Date;
  fingerprint: string;
  input: DefenseInputs;
};
const stable = (value: unknown): unknown => {
  if (value instanceof Date) return value.toISOString();
  if (Array.isArray(value)) return value.map(stable);
  if (value && typeof value === "object") return Object.fromEntries(
    Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => [key, stable(item)]));
  return value;
};
const digest = (value: unknown) => createHash("sha256").update(JSON.stringify(stable(value))).digest("hex");

/** A capture is an observed, immutable local release, NOT a historical
 * publisher timestamp. Never backdate it to a source-file completion time. */
export async function capturePlayerPositionRelease(season: number): Promise<boolean> {
  const capturedAt = new Date();
  const input = await readDefenseInputs(season, capturedAt);
  if (!["player_stats", "pbp"].every(dataset => input.sources.some(source =>
    source.season === season && source.dataset === dataset && source.status === "success"
    && source.completedAt && source.completedAt <= capturedAt))) return false;
  // A source row imported while the snapshot was being read cannot be
  // certified by this capture.
  if (input.stats.some(row => row.sourceUpdatedAt > capturedAt)
    || input.rzTeams.some(row => row.ingestedAt > capturedAt)
    || input.rzPlayers.some(row => row.ingestedAt > capturedAt)) return false;
  const payload = {
    games: input.games, stats: input.stats, rzTeams: input.rzTeams, rzPlayers: input.rzPlayers,
    teams: input.teams, sources: input.sources,
  };
  const fingerprint = digest(payload);
  await db.insert(playerPositionSourceReleasesTable)
    .values({ season, capturedAt, fingerprint, payload })
    .onConflictDoNothing();
  return true;
}

export async function readPlayerPositionReleases(season: number, cutoff: Date): Promise<PositionRelease[]> {
  const rows = await db.select().from(playerPositionSourceReleasesTable)
    .where(and(eq(playerPositionSourceReleasesTable.season, season),
      lte(playerPositionSourceReleasesTable.capturedAt, cutoff)))
    .orderBy(asc(playerPositionSourceReleasesTable.capturedAt));
  return rows.map(row => {
    if (digest(row.payload) !== row.fingerprint) {
      throw new Error(`Player-position release ${row.id} failed integrity verification`);
    }
    const p = row.payload as unknown as DefenseInputs;
    return {
      capturedAt: row.capturedAt, fingerprint: row.fingerprint,
      input: {
        ...p,
        games: p.games.map(g => ({ ...g, kickoffTime: g.kickoffTime ? new Date(g.kickoffTime) : null })),
        stats: p.stats.map(s => ({ ...s, sourceUpdatedAt: new Date(s.sourceUpdatedAt) })),
        rzTeams: p.rzTeams.map(r => ({ ...r, ingestedAt: new Date(r.ingestedAt) })),
        rzPlayers: p.rzPlayers.map(r => ({ ...r, ingestedAt: new Date(r.ingestedAt) })),
        sources: p.sources.map(s => ({ ...s, startedAt: new Date(s.startedAt),
          completedAt: s.completedAt ? new Date(s.completedAt) : null })),
      },
    };
  });
}