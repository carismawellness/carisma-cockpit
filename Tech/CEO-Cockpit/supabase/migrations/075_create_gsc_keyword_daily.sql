-- Daily Google Search Console rankings per tracked keyword per brand.
-- Populated by the gsc-sync ETL. Read by the marketing dashboards.
CREATE TABLE IF NOT EXISTS gsc_keyword_daily (
    id              BIGSERIAL PRIMARY KEY,
    date            DATE        NOT NULL,
    brand_id        INTEGER     NOT NULL REFERENCES brands(id),
    keyword         TEXT        NOT NULL,
    clicks          INTEGER     NOT NULL DEFAULT 0,
    impressions     INTEGER     NOT NULL DEFAULT 0,
    ctr             NUMERIC(8,6),    -- 0–1 (e.g. 0.052 = 5.2%)
    position        NUMERIC(8,4),    -- average rank (lower is better)
    etl_synced_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (date, brand_id, keyword)
);

CREATE INDEX IF NOT EXISTS gsc_keyword_daily_brand_keyword_date
    ON gsc_keyword_daily (brand_id, keyword, date DESC);
