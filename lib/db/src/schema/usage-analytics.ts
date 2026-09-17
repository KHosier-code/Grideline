import { boolean, index, integer, pgTable, serial, text, timestamp } from "drizzle-orm/pg-core";

/**
 * Usage Lab events contain only allow-listed interaction dimensions and are
 * retained for 30 days. This preserves enough history for the seven-day
 * administrator report while bounding the privacy-safe first-party copy.
 */
export const USAGE_ANALYTICS_RETENTION_DAYS = 30;

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

/**
 * There is one retention record for the Usage Lab event store. It is updated
 * by the persistent worker after each cleanup attempt; API processes only
 * read it for administrator diagnostics.
 */
export const usageAnalyticsRetentionTable = pgTable("usage_analytics_retention", {
  id: integer("id").primaryKey().default(1),
  lastAttemptAt: timestamp("last_attempt_at", { withTimezone: true }),
  lastAttemptStatus: text("last_attempt_status"),
  consecutiveFailures: integer("consecutive_failures").notNull().default(0),
  firstFailureAt: timestamp("first_failure_at", { withTimezone: true }),
  lastSuccessfulAt: timestamp("last_successful_at", { withTimezone: true }),
  lastSuccessfulDeletedEvents: integer("last_successful_deleted_events"),
  lastSuccessfulBatches: integer("last_successful_batches"),
  lastSuccessfulCutoff: timestamp("last_successful_cutoff", { withTimezone: true }),
  latestError: text("latest_error"),
  latestErrorAt: timestamp("latest_error_at", { withTimezone: true }),
});

export type UsageAnalyticsEvent = typeof usageAnalyticsEventsTable.$inferSelect;
export type InsertUsageAnalyticsEvent = typeof usageAnalyticsEventsTable.$inferInsert;
export type UsageAnalyticsRetention = typeof usageAnalyticsRetentionTable.$inferSelect;
export type InsertUsageAnalyticsRetention = typeof usageAnalyticsRetentionTable.$inferInsert;