# Speed-to-Lead — Design

**Date:** 2026-06-18
**Author:** Claude (with Mert)
**Status:** Approved → building

## Problem

We can't yet measure how fast the team responds to inbound leads, because we don't
have phone-call timestamps from the CRM. As a **directional proxy** we use the GHL
opportunity stage log: how long after a lead is created does it first leave the
"New Leads" stage (i.e. an agent touches it).

## Metric definition (locked)

> **Speed-to-lead = business-minutes from lead creation → first move out of "New Leads".**

- **Clock basis:** business hours only — **Mon–Sat, 09:00–19:00 Europe/Malta**.
  Sundays and after-hours don't accrue time. A lead arriving Sat 18:55 answered
  Mon 09:05 = 5 + 5 = **10 business-minutes** (skips Sun + overnight).
- **"First move out of New Leads"** = earliest `ghl_opportunity_stage_events` row
  for that opportunity where `from_stage_normalized = 'New Leads'`.
- **Exactness:**
  - `exact` — the move is recorded in the webhook event log.
  - `approx_backfill` — for leads with no recorded leaving-event (pre-webhook or
    missed), we approximate first-response with `lastStageChangeAt`. This
    **overestimates** for leads that moved stage more than once. Flagged in the UI.
  - `pending` — lead is still in New Leads (not yet responded).
- **Breakdowns:** by **brand**, by **agent** (resolved from GHL `assignedTo`), and
  **distribution buckets**: `<5`, `5–30`, `30–60`, `60–240`, `>240` min, `pending`.
- **Headline aggregate:** **median** (robust to outliers); mean shown secondary.
- **SLA colour-coding:** `<5 min` green · `5–30` amber · `>30` red.

## Architecture — Approach C (per-opportunity fact table + rollup)

```
GHL webhook ──▶ ghl_opportunity_stage_events (exact "left New Leads" events)
GHL webhook ──▶ ghl_opportunities (current state, last_stage_change_at)
GHL /opportunities/search (ETL) ──▶ full lead population incl. historical (approx)
GHL /users/ (ETL) ──▶ assignedTo → agent_name map

           ▼  /api/etl/speed-to-lead  (lib/etl/speed-to-lead.ts)
   compute business_minutes (lib/utils/business-hours.ts)
           ▼
   crm_speed_to_lead   (ONE ROW PER OPPORTUNITY — the fact table)
           ├──▶ rollup: crm_daily.speed_to_lead_{median,mean}_min  (existing cols)
           ▼
   /api/crm/speed-to-lead (GET) → aggregates by brand / agent / bucket on the fly
           ▼
   useSpeedToLead hook → SpeedToLeadSection.tsx on /crm
```

### Why C
Lets us drill into the exact slow leads for coaching (the whole point — "follow up"),
re-slice by brand/agent/bucket without re-running ETL, and cleanly separate exact vs
approximate. Rollup columns keep legacy `crm_daily` readers working.

### Data model
`crm_speed_to_lead` (one row per opportunity):
`ghl_opportunity_id` PK, `brand_id`, `assigned_to`, `agent_name`, `lead_created_at`,
`first_response_at`, `raw_minutes`, `business_minutes`, `bucket`, `source`,
`responded`, `computed_at`. Indexed on `(brand_id, lead_created_at)` and
`(agent_name, lead_created_at)`.

**Deviation from initial sketch:** no separate `speed_to_lead_distribution` table.
Bucket counts are computed on demand by the read API from the fact table — at our
volume (hundreds–low thousands of leads per range) this is fast and avoids a
NULL-in-unique-key rollup table. The `crm_daily` median/mean columns are still
populated for compatibility.

### Business-hours helper
`lib/utils/business-hours.ts` → `businessMinutesBetween(start, end)`. Pure function,
DST-safe (computes Malta open/close boundaries per calendar day via `Intl`
timeZone formatting; never hand-rolls UTC offsets). Unit-tested with `node:test`:
same-day, overnight gap, weekend skip, before-open, after-close, Sunday arrival,
multi-day span, DST-transition day, pending.

## Repo / deploy note
Built into `10-Tech/CEO-Cockpit` only. The old `Tech/CEO-Cockpit` copy is staged for
deletion in an in-progress repo consolidation; the obsolete "edit both paths" rule no
longer applies. Vercel's build `rootDirectory` still points at `Tech/CEO-Cockpit` —
that must be switched to `10-Tech/CEO-Cockpit` (or the consolidation committed) before
this deploys live. Flagged separately.

## Files
- `supabase/migrations/087_crm_speed_to_lead.sql`
- `lib/utils/business-hours.ts` + `business-hours.test.ts`
- `lib/etl/speed-to-lead.ts`
- `app/api/etl/speed-to-lead/route.ts`
- `app/api/crm/speed-to-lead/route.ts`
- `lib/hooks/useSpeedToLead.ts`
- `components/crm/SpeedToLeadSection.tsx` (rewrite of orphan scaffold)
- wire into `app/crm/page.tsx` and `app/api/cron/nightly-refresh/route.ts`
