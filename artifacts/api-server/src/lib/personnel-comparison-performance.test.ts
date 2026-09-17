import assert from "node:assert/strict";
import { performance } from "node:perf_hooks";
import test from "node:test";
import { pool } from "@workspace/db";
import { loadExamples } from "./modeling";
import { loadPersonnelContextBatch } from "./personnel-context";

const MAX_BATCH_LOAD_QUERIES = 20;
const MAX_BATCH_LOAD_SECONDS = 300;
const MAX_CONTEXT_DERIVATION_SECONDS = 120;
const MAX_TOTAL_SECONDS = 360;

test("2021-2025 personnel comparison stays batch-loaded", { timeout: MAX_TOTAL_SECONDS * 1_000 + 30_000 }, async (t) => {
  const loadedExamples = await loadExamples("pregame-v3");
  const rows = loadedExamples.examples.filter((row) => row.season >= 2021 && row.season <= 2025);
  assert.ok(rows.length > 0, "Benchmark requires persisted 2021-2025 pregame-v3 examples");
  assert.deepEqual(
    [...new Set(rows.map((row) => row.season))].sort(),
    [2021, 2022, 2023, 2024, 2025],
    "Benchmark requires examples from every comparison season",
  );

  const evaluationGames = rows.map((row) => ({
    gameId: row.gameId,
    season: row.season,
    week: row.week,
    kickoffTime: row.kickoffTime,
    homeTeamId: row.homeTeamId,
    awayTeamId: row.awayTeamId,
    finalHomeScore: row.actualHomeScore,
    finalAwayScore: row.actualAwayScore,
  }));

  const originalQuery = pool.query.bind(pool);
  let batchLoadQueries = 0;
  pool.query = ((...args: Parameters<typeof pool.query>) => {
    batchLoadQueries += 1;
    return originalQuery(...args);
  }) as typeof pool.query;

  let contextBatch: Awaited<ReturnType<typeof loadPersonnelContextBatch>>;
  const startedAt = performance.now();
  const batchLoadStartedAt = performance.now();
  try {
    contextBatch = await loadPersonnelContextBatch(evaluationGames);
  } finally {
    pool.query = originalQuery as typeof pool.query;
  }
  const batchLoadSeconds = (performance.now() - batchLoadStartedAt) / 1_000;

  const derivationStartedAt = performance.now();
  let contextsDerived = 0;
  for (const row of rows) {
    const cutoff = new Date(Math.max(
      row.homeFeatureSourceCutoff.getTime(),
      row.awayFeatureSourceCutoff.getTime(),
    ) + 1);
    assert.ok(contextBatch.get(row.gameId, cutoff), `Personnel context unavailable for ${row.gameId}`);
    contextsDerived += 1;
  }
  const contextDerivationSeconds = (performance.now() - derivationStartedAt) / 1_000;
  const totalSeconds = (performance.now() - startedAt) / 1_000;

  const result = {
    seasons: [2021, 2022, 2023, 2024, 2025],
    games: rows.length,
    contextsDerived,
    batchLoadQueries,
    batchLoadSeconds: Number(batchLoadSeconds.toFixed(1)),
    contextDerivationSeconds: Number(contextDerivationSeconds.toFixed(1)),
    totalSeconds: Number(totalSeconds.toFixed(1)),
    limits: {
      batchLoadQueries: MAX_BATCH_LOAD_QUERIES,
      batchLoadSeconds: MAX_BATCH_LOAD_SECONDS,
      contextDerivationSeconds: MAX_CONTEXT_DERIVATION_SECONDS,
      totalSeconds: MAX_TOTAL_SECONDS,
    },
  };
  t.diagnostic(`personnel comparison performance ${JSON.stringify(result)}`);

  assert.equal(contextsDerived, rows.length);
  assert.ok(
    batchLoadQueries <= MAX_BATCH_LOAD_QUERIES,
    `Batch loading used ${batchLoadQueries} queries; expected at most ${MAX_BATCH_LOAD_QUERIES}`,
  );
  assert.ok(
    batchLoadSeconds <= MAX_BATCH_LOAD_SECONDS,
    `Batch loading took ${batchLoadSeconds.toFixed(1)}s; expected at most ${MAX_BATCH_LOAD_SECONDS}s`,
  );
  assert.ok(
    contextDerivationSeconds <= MAX_CONTEXT_DERIVATION_SECONDS,
    `Context derivation took ${contextDerivationSeconds.toFixed(1)}s; expected at most ${MAX_CONTEXT_DERIVATION_SECONDS}s`,
  );
  assert.ok(
    totalSeconds <= MAX_TOTAL_SECONDS,
    `Benchmark took ${totalSeconds.toFixed(1)}s; expected at most ${MAX_TOTAL_SECONDS}s`,
  );
});