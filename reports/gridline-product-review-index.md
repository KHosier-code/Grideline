# Gridline Product Review Guide

**Review URL:** https://gridelineanalytics.com

This is the existing public VM deployment, not a temporary consumer-only deployment. It was not modified for this audit.

## Access

- Anonymous read-only consumer routes: /games and /games/:gameId.
- Authentication required: Home, Usage Lab, Performance, Trends, Props, and all Admin routes.
- Admin APIs and mutations remain protected by Clerk/requireAdmin. No secrets, database tools, raw provider payloads, or public mutation endpoints were exposed.

## Real data and limitations

The deployment serves persisted schedule, final scores only when game status is complete, prediction snapshots, market evidence where available, confidence, and personnel/weather context. Empty, stale, low-confidence, and unavailable states are real. On 2026-09-17 the Games board visibly showed STALE, 1/16 games compared, DraftKings one game, FanDuel zero, and Low 0/100 confidence.

## Review artifact

| File | Route | View | State | Notes |
|---|---|---|---|---|
| reports/product-review/production-games.png | /games | Desktop production capture | Real, stale/partial | Static capture from 2026-09-17; use the live URL for current data. |

## Suggested reviewer checklist

- Does the visual hierarchy remain clear when evidence is sparse?
- Are model projections distinct from sportsbook numbers?
- Are confidence labels understandable and properly qualified?
- Are unavailable, stale, partial, and inferred states honest?
- Does the product imply direct coverage or official depth where none exists?
- Which page provides the most and least daily research value?
- What would make a serious NFL researcher return daily?

The full evidence-based audit is in reports/gridline-current-state-audit.md.
