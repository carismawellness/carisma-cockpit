CREATE TABLE operations_weekly (
  id SERIAL PRIMARY KEY,
  week_start DATE NOT NULL,
  location_id INTEGER NOT NULL REFERENCES locations(id),
  brand_id INTEGER NOT NULL REFERENCES brands(id),
  google_reviews_count INTEGER,
  google_reviews_avg NUMERIC(3,2),
  complaints_count INTEGER DEFAULT 0,
  UNIQUE(week_start, location_id)
);

CREATE TABLE consult_funnel (
  id SERIAL PRIMARY KEY,
  week_start DATE NOT NULL,
  brand_id INTEGER NOT NULL REFERENCES brands(id),
  consults_booked INTEGER,
  consults_attended INTEGER,
  showup_pct NUMERIC(5,2),
  conversions INTEGER,
  conversion_pct NUMERIC(5,2),
  aov NUMERIC(8,2),
  course_conversions INTEGER,
  course_conversion_pct NUMERIC(5,2),
  UNIQUE(week_start, brand_id)
);

CREATE INDEX idx_ops_weekly ON operations_weekly(brand_id, week_start);
CREATE INDEX idx_consult ON consult_funnel(brand_id, week_start);
