-- Meta Ads campaign-level daily metrics
-- Persisted by ETL to enable YoY comparison and fix creative fatigue scoring
-- peak_ctr is the rolling 7-day max CTR for a campaign — used to measure fatigue drop
CREATE TABLE IF NOT EXISTS meta_campaigns_daily (
    id                  BIGSERIAL PRIMARY KEY,
    date                DATE           NOT NULL,
    brand_id            UUID           NOT NULL REFERENCES brands(id),
    campaign_id         TEXT           NOT NULL,
    campaign_name       TEXT           NOT NULL,
    adset_name          TEXT,
    spend               NUMERIC(12,2)  NOT NULL DEFAULT 0,
    impressions         BIGINT         NOT NULL DEFAULT 0,
    clicks              BIGINT         NOT NULL DEFAULT 0,
    leads               BIGINT         NOT NULL DEFAULT 0,
    cpl                 NUMERIC(10,2),
    ctr_pct             NUMERIC(8,4),
    cpm                 NUMERIC(10,2),
    frequency           NUMERIC(8,4),
    attributed_revenue  NUMERIC(12,2)  DEFAULT 0,
    roas                NUMERIC(10,4),
    peak_ctr            NUMERIC(8,4),
    fatigue_status      TEXT,
    etl_synced_at       TIMESTAMPTZ    NOT NULL DEFAULT now(),
    UNIQUE (date, brand_id, campaign_id)
);

-- No RLS — internal CEO dashboard
CREATE INDEX IF NOT EXISTS meta_campaigns_daily_brand_date
    ON meta_campaigns_daily (brand_id, date DESC);
CREATE INDEX IF NOT EXISTS meta_campaigns_daily_campaign
    ON meta_campaigns_daily (campaign_id, date DESC);
