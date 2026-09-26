import assert from "node:assert/strict";
import test from "node:test";
import { assertWeeklyPickSchemaReady } from "./weekly-pick-schema-readiness";

test("weekly-pick readiness is read-only and checks table and required columns", async () => {
  let query = "";
  await assertWeeklyPickSchemaReady({
    async query(text) {
      query = text;
      return { rows: [] };
    },
  });
  assert.match(query, /initial_weekly_picks/);
  for (const column of ["season", "week", "game_id", "selected_at"]) {
    assert.ok(query.includes(`'${column}'`));
  }
  assert.doesNotMatch(query, /\b(CREATE|ALTER|DROP|TRUNCATE|INSERT|UPDATE|DELETE)\b/i);
});

test("missing weekly-pick schema blocks startup with migration instructions", async () => {
  await assert.rejects(
    assertWeeklyPickSchemaReady({
      async query() {
        return { rows: [
          { object_type: "table", object_name: "initial_weekly_picks" },
          { object_type: "column", object_name: "game_id" },
        ] };
      },
    }),
    /missing table initial_weekly_picks, column game_id.*Run development migrations/,
  );
});