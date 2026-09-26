import { check, doublePrecision, integer, jsonb, pgTable, text, timestamp, unique } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";

// One terminal outcome per game. A failed first decision is never upgraded by
// a later model or a later market observation.
export const initialLinePicksTable = pgTable("initial_line_picks", {
  gameId: text("game_id").primaryKey(),
  season: integer("season").notNull(),
  week: integer("week").notNull(),
  requestId: integer("request_id").notNull(),
  requestedAt: timestamp("requested_at", { withTimezone: true }).notNull(),
  observedAt: timestamp("observed_at", { withTimezone: true }).notNull(),
  kickoffTime: timestamp("kickoff_time", { withTimezone: true }).notNull(),
  cutoffAt: timestamp("cutoff_at", { withTimezone: true }).notNull(),
  status: text("status").notNull(),
  reason: text("reason"),
  winnerTeamId: text("winner_team_id"),
  winnerProbability: doublePrecision("winner_probability"),
  sportsbook: text("sportsbook"),
  quotes: jsonb("quotes").$type<Array<{ market: string; selection: string; point: number | null; price: number; sourceTimestamp: string | null }>>(),
  models: jsonb("models").$type<Record<string, { version: string; artifactId: string; checksum: string; promotedAt: string; trainingCutoff: string }>>(),
  featureVersion: text("feature_version"),
  vectorFeatureNames: jsonb("vector_feature_names").$type<string[]>(),
  vectorSchemaFingerprint: text("vector_schema_fingerprint"),
  inputVector: jsonb("input_vector").$type<number[]>(),
  inputSourceEvidence: jsonb("input_source_evidence").$type<Record<string, unknown>>(),
  prediction: jsonb("prediction").$type<Record<string, number>>(),
}, (table) => [
  check("initial_line_status_check", sql`${table.status} in ('locked','no_line','incomplete_market','missing_input','invalid_model','legacy_unattributed')`),
  check("initial_line_chronology_check", sql`${table.requestedAt} <= ${table.cutoffAt} and ${table.cutoffAt} = ${table.observedAt} and ${table.observedAt} < ${table.kickoffTime}`),
  check("initial_line_complete_check", sql`(${table.status} = 'locked' and ${table.winnerTeamId} is not null and ${table.winnerProbability} > 0.5 and ${table.winnerProbability} <= 1 and ${table.sportsbook} is not null and jsonb_array_length(${table.quotes}) = 4 and ${table.models} is not null and ${table.inputVector} is not null and ${table.inputSourceEvidence} is not null and ${table.prediction} is not null) or (${table.status} <> 'locked' and ${table.winnerTeamId} is null)`),
]);

export const initialWeeklyPicksTable = pgTable("initial_weekly_picks", {
  season: integer("season").notNull(),
  week: integer("week").notNull(),
  gameId: text("game_id").notNull().references(() => initialLinePicksTable.gameId),
  selectedAt: timestamp("selected_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  unique("initial_weekly_picks_season_week_unique").on(table.season, table.week),
]);