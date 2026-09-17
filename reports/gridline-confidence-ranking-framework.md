# Gridline Confidence Ranking Framework

## Version and formula

`confidence-v1` keeps Data Confidence, Model Confidence, and Market Edge
Strength separate. The composite is:

`0.35 × data + 0.35 × model + 0.30 × market edge`

Each component is normalized to 0–100. Data is the minimum of persisted
quarterback evidence and feature completeness; low-sample snapshots are capped
at 49 and cannot pass the acceptable-data gate, and any missing feature also
fails that gate. Model uses an equal blend of projection-revision stability
(when at least two immutable snapshots exist) and retained family error
context; it is otherwise unavailable. Market Edge uses 70% model/market
difference (0 at zero and 100 at 7 points or percentage points), 10% freshness,
10% fresh two-book coverage, and 10% agreement between current DraftKings and
FanDuel observations. Labels are Low (<50), Moderate (50–69), Strong (70–84),
and Very Strong (85–100).

## Gates and evidence

Strong and Very Strong are capped when the snapshot is invalid, the
family-specific artifact is not verified with the persisted artifact utility,
starters/personnel context is unresolved, Data Confidence is below 60,
current DraftKings/FanDuel evidence is stale or missing, fewer than two books
are available, or the books disagree. Market evidence exposes current quotes,
book count, and documented agreement tolerance.

Methodology and results are append-only, versioned, checksum guarded, and do
not mutate snapshots, model artifacts, picks, or sportsbook observations.
Audit persistence fingerprints canonical snapshot quality, model version,
cutoff-safe revisions, quote values/timestamps, retained baseline identity, and
gate outcomes; execution time is retained but does not define evidence identity.

## Honest current and historical status

The development validation on September 17, 2026 evaluated 16 Week 2 games
and 48 market-specific results: Low 48, Moderate 0, Strong 0, Very Strong 0.
Unavailable inputs remained Low rather than being forced into a higher tier.
The retained 2025 source is `nflverse/nfldata games.csv` and is designated
recorded evidence only. It has no sportsbook or observation timestamps and
does not support verified closing lines, CLV, ROI, profitability, or universal
betting thresholds. Unsupported or weak tier buckets are explicitly
insufficient with sample size and 95% interval fields rather than inferred.
Evaluation-only 2025 rows fail closed to Low because the retained source has no
per-game Data Confidence, verified artifact, starter-resolution, revision, or
timestamped sportsbook evidence. Spread: Low 277 (223 graded ATS decisions,
112-111, 50.2%, 95% interval 43.7%-56.7%). Total: Low 230 (182 graded O/U
decisions, 84-98, 46.2%, 95% interval 39.1%-53.4%). Moderate, Strong, and Very
Strong are zero for both markets. Moneyline: Low 277, but tier outcome analysis
is unavailable because the retained report has no moneyline edge buckets or
tier settlement evidence. These are evaluation-only recorded-line results,
not verified closes, CLV, ROI, profitability, or recommended thresholds.

## Validation and publishing

Focused confidence normalization, fail-closed, contract, authorization, and
append-only checks are included alongside API-server typecheck and OpenAPI
code generation. Phase 6.1 artifacts and production prediction snapshots are
untouched. Publishing is required for the consumer contract/UI to display the
new confidence disclosure.