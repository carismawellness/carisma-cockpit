-- Maps Zoho contact (vendor / customer) names to canonical advertising
-- channel buckets shown on the P&L by Venue table (Meta, Google, Klaviyo,
-- Misc). NOTE: the GHL bucket seeded below was retired in migration 049 —
-- GHL contacts now fall through to Misc. Used by zoho-transactions-daily.ts and the EBIDA Layer
-- Apps Script sheet pull to populate the "Contact" sub-category for
-- accounts whose CoA mapping puts them on the Advertising EBITDA line.
--
-- Match logic: lowercased Zoho contact name is scanned for any pattern
-- that appears as a substring (also lowercased). When multiple patterns
-- match, the one with the lowest `priority` value wins (more specific
-- patterns get lower numbers). If nothing matches, the row is bucketed
-- to "Misc" by the caller.

CREATE TABLE IF NOT EXISTS advertising_contact_mapping (
  id          SERIAL PRIMARY KEY,
  pattern     TEXT          NOT NULL,           -- case-insensitive substring matched against Zoho contact name
  canonical   TEXT          NOT NULL,           -- bucket label: Meta / Google / Klaviyo / GHL / Misc
  priority    INTEGER       NOT NULL DEFAULT 100,
  created_at  TIMESTAMPTZ   NOT NULL DEFAULT now(),
  UNIQUE(pattern)
);

CREATE INDEX IF NOT EXISTS idx_adv_contact_mapping_priority ON advertising_contact_mapping(priority);

ALTER TABLE advertising_contact_mapping ENABLE ROW LEVEL SECURITY;

CREATE POLICY "adv_contact_mapping_service_all" ON advertising_contact_mapping
  FOR ALL    TO service_role  USING (true) WITH CHECK (true);
CREATE POLICY "adv_contact_mapping_auth_read" ON advertising_contact_mapping
  FOR SELECT TO authenticated USING (true);

-- Seed common variants. Extendable later via a settings page.
INSERT INTO advertising_contact_mapping (pattern, canonical, priority) VALUES
  -- Meta family
  ('meta',          'Meta',    50),
  ('facebook',      'Meta',    50),
  ('instagram',     'Meta',    50),
  ('whatsapp',      'Meta',    50),
  -- Google family
  ('google',        'Google',  50),
  ('youtube',       'Google',  50),
  ('google ads',    'Google',  40),
  -- Klaviyo
  ('klaviyo',       'Klaviyo', 50),
  -- GHL / Go High Level
  ('ghl',           'GHL',     50),
  ('highlevel',     'GHL',     50),
  ('high level',    'GHL',     50),
  ('go highlevel',  'GHL',     50),
  ('gohighlevel',   'GHL',     50)
ON CONFLICT (pattern) DO NOTHING;
