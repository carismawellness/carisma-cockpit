-- Combined Aesthetics + Slimming EBITDA pulled from Zoho Books (Carisma Aesthetics org).
-- Both departments are in one Zoho organisation — one row per calendar month.
-- All amounts in EUR (base currency).

CREATE TABLE IF NOT EXISTS aesthetics_ebitda_monthly (
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

CREATE INDEX IF NOT EXISTS idx_aesth_ebitda_month ON aesthetics_ebitda_monthly(month);
