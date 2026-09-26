import { pgTable, primaryKey, text, timestamp } from "drizzle-orm/pg-core";
import { gamesTable } from "./nfl";

export const savedGamesTable = pgTable("saved_games", {
  userId: text("user_id").notNull(),
  gameId: text("game_id").notNull().references(() => gamesTable.gameId, { onDelete: "cascade" }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  primaryKey({ columns: [table.userId, table.gameId] }),
]);