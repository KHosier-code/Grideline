import { jsonb, pgTable, primaryKey, text, timestamp } from "drizzle-orm/pg-core";

export type GameAlertEvidence = {
  projection: { margin: number; total: number; homeWinProbability: number } | null;
  personnel: Record<string, string> | null;
  market: Record<string, { point: number | null; price: number }> | null;
};

export type GameAlertEvent = {
  category: "projection" | "personnel" | "market";
  detail: string;
  detectedAt: string;
};

export const gameAlertsTable = pgTable("consumer_game_alerts", {
  userId: text("user_id").notNull(),
  gameId: text("game_id").notNull(),
  baseline: jsonb("baseline").$type<GameAlertEvidence>().notNull(),
  events: jsonb("events").$type<GameAlertEvent[]>().notNull().default([]),
  enabledAt: timestamp("enabled_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [primaryKey({ columns: [table.userId, table.gameId] })]);