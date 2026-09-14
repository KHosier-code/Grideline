---
name: Phase 7 context boundary
description: Rules for personnel/context features, evidence cutoffs, and separation from active production models.
---

Phase 7 personnel and context intelligence must remain an additive feature version. Keep active Phase 6 models on their promoted feature version until separately evaluated challengers have honest historical evidence and explicit promotion.

**Why:** Personnel, weather, travel, and matchup sources have uneven coverage. Treating inferred or unavailable context as official data would create leakage and could silently change trusted production behavior.

**How to apply:** Use only evidence timestamped before the game cutoff; label probable starters as official or inferred; preserve source timestamps and unavailable reasons; never impute unsupported weather, travel, replacement quality, or direct assignments. When licensed sources use incompatible player or game ID namespaces, bridge player identity with cutoff-safe names inside the same team; rows from strictly earlier seasons may be admitted without fabricated kickoff timestamps, but same-season evidence still requires a known pre-cutoff kickoff. Treat Replit Publish as authoritative for production tables, columns, and indexes; its application migration ledger need not mirror Publish. Keep weather writes insert-only. Until Replit supports custom production SQL migrations, report the absent append-only trigger as a defense-in-depth limitation that does not itself fail Phase 8 eligibility.