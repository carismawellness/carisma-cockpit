-- Escalation log for Speed to Lead system
-- Tracks every escalation event across all 3 brands

CREATE TABLE IF NOT EXISTS escalation_log (
    id          BIGSERIAL PRIMARY KEY,
    brand_id    INT NOT NULL REFERENCES brands(id),
    lead_id     TEXT NOT NULL,
    lead_name   TEXT,
    lead_phone  TEXT,
    campaign    TEXT,
    assigned_rep TEXT,
    tier        INT NOT NULL CHECK (tier BETWEEN 1 AND 4),
    minutes_elapsed NUMERIC(8,1),
    escalated_at TIMESTAMPTZ DEFAULT now(),
    channel     TEXT NOT NULL CHECK (channel IN ('email', 'whatsapp', 'whatsapp_failed'))
);

CREATE INDEX IF NOT EXISTS idx_escalation_log_brand_date
    ON escalation_log (brand_id, escalated_at);

CREATE INDEX IF NOT EXISTS idx_escalation_log_lead
    ON escalation_log (lead_id);

COMMENT ON TABLE escalation_log IS 'Speed to Lead escalation events. Tier 1=email at 15min, Tier 2=WA at 30min, Tier 3=WA urgent at 60min, Tier 4=WA critical at 120min.';
