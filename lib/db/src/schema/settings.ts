import { boolean, doublePrecision, integer, pgTable, text, timestamp } from "drizzle-orm/pg-core";

export const appSettingsTable = pgTable("app_settings", {
  id: integer("id").primaryKey().default(1),
  sportsbooks: text("sportsbooks").array().notNull().default(["DraftKings", "FanDuel"]),
  minimumEdge: doublePrecision("minimum_edge").notNull().default(0),
  minimumConfidence: doublePrecision("minimum_confidence").notNull().default(50),
  unitSize: doublePrecision("unit_size").notNull().default(1),
  kellyEnabled: boolean("kelly_enabled").notNull().default(false),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});