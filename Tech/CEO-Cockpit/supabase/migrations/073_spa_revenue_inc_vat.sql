-- 073_spa_revenue_inc_vat.sql
--
-- Convert spa_revenue_daily + spa_revenue_monthly from ex-VAT to inc-VAT.
--
-- Background:
--   The Cockpit ETL previously stored Spa amounts ex-VAT (divided unit prices
--   by 1.18 / used the "VAT Exclusive Amount" sheet column directly). Sales
--   surfaces were patched to multiply by 1.18 at read time to display gross,
--   but the schema itself was still ex-VAT — confusing and easy to misuse.
--
--   This migration flips the source of truth: services + product_* columns
--   now hold INC-VAT (gross). The ETL is updated in the same release to stop
--   the ÷1.18 step. EBITDA readers add an explicit ÷1.18 (Malta 18% standard
--   rate) at the read site to get ex-VAT. HR keeps its current ex-VAT view by
--   also dividing at read time — flip to gross later if you want HR consistency.
--
-- Safety:
--   Run ONCE. Re-running would multiply by 1.18 again and double-count VAT.
--   Tracked by inserting a sentinel into supabase_migrations (handled by
--   the migration runner).
--
-- Rollback:
--   If you need to revert, divide by 1.18:
--     UPDATE spa_revenue_daily   SET services = services / 1.18, ... ;
--     UPDATE spa_revenue_monthly SET services = services / 1.18, ... ;

BEGIN;

-- Daily table
UPDATE spa_revenue_daily SET
  services         = ROUND((services         * 1.18)::numeric, 2),
  product_phytomer = ROUND((product_phytomer * 1.18)::numeric, 2),
  product_purest   = ROUND((product_purest   * 1.18)::numeric, 2),
  product_other    = ROUND((product_other    * 1.18)::numeric, 2);

-- Monthly aggregate
-- Note: wholesale, sales_discount, sales_refund are Zoho-sourced ex-VAT figures
-- and stay untouched. Those are EBITDA-only and don't appear on sales surfaces.
UPDATE spa_revenue_monthly SET
  services         = ROUND((services         * 1.18)::numeric, 2),
  product_phytomer = ROUND((product_phytomer * 1.18)::numeric, 2),
  product_purest   = ROUND((product_purest   * 1.18)::numeric, 2),
  product_other    = ROUND((product_other    * 1.18)::numeric, 2);

COMMENT ON COLUMN spa_revenue_daily.services         IS 'Inc-VAT (gross). Divide by 1.18 for ex-VAT (EBITDA).';
COMMENT ON COLUMN spa_revenue_daily.product_phytomer IS 'Inc-VAT (gross). Divide by 1.18 for ex-VAT (EBITDA).';
COMMENT ON COLUMN spa_revenue_daily.product_purest   IS 'Inc-VAT (gross). Divide by 1.18 for ex-VAT (EBITDA).';
COMMENT ON COLUMN spa_revenue_daily.product_other    IS 'Inc-VAT (gross). Divide by 1.18 for ex-VAT (EBITDA).';

COMMENT ON COLUMN spa_revenue_monthly.services         IS 'Inc-VAT (gross). Divide by 1.18 for ex-VAT (EBITDA).';
COMMENT ON COLUMN spa_revenue_monthly.product_phytomer IS 'Inc-VAT (gross). Divide by 1.18 for ex-VAT (EBITDA).';
COMMENT ON COLUMN spa_revenue_monthly.product_purest   IS 'Inc-VAT (gross). Divide by 1.18 for ex-VAT (EBITDA).';
COMMENT ON COLUMN spa_revenue_monthly.product_other    IS 'Inc-VAT (gross). Divide by 1.18 for ex-VAT (EBITDA).';

COMMIT;
