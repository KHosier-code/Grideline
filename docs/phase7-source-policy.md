# Phase 7 source policy

Gridline only ingests sources that permit the intended use and keeps source
classification and timestamps in the personnel audit. The selected hierarchy
is: (1) a verified current published depth chart, (2) a secondary published
source, (3) recent nflverse snap-count/participation inference, and (4)
historical nflverse depth charts. Inferred players are never labeled official.

| Source | Policy |
| --- | --- |
| Ourlads | **Not ingested.** Automated access is prohibited by the [terms](http://ourlads.com/tc). |
| NFL.com / official team HTML | **Not ingested.** Systematic retrieval is not used absent written consent under [NFL terms](https://www.nfl.com/legal/terms). |
| ESPN depth-chart endpoint | Existing best-effort structured ingestion is retained, but structured rows are not guaranteed and ESPN terms/robots status is not verified for production reuse. No new scraping or access-control bypass is added. See [terms](https://www.espn.com/espn/story/_/id/29124657/terms-conditions) and [robots](https://www.espn.com/robots.txt). |
| nflverse | Historical depth, participation, and snap source under the [nflverse license](https://nflverse.nflverse.com/LICENSE-text.html). |
| National Weather Service | U.S. stadium forecasts use keyless [api.weather.gov](https://www.weather.gov/documentation/services-web-api), with a descriptive User-Agent and bounded cached requests. |

## Verified depth evidence

Permitted official/licensed material and safe manual verification are retained
in the append-only `verified_depth_evidence` table. Each observation carries
its source URL (when available), observed and verified timestamps, verification
method, source hash, confidence, availability, and provenance. A verification
row may explicitly be `unavailable` or `ambiguous`; the loader never converts
those states into a starter.

The published depth track is immutable from the interpretation layer. Injury
availability overlays the published player but does not rewrite their rank.
An expected replacement is emitted separately and only when a mapped,
cutoff-safe depth or participation signal supports it. Expected players are
always labeled projected and are not official depth or direct coverage claims.

Weather snapshots are immutable and are selected only when fetched no later
than the context cutoff. Indoor games record an indoor designation and do not
fabricate outdoor conditions. International or unsupported venues remain
explicitly unavailable. Phase 6 models, predictions, recommendations, and
wagering behavior are not modified.