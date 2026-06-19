-- Migration 084: Add booking_rate and spa_total_rate to commission rates
-- Paste this into the Supabase SQL editor (Dashboard → SQL Editor → New query).
--
-- Column sources (salary master sheet "Staff master" tab):
--   booking_rate    → column V (Rebook commission %)    e.g. 0.0300 = 3%
--   spa_total_rate  → column S (Spa total commission %) e.g. 0.0150 = 1.5%
--                     (management employees only — % of total spa revenue)

ALTER TABLE sales_employee_commission_rates
  ADD COLUMN IF NOT EXISTS booking_rate   NUMERIC(6,4) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS spa_total_rate NUMERIC(6,4) NOT NULL DEFAULT 0;

COMMENT ON COLUMN sales_employee_commission_rates.booking_rate IS
  'Rebooking commission rate (salary sheet col V). 0.03 = 3%. Engine does not yet compute booking commission — stored for future use.';

COMMENT ON COLUMN sales_employee_commission_rates.spa_total_rate IS
  'Spa-total commission rate for management employees (salary sheet col S). 0.015 = 1.5%. Applied to total spa revenue, not personal service revenue.';
