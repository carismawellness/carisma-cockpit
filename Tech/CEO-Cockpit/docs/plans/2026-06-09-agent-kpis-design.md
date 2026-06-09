# Agent KPIs — Design Doc
**Date:** 2026-06-09  
**Status:** Approved

## Problem

The CRM Individual KPIs page shows all 12 agents but provides no way to drill into a specific agent's full history. The nav label "Individual KPIs" is non-descriptive. Some agents show €0 because the ETL runs nightly with no manual trigger from the UI.

## Solution: Approach C

Three coordinated changes: nav rename + nested agent sub-pages + Re-Sync button.

---

## 1. Navigation

**File:** `lib/constants/departments.ts`

Rename `crm-individual` label from "Individual KPIs" → "Agent KPIs".

Add 12 `SubSubItem` entries as children of `crm-individual` (one per agent slug), each pointing to `/crm/individual/[slug]`. The `SubSubItem` interface and `SubNavItem` sidebar renderer already support this — no sidebar code changes needed.

Agent order (matches ETL + leaderboard sort): abid, rana, nathalia, adeel, km, vj, dorianne, juliana, anni, nicci, april, queenee.

---

## 2. Agent KPIs Leaderboard (`/crm/individual`)

**File:** `app/crm/individual/page.tsx`

Changes:
- Rename page title from "Individual KPIs" → "Agent KPIs"
- Add **Re-Sync button** that calls `POST /api/etl/crm-agents` and shows a spinner while running (same pattern as Spa page's `triggerSync`)
- Add **last-synced badge** reading `max(etl_synced_at)` from Supabase `crm_agent_daily`
- Make leaderboard cards **clickable links** to `/crm/individual/[slug]`

**File:** `components/crm/AgentLeaderboardCards.tsx`

Wrap each card in a `<Link href="/crm/individual/[agent.slug]">`. Add subtle hover state (ring/shadow) to signal interactivity.

---

## 3. Per-Agent Page (`/crm/individual/[slug]`)

**New file:** `app/crm/individual/[slug]/page.tsx`

Data strategy: call `useCrmAgents(dateFrom, dateTo)` (already cached by React Query — no new API needed), then filter by slug. If slug is unknown, redirect to `/crm/individual`.

Layout:
```
[← Agent KPIs]  Agent Name                  [Google Sheet ↗]
Date range · Source: CRM Master

[ Total Sales ]  [ Conv Rate vs 25% ]  [ Deposit % vs 70% ]  [ AOV ]  [ Active Days ]  [ Total Messages ]

[── Daily Sales & Conversion Trend (full-width composed chart) ──]

[── Channel Breakdown: LC / CRM / Other stacked bar by day ──]
```

**New file:** `components/crm/AgentDetailPanel.tsx`

Extract the chart + KPI cards logic from `AgentDetailTabs.tsx` into a shared `AgentDetailPanel` component. Both `AgentDetailTabs` (tab view on leaderboard) and the per-agent page use it.

---

## 4. ETL Robustness

No schema changes needed — `crm_agent_daily` already has `etl_synced_at TIMESTAMPTZ DEFAULT now()`.

The Re-Sync button on the leaderboard page calls `POST /api/etl/crm-agents` directly. A new lightweight API route `/api/crm/sync-status` (GET) returns `{ last_synced: ISO_STRING | null }` by querying `SELECT max(etl_synced_at) FROM crm_agent_daily`.

---

## Files Changed

| File | Change |
|------|--------|
| `lib/constants/departments.ts` | Add 12 SubSubItems under crm-individual, rename label |
| `app/crm/individual/page.tsx` | Rename header, add Re-Sync + last-synced |
| `components/crm/AgentLeaderboardCards.tsx` | Clickable card links |
| `components/crm/AgentDetailPanel.tsx` | New — extracted from AgentDetailTabs |
| `components/crm/AgentDetailTabs.tsx` | Use AgentDetailPanel, no logic change |
| `app/crm/individual/[slug]/page.tsx` | New per-agent page |
| `app/api/crm/sync-status/route.ts` | New GET route for last-synced timestamp |

## Files NOT Changed

- `app/api/etl/crm-agents/route.ts` — ETL logic is correct as-is
- `app/api/crm/individual/route.ts` — API is correct as-is
- `lib/hooks/useCrmAgents.ts` — hook is correct as-is
- `supabase/migrations/` — no schema changes needed
- `components/layout/Sidebar.tsx` — already supports SubSubItem rendering
