# Multi-sport site plan (NFL + college basketball)

Decided with Kalen on 2026-11-01. Use this as the brief for the next build.

## Decisions
1. **Home page shows both sports**: today's top picks from each, each card leading into
   that sport's section. Until launch, customers see only the NFL half; admins see both.
2. **College basketball goes public on December 1, 2026** (morning, Eastern). Build a
   single launch switch (one date constant shared by web and API) that, on that date,
   removes the admin-only gate (`CbbGate`, `requireAdmin` on `/api/consumer/cbb`), shows
   the sport tabs to everyone, and adds the `/cbb` pages back to the sitemap and
   metadata (`serve.mjs`, `metadata.mjs`, `lib/public-metadata.ts`). Moving the date
   must be a one-line change.
3. **Look and feel**: Kalen is still exploring; build the structure first so there is
   something real to react to.

## Structure to build
- Sport tabs across the top of every page: **NFL | College Basketball** (replaces the
  small sidebar switch in `ConsumerShellView.tsx`).
- Each sport has its own menu, record, wording (footer/ledes) and a small accent color.
  College menu: Today's games, Power Ratings, Record, How it works.
- Keep every existing NFL URL working (`/touchdowns`, `/games`, `/performance`, ...).
  College stays under `/cbb/...`.
- NFL and college records never mix.

## Where things are
- College model + daily job: `research/cbb-model/` (`daily.py`, `factors.py`,
  `ratings.py`, `roster.py`), workflow `.github/workflows/cbb-daily.yml`
  (8:10 / 12:10 / 4:10 / 7:40 ET).
- College API: `GET /api/consumer/cbb` in `artifacts/api-server/src/routes/consumer-picks.ts`
  (record graded in `lib/cbb-record.ts`).
- College pages: `artifacts/nfl-analytics/src/pages/cbb/`, helpers `src/lib/cbb.ts`.

## After the layout
- Phase 2: a page per college game (side-by-side Four Factors, biggest edges, pace,
  line movement).
- Phase 3: team pages (game log vs our line, rating trend, roster, injuries).
- Phase 4: standings, upset alerts, March bracket center.

## Mockup and agreed tweaks (2026-11-01)
Mockup (private to Kalen): https://claude.ai/artifact/YbQwRq2FU3TRYGNxghe8AQ — home with
Home | NFL | College Basketball tabs, NFL section (coral accent), college section (blue
accent), phone home. Build from it with these changes:
1. **Record next to the picks**: each sport card on the home page carries its own record
   line (e.g. "NFL early lines: 9-6, +2.4 units"), not just small boxes in the corner.
2. **College on the home page shows only the top 3 picks by gap**, never the full list.
3. **Next start time** on each sport card on game days ("next kickoff 1:00 PM",
   "first tip 6:30 PM").
4. **Check the blue accent in light mode** before locking it in; adjust for contrast.
5. Keep a small "New: tracking since Nov 2" note on college pages for the first month or
   two after launch.
