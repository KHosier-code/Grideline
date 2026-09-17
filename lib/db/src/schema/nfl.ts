import { createInsertSchema } from "drizzle-zod";
import {
  boolean,
  check,
  date,
  doublePrecision,
  integer,
  index,
  jsonb,
  pgTable,
  primaryKey,
  text,
  timestamp,
  unique,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
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
  index("injuries_latest_state_idx").on(table.playerId, table.teamId, table.snapshotTimestamp, table.id),
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
  source: text("source").notNull().default("unknown"),
  classification: text("classification").notNull().default("published_secondary"),
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
  sourceTimestamp: timestamp("source_timestamp", { withTimezone: true }),
  market: text("market").notNull(),
  selection: text("selection").notNull(),
  point: doublePrecision("point"),
  price: integer("price").notNull(),
  // These fields are deliberately additive.  observation_key identifies the
  // current state stream (not a snapshot), while state_hash identifies the
  // latest point/price state in that stream.  Comparing only with the latest
  // row preserves legitimate A-B-A movement.
  observationKey: text("observation_key").notNull().default(""),
  stateHash: text("state_hash").notNull().default(""),
}, (table) => [
  index("sportsbook_odds_game_market_captured_idx").on(table.gameId, table.market, table.capturedAt, table.id),
]);

/**
 * One row per Odds API request.  This is intentionally separate from the
 * quote history so Data Health can report quota and failures even when a
 * request returns no markets.
 */
export const oddsApiRequestsTable = pgTable("odds_api_requests", {
  id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
  /**
   * A scheduled occurrence is admitted exactly once before the upstream
   * request. NULL is reserved for legacy/manual rows that predate admission
   * intents; scheduled rows always carry a unique key.
   */
  intentKey: text("intent_key"),
  requestedAt: timestamp("requested_at", { withTimezone: true }).notNull().defaultNow(),
  status: text("status").notNull(),
  httpStatus: integer("http_status"),
  recordsProcessed: integer("records_processed").notNull().default(0),
  creditsUsed: integer("credits_used"),
  creditsRemaining: integer("credits_remaining"),
  errorMessage: text("error_message"),
  metadata: jsonb("metadata").$type<Record<string, unknown>>(),
}, (table) => [
  unique("odds_api_requests_intent_key_unique").on(table.intentKey),
]);

export type OddsAuditCandidate = {
  gridlineGameId: string;
  kickoffTime: string | null;
  timeDifferenceMinutes: number | null;
};

/**
 * One immutable row for every event returned by an Odds API capture.  This
 * deliberately stores parsed fields and matching diagnostics only; provider
 * payloads, request URLs, and API keys never belong in the audit trail.
 */
