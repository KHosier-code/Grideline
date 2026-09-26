import { integer, pgTable, text, timestamp } from "drizzle-orm/pg-core";

// One row for the normal durable worker, not for rehearsal or recovery runs.
export const workerHeartbeatTable = pgTable("worker_heartbeat", {
  id: integer("id").primaryKey().default(1),
  owner: text("owner").notNull(),
  startedAt: timestamp("started_at", { withTimezone: true }).notNull(),
  observedAt: timestamp("observed_at", { withTimezone: true }).notNull(),
});