---
name: Matchup alert evidence
description: Why matchup notifications must compare stable, overlapping pregame evidence instead of feed activity.
---

Only issue a matchup change alert when comparable, cutoff-safe persisted evidence crosses a material threshold relative to the last alerted baseline. Missing or conflicted QB evidence must neither trigger an alert nor erase the last known comparison point. A first visit after kickoff must still reconcile evidence saved before kickoff; otherwise an in-app-only alert can permanently miss pregame changes.

**Why:** Provider polling, unchanged snapshots, and temporary evidence gaps can otherwise look like meaningful changes. A small change on each refresh can also hide a cumulative change if the baseline advances on every poll. Fans may not revisit until after the game begins.

**How to apply:** When adding new alert categories or delivery channels, retain per-user opt-in, preserve category-specific baselines across gaps, and never initiate model inference or data synchronization from the alert path.