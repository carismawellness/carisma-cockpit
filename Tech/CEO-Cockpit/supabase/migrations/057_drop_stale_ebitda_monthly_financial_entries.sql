-- Drop stale monthly EBITDA aggregation tables.
-- These were written by old ETL routes (zoho-spa, zoho-aesthetics, zoho-hq)
-- that are no longer called by the nightly cron. The reconciliation checks
-- (ebitda-check-spa, ebitda-check-aesthetics) now aggregate from the daily
-- tables (spa_ebitda_daily, aesthetics_ebitda_daily) which ARE kept current.
--
-- financial_entries was written by the zoho-transactions-daily route but
-- never read by any active page or hook.

DROP TABLE IF EXISTS spa_ebitda_monthly;
DROP TABLE IF EXISTS aesthetics_ebitda_monthly;
DROP TABLE IF EXISTS hq_ebitda_monthly;
DROP TABLE IF EXISTS financial_entries;
