import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

test("normal application weather persistence is insert-only", async () => {
  const source = await readFile(new URL("./weather.ts", import.meta.url), "utf8");
  assert.match(source, /db\.insert\(weatherForecastSnapshotsTable\)/);
  assert.doesNotMatch(source, /db\.update\(weatherForecastSnapshotsTable\)/);
  assert.doesNotMatch(source, /db\.delete\(weatherForecastSnapshotsTable\)/);
});