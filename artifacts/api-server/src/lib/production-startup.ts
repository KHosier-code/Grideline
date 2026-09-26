import type { ProductionDatabaseEvidence } from "./production-database-smoke";

export async function startProductionServices(
  verify: () => Promise<ProductionDatabaseEvidence>,
  startWorker: () => void,
  startApi: () => void,
): Promise<ProductionDatabaseEvidence> {
  const evidence = await verify();
  startWorker();
  startApi();
  return evidence;
}