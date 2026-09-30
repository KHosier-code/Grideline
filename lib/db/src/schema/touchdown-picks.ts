import { boolean, index, integer, jsonb, pgTable, text, timestamp, unique, check } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";

export type TouchdownPickFactors = {
  targetsPerGame: number | null;
  carriesPerGame: number | null;
  targetShare: number | null;
  carryShare: number | null;
  redZoneTouchesPerGame: number | null;
  redZoneShare: number | null;
  goalLineShare: number | null;
  teamImpliedPoints: number | null;
  opponentTdsAllowedRatio: number | null;
  recentTdRate: number | null;
};

export type TouchdownPickRow = {
  playerId: string;
  name: string;
  position: "QB" | "RB" | "WR" | "TE";
  team: string;
  opponent: string;
  isHome: boolean;
  kickoff: string | null;
  probability: number;
  injuryStatus: string | null;
  factors: TouchdownPickFactors;
};

/**
 * One row per run of the anytime-TD model (research/td-model), sent by the
 * scheduled GitHub workflow. Runs are append-only; the page shows the latest
 * run for a week, and the record uses the latest run made before each game.
 */
export const touchdownPickRunsTable = pgTable("touchdown_pick_runs", {
  id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
  season: integer("season").notNull(),
  week: integer("week").notNull(),
  generatedAt: timestamp("generated_at", { withTimezone: true }).notNull(),
  receivedAt: timestamp("received_at", { withTimezone: true }).notNull().defaultNow(),
  modelVersion: text("model_version").notNull(),
  evaluation: jsonb("evaluation").$type<Record<string, unknown>>().notNull().default({}),
  picks: jsonb("picks").$type<TouchdownPickRow[]>().notNull(),
}, (table) => [
  unique("touchdown_pick_runs_week_generated_unique").on(table.season, table.week, table.generatedAt),
  index("touchdown_pick_runs_week_idx").on(table.season, table.week, table.generatedAt),
  check("touchdown_pick_runs_week_check", sql`${table.week} between 1 and 22`),
]);

/** Whether a player scored a rushing or receiving TD in that week's game. */
export const touchdownPickResultsTable = pgTable("touchdown_pick_results", {
  id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
  season: integer("season").notNull(),
  week: integer("week").notNull(),
  playerId: text("player_id").notNull(),
  scored: boolean("scored").notNull(),
  recordedAt: timestamp("recorded_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  unique("touchdown_pick_results_player_week_unique").on(table.season, table.week, table.playerId),
]);
