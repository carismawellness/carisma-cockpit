# GHL Opportunities Mirror — Plan

**Goal:** Enable period-scoped per-stage funnel metrics on the CRM dashboard. Today the funnel can only show a current snapshot (3,216 Booking Won regardless of date range) because GHL's `/opportunities/search` REST API has no date filter and POST advanced search returns 0 for our API-key auth (see `.claude memory: reference_ghl_opportunities_search.md`). The fix is to mirror GHL opportunity events into Supabase and query Supabase by date.

**Outcome:** Selecting "May 2026" in the date range shows e.g. *"New Leads created in May: 153, of which 1,247 are now Booking Won"* — a true cohort funnel.

---

## 1. Supabase schema

Two tables, both keyed on `(brand_id, ghl_opportunity_id)`:

### `ghl_opportunities`
One row per opportunity, current state.

```sql
CREATE TABLE ghl_opportunities (
  ghl_opportunity_id   TEXT PRIMARY KEY,
  brand_id             INTEGER NOT NULL REFERENCES brands(id),
  ghl_location_id      TEXT NOT NULL,
  ghl_pipeline_id      TEXT NOT NULL,
  ghl_pipeline_stage_id TEXT NOT NULL,
  stage_normalized     TEXT NOT NULL,         -- "New Leads", "Booking Won", etc.
  status               TEXT,                  -- open / won / lost / abandoned
  contact_id           TEXT,
  assigned_to          TEXT,
  monetary_value       NUMERIC(12,2),
  date_added           TIMESTAMPTZ NOT NULL,  -- opportunity creation
  date_updated         TIMESTAMPTZ NOT NULL,
  last_stage_change_at TIMESTAMPTZ,           -- when stage_normalized last changed
  raw                  JSONB,                 -- full webhook payload for debugging
  synced_at            TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX ON ghl_opportunities (brand_id, date_added);
CREATE INDEX ON ghl_opportunities (brand_id, last_stage_change_at);
CREATE INDEX ON ghl_opportunities (brand_id, stage_normalized);
```

### `ghl_opportunity_stage_events`
Append-only log of every stage transition. Enables true "Bookings won in May" (flow) metric vs the cohort metric above.

```sql
CREATE TABLE ghl_opportunity_stage_events (
  id                   BIGSERIAL PRIMARY KEY,
  ghl_opportunity_id   TEXT NOT NULL,
  brand_id             INTEGER NOT NULL REFERENCES brands(id),
  from_stage_normalized TEXT,
  to_stage_normalized  TEXT NOT NULL,
  changed_at           TIMESTAMPTZ NOT NULL,
  source               TEXT NOT NULL,  -- "webhook" | "backfill"
  raw                  JSONB
);
CREATE INDEX ON ghl_opportunity_stage_events (brand_id, to_stage_normalized, changed_at);
```

Migration goes in `Tech/CEO-Cockpit/supabase/migrations/071_ghl_opportunities_mirror.sql`.

---

## 2. Webhook handler

`Tech/CEO-Cockpit/app/api/webhooks/ghl/opportunities/route.ts`

Subscribes per brand to four GHL webhook events:
- `OpportunityCreate` → INSERT into `ghl_opportunities` + log "create" event
- `OpportunityStageUpdate` → UPDATE stage + INSERT stage event row
- `OpportunityStatusUpdate` → UPDATE status
- `OpportunityDelete` → soft-delete (set status="deleted")

Each brand gets its own webhook URL (or one URL with brand inferred from `locationId`). Use the same `stripEmoji`/`matchStage` normalization the API route already uses so `stage_normalized` matches the funnel UI's `STAGE_ORDER`.

**Subscription**: register webhooks via the existing GHL setup (already happening for the spa CRM task engine on Railway — pattern in `project_ghl_crm_spa.md`). Likely 1 hour of config across the 3 GHL accounts.

---

## 3. Initial backfill

`Tech/CEO-Cockpit/Tools/backfill-ghl-opportunities.ts`

For each brand: paginate `GET /opportunities/search?location_id=X&pipeline_id=Y&limit=100&startAfterId=...` until exhausted. For Aesthetics that's ~140 pages of 100 records each (13,847 rows). Spa+Slimming combined another ~50 pages. Total: ~190 API calls per backfill run, well under any quota.

Run once at deploy, then again any time a webhook drops (reconciliation).

For each opportunity, also generate a synthetic stage_event with `source="backfill"` and `changed_at = date_added` so the flow query has at least one row per opp.

---

## 4. New API route

`Tech/CEO-Cockpit/app/api/crm/ghl-funnel/route.ts` (replace the existing snapshot-only implementation)

Two query modes via `mode` param:

- **`mode=cohort`** (default): `SELECT brand_id, stage_normalized, count(*) FROM ghl_opportunities WHERE date_added BETWEEN dateFrom AND dateTo GROUP BY brand_id, stage_normalized` — "Of leads acquired in this period, where are they now?"
- **`mode=flow`**: `SELECT brand_id, to_stage_normalized AS stage_normalized, count(*) FROM ghl_opportunity_stage_events WHERE changed_at BETWEEN dateFrom AND dateTo GROUP BY brand_id, to_stage_normalized` — "How many opportunities entered each stage in this period?"

Same response shape as today (`{brands: {spa: {…}, aesthetics: {…}, slimming: {…}}}`) so `PipelineFunnel.tsx` works unchanged.

---

## 5. UI updates

`Tech/CEO-Cockpit/components/crm/PipelineFunnel.tsx`

- Add a small "Cohort / Flow" toggle in the header
- Update subtitle to reflect the active mode:
  - Cohort: "Leads acquired in selected period · by current stage"
  - Flow: "Stage transitions in selected period"
- Remove the "(date filter not yet supported)" hedge

---

## 6. Reconciliation cron

`Tech/CEO-Cockpit/app/api/cron/ghl-opportunities-reconcile/route.ts`

Once nightly: for each brand, hit GET search with `limit=100` for the most recent N pages (paginated until `dateAdded < lastSyncedAt`) and UPSERT into `ghl_opportunities`. Catches missed webhooks. Cheap (~5 API calls/brand/night unless a backlog accumulates).

---

## Sizing

| Task | Effort |
|---|---|
| 1. Migration | 20 min |
| 2. Webhook handler | 2-3 hrs (4 event types × 3 brands, includes idempotency) |
| 3. Backfill tool + first run | 2 hrs |
| 4. New API route (cohort + flow) | 1 hr |
| 5. UI toggle | 30 min |
| 6. Reconciliation cron | 1 hr |
| GHL webhook config (3 accounts) | 1 hr |
| **Total** | **~1 working day** |

---

## Open decisions

1. **Webhook auth**: GHL signs webhooks with HMAC. Verify signature in the handler (already done for spa CRM webhook server — copy that pattern).
2. **Backfill freshness boundary**: backfill creates stage events at `changed_at = date_added`. So pre-mirror data only gives a cohort funnel correctly — the flow funnel is only correct for events that happened AFTER backfill. Document this in the UI tooltip (e.g. "Flow metrics available from <backfill date> onwards").
3. **Multi-pipeline**: today only the "Call Pipeline" is funneled. Mirror table stores all pipelines for future expansion; API route filters to the call pipeline.

---

## Next step

Approve the plan → I'll start with the migration + backfill (low-risk, no webhooks needed yet) so we can verify the schema before touching live webhook config.
