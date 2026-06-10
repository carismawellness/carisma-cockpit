-- Spa per-employee service revenue (Practitioner Productivity)
-- Source: Cockpit "Service - Spa" tab, Employee(s) column
-- Excludes rows where Employee(s) = 'CARISMA (SALES)' (non-therapist walk-in sales)
CREATE TABLE IF NOT EXISTS spa_services_by_employee_daily (
    id              SERIAL PRIMARY KEY,
    month           DATE      NOT NULL,           -- YYYY-MM-01
    date_of_service DATE      NOT NULL,
    location_id     INTEGER   REFERENCES locations(id) ON DELETE CASCADE NOT NULL,
    employee_name   TEXT      NOT NULL,
    service_name    TEXT,
    price_ex_vat    NUMERIC(10,2) NOT NULL,
    synced_at       TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS spa_svc_emp_month_idx    ON spa_services_by_employee_daily(month);
CREATE INDEX IF NOT EXISTS spa_svc_emp_location_idx ON spa_services_by_employee_daily(location_id);
CREATE INDEX IF NOT EXISTS spa_svc_emp_name_idx     ON spa_services_by_employee_daily(employee_name);
