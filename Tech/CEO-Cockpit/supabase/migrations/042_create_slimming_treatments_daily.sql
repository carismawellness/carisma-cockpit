-- Slimming Treatments transaction-level table
-- Source: Google Sheets "Treatments {Month} {YY}" tabs (separate from Sales tabs)
-- Revenue = Price column (inc-VAT); price_ex_vat = price / (1 + vat_rate)
CREATE TABLE IF NOT EXISTS slimming_treatments_daily (
    id              SERIAL PRIMARY KEY,
    sheet_tab       TEXT NOT NULL,
    month           DATE NOT NULL,            -- YYYY-MM-01
    date_of_service DATE,
    client          TEXT,                     -- nullable (only present on some tabs)
    treatment       TEXT,
    price_inc_vat   NUMERIC(10,2),
    vat_rate        NUMERIC(5,4) DEFAULT 0.18,
    price_ex_vat    NUMERIC(10,2),
    therapist       TEXT,
    synced_at       TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS slimming_treatments_daily_month_idx     ON slimming_treatments_daily(month);
CREATE INDEX IF NOT EXISTS slimming_treatments_daily_tab_idx       ON slimming_treatments_daily(sheet_tab);
CREATE INDEX IF NOT EXISTS slimming_treatments_daily_therapist_idx ON slimming_treatments_daily(therapist);
