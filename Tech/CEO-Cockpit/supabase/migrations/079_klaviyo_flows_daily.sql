-- Per-flow Klaviyo metrics, snapshotted daily.
-- One row per (brand, flow_id, snapshot_date).
-- Populated by /api/etl/klaviyo-flows-sync (nightly) and read by
-- /api/email/klaviyo-flows-db (replaces the live-API klaviyo-flows route).
CREATE TABLE IF NOT EXISTS klaviyo_flows_daily (
    id              BIGSERIAL PRIMARY KEY,
    snapshot_date   DATE NOT NULL,
    brand_id        INTEGER NOT NULL REFERENCES brands(id),
    flow_id         TEXT NOT NULL,
    flow_name       TEXT NOT NULL,
    status          TEXT,           -- 'live' | 'draft' | 'archived'
    -- Metrics over the trailing 30-day window captured at snapshot time
    recipients      INTEGER NOT NULL DEFAULT 0,
    delivered       INTEGER NOT NULL DEFAULT 0,
    opens           INTEGER NOT NULL DEFAULT 0,
    clicks          INTEGER NOT NULL DEFAULT 0,
    unsubscribes    INTEGER NOT NULL DEFAULT 0,
    open_rate_pct   NUMERIC(8,4),
    click_rate_pct  NUMERIC(8,4),
    etl_synced_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (snapshot_date, brand_id, flow_id)
);

CREATE INDEX IF NOT EXISTS klaviyo_flows_daily_brand_date
    ON klaviyo_flows_daily (brand_id, snapshot_date DESC);
