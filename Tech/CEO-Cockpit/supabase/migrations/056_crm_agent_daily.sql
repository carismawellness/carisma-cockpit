CREATE TABLE crm_agent_daily (
  id SERIAL PRIMARY KEY,
  agent_slug TEXT NOT NULL,  -- e.g. "adeel", "rana", "km", "vj"
  date DATE NOT NULL,
  -- Live Chat channel
  lc_sales NUMERIC(10,2) DEFAULT 0,
  lc_messages INTEGER DEFAULT 0,
  lc_booked INTEGER DEFAULT 0,
  lc_deposit INTEGER DEFAULT 0,
  -- CRM channel
  crm_sales NUMERIC(10,2) DEFAULT 0,
  crm_messages INTEGER DEFAULT 0,
  crm_booked INTEGER DEFAULT 0,
  crm_deposit INTEGER DEFAULT 0,
  -- Other channels (WA, Email, DMs)
  other_sales NUMERIC(10,2) DEFAULT 0,
  other_messages INTEGER DEFAULT 0,
  other_booked INTEGER DEFAULT 0,
  other_deposit INTEGER DEFAULT 0,
  -- Totals
  total_messages INTEGER DEFAULT 0,
  total_booked INTEGER DEFAULT 0,
  total_deposit_count INTEGER DEFAULT 0,
  conversion_rate_pct NUMERIC(5,2) DEFAULT 0,
  total_sales NUMERIC(10,2) DEFAULT 0,
  deposit_pct NUMERIC(5,2) DEFAULT 0,
  aov NUMERIC(10,2) DEFAULT 0,
  etl_synced_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(agent_slug, date)
);

CREATE INDEX idx_crm_agent_daily_slug ON crm_agent_daily(agent_slug, date);
CREATE INDEX idx_crm_agent_daily_date ON crm_agent_daily(date);
