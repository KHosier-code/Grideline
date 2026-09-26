---
name: Saved-game meaning
description: Interpretation of a consumer's saved matchup across changes in projection and market evidence
---

A saved game is a user's choice to follow a matchup, not an endorsement or frozen copy of the projection or sportsbook line visible when they saved it. Display the current eligible persisted evidence and explicit unavailable reasons on later visits.

**Why:** Projection and market coverage can change independently of a user's interest in the game. Capturing the displayed values at save time would make missing or outdated evidence appear current and blur the pregame safety boundary.

**How to apply:** When adding saved-game filters, alerts, or exports, preserve game identity separately from prediction and market evidence; do not infer eligibility from the existence of a save.