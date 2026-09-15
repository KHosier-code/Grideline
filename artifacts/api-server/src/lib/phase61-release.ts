import { eq, sql } from "drizzle-orm";
import { db, modelTrainingRunsTable } from "@workspace/db";
import { PHASE61_RELEASE_CANDIDATES } from "../release-assets/phase61-release-candidates";
import {
  PHASE6_VECTOR_FEATURE_NAMES,
  PHASE6_VECTOR_SCHEMA_FINGERPRINT,
  artifactMetadataMatchesTrainingRun,
  canonicalArtifactJson,
  predictPersistedModelArtifact,
  validateProductionCandidate,
  verifyArtifactIntegrity,
  type FittedModelArtifact,
} from "./modeling";

const EXPECTED_ARTIFACTS = {
  spread: {
    artifactId: "phase6-1-spread-01c85917b47c6e70c258fe0258481c7a",
    checksum: "01c85917b47c6e70c258fe0258481c7a2a21e567c95db02cac38988baa4034bf",
  },
  moneyline: {
    artifactId: "phase6-1-moneyline-917fa6e7417cccb45909ade470c997d0",
    checksum: "917fa6e7417cccb45909ade470c997d0841fe8a010bc18899f4b5b913be4d6ae",
  },
  totals: {
    artifactId: "phase6-1-totals-749279b5856f1be1165c211d3c6233c7",
    checksum: "749279b5856f1be1165c211d3c6233c7c4f55d44d12ebcb2c94500db63b60c2f",
  },
} as const;

export const PHASE61_RELEASE_MODEL_VERSIONS = PHASE61_RELEASE_CANDIDATES.map(
  (candidate) => candidate.model_version,
);

type ReleaseSourceRow = (typeof PHASE61_RELEASE_CANDIDATES)[number];
type TrainingRun = typeof modelTrainingRunsTable.$inferSelect;
type TrainingRunInsert = typeof modelTrainingRunsTable.$inferInsert;

function mutableJson<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

export function releaseCandidateToInsert(row: ReleaseSourceRow): TrainingRunInsert {
  return {
    modelVersion: row.model_version,
    family: row.family,
    algorithm: row.algorithm,
    featureVersion: row.feature_version,
    trainingSeasons: [...row.training_seasons],
    testSeason: row.test_season,
    samplePolicy: row.sample_policy,
    recencyWeighting: row.recency_weighting,
    status: row.status,
    sampleSize: row.sample_size,
    metrics: mutableJson(row.metrics),
    calibration: mutableJson(row.calibration),
    featureImportance: mutableJson(row.feature_importance),
    vectorFeatureNames: [...row.vector_feature_names],
    vectorSchemaFingerprint: row.vector_schema_fingerprint,
    modelArtifact: mutableJson(row.model_artifact),
    notes: row.notes,
    trainedAt: new Date(row.trained_at),
  };
}

function insertToSelect(run: TrainingRunInsert): TrainingRun {
  return { id: 0, ...run } as TrainingRun;
}

function candidatePayload(run: TrainingRun | TrainingRunInsert) {
  return {
    modelVersion: run.modelVersion,
    family: run.family,
    algorithm: run.algorithm,
    featureVersion: run.featureVersion,
    trainingSeasons: run.trainingSeasons,
    testSeason: run.testSeason,
    samplePolicy: run.samplePolicy,
    recencyWeighting: run.recencyWeighting,
    status: run.status,
    sampleSize: run.sampleSize,
    metrics: run.metrics,
    calibration: run.calibration,
    featureImportance: run.featureImportance,
    vectorFeatureNames: run.vectorFeatureNames,
    vectorSchemaFingerprint: run.vectorSchemaFingerprint,
    modelArtifact: run.modelArtifact,
    notes: run.notes,
    trainedAt: new Date(run.trainedAt ?? 0).toISOString(),
  };
}

export function validatePhase61ReleaseCandidate(run: TrainingRunInsert) {
  const selected = insertToSelect(run);
  const family = run.family as keyof typeof EXPECTED_ARTIFACTS;
  const expected = EXPECTED_ARTIFACTS[family];
  const artifact = run.modelArtifact as FittedModelArtifact | null;
  const integrity = verifyArtifactIntegrity(selected);
  const validation = validateProductionCandidate(selected);
  const failures = [
    ...integrity.failures,
    ...validation.failures,
  ];
  if (!expected) failures.push(`Unexpected release family ${run.family}`);
  if (artifact?.metadata?.artifactId !== expected?.artifactId) failures.push("Artifact ID is not the approved release ID");
  if (artifact?.metadata?.artifactChecksum !== expected?.checksum) failures.push("Artifact checksum is not the approved release checksum");
  if (!artifactMetadataMatchesTrainingRun(selected)) failures.push("Artifact metadata does not match its training-run columns");
  if (run.status !== "refit_candidate") failures.push("Release row must remain a refit candidate");
  if (run.vectorSchemaFingerprint !== PHASE6_VECTOR_SCHEMA_FINGERPRINT
    || JSON.stringify(run.vectorFeatureNames) !== JSON.stringify(PHASE6_VECTOR_FEATURE_NAMES)) {
    failures.push("Release row does not preserve the exact 27-feature ordering");
  }
  const probe = Array.from({ length: PHASE6_VECTOR_FEATURE_NAMES.length }, (_, index) => index / 10);
  const first = predictPersistedModelArtifact(selected, probe);
  const second = predictPersistedModelArtifact(selected, probe);
  if (first === null || !Number.isFinite(first) || first !== second) {
    failures.push("Persisted artifact failed deterministic finite inference");
  }
  return {
    valid: failures.length === 0,
    failures: [...new Set(failures)],
    artifactId: artifact?.metadata?.artifactId ?? null,
    artifactChecksum: integrity.checksum,
    deterministicProbe: first,
  };
}

