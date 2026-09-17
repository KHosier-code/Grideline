---
name: Personnel audit preflight
description: Decision rules for historical personnel evidence checks before audit model fitting.
---

Historical personnel audit preflight must treat missing source rows separately from numeric zeroes derived from empty inputs. Missing categories and unsupported derived zeroes produce a warning; absent contexts or evidence that is not strictly before kickoff blocks fitting.

**Why:** A comparison can execute with zero-imputed vectors even when an entire personnel category has no historical source evidence, which can make a completed audit look better-supported than it is.

**How to apply:** Run the read-only coverage and chronology check on the exact reconstructed audit snapshot before any challenger fitting. Report coverage per season and category, and retain the preflight result with the final report.