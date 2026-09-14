import { createInsertSchema } from "drizzle-zod";
import {
  boolean,
  date,
  doublePrecision,
  integer,
  jsonb,
  pgTable,
  primaryKey,
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
  sourceUpdatedAt: timestamp("source_updated_at", { withTimezone: true }),
  sourceHash: text("source_hash").notNull(),
  snapshotTimestamp: timestamp("snapshot_timestamp", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  unique("injuries_player_source_hash_unique").on(table.playerId, table.teamId, table.sourceHash),
]);

export const depthChartSnapshotsTable = pgTable("depth_chart_snapshots", {
  id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
  teamId: text("team_id").notNull(),
  playerId: text("player_id").notNull(),
  playerName: text("player_name"),
  position: text("position"),
  depthPosition: integer("depth_position"),
  starter: boolean("starter").notNull().default(false),
  role: text("role"),
  changeType: text("change_type"),
  sourceHash: text("source_hash").notNull(),
  sourceUpdatedAt: timestamp("source_updated_at", { withTimezone: true }),
  snapshotTimestamp: timestamp("snapshot_timestamp", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  unique("depth_chart_player_source_hash_unique").on(
    table.teamId,
    table.playerId,
    table.position,
    table.depthPosition,
    table.sourceHash,
  ),
]);

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

export const nflverseSourceFilesTable = pgTable("nflverse_source_files", {
  id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
  dataset: text("dataset").notNull(),
  season: integer("season").notNull(),
  sourceUrl: text("source_url").notNull(),
  localPath: text("local_path"),
  status: text("status").notNull(),
  fileSizeBytes: integer("file_size_bytes"),
  rowsProcessed: integer("rows_processed").notNull().default(0),
  startedAt: timestamp("started_at", { withTimezone: true }).notNull().defaultNow(),
  completedAt: timestamp("completed_at", { withTimezone: true }),
  errorMessage: text("error_message"),
}, (table) => [
  unique("nflverse_source_dataset_season_unique").on(table.dataset, table.season),
]);

export const teamGameStatsTable = pgTable("team_game_stats", {
  season: integer("season").notNull(),
  week: integer("week").notNull(),
  gameId: text("game_id").notNull(),
  gameDate: date("game_date", { mode: "string" }),
  teamId: text("team_id").notNull(),
  opponentTeamId: text("opponent_team_id").notNull(),
  isHome: boolean("is_home").notNull(),
  plays: integer("plays").notNull().default(0),
  epaPerPlay: doublePrecision("epa_per_play"),
  passEpa: doublePrecision("pass_epa"),
  rushEpa: doublePrecision("rush_epa"),
  offensiveSuccessRate: doublePrecision("offensive_success_rate"),
  defensiveEpaAllowedPerPlay: doublePrecision("defensive_epa_allowed_per_play"),
  defensiveSuccessRate: doublePrecision("defensive_success_rate"),
  yardsPerPlay: doublePrecision("yards_per_play"),
  turnovers: integer("turnovers").notNull().default(0),
  sacks: integer("sacks").notNull().default(0),
  pressures: integer("pressures").notNull().default(0),
  explosivePassRate: doublePrecision("explosive_pass_rate"),
  explosiveRushRate: doublePrecision("explosive_rush_rate"),
  thirdDownRate: doublePrecision("third_down_rate"),
  redZoneRate: doublePrecision("red_zone_rate"),
  neutralScriptPassRate: doublePrecision("neutral_script_pass_rate"),
  sourceDataset: text("source_dataset").notNull().default("nflverse"),
  sourceUpdatedAt: timestamp("source_updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  primaryKey({ columns: [table.season, table.week, table.gameId, table.teamId] }),
]);

export const playerGameStatsTable = pgTable("player_game_stats", {
  id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
  playerId: text("player_id").notNull(),
  playerName: text("player_name").notNull(),
  position: text("position"),
  teamId: text("team_id"),
  opponentTeamId: text("opponent_team_id"),
  season: integer("season").notNull(),
  week: integer("week").notNull(),
  seasonType: text("season_type").notNull(),
  completions: integer("completions"),
  attempts: integer("attempts"),
  passingYards: doublePrecision("passing_yards"),
  passingTds: integer("passing_tds"),
  interceptions: integer("interceptions"),
  sacks: integer("sacks"),
  carries: integer("carries"),
  rushingYards: doublePrecision("rushing_yards"),
  rushingTds: integer("rushing_tds"),
  targets: integer("targets"),
  receptions: integer("receptions"),
  receivingYards: doublePrecision("receiving_yards"),
  receivingTds: integer("receiving_tds"),
  receivingEpa: doublePrecision("receiving_epa"),
  rushingEpa: doublePrecision("rushing_epa"),
  passingEpa: doublePrecision("passing_epa"),
  sourceUpdatedAt: timestamp("source_updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  unique("player_game_stats_unique").on(
    table.playerId,
    table.season,
    table.week,
    table.seasonType,
    table.opponentTeamId,
  ),
]);

export const snapCountsTable = pgTable("snap_counts", {
  id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
  gameId: text("game_id").notNull(),
  season: integer("season").notNull(),
  week: integer("week").notNull(),
  playerId: text("player_id").notNull(),
  playerName: text("player_name").notNull(),
  position: text("position"),
  teamId: text("team_id").notNull(),
  opponentTeamId: text("opponent_team_id"),
  offenseSnaps: integer("offense_snaps"),
  offensePct: doublePrecision("offense_pct"),
  defenseSnaps: integer("defense_snaps"),
  defensePct: doublePrecision("defense_pct"),
  specialTeamsSnaps: integer("special_teams_snaps"),
  specialTeamsPct: doublePrecision("special_teams_pct"),
  sourceUpdatedAt: timestamp("source_updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  unique("snap_counts_game_player_unique").on(table.gameId, table.playerId),
]);

export const historicalDepthChartTable = pgTable("historical_depth_charts", {
  id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
  season: integer("season").notNull(),
  week: integer("week").notNull(),
  teamId: text("team_id").notNull(),
  playerId: text("player_id").notNull(),
  playerName: text("player_name").notNull(),
  position: text("position"),
  depthPosition: integer("depth_position"),
  role: text("role"),
  sourceUpdatedAt: timestamp("source_updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  unique("historical_depth_chart_unique").on(
    table.season,
    table.week,
    table.teamId,
    table.playerId,
    table.position,
  ),
]);

export const insertTeamSchema = createInsertSchema(teamsTable);
export const insertGameSchema = createInsertSchema(gamesTable);
export type InsertTeam = z.infer<typeof insertTeamSchema>;
export type InsertGame = z.infer<typeof insertGameSchema>;
export type Team = typeof teamsTable.$inferSelect;
export type Game = typeof gamesTable.$inferSelect;