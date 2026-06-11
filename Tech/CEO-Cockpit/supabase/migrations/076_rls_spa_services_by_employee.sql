-- spa_services_by_employee_daily was created in migration 064 without RLS
-- policies. Supabase enables RLS by default, so authenticated users received
-- empty results when reading this table. Add standard auth + service_role policies.

ALTER TABLE spa_services_by_employee_daily ENABLE ROW LEVEL SECURITY;

CREATE POLICY "auth_read" ON spa_services_by_employee_daily
  FOR SELECT TO authenticated USING (true);

CREATE POLICY "service_all" ON spa_services_by_employee_daily
  FOR ALL TO service_role USING (true) WITH CHECK (true);
