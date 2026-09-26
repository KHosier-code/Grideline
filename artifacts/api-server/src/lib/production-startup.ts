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