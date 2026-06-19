-- SUPERSEDED by 072_operations_live.sql — do not apply.
CREATE TABLE IF NOT EXISTS google_reviews (
  id SERIAL PRIMARY KEY,
  date DATE NOT NULL,
  location_id INTEGER NOT NULL,
  brand_id INTEGER NOT NULL,
  total_reviews INTEGER,
  avg_rating NUMERIC(3,2),
  new_reviews_count INTEGER DEFAULT 0,
  five_star INTEGER DEFAULT 0,
  four_star INTEGER DEFAULT 0,
  three_star INTEGER DEFAULT 0,
  two_star INTEGER DEFAULT 0,
  one_star INTEGER DEFAULT 0,
  UNIQUE(date, location_id)
);
