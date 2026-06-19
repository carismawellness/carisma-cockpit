-- Migration 051: EBITDA V2 schema
--
-- 1. Add `venue` column to transactions_raw so each raw row carries its
--    allocated venue/department (hyatt, ramla, ..., aesthetics, slimming, hq).
--    Split transactions now generate one row per venue.
-- 2. Replace the old 5-column unique constraint with a 6-column one that
--    includes venue, allowing multiple venue rows per transaction.
-- 3. Create ebitda_v2_special_persons — contacts always rerouted to Wages.
-- 4. Create ebitda_v2_hardwired_rules — venue-specific overrides (Novotel, Excelsior).

-- ── 1. Add venue column ──────────────────────────────────────────────────────
ALTER TABLE transactions_raw
  ADD COLUMN IF NOT EXISTS venue TEXT NOT NULL DEFAULT 'unallocated';

-- ── 2. Drop the old unique constraint (any existing unique constraint on
--      transactions_raw; the new one with venue replaces it) ──────────────────
DO $$
DECLARE
  r RECORD;
BEGIN
  FOR r IN (
    SELECT conname
    FROM pg_constraint
    WHERE conrelid = 'transactions_raw'::regclass
      AND contype = 'u'
  )
  LOOP
    EXECUTE 'ALTER TABLE transactions_raw DROP CONSTRAINT ' || quote_ident(r.conname);
  END LOOP;
END $$;

-- ── 3. New unique constraint including venue ─────────────────────────────────
ALTER TABLE transactions_raw
  ADD CONSTRAINT transactions_raw_unique_v2
  UNIQUE (org, txn_id, account_code, contact_name, ebitda_line, venue);

-- ── 4. Special persons table ─────────────────────────────────────────────────
-- Contacts that must always appear under Wages & Salaries in EBITDA V2,
-- regardless of which Zoho account they were originally posted to.
-- contact_key is the normalized lowercase match pattern (substring match).
CREATE TABLE IF NOT EXISTS ebitda_v2_special_persons (
  id           UUID        DEFAULT gen_random_uuid() PRIMARY KEY,
  contact_key  TEXT        NOT NULL UNIQUE,   -- lowercase, used for substring match
  display_name TEXT        NOT NULL,
  active       BOOLEAN     NOT NULL DEFAULT TRUE,
  created_at   TIMESTAMPTZ DEFAULT NOW()
);

INSERT INTO ebitda_v2_special_persons (contact_key, display_name) VALUES
  -- From user requirements
  ('mandar',                   'Mandar'),
  ('melisa',                   'Melisa'),
  ('melissa',                  'Melissa'),
  ('ruksana',                  'Ruksana'),
  ('yamuna',                   'Yamuna'),
  ('upwork',                   'Upwork'),
  ('yofana',                   'Yofana'),
  ('april joy banaban',        'April Joy Banaban'),
  ('natalia veloso de melo',   'Natalia Veloso De Melo'),
  ('rana abid',                'Rana Abid'),
  ('veejay',                   'Veejay'),
  ('nicole maria bast',        'Nicole Maria Bast'),
  ('juliana maria velasquez',  'Juliana Maria Velasquez'),
  ('adeel khan',               'Adeel Khan'),
  -- Already in ETL (kept in sync)
  ('manan',                    'Manan'),
  ('dr walter',                'Dr. Walter'),
  ('francesca chircop',        'Francesca Chircop'),
  ('giovanni scornavacca',     'Giovanni Scornavacca'),
  ('dr zaid teebi',            'Dr Zaid Teebi'),
  ('ivana boskovic stamenkovic', 'Ivana Boskovic Stamenkovic')
ON CONFLICT (contact_key) DO NOTHING;

-- ── 5. Hardwired venue rules table ───────────────────────────────────────────
-- Venue/line combinations with fixed calculation rules that override Zoho data.
-- Used in EBITDA V2 for partial-period and full-period runs.
CREATE TABLE IF NOT EXISTS ebitda_v2_hardwired_rules (
  id             UUID    DEFAULT gen_random_uuid() PRIMARY KEY,
  venue          TEXT    NOT NULL,
  ebitda_line    TEXT    NOT NULL,
  -- fixed_monthly:         params.monthly_amount (EUR)
  -- base_plus_revenue_pct: params.base_monthly + params.revenue_pct (%)
  -- skip:                  ignore any Zoho data for this venue+line
  rule_type      TEXT    NOT NULL CHECK (rule_type IN ('fixed_monthly','base_plus_revenue_pct','skip')),
  params         JSONB   NOT NULL DEFAULT '{}',
  effective_from DATE    NOT NULL,
  effective_to   DATE,
  note           TEXT,
  created_at     TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (venue, ebitda_line)
);

INSERT INTO ebitda_v2_hardwired_rules
  (venue, ebitda_line, rule_type, params, effective_from, note)
VALUES
  ('novotel',   'rent', 'fixed_monthly',         '{"monthly_amount": 2750}',            '2025-11-01',
   'Novotel fixed rent €2,750/month — never sourced from Zoho. Pro-rated for partial periods.'),
  ('excelsior', 'rent', 'base_plus_revenue_pct', '{"base_monthly": 0, "revenue_pct": 5}','2024-01-01',
   'Excelsior rent = base (€0) + 5% of period net revenue.')
ON CONFLICT (venue, ebitda_line) DO NOTHING;

-- ── 6. Index for fast V2 queries ─────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS transactions_raw_v2_venue_idx
  ON transactions_raw (org, venue, ebitda_line, date);
