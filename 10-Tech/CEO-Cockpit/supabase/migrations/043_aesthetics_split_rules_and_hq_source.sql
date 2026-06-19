-- Three new system split rules for the Aesthetics & Slimming COA mapping tab:
-- 100% HQ, 100% Aesthetics, 100% Slimming. All custom_fixed; the ETL recognises
-- {"hq":100} and routes the line into hq_ebitda_monthly instead of the dept totals.
--
-- Because the SPA ETL already writes hq_ebitda_monthly (HQ-tagged costs from the
-- SPA Zoho org) and the aesthetics ETL is about to write to it too, we need to
-- distinguish the two sources so they don't overwrite each other on (month).
-- useHqEbitda already SUMs all rows per month, so adding a `source` column and
-- expanding uniqueness to (month, source) is sufficient — the hook needs no change.

ALTER TABLE hq_ebitda_monthly
  ADD COLUMN IF NOT EXISTS source TEXT NOT NULL DEFAULT 'spa';

ALTER TABLE hq_ebitda_monthly
  DROP CONSTRAINT IF EXISTS hq_ebitda_monthly_month_key;

ALTER TABLE hq_ebitda_monthly
  ADD CONSTRAINT hq_ebitda_monthly_month_source_key UNIQUE (month, source);

INSERT INTO coa_split_rules (name, zoho_org, rule_type, is_system, config) VALUES
  ('100% HQ',         'aesthetics', 'custom_fixed', true, '{"hq":100}'),
  ('100% Aesthetics', 'aesthetics', 'custom_fixed', true, '{"aesthetics":100}'),
  ('100% Slimming',   'aesthetics', 'custom_fixed', true, '{"slimming":100}')
ON CONFLICT (name, zoho_org) DO NOTHING;
