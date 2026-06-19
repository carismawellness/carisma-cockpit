-- Rename "Hugo's" to "Hugos" in DB rows (UI uses straight "Hugos" without apostrophe)
-- Slug remains 'hugos' — only the human-readable display name changes.
UPDATE locations
   SET name = 'Hugos'
 WHERE slug = 'hugos' AND name = 'Hugo''s';

UPDATE coa_split_rules
   SET name = '100% Hugos'
 WHERE name = '100% Hugo''s';
