-- Sales Employee Dashboards + Commission Mapping
-- (docs/plans/2026-06-10-sales-employee-dashboards-design.md)
--
-- 1. sales_employees                  — canonical employee registry per brand
-- 2. sales_employee_commission_rates  — effective-dated commission rates
-- 3. spa_retail_by_employee_daily     — fills the Spa retail attribution gap
--
-- RLS pattern mirrors migrations 053/056/062:
--   authenticated → SELECT only; service_role → ALL (writes go through
--   service-role server clients / ETL only).

-- ─── 1. Employee registry ─────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS sales_employees (
  id              SERIAL PRIMARY KEY,
  slug            TEXT NOT NULL UNIQUE,           -- url-safe, e.g. "laura-camila"
  display_name    TEXT NOT NULL,
  brand_slug      TEXT NOT NULL CHECK (brand_slug IN ('spa','aesthetics','slimming')),
  role            TEXT,                           -- 'Therapist' | 'Consultant' | ...
  location_name   TEXT,
  user_email      TEXT,                           -- links auth user → self-service dashboard
  is_active       BOOLEAN NOT NULL DEFAULT TRUE,
  aliases         TEXT[] NOT NULL DEFAULT '{}',   -- names as they appear in revenue data
  commission_basis TEXT NOT NULL DEFAULT 'ex_vat' CHECK (commission_basis IN ('ex_vat','inc_vat')),
  notes           TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_sales_employees_brand ON sales_employees(brand_slug);
CREATE INDEX IF NOT EXISTS idx_sales_employees_email ON sales_employees(user_email);

-- ─── 2. Effective-dated commission rates ──────────────────────────────────────
-- The rate applied to a transaction is the row with the greatest
-- effective_from <= transaction date. No row => 0 (UI flags "rates not set").

CREATE TABLE IF NOT EXISTS sales_employee_commission_rates (
  id             SERIAL PRIMARY KEY,
  employee_id    INTEGER NOT NULL REFERENCES sales_employees(id) ON DELETE CASCADE,
  service_rate   NUMERIC(6,4) NOT NULL DEFAULT 0,  -- 0.06 = 6%
  retail_rate    NUMERIC(6,4) NOT NULL DEFAULT 0,  -- 0.10 = 10%
  effective_from DATE NOT NULL,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(employee_id, effective_from)
);

CREATE INDEX IF NOT EXISTS idx_sales_emp_rates_employee
  ON sales_employee_commission_rates(employee_id, effective_from);

-- ─── 3. Spa retail by employee (per-transaction) ──────────────────────────────
-- Source: Cockpit "Retail - Spa" tab (gid 1170650850), Sales Employee column.
-- Mirrors the spa_services_by_employee_daily ETL pattern (month-scoped
-- delete + insert). location_id intentionally nullable + no FK: rows with an
-- unmapped Point of Sales still carry employee attribution.

CREATE TABLE IF NOT EXISTS spa_retail_by_employee_daily (
  id            SERIAL PRIMARY KEY,
  month         DATE NOT NULL,                    -- YYYY-MM-01
  date          DATE NOT NULL,
  location_id   INTEGER,
  employee_name TEXT NOT NULL,
  product_name  TEXT,
  product_brand TEXT,
  amount_ex_vat NUMERIC(12,2) NOT NULL DEFAULT 0,
  synced_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_spa_retail_emp_date  ON spa_retail_by_employee_daily(date);
CREATE INDEX IF NOT EXISTS idx_spa_retail_emp_month ON spa_retail_by_employee_daily(month);
CREATE INDEX IF NOT EXISTS idx_spa_retail_emp_name  ON spa_retail_by_employee_daily(employee_name);

-- ─── RLS ──────────────────────────────────────────────────────────────────────

ALTER TABLE sales_employees                 ENABLE ROW LEVEL SECURITY;
ALTER TABLE sales_employee_commission_rates ENABLE ROW LEVEL SECURITY;
ALTER TABLE spa_retail_by_employee_daily    ENABLE ROW LEVEL SECURITY;

CREATE POLICY "auth_read" ON sales_employees
  FOR SELECT TO authenticated USING (true);
CREATE POLICY "service_all" ON sales_employees
  FOR ALL TO service_role USING (true);

CREATE POLICY "auth_read" ON sales_employee_commission_rates
  FOR SELECT TO authenticated USING (true);
CREATE POLICY "service_all" ON sales_employee_commission_rates
  FOR ALL TO service_role USING (true);

CREATE POLICY "auth_read" ON spa_retail_by_employee_daily
  FOR SELECT TO authenticated USING (true);
CREATE POLICY "service_all" ON spa_retail_by_employee_daily
  FOR ALL TO service_role USING (true);
