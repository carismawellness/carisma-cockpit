-- Migration 078: Therapist shift hours per month per location
--
-- Populated by /api/etl/therapist-shifts-monthly.
-- Stores total SCHEDULED hours for therapist-role employees only,
-- giving RevPAH an accurate denominator that excludes receptionists,
-- managers, and other non-revenue-generating staff.
--
-- Paste into Supabase SQL editor to apply.

CREATE TABLE IF NOT EXISTS hr_therapist_shifts_monthly (
  id                    BIGSERIAL PRIMARY KEY,
  month                 DATE        NOT NULL,          -- YYYY-MM-01
  location_name         TEXT        NOT NULL,
  brand_name            TEXT        NOT NULL,
  therapist_count       INTEGER     NOT NULL DEFAULT 0,
  total_scheduled_hours DECIMAL(10,2) NOT NULL DEFAULT 0,
  therapist_names       TEXT[]      NOT NULL DEFAULT '{}',
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT hr_therapist_shifts_monthly_month_loc_uq UNIQUE (month, location_name)
);

ALTER TABLE hr_therapist_shifts_monthly ENABLE ROW LEVEL SECURITY;

CREATE POLICY "service_role_all_therapist_shifts"
  ON hr_therapist_shifts_monthly
  FOR ALL
  USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role');

COMMENT ON TABLE hr_therapist_shifts_monthly IS
  'Monthly aggregated scheduled hours for therapist-only staff per location. '
  'Used as the denominator in RevPAH (Revenue per Available Hour). '
  'Populated nightly via /api/etl/therapist-shifts-monthly.';
