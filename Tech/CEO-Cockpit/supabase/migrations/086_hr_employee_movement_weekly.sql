-- Migration 086: Weekly employee movement snapshots
-- Populated by POST /api/etl/employee-movement-weekly
-- Each row = one ISO week. Joiners/leavers derived from Talexio hire/termination dates.

CREATE TABLE IF NOT EXISTS hr_employee_movement_weekly (
  week_start      DATE        PRIMARY KEY,
  week_end        DATE        NOT NULL,
  joiners         INTEGER     NOT NULL DEFAULT 0,
  leavers         INTEGER     NOT NULL DEFAULT 0,
  net             INTEGER     NOT NULL DEFAULT 0,
  total_headcount INTEGER     NOT NULL DEFAULT 0,
  joiner_names    JSONB       NOT NULL DEFAULT '[]',
  leaver_names    JSONB       NOT NULL DEFAULT '[]',
  date_source     TEXT        NOT NULL DEFAULT 'unknown',
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_hr_emp_movement_weekly_start
  ON hr_employee_movement_weekly (week_start DESC);
