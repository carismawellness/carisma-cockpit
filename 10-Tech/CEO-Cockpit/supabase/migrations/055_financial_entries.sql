-- Migration 055: financial_entries
--
-- Single source of truth for all daily EBITDA data.
-- One row per (date × brand × account_code × venue × contact).
-- Mirrors the Zoho Raw Layer sheet in tall/tidy format.
-- Manual overrides are preserved across ETL re-syncs via is_manual_override flag.

CREATE TABLE IF NOT EXISTS public.financial_entries (
  id                 bigint      GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  date               date        NOT NULL,
  brand              text        NOT NULL,  -- 'SPA' | 'AES' | 'SLIM' | 'HQ'
  venue              text        NOT NULL,  -- display name e.g. 'Hugos', 'Hyatt', 'AES'
  line_item          text        NOT NULL,  -- account_name from Zoho CoA
  account_code       text        NOT NULL DEFAULT '',
  ebitda_category    text        NOT NULL,  -- 'revenue' | 'cogs' | 'wages' | 'advertising' | 'rent' | 'utilities' | 'sga' | 'sga_*'
  split_rule         text        NOT NULL DEFAULT '',  -- 'sales_ratio' | 'tag' | 'equal' | ...
  contact            text        NOT NULL DEFAULT '',  -- advertising sub-bucket: 'Meta' | 'Google' | '' for non-ad rows
  amount             numeric     NOT NULL DEFAULT 0,

  -- Manual override fields — ETL never overwrites when is_manual_override = true
  is_manual_override boolean     NOT NULL DEFAULT false,
  override_reason    text,

  -- Provenance
  zoho_synced_at     timestamptz,
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now()
);

-- Unique constraint: one row per (date, brand, account, venue, contact)
CREATE UNIQUE INDEX IF NOT EXISTS financial_entries_uq
  ON public.financial_entries (date, brand, account_code, venue, contact);

-- Common query patterns
CREATE INDEX IF NOT EXISTS financial_entries_date_brand   ON public.financial_entries (date, brand);
CREATE INDEX IF NOT EXISTS financial_entries_category     ON public.financial_entries (ebitda_category);
CREATE INDEX IF NOT EXISTS financial_entries_brand_venue  ON public.financial_entries (brand, venue);

-- Auto-update updated_at on every row change
CREATE OR REPLACE FUNCTION public.set_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS financial_entries_updated_at ON public.financial_entries;
CREATE TRIGGER financial_entries_updated_at
  BEFORE UPDATE ON public.financial_entries
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- No RLS for now — accessed via service role key from the ETL only.
-- Add row-level policies when exposing directly to authenticated users.
