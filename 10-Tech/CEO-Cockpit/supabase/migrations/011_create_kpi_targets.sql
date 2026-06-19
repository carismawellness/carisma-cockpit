CREATE TABLE kpi_targets (
  id SERIAL PRIMARY KEY,
  department TEXT NOT NULL,
  metric_name TEXT NOT NULL,
  target_value NUMERIC(10,2) NOT NULL,
  comparison TEXT NOT NULL CHECK (comparison IN ('lt', 'gt', 'eq', 'between')),
  brand_id INTEGER REFERENCES brands(id),
  is_active BOOLEAN NOT NULL DEFAULT true,
  UNIQUE(department, metric_name, brand_id)
);
