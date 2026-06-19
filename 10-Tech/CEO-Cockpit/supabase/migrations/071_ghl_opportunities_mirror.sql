-- GHL Opportunities Mirror
-- Enables period-scoped funnel metrics by storing GHL opportunity state
-- and stage transition events in Supabase.
--
-- Two tables:
--   ghl_opportunities            — one row per opp, current state (upserted on webhook/backfill)
--   ghl_opportunity_stage_events — append-only stage transition log

CREATE TABLE IF NOT EXISTS ghl_opportunities (
  ghl_opportunity_id    TEXT PRIMARY KEY,
  brand_id              INTEGER NOT NULL REFERENCES brands(id),
  ghl_location_id       TEXT NOT NULL,
  ghl_pipeline_id       TEXT NOT NULL,
  ghl_pipeline_stage_id TEXT NOT NULL,
  stage_normalized      TEXT NOT NULL,
  status                TEXT,
  contact_id            TEXT,
  assigned_to           TEXT,
  monetary_value        NUMERIC(12,2),
  date_added            TIMESTAMPTZ NOT NULL,
  date_updated          TIMESTAMPTZ NOT NULL,
  last_stage_change_at  TIMESTAMPTZ,
  raw                   JSONB,
  synced_at             TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS ghl_opportunities_brand_date_added
  ON ghl_opportunities (brand_id, date_added);
CREATE INDEX IF NOT EXISTS ghl_opportunities_brand_last_stage
  ON ghl_opportunities (brand_id, last_stage_change_at);
CREATE INDEX IF NOT EXISTS ghl_opportunities_brand_stage
  ON ghl_opportunities (brand_id, stage_normalized);

CREATE TABLE IF NOT EXISTS ghl_opportunity_stage_events (
  id                    BIGSERIAL PRIMARY KEY,
  ghl_opportunity_id    TEXT NOT NULL,
  brand_id              INTEGER NOT NULL REFERENCES brands(id),
  from_stage_normalized TEXT,
  to_stage_normalized   TEXT NOT NULL,
  changed_at            TIMESTAMPTZ NOT NULL,
  source                TEXT NOT NULL CHECK (source IN ('webhook', 'backfill')),
  raw                   JSONB
);

CREATE INDEX IF NOT EXISTS ghl_opp_stage_events_brand_stage_time
  ON ghl_opportunity_stage_events (brand_id, to_stage_normalized, changed_at);
CREATE INDEX IF NOT EXISTS ghl_opp_stage_events_opp_id
  ON ghl_opportunity_stage_events (ghl_opportunity_id);
