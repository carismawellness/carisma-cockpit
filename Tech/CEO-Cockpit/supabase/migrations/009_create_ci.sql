CREATE TYPE alert_severity AS ENUM ('info', 'warning', 'critical');
CREATE TYPE alert_status AS ENUM ('pending', 'emailed', 'approved', 'executed', 'dismissed');

CREATE TABLE ci_alerts (
  id SERIAL PRIMARY KEY,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  department TEXT NOT NULL,
  brand_id INTEGER REFERENCES brands(id),
  severity alert_severity NOT NULL,
  title TEXT NOT NULL,
  description TEXT NOT NULL,
  recommendation TEXT NOT NULL,
  status alert_status NOT NULL DEFAULT 'pending',
  approved_at TIMESTAMPTZ,
  executed_at TIMESTAMPTZ,
  action_payload JSONB
);

CREATE TABLE ci_chat_history (
  id SERIAL PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES profiles(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  role TEXT NOT NULL CHECK (role IN ('user', 'assistant')),
  message TEXT NOT NULL,
  sql_query TEXT,
  context JSONB
);

CREATE INDEX idx_ci_alerts_status ON ci_alerts(status, created_at DESC);
CREATE INDEX idx_ci_alerts_dept ON ci_alerts(department, created_at DESC);
CREATE INDEX idx_ci_chat ON ci_chat_history(user_id, created_at DESC);
