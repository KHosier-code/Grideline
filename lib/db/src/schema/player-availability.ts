import { index, integer, pgTable, text, timestamp } from "drizzle-orm/pg-core";

/** Append-only copies of the actual published material behind positive availability assertions. */
export const playerAvailabilitySourcesTable = pgTable("player_availability_sources", {
  id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
  kind: text("kind").notNull(),
  publisher: text("publisher").notNull(),
  sourceUrl: text("source_url").notNull(),
  sourceHash: text("source_hash").notNull(),
  sourceBody: text("source_body").notNull(),
  publicationAt: timestamp("publication_at", { withTimezone: true }).notNull(),
  observedAt: timestamp("observed_at", { withTimezone: true }).notNull(),
  gameId: text("game_id").notNull(),
  team: text("team").notNull(),
  playerId: text("player_id").notNull(),
  providerId: text("provider_id").notNull(),
  playerName: text("player_name").notNull(),
  assertion: text("assertion").notNull(),
  excerpt: text("excerpt").notNull(),
}, (table) => [
  index("player_availability_source_lookup_idx").on(table.gameId, table.playerId, table.kind, table.observedAt),
]);