export function assertExistingCandidateMatchesRelease(
  existing: TrainingRun,
  approved: TrainingRunInsert,
) {
  if (canonicalArtifactJson(candidatePayload(existing)) !== canonicalArtifactJson(candidatePayload(approved))) {
    throw new Error(`Production already contains conflicting content for ${approved.modelVersion}; no row was changed.`);
  }
}

export function verifyPersistedPhase61ReleaseCandidates(existingRows: TrainingRun[]) {
  return PHASE61_RELEASE_CANDIDATES.map(releaseCandidateToInsert).map((approved) => {
    const existing = existingRows.find((row) => row.modelVersion === approved.modelVersion);
    if (!existing) {
      return {
        family: approved.family,
        modelVersion: approved.modelVersion,
        exactVerified: false,
        error: "Approved artifact is not present.",
      };
    }
    try {
      assertExistingCandidateMatchesRelease(existing, approved);
      return {
        family: approved.family,
        modelVersion: approved.modelVersion,
        exactVerified: true,
        artifactId: (approved.modelArtifact as FittedModelArtifact).metadata?.artifactId ?? null,
        artifactChecksum: (approved.modelArtifact as FittedModelArtifact).metadata?.artifactChecksum ?? null,
      };
    } catch (error) {
      return {
        family: approved.family,
        modelVersion: approved.modelVersion,
        exactVerified: false,
        error: error instanceof Error ? error.message : "Persisted artifact does not match the approved release.",
      };
    }
  });
}

export async function importPhase61ReleaseCandidates() {
  const approved = PHASE61_RELEASE_CANDIDATES.map(releaseCandidateToInsert);
  const validation = approved.map((run) => ({
    run,
    result: validatePhase61ReleaseCandidate(run),
  }));
  const invalid = validation.filter((item) => !item.result.valid);
  if (invalid.length) {
    throw new Error(`Phase 6.1 release manifest failed verification: ${invalid.flatMap((item) => item.result.failures).join("; ")}`);
  }

  const outcomes = await db.transaction(async (tx) => {
    const results: Array<{ modelVersion: string; outcome: "inserted" | "already_present" }> = [];
    for (const run of approved) {
      const [inserted] = await tx.insert(modelTrainingRunsTable)
        .values(run)
        .onConflictDoNothing({ target: modelTrainingRunsTable.modelVersion })
        .returning();
      const persisted = inserted ?? (await tx.select().from(modelTrainingRunsTable)
        .where(eq(modelTrainingRunsTable.modelVersion, run.modelVersion)).limit(1))[0];
      if (!persisted) throw new Error(`Could not verify persisted release row ${run.modelVersion}`);
      assertExistingCandidateMatchesRelease(persisted, run);
      results.push({ modelVersion: run.modelVersion, outcome: inserted ? "inserted" : "already_present" });
    }
    return results;
  });

  return {
    release: "phase6.1-artifact-recovery",
    method: "admin_release_manifest_append_only",
    nonDestructive: true,
    idempotent: true,
    candidates: validation.map(({ run, result }) => ({
      family: run.family,
      modelVersion: run.modelVersion,
      artifactId: result.artifactId,
      artifactChecksum: result.artifactChecksum,
      featureCount: run.vectorFeatureNames?.length ?? 0,
      vectorFeatureNames: run.vectorFeatureNames,
      vectorSchemaFingerprint: run.vectorSchemaFingerprint,
      deterministicInference: result.deterministicProbe,
      outcome: outcomes.find((item) => item.modelVersion === run.modelVersion)?.outcome,
    })),
    promotion: { automatic: false, occurred: false },
    consumerPredictionWrites: 0,
  };
}

export async function getModelArtifactImmutabilityStatus() {
  const result = await db.execute(sql`
    select exists (
      select 1
      from pg_trigger t
      join pg_class c on c.oid = t.tgrelid
      join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public'
        and c.relname = 'model_training_runs'
        and t.tgname = 'model_training_runs_artifact_immutable'
        and not t.tgisinternal
        and t.tgenabled <> 'D'
    ) as active
  `) as unknown as { rows: Array<{ active: boolean }> };
  const databaseTriggerActive = result.rows[0]?.active === true;
  return {
    status: databaseTriggerActive ? "database_and_application" as const : "application_only" as const,
    mechanism: databaseTriggerActive ? "database_trigger_and_application" : "application_append_only",
    applicationUpdateDeleteBlocked: true,
    productionFittingBlocked: true,
    databaseTriggerActive,
    databaseTriggerSupport: databaseTriggerActive ? "active" : "unavailable_through_current_publish_path",
    verification: "build_regression_confirms_no_model_training_run_update_or_delete_path",
    note: databaseTriggerActive
      ? "Database and application append-only safeguards are active."
      : "The current Publish path did not install the custom PostgreSQL trigger. The application contains no model-training-run update/delete path, and fitting is denied outside explicit development/test.",
  };
}