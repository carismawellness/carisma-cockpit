-- Aesthetics clinic: transaction-level sales from Google Sheets
-- Source: "Sale MONTH YEAR" tabs in the Aesthetics Sales spreadsheet
-- VAT: 12% for Francesca/Giovanni/Kendra (Note column), 18% for all others
CREATE TABLE IF NOT EXISTS aesthetics_sales_daily (
    id              SERIAL PRIMARY KEY,
    sheet_tab       TEXT          NOT NULL,   -- e.g. "Sale April 2026"
    month           DATE          NOT NULL,   -- always YYYY-MM-01
    date_of_service DATE,                     -- null if unparseable
    invoice         TEXT,
    customer        TEXT,
    service_product TEXT,
    price_inc_vat   NUMERIC(10,2),
    vat_rate        NUMERIC(5,4),             -- 0.12 or 0.18
    price_ex_vat    NUMERIC(10,2),
    payment_method  TEXT,
    sales_staff     TEXT,
    note_person     TEXT,                     -- practitioner from Note column
    synced_at       TIMESTAMPTZ   DEFAULT now()
);

-- No RLS — internal CEO dashboard
CREATE INDEX IF NOT EXISTS aes_sales_month_idx   ON aesthetics_sales_daily(month);
CREATE INDEX IF NOT EXISTS aes_sales_tab_idx     ON aesthetics_sales_daily(sheet_tab);
CREATE INDEX IF NOT EXISTS aes_sales_person_idx  ON aesthetics_sales_daily(note_person);
