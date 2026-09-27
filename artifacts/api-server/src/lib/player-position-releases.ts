import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { and, asc, eq, lte } from "drizzle-orm";
import { db, playerPositionSourceReleasesTable } from "@workspace/db";
import { readDefenseInputs, type DefenseInputs } from "./defense-vs-position";

export type PositionRelease = {
  capturedAt: Date;
  fingerprint: string;
  input: DefenseInputs;
  publisherEvidence: PublisherEvidence[];
};
export type PublisherEvidence = {
  dataset: "player_stats" | "pbp";
  season: number;
  sourceUrl: string;
  sha256: string;
  assetId: number;
  assetApiUrl: string;
  publishedAt: string;
  updatedAt: string;
  size: number;
};
const publisher = "https://api.github.com/repos/nflverse/nflverse-data/releases/tags";
const assetName = (url: string) => new URL(url).pathname.split("/").at(-1);

/** GitHub's asset updated_at is the last publisher-side change to this exact
 * asset. A release/tag creation timestamp alone cannot date its current bytes. */
export function verifyPlayerPositionPublisherAsset(
  response: unknown, dataset: PublisherEvidence["dataset"], season: number,
  sourceUrl: string, sha256: string, size: number, observedAt: Date,
): PublisherEvidence | null {
  if (!response || typeof response !== "object") return null;
  const release = response as { tag_name?: unknown; assets?: unknown };
  const tag = dataset === "pbp" ? "pbp" : season >= 2025 ? "stats_player" : "player_stats";
  if (release.tag_name !== tag || !Array.isArray(release.assets)
    || !/^[a-f0-9]{64}$/.test(sha256)) return null;
  const matching = release.assets.filter((asset: Record<string, unknown>) =>
    asset.name === assetName(sourceUrl) && asset.browser_download_url === sourceUrl);
  if (matching.length !== 1) return null;
  const asset = matching[0] as Record<string, unknown>;
  const created = typeof asset.created_at === "string" ? Date.parse(asset.created_at) : NaN;
  const updated = typeof asset.updated_at === "string" ? Date.parse(asset.updated_at) : NaN;
  if (!Number.isSafeInteger(asset.id) || typeof asset.url !== "string"
    || asset.url !== `https://api.github.com/repos/nflverse/nflverse-data/releases/assets/${asset.id}`
    || asset.digest !== `sha256:${sha256}` || asset.size !== size
    || !Number.isFinite(created) || !Number.isFinite(updated)
    || created > updated || updated > observedAt.getTime()) return null;
  return { dataset, season, sourceUrl, sha256, assetId: asset.id as number,
    assetApiUrl: asset.url, publishedAt: asset.created_at as string,
    updatedAt: asset.updated_at as string, size };
}
export function publisherEvidenceBeforeKickoff(release: PositionRelease, season: number, kickoff: Date): boolean {
  return ["player_stats", "pbp"].every(dataset => {
    const matches = release.publisherEvidence?.filter(e => e.dataset === dataset && e.season === season) ?? [];
    const e = matches[0];
    const source = release.input.sources.find(s => s.dataset === dataset && s.season === season);
    return matches.length === 1 && !!e && !!source && source.status === "success"
      && source.sourceUrl === e.sourceUrl && source.sourceSha256 === e.sha256
      && source.fileSizeBytes === e.size && Number.isSafeInteger(e.assetId)
      && e.assetApiUrl === `https://api.github.com/repos/nflverse/nflverse-data/releases/assets/${e.assetId}`
      && Number.isFinite(Date.parse(e.publishedAt)) && Number.isFinite(Date.parse(e.updatedAt))
      && Date.parse(e.publishedAt) <= Date.parse(e.updatedAt)
      && Date.parse(e.updatedAt) <= release.capturedAt.getTime()
      && Date.parse(e.updatedAt) < kickoff.getTime();
  });
}
const stable = (value: unknown): unknown => {
  if (value instanceof Date) return value.toISOString();
  if (Array.isArray(value)) return value.map(stable);
  if (value && typeof value === "object") return Object.fromEntries(
    Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => [key, stable(item)]));
  return value;
};
const digest = (value: unknown) => createHash("sha256").update(JSON.stringify(stable(value))).digest("hex");

async function publisherEvidence(input: DefenseInputs, season: number, capturedAt: Date): Promise<PublisherEvidence[]> {
  const result: PublisherEvidence[] = [];
  for (const dataset of ["player_stats", "pbp"] as const) {
    const source = input.sources.find(s => s.season === season && s.dataset === dataset);
    if (!source?.localPath || !source.sourceSha256 || !source.fileSizeBytes) continue;
    // The receipt digest is measured before ingestion; ensure the same bytes
    // remain on disk when the immutable feature release is captured.
    const hash = createHash("sha256");
    try {
      for await (const chunk of createReadStream(source.localPath)) hash.update(chunk);
    } catch { continue; }
    if (hash.digest("hex") !== source.sourceSha256) continue;
    const tag = dataset === "pbp" ? "pbp" : season >= 2025 ? "stats_player" : "player_stats";
    try {
      const response = await fetch(`${publisher}/${tag}`, {
        headers: { Accept: "application/vnd.github+json", "User-Agent": "Gridline/0.2" },
        signal: AbortSignal.timeout(15_000),
      });
      if (!response.ok) continue;
      const evidence = verifyPlayerPositionPublisherAsset(await response.json(),
        dataset, season, source.sourceUrl, source.sourceSha256, source.fileSizeBytes, capturedAt);
      if (evidence) result.push(evidence);
    } catch { /* No publisher attestation: local capture remains research-only. */ }
  }
  return result;
}

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
    publisherEvidence: await publisherEvidence(input, season, capturedAt),
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
    const evidence = (row.payload as { publisherEvidence?: PublisherEvidence[] }).publisherEvidence;
    return {
      capturedAt: row.capturedAt, fingerprint: row.fingerprint,
      publisherEvidence: Array.isArray(evidence) ? evidence : [],
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