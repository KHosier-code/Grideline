---
name: Team Evidence URL cutoff
description: Why Team Evidence links omit the week when following the latest eligible evidence
---

An omitted week means "follow the latest contiguous verified week." An explicit week is a historical cutoff, but a requested week that is no longer verified is discarded rather than clamped into a new fixed cutoff.

**Why:** A clamped fixed cutoff would silently pin a visitor to an older week after the source recovers. The page must never render the originally requested but unverified chart.

**How to apply:** When adjusting Team Evidence link behavior, preserve the distinction between no week and a manually selected week. Validate a shared cutoff against current discovery coverage before displaying week-specific data, and remove an invalid cutoff so later visits can advance automatically.