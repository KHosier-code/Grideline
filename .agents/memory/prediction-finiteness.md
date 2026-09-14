---
name: Prediction finiteness gates
description: Guards for numeric model outputs and immutable prediction snapshots.
---

Feature vectors and fitted model outputs must be finite before they are used to create an official prediction snapshot. PostgreSQL can preserve floating-point `NaN`, while JSON serialization exposes it as `null`, which can make an apparently successful generation look like missing predictions. The same validity gate must exclude legacy invalid rows from freezing, grading, performance, and drift metrics.

**Why:** A generation run previously inserted rows containing `NaN` for spread and moneyline outputs even though the request succeeded. The live board must never treat those rows as valid production predictions.

**How to apply:** Normalize or reject non-finite feature values during standardization, reject non-finite model outputs before insertion, and exclude invalid legacy rows from live prediction, ranking, freezing, grading, and metric views. Keep invalid historical rows auditable rather than silently rewriting them.