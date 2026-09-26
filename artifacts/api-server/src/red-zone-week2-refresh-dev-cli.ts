import { createHash, randomUUID } from "node:crypto";
import { mkdir, rename, rm, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { eq } from "drizzle-orm";
import { dataSyncRunsTable, db, nflverseSourceFilesTable, pool } from "@workspace/db";
import { withFeedLock } from "./lib/feed-scheduler";
import {
  datasetUrl, deriveAndPersistRedZoneOpportunities, ingestPlayByPlay, validateFreshWeek2Pbp,
} from "./lib/nflverse";

const SEASON = 2026;
const CONFIRMATION = "--confirm-development-pbp-2026";

async function assertDevelopmentDatabase() {
  if (process.env.NODE_ENV !== "development" || process.env.REPLIT_DEPLOYMENT
    || process.argv.slice(2).length !== 1 || process.argv[2] !== CONFIRMATION) {
    throw new Error(`Development-only recovery requires ${CONFIRMATION} and cannot run in a deployment`);
  }
  // These non-secret identities were independently verified against the dev and
  // managed production resources for this recovery. Fail closed if they change.
  const { rows } = await pool.query(`
    SELECT current_database() AS database_name, current_user AS database_role,
           pg_is_in_recovery() AS replica, inet_server_addr() IS NULL AS local_proxy
  `);
  const identity = rows[0] as
    | { database_name: string; database_role: string; replica: boolean; local_proxy: boolean }
    | undefined;
  if (rows.length !== 1 || identity?.database_name !== "heliumdb"
    || identity.database_role !== "postgres" || identity.replica || !identity.local_proxy) {
    throw new Error("Refusing PBP recovery: the connection is not the verified development database");
  }
}

async function refresh() {
  await assertDevelopmentDatabase();
  const result = await withFeedLock("nflverse", async () => {
    const [run] = await db.insert(dataSyncRunsTable).values({
      provider: "nflverse", status: "running", jobKey: "development-red-zone-week2-recovery",
    }).returning({ id: dataSyncRunsTable.id });
    const directory = join(process.cwd(), ".cache", "nflverse");
    const cachedPath = join(directory, "play_by_play_2026.csv.gz");
    const candidatePath = join(directory, `.play_by_play_2026.${randomUUID()}.gz`);
    const sourceUrl = datasetUrl("pbp", SEASON);
    try {
      await mkdir(directory, { recursive: true });
      const response = await fetch(sourceUrl, {
        headers: { Accept: "application/octet-stream", "User-Agent": "Gridline/0.2" },
        signal: AbortSignal.timeout(120_000),
      });
      if (!response.ok) throw new Error(`Public NFLverse PBP download returned HTTP ${response.status}`);
      const length = Number(response.headers.get("content-length") ?? "0");
      if (length > 100_000_000) throw new Error("Public NFLverse PBP exceeds the recovery size limit");
      const bytes = Buffer.from(await response.arrayBuffer());
      if (bytes.length < 100 || bytes.length > 100_000_000 || bytes[0] !== 0x1f || bytes[1] !== 0x8b) {
        throw new Error("Public NFLverse PBP is not a nonempty gzip CSV within the recovery size limit");
      }
      const sha256 = createHash("sha256").update(bytes).digest("hex");
      await writeFile(candidatePath, bytes, { flag: "wx" });
      const source = await validateFreshWeek2Pbp(SEASON, candidatePath);
      // Preflight the normal derivation, including one usable team denominator
      // for every expected game, without changing any existing facts.
      await deriveAndPersistRedZoneOpportunities(SEASON, candidatePath, {
        expectedGameIds: source.canonicalGameIds, validateOnly: true,
      });
      const normalized = await ingestPlayByPlay(SEASON, candidatePath);
      if (!normalized.records) throw new Error("Fresh PBP had no normalized rows");
      const derived = await deriveAndPersistRedZoneOpportunities(SEASON, candidatePath, {
        expectedGameIds: source.canonicalGameIds,
      });
      await rename(candidatePath, cachedPath);
      const size = (await stat(cachedPath)).size;
      await db.insert(nflverseSourceFilesTable).values({
        dataset: "pbp", season: SEASON, sourceUrl, localPath: cachedPath,
        status: "success", fileSizeBytes: size, rowsProcessed: source.sourceRows,
        completedAt: new Date(), errorMessage: null,
      }).onConflictDoUpdate({
        target: [nflverseSourceFilesTable.dataset, nflverseSourceFilesTable.season],
        set: {
          sourceUrl, localPath: cachedPath, status: "success", fileSizeBytes: size,
          rowsProcessed: source.sourceRows, completedAt: new Date(), errorMessage: null,
        },
      });
      await db.update(dataSyncRunsTable).set({
        status: "success", completedAt: new Date(),
        recordsProcessed: normalized.records + derived.playerFacts + derived.teamFacts,
        metadata: { operation: "development_red_zone_week2_recovery", sha256, source },
      }).where(eq(dataSyncRunsTable.id, run.id));
      return { sha256, source, normalized, derived };
    } catch (error) {
      await db.update(dataSyncRunsTable).set({
        status: "failed", completedAt: new Date(),
        errorMessage: error instanceof Error ? error.message.slice(0, 8_000) : "Unknown development PBP recovery failure",
      }).where(eq(dataSyncRunsTable.id, run.id));
      throw error;
    } finally {
      await rm(candidatePath, { force: true });
    }
  });
  if (!result) throw new Error("NFLverse feed is already running; no development recovery was started");
  // Only print public source identity and aggregate counts, not DB configuration.
  process.stdout.write(`${JSON.stringify(result)}\n`);
}

refresh().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
}).finally(() => pool.end());