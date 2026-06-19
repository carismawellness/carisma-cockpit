-- HQ / corporate overhead EBITDA pulled from Zoho Books using the HQ reporting tag.
-- Transactions tagged "HQ" in Zoho are fetched separately and stored here.
-- One row per calendar month. All amounts in EUR (base currency).

CREATE TABLE IF NOT EXISTS hq_ebitda_monthly (
  id             SERIAL PRIMARY KEY,
  month          DATE    NOT NULL UNIQUE,
  revenue        NUMERIC(14,2) NOT NULL DEFAULT 0,
  cogs           NUMERIC(14,2) NOT NULL DEFAULT 0,
  wages          NUMERIC(14,2) NOT NULL DEFAULT 0,
  advertising    NUMERIC(14,2) NOT NULL DEFAULT 0,
  rent           NUMERIC(14,2) NOT NULL DEFAULT 0,
  utilities      NUMERIC(14,2) NOT NULL DEFAULT 0,
  sga            NUMERIC(14,2) NOT NULL DEFAULT 0,
  zoho_synced_at TIMESTAMPTZ  NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_hq_ebitda_month ON hq_ebitda_monthly(month);

-- Row-level security: service role bypasses, authenticated users read-only
ALTER TABLE hq_ebitda_monthly ENABLE ROW LEVEL SECURITY;

CREATE POLICY "hq_ebitda_service_all" ON hq_ebitda_monthly
  FOR ALL TO service_role USING (true) WITH CHECK (true);

CREATE POLICY "hq_ebitda_auth_read" ON hq_ebitda_monthly
  FOR SELECT TO authenticated USING (true);
