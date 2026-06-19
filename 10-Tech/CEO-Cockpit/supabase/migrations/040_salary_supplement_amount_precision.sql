-- Increase amount precision from NUMERIC(10,2) to NUMERIC(10,4)
-- to avoid rounding errors when summing cash salary supplements.
ALTER TABLE salary_supplement_monthly
  ALTER COLUMN amount TYPE NUMERIC(10,4);
