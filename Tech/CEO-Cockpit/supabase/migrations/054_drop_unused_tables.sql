-- Migration 054: Drop unused tables
--
-- These tables have zero active .from() queries in the codebase.
-- Verified June 2026 by cross-referencing all migrations against
-- all TypeScript Supabase client calls in app/ and lib/.
--
-- Kept: transactions_raw, spa/aesthetics/hq_ebitda_monthly (legacy ETL still writes),
--       and all tables actively queried by the current application.

DROP TABLE IF EXISTS ad_creatives CASCADE;
DROP TABLE IF EXISTS annotations CASCADE;
DROP TABLE IF EXISTS appointments CASCADE;
DROP TABLE IF EXISTS audit_log CASCADE;
DROP TABLE IF EXISTS budget_vs_actual CASCADE;
DROP TABLE IF EXISTS consult_funnel CASCADE;
DROP TABLE IF EXISTS crm_booking_mix CASCADE;
DROP TABLE IF EXISTS crm_by_rep CASCADE;
DROP TABLE IF EXISTS crm_lead_reconciliation CASCADE;
DROP TABLE IF EXISTS customers CASCADE;
DROP TABLE IF EXISTS diligence_audit CASCADE;
DROP TABLE IF EXISTS ebitda_monthly CASCADE;
DROP TABLE IF EXISTS escalation_log CASCADE;
DROP TABLE IF EXISTS ga4_daily CASCADE;
DROP TABLE IF EXISTS google_reviews CASCADE;
DROP TABLE IF EXISTS growth_weekly CASCADE;
DROP TABLE IF EXISTS gsc_daily CASCADE;
DROP TABLE IF EXISTS klaviyo_campaigns CASCADE;
DROP TABLE IF EXISTS message_queue CASCADE;
DROP TABLE IF EXISTS operations_weekly CASCADE;
DROP TABLE IF EXISTS salary_monthly CASCADE;
DROP TABLE IF EXISTS sales_by_rep CASCADE;
DROP TABLE IF EXISTS speed_to_lead_distribution CASCADE;
DROP TABLE IF EXISTS staff CASCADE;
DROP TABLE IF EXISTS therapist_utilization CASCADE;
DROP TABLE IF EXISTS we360_daily CASCADE;

-- Drop the alert_severity and alert_status ENUMs only if no tables reference them
-- (ci_alerts uses these, so leave them)
