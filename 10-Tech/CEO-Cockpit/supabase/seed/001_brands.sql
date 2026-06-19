INSERT INTO brands (slug, name) VALUES
  ('spa', 'Carisma Spa & Wellness'),
  ('aesthetics', 'Carisma Aesthetics'),
  ('slimming', 'Carisma Slimming')
ON CONFLICT (slug) DO NOTHING;
