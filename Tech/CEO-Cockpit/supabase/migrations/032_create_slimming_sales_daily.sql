-- Slimming Sales transaction-level table
-- Source: Google Sheets "Treatments {Month} {Year}" tabs
-- Revenue = Paid column (actual cash collected; package may span multiple months)
CREATE TABLE IF NOT EXISTS slimming_sales_daily (
    id                  SERIAL PRIMARY KEY,
    sheet_tab           TEXT NOT NULL,
    month               DATE NOT NULL,         -- YYYY-MM-01
    date_of_service     DATE,
    client              TEXT,
    service_type        TEXT,                  -- weight_loss | treatment | medical | product
    service_description TEXT,
    full_price          NUMERIC(10,2),         -- contracted package price
    paid                NUMERIC(10,2),         -- amount actually collected (= revenue)
    vat_rate            NUMERIC(5,4) DEFAULT 0.18,
    price_ex_vat        NUMERIC(10,2),         -- paid ÷ (1 + vat_rate)
    sales_staff         TEXT,
    synced_at           TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS slimming_sales_daily_month_idx     ON slimming_sales_daily(month);
CREATE INDEX IF NOT EXISTS slimming_sales_daily_tab_idx       ON slimming_sales_daily(sheet_tab);
CREATE INDEX IF NOT EXISTS slimming_sales_daily_staff_idx     ON slimming_sales_daily(sales_staff);
