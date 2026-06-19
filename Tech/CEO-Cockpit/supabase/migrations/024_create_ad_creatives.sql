CREATE TABLE IF NOT EXISTS ad_creatives (
  id SERIAL PRIMARY KEY,
  date DATE NOT NULL,
  brand_id INTEGER NOT NULL,
  platform TEXT NOT NULL,
  campaign_name TEXT,
  ad_name TEXT NOT NULL,
  creative_url TEXT,
  spend NUMERIC(10,2),
  impressions INTEGER,
  clicks INTEGER,
  ctr_pct NUMERIC(5,2),
  frequency NUMERIC(6,2),
  cpm NUMERIC(8,2),
  leads INTEGER,
  fatigue_status TEXT CHECK (fatigue_status IN ('healthy', 'watch', 'fatigued')),
  UNIQUE(date, brand_id, platform, ad_name)
);
