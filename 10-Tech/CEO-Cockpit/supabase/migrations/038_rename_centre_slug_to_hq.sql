-- Rename spa_slug 'centre' → 'hq' in salary_supplement_monthly
UPDATE salary_supplement_monthly
SET spa_slug = 'hq'
WHERE spa_slug = 'centre';
