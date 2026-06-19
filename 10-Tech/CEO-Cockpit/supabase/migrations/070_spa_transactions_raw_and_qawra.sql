-- ──────────────────────────────────────────────────────────────────────────────
-- 070_spa_transactions_raw_and_qawra.sql
--
-- One-off backfill scaffolding for the legacy "Sales MASTER" sheet
-- (1jOdDzPFWqVL-kRPA2TjBSqK6Fj5A6KCQZShlXwESh6I, gid 1229497505).
-- Covers 2014-10-10 → 2023-08-27 (167,168 per-transaction rows) — the period
-- before the live Cockpit Datasheet existed.
--
-- Three things land here:
--   1. spa_transactions_raw   — loss-less per-row landing table
--   2. data_source columns    — added to the three existing spa revenue tables
--                                so we can tell "where did this row come from?"
--   3. QAWRA closed location  — historic Sales Point seen 2015-2019
--
-- The companion script Tools/spa-historical-backfill.ts parses the sheet,
-- upserts into spa_transactions_raw, then re-aggregates into the existing
-- spa_revenue_daily / spa_revenue_monthly / spa_services_by_employee_daily
-- tables tagged with data_source='historic_sheet'.
--
-- PII NOTE: contact_email / first_name / surname are loaded as-is from the
-- source sheet (which is already shared internally). If GDPR review later
-- requires it, a follow-up migration can hash email and drop surname.
-- ──────────────────────────────────────────────────────────────────────────────

-- 1. Raw landing table ────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS spa_transactions_raw (
    id                  BIGSERIAL PRIMARY KEY,
    sheet_row_id        INTEGER       NOT NULL,            -- 1-based row # in source sheet
    zoho_id             TEXT,                              -- e.g. "238,495" — not unique
    service_date        DATE,                              -- NULL if blank in source
    service_time        TIME,                              -- NULL ok
    service_upper_group TEXT,
    package_name        TEXT,
    service_group       TEXT,
    service_name        TEXT,
    first_name          TEXT,
    surname             TEXT,
    contact_email       TEXT,
    payment_type        TEXT,
    room                TEXT,
    duration_min        INTEGER,
    list_price_gross    NUMERIC(12,2),                     -- after € strip
    discount_pct        NUMERIC(8,2),                      -- can be negative
    net_revenue_gross   NUMERIC(12,2) NOT NULL,            -- after € strip; VAT-incl
    revenue_ex_vat      NUMERIC(12,2) NOT NULL,            -- net_revenue_gross / 1.18
    lead_type           TEXT,
    location_id         INTEGER REFERENCES locations(id),  -- NULL if Sales Point unmapped
    sales_point_raw     TEXT          NOT NULL,            -- 'INTER', 'QAWRA', etc.
    therapist_raw       TEXT,                              -- verbatim from sheet
    therapist_canonical TEXT,                              -- post-alias lookup; NULL if no map
    guest_group         TEXT,                              -- 'HOTEL GUEST' / 'NON-HOTEL GUEST'
    sold_by             TEXT,
    cost_amount         NUMERIC(12,2),                     -- often blank
    profit              NUMERIC(12,2),                     -- often blank
    day_of_week         TEXT,
    service_type        TEXT,                              -- 'Service' | 'Retail' | 'Spa Facilities' | 'Add Ons' | 'Spa Club'
    discount_value      NUMERIC(12,2),
    revenue_bucket      TEXT          NOT NULL,            -- 'services' | 'product_phytomer' | 'product_purest' | 'product_other'
    sheet_synced_at     TIMESTAMPTZ   NOT NULL DEFAULT now(),
    UNIQUE (sheet_row_id)
);

CREATE INDEX IF NOT EXISTS spa_tx_raw_date_idx       ON spa_transactions_raw (service_date);
CREATE INDEX IF NOT EXISTS spa_tx_raw_loc_date_idx   ON spa_transactions_raw (location_id, service_date);
CREATE INDEX IF NOT EXISTS spa_tx_raw_therapist_idx  ON spa_transactions_raw (therapist_canonical);
CREATE INDEX IF NOT EXISTS spa_tx_raw_bucket_idx     ON spa_transactions_raw (revenue_bucket);

COMMENT ON TABLE spa_transactions_raw IS
  'Per-transaction landing table for 2014-2023 spa historical backfill. Live data (2025+) is aggregated only via lib/etl/spa-revenue.ts — this raw table covers the period before the Cockpit Datasheet existed. Loaded by Tools/spa-historical-backfill.ts (one-off, idempotent on sheet_row_id).';

-- 2. data_source provenance on existing revenue tables ────────────────────────

ALTER TABLE spa_revenue_daily
    ADD COLUMN IF NOT EXISTS data_source TEXT NOT NULL DEFAULT 'cockpit_live';
ALTER TABLE spa_revenue_monthly
    ADD COLUMN IF NOT EXISTS data_source TEXT NOT NULL DEFAULT 'cockpit_live';
ALTER TABLE spa_services_by_employee_daily
    ADD COLUMN IF NOT EXISTS data_source TEXT NOT NULL DEFAULT 'cockpit_live';

COMMENT ON COLUMN spa_revenue_daily.data_source IS
  '''cockpit_live'' for rows produced by the nightly Cockpit Datasheet ETL (lib/etl/spa-revenue.ts). ''historic_sheet'' for the 2014-2023 backfill from Tools/spa-historical-backfill.ts.';

-- 3. Closed-branch seeds ──────────────────────────────────────────────────────
--
-- Both QAWRA and SEASHELLS show up in 2015-2019 historic rows but are not in
-- the current location map. QAWRA confirmed by user (2026-06-10) as a closed
-- branch (not a rename). SEASHELLS surfaced during dry-run — 13,977 rows
-- 2015-2020, fits the same pattern (closed Maltese resort spa point).
-- is_active=false so they won't appear in current-period dashboards or
-- location selectors.

INSERT INTO locations (brand_id, slug, name, is_active)
SELECT id, 'qawra', 'Carisma Spa — Qawra (closed)', false
FROM   brands WHERE slug = 'spa'
ON CONFLICT (slug) DO NOTHING;

INSERT INTO locations (brand_id, slug, name, is_active)
SELECT id, 'seashells', 'Carisma Spa — Seashells (closed)', false
FROM   brands WHERE slug = 'spa'
ON CONFLICT (slug) DO NOTHING;
