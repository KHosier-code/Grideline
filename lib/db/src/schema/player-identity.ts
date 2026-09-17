import {
  boolean,
  integer,
  index,
  jsonb,
  pgTable,
  text,
  timestamp,
  unique,
} from "drizzle-orm/pg-core";

/** Immutable provenance for a provider file and its canonicalized contents. */
export const identitySourceImportsTable = pgTable("identity_source_imports", {
  id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
  sourceNamespace: text("source_namespace").notNull(),
  sourceUrl: text("source_url").notNull(),
  sourceContentHash: text("source_content_hash").notNull(),
  parserVersion: text("parser_version").notNull().default("v1"),
  canonicalRowsHash: text("canonical_rows_hash").notNull(),
  sourceHeaders: jsonb("source_headers").$type<string[]>().notNull().default([]),
  rowCount: integer("row_count").notNull(),
  importedAt: timestamp("imported_at", { withTimezone: true }).notNull().defaultNow(),
  provenance: jsonb("provenance").$type<Record<string, unknown>>().notNull().default({}),
}, (table) => [
  unique("identity_source_imports_content_parser_unique").on(
    table.sourceNamespace,
    table.sourceContentHash,
    table.parserVersion,
  ),
  index("identity_source_imports_namespace_idx").on(table.sourceNamespace, table.importedAt),
]);

/** Typed, authoritative nflverse player identity observations. */
export const nflversePlayerIdentitiesTable = pgTable("nflverse_player_identities", {
  id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
  importId: integer("import_id").notNull(),
  gsisId: text("gsis_id").notNull(),
  displayName: text("display_name").notNull(),
  firstName: text("first_name"),
  lastName: text("last_name"),
  position: text("position"),
  positionGroup: text("position_group"),
  team: text("team"),
  status: text("status"),
  espnId: text("espn_id"),
  pfrId: text("pfr_id"),
  pffId: text("pff_id"),
  otcId: text("otc_id"),
  esbId: text("esb_id"),
  nflId: text("nfl_id"),
  smartId: text("smart_id"),
  sourceRow: jsonb("source_row").$type<Record<string, string | null>>().notNull().default({}),
  rowFingerprint: text("row_fingerprint").notNull(),
  observedAt: timestamp("observed_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  unique("nflverse_player_identities_import_gsis_unique").on(table.importId, table.gsisId),
  index("nflverse_player_identities_gsis_idx").on(table.gsisId),
  index("nflverse_player_identities_provider_ids_idx").on(table.espnId, table.pfrId, table.pffId),
]);

/** Append-only revisions of evidence linking a provider namespace to Gridline. */
export const playerIdentityCrosswalkRevisionsTable = pgTable("player_identity_crosswalk_revisions", {
  id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
  revision: integer("revision").notNull(),
  gridlinePlayerId: text("gridline_player_id").notNull(),
  sourceNamespace: text("source_namespace").notNull(),
  sourcePlayerId: text("source_player_id").notNull(),
  targetNamespace: text("target_namespace").notNull(),
  targetPlayerId: text("target_player_id").notNull(),
  evidenceMethod: text("evidence_method").notNull(),
  evidenceConfidence: text("evidence_confidence").notNull(),
  firstObserved: timestamp("first_observed", { withTimezone: true }).notNull(),
  lastVerified: timestamp("last_verified", { withTimezone: true }).notNull(),
  evidenceFingerprint: text("evidence_fingerprint").notNull(),
  ambiguityFlag: boolean("ambiguity_flag").notNull().default(false),
  sourceImportId: integer("source_import_id"),
  evidence: jsonb("evidence_json").$type<Record<string, unknown>>().notNull().default({}),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  unique("player_identity_crosswalk_revision_unique").on(
    table.sourceNamespace, table.sourcePlayerId, table.targetNamespace,
    table.targetPlayerId, table.evidenceFingerprint, table.revision,
  ),
  index("player_identity_crosswalk_lookup_idx").on(table.sourceNamespace, table.sourcePlayerId, table.ambiguityFlag),
  index("player_identity_crosswalk_gridline_idx").on(table.gridlinePlayerId, table.targetNamespace, table.targetPlayerId),
  index("player_identity_crosswalk_stale_idx").on(table.lastVerified),
]);