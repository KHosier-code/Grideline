CREATE TABLE IF NOT EXISTS imagery_source_rows (
  import_id integer PRIMARY KEY REFERENCES identity_source_imports(id),
  rows jsonb NOT NULL
);