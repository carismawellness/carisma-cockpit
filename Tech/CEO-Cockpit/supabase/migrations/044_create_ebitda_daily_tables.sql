-- Daily-granular EBITDA cost tables. Replace the role currently played by the
-- {spa,hq,aesthetics}_ebitda_monthly tables, which baked monthly-level fallbacks
-- (wages/rent/laundry/supplement) directly into stored values.
--
-- With the new tag-aware Zoho ETL (commit e199175), the source data is line-level
-- per (date, tag). Persisting at daily granularity lets the dashboard run EBITDA
-- for any user-selected period; fallbacks are applied at read-time in the hooks,
-- proportional to the chosen window — not baked into the writes.
--
-- The old _monthly tables are left in place untouched. They will be retired once
-- the daily pipeline is validated end-to-end.

-- ── SPA: per (date, venue) ──────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS spa_ebitda_daily (
  id             SERIAL PRIMARY KEY,
  date           DATE          NOT NULL,
  location_id    INTEGER       NOT NULL REFERENCES locations(id),
  revenue        NUMERIC(14,2) NOT NULL DEFAULT 0,
  cogs           NUMERIC(14,2) NOT NULL DEFAULT 0,
  wages          NUMERIC(14,2) NOT NULL DEFAULT 0,
  advertising    NUMERIC(14,2) NOT NULL DEFAULT 0,
  rent           NUMERIC(14,2) NOT NULL DEFAULT 0,
  utilities      NUMERIC(14,2) NOT NULL DEFAULT 0,
  sga            NUMERIC(14,2) NOT NULL DEFAULT 0,
  laundry        NUMERIC(14,2) NOT NULL DEFAULT 0,
  zoho_synced_at TIMESTAMPTZ   NOT NULL DEFAULT now(),
  UNIQUE(date, location_id)
);

CREATE INDEX IF NOT EXISTS idx_spa_ebitda_daily_date     ON spa_ebitda_daily(date);
CREATE INDEX IF NOT EXISTS idx_spa_ebitda_daily_loc_date ON spa_ebitda_daily(location_id, date);

ALTER TABLE spa_ebitda_daily ENABLE ROW LEVEL SECURITY;
CREATE POLICY "spa_ebitda_daily_service_all" ON spa_ebitda_daily
  FOR ALL    TO service_role  USING (true) WITH CHECK (true);
CREATE POLICY "spa_ebitda_daily_auth_read"   ON spa_ebitda_daily
  FOR SELECT TO authenticated USING (true);

-- ── HQ: per (date, source) — same source dimension as hq_ebitda_monthly ─────

CREATE TABLE IF NOT EXISTS hq_ebitda_daily (
  id             SERIAL PRIMARY KEY,
  date           DATE          NOT NULL,
  source         TEXT          NOT NULL DEFAULT 'spa',
  revenue        NUMERIC(14,2) NOT NULL DEFAULT 0,
  cogs           NUMERIC(14,2) NOT NULL DEFAULT 0,
  wages          NUMERIC(14,2) NOT NULL DEFAULT 0,
  advertising    NUMERIC(14,2) NOT NULL DEFAULT 0,
  rent           NUMERIC(14,2) NOT NULL DEFAULT 0,
  utilities      NUMERIC(14,2) NOT NULL DEFAULT 0,
  sga            NUMERIC(14,2) NOT NULL DEFAULT 0,
  zoho_synced_at TIMESTAMPTZ   NOT NULL DEFAULT now(),
  UNIQUE(date, source)
);

CREATE INDEX IF NOT EXISTS idx_hq_ebitda_daily_date ON hq_ebitda_daily(date);

ALTER TABLE hq_ebitda_daily ENABLE ROW LEVEL SECURITY;
CREATE POLICY "hq_ebitda_daily_service_all" ON hq_ebitda_daily
  FOR ALL    TO service_role  USING (true) WITH CHECK (true);
CREATE POLICY "hq_ebitda_daily_auth_read"   ON hq_ebitda_daily
  FOR SELECT TO authenticated USING (true);

-- ── Aesthetics + Slimming: per (date, department) ───────────────────────────

CREATE TABLE IF NOT EXISTS aesthetics_ebitda_daily (
  id             SERIAL PRIMARY KEY,
  date           DATE          NOT NULL,
  department     TEXT          NOT NULL,
  revenue        NUMERIC(14,2) NOT NULL DEFAULT 0,
  cogs           NUMERIC(14,2) NOT NULL DEFAULT 0,
  wages          NUMERIC(14,2) NOT NULL DEFAULT 0,
  advertising    NUMERIC(14,2) NOT NULL DEFAULT 0,
  rent           NUMERIC(14,2) NOT NULL DEFAULT 0,
  utilities      NUMERIC(14,2) NOT NULL DEFAULT 0,
  sga            NUMERIC(14,2) NOT NULL DEFAULT 0,
  zoho_synced_at TIMESTAMPTZ   NOT NULL DEFAULT now(),
  UNIQUE(date, department)
);

CREATE INDEX IF NOT EXISTS idx_aesth_ebitda_daily_date      ON aesthetics_ebitda_daily(date);
CREATE INDEX IF NOT EXISTS idx_aesth_ebitda_daily_dept_date ON aesthetics_ebitda_daily(department, date);

ALTER TABLE aesthetics_ebitda_daily ENABLE ROW LEVEL SECURITY;
CREATE POLICY "aesth_ebitda_daily_service_all" ON aesthetics_ebitda_daily
  FOR ALL    TO service_role  USING (true) WITH CHECK (true);
CREATE POLICY "aesth_ebitda_daily_auth_read"   ON aesthetics_ebitda_daily
  FOR SELECT TO authenticated USING (true);
