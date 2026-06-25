-- 090_employee_location_splits_daily.sql
-- Per-employee per-DAY location wage attribution derived from Talexio roster
-- (work shift costCentre, org-unit fallback) and payslip gross (with extrapolation).
-- One row per working shift (or per calendar day for non-rostered staff).
-- Enables wage attribution for ANY date range by summing wage_share.
CREATE TABLE IF NOT EXISTS employee_location_splits_daily (
  id                     SERIAL PRIMARY KEY,
  work_date              DATE          NOT NULL,
  talexio_id             INTEGER       NOT NULL,
  employee_name          TEXT          NOT NULL,
  location_slug          TEXT          NOT NULL,          -- canonical slug
  location_source        TEXT          NOT NULL,          -- 'cost_centre' | 'org_unit_fallback' | 'no_roster'
  cost_centre_id         TEXT,
  cost_centre_name       TEXT,
  shift_id               TEXT          NOT NULL,          -- Talexio workShift id; 'synthetic-YYYY-MM-DD' for no_roster
  shift_type             TEXT,                            -- SHIFT | FLEXIBLE_SHIFT | NO_ROSTER
  home_location_slug     TEXT,
  monthly_gross          NUMERIC(10,2) NOT NULL DEFAULT 0,
  wage_source            TEXT          NOT NULL DEFAULT 'payslip',  -- 'payslip' | 'extrapolated'
  extrapolated_from      DATE,
  working_units_in_month INTEGER       NOT NULL DEFAULT 0, -- denominator: working shifts in month (or days_in_month for no_roster)
  wage_share             NUMERIC(12,4) NOT NULL DEFAULT 0, -- monthly_gross / working_units_in_month
  computed_at            TIMESTAMPTZ   DEFAULT NOW(),
  UNIQUE(talexio_id, work_date, location_slug, shift_id)
);
CREATE INDEX IF NOT EXISTS idx_elsd_work_date ON employee_location_splits_daily(work_date);
CREATE INDEX IF NOT EXISTS idx_elsd_talexio  ON employee_location_splits_daily(talexio_id);
CREATE INDEX IF NOT EXISTS idx_elsd_location ON employee_location_splits_daily(location_slug);
COMMENT ON TABLE employee_location_splits_daily IS
  'Per-day location wage attribution from Talexio roster (costCentre / org-unit fallback) x payslip gross (extrapolated when missing). Sum wage_share over a date range to attribute payroll to locations for any period.';
