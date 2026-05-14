-- Per-employee additional salary not captured in Zoho Books.
-- Sourced monthly from Google Sheets, reviewed and frozen in the Cockpit UI.
-- Added on top of Zoho-sourced wages in the SPA EBITDA calculation.

CREATE TABLE salary_supplement_monthly (
  id             SERIAL PRIMARY KEY,
  month          DATE    NOT NULL,
  employee_name  TEXT    NOT NULL,
  talexio_id     INTEGER,
  amount         NUMERIC(10,2) NOT NULL DEFAULT 0,
  spa_slug       TEXT,           -- null = unassigned, needs manual review
  is_frozen      BOOLEAN NOT NULL DEFAULT false,
  synced_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(month, employee_name)
);

CREATE INDEX idx_salary_supp_month     ON salary_supplement_monthly(month);
CREATE INDEX idx_salary_supp_spa_month ON salary_supplement_monthly(spa_slug, month);

-- Anon key can read; service role handles writes
ALTER TABLE salary_supplement_monthly ENABLE ROW LEVEL SECURITY;
CREATE POLICY "salary_supp_read"  ON salary_supplement_monthly FOR SELECT USING (true);
CREATE POLICY "salary_supp_write" ON salary_supplement_monthly FOR ALL USING (true) WITH CHECK (true);
