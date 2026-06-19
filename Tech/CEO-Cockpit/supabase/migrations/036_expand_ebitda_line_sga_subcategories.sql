-- Expand the ebitda_line CHECK constraint to include granular SG&A sub-categories.
-- The ETL normalises all sga_* values back to the sga bucket, so existing
-- aggregation columns and hooks remain unchanged.

ALTER TABLE zoho_coa_mapping
  DROP CONSTRAINT IF EXISTS zoho_coa_mapping_ebitda_line_check;

ALTER TABLE zoho_coa_mapping
  ADD CONSTRAINT zoho_coa_mapping_ebitda_line_check
  CHECK (ebitda_line IN (
    'revenue',
    'cogs',
    'wages',
    'advertising',
    'rent',
    'utilities',
    'sga',
    'sga_prof_services',
    'sga_fuel',
    'sga_laundry',
    'sga_software',
    'sga_cleaning',
    'sga_travel',
    'sga_misc',
    'sga_insurance',
    'sga_events',
    'sga_maintenance',
    'sga_telecom',
    'excluded'
  ));
