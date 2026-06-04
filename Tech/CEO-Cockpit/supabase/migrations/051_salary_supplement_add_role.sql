-- Migration 051: add role column to salary_supplement_monthly
-- Stores the EBITDA wage role directly on each salary row,
-- eliminating the need to match employee names against wage_role_mapping.
-- Roles are copied from the prior month automatically on sync.

ALTER TABLE salary_supplement_monthly
  ADD COLUMN IF NOT EXISTS role TEXT
    CHECK (role IN ('manager', 'reception', 'practitioner', 'therapist', 'crm'));

COMMENT ON COLUMN salary_supplement_monthly.role IS
  'EBITDA wage role for this employee (manager/reception/practitioner/therapist/crm). Null = unassigned.';
