import { assertDisposableDatabaseIdentity, assertWorkerStartupConfiguration, assertNoRehearsalExecutionAttempts, installRehearsalGuards, rehearsalRequested } from "./lib/worker-rehearsal";
import { assertPlayerRecoveryConfiguration, attestPlayerRecoveryDatabase, blockRecoveryTestNetwork, playerRecoveryRefusal, recoveryRequested, RecoveryFeedLockedError, runAttestedPlayerRecovery } from "./lib/player-feed-recovery";

// Never import @workspace/db, scheduler, provider modules, or retention before
// the rehearsal URL and all independent execution switches have been checked.
const rehearsal = rehearsalRequested(process.env);
let recovery = null;
if (recoveryRequested(process.env)) {
  try {
    recovery = assertPlayerRecoveryConfiguration(process.env);
  } catch (error) {
    process.stdout.write(`${JSON.stringify(playerRecoveryRefusal(process.env, "invalid_configuration"))}\n`);
    throw error;
  }
}
if (!recovery) assertWorkerStartupConfiguration(process.env);
if (rehearsal) installRehearsalGuards(process.env);
if (recovery?.disposable) blockRecoveryTestNetwork(process.env);

const { pool } = await import("@workspace/db");
if (rehearsal) {
  try {
    await assertDisposableDatabaseIdentity(process.env, (statement) => pool.query(statement));
  } catch (error) {
    await pool.end();
    throw error;
  }
}
if (recovery) {
  try {
    await attestPlayerRecoveryDatabase(recovery, (statement) => pool.query(statement));
  } catch (error) {
    process.stdout.write(`${JSON.stringify(playerRecoveryRefusal(process.env, "attestation_failed"))}\n`);
    await pool.end();
    throw error;
  }
}

const { logger } = await import("./lib/logger");
const { acquireGlobalWorkerOwnership } = await import("./lib/worker-ownership");

let release;
try {
  release = await acquireGlobalWorkerOwnership(pool, {
    onConnectionLost: (error) => {
      logger.error({ error }, "Global worker ownership connection lost; exiting fail-closed");
      process.exit(1);
    },
  });
} catch (error) {
  if (recovery) {
    process.stdout.write(`${JSON.stringify(playerRecoveryRefusal(process.env, "ownership_unavailable"))}\n`);
    await pool.end();
  }
  throw error;
}

if (rehearsal) {
  try {
    const { rehearseDataSchedulerStartup } = await import("./lib/scheduler");
    // No durable tick, independent feed tick, retention cleanup or provider
    // adapter is initialized. Preparation and recovery are the real SQL path.
    await rehearseDataSchedulerStartup(new Date(process.env.GRIDLINE_REHEARSAL_NOW ?? ""));
    assertNoRehearsalExecutionAttempts();
    logger.info("Disposable worker startup preparation completed; all execution paths remained inactive");
  } finally {
    await release();
    await pool.end();
  }
} else if (recovery) {
  try {
    const receipt = await runAttestedPlayerRecovery(recovery, async (feed, jobKey) => {
      if (feed === "injuries") {
        const { withFeedLock } = await import("./lib/feed-lock");
        const { syncEspnInjuries } = await import("./lib/availability");
        const result = await withFeedLock("injuries", () => syncEspnInjuries({ jobKey }));
        if (!result) throw new RecoveryFeedLockedError("Injury feed is already locked");
        return result;
      }
      const { syncSleeperPlayers } = await import("./lib/sleeper");
      return syncSleeperPlayers({ jobKey });
    });
    // A single machine-readable line survives the pretty logger and can be
    // retained alongside the corresponding sync-run rows by operators.
    process.stdout.write(`${JSON.stringify(receipt)}\n`);
    if (receipt.status !== "success")
      throw new Error(`Player recovery ${receipt.status}; receipt ${receipt.receiptId}`);
  } finally {
    await release();
    await pool.end();
  }
} else {
  const { startDataScheduler, stopDataScheduler } = await import("./lib/scheduler");
  process.env.GRIDLINE_SCHEDULER_WORKER = "1";
  await startDataScheduler();
  const { startFeedScheduler } = await import("./lib/feed-scheduler");
  const { startUsageAnalyticsRetention } = await import("./lib/usage-analytics-retention");
  const stopFeedScheduler = startFeedScheduler();
  const stopUsageAnalyticsRetention = startUsageAnalyticsRetention();
  logger.info("Gridline data worker is running; scheduled jobs continue independently of the interactive API process.");
  const keepAlive = setInterval(() => undefined, 60_000);
  for (const signal of ["SIGTERM", "SIGINT"] as const) {
    process.once(signal, () => {
      clearInterval(keepAlive);
      stopFeedScheduler();
      stopUsageAnalyticsRetention();
      stopDataScheduler();
      // Do not release ownership until all active work is unable to run.
      process.exit(0);
    });
  }
}