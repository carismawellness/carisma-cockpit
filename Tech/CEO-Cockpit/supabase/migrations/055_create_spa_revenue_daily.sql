-- SPA Revenue daily breakdown (missing migration — companion to 030_create_spa_revenue_monthly)
-- Used by ETL: lib/etl/lapis-revenue.ts → runLapisRevenueDaily()
-- Enables exact date-range revenue queries independent of calendar month boundaries

CREATE TABLE IF NOT EXISTS spa_revenue_daily (
    id                SERIAL PRIMARY KEY,
    location_id       INTEGER NOT NULL REFERENCES locations(id) ON DELETE CASCADE,
    date              DATE    NOT NULL,

    -- From Lapis spa management system
    services          NUMERIC(14,2) NOT NULL DEFAULT 0,
    product_phytomer  NUMERIC(14,2) NOT NULL DEFAULT 0,
    product_purest    NUMERIC(14,2) NOT NULL DEFAULT 0,
    product_other     NUMERIC(14,2) NOT NULL DEFAULT 0,

    lapis_synced_at   TIMESTAMPTZ,

    UNIQUE(location_id, date)
);

CREATE INDEX IF NOT EXISTS spa_revenue_daily_date_idx ON spa_revenue_daily(date);
CREATE INDEX IF NOT EXISTS spa_revenue_daily_loc_date_idx ON spa_revenue_daily(location_id, date);
