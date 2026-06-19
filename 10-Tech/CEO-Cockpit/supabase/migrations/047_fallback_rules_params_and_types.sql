-- Extend ebitda_fallback_rules so the user can:
--   • change rule_type per account (ttm_spread / manual_annual / disabled)
--   • override the TTM auto-computed amount with a manual annual figure
--     stored in params.annual_amount
--
-- The CHECK constraint added in 046 only allowed 'ttm_spread' — widen it.

ALTER TABLE ebitda_fallback_rules
  DROP CONSTRAINT IF EXISTS ebitda_fallback_rules_rule_type_check;

ALTER TABLE ebitda_fallback_rules
  ADD CONSTRAINT ebitda_fallback_rules_rule_type_check
  CHECK (rule_type IN ('ttm_spread', 'manual_annual', 'disabled'));

-- Per-rule parameters as JSONB. For 'manual_annual' the user-supplied
-- annual amount lives at params.annual_amount (numeric, EUR). Other rule
-- types may add params later without further schema migrations.
ALTER TABLE ebitda_fallback_rules
  ADD COLUMN IF NOT EXISTS params JSONB NOT NULL DEFAULT '{}'::jsonb;
