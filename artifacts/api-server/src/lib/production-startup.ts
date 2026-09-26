import type { ProductionDatabaseEvidence } from "./production-database-smoke";

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