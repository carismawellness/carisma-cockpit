-- Per-location per-month EBITDA lines pulled from Zoho Books (SPA org).
-- Replaces the hardcoded mock data in app/finance/ebitda/spa/page.tsx.
-- All amounts in the organisation's base currency (EUR).

CREATE TABLE spa_ebitda_monthly (
  id             SERIAL PRIMARY KEY,
  month          DATE    NOT NULL,
  location_id    INTEGER NOT NULL REFERENCES locations(id),
  revenue        NUMERIC(14,2) NOT NULL DEFAULT 0,
  cogs           NUMERIC(14,2) NOT NULL DEFAULT 0,
  wages          NUMERIC(14,2) NOT NULL DEFAULT 0,
  advertising    NUMERIC(14,2) NOT NULL DEFAULT 0,
  rent           NUMERIC(14,2) NOT NULL DEFAULT 0,
  utilities      NUMERIC(14,2) NOT NULL DEFAULT 0,
  sga            NUMERIC(14,2) NOT NULL DEFAULT 0,
  zoho_synced_at TIMESTAMPTZ  NOT NULL DEFAULT now(),
  UNIQUE(month, location_id)
);

CREATE INDEX idx_spa_ebitda_loc_month ON spa_ebitda_monthly(location_id, month);
CREATE INDEX idx_spa_ebitda_month     ON spa_ebitda_monthly(month);
