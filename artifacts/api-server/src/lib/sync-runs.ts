import { desc, eq } from "drizzle-orm";
import { dataSyncRunsTable, db } from "@workspace/db";

const scheduledProviders = ["scheduled:injuries", "scheduled:nflverse"] as const;

export type ScheduledProvider = (typeof scheduledProviders)[number];

export async function getRecentScheduledRuns(provider: ScheduledProvider, limit = 20) {
  return db
    .select({
      id: dataSyncRunsTable.id,
      provider: dataSyncRunsTable.provider,
      status: dataSyncRunsTable.status,
      error: dataSyncRunsTable.errorMessage,
      startedAt: dataSyncRunsTable.startedAt,
      completedAt: dataSyncRunsTable.completedAt,
    })
    .from(dataSyncRunsTable)
    .where(eq(dataSyncRunsTable.provider, provider))
    .orderBy(desc(dataSyncRunsTable.startedAt))
    .limit(limit);
}