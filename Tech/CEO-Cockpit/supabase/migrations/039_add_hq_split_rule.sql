INSERT INTO coa_split_rules (name, zoho_org, rule_type, is_system, config)
VALUES ('100% HQ', 'spa', 'custom_fixed', true, '{"hq":100}')
ON CONFLICT (name, zoho_org) DO NOTHING;
