export const GLOBAL_WORKER_ADVISORY_LOCK_KEY = 731400;

export type WorkerOwnershipClient = {
  query(
    queryText: string,
    values?: unknown[],
  ): Promise<{ rows: Array<{ locked?: boolean; unlocked?: boolean }> }>;
  release(error?: Error | boolean): void;
  on?(event: "error" | "end", listener: (...args: any[]) => void): unknown;
  removeListener?(event: "error" | "end", listener: (...args: any[]) => void): unknown;
};

export type WorkerOwnershipPool = {
  connect(): Promise<WorkerOwnershipClient>;
};

/**
 * A session-level lock on a dedicated checked-out connection. Losing that
 * PostgreSQL session releases the lock server-side; callers must stop work if
 * onConnectionLost fires rather than continue as an unfenced worker.
 */
export async function acquireGlobalWorkerOwnership(
  pool: WorkerOwnershipPool,
  options: {
    lockKey?: number;
    onConnectionLost?: (error: Error) => void;
  } = {},
): Promise<() => Promise<void>> {
  const client = await pool.connect();
  const lockKey = options.lockKey ?? GLOBAL_WORKER_ADVISORY_LOCK_KEY;
  let locked = false;
  let released = false;

  const releaseClient = (error?: Error | boolean) => {
    if (released) return;
    released = true;
    client.removeListener?.("error", handleConnectionError);
    client.removeListener?.("end", handleConnectionEnd);
    client.release(error);
  };
  const handleConnectionError = (error: Error) => {
    // PostgreSQL releases session advisory locks when this connection dies.
    // Never let this process keep doing scheduled work after losing ownership.
    try {
      releaseClient(true);
    } catch {
      // A session that has already ended cannot be returned to the pool.
    }
    options.onConnectionLost?.(error);
  };
  const handleConnectionEnd = () =>
    handleConnectionError(new Error("Global worker ownership session ended"));

  try {
    const result = await client.query(
      "SELECT pg_try_advisory_lock($1) AS locked",
      [lockKey],
    );
    locked = result.rows[0]?.locked === true;
    if (!locked) {
      releaseClient();
      throw new Error("Another Gridline data worker currently owns the global worker lock");
    }
    client.on?.("error", handleConnectionError);
    client.on?.("end", handleConnectionEnd);
  } catch (error) {
    if (!released) releaseClient(true);
    throw error;
  }

  return async () => {
    if (released) return;
    try {
      const result = await client.query(
        "SELECT pg_advisory_unlock($1) AS unlocked",
        [lockKey],
      );
      if (result.rows[0]?.unlocked !== true) {
        throw new Error("Global worker ownership lock was not held during shutdown");
      }
    } catch (error) {
      releaseClient(true);
      throw error;
    }
    releaseClient();
  };
}

export function isNewWorkerApproved(
  environment: { GRIDLINE_NEW_WORKER_APPROVED?: string } = process.env,
) {
  return environment.GRIDLINE_NEW_WORKER_APPROVED === "1";
}

/** Returns false without invoking the spawn callback when activation is off. */
export function startWorkerOnlyWhenApproved(
  environment: { GRIDLINE_NEW_WORKER_APPROVED?: string },
  startWorker: () => void,
) {
  if (!isNewWorkerApproved(environment)) return false;
  startWorker();
  return true;
}