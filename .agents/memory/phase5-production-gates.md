---
name: Phase 5 production gates
description: Durable rules for promotion, live prediction snapshots, and post-game grading.
---

Production model use is gated independently for spread, moneyline, and totals. A challenger can be evaluated and retrained without becoming a live model; only an administrator's explicit promotion is eligible for official snapshots.

**Why:** The product must preserve the distinction between research output and production output, and must never turn a model comparison into an implicit betting recommendation.

**How to apply:** Keep promotion history append-only, capture pre-kickoff snapshots without overwriting prior states, freeze the latest eligible snapshot at kickoff, and grade only persisted official snapshots. Treat missing market history as unavailable rather than inventing ATS, totals, or CLV results.