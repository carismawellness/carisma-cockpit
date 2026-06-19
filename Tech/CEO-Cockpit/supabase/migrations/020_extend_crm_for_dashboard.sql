-- Migration 020: Extend CRM schema for the CRM Master dashboard
-- Adds sales/messaging columns to crm_daily and crm_by_rep,
-- plus new tables for booking mix and lead reconciliation.

-- ============================================================
-- 1. Extend crm_daily with sales + messaging metrics
-- ============================================================
ALTER TABLE crm_daily ADD COLUMN IF NOT EXISTS total_sales NUMERIC(10,2);
ALTER TABLE crm_daily ADD COLUMN IF NOT EXISTS deposit_pct NUMERIC(5,2);
ALTER TABLE crm_daily ADD COLUMN IF NOT EXISTS avg_daily_sales NUMERIC(10,2);
ALTER TABLE crm_daily ADD COLUMN IF NOT EXISTS unreplied_crm INTEGER;
ALTER TABLE crm_daily ADD COLUMN IF NOT EXISTS unreplied_whatsapp INTEGER;
ALTER TABLE crm_daily ADD COLUMN IF NOT EXISTS unreplied_email INTEGER;
ALTER TABLE crm_daily ADD COLUMN IF NOT EXISTS unworked_leads INTEGER;

-- ============================================================
-- 2. Extend crm_by_rep with full KPI set
-- ============================================================
ALTER TABLE crm_by_rep ADD COLUMN IF NOT EXISTS total_sales NUMERIC(10,2);
ALTER TABLE crm_by_rep ADD COLUMN IF NOT EXISTS dials INTEGER;
ALTER TABLE crm_by_rep ADD COLUMN IF NOT EXISTS bookings INTEGER;
ALTER TABLE crm_by_rep ADD COLUMN IF NOT EXISTS deposit_pct NUMERIC(5,2);
ALTER TABLE crm_by_rep ADD COLUMN IF NOT EXISTS missed_pct NUMERIC(5,2);
ALTER TABLE crm_by_rep ADD COLUMN IF NOT EXISTS team_type TEXT CHECK (team_type IN ('sdr', 'chat'));
ALTER TABLE crm_by_rep ADD COLUMN IF NOT EXISTS conversations INTEGER;

-- ============================================================
-- 3. New table: booking mix by treatment type
-- ============================================================
CREATE TABLE IF NOT EXISTS crm_booking_mix (
  id SERIAL PRIMARY KEY,
  date DATE NOT NULL,
  brand_id INTEGER NOT NULL REFERENCES brands(id),
  treatment_name TEXT NOT NULL,
  count INTEGER NOT NULL DEFAULT 0,
  UNIQUE(date, brand_id, treatment_name)
);
CREATE INDEX IF NOT EXISTS idx_booking_mix ON crm_booking_mix(date, brand_id);

-- ============================================================
-- 4. New table: CRM vs Meta lead reconciliation
-- ============================================================
CREATE TABLE IF NOT EXISTS crm_lead_reconciliation (
  id SERIAL PRIMARY KEY,
  date DATE NOT NULL,
  brand_id INTEGER NOT NULL REFERENCES brands(id),
  leads_meta INTEGER NOT NULL DEFAULT 0,
  leads_crm INTEGER NOT NULL DEFAULT 0,
  delta INTEGER GENERATED ALWAYS AS (leads_meta - leads_crm) STORED,
  UNIQUE(date, brand_id)
);
CREATE INDEX IF NOT EXISTS idx_lead_recon ON crm_lead_reconciliation(date, brand_id);
