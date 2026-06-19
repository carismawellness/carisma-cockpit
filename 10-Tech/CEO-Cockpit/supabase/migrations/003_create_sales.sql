CREATE TABLE sales_weekly (
  id SERIAL PRIMARY KEY,
  week_start DATE NOT NULL,
  location_id INTEGER NOT NULL REFERENCES locations(id),
  brand_id INTEGER NOT NULL REFERENCES brands(id),
  revenue_ex_vat NUMERIC(12,2),
  revenue_yoy_delta_pct NUMERIC(6,2),
  retail_pct NUMERIC(5,2),
  addon_pct NUMERIC(5,2),
  hotel_capture_pct NUMERIC(5,2),
  etl_synced_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(week_start, location_id)
);

CREATE TABLE sales_by_rep (
  id SERIAL PRIMARY KEY,
  date DATE NOT NULL,
  staff_id INTEGER NOT NULL REFERENCES staff(id),
  brand_id INTEGER NOT NULL REFERENCES brands(id),
  revenue NUMERIC(12,2),
  bookings_count INTEGER,
  deposits_collected NUMERIC(12,2),
  deposit_pct NUMERIC(5,2),
  UNIQUE(date, staff_id)
);

CREATE INDEX idx_sales_weekly_brand ON sales_weekly(brand_id, week_start);
CREATE INDEX idx_sales_by_rep_date ON sales_by_rep(date, brand_id);
