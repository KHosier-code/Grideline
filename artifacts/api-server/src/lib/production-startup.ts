import type { ProductionDatabaseEvidence } from "./production-database-smoke";

/** Worker startup must wait for the API to serve its local health endpoint. */
export async function waitForApiHealth(
  url: string,
  isRunning: () => boolean,
  request: (url: string, init: RequestInit) => Promise<Pick<Response, "ok">> = fetch,
  timeoutMs = 15_000,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (!isRunning()) throw new Error("Gridline API exited before becoming healthy; worker was not started");
    try {
      const response = await request(url, { signal: AbortSignal.timeout(Math.min(1_000, timeoutMs)) });
      if (response.ok && isRunning()) return;
    } catch {
      // A connection refusal while the API binds is expected; retry until the
      // bounded deadline. No worker is running during this wait.
    }
    if (!isRunning()) throw new Error("Gridline API exited before becoming healthy; worker was not started");
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error("Gridline API did not become healthy before worker startup");
}

export async function startProductionServices(
  verify: () => Promise<ProductionDatabaseEvidence>,
  startWorker: () => void,
  startApi: () => void | Promise<void>,
): Promise<ProductionDatabaseEvidence> {
  const evidence = await verify();
  await startApi();
  startWorker();
  return evidence;
}
export type DatabaseRetryOptions = {
  verify: () => Promise<ProductionDatabaseEvidence>;
  startApi: () => void | Promise<void>;
  startWorker: () => void;
  /** Failures that mean the code or its settings are wrong; these still stop startup. */
  isFatal: (error: unknown) => boolean;
  onDegraded: (error: unknown, attempt: number) => void;
  onRecovered: (evidence: ProductionDatabaseEvidence, attempt: number) => void;
  retryMs?: number;
  wait?: (ms: number) => Promise<void>;
  stopped?: () => boolean;
};

/**
 * Starts the API even when the database is down, suspended or refusing
 * writes, so the site stays up and its pages say data is refreshing instead
 * of the whole site going dark. The database check keeps retrying in the
 * background and the data worker starts only once it passes. A wrong
 * setting or missing schema (isFatal) still stops startup, as before.
 *
 * `recovered` resolves true once the database check passes, or false if
 * startup is stopped first.
 */
export async function startWithDatabaseRetry(options: DatabaseRetryOptions): Promise<{
  mode: "healthy" | "degraded";
  recovered: Promise<boolean>;
}> {
  const wait = options.wait ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms).unref?.()));
  const stopped = options.stopped ?? (() => false);
  const retryMs = options.retryMs ?? 60_000;
  let firstError: unknown;
  try {
    await options.verify();
  } catch (error) {
    if (options.isFatal(error)) throw error;
    firstError = error;
  }
  await options.startApi();
  if (firstError === undefined) {
    options.startWorker();
    return { mode: "healthy", recovered: Promise.resolve(true) };
  }
  options.onDegraded(firstError, 1);
  const recovered = (async () => {
    for (let attempt = 2; ; attempt += 1) {
      await wait(retryMs);
      if (stopped()) return false;
      try {
        const evidence = await options.verify();
        if (stopped()) return false;
        options.onRecovered(evidence, attempt);
        options.startWorker();
        return true;
      } catch (error) {
        options.onDegraded(error, attempt);
      }
    }
  })();
  return { mode: "degraded", recovered };
}
