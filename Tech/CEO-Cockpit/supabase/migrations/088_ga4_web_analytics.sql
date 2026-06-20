-- Migration 088: Extend ga4_daily with new web analytics columns
-- Adds Malta geo-traffic, conversion rate, and Spa ecommerce funnel columns.

ALTER TABLE ga4_daily
  ADD COLUMN IF NOT EXISTS malta_sessions INTEGER,
  ADD COLUMN IF NOT EXISTS conversion_rate_pct NUMERIC(5,2),
  ADD COLUMN IF NOT EXISTS view_item_count INTEGER,
  ADD COLUMN IF NOT EXISTS add_to_cart_count INTEGER,
  ADD COLUMN IF NOT EXISTS begin_checkout_count INTEGER,
  ADD COLUMN IF NOT EXISTS purchase_count INTEGER;

COMMENT ON COLUMN ga4_daily.malta_sessions IS 'Sessions from country=MT (Malta)';
COMMENT ON COLUMN ga4_daily.conversion_rate_pct IS 'Conversion rate: conversions/sessions * 100';
COMMENT ON COLUMN ga4_daily.view_item_count IS 'GA4 view_item events (spa ecommerce only)';
COMMENT ON COLUMN ga4_daily.add_to_cart_count IS 'GA4 add_to_cart events (spa ecommerce only)';
COMMENT ON COLUMN ga4_daily.begin_checkout_count IS 'GA4 begin_checkout events (spa ecommerce only)';
COMMENT ON COLUMN ga4_daily.purchase_count IS 'GA4 purchase events (spa ecommerce only)';
