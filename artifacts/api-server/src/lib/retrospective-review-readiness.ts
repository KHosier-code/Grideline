import { sql } from "drizzle-orm";

/**
 * Publish transfers Drizzle's table and constraints, but not necessarily custom
 * triggers. Keep this check on the same transaction as the one-time insert.
 * Do not attempt to create the trigger from the running application.
 */
export const retrospectiveReviewReadinessQuery = sql`
  SELECT
    EXISTS (
      SELECT 1 FROM pg_catalog.pg_class c
      JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public' AND c.relname = 'retrospective_weekly_reviews'
        AND c.relkind IN ('r', 'p')
    ) AS review_table,
    (SELECT count(*) = 12 FROM pg_catalog.pg_attribute a
      WHERE a.attrelid = to_regclass('public.retrospective_weekly_reviews')
        AND a.attnum > 0 AND NOT a.attisdropped
        AND a.attname IN ('season', 'week', 'status', 'reason', 'game_id',
          'winner_team_id', 'winner_probability', 'cutoff_at', 'evidence_id',
          'reviewer_id', 'reviewed_at', 'published_at')) AS columns_ready,
    (SELECT count(*) = 4 FROM pg_catalog.pg_constraint c
      WHERE c.conrelid = to_regclass('public.retrospective_weekly_reviews')
        AND c.convalidated
        AND c.conname IN ('retrospective_weekly_reviews_game_id_fkey',
          'retrospective_weekly_reviews_scope_check',
          'retrospective_weekly_reviews_season_week_unique',
          'retrospective_weekly_reviews_state_check')
        AND c.contype = CASE c.conname
          WHEN 'retrospective_weekly_reviews_game_id_fkey' THEN 'f'
          WHEN 'retrospective_weekly_reviews_season_week_unique' THEN 'u'
          ELSE 'c' END) AS constraints_ready,
    EXISTS (
      SELECT 1 FROM pg_catalog.pg_trigger t
      JOIN pg_catalog.pg_proc p ON p.oid = t.tgfoid
      JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
      WHERE t.tgrelid = to_regclass('public.retrospective_weekly_reviews')
        AND t.tgname = 'retrospective_weekly_reviews_immutable'
        AND NOT t.tgisinternal AND t.tgenabled IN ('O', 'A')
        AND t.tgtype = 27 -- ROW | BEFORE | UPDATE | DELETE
        AND n.nspname = 'public' AND p.proname = 'reject_initial_pick_mutation'
        AND p.prorettype = 'pg_catalog.trigger'::regtype
        AND p.prosrc ~* 'RAISE[[:space:]]+EXCEPTION'
    ) AS mutation_guard
`;

export type RetrospectiveReviewReadiness = {
  review_table: boolean;
  columns_ready: boolean;
  constraints_ready: boolean;
  mutation_guard: boolean;
};

export class RetrospectiveReviewReadinessError extends Error {}

export function assertRetrospectiveReviewReady(rows: RetrospectiveReviewReadiness[]): void {
  const row = rows[0];
  if (!row || !row.review_table || !row.columns_ready || !row.constraints_ready || !row.mutation_guard) {
    const missing = (["review_table", "columns_ready", "constraints_ready", "mutation_guard"] as const)
      .filter((key) => !row?.[key]);
    throw new RetrospectiveReviewReadinessError(`Retrospective review storage is not immutable: ${missing.join(", ")}. ` +
      "Do not publish reviews until the production catalog is verified and an approved database immutability path exists.");
  }
}