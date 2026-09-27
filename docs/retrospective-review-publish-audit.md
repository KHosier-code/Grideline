# Retrospective review Publish audit

On 2026-09-27, a read-only query against the managed production database
replica found `public.retrospective_weekly_reviews` with all 12 expected
columns and zero review rows. The validated constraints were:

- `retrospective_weekly_reviews_game_id_fkey` (foreign key to `initial_line_picks`)
- `retrospective_weekly_reviews_scope_check` (2026 Weeks 1–3)
- `retrospective_weekly_reviews_season_week_unique` (unique season/week)
- `retrospective_weekly_reviews_state_check` (review state and evidence)

There was **no** user-defined trigger on the review table and no
`reject_initial_pick_mutation` function. The latest
`release_security_evidence` build and check time in the managed production
replica matched the published API's startup log. The API and worker's
continued database identity cannot be established by a replica catalog query
alone; the write gate checks the connection actually used by the API.

## Repeat after an authorized Publish

Use the read-only production database query interface, not production DDL.
Compare the result with the published build's release-security startup log:

```sql
SELECT
  to_regclass('public.retrospective_weekly_reviews')::text AS review_table,
  (SELECT count(*) FROM pg_catalog.pg_attribute
   WHERE attrelid = to_regclass('public.retrospective_weekly_reviews')
     AND attnum > 0 AND NOT attisdropped) AS column_count,
  (SELECT json_agg(json_build_object('name', conname, 'type', contype,
     'validated', convalidated, 'definition', pg_get_constraintdef(oid))
     ORDER BY conname) FROM pg_catalog.pg_constraint
   WHERE conrelid = to_regclass('public.retrospective_weekly_reviews')) AS constraints,
  (SELECT json_agg(json_build_object('name', t.tgname, 'enabled', t.tgenabled,
     'definition', pg_get_triggerdef(t.oid), 'function', p.proname,
     'source', p.prosrc) ORDER BY t.tgname)
   FROM pg_catalog.pg_trigger t JOIN pg_catalog.pg_proc p ON p.oid = t.tgfoid
   WHERE t.tgrelid = to_regclass('public.retrospective_weekly_reviews')
     AND NOT t.tgisinternal) AS triggers,
  (SELECT build_id FROM release_security_evidence ORDER BY checked_at DESC LIMIT 1)
    AS latest_evidence_build;
```

Check the actual constraint definitions and that an enabled `BEFORE UPDATE OR
DELETE FOR EACH ROW` trigger calls a rejection function. A `NULL` trigger
result means database-level immutability is **not** established. The
application rejects new review submissions in that state; it does not protect
the table from direct SQL mutation. Do not run production DDL from the app,
deploy build, or this audit. Obtain a platform-supported, approved production
immutability mechanism before representing reviews as physically immutable.