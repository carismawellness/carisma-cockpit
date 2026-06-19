-- Add department dimension to aesthetics_ebitda_monthly.
-- Each month now has two rows: one for 'aesthetics' and one for 'slimming'.
-- Both departments share the same Zoho Books org (Carisma Aesthetics);
-- costs are split by label → sales ratio / salary ratio / equal / custom.

-- Drop the single-month unique constraint added in migration 033
ALTER TABLE aesthetics_ebitda_monthly
  DROP CONSTRAINT IF EXISTS aesthetics_ebitda_monthly_month_key;

-- Add department column (default backfills existing rows as 'aesthetics')
ALTER TABLE aesthetics_ebitda_monthly
  ADD COLUMN IF NOT EXISTS department TEXT NOT NULL DEFAULT 'aesthetics';

-- Restore uniqueness on (month, department)
ALTER TABLE aesthetics_ebitda_monthly
  ADD CONSTRAINT aesthetics_ebitda_monthly_month_dept_key UNIQUE (month, department);

-- Index for dashboard queries filtered by department
CREATE INDEX IF NOT EXISTS idx_aesth_ebitda_dept_month
  ON aesthetics_ebitda_monthly (department, month);
