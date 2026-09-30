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

export type GameProjectionQb = {
  name: string | null; value: number | null; listed: boolean; newStarter: boolean;
  /** Expected starter ruled out (injury report or roster), when the QB above replaces them. */
  outName?: string | null; outReason?: string | null;
};
export type GameProjectionRow = {
  gameId: string;
  nflverseGameId: string;
  homeTeam: string;
  awayTeam: string;
  kickoff: string | null;
  projectedMargin: number;
  projectedTotal: number;
  homeWinProbability: number;
  /** nflverse consensus line as an expected home margin (positive = home favored). */
  marketMargin?: number | null;
  marketTotal?: number | null;
  homeQb: GameProjectionQb;
  awayQb: GameProjectionQb;
  factors: { qbEdge: number | null; teamEdge: number | null; passEdge: number | null; rushEdge: number | null; restDiff: number | null; neutralSite: boolean };
};

export type TeamRatingRow = {
  team: string;
  rating: number;
  offense: number;
  defense: number;
  qb: number;
  ratingRank: number;
  offenseRank: number;
  defenseRank: number;
  qbRank: number;
  qbName: string | null;
  qbValue: number | null;
  qbNewStarter: boolean;
  qbOutName?: string | null;
  qbOutReason?: string | null;
  record: { wins: number; losses: number; ties: number } | null;
  /** Season stats keyed like off_points / off_points_rank / def_sacks_rank. */
  stats: Record<string, number | null>;
};

/** One row per run of the QB-adjusted game model (research/game-model). */
export const gameProjectionRunsTable = pgTable("game_projection_runs", {
  id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
  season: integer("season").notNull(),
  week: integer("week").notNull(),
  generatedAt: timestamp("generated_at", { withTimezone: true }).notNull(),
  receivedAt: timestamp("received_at", { withTimezone: true }).notNull().defaultNow(),
  modelVersion: text("model_version").notNull(),
  evaluation: jsonb("evaluation").$type<Record<string, unknown>>().notNull().default({}),
  games: jsonb("games").$type<GameProjectionRow[]>().notNull(),
  teams: jsonb("teams").$type<TeamRatingRow[]>().notNull().default([]),
}, (table) => [
  unique("game_projection_runs_week_generated_unique").on(table.season, table.week, table.generatedAt),
  index("game_projection_runs_week_idx").on(table.season, table.week, table.generatedAt),
  check("game_projection_runs_week_check", sql`${table.week} between 1 and 22`),
]);

/**
 * Weekly observed-history reports sent by the GitHub workflow
 * (research/td-model/weekly_report.py): player usage, defense vs position and
 * red zone. One row per upload; readers take the newest row of a kind.
 */
export const weeklyReportsTable = pgTable("weekly_reports", {
  id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
  kind: text("kind").notNull(),
  season: integer("season").notNull(),
  week: integer("week").notNull(),
  generatedAt: timestamp("generated_at", { withTimezone: true }).notNull(),
  receivedAt: timestamp("received_at", { withTimezone: true }).notNull().defaultNow(),
  payload: jsonb("payload").$type<Record<string, unknown>>().notNull(),
}, (table) => [
  unique("weekly_reports_kind_generated_unique").on(table.kind, table.season, table.generatedAt),
  index("weekly_reports_kind_idx").on(table.kind, table.generatedAt),
  check("weekly_reports_week_check", sql`${table.week} between 0 and 22`),
]);
