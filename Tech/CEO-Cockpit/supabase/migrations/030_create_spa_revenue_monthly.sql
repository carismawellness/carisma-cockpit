-- SPA Revenue monthly breakdown
-- Sources: Lapis (services + products) and Zoho Books (wholesale, discount, refund)
CREATE TABLE IF NOT EXISTS spa_revenue_monthly (
    id                SERIAL PRIMARY KEY,
    location_id       INTEGER NOT NULL REFERENCES locations(id) ON DELETE CASCADE,
    month             DATE    NOT NULL,  -- always YYYY-MM-01

    -- From Lapis spa management system
    services          NUMERIC(14,2) NOT NULL DEFAULT 0,
    product_phytomer  NUMERIC(14,2) NOT NULL DEFAULT 0,
    product_purest    NUMERIC(14,2) NOT NULL DEFAULT 0,
    product_other     NUMERIC(14,2) NOT NULL DEFAULT 0,

    -- From Zoho Books P&L (split across locations)
    wholesale         NUMERIC(14,2) NOT NULL DEFAULT 0,
    sales_discount    NUMERIC(14,2) NOT NULL DEFAULT 0,  -- positive value; deducted from revenue
    sales_refund      NUMERIC(14,2) NOT NULL DEFAULT 0,  -- positive value; deducted from revenue

    lapis_synced_at   TIMESTAMPTZ,
    zoho_synced_at    TIMESTAMPTZ,

    UNIQUE(location_id, month)
);

-- No RLS — internal CEO dashboard, matching spa_ebitda_monthly pattern
CREATE INDEX IF NOT EXISTS spa_revenue_monthly_month_idx ON spa_revenue_monthly(month);
