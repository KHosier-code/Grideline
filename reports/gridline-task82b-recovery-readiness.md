# Task 82B — Historical evaluation recovery readiness

**Result:** Prepared a local, read-only archive verifier and a gated reconstruction procedure. No archive was supplied, so **no original evidence has been recovered or validated**. Reconstruction was not executed.

## Evidence classes — never interchangeable

1. **Original historical evidence:** The exact accepted run `phase6-1-2025-market-baseline-v4-bc87373a5d1a-f289a18f99c4`, with its original database events, recorded quotes, per-game predictions, fitted artifacts, and provenance, recovered from an authenticated archived *development* export. No such export is available here.
2. **Independent reproduction:** Newly generated outputs from the approved method, original source bytes and historical inputs, with a **new run identity**. Matching the original metrics does not make this the original run. None was generated.
3. **Retained aggregates:** `reports/gridline-2025-market-baseline.{json,md}` and the personnel-comparison reports summarize the old results and preserve checksums, but omit the individual predictions and complete source bytes. They cannot be promoted to class 1 or 2.

The Task 82A inventory and current missing-data findings remain in `reports/gridline-task82-baseline-recovery.md`. The current development database has no baseline run or associated rows; the origin of the absence remains unproven. These two reports are *not* copies of the original database evidence.

## Archive verification procedure

`scripts/src/market-baseline-archive-check.ts` accepts a **JSON table-row export** of an authorized development archive. It makes no database connection, imports nothing, calls no network service, fits no model, and writes no file. It prints detailed mismatches and warnings to standard output; a blocked result exits nonzero.

If Support supplies a SQL or proprietary backup rather than JSON, request a read-only, table-row export from the archive custodian. Do **not** restore a dump into the current database merely to run this checker. The JSON must be shaped as `{ "tables": { "market_baseline_runs": [...], "market_baseline_events": [...], "market_baseline_quotes": [...], "model_training_runs": [...], "model_evaluation_predictions": [...], "games": [...] } }`. Use actual PostgreSQL `snake_case` column names, `null` for SQL NULL, numeric JSON for numeric values, and ISO timestamps. Restrict the export to the accepted run, its three model versions, and games referenced by the 277 matched events; it must be from an authorized **development** archive, not production. The tool requires the relevant columns and reports missing ones by table/row.

From the workspace root, with the archive and **approved, original raw source files** already acquired through authorized channels:

```sh
./scripts/node_modules/.bin/tsx scripts/src/market-baseline-archive-check.ts \
  --archive /path/to/development-export.json \
  --csv /path/to/games.csv \
  --datasets /path/to/DATASETS.md \
  --readme /path/to/README.md
```

If the source files are unavailable, `--archive` alone yields an inspection report but **cannot** return `verified`. A valid run ID alone does not pass. The checker pins the SHA-256 of the retained baseline JSON and the original run ID; validates required table columns, 285 event outcomes and 1,710 unique, six-per-event quote selections; checks the archived source fingerprint against the retained value and verifies the raw CSV bytes, 2025 schema/coverage, documentation fingerprints, and quote values against it. It checks event→quote→matched-game→prediction linkage, game teams, week, kickoff and final scores; 277/277/230 family sample sizes, 2021–2024 training and 2025 holdout, pre-kickoff cutoffs, recorded-only fields and family projections. It recomputes fitted-artifact SHA-256, baseline accuracy/error, and comparable recorded-market accuracy/error against retained aggregate values. Deviations appear as specific mismatch messages.

**Limits even when `status: verified`:** This establishes consistency with the retained report, original-source bytes and the exported rows, **not** the archival chain of custody, original import time, a full re-execution of feature generation, every weekly/bucket/return statistic, or the historical availability of personnel inputs. A human must verify archive origin and provenance and investigate any discrepancy. There is no automatic restoration path in this tool.

**Safe acceptance conditions:** all source and row checks pass; the archive's development origin and unchanged custody are independently established; original input fingerprint, model metadata, schema and game set are corroborated; no conflicting accepted run already exists in the target development environment; the personnel snapshot provenance and chronology are independently established for any *exact challenger rerun*. Explicit operator approval is required **before any development database write**. If any condition fails, retain the mismatch report and do not import or relabel evidence.

