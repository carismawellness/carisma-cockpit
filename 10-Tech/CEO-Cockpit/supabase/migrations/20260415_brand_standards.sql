-- Brand Standards table for Facility, Front Desk, and Mystery Guest checklists
CREATE TABLE IF NOT EXISTS brand_standards (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  month DATE NOT NULL,
  standard_type TEXT NOT NULL CHECK (standard_type IN ('facility', 'front_desk', 'mystery_guest')),
  category TEXT NOT NULL,
  item TEXT NOT NULL,
  location TEXT NOT NULL,
  result BOOLEAN NOT NULL,
  created_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(month, standard_type, item, location)
);

CREATE INDEX IF NOT EXISTS idx_brand_standards_month ON brand_standards(month);
CREATE INDEX IF NOT EXISTS idx_brand_standards_type ON brand_standards(standard_type);
CREATE INDEX IF NOT EXISTS idx_brand_standards_location ON brand_standards(location);

-- RLS: allow authenticated reads
ALTER TABLE brand_standards ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Allow authenticated read" ON brand_standards FOR SELECT TO authenticated USING (true);
