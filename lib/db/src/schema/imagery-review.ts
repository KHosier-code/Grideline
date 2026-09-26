import { index, integer, pgTable, text, timestamp } from "drizzle-orm/pg-core";

/** Append-only human review of a specific provider image and source version. */
export const imageryReviewsTable = pgTable("imagery_reviews", {
  id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
  playerId: text("player_id").notNull(),
  provider: text("provider").notNull(),
  sourceHash: text("source_hash").notNull(),
  imageUrl: text("image_url").notNull(),
  imageHash: text("image_hash").notNull(),
  rightsEvidence: text("rights_evidence").notNull(),
  decision: text("decision").notNull(),
  reason: text("reason").notNull(),
  reviewerId: text("reviewer_id").notNull(),
  reviewedAt: timestamp("reviewed_at", { withTimezone: true }).notNull().defaultNow(),
}, table => [
  index("imagery_reviews_player_latest_idx").on(table.playerId, table.id),
]);