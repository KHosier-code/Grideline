ALTER TABLE "identity_source_imports"
  ADD COLUMN IF NOT EXISTS "parser_version" text NOT NULL DEFAULT 'v1';

ALTER TABLE "identity_source_imports"
  DROP CONSTRAINT IF EXISTS "identity_source_imports_content_unique";

ALTER TABLE "identity_source_imports"
  ADD CONSTRAINT "identity_source_imports_content_parser_unique"
  UNIQUE ("source_namespace", "source_content_hash", "parser_version");