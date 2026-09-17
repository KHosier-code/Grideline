---
name: Shadow inference chronology
description: Chronology rules for deterministic model inference retried after a canonical evidence cutoff.
---

A retry may persist deterministic shadow inference after the nominal cutoff only when the immutable model artifact and every feature row are explicitly bounded by the canonical cutoff. The persisted inference time must remain distinct from the evidence cutoff.

**Why:** Reusing a production snapshot timestamp for a challenger can make a later inference look contemporaneous, while reading the current feature row can silently admit evidence produced after the cutoff.

**How to apply:** Filter every mutable input by its own source cutoff, reproduce the artifact's exact feature derivation, persist both cutoff and inference timestamps, and reject inference at or after kickoff.