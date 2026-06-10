-- Re-create CRM tables dropped from production (crm_daily, crm_booking_mix, crm_lead_reconciliation)
-- crm_daily was in 004/020, booking_mix and lead_reconciliation were dropped in 054

CREATE TABLE IF NOT EXISTS crm_daily (
  id                         SERIAL PRIMARY KEY,
  date                       DATE         NOT NULL,
  brand_id                   INTEGER      NOT NULL REFERENCES brands(id),
  total_leads                INTEGER,
  leads_meta                 INTEGER,
  leads_crm                  INTEGER,
  leads_in_hours             INTEGER,
  leads_out_hours            INTEGER,
  speed_to_lead_median_min   NUMERIC(8,2),
  speed_to_lead_mean_min     NUMERIC(8,2),
  conversion_rate_pct        NUMERIC(5,2),
  total_calls                INTEGER,
  outbound_calls             INTEGER,
  calls_outside_hours        INTEGER,
  appointments_booked        INTEGER,
  total_sales                NUMERIC(10,2),
  deposit_pct                NUMERIC(5,2),
  avg_daily_sales            NUMERIC(10,2),
  unreplied_crm              INTEGER,
  unreplied_whatsapp         INTEGER,
  unreplied_email            INTEGER,
  unworked_leads             INTEGER,
  etl_synced_at              TIMESTAMPTZ  NOT NULL DEFAULT now(),
  UNIQUE(date, brand_id)
);

CREATE INDEX IF NOT EXISTS idx_crm_daily_brand ON crm_daily(brand_id, date);

CREATE TABLE IF NOT EXISTS crm_booking_mix (
  id              SERIAL  PRIMARY KEY,
  date            DATE    NOT NULL,
  brand_id        INTEGER NOT NULL REFERENCES brands(id),
  treatment_name  TEXT    NOT NULL,
  count           INTEGER NOT NULL DEFAULT 0,
  UNIQUE(date, brand_id, treatment_name)
);

CREATE INDEX IF NOT EXISTS idx_booking_mix ON crm_booking_mix(date, brand_id);

CREATE TABLE IF NOT EXISTS crm_lead_reconciliation (
  id          SERIAL  PRIMARY KEY,
  date        DATE    NOT NULL,
  brand_id    INTEGER NOT NULL REFERENCES brands(id),
  leads_meta  INTEGER NOT NULL DEFAULT 0,
  leads_crm   INTEGER NOT NULL DEFAULT 0,
  delta       INTEGER GENERATED ALWAYS AS (leads_meta - leads_crm) STORED,
  UNIQUE(date, brand_id)
);

CREATE INDEX IF NOT EXISTS idx_lead_recon ON crm_lead_reconciliation(date, brand_id);
