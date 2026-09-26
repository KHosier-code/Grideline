# Initial-line evidence audit (development, 2026-09-26)

Read-only development queries were run before implementation. The database
reported `transaction_read_only=off`; no production database was queried.

- 165 prediction snapshots, **one** row with `official_final_prediction=true`,
  180 historical quote rows, and two successful paid-request ledger rows were
  present. Quotes cover 15 games; no upcoming game had a quote at audit time.
- The sole official row (game `401872931`) has `input_feature_count=0`,
  no vector, no input source evidence, no schema fingerprint, and no evaluation
  cutoff. Its `frozen_at` is **after** the saved kickoff. It fails the
  verified-official selection rules and all three saved model versions differ
  from the current production versions. It cannot be called a verified
  historical official prediction or an initial-line pick.
- Zero official rows had both a non-null input vector and source evidence
  with a pre-kickoff freeze. Zero official rows had a prediction timestamp at
  or before their game's first persisted quote. The earlier unverified
  official row is correctly excluded by the integrity checks, not merely
  hidden by the current-version filter.
- An older official row **can** be displayed after promotion if the frozen
  cutoff, original fitted artifacts, production promotion chronology, vector
  and source evidence verify. The historical recovery path already does this
  for completed games. It must not be interpreted as an initial-line decision.
- Existing quote history has no request ID per quote and older snapshots do
  not bind all four same-book sides at the first observed request. No legacy
  row can safely be relabeled as an initial-line lock. New game-level outcomes
  and a separate immutable weekly selection are required; the near-kickoff
  official prediction and grading remain unchanged.

The first observed Gridline request is **not** the provider's opening market.
The new contract begins only with future successful, persisted capture
events. Historical games and their snapshots remain untouched.