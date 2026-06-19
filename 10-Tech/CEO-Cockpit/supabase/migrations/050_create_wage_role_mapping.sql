-- Maps a Zoho payroll contact (the individual employee booked on a wage
-- transaction) to a canonical organisational role. Used purely client-side by
-- the EBITDA cockpit's "Wages & Salaries" expandable row and the Employee
-- Mapping settings page to break payroll down by Manager / Reception /
-- Practitioner / CRM (anyone unmapped falls into an implicit "Unassigned"
-- bucket so the sub-rows always reconcile to the wages cell).
--
-- Role is a property of the EMPLOYEE, assigned globally — an employee keeps
-- the same role across every venue they're booked to. The join key is the
-- Zoho `contact` name, normalised to lowercase + collapsed whitespace
-- (`contact_key`), so the lookup is robust to casing / spacing drift. The
-- original display name is kept in `contact_name` for the UI.

CREATE TABLE IF NOT EXISTS wage_role_mapping (
  id            SERIAL PRIMARY KEY,
  contact_key   TEXT        NOT NULL,            -- normalised join key: lower(trim) + collapsed inner whitespace
  contact_name  TEXT        NOT NULL,            -- original display name (most recent seen)
  role          TEXT        NOT NULL CHECK (role IN ('manager','reception','practitioner','crm')),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(contact_key)
);

CREATE INDEX IF NOT EXISTS idx_wage_role_mapping_key ON wage_role_mapping(contact_key);

-- RLS consistent with the other settings-mapping tables (045 / 028): anon/auth
-- can read, service_role (used by the API route via getAdminClient) does writes.
ALTER TABLE wage_role_mapping ENABLE ROW LEVEL SECURITY;

CREATE POLICY "wage_role_mapping_service_all" ON wage_role_mapping
  FOR ALL    TO service_role  USING (true) WITH CHECK (true);
CREATE POLICY "wage_role_mapping_auth_read" ON wage_role_mapping
  FOR SELECT TO authenticated USING (true);
-- Also allow anon read (parity with salary_supplement_monthly's open read),
-- since the cockpit fetches this table from the browser session.
CREATE POLICY "wage_role_mapping_anon_read" ON wage_role_mapping
  FOR SELECT TO anon USING (true);
