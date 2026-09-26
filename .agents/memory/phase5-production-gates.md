---
name: Phase 5 production gates
description: Durable rules for promotion, live prediction snapshots, and post-game grading.
---

Production model use is gated independently for spread, moneyline, and totals. A challenger can be evaluated and retrained without becoming a live model; only an administrator's explicit promotion is eligible for official snapshots.

**Why:** The product must preserve the distinction between research output and production output, and must never turn a model comparison into an implicit betting recommendation.

**How to apply:** Keep promotion history append-only, capture pre-kickoff snapshots without overwriting prior states, freeze the latest eligible snapshot at kickoff, and grade only persisted official snapshots. Treat missing market history as unavailable rather than inventing ATS, totals, or CLV results.

For historical consumer reads, do not require a frozen official prediction to match today's active model versions. Verify the original promotion chronology and fitted artifact integrity independently, while leaving current-model selection and freezing unchanged.

**Why:** A legitimate immutable pregame result can otherwise disappear from the consumer view merely because the production models were rotated later.

**How to apply:** Only recover past official rows with preserved input chronology, cutoff and freeze evidence; never use this exception for future matchups, model promotion, snapshot creation, or grading.