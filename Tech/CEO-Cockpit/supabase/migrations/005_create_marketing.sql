CREATE TABLE marketing_daily (
  id SERIAL PRIMARY KEY,
  date DATE NOT NULL,
  brand_id INTEGER NOT NULL REFERENCES brands(id),
  platform TEXT NOT NULL,
  spend NUMERIC(10,2),
  impressions INTEGER,
  clicks INTEGER,
  leads INTEGER,
  cpl NUMERIC(8,2),
  roas NUMERIC(6,2),
  ctr_pct NUMERIC(5,2),
  cpc NUMERIC(8,2),
  etl_synced_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(date, brand_id, platform)
);

CREATE TABLE ga4_daily (
  id SERIAL PRIMARY KEY,
  date DATE NOT NULL,
  brand_id INTEGER NOT NULL REFERENCES brands(id),
  sessions INTEGER,
  total_users INTEGER,
  new_users INTEGER,
  page_views INTEGER,
  avg_session_duration_sec NUMERIC(8,2),
  bounce_rate_pct NUMERIC(5,2),
  conversions INTEGER,
  UNIQUE(date, brand_id)
);

CREATE TABLE gsc_daily (
  id SERIAL PRIMARY KEY,
  date DATE NOT NULL,
  brand_id INTEGER NOT NULL REFERENCES brands(id),
  clicks INTEGER,
  impressions INTEGER,
  ctr_pct NUMERIC(5,2),
  avg_position NUMERIC(6,2),
  UNIQUE(date, brand_id)
);

CREATE TABLE klaviyo_campaigns (
  id SERIAL PRIMARY KEY,
  date DATE NOT NULL,
  brand_id INTEGER NOT NULL REFERENCES brands(id),
  campaign_name TEXT NOT NULL,
  sends INTEGER,
  opens INTEGER,
  clicks INTEGER,
  revenue NUMERIC(10,2),
  revenue_pct_of_total NUMERIC(5,2),
  UNIQUE(date, brand_id, campaign_name)
);

CREATE INDEX idx_marketing_daily ON marketing_daily(brand_id, date, platform);
CREATE INDEX idx_ga4_daily ON ga4_daily(brand_id, date);
CREATE INDEX idx_gsc_daily ON gsc_daily(brand_id, date);
CREATE INDEX idx_klaviyo ON klaviyo_campaigns(brand_id, date);
