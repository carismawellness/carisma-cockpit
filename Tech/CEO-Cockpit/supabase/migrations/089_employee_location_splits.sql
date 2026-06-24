-- 089_employee_location_splits.sql
-- Per-employee per-month location split percentages derived from Talexio
-- work shifts (org unit) and time logs (GPS). Used for accurate HC%
-- attribution in HR dashboard instead of static Zoho P&L account mapping.

CREATE TABLE IF NOT EXISTS employee_location_splits_monthly (
  id                 SERIAL PRIMARY KEY,
  month              DATE         NOT NULL,          -- first day of month: YYYY-MM-01
  talexio_id         INTEGER      NOT NULL,
  employee_name      TEXT         NOT NULL,
  home_location      TEXT         NOT NULL,          -- raw organisationUnit.name from Talexio
  home_location_slug TEXT         NOT NULL,          -- canonical slug: 'hugos','inter','hyatt' etc.
  gross_wage         NUMERIC(10,2) DEFAULT 0,        -- from Talexio payslip for this month (0 if not yet run)
  total_events       INTEGER      NOT NULL DEFAULT 0,-- GPS-confirmed clock-ins counted
  location_splits    JSONB        NOT NULL DEFAULT '{}',  -- {"hugos":0.70,"hyatt":0.30}
  wage_attribution   JSONB        NOT NULL DEFAULT '{}',  -- {"hugos":2100.00,"hyatt":900.00}
  shift_breakdown    JSONB,                          -- raw GPS event counts {"hugos":14,"hyatt":6}
  attribution_source TEXT         DEFAULT 'org_unit_static', -- 'gps_timelogs'|'org_unit_static'|'no_position'
  computed_at        TIMESTAMPTZ  DEFAULT NOW(),
  UNIQUE(month, talexio_id)
);

CREATE INDEX IF NOT EXISTS idx_eloc_splits_month    ON employee_location_splits_monthly(month);
CREATE INDEX IF NOT EXISTS idx_eloc_splits_employee ON employee_location_splits_monthly(talexio_id);
CREATE INDEX IF NOT EXISTS idx_eloc_splits_home     ON employee_location_splits_monthly(home_location_slug);

COMMENT ON TABLE employee_location_splits_monthly IS
  'Per-employee per-month location split % from Talexio org-unit assignment '
  'refined by GPS clock-in data. Multiplied by gross payslip wage to '
  'attribute payroll to locations for HR HC% calculation.';

COMMENT ON COLUMN employee_location_splits_monthly.attribution_source IS
  'gps_timelogs: GPS data detected cross-location work, splits reflect actual GPS clock-ins. '
  'org_unit_static: 100% attributed to home org unit (no cross-location GPS detected). '
  'no_position: employee has no active org unit, attributed to HQ by default.';
