-- Migration 091: extend wage_role_mapping with venue_override and monthly_floor
--
-- venue_override: optional per-employee venue tag; when set, all wage transactions
--   for this employee are attributed to this venue instead of the transaction's own
--   venue tag. Used by ebitda-v2 and ebitda-longitudinal for HQ staff whose
--   individual transactions may be split across venues in Zoho but should roll up
--   to a single venue (e.g. "hq").
--
-- monthly_floor: optional fixed monthly cost floor for this employee. When set,
--   the EBITDA engine uses this as the minimum wage allocation regardless of what
--   Zoho transactions show. Useful for salaried staff paid outside Zoho.

ALTER TABLE wage_role_mapping
  ADD COLUMN IF NOT EXISTS venue_override  text    DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS monthly_floor   numeric DEFAULT NULL;
