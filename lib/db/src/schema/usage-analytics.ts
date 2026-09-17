import { boolean, index, pgTable, serial, text, timestamp } from "drizzle-orm/pg-core";

export const usageAnalyticsEventsTable = pgTable("usage_analytics_events", {
  id: serial("id").primaryKey(),
  eventName: text("event_name").notNull(),
  filter: text("filter"),
  value: text("value"),
  column: text("column_name"),
  direction: text("direction"),
  action: text("action"),
  position: text("position"),
  trend: text("trend"),
  coverage: text("coverage"),
  window: text("usage_window"),
  hadTeam: boolean("had_team"),
  hadPosition: boolean("had_position"),
  hadGame: boolean("had_game"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  index("usage_analytics_events_created_idx").on(table.createdAt),
  index("usage_analytics_events_name_created_idx").on(table.eventName, table.createdAt),
]);

export type UsageAnalyticsEvent = typeof usageAnalyticsEventsTable.$inferSelect;
export type InsertUsageAnalyticsEvent = typeof usageAnalyticsEventsTable.$inferInsert;