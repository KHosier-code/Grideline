import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { gzipSync } from "node:zlib";
import { archivePlayerPositionSource, replaceCachedSource, verifyArchivedSource } from "./player-position-source-archive";

test("a replaced local source cannot erase or change its content-addressed archive", async () => {
  const directory = await mkdtemp(join(tmpdir(), "position-archive-"));
  const localPath = join(directory, "source.csv.gz");
  const outputPath = join(directory, "audit.csv.gz");
  const original = gzipSync("season,week,player_id\n2026,1,old-source\n");
  const replacement = gzipSync("season,week,player_id\n2026,1,new-source\n");
  try {
    await writeFile(localPath, original);
    const receipt = {
      dataset: "player_stats" as const, season: 2026,
      sourceUrl: "https://github.com/nflverse/nflverse-data/releases/download/stats_player/stats_player_week_2026.csv.gz",
      localPath, sha256: createHash("sha256").update(original).digest("hex"), size: original.length,
    };
    // First refresh after enabling archiving: the existing cache has no
    // version receipt, and the publisher now returns different bytes.
    let first: Awaited<ReturnType<typeof archivePlayerPositionSource>> | undefined;
    await replaceCachedSource(localPath, replacement, async () => {
      assert.deepEqual(await readFile(localPath), original);
      first = await archivePlayerPositionSource(receipt);
    });
    assert.ok(first);
    const archived = first as Awaited<ReturnType<typeof archivePlayerPositionSource>>;
    assert.deepEqual(await readFile(localPath), replacement);
    await assert.rejects(() => archivePlayerPositionSource(receipt), /changed before archival/);
    await verifyArchivedSource(archived, outputPath);
    assert.deepEqual(await readFile(outputPath), original);
    const second = await archivePlayerPositionSource({
      ...receipt, sha256: createHash("sha256").update(replacement).digest("hex"), size: replacement.length,
    });
    assert.notEqual(archived.objectKey, second.objectKey);
    await verifyArchivedSource(archived);
    await assert.rejects(() => verifyArchivedSource({ ...archived, size: archived.size + 1 }), /verification/);
    await assert.rejects(() => verifyArchivedSource(archived, outputPath), /EEXIST/);
    await assert.rejects(() => replaceCachedSource(localPath, original, async () => {
      throw new Error("archival unavailable");
    }), /archival unavailable/);
    assert.deepEqual(await readFile(localPath), replacement);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});