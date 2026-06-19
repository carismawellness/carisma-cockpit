-- CRM Agent Mapping: maps each agent slug to their role and brand.
-- Referenced by funnel APIs to determine which agents belong to each brand's SDR team.

CREATE TABLE IF NOT EXISTS crm_agent_mapping (
  id            SERIAL        PRIMARY KEY,
  agent_slug    TEXT          NOT NULL UNIQUE,
  display_name  TEXT          NOT NULL,
  position      TEXT          NOT NULL CHECK (position IN ('sdr', 'chat')),
  brand_slug    TEXT          CHECK (brand_slug IN ('spa', 'aesthetics', 'slimming')),
  is_active     BOOLEAN       NOT NULL DEFAULT true,
  created_at    TIMESTAMPTZ   NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ   NOT NULL DEFAULT now()
);

ALTER TABLE crm_agent_mapping ENABLE ROW LEVEL SECURITY;
CREATE POLICY "service role full access" ON crm_agent_mapping USING (true) WITH CHECK (true);

-- Seed with current known agent roster
INSERT INTO crm_agent_mapping (agent_slug, display_name, position, brand_slug) VALUES
  ('juliana',  'Juliana',  'sdr',  'spa'),
  ('vj',       'VJ',       'sdr',  'spa'),
  ('april',    'April',    'sdr',  'aesthetics'),
  ('ray',      'Ray',      'sdr',  'aesthetics'),
  ('dorianne', 'Dorianne', 'sdr',  'slimming'),
  ('queenee',  'Queenee',  'sdr',  'slimming'),
  ('anni',     'Anni',     'sdr',  NULL),
  ('nicci',    'Nicci',    'sdr',  NULL),
  ('nathalia', 'Nathalia', 'sdr',  NULL),
  ('adeel',    'Adeel',    'chat', NULL),
  ('rana',     'Rana',     'chat', NULL),
  ('abid',     'Abid',     'chat', NULL),
  ('km',       'K&M',      'chat', NULL)
ON CONFLICT (agent_slug) DO NOTHING;
