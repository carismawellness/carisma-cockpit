-- ebitda_v2_cogs_contacts
-- Contacts whose Zoho transactions are always classified as COGS, regardless of
-- which GL account they were posted to. The venue tag on the transaction is
-- preserved (these contacts always have venue tags, unlike Special Persons).
CREATE TABLE IF NOT EXISTS ebitda_v2_cogs_contacts (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  contact_key  text NOT NULL UNIQUE,  -- lowercase substring matched against contact_name
  display_name text NOT NULL,
  active       boolean NOT NULL DEFAULT true,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE ebitda_v2_cogs_contacts ENABLE ROW LEVEL SECURITY;

CREATE POLICY "authenticated can read ebitda_v2_cogs_contacts"
  ON ebitda_v2_cogs_contacts FOR SELECT TO authenticated USING (true);

CREATE POLICY "authenticated can modify ebitda_v2_cogs_contacts"
  ON ebitda_v2_cogs_contacts FOR ALL TO authenticated USING (true) WITH CHECK (true);
