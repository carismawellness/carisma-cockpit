-- Extend ebitda_fallback_rules.rule_type CHECK to allow two new options:
--   • 'previous_month'    — use prior calendar month's total × (days_in_period / days_in_prev_month)
--   • 'quarterly_average' — sum of last 3 full months / 90 × days_in_period
--
-- These join the existing 'ttm_spread', 'manual_annual', 'disabled'.

ALTER TABLE ebitda_fallback_rules
  DROP CONSTRAINT IF EXISTS ebitda_fallback_rules_rule_type_check;

ALTER TABLE ebitda_fallback_rules
  ADD CONSTRAINT ebitda_fallback_rules_rule_type_check
  CHECK (rule_type IN (
    'ttm_spread',
    'manual_annual',
    'previous_month',
    'quarterly_average',
    'disabled'
  ));
