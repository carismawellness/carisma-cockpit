-- Run this in Supabase SQL editor before inserting the new split rule.
-- Adds marketing_spend_ratio to the allowed rule_type values.

ALTER TABLE coa_split_rules
  DROP CONSTRAINT IF EXISTS coa_split_rules_rule_type_check;

ALTER TABLE coa_split_rules
  ADD CONSTRAINT coa_split_rules_rule_type_check
  CHECK (rule_type IN (
    'direct',
    'equal',
    'sales_ratio',
    'salary_cost',
    'custom_fixed',
    'marketing_spend_ratio'
  ));

-- Insert the system rule (safe to re-run; skips if already present)
INSERT INTO coa_split_rules (name, rule_type, is_system, config, zoho_org)
SELECT 'Marketing spend ratio', 'marketing_spend_ratio', true, null, 'aesthetics'
WHERE NOT EXISTS (
  SELECT 1 FROM coa_split_rules
  WHERE name = 'Marketing spend ratio' AND zoho_org = 'aesthetics'
);
