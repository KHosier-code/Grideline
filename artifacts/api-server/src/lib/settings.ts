import { eq } from "drizzle-orm";
import { appSettingsTable, db } from "@workspace/db";

const defaultSettings = {
  sportsbooks: ["DraftKings", "FanDuel"],
  minimumEdge: 0,
  minimumConfidence: 50,
  unitSize: 1,
  kellyEnabled: false,
};

export async function getAppSettings() {
  const [settings] = await db
    .select()
    .from(appSettingsTable)
    .where(eq(appSettingsTable.id, 1));
  return settings ?? { id: 1, ...defaultSettings, updatedAt: new Date() };
}

export async function updateAppSettings(values: Partial<typeof defaultSettings>) {
  const [settings] = await db
    .insert(appSettingsTable)
    .values({ id: 1, ...defaultSettings, ...values })
    .onConflictDoUpdate({
      target: appSettingsTable.id,
      set: { ...values, updatedAt: new Date() },
    })
    .returning();
  return settings;
}