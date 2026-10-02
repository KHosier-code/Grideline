import { syncEspnInjuries } from "./availability";
import { withFeedLock } from "./feed-lock";
import { logger } from "./logger";
import { refreshPlayerIdentityCrosswalk, syncNflversePlayers } from "./nflverse-players";
import { syncSleeperPlayers } from "./sleeper";
import { refreshSleeperIdentityMappings } from "./sleeper-identity";

/**
 * Sleeper's depth charts plus the identity mapping that ties them to nflverse
 * player IDs. Game pages read depth from this; without it every role shows as
 * an inference from snap counts.
 */
export async function syncSleeperDepth(options?: { jobKey?: string; scheduledFor?: Date }) {
  const result = await syncSleeperPlayers(options);
  const snapshotId = (result as { snapshotId?: string } | null)?.snapshotId;
  const sourceCapturedAt = (result as { sourceCapturedAt?: string } | null)?.sourceCapturedAt;
  if (!snapshotId || !sourceCapturedAt) return result;
  try {
    const identityImport = await syncNflversePlayers();
    const crosswalk = await refreshPlayerIdentityCrosswalk(new Date(sourceCapturedAt));
    const identityMapping = await refreshSleeperIdentityMappings({
      sourceSnapshotId: snapshotId,
      sourceCapturedAt: new Date(sourceCapturedAt),
      jobKey: options?.jobKey,
      scheduledFor: options?.scheduledFor,
    });
    return { ...result, identityImport, crosswalk, identityMapping };
  } catch (error) {
    // Mapping is advisory evidence and must not turn a successful
    // Sleeper snapshot capture into a failed provider sync.
    logger.error({ error, snapshotId }, "Sleeper identity mapping failed after snapshot sync");
    return { ...result, identityMapping: { status: "failed", error: "Sleeper identity mapping failed." } };
  }
}

type PersonnelRun = {
  status: "running" | "success" | "partial" | "failed";
  startedAt: string;
  completedAt: string | null;
  depth: string | null;
  injuries: string | null;
  error: string | null;
};

let latestRun: PersonnelRun | null = null;

export function personnelRefreshStatus() {
  return latestRun;
}

const summarize = (value: unknown) => {
  const status = (value as { status?: unknown } | null)?.status;
  return typeof status === "string" ? status : value === null ? "skipped (already running)" : "unknown";
};

/**
 * Depth charts and the injury report, called by the GitHub "Players"
 * workflow. Both used to refresh only when the data worker ran. Returns false
 * when a refresh is already running in this process.
 */
export function startPersonnelRefresh(jobKey = "github-players") {
  if (latestRun?.status === "running") return false;
  const run: PersonnelRun = {
    status: "running", startedAt: new Date().toISOString(), completedAt: null, depth: null, injuries: null, error: null,
  };
  latestRun = run;
  void (async () => {
    const errors: string[] = [];
    try {
      run.depth = summarize(await syncSleeperDepth({ jobKey }));
    } catch (error) {
      run.depth = "failed";
      errors.push(`Depth: ${error instanceof Error ? error.message : String(error)}`);
    }
    try {
      run.injuries = summarize(await withFeedLock("injuries", () => syncEspnInjuries({ jobKey })));
    } catch (error) {
      run.injuries = "failed";
      errors.push(`Injuries: ${error instanceof Error ? error.message : String(error)}`);
    }
    run.error = errors.length ? errors.join("; ").slice(0, 600) : null;
    run.status = errors.length === 0 ? "success" : errors.length === 2 ? "failed" : "partial";
    run.completedAt = new Date().toISOString();
    if (errors.length) logger.error({ errors }, "Scheduled personnel refresh had failures");
  })();
  return true;
}
