# CRM Master Dashboard Rebuild

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Rebuild the CRM Master dashboard with real data structure, comprehensive KPIs, and modular components that pull from Supabase tables.

**Architecture:** Extend existing Supabase CRM schema with missing columns (sales, dials, deposits, missed %, team type). Build modular React components per dashboard section, composed in the master page. All components use the existing `useKPIData` hook + `useLookups` for brand filtering. Date range and brand filter from `DashboardShell` flow through to all sections.

**Tech Stack:** Next.js (app router), React, Recharts, Supabase, TanStack Query, Tailwind CSS, shadcn/ui

---

## Data Model

### Existing Supabase Tables
- `crm_daily` — daily brand-level metrics (leads, STL, conversion, calls, bookings)
- `crm_by_rep` — daily per-rep metrics (leads, calls, bookings, conversion, STL)
- `speed_to_lead_distribution` — STL time buckets

### New/Extended Schema Needed

**Extend `crm_daily`:**
```sql
ALTER TABLE crm_daily ADD COLUMN IF NOT EXISTS total_sales NUMERIC(10,2);
ALTER TABLE crm_daily ADD COLUMN IF NOT EXISTS deposit_pct NUMERIC(5,2);
ALTER TABLE crm_daily ADD COLUMN IF NOT EXISTS avg_daily_sales NUMERIC(10,2);
ALTER TABLE crm_daily ADD COLUMN IF NOT EXISTS unreplied_crm INTEGER;
ALTER TABLE crm_daily ADD COLUMN IF NOT EXISTS unreplied_whatsapp INTEGER;
ALTER TABLE crm_daily ADD COLUMN IF NOT EXISTS unreplied_email INTEGER;
ALTER TABLE crm_daily ADD COLUMN IF NOT EXISTS unworked_leads INTEGER;
```

**Extend `crm_by_rep`:**
```sql
ALTER TABLE crm_by_rep ADD COLUMN IF NOT EXISTS total_sales NUMERIC(10,2);
ALTER TABLE crm_by_rep ADD COLUMN IF NOT EXISTS dials INTEGER;
ALTER TABLE crm_by_rep ADD COLUMN IF NOT EXISTS bookings INTEGER;
ALTER TABLE crm_by_rep ADD COLUMN IF NOT EXISTS deposit_pct NUMERIC(5,2);
ALTER TABLE crm_by_rep ADD COLUMN IF NOT EXISTS missed_pct NUMERIC(5,2);
ALTER TABLE crm_by_rep ADD COLUMN IF NOT EXISTS team_type TEXT; -- 'sdr' or 'chat'
ALTER TABLE crm_by_rep ADD COLUMN IF NOT EXISTS conversations INTEGER;
```

**New table `crm_booking_mix`:**
```sql
CREATE TABLE crm_booking_mix (
  id SERIAL PRIMARY KEY,
  date DATE NOT NULL,
  brand_id INTEGER NOT NULL REFERENCES brands(id),
  treatment_name TEXT NOT NULL,
  count INTEGER NOT NULL DEFAULT 0,
  UNIQUE(date, brand_id, treatment_name)
);
CREATE INDEX idx_booking_mix ON crm_booking_mix(date, brand_id);
```

**New table `crm_lead_reconciliation`:**
```sql
CREATE TABLE crm_lead_reconciliation (
  id SERIAL PRIMARY KEY,
  date DATE NOT NULL,
  brand_id INTEGER NOT NULL REFERENCES brands(id),
  leads_meta INTEGER NOT NULL DEFAULT 0,
  leads_crm INTEGER NOT NULL DEFAULT 0,
  delta INTEGER GENERATED ALWAYS AS (leads_meta - leads_crm) STORED,
  UNIQUE(date, brand_id)
);
CREATE INDEX idx_lead_recon ON crm_lead_reconciliation(date, brand_id);
```

---

## Component Architecture

All components receive `dateFrom`, `dateTo`, `brandFilter` props from `DashboardShell`. Each uses `useKPIData` to fetch from Supabase.

```
app/crm/page.tsx (Master)
├── components/crm/CRMKPICards.tsx          — 6 top-level KPI cards
├── components/crm/SalesPerformance.tsx     — Sales by brand (3 cards)
├── components/crm/TeamSplit.tsx            — SDR vs Chat breakdown
├── components/crm/EmployeeTable.tsx        — Per-employee detail table
├── components/crm/MessageQueueHealth.tsx   — Unreplied messages (3 brand cards)
├── components/crm/BookingMix.tsx           — Pie charts (Spa + Aes + Slimming)
├── components/crm/RepLeaderboard.tsx       — Sales leaderboard
├── components/crm/LeadReconciliation.tsx   — CRM vs Meta leads check
└── components/crm/STLByBrand.tsx           — Speed to lead summary by brand
```

