CREATE TABLE hr_weekly (
  id SERIAL PRIMARY KEY,
  week_start DATE NOT NULL,
  location_id INTEGER NOT NULL REFERENCES locations(id),
  brand_id INTEGER NOT NULL REFERENCES brands(id),
  total_salary_cost NUMERIC(12,2),
  revenue NUMERIC(12,2),
  hc_pct NUMERIC(5,2),
  utilization_pct NUMERIC(5,2),
  headcount INTEGER,
  joiners INTEGER DEFAULT 0,
  leavers INTEGER DEFAULT 0,
  UNIQUE(week_start, location_id)
);

CREATE TABLE we360_daily (
  id SERIAL PRIMARY KEY,
  date DATE NOT NULL,
  staff_id INTEGER NOT NULL REFERENCES staff(id),
  online_time_min INTEGER,
  active_time_min INTEGER,
  idle_time_min INTEGER,
  productive_time_min INTEGER,
  unproductive_time_min INTEGER,
  neutral_time_min INTEGER,
  email_time_min INTEGER,
  productivity_pct NUMERIC(5,2),
  UNIQUE(date, staff_id)
);

CREATE TABLE therapist_utilization (
  id SERIAL PRIMARY KEY,
  week_start DATE NOT NULL,
  staff_id INTEGER NOT NULL REFERENCES staff(id),
  location_id INTEGER NOT NULL REFERENCES locations(id),
  available_hours NUMERIC(6,2),
  booked_hours NUMERIC(6,2),
  utilization_pct NUMERIC(5,2),
  bookings_count INTEGER,
  UNIQUE(week_start, staff_id)
);

CREATE INDEX idx_hr_weekly ON hr_weekly(brand_id, week_start);
CREATE INDEX idx_we360 ON we360_daily(date, staff_id);
CREATE INDEX idx_therapist_util ON therapist_utilization(week_start, staff_id);
