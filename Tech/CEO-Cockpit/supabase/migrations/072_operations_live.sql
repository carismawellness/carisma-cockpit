-- Migration 072: Live operations dashboard tables.
-- Supersedes unapplied 021_create_google_reviews.sql and 022_create_diligence_audit.sql.
--
-- google_reviews: daily snapshot of Google review count + rating per location.
-- diligence_audit: monthly per-location figures from the Accounting Master
--   "Diligence audit" tab. Values are EUR amounts (inc VAT) except
--   unattended_count. The source report combines deleted + cancelled, so we
--   store one combined column; percentages are derived in the UI.

CREATE TABLE IF NOT EXISTS google_reviews (
  id SERIAL PRIMARY KEY,
  date DATE NOT NULL,
  location_id INTEGER NOT NULL REFERENCES locations(id),
  brand_id INTEGER NOT NULL REFERENCES brands(id),
  total_reviews INTEGER,
  avg_rating NUMERIC(3,2),
  new_reviews_count INTEGER DEFAULT 0,
  five_star INTEGER DEFAULT 0,
  four_star INTEGER DEFAULT 0,
  three_star INTEGER DEFAULT 0,
  two_star INTEGER DEFAULT 0,
  one_star INTEGER DEFAULT 0,
  source TEXT DEFAULT 'places_api',
  UNIQUE(date, location_id)
);

CREATE INDEX IF NOT EXISTS idx_google_reviews_date ON google_reviews(date);
CREATE INDEX IF NOT EXISTS idx_google_reviews_location ON google_reviews(location_id);

CREATE TABLE IF NOT EXISTS diligence_audit (
  id SERIAL PRIMARY KEY,
  month DATE NOT NULL,                -- first of month
  location_id INTEGER NOT NULL REFERENCES locations(id),
  brand_id INTEGER NOT NULL REFERENCES brands(id),
  total_sales NUMERIC(12,2),          -- inc VAT
  deleted_cancelled NUMERIC(12,2),
  complimentary NUMERIC(12,2),
  cash_sales NUMERIC(12,2),
  discounted_cash NUMERIC(12,2),
  unattended_count INTEGER,
  UNIQUE(month, location_id)
);

CREATE INDEX IF NOT EXISTS idx_diligence_audit_month ON diligence_audit(month);

-- RLS: same pattern as 062 — authenticated reads, service_role writes (bypasses RLS).
ALTER TABLE google_reviews  ENABLE ROW LEVEL SECURITY;
ALTER TABLE diligence_audit ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "authenticated read" ON google_reviews;
CREATE POLICY "authenticated read" ON google_reviews  FOR SELECT TO authenticated USING (true);
DROP POLICY IF EXISTS "authenticated read" ON diligence_audit;
CREATE POLICY "authenticated read" ON diligence_audit FOR SELECT TO authenticated USING (true);
