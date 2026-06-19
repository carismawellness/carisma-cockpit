-- Salary Master ETL target table
-- Stores monthly salary totals by location + headcount/salary aggregates
CREATE TABLE IF NOT EXISTS salary_monthly (
  id BIGSERIAL PRIMARY KEY,
  month DATE NOT NULL,
  metric TEXT NOT NULL,
  location TEXT NOT NULL,
  value NUMERIC,
  tab TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(month, metric, location, tab)
);

-- Enable RLS (with service_role bypass for ETL)
ALTER TABLE salary_monthly ENABLE ROW LEVEL SECURITY;

-- Allow authenticated reads
CREATE POLICY "Allow authenticated read" ON salary_monthly
  FOR SELECT TO authenticated USING (true);

-- Allow service_role full access (for Apps Script ETL upserts)
CREATE POLICY "Allow service_role all" ON salary_monthly
  FOR ALL TO service_role USING (true) WITH CHECK (true);
