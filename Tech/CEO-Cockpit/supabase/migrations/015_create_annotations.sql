CREATE TABLE IF NOT EXISTS annotations (
  id BIGSERIAL PRIMARY KEY,
  user_id UUID REFERENCES auth.users(id),
  date DATE NOT NULL,
  page TEXT NOT NULL,
  title TEXT NOT NULL,
  note TEXT,
  color TEXT DEFAULT 'gold',
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_annotations_date ON annotations(date);
CREATE INDEX IF NOT EXISTS idx_annotations_page ON annotations(page);

ALTER TABLE annotations ENABLE ROW LEVEL SECURITY;
CREATE POLICY "annotations_read_all" ON annotations FOR SELECT USING (true);
CREATE POLICY "annotations_insert_own" ON annotations FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "annotations_delete_own" ON annotations FOR DELETE USING (auth.uid() = user_id);