export const oddsEventAuditsTable = pgTable("odds_event_audits", {
  id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
  requestId: integer("request_id").notNull(),
  eventIndex: integer("event_index").notNull(),
  providerEventId: text("provider_event_id"),
  providerHomeTeam: text("provider_home_team"),
  providerAwayTeam: text("provider_away_team"),
  providerKickoffTime: timestamp("provider_kickoff_time", { withTimezone: true }),
  normalizedHomeTeam: text("normalized_home_team"),
  normalizedAwayTeam: text("normalized_away_team"),
  candidateGridlineGames: jsonb("candidate_gridline_games")
    .$type<OddsAuditCandidate[]>()
    .notNull()
    .default([]),
  matchedGridlineGameId: text("matched_gridline_game_id"),
  matchedGridlineKickoff: timestamp("matched_gridline_kickoff", { withTimezone: true }),
  outcome: text("outcome").notNull(),
  reason: text("reason").notNull(),
  observationsReceived: integer("observations_received").notNull().default(0),
  observationsSaved: integer("observations_saved").notNull().default(0),
  duplicateObservations: integer("duplicate_observations").notNull().default(0),
  rejectedObservations: integer("rejected_observations").notNull().default(0),
  auditedAt: timestamp("audited_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  index("odds_event_audits_request_id_idx").on(table.requestId),
  index("odds_event_audits_audited_at_idx").on(table.auditedAt, table.id),
  index("odds_event_audits_outcome_idx").on(table.outcome),
]);

/**
 * Evaluation-only historical market evidence. These tables deliberately do
 * not reference production predictions or sportsbook snapshots: an imported
 * source can be audited and reused by challengers without entering inference.
 */
export const marketBaselineRunsTable = pgTable("market_baseline_runs", {
  id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
  runId: text("run_id").notNull(),
  season: integer("season").notNull(),
  source: text("source").notNull(),
  sourceUrl: text("source_url").notNull(),
  sourceFiles: jsonb("source_files").$type<string[]>().notNull().default([]),
  sourceFingerprints: jsonb("source_fingerprints").$type<Record<string, string>>().notNull().default({}),
  status: text("status").notNull(),
  metadata: jsonb("metadata").$type<Record<string, unknown>>().notNull().default({}),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  unique("market_baseline_runs_run_id_unique").on(table.runId),
  index("market_baseline_runs_season_idx").on(table.season, table.createdAt),
]);

export const marketBaselineEventsTable = pgTable("market_baseline_events", {
  id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
  runId: text("run_id").notNull(),
  sourceGameId: text("source_game_id").notNull(),
  altGameId: text("alt_game_id").notNull(),
  outcome: text("outcome").notNull(),
  reason: text("reason").notNull(),
  candidateGameIds: jsonb("candidate_game_ids").$type<string[]>().notNull().default([]),
  matchedGameId: text("matched_game_id"),
  aliasUsed: boolean("alias_used").notNull().default(false),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  unique("market_baseline_events_run_source_unique").on(table.runId, table.sourceGameId),
  index("market_baseline_events_run_outcome_idx").on(table.runId, table.outcome),
]);

export const marketBaselineQuotesTable = pgTable("market_baseline_quotes", {
  id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
  runId: text("run_id").notNull(),
  sourceGameId: text("source_game_id").notNull(),
  altGameId: text("alt_game_id").notNull(),
  matchedGameId: text("matched_game_id"),
  sourceFile: text("source_file").notNull(),
  family: text("family").notNull(),
  side: text("side").notNull(),
  point: doublePrecision("point"),
  price: integer("price"),
  sourceDesignation: text("source_designation").notNull(),
  sportsbook: text("sportsbook"),
  observedAt: timestamp("observed_at", { withTimezone: true }),
  sourceTimestamp: timestamp("source_timestamp", { withTimezone: true }),
  sourceOutcome: doublePrecision("source_outcome"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  index("market_baseline_quotes_run_game_idx").on(table.runId, table.matchedGameId, table.family),
]);

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

export const modelTrainingRunsTable = pgTable("model_training_runs", {
  id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
  modelVersion: text("model_version").notNull(),
  family: text("family").notNull(),
  algorithm: text("algorithm").notNull(),
  featureVersion: text("feature_version").notNull(),
  trainingSeasons: jsonb("training_seasons").$type<number[]>().notNull().default([]),
  testSeason: integer("test_season").notNull(),
  samplePolicy: text("sample_policy").notNull(),
  recencyWeighting: text("recency_weighting").notNull().default("none"),
  status: text("status").notNull().default("challenger"),
  sampleSize: integer("sample_size").notNull().default(0),
  metrics: jsonb("metrics").$type<Record<string, unknown>>().notNull().default({}),
  calibration: jsonb("calibration").$type<Record<string, unknown>>().notNull().default({}),
  featureImportance: jsonb("feature_importance").$type<Record<string, number>>().notNull().default({}),
  vectorFeatureNames: jsonb("vector_feature_names").$type<string[]>().notNull().default([]),
  vectorSchemaFingerprint: text("vector_schema_fingerprint"),
  modelArtifact: jsonb("model_artifact").$type<Record<string, unknown>>(),
  notes: text("notes"),
  trainedAt: timestamp("trained_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  index("model_training_runs_family_idx").on(table.family, table.testSeason, table.trainedAt),
  unique("model_training_runs_version_unique").on(table.modelVersion),
]);

/**
 * Immutable game-level evidence captured at the same time as a chronological
 * walk-forward run. Historical aggregate runs are intentionally not backfilled.
 */
export const modelEvaluationPredictionsTable = pgTable("model_evaluation_predictions", {
  id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
  // A walk-forward evaluation may contain family-specific model runs. This
  // stable grouping key ties those append-only rows to the same evaluation
  // without treating a model version as a consumer-facing identifier.
  evaluationRunId: text("evaluation_run_id"),
  modelVersion: text("model_version").notNull().references(() => modelTrainingRunsTable.modelVersion),
  family: text("family").notNull(),
  algorithm: text("algorithm").notNull(),
  featureVersion: text("feature_version").notNull(),
  testSeason: integer("test_season").notNull(),
  week: integer("week").notNull(),
  evaluationStage: text("evaluation_stage").notNull().default("season_holdout"),
  gameId: text("game_id").notNull(),
  kickoffTime: timestamp("kickoff_time", { withTimezone: true }).notNull(),
  predictionCutoff: timestamp("prediction_cutoff", { withTimezone: true }).notNull(),
  trainingSeasons: jsonb("training_seasons").$type<number[]>().notNull().default([]),
  trainingCutoff: text("training_cutoff").notNull(),
  gameStage: text("game_stage").notNull(),
  homeTeamId: text("home_team_id"),
  awayTeamId: text("away_team_id"),
  homeFeatureSourceCutoff: timestamp("home_feature_source_cutoff", { withTimezone: true }).notNull(),
  awayFeatureSourceCutoff: timestamp("away_feature_source_cutoff", { withTimezone: true }).notNull(),
  lowSample: boolean("low_sample").notNull(),
  predictedValue: doublePrecision("predicted_value").notNull(),
  actualValue: doublePrecision("actual_value").notNull(),
  actualHomeScore: integer("actual_home_score").notNull(),
  actualAwayScore: integer("actual_away_score").notNull(),
  actualMargin: doublePrecision("actual_margin").notNull(),
  actualTotal: doublePrecision("actual_total").notNull(),
  actualHomeWin: doublePrecision("actual_home_win").notNull(),
  // Family-independent fields make the retained evidence explicit. A field
  // remains null when that family did not produce it; it is never imputed.
  projectedHomeWinProbability: doublePrecision("projected_home_win_probability"),
  projectedAwayWinProbability: doublePrecision("projected_away_win_probability"),
  projectedMargin: doublePrecision("projected_margin"),
  projectedTotal: doublePrecision("projected_total"),
  marketSportsbook: text("market_sportsbook"),
  marketName: text("market_name"),
  marketSelection: text("market_selection"),
  marketSide: text("market_side"),
  marketPoint: doublePrecision("market_point"),
  marketPrice: integer("market_price"),
  marketObservedAt: timestamp("market_observed_at", { withTimezone: true }),
  marketEvidence: jsonb("market_evidence").$type<Array<{
    sportsbook: string;
    market: string;
    selection: string;
    point: number | null;
    price: number;
    observedAt: string;
  }>>(),
  closingMarketEvidence: jsonb("closing_market_evidence").$type<Array<{
    sportsbook: string;
    market: string;
    selection: string;
    point: number | null;
    price: number;
    observedAt: string;
  }>>(),
  evaluatedAt: timestamp("evaluated_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  unique("model_evaluation_prediction_version_game_unique").on(table.modelVersion, table.gameId),
  index("model_evaluation_prediction_season_week_idx").on(table.testSeason, table.week, table.family),
  index("model_evaluation_prediction_game_idx").on(table.gameId),
  index("model_evaluation_prediction_run_id_idx").on(table.evaluationRunId, table.id),
  check("model_evaluation_prediction_cutoff_check", sql`${table.predictionCutoff} <= ${table.kickoffTime}`),
  check("model_evaluation_home_feature_chronology_check", sql`${table.homeFeatureSourceCutoff} < ${table.predictionCutoff}`),
  check("model_evaluation_away_feature_chronology_check", sql`${table.awayFeatureSourceCutoff} < ${table.predictionCutoff}`),
  check("model_evaluation_market_chronology_check", sql`${table.marketObservedAt} is null or ${table.marketObservedAt} < ${table.predictionCutoff}`),
  check("model_evaluation_market_provenance_check", sql`
    (${table.marketObservedAt} is null and ${table.marketSportsbook} is null and ${table.marketName} is null and ${table.marketSelection} is null and ${table.marketPrice} is null)
    or
    (${table.marketObservedAt} is not null and ${table.marketSportsbook} is not null and ${table.marketName} is not null and ${table.marketSelection} is not null and ${table.marketPrice} is not null)
  `),
  check("model_evaluation_future_market_side_check", sql`
    ${table.evaluationRunId} is null or
    (${table.marketObservedAt} is null and ${table.marketSide} is null) or
    (${table.marketObservedAt} is not null and ${table.marketSide} in ('home', 'away', 'over', 'under'))
  `),
  check("model_evaluation_future_identity_check", sql`
    ${table.evaluationRunId} is null or
    (${table.homeTeamId} is not null and ${table.awayTeamId} is not null and ${table.homeTeamId} <> ${table.awayTeamId})
  `),
  check("model_evaluation_outcome_consistency_check", sql`
    ${table.actualMargin} = ${table.actualHomeScore} - ${table.actualAwayScore}
    and ${table.actualTotal} = ${table.actualHomeScore} + ${table.actualAwayScore}
    and ${table.actualHomeWin} = case when ${table.actualHomeScore} > ${table.actualAwayScore} then 1 else 0 end
  `),
  check("model_evaluation_projection_completeness_check", sql`
    ${table.evaluationRunId} is null or
    (${table.family} = 'spread' and ${table.projectedMargin} is not null) or
    (${table.family} = 'totals' and ${table.projectedTotal} is not null) or
    (${table.family} = 'moneyline' and ${table.projectedHomeWinProbability} is not null and ${table.projectedAwayWinProbability} is not null)
  `),
]);

export const modelPromotionHistoryTable = pgTable("model_promotion_history", {
  id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
  family: text("family").notNull(),
  modelVersion: text("model_version").notNull(),
  algorithm: text("algorithm").notNull(),
  featureVersion: text("feature_version").notNull(),
  trainingCutoff: text("training_cutoff").notNull(),
  role: text("role").notNull().default("production"),
  promotedAt: timestamp("promoted_at", { withTimezone: true }).notNull().defaultNow(),
  promotedBy: text("promoted_by").notNull(),
  reason: text("reason"),
}, (table) => [
  index("model_promotion_history_family_idx").on(table.family, table.role, table.promotedAt),
]);

export const predictionSnapshotsTable = pgTable("prediction_snapshots", {
  id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
  snapshotKey: text("snapshot_key").notNull(),
  gameId: text("game_id").notNull(),
  predictionTimestamp: timestamp("prediction_timestamp", { withTimezone: true }).notNull().defaultNow(),
  snapshotLabel: text("snapshot_label").notNull(),
  kickoffTime: timestamp("kickoff_time", { withTimezone: true }),
  featureVersion: text("feature_version").notNull(),
  spreadModelVersion: text("spread_model_version"),
  moneylineModelVersion: text("moneyline_model_version"),
  totalsModelVersion: text("totals_model_version"),
  trainingCutoff: text("training_cutoff").notNull(),
  projectedHomeScore: doublePrecision("projected_home_score"),
  projectedAwayScore: doublePrecision("projected_away_score"),
  projectedMargin: doublePrecision("projected_margin"),
  projectedTotal: doublePrecision("projected_total"),
  homeWinProbability: doublePrecision("home_win_probability"),
  awayWinProbability: doublePrecision("away_win_probability"),
  marketSnapshot: jsonb("market_snapshot").$type<Record<string, unknown>>().notNull().default({}),
  marketComparison: jsonb("market_comparison").$type<Record<string, unknown>>().notNull().default({}),
  lowSample: boolean("low_sample").notNull().default(false),
  qbConfidence: doublePrecision("qb_confidence"),
  inputFeatureCount: integer("input_feature_count").notNull().default(0),
  inputMissingFeatureCount: integer("input_missing_feature_count").notNull().default(0),
  inputVector: jsonb("input_vector").$type<number[]>(),
  vectorFeatureNames: jsonb("vector_feature_names").$type<string[]>(),
  vectorSchemaFingerprint: text("vector_schema_fingerprint"),
  inputSourceEvidence: jsonb("input_source_evidence").$type<Record<string, unknown>>(),
  officialFinalPrediction: boolean("official_final_prediction").notNull().default(false),
  frozenAt: timestamp("frozen_at", { withTimezone: true }),
}, (table) => [
  unique("prediction_snapshots_key_unique").on(table.snapshotKey),
  index("prediction_snapshots_game_idx").on(table.gameId, table.predictionTimestamp),
  index("prediction_snapshots_official_idx").on(table.officialFinalPrediction, table.kickoffTime),
  check("prediction_snapshots_input_counts_check", sql`
    ${table.inputFeatureCount} >= 0
    and ${table.inputMissingFeatureCount} >= 0
    and ${table.inputMissingFeatureCount} <= ${table.inputFeatureCount}
  `),
]);

export const predictionValidationFailuresTable = pgTable("prediction_validation_failures", {
  id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
  gameId: text("game_id").notNull(),
  predictionTimestamp: timestamp("prediction_timestamp", { withTimezone: true }).notNull(),
  snapshotLabel: text("snapshot_label").notNull(),
  featureVersion: text("feature_version").notNull(),
  spreadModelVersion: text("spread_model_version"),
  moneylineModelVersion: text("moneyline_model_version"),
  totalsModelVersion: text("totals_model_version"),
  failedField: text("failed_field").notNull(),
  invalidValue: text("invalid_value"),
  invalidType: text("invalid_type"),
  failureReason: text("failure_reason").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  index("prediction_validation_failures_game_idx").on(table.gameId, table.predictionTimestamp),
]);

export const predictionGradesTable = pgTable("prediction_grades", {
  id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
  predictionId: integer("prediction_id").notNull(),
  gradedAt: timestamp("graded_at", { withTimezone: true }).notNull().defaultNow(),
  actualHomeScore: integer("actual_home_score"),
  actualAwayScore: integer("actual_away_score"),
  actualMargin: doublePrecision("actual_margin"),
  actualTotal: doublePrecision("actual_total"),
  marginError: doublePrecision("margin_error"),
  totalError: doublePrecision("total_error"),
  homeWinCorrect: boolean("home_win_correct"),
  moneylineBrier: doublePrecision("moneyline_brier"),
  moneylineLogLoss: doublePrecision("moneyline_log_loss"),
  marketResults: jsonb("market_results").$type<Record<string, unknown>>().notNull().default({}),
  closingMarkets: jsonb("closing_markets").$type<Record<string, unknown>>().notNull().default({}),
  clv: jsonb("clv").$type<Record<string, unknown>>().notNull().default({}),
  whyMiss: jsonb("why_miss").$type<Record<string, unknown>>().notNull().default({}),
}, (table) => [
  unique("prediction_grades_prediction_unique").on(table.predictionId),
  index("prediction_grades_graded_at_idx").on(table.gradedAt),
]);

export const weeklyLearningReportsTable = pgTable("weekly_learning_reports", {
  id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
  season: integer("season").notNull(),
  week: integer("week").notNull(),
  generatedAt: timestamp("generated_at", { withTimezone: true }).notNull().defaultNow(),
  report: jsonb("report").$type<Record<string, unknown>>().notNull().default({}),
  narrative: text("narrative").notNull(),
}, (table) => [
  unique("weekly_learning_reports_season_week_unique").on(table.season, table.week),
]);

export const dataSyncRunsTable = pgTable("data_sync_runs", {
  id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
  provider: text("provider").notNull(),
  status: text("status").notNull(),
  jobKey: text("job_key"),
  scheduledFor: timestamp("scheduled_for", { withTimezone: true }),
  startedAt: timestamp("started_at", { withTimezone: true }).notNull().defaultNow(),
  completedAt: timestamp("completed_at", { withTimezone: true }),
  recordsProcessed: integer("records_processed").notNull().default(0),
  errorMessage: text("error_message"),
  skipReason: text("skip_reason"),
  metadata: jsonb("metadata").$type<Record<string, unknown>>(),
});

/**
 * Point-in-time rows from Sleeper's published NFL players feed. Rows are
 * append-only evidence: an unchanged player payload is deduplicated by its
 * source hash, while later changes create a new immutable row.
 */
export const sleeperPlayerSnapshotsTable = pgTable("sleeper_player_snapshots", {
  id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
  snapshotId: text("snapshot_id").notNull(),
  capturedAt: timestamp("captured_at", { withTimezone: true }).notNull(),
  sourceTimestamp: timestamp("source_timestamp", { withTimezone: true }),
  source: text("source").notNull().default("sleeper"),
  sleeperPlayerId: text("sleeper_player_id").notNull(),
  fullName: text("full_name"),
  firstName: text("first_name"),
  lastName: text("last_name"),
  team: text("team"),
  position: text("position"),
  fantasyPositions: jsonb("fantasy_positions").$type<string[]>().notNull().default([]),
  depthChartPosition: text("depth_chart_position"),
  depthChartOrder: integer("depth_chart_order"),
  status: text("status"),
  injuryStatus: text("injury_status"),
  practiceParticipation: text("practice_participation"),
  yearsExp: integer("years_exp"),
  age: integer("age"),
  providerIds: jsonb("provider_ids").$type<Record<string, unknown>>().notNull().default({}),
  sourceHash: text("source_hash").notNull(),
  sourceVersion: text("source_version"),
}, (table) => [
  unique("sleeper_player_snapshot_cycle_player_unique").on(
    table.snapshotId,
    table.sleeperPlayerId,
  ),
  index("sleeper_player_snapshots_captured_idx").on(table.capturedAt, table.id),
  index("sleeper_player_snapshots_player_captured_idx").on(table.sleeperPlayerId, table.capturedAt),
  index("sleeper_player_snapshots_team_idx").on(table.team, table.capturedAt),
]);

/**
 * Immutable, auditable output of the Sleeper-to-Gridline identity mapper.
 * Every algorithm revision creates a new mapping run; existing results are
 * never updated in place.
 */
export const sleeperIdentityMappingRunsTable = pgTable("sleeper_identity_mapping_runs", {
  id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
  mappingRunId: text("mapping_run_id").notNull(),
  sourceSnapshotId: text("source_snapshot_id").notNull(),
  sourceCapturedAt: timestamp("source_captured_at", { withTimezone: true }),
  mappingVersion: text("mapping_version").notNull(),
  status: text("status").notNull(),
  startedAt: timestamp("started_at", { withTimezone: true }).notNull().defaultNow(),
  completedAt: timestamp("completed_at", { withTimezone: true }),
  recordsProcessed: integer("records_processed").notNull().default(0),
  totalSleeperRows: integer("total_sleeper_rows").notNull().default(0),
  mappedCount: integer("mapped_count").notNull().default(0),
  ambiguousCount: integer("ambiguous_count").notNull().default(0),
  unmatchedCount: integer("unmatched_count").notNull().default(0),
  collisionCount: integer("collision_count").notNull().default(0),
  metadata: jsonb("metadata").$type<Record<string, unknown>>().notNull().default({}),
  errorMessage: text("error_message"),
}, (table) => [
  unique("sleeper_identity_mapping_runs_run_id_unique").on(table.mappingRunId),
  index("sleeper_identity_mapping_runs_source_idx").on(table.sourceSnapshotId, table.startedAt),
  index("sleeper_identity_mapping_runs_status_idx").on(table.status, table.startedAt),
]);

export const sleeperIdentityMappingsTable = pgTable("sleeper_identity_mappings", {
  id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
  mappingRunId: text("mapping_run_id").notNull(),
  sourceSnapshotId: text("source_snapshot_id").notNull(),
  sleeperPlayerId: text("sleeper_player_id").notNull(),
  sourceHash: text("source_hash").notNull(),
  mappedGridlinePlayerId: text("mapped_gridline_player_id"),
  mappingStatus: text("mapping_status").notNull(),
  mappingMethod: text("mapping_method").notNull(),
  mappingConfidence: doublePrecision("mapping_confidence").notNull(),
  originalTeam: text("original_team"),
  normalizedTeam: text("normalized_team"),
  teamNormalizationMethod: text("team_normalization_method"),
  originalPosition: text("original_position"),
  normalizedPosition: text("normalized_position"),
  positionCompatibility: text("position_compatibility").notNull(),
  evidenceSummary: text("evidence_summary"),
  candidateGridlinePlayerIds: jsonb("candidate_gridline_player_ids").$type<string[]>().notNull().default([]),
  candidateEvidence: jsonb("candidate_evidence").$type<Array<Record<string, unknown>>>().notNull().default([]),
  ambiguityReason: text("ambiguity_reason"),
  unmatchedReason: text("unmatched_reason"),
  teamChangeEvidence: jsonb("team_change_evidence").$type<Record<string, unknown>>(),
  depthRelevant: boolean("depth_relevant").notNull().default(false),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  unique("sleeper_identity_mappings_run_player_unique").on(table.mappingRunId, table.sleeperPlayerId),
  index("sleeper_identity_mappings_status_idx").on(table.mappingRunId, table.mappingStatus),
  index("sleeper_identity_mappings_gridline_idx").on(table.mappedGridlinePlayerId, table.mappingRunId),
  index("sleeper_identity_mappings_depth_idx").on(table.mappingRunId, table.depthRelevant),
]);

/**
 * Durable scheduler state. A row represents one recurring feed/slot rather
 * than one process, so a restart can continue from the persisted nextRunAt
 * and two server processes cannot both claim the same occurrence. The
 * lockUntil column also makes abandoned work recoverable after a process stop.
 */
export const schedulerJobsTable = pgTable("scheduler_jobs", {
  jobKey: text("job_key").primaryKey(),
  provider: text("provider").notNull(),
  kind: text("kind").notNull(),
  timezone: text("timezone").notNull().default("America/New_York"),
  cadence: text("cadence").notNull(),
  enabled: boolean("enabled").notNull().default(true),
  nextRunAt: timestamp("next_run_at", { withTimezone: true }),
  lastScheduledAt: timestamp("last_scheduled_at", { withTimezone: true }),
  lastRunAt: timestamp("last_run_at", { withTimezone: true }),
  lastStatus: text("last_status"),
  lastError: text("last_error"),
  lastResult: jsonb("last_result").$type<Record<string, unknown>>(),
  lockOwner: text("lock_owner"),
  lockAcquiredAt: timestamp("lock_acquired_at", { withTimezone: true }),
  lockUntil: timestamp("lock_until", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  index("scheduler_jobs_due_idx").on(table.enabled, table.nextRunAt),
  index("scheduler_jobs_lock_idx").on(table.lockUntil),
]);

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
  teamScore: integer("team_score"),
  opponentScore: integer("opponent_score"),
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
  passDropbacks: integer("pass_dropbacks").notNull().default(0),
  passAttempts: integer("pass_attempts").notNull().default(0),
  rushAttempts: integer("rush_attempts").notNull().default(0),
  passEpaPerDropback: doublePrecision("pass_epa_per_dropback"),
  rushEpaPerRush: doublePrecision("rush_epa_per_rush"),
  passingSuccessRate: doublePrecision("passing_success_rate"),
  rushingSuccessRate: doublePrecision("rushing_success_rate"),
  sackRateAllowed: doublePrecision("sack_rate_allowed"),
  earlyDownPassRate: doublePrecision("early_down_pass_rate"),
  earlyDownSuccessRate: doublePrecision("early_down_success_rate"),
  earlyDownEpaPerPlay: doublePrecision("early_down_epa_per_play"),
  secondsPerPlay: doublePrecision("seconds_per_play"),
  passEpaAllowed: doublePrecision("pass_epa_allowed"),
  rushEpaAllowed: doublePrecision("rush_epa_allowed"),
  passSuccessRateAllowed: doublePrecision("pass_success_rate_allowed"),
  rushSuccessRateAllowed: doublePrecision("rush_success_rate_allowed"),
  defensiveSackRate: doublePrecision("defensive_sack_rate"),
  earlyDownDefensiveEpa: doublePrecision("early_down_defensive_epa"),
  explosivePassRateAllowed: doublePrecision("explosive_pass_rate_allowed"),
  explosiveRushRateAllowed: doublePrecision("explosive_rush_rate_allowed"),
  sourceDataset: text("source_dataset").notNull().default("nflverse"),
  sourceUpdatedAt: timestamp("source_updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  primaryKey({ columns: [table.season, table.week, table.gameId, table.teamId] }),
]);

export const qbGameStatsTable = pgTable("qb_game_stats", {
  gameId: text("game_id").notNull(),
  season: integer("season").notNull(),
  week: integer("week").notNull(),
  playerId: text("player_id").notNull(),
  teamId: text("team_id").notNull(),
  opponentTeamId: text("opponent_team_id").notNull(),
  dropbacks: integer("dropbacks").notNull().default(0),
  passAttempts: integer("pass_attempts").notNull().default(0),
  completions: integer("completions").notNull().default(0),
  passEpa: doublePrecision("pass_epa").notNull().default(0),
  passSuccesses: integer("pass_successes").notNull().default(0),
  interceptions: integer("interceptions").notNull().default(0),
  sacks: integer("sacks").notNull().default(0),
  rushAttempts: integer("rush_attempts").notNull().default(0),
  rushEpa: doublePrecision("rush_epa").notNull().default(0),
  participationEvidence: text("participation_evidence"),
  sourceUpdatedAt: timestamp("source_updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  primaryKey({ columns: [table.gameId, table.playerId] }),
  index("qb_game_stats_team_idx").on(table.teamId, table.season, table.week),
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
  sourceKey: text("source_key").notNull(),
  season: integer("season").notNull(),
  week: integer("week").notNull(),
  teamId: text("team_id").notNull(),
  playerId: text("player_id").notNull(),
  playerName: text("player_name").notNull(),
  position: text("position"),
  depthPosition: integer("depth_position"),
  role: text("role"),
  sourceSnapshotAt: timestamp("source_snapshot_at", { withTimezone: true }),
  sourceUpdatedAt: timestamp("source_updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  unique("historical_depth_chart_source_key_unique").on(table.sourceKey),
]);

/** Immutable, pre-kickoff National Weather Service forecast captures. */
export const weatherForecastSnapshotsTable = pgTable("weather_forecast_snapshots", {
  id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
  gameId: text("game_id").notNull(),
  source: text("source").notNull(),
  fetchedAt: timestamp("fetched_at", { withTimezone: true }).notNull(),
  forecastGeneratedAt: timestamp("forecast_generated_at", { withTimezone: true }),
  validTime: timestamp("valid_time", { withTimezone: true }).notNull(),
  temperature: doublePrecision("temperature"),
  sustainedWind: doublePrecision("sustained_wind"),
  windGust: doublePrecision("wind_gust"),
  precipitationProbability: doublePrecision("precipitation_probability"),
  precipitationType: text("precipitation_type"),
  humidity: doublePrecision("humidity"),
  weatherSummary: text("weather_summary"),
  indoorOutdoor: text("indoor_outdoor").notNull(),
  roofStatus: text("roof_status"),
  sourceUrl: text("source_url"),
  office: text("office"),
  gridpoint: text("gridpoint"),
}, (table) => [
  index("weather_forecast_game_valid_idx").on(table.gameId, table.validTime, table.fetchedAt),
]);

export type PregameFeatureValues = Record<string, number | null>;
export type PregameFeatureSamples = Record<string, number>;
export type PregameFeatureAuditEntry = {
  value: number | null;
  sourceDataset: string;
  lookbackWindow: string;
  gamesIncluded: number;
  lastSourceGame: string | null;
  lastSourceDate: string | null;
  sampleSize: number;
  quality: "high" | "low_sample" | "unavailable";
  unavailableReason?: string;
};

/**
 * Versioned, point-in-time feature rows. Each row is generated from games
 * strictly before kickoffTime; features are JSON so a new definition can be
 * added without rewriting historical versions.
 */
export const pregameTeamFeaturesTable = pgTable("pregame_team_features", {
  featureVersion: text("feature_version").notNull(),
  gameId: text("game_id").notNull(),
  teamId: text("team_id").notNull(),
  opponentTeamId: text("opponent_team_id").notNull(),
  season: integer("season").notNull(),
  week: integer("week").notNull(),
  kickoffTime: timestamp("kickoff_time", { withTimezone: true }).notNull(),
  isHome: boolean("is_home").notNull(),
  features: jsonb("features").$type<PregameFeatureValues>().notNull().default({}),
  sampleCounts: jsonb("sample_counts").$type<PregameFeatureSamples>().notNull().default({}),
  featureAudit: jsonb("feature_audit").$type<Record<string, PregameFeatureAuditEntry>>().notNull().default({}),
  lowSample: boolean("low_sample").notNull().default(true),
  sourceCutoff: timestamp("source_cutoff", { withTimezone: true }).notNull(),
  generatedAt: timestamp("generated_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  primaryKey({ columns: [table.featureVersion, table.gameId, table.teamId] }),
  index("pregame_features_game_idx").on(table.gameId, table.featureVersion),
  index("pregame_features_team_kickoff_idx").on(table.teamId, table.kickoffTime),
]);

export const insertTeamSchema = createInsertSchema(teamsTable);
export const insertGameSchema = createInsertSchema(gamesTable);
export type InsertTeam = z.infer<typeof insertTeamSchema>;
export type InsertGame = z.infer<typeof insertGameSchema>;
export type Team = typeof teamsTable.$inferSelect;
export type Game = typeof gamesTable.$inferSelect;