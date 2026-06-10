-- HR snapshot ETL target: nightly pull from Talexio
-- Stores headcount + payroll aggregates by location and brand
CREATE TABLE IF NOT EXISTS hr_talexio_daily_snapshot (
  id BIGSERIAL PRIMARY KEY,
  snapshot_date DATE NOT NULL,
  location_name TEXT NOT NULL,
  brand_name TEXT NOT NULL CHECK (brand_name IN ('Spa', 'Aesthetics', 'Slimming', 'HQ')),
  active_headcount INTEGER NOT NULL DEFAULT 0,
  gross_payroll NUMERIC(12,2),
  net_payroll NUMERIC(12,2),
  tax_total NUMERIC(12,2),
  payroll_period_from DATE,
  payroll_period_to DATE,
  synced_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(snapshot_date, location_name, brand_name)
);

-- Monthly headcount snapshots for turnover tracking
CREATE TABLE IF NOT EXISTS hr_headcount_monthly (
  id BIGSERIAL PRIMARY KEY,
  month DATE NOT NULL,  -- always YYYY-MM-01
  location_name TEXT NOT NULL,
  brand_name TEXT NOT NULL,
  active_employees INTEGER NOT NULL DEFAULT 0,
  terminated_employees INTEGER NOT NULL DEFAULT 0,
  new_joiners INTEGER NOT NULL DEFAULT 0,
  leavers INTEGER NOT NULL DEFAULT 0,
  turnover_rate NUMERIC(5,2),
  synced_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(month, location_name, brand_name)
);

-- Today's shift schedule (nightly import from Talexio)
CREATE TABLE IF NOT EXISTS hr_shifts_daily (
  id BIGSERIAL PRIMARY KEY,
  shift_date DATE NOT NULL,
  employee_name TEXT NOT NULL,
  employee_talexio_id TEXT NOT NULL,
  scheduled_start TIME NOT NULL,
  scheduled_end TIME,
  shift_label TEXT,
  shift_type TEXT,
  location_name TEXT,
  synced_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(shift_date, employee_talexio_id, scheduled_start)
);

ALTER TABLE hr_talexio_daily_snapshot ENABLE ROW LEVEL SECURITY;
ALTER TABLE hr_headcount_monthly ENABLE ROW LEVEL SECURITY;
ALTER TABLE hr_shifts_daily ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Allow authenticated read" ON hr_talexio_daily_snapshot FOR SELECT TO authenticated USING (true);
CREATE POLICY "Allow service_role all" ON hr_talexio_daily_snapshot FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY "Allow authenticated read" ON hr_headcount_monthly FOR SELECT TO authenticated USING (true);
CREATE POLICY "Allow service_role all" ON hr_headcount_monthly FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY "Allow authenticated read" ON hr_shifts_daily FOR SELECT TO authenticated USING (true);
CREATE POLICY "Allow service_role all" ON hr_shifts_daily FOR ALL TO service_role USING (true) WITH CHECK (true);

CREATE INDEX IF NOT EXISTS hr_shifts_date_idx ON hr_shifts_daily(shift_date);
CREATE INDEX IF NOT EXISTS hr_snapshot_date_idx ON hr_talexio_daily_snapshot(snapshot_date);
CREATE INDEX IF NOT EXISTS hr_headcount_month_idx ON hr_headcount_monthly(month);
