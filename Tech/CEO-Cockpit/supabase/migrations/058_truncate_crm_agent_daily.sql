-- Migration 058: Clear stale crm_agent_daily rows
--
-- Root cause: the ETL parseDate function was treating the CRM sheet's
-- M/D/YYYY dates (US format) as D/M/YYYY, producing invalid dates like
-- "2026-14-04" (rejected by Supabase) or swapped dates like "2026-01-06"
-- for June 1 entries. All existing rows are therefore on wrong dates.
--
-- Fix: parseDate now correctly reads M/D/YYYY. This migration wipes the table
-- so a fresh ETL sync (POST /api/etl/crm-agents) populates clean data.

TRUNCATE TABLE crm_agent_daily;