**Next action for original-archive path:** obtain the archived development export and original source files, run the checker read-only, have an operator review both its output and chain of custody, then seek separate approval for any transactional, append-only development restoration. No production access or database-binding change is permitted.

## Independent reconstruction readiness

The approved implementation remains in `artifacts/api-server/src/lib/market-baseline.ts` and `market-baseline-run.ts`. Its source is nflverse/nfldata `games.csv` with accepted SHA-256 `bc87373a5d1a578ac07c71cb6a1e50a381d58fae393021b96853a4b8674ae8b8`; the frozen `DATASETS.md` Games section and `README.md` fingerprints are enforced by source qualification. This is **source-designated recorded**, not a verified closing market: sportsbook, observation time, and CLV are unavailable. The raw CSV and original fitted artifacts were **not** located in the repository/current development database. The retained report carries artifact *checksums*, not the full trained parameters, and only a prefix of the original evaluation-input fingerprint. Source and original feature-input identity are therefore not yet independently demonstrated.

A separately authorized future reconstruction would need to:

1. Secure a version-pinned raw `games.csv` matching the full accepted SHA-256 and both documentation files matching the frozen contract. Verify the required columns, precisely 285 2025 events across weeks 1–22, six recorded selections per event, deterministic game matches and exclusion of the eight neutral-site games. Never silently substitute current `master` bytes or call recorded lines “closing.”
2. Preserve canonical 2021–2024 training and `pregame-v3` feature/vector schema, the 2025 holdout, through-2024 cutoff, pre-kickoff feature availability and final-score rules. Independently audit the feature input snapshot and its evaluation-input fingerprint before fitting; a matching CSV alone is insufficient. Use spread linear regression / include-low-sample, moneyline logistic regression / include-low-sample, and totals gradient boosting / exclude-low-sample with the fixed hyperparameters in the approved generator.
3. In an isolated **development-only** evaluation environment, and only after explicit authorization for writes and fitting, generate a **new reproduction identity**, three immutable fitted artifacts and all 784 family game-level predictions, source events and quotes. Do not reuse or overwrite the accepted identity or its append-only tables. Compare source/feature/artifact fingerprints, 277/277/230 eligibility, game-level outcomes and retained aggregate metrics, recording both matches and differences. A reproduction must remain labeled as such even if all values agree. No part of this procedure ran in Task 82B.

**Next action for reproduction path:** find the checksum-matching source snapshot and independently verifiable pregame feature-input snapshot; review their provenance and obtain separate approval for a development-only reproduction with a new run ID. If either is unavailable, do not fit from assumptions.

## Challenger rerun gate

`prepare2025PersonnelComparison` currently selects the latest complete 2025 baseline and requires persisted event matches, recorded quotes, **per-game family predictions**, `pregame-v3` examples and point-in-time personnel contexts before fitting. It cannot pair challengers from the aggregate report alone. Before a rerun, require an approved exact restored baseline **or** a separately identified, compatible reproduction, confirm 277 common games and the 230 eligible totals games, prove context cutoffs precede kickoffs, and keep the original preflight/fingerprint checks intact. Do not treat a different “latest” baseline as accepted by default. Historical injury and snap rows imported after the games do not become pregame evidence merely because their underlying season is 2025; historical depth `dt` values also need publication-time corroboration. Changes in personnel coverage require a new, explicitly labeled comparison, not a revision of old results.

**Next action for comparison path:** only after one baseline path passes its approval gate, review original personnel source and identity provenance, specify which baseline identity will be paired, and separately authorize any development evaluation run or result writes. Until then, Task 82 remains blocked.

## Tests and safety record

- `pnpm --filter @workspace/scripts run typecheck`: passed.
- `pnpm --filter @workspace/scripts exec tsx ./src/market-baseline-archive-check.test.ts`: **3 passed, 0 failed**. Synthetic complete linked rows pass; absent source bytes block acceptance; altered quote, score, artifact, schema and run identity produce mismatches. These are synthetic checks, **not** validation of an actual archive.
- CLI smoke check with an empty synthetic export: `blocked`, 43 reported mismatches, nonzero exit; no database connection or write.
- No archive was provided; no reconstruction, production access, paid API request, migration, database write, model promotion, accepted-report edit or deployment occurred. Production remains untouched by Task 82B.