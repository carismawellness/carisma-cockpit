CREATE TABLE IF NOT EXISTS message_queue (
  id SERIAL PRIMARY KEY,
  snapshot_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  brand_id INTEGER NOT NULL,
  unreplied_whatsapp INTEGER DEFAULT 0,
  unreplied_email INTEGER DEFAULT 0,
  unreplied_crm INTEGER DEFAULT 0,
  oldest_unreplied_min INTEGER
);