---

## Tasks

### Task 1: Database Migration

**Files:**
- Create: `supabase/migrations/020_extend_crm_for_dashboard.sql`

Add all schema extensions listed above. This is the foundation everything depends on.

### Task 2: CRM Types

**Files:**
- Create: `lib/types/crm.ts`

TypeScript interfaces for all CRM data rows matching Supabase schema:
- `CrmDailyRow`, `CrmByRepRow`, `BookingMixRow`, `LeadReconRow`

### Task 3: CRM KPI Cards Component

**Files:**
- Create: `components/crm/CRMKPICards.tsx`

6 cards: Total Leads, Unworked Leads, Unreplied Messages, Total Sales, Total Bookings, Deposit %

### Task 4: Sales Performance Component

**Files:**
- Create: `components/crm/SalesPerformance.tsx`

3 brand cards (Spa/Aes/Slim) showing: Total Sales, Daily Average, Top Rep, Bookings

### Task 5: Team Split Component

**Files:**
- Create: `components/crm/TeamSplit.tsx`

Side-by-side SDR vs Chat cards with: Sales, Dials/Conversations, Bookings, Conversion %, Deposit %, Missed %

### Task 6: Employee Table Component

**Files:**
- Create: `components/crm/EmployeeTable.tsx`

DataTable with columns: Name, Brand, Role, Sales, Dials, Bookings, Conversion %, Deposit %, Missed Chats %. Sortable. Click-to-expand for daily breakdown.

### Task 7: Message Queue Health Component

**Files:**
- Create: `components/crm/MessageQueueHealth.tsx`

3 brand cards showing CRM Unreplied, WhatsApp Unread, Email Unread with health coloring.

### Task 8: Booking Mix Component

**Files:**
- Create: `components/crm/BookingMix.tsx`

3 pie charts side by side: Spa, Aesthetics, Slimming treatment booking breakdown.

### Task 9: Rep Leaderboard Component

**Files:**
- Create: `components/crm/RepLeaderboard.tsx`

DataTable: Rep, Total Sales, Avg Daily, Bookings, Sales/Booking. Sorted by total sales desc. No brand column.

### Task 10: Lead Reconciliation Component

**Files:**
- Create: `components/crm/LeadReconciliation.tsx`

Table + bar chart comparing CRM leads vs Meta leads per brand per day. Highlights deltas > 0 in red.

### Task 11: STL By Brand Component

**Files:**
- Create: `components/crm/STLByBrand.tsx`

3 brand cards with median STL, grade, progress bar. Daily trend line chart by brand.

### Task 12: Master Page Assembly

**Files:**
- Rewrite: `app/crm/page.tsx`

Compose all components in order. Wire `DashboardShell` props through. Remove all old mock data.

### Task 13: Clean Up Old Pages

**Files:**
- Rewrite: `app/crm/team-kpis/page.tsx` — Import EmployeeTable + TeamSplit components

---

## Parallelization Strategy

These tasks can run in parallel across 3 agents:

**Agent A (Data + Infrastructure):** Tasks 1, 2
**Agent B (Core Dashboard Components):** Tasks 3, 4, 5, 6, 7
**Agent C (Visualization Components):** Tasks 8, 9, 10, 11

After all agents finish: Task 12, 13 (page assembly)

---

## Key Patterns to Follow

**Data fetching:**
```tsx
const { data, loading } = useKPIData<CrmDailyRow>({
  table: "crm_daily",
  dateFrom, dateTo, brandFilter,
});
```

**Brand colors:**
```tsx
import { chartColors } from "@/lib/charts/config";
// chartColors.spa, chartColors.aesthetics, chartColors.slimming
```

**Component signature:**
```tsx
export function ComponentName({
  dateFrom, dateTo, brandFilter,
}: {
  dateFrom: Date; dateTo: Date; brandFilter: string | null;
}) { ... }
```

**Currency formatting:** `formatCurrency(value)` from `@/lib/charts/config`
**Percent formatting:** `formatPercent(value)` from `@/lib/charts/config`
