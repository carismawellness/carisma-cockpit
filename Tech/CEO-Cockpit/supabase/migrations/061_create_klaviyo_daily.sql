-- Klaviyo daily aggregate email health metrics per brand
-- Persisted by ETL for trend analysis and dashboard display
CREATE TABLE IF NOT EXISTS klaviyo_daily (
    id                      BIGSERIAL PRIMARY KEY,
    date                    DATE        NOT NULL,
    brand_id                UUID        NOT NULL REFERENCES brands(id),
    total_subscribers       BIGINT      NOT NULL DEFAULT 0,
    active_subscribers      BIGINT      NOT NULL DEFAULT 0,
    campaigns_sent          INT         NOT NULL DEFAULT 0,
    active_flows            INT         NOT NULL DEFAULT 0,
    total_recipients        BIGINT      NOT NULL DEFAULT 0,
    total_delivered         BIGINT      NOT NULL DEFAULT 0,
    open_rate_pct           NUMERIC(8,4),
    click_rate_pct          NUMERIC(8,4),
    unsubscribe_rate_pct    NUMERIC(8,4),
    bounce_rate_pct         NUMERIC(8,4),
    etl_synced_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (date, brand_id)
);

-- No RLS — internal CEO dashboard
CREATE INDEX IF NOT EXISTS klaviyo_daily_brand_date
    ON klaviyo_daily (brand_id, date DESC);
