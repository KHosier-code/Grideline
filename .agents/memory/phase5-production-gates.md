---
name: Phase 5 production gates
description: Durable rules for promotion, live prediction snapshots, and post-game grading.
---

Production model use is gated independently for spread, moneyline, and totals. A challenger can be evaluated and retrained without becoming a live model; only an administrator's explicit promotion is eligible for official snapshots.

**Why:** The product must preserve the distinction between research output and production output, and must never turn a model comparison into an implicit betting recommendation.

**How to apply:** Keep promotion history append-only and capture pre-kickoff snapshots without overwriting prior states. The official evaluation boundary is 30 minutes before kickoff; freeze only while kickoff is still in the future and only with complete cutoff-safe market evidence. A previously flagged historical row that was frozen after kickoff is legacy evidence, not a verified official prediction: do not retroactively rehabilitate or grade it. Treat missing market history as unavailable rather than inventing ATS, totals, or CLV results.