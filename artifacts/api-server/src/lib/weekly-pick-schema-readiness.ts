type Queryable = {
  query: (text: string) => Promise<{ rows: unknown[] }>;
};

/** Read-only defense in depth: do not serve the dashboard with a partial reset. */
export async function assertWeeklyPickSchemaReady(pool: Queryable): Promise<void> {
  const result = await pool.query(`
    WITH required_columns(name) AS (
      VALUES ('season'), ('week'), ('game_id'), ('selected_at')
    )
    SELECT 'table' AS object_type, 'initial_weekly_picks' AS object_name
    WHERE NOT EXISTS (
      SELECT 1 FROM pg_catalog.pg_class c
      JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public' AND c.relname = 'initial_weekly_picks'
        AND c.relkind IN ('r', 'p')
    )
    UNION ALL
    SELECT 'column', required_columns.name
    FROM required_columns
    WHERE NOT EXISTS (
      SELECT 1 FROM pg_catalog.pg_attribute a
      WHERE a.attrelid = to_regclass('public.initial_weekly_picks')
        AND a.attname = required_columns.name AND a.attnum > 0 AND NOT a.attisdropped
    )
    ORDER BY object_type, object_name
  `);
  const missing = result.rows as { object_type: string; object_name: string }[];
  if (missing.length) {
    throw new Error(
      `Weekly pick schema is not ready: missing ${missing.map(
        ({ object_type, object_name }) => `${object_type} ${object_name}`,
      ).join(", ")}. Run development migrations before starting the API; production schema changes belong to Replit Publish.`,
    );
  }
}