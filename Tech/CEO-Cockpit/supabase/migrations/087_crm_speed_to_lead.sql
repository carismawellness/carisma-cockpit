-- Speed-to-Lead fact table
-- One row per GHL opportunity. Stores the business-hours response time from
-- lead creation to the first move out of the "New Leads" stage (a directional
-- proxy for speed-to-lead, since we don't yet have phone-call timestamps).
--
-- Populated by /api/etl/speed-to-lead (lib/etl/speed-to-lead.ts):
--   • source = 'exact'           → first "left New Leads" event from the webhook log
--   • source = 'approx_backfill' → approximated from lastStageChangeAt (overestimates
--                                   for leads that changed stage more than once)
--   • responded = false          → still in New Leads (business_minutes is NULL)
--
-- See docs/plans/2026-06-18-speed-to-lead-design.md

CREATE TABLE IF NOT EXISTS crm_speed_to_lead (
  ghl_opportunity_id TEXT PRIMARY KEY,
  brand_id           INTEGER NOT NULL REFERENCES brands(id),
  assigned_to        TEXT,                    -- GHL user id (nullable / unassigned)
  agent_name         TEXT,                    -- resolved display name (nullable)
  lead_created_at    TIMESTAMPTZ NOT NULL,    -- = opportunity date_added
  first_response_at  TIMESTAMPTZ,             -- first move out of New Leads (NULL = pending)
  raw_minutes        NUMERIC(10,2),           -- wall-clock minutes (reference)
  business_minutes   NUMERIC(10,2),           -- Mon-Sat 09:00-19:00 Malta  ← headline metric
  bucket             TEXT NOT NULL DEFAULT 'pending'
                       CHECK (bucket IN ('<5','5-30','30-60','60-240','>240','pending')),
  source             TEXT NOT NULL
                       CHECK (source IN ('exact','approx_backfill')),
  responded          BOOLEAN NOT NULL DEFAULT false,
  computed_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS crm_stl_brand_created
  ON crm_speed_to_lead (brand_id, lead_created_at);
CREATE INDEX IF NOT EXISTS crm_stl_agent_created
  ON crm_speed_to_lead (agent_name, lead_created_at);
CREATE INDEX IF NOT EXISTS crm_stl_bucket
  ON crm_speed_to_lead (bucket);

-- crm_daily already has speed_to_lead_median_min / speed_to_lead_mean_min
-- (migration 004). These ALTERs are defensive no-ops if the columns exist.
ALTER TABLE crm_daily ADD COLUMN IF NOT EXISTS speed_to_lead_median_min NUMERIC(8,2);
ALTER TABLE crm_daily ADD COLUMN IF NOT EXISTS speed_to_lead_mean_min   NUMERIC(8,2);
-- Count of leads that have actually responded, per day/brand — so the dashboard
-- can show "median over N responded leads" instead of mixing in pending leads.
ALTER TABLE crm_daily ADD COLUMN IF NOT EXISTS speed_to_lead_responded_count INTEGER;
