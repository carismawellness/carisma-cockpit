INSERT INTO locations (brand_id, slug, name) VALUES
  ((SELECT id FROM brands WHERE slug = 'spa'), 'inter', 'InterContinental'),
  ((SELECT id FROM brands WHERE slug = 'spa'), 'hugos', 'Hugos'),
  ((SELECT id FROM brands WHERE slug = 'spa'), 'hyatt', 'Hyatt'),
  ((SELECT id FROM brands WHERE slug = 'spa'), 'ramla', 'Ramla Bay'),
  ((SELECT id FROM brands WHERE slug = 'spa'), 'labranda', 'Labranda'),
  ((SELECT id FROM brands WHERE slug = 'spa'), 'odycy', 'Odycy'),
  ((SELECT id FROM brands WHERE slug = 'spa'), 'excelsior', 'Excelsior'),
  ((SELECT id FROM brands WHERE slug = 'spa'), 'novotel', 'Novotel'),
  ((SELECT id FROM brands WHERE slug = 'aesthetics'), 'aesthetics-clinic', 'Aesthetics Clinic'),
  ((SELECT id FROM brands WHERE slug = 'slimming'), 'slimming-clinic', 'Slimming Clinic')
ON CONFLICT (slug) DO NOTHING;
