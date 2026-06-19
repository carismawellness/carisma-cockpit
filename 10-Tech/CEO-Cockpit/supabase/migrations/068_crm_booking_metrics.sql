-- Add booking efficiency and booking rate columns to crm_agent_daily.
-- SDR agents populate these from sheet columns G/H (inserted 2026-06-10).
-- Chat agents default to 0 (no outbound dials).

ALTER TABLE crm_agent_daily
  ADD COLUMN IF NOT EXISTS booking_eff_pct  NUMERIC(5,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS booking_rate_pct NUMERIC(5,2) NOT NULL DEFAULT 0;
