-- Add opened_date to locations for SSG calculation
ALTER TABLE locations ADD COLUMN IF NOT EXISTS opened_date DATE;

-- Update known opening dates (these are approximate — real dates to be set via admin)
UPDATE locations SET opened_date = '2018-01-01' WHERE slug = 'inter';
UPDATE locations SET opened_date = '2019-06-01' WHERE slug = 'hugos';
UPDATE locations SET opened_date = '2020-03-01' WHERE slug = 'hyatt';
UPDATE locations SET opened_date = '2021-01-01' WHERE slug = 'ramla';
UPDATE locations SET opened_date = '2022-06-01' WHERE slug = 'labranda';
UPDATE locations SET opened_date = '2023-01-01' WHERE slug = 'odycy';
UPDATE locations SET opened_date = '2023-06-01' WHERE slug = 'novotel';
UPDATE locations SET opened_date = '2024-01-01' WHERE slug = 'excelsior';

-- Marketing growth KPIs per brand per week (from Weekly KPI Sheet Growth tab)
CREATE TABLE IF NOT EXISTS growth_weekly (
  id SERIAL PRIMARY KEY,
  week_start DATE NOT NULL,
  brand_id INTEGER NOT NULL REFERENCES brands(id),
  website_sales NUMERIC(12,2) DEFAULT 0,
  aided_sales NUMERIC(12,2) DEFAULT 0,
  non_aided_sales NUMERIC(12,2) DEFAULT 0,
  direct_sales NUMERIC(12,2) DEFAULT 0,
  prev_year_sales NUMERIC(12,2) DEFAULT 0,
  yoy_growth_pct NUMERIC(8,2) DEFAULT 0,
  aov NUMERIC(8,2) DEFAULT 0,
  marketing_spend_google NUMERIC(10,2) DEFAULT 0,
  marketing_spend_meta NUMERIC(10,2) DEFAULT 0,
  marketing_spend_influencer NUMERIC(10,2) DEFAULT 0,
  marketing_spend_email NUMERIC(10,2) DEFAULT 0,
  marketing_spend_content NUMERIC(10,2) DEFAULT 0,
  roas_google NUMERIC(8,2) DEFAULT 0,
  roas_meta NUMERIC(8,2) DEFAULT 0,
  roas_overall NUMERIC(8,2) DEFAULT 0,
  cpl NUMERIC(8,2) DEFAULT 0,
  cpl_google NUMERIC(8,2) DEFAULT 0,
  cpl_meta NUMERIC(8,2) DEFAULT 0,
  cac NUMERIC(8,2) DEFAULT 0,
  cpa NUMERIC(8,2) DEFAULT 0,
  email_attributed_revenue NUMERIC(12,2) DEFAULT 0,
  active_email_subscribers INTEGER DEFAULT 0,
  popup_capture_rate_pct NUMERIC(6,2) DEFAULT 0,
  web_to_lead_pct NUMERIC(6,2) DEFAULT 0,
  lead_to_consult_pct NUMERIC(6,2) DEFAULT 0,
  consult_to_booking_pct NUMERIC(6,2) DEFAULT 0,
  lead_to_booking_pct NUMERIC(6,2) DEFAULT 0,
  total_leads INTEGER DEFAULT 0,
  google_leads INTEGER DEFAULT 0,
  meta_leads INTEGER DEFAULT 0,
  other_leads INTEGER DEFAULT 0,
  maltese_web_traffic INTEGER DEFAULT 0,
  ecomm_sales NUMERIC(12,2) DEFAULT 0,
  membership_count INTEGER DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(week_start, brand_id)
);

ALTER TABLE growth_weekly ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Authenticated read growth_weekly" ON growth_weekly FOR SELECT TO authenticated USING (true);
CREATE POLICY "Service insert growth_weekly" ON growth_weekly FOR INSERT TO service_role USING (true);
