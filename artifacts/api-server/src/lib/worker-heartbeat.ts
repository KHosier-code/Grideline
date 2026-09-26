import { randomUUID } from "node:crypto";
import { pool } from "@workspace/db";
import { logger } from "./logger";

export const WORKER_HEARTBEAT_INTERVAL_MS = 30_000;
export const WORKER_HEARTBEAT_STALE_MS = 90_000;

export type WorkerObservation = {
  state: "observed" | "stopped" | "unobserved" | "unknown";
  lastObservedAt: string | null;
  checkedAt: string;
};

type HeartbeatStore = {
  query(statement: string, values?: unknown[]): Promise<{ rows: any[] }>;
};

export function classifyWorkerObservation(
  observedAt: Date | null,
  checkedAt: Date,
): WorkerObservation {
  const age = observedAt ? checkedAt.getTime() - observedAt.getTime() : NaN;
  return {
    state: !observedAt ? "unobserved"
      : !Number.isFinite(age) || age < 0 ? "unknown"
      : age > WORKER_HEARTBEAT_STALE_MS ? "stopped" : "observed",
    lastObservedAt: observedAt && Number.isFinite(observedAt.getTime()) ? observedAt.toISOString() : null,
    checkedAt: checkedAt.toISOString(),
  };
}

/** Reads only persisted state. A heartbeat is not evidence that any provider succeeded. */
export async function getWorkerObservation(store: HeartbeatStore = pool): Promise<WorkerObservation> {
  const { rows: [row] } = await store.query(
    "SELECT observed_at, now() AS checked_at FROM worker_heartbeat WHERE id = 1",
  );
  if (!row) return classifyWorkerObservation(null, new Date());
  return classifyWorkerObservation(
    new Date(row.observed_at),
    new Date(row.checked_at),
  );
}

/** Called only after normal scheduler startup; never by health reads. */
export async function startWorkerHeartbeat(
  store: HeartbeatStore = pool,
  intervalMs = WORKER_HEARTBEAT_INTERVAL_MS,
): Promise<() => void> {
  const owner = randomUUID();
  const write = async (initial: boolean) => {
    if (initial) {
      await store.query(
        `INSERT INTO worker_heartbeat (id, owner, started_at, observed_at)
         VALUES (1, $1, now(), now())
         ON CONFLICT (id) DO UPDATE SET
           owner = EXCLUDED.owner,
           started_at = EXCLUDED.started_at,
           observed_at = EXCLUDED.observed_at`,
        [owner],
      );
    } else {
      // A superseded worker cannot refresh the new owner's observation.
      await store.query(
        "UPDATE worker_heartbeat SET observed_at = now() WHERE id = 1 AND owner = $1",
        [owner],
      );
    }
  };
  await write(true);
  const timer = setInterval(() => {
    void write(false).catch((error) =>
      logger.error({ error }, "Worker heartbeat write failed"));
  }, intervalMs);
  timer.unref?.();
  return () => clearInterval(timer);
}