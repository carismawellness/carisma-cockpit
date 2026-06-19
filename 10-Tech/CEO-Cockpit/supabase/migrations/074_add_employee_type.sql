-- Add employee_type to sales_employees for categorised dashboard views.
--
-- 'therapist'  — performs treatments; sees service + retail commission
-- 'advisor'    — reception / concierge; retail commission only (service_rate=0)
-- 'management' — manager / CRM / HQ; management overview view
--
-- Default 'therapist' so existing seeded rows remain valid.
-- apply-staff-master-rates.ts updates each matched employee to the correct type.

ALTER TABLE sales_employees
  ADD COLUMN IF NOT EXISTS employee_type TEXT NOT NULL DEFAULT 'therapist'
    CHECK (employee_type IN ('therapist', 'advisor', 'management'));

CREATE INDEX IF NOT EXISTS idx_sales_employees_type
  ON sales_employees(brand_slug, employee_type);
