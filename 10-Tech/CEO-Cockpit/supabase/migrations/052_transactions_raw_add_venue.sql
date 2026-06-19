-- Migration 052: add venue column to transactions_raw
-- Stores the Zoho reporting tag slug (e.g. "inter", "hugos", "hq") so
-- contact-level and transaction-level drill-downs can be filtered by venue.
-- null = transaction distributed across venues by split rule (sales_ratio etc.)

ALTER TABLE transactions_raw
  ADD COLUMN IF NOT EXISTS venue TEXT;

CREATE INDEX IF NOT EXISTS idx_transactions_raw_venue ON transactions_raw (venue);

COMMENT ON COLUMN transactions_raw.venue IS
  'Zoho reporting tag resolved to venue slug. null = split/ratio cost, no single venue.';
