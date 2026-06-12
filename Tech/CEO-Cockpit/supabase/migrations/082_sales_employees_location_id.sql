-- Add location_id to sales_employees so employee dashboards can show
-- location-scoped data (Google Reviews, etc.).
-- location_id maps to the spa_locations / hotel HOTEL_SLUG_MAP locId values.

ALTER TABLE sales_employees
  ADD COLUMN IF NOT EXISTS location_id INTEGER;

-- Assign known employees to their locations:
-- Riviera = 5, Inter = 1, Hugos = 2, Hyatt = 3, Ramla = 4, Odycy = 6, Excelsior = 7, Novotel = 8
UPDATE sales_employees SET location_id = 5 WHERE slug = 'blagojche-damevski';
