CREATE TABLE etl_sync_log (
  id SERIAL PRIMARY KEY,
  source_name TEXT NOT NULL,
  started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  completed_at TIMESTAMPTZ,
  status TEXT NOT NULL DEFAULT 'running' CHECK (status IN ('running', 'success', 'partial', 'failed')),
  rows_upserted INTEGER DEFAULT 0,
  error_message TEXT,
  duration_sec NUMERIC(8,2)
);

CREATE INDEX idx_etl_log ON etl_sync_log(source_name, started_at DESC);
