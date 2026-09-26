# Consumer production-build performance

Run `pnpm test:consumer-performance` from the workspace root (or `pnpm --filter @workspace/nfl-analytics perf:report` to report without enforcing budgets). Start the API Server workflow first. The command builds the production app, serves the built files with Vite preview, measures Home and Games before looking up a real game ID from the consumer dashboard, and opens fresh Chromium contexts for Home, Games, Game Detail, and Performance. `PERF_OUTPUT=path.json` saves the machine-readable report. To check a non-root deployment path, run `BASE_PATH=/gridline/ pnpm test:consumer-performance`. The script also checks anonymous `/admin` and `/sign-in` boundaries and navigates from each public route.

Profiles: mobile is 390×844, 2× DPR, 4× CPU slowdown, 150 ms network latency and 200 KiB/s download; desktop is 1440×900, 1× CPU, 20 ms latency and 5 MiB/s download. The local production preview has no CDN. Browser requests to `/api` are forwarded to the running development API to keep real saved evidence; this proxy forwarding is **not** subject to the emulated browser network throughput. Clerk availability and API content can vary. Runs are single samples, not lab percentiles or field Core Web Vitals.

Budget per route (mobile / desktop): LCP ≤9,000 / 4,000 ms; time until route heading or finished detail state ≤11,000 / 6,000 ms; click-to-URL transition ≤3,500 / 2,000 ms; CLS ≤0.1; cold-load JS transfer ≤400 KiB. The check rejects access-check/loading screens as completed pages, HTTP errors, missing links, and unauthorized admin-shell rendering. The report also records DOMContentLoaded and accumulated long-task blocking time (duration beyond 50 ms). Interaction time measures navigation response, **not** INP or data completion on the destination.

## Measurements

Captured in this workspace against the production build, with a fresh browser context per route. The baseline run was taken before the split; it is a diagnostic of the original access gate, **not** a valid route-level LCP or interaction comparison. The first pass measured the access-check screen because Clerk did not finish initializing on the local preview hostname. The revised router now allows public pages to render during that check. No signed-in Home or admin page is claimed to be measured by this anonymous harness.

| Profile / route | Before: first JS KiB | Before: observed screen, LCP ms | After: JS KiB | After: completed route / LCP ms | After: click ms | After: CLS |
| --- | ---: | --- | ---: | --- | ---: | ---: |
| Mobile Home | 340 | Checking access / 3,176 | 177 | Pick of the week / 2,264 | 119 | 0.0002 |
| Mobile Games | 340 | Checking access / 2,780 | 181 | Market board / 2,104 | 133 | 0.0173 |
| Mobile Game Detail | 340 | Checking access / 2,772 | 311 | Saved projection state / 6,184 | 258 | 0 |
| Mobile Performance | 340 | Checking access / 2,908 | 286 | Performance / 4,748 | 110 | 0.0012 |
| Desktop Home | 340 | No route heading / 1,480 | 177 | Pick of the week / 540 | 36 | 0.0004 |
| Desktop Games | 340 | No route heading / 1,408 | 181 | Market board / 616 | 43 | 0.0104 |
| Desktop Game Detail | 340 | No route heading / 1,332 | 311 | Saved projection state / 1,808 | 40 | 0.0003 |
| Desktop Performance | 340 | No route heading / 1,488 | 286 | Performance / 632 | 32 | 0.001 |

Before: one 1,264 KB minified JS asset (348 KB gzip). After: 612 KB entry (175 KB gzip); Recharts' 382 KB chart module (105 KB gzip) is requested on Game Detail and Performance, not on Home or Games. The cold Home JS transfer decreased from 340 KiB to 177 KiB (48%). This is evidence of less initial download, **not** proof that signed-in route time improved: the baseline did not reach those pages. The non-root `/gridline/` build and budget run passed with route headings, navigation, and boundary checks. Existing API data still determines whether projections and graded charts appear.

Optional verified imagery is refreshed in the background for consumer routes; stale verified images or null placeholders are returned immediately. The unit test in `artifacts/api-server/src/lib/verified-imagery.test.ts` holds a simulated remote refresh pending and checks that a cold read remains immediate and concurrent requests share one attempt with a five-minute retry gap. This isolates the source-timeout behavior from live GitHub variability. The browser check does not artificially purge the API process cache; for a cold-process integration reading, restart the API workflow before running the budget command. After restarting the API once and running the root-path budget command with no manual API warmup, the first dashboard request completed in 266 ms; mobile Home reached its heading in 2,405 ms with 2,364 ms LCP, while mobile Games reached its heading in 2,241 ms with 2,232 ms LCP. The separate pending-refresh unit test covers the source-timeout case, which a live GitHub request cannot reliably reproduce.