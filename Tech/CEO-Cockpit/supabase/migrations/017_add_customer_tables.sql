-- Customer profiles (future: populated from Fresha/Lapis POS)
CREATE TABLE IF NOT EXISTS customers (
  id SERIAL PRIMARY KEY,
  external_id TEXT,
  name TEXT,
  email TEXT,
  first_visit_date DATE,
  last_visit_date DATE,
  total_spend NUMERIC(12,2) DEFAULT 0,
  visit_count INTEGER DEFAULT 0,
  primary_brand_id INTEGER REFERENCES brands(id),
  primary_location_id INTEGER REFERENCES locations(id),
  referral_source TEXT,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- Appointment records (future: synced from Fresha/Lapis)
CREATE TABLE IF NOT EXISTS appointments (
  id SERIAL PRIMARY KEY,
  customer_id INTEGER REFERENCES customers(id),
  location_id INTEGER REFERENCES locations(id),
  brand_id INTEGER REFERENCES brands(id),
  staff_id INTEGER REFERENCES staff(id),
  scheduled_at TIMESTAMPTZ NOT NULL,
  status TEXT DEFAULT 'booked' CHECK (status IN ('booked', 'attended', 'no_show', 'cancelled')),
  treatment_type TEXT,
  duration_min INTEGER,
  revenue NUMERIC(10,2) DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- RLS
ALTER TABLE customers ENABLE ROW LEVEL SECURITY;
ALTER TABLE appointments ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Authenticated read customers" ON customers FOR SELECT TO authenticated USING (true);
CREATE POLICY "Authenticated read appointments" ON appointments FOR SELECT TO authenticated USING (true);
CREATE POLICY "Service write customers" ON customers FOR ALL TO service_role USING (true);
CREATE POLICY "Service write appointments" ON appointments FOR ALL TO service_role USING (true);
