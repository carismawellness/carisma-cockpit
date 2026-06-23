-- Migration 089: extend wage_role_mapping with SG&A routing
--
-- Adds sga_sub_line so prof-fee contacts can be routed to any SGA sub-bucket
-- instead of the hardcoded "prof_services". Default keeps backwards compat.
-- Also adds is_prof_fee in case it was not applied via an earlier migration.

ALTER TABLE wage_role_mapping ADD COLUMN IF NOT EXISTS is_prof_fee  boolean NOT NULL DEFAULT false;
ALTER TABLE wage_role_mapping ADD COLUMN IF NOT EXISTS sga_sub_line text             DEFAULT 'prof_services';
