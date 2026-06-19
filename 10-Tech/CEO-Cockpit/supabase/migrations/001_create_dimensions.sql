-- Brands
CREATE TABLE brands (
  id SERIAL PRIMARY KEY,
  slug TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL
);

-- Locations
CREATE TABLE locations (
  id SERIAL PRIMARY KEY,
  brand_id INTEGER NOT NULL REFERENCES brands(id),
  slug TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  is_active BOOLEAN NOT NULL DEFAULT true
);

-- Staff
CREATE TABLE staff (
  id SERIAL PRIMARY KEY,
  name TEXT NOT NULL,
  role TEXT NOT NULL,
  location_id INTEGER REFERENCES locations(id),
  brand_id INTEGER NOT NULL REFERENCES brands(id),
  is_active BOOLEAN NOT NULL DEFAULT true
);

CREATE INDEX idx_staff_brand ON staff(brand_id);
CREATE INDEX idx_staff_location ON staff(location_id);
CREATE INDEX idx_locations_brand ON locations(brand_id);
