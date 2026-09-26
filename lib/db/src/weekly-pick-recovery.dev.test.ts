import assert from "node:assert/strict";
import test from "node:test";
import pg from "pg";
import { recoverWeeklyPickSchema } from "./migrate";

test("disposable partial reset restores the weekly table without modifying surviving picks", {
  skip: !process.env.GRIDLINE_DISPOSABLE_DATABASE_URL,
}, async () => {
  const url = process.env.GRIDLINE_DISPOSABLE_DATABASE_URL!;
  const parsed = new URL(url);
  if (url === process.env.DATABASE_URL || parsed.hostname !== "localhost"
    || !parsed.searchParams.get("host")?.startsWith("/tmp/gridline-323-")) {
    throw new Error("Recovery test requires a separate disposable local PostgreSQL socket");
  }
  const client = new pg.Client({ connectionString: url });
  await client.connect();
  try {
    await client.query("CREATE TABLE public.initial_line_picks (game_id text PRIMARY KEY)");
    await client.query(`CREATE FUNCTION public.reject_initial_pick_mutation()
      RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'immutable'; END $$`);
    await client.query(`CREATE TRIGGER initial_line_immutable BEFORE UPDATE OR DELETE
      ON public.initial_line_picks FOR EACH ROW EXECUTE FUNCTION public.reject_initial_pick_mutation()`);
    assert.equal(await recoverWeeklyPickSchema(client), true);
    await client.query("INSERT INTO public.initial_line_picks (game_id) VALUES ('game-1')");
    await client.query("INSERT INTO public.initial_weekly_picks (season, week, game_id) VALUES (2026, 1, 'game-1')");
    assert.equal(await recoverWeeklyPickSchema(client), false);
    await client.query("DROP TRIGGER initial_weekly_immutable ON public.initial_weekly_picks");
    assert.equal(await recoverWeeklyPickSchema(client), true);
    const saved = await client.query("SELECT game_id FROM public.initial_weekly_picks");
    assert.deepEqual(saved.rows, [{ game_id: "game-1" }]);
    await assert.rejects(client.query("DELETE FROM public.initial_weekly_picks"), /immutable/);
    await client.query("DROP TABLE public.initial_weekly_picks");
    assert.equal(await recoverWeeklyPickSchema(client), true);
    const exists = await client.query("SELECT to_regclass('public.initial_weekly_picks') IS NOT NULL AS ready");
    assert.equal(exists.rows[0]?.ready, true);
  } finally {
    await client.end();
  }
});