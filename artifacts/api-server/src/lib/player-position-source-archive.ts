import { createHash, randomUUID } from "node:crypto";
import { createReadStream, createWriteStream } from "node:fs";
import { copyFile, mkdir, rename, rm, stat, writeFile } from "node:fs/promises";
import { constants } from "node:fs";
import { dirname, join } from "node:path";
import { pipeline } from "node:stream/promises";
import { Transform } from "node:stream";
import { Storage } from "@google-cloud/storage";

export type SourceArchive = {
  dataset: "pbp" | "player_stats";
  season: number;
  sourceUrl: string;
  sha256: string;
  size: number;
  objectKey: string;
  generation: string;
};

// Replit App Storage uses the local sidecar for service credentials.
const sidecar = "http://127.0.0.1:1106";
const storage = new Storage({
  credentials: {
    audience: "replit",
    subject_token_type: "access_token",
    token_url: `${sidecar}/token`,
    type: "external_account",
    credential_source: {
      url: `${sidecar}/credential`,
      format: { type: "json", subject_token_field_name: "access_token" },
    },
    universe_domain: "googleapis.com",
  },
  projectId: "",
});
const bucket = () => {
  const id = process.env.DEFAULT_OBJECT_STORAGE_BUCKET_ID;
  if (!id) throw new Error("Player-position source archive requires App Storage");
  return storage.bucket(id);
};

/** Development-only stand-in for App Storage: a local folder, used only when
 * no bucket is configured and GRIDLINE_LOCAL_SOURCE_ARCHIVE_DIR is set. */
const localArchiveDir = () =>
  process.env.NODE_ENV === "development" && !process.env.DEFAULT_OBJECT_STORAGE_BUCKET_ID
    ? process.env.GRIDLINE_LOCAL_SOURCE_ARCHIVE_DIR || null
    : null;

const validSha = (sha: string) => /^[a-f0-9]{64}$/.test(sha);
const keyFor = (dataset: SourceArchive["dataset"], season: number, sha: string) =>
  `player-position/source-v1/${dataset}/${season}/${sha}.csv.gz`;

async function hashFile(path: string) {
  const hash = createHash("sha256");
  let size = 0;
  for await (const chunk of createReadStream(path)) {
    hash.update(chunk);
    size += chunk.length;
  }
  return { sha256: hash.digest("hex"), size };
}

/** Preserve an unarchived cache version before a publisher refresh can replace
 * it. If preservation fails, the old bytes stay put and the refresh fails. */
export async function replaceCachedSource(
  filePath: string, bytes: Buffer, preserveExisting: () => Promise<void>,
): Promise<void> {
  const temporary = `${filePath}.${randomUUID()}.tmp`;
  try {
    await writeFile(temporary, bytes);
    const existing = await stat(filePath).catch(error => {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
      throw error;
    });
    if (existing?.size) await preserveExisting();
    await rename(temporary, filePath);
  } finally {
    await rm(temporary, { force: true });
  }
}

/** The key is content-addressed and writes are create-only. A previously
 * stored object is read back and checked instead of trusting its metadata. */
export async function archivePlayerPositionSource(source: {
  dataset: SourceArchive["dataset"]; season: number; sourceUrl: string;
  localPath: string; sha256: string; size: number;
}): Promise<SourceArchive> {
  if (!validSha(source.sha256) || !Number.isSafeInteger(source.season)
    || source.season < 1999 || source.size <= 0 || !source.sourceUrl.endsWith(".csv.gz")) {
    throw new Error("Invalid compressed player-position source receipt");
  }
  const local = await hashFile(source.localPath);
  if (local.sha256 !== source.sha256 || local.size !== source.size) {
    throw new Error(`Player-position ${source.dataset} source changed before archival`);
  }
  const objectKey = keyFor(source.dataset, source.season, source.sha256);
  const localDir = localArchiveDir();
  if (localDir) {
    const target = join(localDir, objectKey);
    await mkdir(dirname(target), { recursive: true });
    await copyFile(source.localPath, target, constants.COPYFILE_EXCL).catch((error) => {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
    });
    const archive: SourceArchive = {
      dataset: source.dataset, season: source.season, sourceUrl: source.sourceUrl,
      sha256: source.sha256, size: source.size, objectKey, generation: "1",
    };
    await verifyArchivedSource(archive);
    return archive;
  }
  const file = bucket().file(objectKey);
  try {
    await pipeline(createReadStream(source.localPath), file.createWriteStream({
      resumable: true,
      preconditionOpts: { ifGenerationMatch: 0 },
      metadata: { contentType: "application/gzip" },
    }));
  } catch (error) {
    // Concurrent captures of the same content may race to create the key.
    if ((error as { code?: number }).code !== 412) throw error;
  }
  const [metadata] = await file.getMetadata();
  if (!metadata.generation) throw new Error("Archived source has no object generation");
  const archive: SourceArchive = {
    dataset: source.dataset, season: source.season, sourceUrl: source.sourceUrl,
    sha256: source.sha256, size: source.size, objectKey,
    generation: String(metadata.generation),
  };
  await verifyArchivedSource(archive);
  return archive;
}

function archivedFile(archive: SourceArchive) {
  if (!validSha(archive.sha256)
    || archive.objectKey !== keyFor(archive.dataset, archive.season, archive.sha256)
    || !/^\d+$/.test(archive.generation)) {
    throw new Error("Invalid player-position archive reference");
  }
  // GCS generations exceed JS safe integers. The client accepts the decimal
  // string at runtime; do not round it through Number.
  return bucket().file(archive.objectKey, { generation: archive.generation as unknown as number });
}

/** Fetches the exact recorded generation, not a mutable local cache or the
 * publisher's current release asset. Optionally writes a verified audit copy. */
export async function verifyArchivedSource(archive: SourceArchive, outputPath?: string): Promise<void> {
  const hash = createHash("sha256");
  let size = 0;
  const temporary = outputPath ? `${outputPath}.${process.pid}.tmp` : null;
  if (temporary) await mkdir(dirname(temporary), { recursive: true });
  try {
    const localDir = localArchiveDir();
    if (localDir && archive.objectKey !== keyFor(archive.dataset, archive.season, archive.sha256)) {
      throw new Error("Invalid player-position archive reference");
    }
    const reader = localDir
      ? createReadStream(join(localDir, archive.objectKey))
      : archivedFile(archive).createReadStream();
    const hashing = new Transform({
      transform(chunk: Buffer, _encoding, callback) {
        hash.update(chunk);
        size += chunk.length;
        callback(null, chunk);
      },
    });
    if (temporary) await pipeline(reader, hashing, createWriteStream(temporary, { flags: "wx" }));
    else for await (const _chunk of reader.pipe(hashing)) { /* drain and hash */ }
    if (hash.digest("hex") !== archive.sha256 || size !== archive.size) {
      throw new Error(`Archived ${archive.dataset} source failed digest/size verification`);
    }
    if (temporary) await copyFile(temporary, outputPath!, constants.COPYFILE_EXCL);
  } catch (error) {
    if (temporary) await rm(temporary, { force: true });
    throw error;
  }
  if (temporary) await rm(temporary, { force: true });
}