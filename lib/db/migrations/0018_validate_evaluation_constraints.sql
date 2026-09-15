ALTER TABLE "model_evaluation_predictions"
  VALIDATE CONSTRAINT "model_evaluation_future_identity_check",
  VALIDATE CONSTRAINT "model_evaluation_future_market_side_check",
  VALIDATE CONSTRAINT "model_evaluation_outcome_consistency_check",
  VALIDATE CONSTRAINT "model_evaluation_projection_completeness_check";