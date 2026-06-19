CREATE TABLE ebitda_monthly (
  id SERIAL PRIMARY KEY,
  month DATE NOT NULL,
  brand_id INTEGER NOT NULL REFERENCES brands(id),
  revenue NUMERIC(12,2),
  cogs NUMERIC(12,2),
  gross_profit NUMERIC(12,2),
  opex NUMERIC(12,2),
  ebitda NUMERIC(12,2),
  ebitda_margin_pct NUMERIC(5,2),
  UNIQUE(month, brand_id)
);

CREATE TABLE budget_vs_actual (
  id SERIAL PRIMARY KEY,
  month DATE NOT NULL,
  brand_id INTEGER NOT NULL REFERENCES brands(id),
  department TEXT NOT NULL,
  budgeted NUMERIC(12,2),
  actual NUMERIC(12,2),
  variance_pct NUMERIC(6,2),
  UNIQUE(month, brand_id, department)
);

CREATE INDEX idx_ebitda ON ebitda_monthly(brand_id, month);
CREATE INDEX idx_budget ON budget_vs_actual(brand_id, month);
