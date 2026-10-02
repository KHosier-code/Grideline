import { sql } from "drizzle-orm";
import { check, index, integer, pgTable, primaryKey, real, text, timestamp } from "drizzle-orm/pg-core";
import { gamesTable } from "./nfl";

/**
 * A signed-in user's own moneyline, spread and over/under picks. The line and
 * price are the sportsbook quote the site showed when the pick was made, so a
 * pick is graded against the number the user actually took. One pick per
 * market per game; it can change until kickoff.
 */
export const userPicksTable = pgTable("user_picks", {
  userId: text("user_id").notNull(),
  gameId: text("game_id").notNull().references(() => gamesTable.gameId, { onDelete: "cascade" }),
  market: text("market").notNull(),
  side: text("side").notNull(),
  line: real("line"),
  price: integer("price"),
  sportsbook: text("sportsbook"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  primaryKey({ columns: [table.userId, table.gameId, table.market] }),
  index("user_picks_user_idx").on(table.userId, table.createdAt),
  check("user_picks_market_check", sql`${table.market} in ('moneyline', 'spread', 'total')`),
  check("user_picks_side_check", sql`(${table.market} = 'total' and ${table.side} in ('over', 'under')) or (${table.market} <> 'total' and ${table.side} in ('home', 'away'))`),
]);
