-- COA Split Rules: system rules (locked) + user-defined custom rules
CREATE TABLE coa_split_rules (
  id          SERIAL PRIMARY KEY,
  name        TEXT    NOT NULL,
  zoho_org    TEXT    NOT NULL DEFAULT 'spa',
  rule_type   TEXT    NOT NULL CHECK (rule_type IN ('direct','equal','sales_ratio','salary_cost','custom_fixed')),
  is_system   BOOLEAN NOT NULL DEFAULT false,
  config      JSONB,   -- custom_fixed only: {"inter":30.0,"hugos":20.0,...} must sum to 100
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(name, zoho_org)
);

-- System rules: 4 semantic + 8 location-specific (all locked)
INSERT INTO coa_split_rules (name, zoho_org, rule_type, is_system, config) VALUES
  ('Direct label',              'spa', 'direct',       true, NULL),
  ('Equal across all SPAs',     'spa', 'equal',        true, NULL),
  ('By sales ratio',            'spa', 'sales_ratio',  true, NULL),
  ('By salary cost',            'spa', 'salary_cost',  true, NULL),
  ('100% InterContinental',     'spa', 'custom_fixed', true, '{"inter":100}'),
  ('100% Hugo''s',              'spa', 'custom_fixed', true, '{"hugos":100}'),
  ('100% Hyatt',                'spa', 'custom_fixed', true, '{"hyatt":100}'),
  ('100% Ramla',                'spa', 'custom_fixed', true, '{"ramla":100}'),
  ('100% Labranda',             'spa', 'custom_fixed', true, '{"labranda":100}'),
  ('100% Sunny Coast',          'spa', 'custom_fixed', true, '{"odycy":100}'),
  ('100% Excelsior',            'spa', 'custom_fixed', true, '{"excelsior":100}'),
  ('100% Novotel',              'spa', 'custom_fixed', true, '{"novotel":100}');

-- COA Mapping: one row per Zoho account per org
CREATE TABLE zoho_coa_mapping (
  id              SERIAL PRIMARY KEY,
  account_code    TEXT    NOT NULL,
  account_name    TEXT    NOT NULL,
  account_type    TEXT,
  zoho_org        TEXT    NOT NULL DEFAULT 'spa',
  ebitda_line     TEXT    CHECK (ebitda_line IN ('revenue','cogs','wages','advertising','rent','utilities','sga','excluded')),
  split_rule_id   INTEGER REFERENCES coa_split_rules(id) ON DELETE SET NULL,
  last_synced_at  TIMESTAMPTZ,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(account_code, zoho_org)
);

CREATE INDEX idx_coa_mapping_org       ON zoho_coa_mapping(zoho_org);
CREATE INDEX idx_coa_mapping_ebitda    ON zoho_coa_mapping(ebitda_line);
CREATE INDEX idx_coa_mapping_unmapped  ON zoho_coa_mapping(zoho_org) WHERE ebitda_line IS NULL;
