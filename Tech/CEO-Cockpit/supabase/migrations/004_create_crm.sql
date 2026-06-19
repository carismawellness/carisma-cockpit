CREATE TABLE crm_daily (
  id SERIAL PRIMARY KEY,
  date DATE NOT NULL,
  brand_id INTEGER NOT NULL REFERENCES brands(id),
  total_leads INTEGER,
  leads_meta INTEGER,
  leads_crm INTEGER,
  leads_in_hours INTEGER,
  leads_out_hours INTEGER,
  speed_to_lead_median_min NUMERIC(8,2),
  speed_to_lead_mean_min NUMERIC(8,2),
  conversion_rate_pct NUMERIC(5,2),
  total_calls INTEGER,
  outbound_calls INTEGER,
  calls_outside_hours INTEGER,
  appointments_booked INTEGER,
  etl_synced_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(date, brand_id)
);

CREATE TABLE crm_by_rep (
  id SERIAL PRIMARY KEY,
  date DATE NOT NULL,
  staff_id INTEGER NOT NULL REFERENCES staff(id),
  brand_id INTEGER NOT NULL REFERENCES brands(id),
  leads_assigned INTEGER,
  calls_made INTEGER,
  appointments_booked INTEGER,
  conversions INTEGER,
  conversion_rate_pct NUMERIC(5,2),
  speed_to_lead_avg_min NUMERIC(8,2),
  UNIQUE(date, staff_id)
);

CREATE TABLE speed_to_lead_distribution (
  id SERIAL PRIMARY KEY,
  date DATE NOT NULL,
  brand_id INTEGER NOT NULL REFERENCES brands(id),
  bucket TEXT NOT NULL,
  count INTEGER NOT NULL,
  pct NUMERIC(5,2),
  UNIQUE(date, brand_id, bucket)
);

CREATE INDEX idx_crm_daily_brand ON crm_daily(brand_id, date);
CREATE INDEX idx_crm_by_rep_date ON crm_by_rep(date, brand_id);
CREATE INDEX idx_stl_dist ON speed_to_lead_distribution(date, brand_id);
