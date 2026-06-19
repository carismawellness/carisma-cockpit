-- SUPERSEDED by 072_operations_live.sql — do not apply.
CREATE TABLE IF NOT EXISTS diligence_audit (
  id SERIAL PRIMARY KEY,
  date DATE NOT NULL,
  location_id INTEGER NOT NULL,
  brand_id INTEGER NOT NULL,
  total_transactions INTEGER,
  deleted_count INTEGER DEFAULT 0,
  cancelled_count INTEGER DEFAULT 0,
  complementary_count INTEGER DEFAULT 0,
  cash_count INTEGER DEFAULT 0,
  discounted_cash_count INTEGER DEFAULT 0,
  unattended_count INTEGER DEFAULT 0,
  UNIQUE(date, location_id)
);
