import { createInsertSchema } from "drizzle-zod";
import {
  boolean,
  date,
  doublePrecision,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  unique,
} from "drizzle-orm/pg-core";
import { z } from "zod/v4";

export const teamsTable = pgTable("teams", {
  teamId: text("team_id").primaryKey(),
  abbreviation: text("abbreviation").notNull(),
  teamName: text("team_name").notNull(),
  conference: text("conference"),
  division: text("division"),
  logoUrl: text("logo_url"),
  sourceUpdatedAt: timestamp("source_updated_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const playersTable = pgTable("players", {
  playerId: text("player_id").primaryKey(),
  name: text("name").notNull(),
  teamId: text("team_id"),
  position: text("position"),
  jerseyNumber: text("jersey_number"),
  activeStatus: text("active_status"),
  sourceUpdatedAt: timestamp("source_updated_at", { withTimezone: true }),
});

export const gamesTable = pgTable("games", {
  gameId: text("game_id").primaryKey(),
  season: integer("season").notNull(),
  week: integer("week").notNull(),
  gameDate: timestamp("game_date", { withTimezone: true }).notNull(),
  kickoffTime: timestamp("kickoff_time", { withTimezone: true }),
  homeTeamId: text("home_team_id").notNull(),
  awayTeamId: text("away_team_id").notNull(),
  stadium: text("stadium"),
  finalHomeScore: integer("final_home_score"),
  finalAwayScore: integer("final_away_score"),
  gameStatus: text("game_status").notNull(),
  broadcast: text("broadcast"),
  sourceUpdatedAt: timestamp("source_updated_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const injuriesTable = pgTable("injuries", {
  id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
  playerId: text("player_id").notNull(),
  teamId: text("team_id").notNull(),
  position: text("position"),
  injury: text("injury"),
  practiceStatus: text("practice_status"),
  gameStatus: text("game_status"),
  dateReported: date("date_reported", { mode: "string" }),
  snapshotTimestamp: timestamp("snapshot_timestamp", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  unique("injuries_player_snapshot_unique").on(table.playerId, table.snapshotTimestamp),
]);

export const depthChartSnapshotsTable = pgTable("depth_chart_snapshots", {
  id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
  teamId: text("team_id").notNull(),
  playerId: text("player_id").notNull(),
  position: text("position"),
  depthPosition: integer("depth_position"),
  starter: boolean("starter").notNull().default(false),
  snapshotTimestamp: timestamp("snapshot_timestamp", { withTimezone: true }).notNull().defaultNow(),
});

export const sportsbookOddsTable = pgTable("sportsbook_odds", {
  id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
  gameId: text("game_id").notNull(),
  sportsbook: text("sportsbook").notNull(),
  capturedAt: timestamp("captured_at", { withTimezone: true }).notNull().defaultNow(),
  market: text("market").notNull(),
  selection: text("selection").notNull(),
  point: doublePrecision("point"),
  price: integer("price").notNull(),
});

export const predictionsTable = pgTable("predictions", {
  id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
  gameId: text("game_id").notNull(),
  predictionTimestamp: timestamp("prediction_timestamp", { withTimezone: true }).notNull().defaultNow(),
  modelVersion: text("model_version").notNull(),
  sportsbook: text("sportsbook"),
  market: text("market").notNull(),
  sportsbookLine: doublePrecision("sportsbook_line"),
  sportsbookPrice: integer("sportsbook_price"),
  modelLine: doublePrecision("model_line"),
  modelProbability: doublePrecision("model_probability"),
  marketImpliedProbability: doublePrecision("market_implied_probability"),
  modelEdge: doublePrecision("model_edge"),
  expectedValue: doublePrecision("expected_value"),
  confidenceScore: doublePrecision("confidence_score"),
  recommendedPick: text("recommended_pick"),
  minimumPlayableLine: doublePrecision("minimum_playable_line"),
});

export const predictionResultsTable = pgTable("prediction_results", {
  id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
  predictionId: integer("prediction_id").notNull(),
  actualResult: doublePrecision("actual_result"),
  win: boolean("win"),
  loss: boolean("loss"),
  push: boolean("push"),
  closingLine: doublePrecision("closing_line"),
  closingPrice: integer("closing_price"),
  closingLineValue: doublePrecision("closing_line_value"),
  unitsWonOrLost: doublePrecision("units_won_or_lost"),
});

export const modelVersionsTable = pgTable("model_versions", {
  modelVersion: text("model_version").primaryKey(),
  dateActivated: timestamp("date_activated", { withTimezone: true }),
  features: jsonb("features").$type<string[]>().notNull().default([]),
  featureWeights: jsonb("feature_weights").$type<Record<string, number>>().notNull().default({}),
  algorithmType: text("algorithm_type"),
  notes: text("notes"),
  backtestResults: jsonb("backtest_results").$type<Record<string, unknown>>(),
});

export const dataSyncRunsTable = pgTable("data_sync_runs", {
  id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
  provider: text("provider").notNull(),
  status: text("status").notNull(),
  startedAt: timestamp("started_at", { withTimezone: true }).notNull().defaultNow(),
  completedAt: timestamp("completed_at", { withTimezone: true }),
  recordsProcessed: integer("records_processed").notNull().default(0),
  errorMessage: text("error_message"),
});

export const insertTeamSchema = createInsertSchema(teamsTable);
export const insertGameSchema = createInsertSchema(gamesTable);
export type InsertTeam = z.infer<typeof insertTeamSchema>;
export type InsertGame = z.infer<typeof insertGameSchema>;
export type Team = typeof teamsTable.$inferSelect;
export type Game = typeof gamesTable.$inferSelect;