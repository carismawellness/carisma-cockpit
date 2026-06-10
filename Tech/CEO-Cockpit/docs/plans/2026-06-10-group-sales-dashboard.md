# Group Sales Dashboard Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Replace the `/sales` redirect with a real nested group sales dashboard — KPI summary at top, brand/location breakdown in the middle, 13-month longitudinal chart with same-period-last-year always visible at the bottom.

**Architecture:** A single server-side API route (`/api/sales/group`) queries all three Supabase tables (spa_revenue_monthly, aesthetics_sales_daily, slimming_sales_daily) and returns both the period aggregates and a 13-month monthly time series. A lightweight client hook (`useGroupRevenue`) calls this API. The page renders three sections: KPI grid (4 cards), `GroupBrandBreakdown` (bar chart + table, By Brand / By Location toggle), and `GroupLongitudinal` (Monthly Bars / Trend Lines toggle). Clicking a brand KPI card navigates to the existing brand page. Numbers are always consistent because the group API reads the same Supabase tables as the brand-specific hooks.

**Tech Stack:** Next.js App Router, React Query / TanStack Query, Recharts, Shadcn UI (Tabs, Card), Tailwind CSS, Supabase (server client via `createServerSupabaseClient`)

---

## Revenue Formulas (canonical per brand)

| Brand | Formula | Source table |
|-------|---------|--------------|
| Spa | `SUM(services + product_phytomer + product_purest + product_other + wholesale - sales_discount - sales_refund)` | `spa_revenue_monthly` |
| Aesthetics | `SUM(price_ex_vat)` | `aesthetics_sales_daily` |
| Slimming | `SUM(price_ex_vat)` | `slimming_sales_daily` |

> Note: Slimming uses `price_ex_vat` (not `paid`) to match the Slimming sales page which uses `revenue_ex` from `totals`.

## Spa Location Map (IDs 1–8)

```
1 = Inter, 2 = Hugos, 3 = Hyatt, 4 = Ramla,
5 = Riviera, 6 = Odycy, 7 = Excelsior, 8 = Novotel
Colors in useSpaRevenue.ts → SPA_LOCATION_META
```

## Brand Colors

| Brand | Color |
|-------|-------|
| Spa | `#8C7A5A` |
| Aesthetics | `#6366f1` |
| Slimming | `#3D6B3D` |

---

## Task 1: API Route — `/api/sales/group/route.ts`

**Files:**
- Create: `app/api/sales/group/route.ts`

### What it does

Accepts `from` and `to` query params (YYYY-MM-DD). Returns:
1. **`period`** — aggregate revenue for the specified range (spa, aesthetics, slimming, total)
2. **`ly`** — same range shifted back one year (for KPI YoY badges)
3. **`monthly`** — fixed rolling 13-month series (current + LY), independent of date picker — used by the longitudinal chart
4. **`spa_locations`** — per-location breakdown for the selected period (used by "By Location" bar chart)

### Step 1: Create the route file

```typescript
// app/api/sales/group/route.ts
import { NextRequest, NextResponse } from "next/server";
import { createServerSupabaseClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

// Spa location display names (mirrors SPA_LOCATION_META in useSpaRevenue.ts)
const SPA_LOC_META: Record<number, { name: string; color: string }> = {
  1: { name: "Inter",     color: "#1B3A4B" },
  2: { name: "Hugos",     color: "#96B2B2" },
  3: { name: "Hyatt",     color: "#B79E61" },
  4: { name: "Ramla",     color: "#8EB093" },
  5: { name: "Riviera",   color: "#E07A5F" },
  6: { name: "Odycy",     color: "#4A90D9" },
  7: { name: "Excelsior", color: "#7C3AED" },
  8: { name: "Novotel",   color: "#DC2626" },
};

function toDateStr(d: Date) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function toMonthStr(d: Date) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-01`;
}

// Spa revenue for a date window: returns { total, byLocation }
async function fetchSpaRevenue(
  supabase: Awaited<ReturnType<typeof createServerSupabaseClient>>,
  from: string,
  to: string
) {
  const { data } = await supabase
    .from("spa_revenue_monthly")
    .select("location_id, services, product_phytomer, product_purest, product_other, wholesale, sales_discount, sales_refund")
    .gte("month", from)
    .lte("month", to);

  const rows = data ?? [];
  const locMap = new Map<number, number>();
  let total = 0;

  for (const r of rows) {
    const net = (r.services ?? 0)
      + (r.product_phytomer ?? 0)
      + (r.product_purest ?? 0)
      + (r.product_other ?? 0)
      + (r.wholesale ?? 0)
      - (r.sales_discount ?? 0)
      - (r.sales_refund ?? 0);
    locMap.set(r.location_id, (locMap.get(r.location_id) ?? 0) + net);
    total += net;
  }

  const byLocation = Array.from(locMap.entries())
    .map(([id, revenue]) => ({
      location_id: id,
      name:  SPA_LOC_META[id]?.name  ?? `Location ${id}`,
      color: SPA_LOC_META[id]?.color ?? "#888",
      revenue: Math.round(revenue),
    }))
    .sort((a, b) => b.revenue - a.revenue);

  return { total: Math.round(total), byLocation };
}

// Aesthetics revenue for a date window: returns total (price_ex_vat)
async function fetchAestheticsRevenue(
  supabase: Awaited<ReturnType<typeof createServerSupabaseClient>>,
  fromDateStr: string,
  toDateStr: string
) {
  const fromMonth = fromDateStr.substring(0, 7) + "-01";
  const toMonth   = toDateStr.substring(0, 7)   + "-01";

  const { data } = await supabase
    .from("aesthetics_sales_daily")
    .select("date_of_service, month, price_ex_vat")
    .gte("month", fromMonth)
    .lte("month", toMonth);

  const rows = (data ?? []).filter(
    (r) => !r.date_of_service || (r.date_of_service >= fromDateStr && r.date_of_service <= toDateStr)
  );

  return Math.round(rows.reduce((s: number, r) => s + (r.price_ex_vat ?? 0), 0));
}

// Slimming revenue for a date window: returns total (price_ex_vat)
async function fetchSlimmingRevenue(
  supabase: Awaited<ReturnType<typeof createServerSupabaseClient>>,
  fromDateStr: string,
  toDateStr: string
) {
  const fromMonth = fromDateStr.substring(0, 7) + "-01";
  const toMonth   = toDateStr.substring(0, 7)   + "-01";

  const { data } = await supabase
    .from("slimming_sales_daily")
    .select("date_of_service, month, price_ex_vat")
    .gte("month", fromMonth)
    .lte("month", toMonth);

  const rows = (data ?? []).filter(
    (r) => !r.date_of_service || (r.date_of_service >= fromDateStr && r.date_of_service <= toDateStr)
  );

  return Math.round(rows.reduce((s: number, r) => s + (r.price_ex_vat ?? 0), 0));
}

// Monthly time series: for each of the last 13 months, return spa+aesthetics+slimming for THIS year and LAST year
async function fetchMonthlySeries(
  supabase: Awaited<ReturnType<typeof createServerSupabaseClient>>
) {
  const today = new Date();
  // 13 months ending at current month
  const months: string[] = [];
  for (let i = 12; i >= 0; i--) {
    const d = new Date(today.getFullYear(), today.getMonth() - i, 1);
    months.push(toMonthStr(d));
  }
  // LY equivalent: same 13 months but one year earlier
  const lyMonths = months.map((m) => {
    const d = new Date(m);
    d.setFullYear(d.getFullYear() - 1);
    return toMonthStr(d);
  });

  // Fetch spa monthly (covers both current and LY in one query)
  const allSpaFrom = lyMonths[0];
  const allSpaTo   = months[months.length - 1];

  const { data: spaRows } = await supabase
    .from("spa_revenue_monthly")
    .select("month, location_id, services, product_phytomer, product_purest, product_other, wholesale, sales_discount, sales_refund")
    .gte("month", allSpaFrom)
    .lte("month", allSpaTo);

  const spaByMonth = new Map<string, number>();
  for (const r of spaRows ?? []) {
    const net = (r.services ?? 0) + (r.product_phytomer ?? 0) + (r.product_purest ?? 0)
      + (r.product_other ?? 0) + (r.wholesale ?? 0) - (r.sales_discount ?? 0) - (r.sales_refund ?? 0);
    spaByMonth.set(r.month, (spaByMonth.get(r.month) ?? 0) + net);
  }

  // Fetch aesthetics monthly
  const { data: aesRows } = await supabase
    .from("aesthetics_sales_daily")
    .select("month, price_ex_vat")
    .gte("month", allSpaFrom)
    .lte("month", allSpaTo);

  const aesByMonth = new Map<string, number>();
  for (const r of aesRows ?? []) {
    aesByMonth.set(r.month, (aesByMonth.get(r.month) ?? 0) + (r.price_ex_vat ?? 0));
  }

  // Fetch slimming monthly
  const { data: slimRows } = await supabase
    .from("slimming_sales_daily")
    .select("month, price_ex_vat")
    .gte("month", allSpaFrom)
    .lte("month", allSpaTo);

  const slimByMonth = new Map<string, number>();
  for (const r of slimRows ?? []) {
    slimByMonth.set(r.month, (slimByMonth.get(r.month) ?? 0) + (r.price_ex_vat ?? 0));
  }

  return months.map((m, i) => {
    const lyM = lyMonths[i];
    const spa    = Math.round(spaByMonth.get(m)   ?? 0);
    const aes    = Math.round(aesByMonth.get(m)   ?? 0);
    const slim   = Math.round(slimByMonth.get(m)  ?? 0);
    const spa_ly = Math.round(spaByMonth.get(lyM) ?? 0);
    const aes_ly = Math.round(aesByMonth.get(lyM) ?? 0);
    const slim_ly= Math.round(slimByMonth.get(lyM)?? 0);
    return {
      month:    m,          // YYYY-MM-01 (current year)
      ly_month: lyM,        // YYYY-MM-01 (last year)
      spa,
      aesthetics: aes,
      slimming:   slim,
      total:      spa + aes + slim,
      spa_ly,
      aesthetics_ly: aes_ly,
      slimming_ly:   slim_ly,
      total_ly:      spa_ly + aes_ly + slim_ly,
    };
  });
}

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const fromStr = searchParams.get("from");
  const toStr   = searchParams.get("to");

  if (!fromStr || !toStr) {
    return NextResponse.json({ error: "Missing from/to params" }, { status: 400 });
  }

  const supabase = await createServerSupabaseClient();

  // Derive LY range (same calendar span, one year back)
  const fromDate = new Date(fromStr);
  const toDate   = new Date(toStr);
  const lyFrom   = toDateStr(new Date(fromDate.getFullYear() - 1, fromDate.getMonth(), fromDate.getDate()));
  const lyTo     = toDateStr(new Date(toDate.getFullYear() - 1,   toDate.getMonth(),   toDate.getDate()));

  // Spa months for period filter (gte/lte on the month column)
  const spaFrom = toMonthStr(fromDate);
  const spaTo   = toMonthStr(toDate);
  const spaLyFrom = toMonthStr(new Date(fromDate.getFullYear() - 1, fromDate.getMonth(), 1));
  const spaLyTo   = toMonthStr(new Date(toDate.getFullYear() - 1,   toDate.getMonth(),   1));

  const [spaCurr, spaLY, aesCurr, aesLY, slimCurr, slimLY, monthly] = await Promise.all([
    fetchSpaRevenue(supabase, spaFrom,   spaTo),
    fetchSpaRevenue(supabase, spaLyFrom, spaLyTo),
    fetchAestheticsRevenue(supabase, fromStr, toStr),
    fetchAestheticsRevenue(supabase, lyFrom,  lyTo),
    fetchSlimmingRevenue(supabase, fromStr, toStr),
    fetchSlimmingRevenue(supabase, lyFrom,  lyTo),
    fetchMonthlySeries(supabase),
  ]);

  return NextResponse.json({
    period: {
      spa:        spaCurr.total,
      aesthetics: aesCurr,
      slimming:   slimCurr,
      total:      spaCurr.total + aesCurr + slimCurr,
    },
    ly: {
      spa:        spaLY.total,
      aesthetics: aesLY,
      slimming:   slimLY,
      total:      spaLY.total + aesLY + slimLY,
    },
    spa_locations: spaCurr.byLocation,
    monthly,
  });
}
```

### Step 2: Test the API manually

```bash
curl "http://localhost:3000/api/sales/group?from=2026-01-01&to=2026-05-31"
```

Expected: JSON with `period.total > 0`, `ly.total > 0`, `monthly` array of 13 items, `spa_locations` array of 8 items.

Cross-check: `period.spa` should match the Spa sales page total when the same date range is selected there.

### Step 3: Commit

```bash
git add "app/api/sales/group/route.ts"
git commit -m "feat(sales): group API endpoint — aggregates all 3 brands with YoY + monthly series"
```

---

## Task 2: Client Hook — `useGroupRevenue.ts`

**Files:**
- Create: `lib/hooks/useGroupRevenue.ts`

### Step 1: Create the hook

```typescript
// lib/hooks/useGroupRevenue.ts
"use client";

import { useQuery } from "@tanstack/react-query";

export interface GroupLocationRow {
  location_id: number;
  name:        string;
  color:       string;
  revenue:     number;
}

export interface GroupPeriod {
  spa:        number;
  aesthetics: number;
  slimming:   number;
  total:      number;
}

export interface GroupMonthlyPoint {
  month:         string;  // YYYY-MM-01
  ly_month:      string;
  spa:           number;
  aesthetics:    number;
  slimming:      number;
  total:         number;
  spa_ly:        number;
  aesthetics_ly: number;
  slimming_ly:   number;
  total_ly:      number;
}

export interface UseGroupRevenueResult {
  period:        GroupPeriod;
  ly:            GroupPeriod;
  spa_locations: GroupLocationRow[];
  monthly:       GroupMonthlyPoint[];
  isFetching:    boolean;
}

function toDateStr(d: Date) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

const EMPTY_PERIOD: GroupPeriod = { spa: 0, aesthetics: 0, slimming: 0, total: 0 };

export function useGroupRevenue(dateFrom: Date, dateTo: Date): UseGroupRevenueResult {
  const fromStr = toDateStr(dateFrom);
  const toStr   = toDateStr(dateTo);

  const { data, isFetching } = useQuery({
    queryKey: ["group-revenue", fromStr, toStr],
    queryFn: async () => {
      const qs = new URLSearchParams({ from: fromStr, to: toStr });
      const res = await fetch(`/api/sales/group?${qs}`);
      if (!res.ok) throw new Error("Failed to fetch group revenue");
      return res.json();
    },
    staleTime: 5 * 60 * 1000,   // 5 min — group summary doesn't need real-time
  });

  return {
    period:        data?.period        ?? EMPTY_PERIOD,
    ly:            data?.ly            ?? EMPTY_PERIOD,
    spa_locations: data?.spa_locations ?? [],
    monthly:       data?.monthly       ?? [],
    isFetching,
  };
}
```

### Step 2: Commit

```bash
git add "lib/hooks/useGroupRevenue.ts"
git commit -m "feat(sales): useGroupRevenue hook — calls /api/sales/group"
```

---

## Task 3: Brand Breakdown Component

**Files:**
- Create: `components/sales/GroupBrandBreakdown.tsx`

This component shows: a `By Brand / By Location` tab toggle → a Recharts `BarChart` → a comparison table (This Period / LY / vs LY).

### Step 1: Create the component

```typescript
// components/sales/GroupBrandBreakdown.tsx
"use client";

import { useState, useMemo } from "react";
import { Card } from "@/components/ui/card";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, Cell, Legend,
} from "recharts";
import type { GroupPeriod, GroupLocationRow } from "@/lib/hooks/useGroupRevenue";

const BRAND_COLORS = {
  spa:        "#8C7A5A",
  aesthetics: "#6366f1",
  slimming:   "#3D6B3D",
};

function fmtK(v: number) {
  if (Math.abs(v) >= 1_000_000) return `€${(v / 1_000_000).toFixed(1)}M`;
  if (Math.abs(v) >= 1_000)     return `€${(v / 1_000).toFixed(1)}K`;
  return `€${v.toFixed(0)}`;
}

function yoyBadge(curr: number, ly: number) {
  if (!ly) return null;
  const pct = ((curr - ly) / ly) * 100;
  const sign = pct >= 0 ? "+" : "";
  const cls = pct >= 0 ? "text-emerald-700 bg-emerald-50" : "text-red-600 bg-red-50";
  return (
    <span className={`text-[11px] font-semibold rounded-full px-2 py-0.5 ${cls}`}>
      {sign}{pct.toFixed(1)}%
    </span>
  );
}

interface Props {
  period:        GroupPeriod;
  ly:            GroupPeriod;
  spaLocations:  GroupLocationRow[];
  isFetching:    boolean;
}

export function GroupBrandBreakdown({ period, ly, spaLocations, isFetching }: Props) {
  const [view, setView] = useState<"brand" | "location">("brand");

  // Bar chart data
  const brandData = useMemo(() => [
    { name: "Spa",        revenue: period.spa,        color: BRAND_COLORS.spa },
    { name: "Aesthetics", revenue: period.aesthetics,  color: BRAND_COLORS.aesthetics },
    { name: "Slimming",   revenue: period.slimming,    color: BRAND_COLORS.slimming },
  ], [period]);

  const locationData = useMemo(() => [
    ...spaLocations.map((l) => ({ name: l.name, revenue: l.revenue, color: l.color })),
    { name: "Aesthetics", revenue: period.aesthetics,  color: BRAND_COLORS.aesthetics },
    { name: "Slimming",   revenue: period.slimming,    color: BRAND_COLORS.slimming },
  ], [spaLocations, period]);

  const chartData = view === "brand" ? brandData : locationData;

  // Comparison table rows
  const tableRows = [
    { label: "Spa",        curr: period.spa,        ly_val: ly.spa        },
    { label: "Aesthetics", curr: period.aesthetics,  ly_val: ly.aesthetics  },
    { label: "Slimming",   curr: period.slimming,    ly_val: ly.slimming    },
    { label: "Group Total",curr: period.total,       ly_val: ly.total,    isBold: true },
  ];

  if (isFetching) {
    return (
      <Card className="p-6 h-48 flex items-center justify-center text-sm text-muted-foreground animate-pulse">
        Loading brand breakdown…
      </Card>
    );
  }

  return (
    <Card className="p-4 md:p-6 space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold text-foreground">Revenue by Brand</h3>
        <Tabs value={view} onValueChange={(v) => setView(v as "brand" | "location")}>
          <TabsList className="h-7">
            <TabsTrigger value="brand"    className="text-xs px-3 h-6">By Brand</TabsTrigger>
            <TabsTrigger value="location" className="text-xs px-3 h-6">By Location</TabsTrigger>
          </TabsList>
        </Tabs>
      </div>

      {/* Bar chart */}
      <div className="h-[220px] md:h-[280px]">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={chartData} margin={{ top: 4, right: 8, left: 8, bottom: view === "location" ? 32 : 4 }}>
            <CartesianGrid strokeDasharray="3 3" vertical={false} />
            <XAxis
              dataKey="name"
              tick={{ fontSize: 11 }}
              angle={view === "location" ? -30 : 0}
              textAnchor={view === "location" ? "end" : "middle"}
              interval={0}
            />
            <YAxis tickFormatter={(v) => fmtK(v)} tick={{ fontSize: 11 }} width={56} />
            <Tooltip formatter={(v: number) => fmtK(v)} />
            <Bar dataKey="revenue" barSize={view === "location" ? 28 : 48} radius={[3, 3, 0, 0]}>
              {chartData.map((entry, i) => (
                <Cell key={i} fill={entry.color} />
              ))}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>

      {/* Comparison table */}
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b text-xs text-muted-foreground">
              <th className="text-left py-1.5 pr-4 font-medium">Brand</th>
              <th className="text-right py-1.5 px-4 font-medium">This Period</th>
              <th className="text-right py-1.5 px-4 font-medium">Same Period LY</th>
              <th className="text-right py-1.5 pl-4 font-medium">vs LY</th>
            </tr>
          </thead>
          <tbody>
            {tableRows.map((row) => (
              <tr
                key={row.label}
                className={`border-b last:border-0 ${row.isBold ? "font-semibold bg-muted/30" : ""}`}
              >
                <td className="py-2 pr-4">{row.label}</td>
                <td className="py-2 px-4 text-right tabular-nums">{fmtK(row.curr)}</td>
                <td className="py-2 px-4 text-right tabular-nums text-muted-foreground">{fmtK(row.ly_val)}</td>
                <td className="py-2 pl-4 text-right">{yoyBadge(row.curr, row.ly_val)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Card>
  );
}
```

### Step 2: Commit

```bash
git add "components/sales/GroupBrandBreakdown.tsx"
git commit -m "feat(sales): GroupBrandBreakdown — bar chart + YoY table with By Brand/Location toggle"
```

---

## Task 4: Longitudinal Component

**Files:**
- Create: `components/sales/GroupLongitudinal.tsx`

Two views toggled by Tabs:
1. **Monthly Bars** (default) — stacked bar chart, each bar = spa + aesthetics + slimming, x-axis = month labels
2. **Trend Lines** — line chart, 3 solid lines (this year, by brand) + 3 dashed lines (last year, same brand color at 60% opacity). SPLY always visible.

The `monthly` prop is the 13-point array from the API (always fixed rolling 13 months regardless of date picker).

### Step 1: Create the component

```typescript
// components/sales/GroupLongitudinal.tsx
"use client";

import { useState } from "react";
import { Card } from "@/components/ui/card";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  BarChart, Bar, LineChart, Line,
  XAxis, YAxis, CartesianGrid, Tooltip, Legend,
  ResponsiveContainer,
} from "recharts";
import type { GroupMonthlyPoint } from "@/lib/hooks/useGroupRevenue";

const BRAND_COLORS = {
  spa:        "#8C7A5A",
  aesthetics: "#6366f1",
  slimming:   "#3D6B3D",
};

function fmtK(v: number) {
  if (Math.abs(v) >= 1_000_000) return `€${(v / 1_000_000).toFixed(1)}M`;
  if (Math.abs(v) >= 1_000)     return `€${(v / 1_000).toFixed(1)}K`;
  return `€${v.toFixed(0)}`;
}

function monthLabel(m: string) {
  // YYYY-MM-01 → "Jan 25" style
  const d = new Date(m);
  return d.toLocaleDateString("en-GB", { month: "short", year: "2-digit" });
}

interface Props {
  monthly:    GroupMonthlyPoint[];
  isFetching: boolean;
}

export function GroupLongitudinal({ monthly, isFetching }: Props) {
  const [view, setView] = useState<"bars" | "lines">("bars");

  // Compute YoY delta for the most recent complete month (callout above chart)
  const latest = monthly[monthly.length - 1];
  const yoyDelta = latest && latest.total_ly > 0
    ? ((latest.total - latest.total_ly) / latest.total_ly * 100)
    : null;

  if (isFetching) {
    return (
      <Card className="p-6 h-64 flex items-center justify-center text-sm text-muted-foreground animate-pulse">
        Loading trend data…
      </Card>
    );
  }

  if (!monthly.length) {
    return (
      <Card className="p-6 h-40 flex items-center justify-center text-sm text-muted-foreground">
        No longitudinal data available.
      </Card>
    );
  }

  const chartData = monthly.map((p) => ({
    label:         monthLabel(p.month),
    spa:           p.spa,
    aesthetics:    p.aesthetics,
    slimming:      p.slimming,
    spa_ly:        p.spa_ly,
    aesthetics_ly: p.aesthetics_ly,
    slimming_ly:   p.slimming_ly,
    total:         p.total,
    total_ly:      p.total_ly,
  }));

  return (
    <Card className="p-4 md:p-6 space-y-4">
      {/* Header row */}
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div className="flex items-center gap-3">
          <h3 className="text-sm font-semibold text-foreground">Revenue Over Time</h3>
          {yoyDelta !== null && (
            <span
              className={`text-[11px] font-semibold rounded-full px-2 py-0.5 ${
                yoyDelta >= 0 ? "text-emerald-700 bg-emerald-50" : "text-red-600 bg-red-50"
              }`}
            >
              Latest month: {yoyDelta >= 0 ? "+" : ""}{yoyDelta.toFixed(1)}% vs LY
            </span>
          )}
        </div>
        <Tabs value={view} onValueChange={(v) => setView(v as "bars" | "lines")}>
          <TabsList className="h-7">
            <TabsTrigger value="bars"  className="text-xs px-3 h-6">Monthly Bars</TabsTrigger>
            <TabsTrigger value="lines" className="text-xs px-3 h-6">Trend Lines</TabsTrigger>
          </TabsList>
        </Tabs>
      </div>

      {/* Chart */}
      <div className="h-[280px] md:h-[340px]">
        <ResponsiveContainer width="100%" height="100%">
          {view === "bars" ? (
            <BarChart data={chartData} margin={{ top: 4, right: 8, left: 8, bottom: 4 }}>
              <CartesianGrid strokeDasharray="3 3" vertical={false} />
              <XAxis dataKey="label" tick={{ fontSize: 10 }} interval={0} />
              <YAxis tickFormatter={fmtK} tick={{ fontSize: 11 }} width={56} />
              <Tooltip formatter={(v: number) => fmtK(v)} />
              <Legend wrapperStyle={{ fontSize: 11 }} />
              <Bar dataKey="spa"        name="Spa"        stackId="a" fill={BRAND_COLORS.spa}        />
              <Bar dataKey="aesthetics" name="Aesthetics" stackId="a" fill={BRAND_COLORS.aesthetics} />
              <Bar dataKey="slimming"   name="Slimming"   stackId="a" fill={BRAND_COLORS.slimming}   radius={[3, 3, 0, 0]} />
            </BarChart>
          ) : (
            <LineChart data={chartData} margin={{ top: 4, right: 8, left: 8, bottom: 4 }}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis dataKey="label" tick={{ fontSize: 10 }} interval={0} />
              <YAxis tickFormatter={fmtK} tick={{ fontSize: 11 }} width={56} />
              <Tooltip formatter={(v: number) => fmtK(v)} />
              <Legend wrapperStyle={{ fontSize: 11 }} />
              {/* This year — solid */}
              <Line type="monotone" dataKey="spa"        name="Spa 26"        stroke={BRAND_COLORS.spa}        strokeWidth={2} dot={false} />
              <Line type="monotone" dataKey="aesthetics" name="Aesthetics 26"  stroke={BRAND_COLORS.aesthetics} strokeWidth={2} dot={false} />
              <Line type="monotone" dataKey="slimming"   name="Slimming 26"   stroke={BRAND_COLORS.slimming}   strokeWidth={2} dot={false} />
              {/* Last year — dashed, same color */}
              <Line type="monotone" dataKey="spa_ly"        name="Spa 25"        stroke={BRAND_COLORS.spa}        strokeWidth={1.5} strokeDasharray="4 2" strokeOpacity={0.5} dot={false} />
              <Line type="monotone" dataKey="aesthetics_ly" name="Aesthetics 25" stroke={BRAND_COLORS.aesthetics} strokeWidth={1.5} strokeDasharray="4 2" strokeOpacity={0.5} dot={false} />
              <Line type="monotone" dataKey="slimming_ly"   name="Slimming 25"  stroke={BRAND_COLORS.slimming}   strokeWidth={1.5} strokeDasharray="4 2" strokeOpacity={0.5} dot={false} />
            </LineChart>
          )}
        </ResponsiveContainer>
      </div>

      <p className="text-xs text-muted-foreground">
        Rolling 13 months · Same period last year shown as dashed lines in Trend view
      </p>
    </Card>
  );
}
```

### Step 2: Commit

```bash
git add "components/sales/GroupLongitudinal.tsx"
git commit -m "feat(sales): GroupLongitudinal — stacked bars + SPLY trend lines, 13-month rolling window"
```

---

## Task 5: Group Sales Page

**Files:**
- Modify: `app/sales/page.tsx` (currently a 5-line redirect — replace entirely)

### Step 1: Replace the page

```typescript
// app/sales/page.tsx
"use client";

import { useMemo } from "react";
import { useRouter } from "next/navigation";
import { DashboardShell } from "@/components/dashboard/DashboardShell";
import { SalesKPICard } from "@/components/sales/SalesKPICard";
import { SalesKPIGrid } from "@/components/sales/SalesKPIGrid";
import { GroupBrandBreakdown } from "@/components/sales/GroupBrandBreakdown";
import { GroupLongitudinal } from "@/components/sales/GroupLongitudinal";
import { useGroupRevenue } from "@/lib/hooks/useGroupRevenue";
import { Building2, Sparkles, Scale } from "lucide-react";

function fmtK(v: number) {
  if (Math.abs(v) >= 1_000_000) return `€${(v / 1_000_000).toFixed(2)}M`;
  if (Math.abs(v) >= 1_000)     return `€${(v / 1_000).toFixed(1)}K`;
  return `€${v.toFixed(0)}`;
}

function calcYoY(curr: number, ly: number): number | undefined {
  if (!ly) return undefined;
  return ((curr - ly) / ly) * 100;
}

function GroupSalesContent({ dateFrom, dateTo }: { dateFrom: Date; dateTo: Date }) {
  const router = useRouter();
  const { period, ly, spa_locations, monthly, isFetching } = useGroupRevenue(dateFrom, dateTo);

  const yoy = useMemo(() => ({
    total:      calcYoY(period.total,      ly.total),
    spa:        calcYoY(period.spa,        ly.spa),
    aesthetics: calcYoY(period.aesthetics, ly.aesthetics),
    slimming:   calcYoY(period.slimming,   ly.slimming),
  }), [period, ly]);

  return (
    <div className="space-y-4 md:space-y-6">
      {/* Page title */}
      <div>
        <h1 className="text-xl font-bold text-foreground">Group Sales</h1>
        <p className="text-xs text-muted-foreground mt-0.5">All brands · ex-VAT · Source: Cockpit Datasheet</p>
      </div>

      {/* KPI cards — top summary */}
      <SalesKPIGrid columns={4}>
        <SalesKPICard
          label="Group Revenue"
          value={isFetching ? "—" : fmtK(period.total)}
          subtitle={`Spa + Aesthetics + Slimming`}
          yoyChange={isFetching ? undefined : yoy.total}
        />
        <div
          className="cursor-pointer"
          onClick={() => router.push("/sales/spa")}
          title="Click to view Spa dashboard"
        >
          <SalesKPICard
            label="Spa Revenue"
            value={isFetching ? "—" : fmtK(period.spa)}
            subtitle="8 locations"
            yoyChange={isFetching ? undefined : yoy.spa}
            icon={Building2}
          />
        </div>
        <div
          className="cursor-pointer"
          onClick={() => router.push("/sales/aesthetics")}
          title="Click to view Aesthetics dashboard"
        >
          <SalesKPICard
            label="Aesthetics Revenue"
            value={isFetching ? "—" : fmtK(period.aesthetics)}
            subtitle="Single location"
            yoyChange={isFetching ? undefined : yoy.aesthetics}
            icon={Sparkles}
          />
        </div>
        <div
          className="cursor-pointer"
          onClick={() => router.push("/sales/slimming")}
          title="Click to view Slimming dashboard"
        >
          <SalesKPICard
            label="Slimming Revenue"
            value={isFetching ? "—" : fmtK(period.slimming)}
            subtitle="Single location"
            yoyChange={isFetching ? undefined : yoy.slimming}
            icon={Scale}
          />
        </div>
      </SalesKPIGrid>

      {/* Point-in-time breakdown */}
      <GroupBrandBreakdown
        period={period}
        ly={ly}
        spaLocations={spa_locations}
        isFetching={isFetching}
      />

      {/* Longitudinal chart — always 13-month rolling */}
      <GroupLongitudinal
        monthly={monthly}
        isFetching={isFetching}
      />
    </div>
  );
}

export default function GroupSalesPage() {
  return (
    <DashboardShell>
      {({ dateFrom, dateTo }) => (
        <GroupSalesContent dateFrom={dateFrom} dateTo={dateTo} />
      )}
    </DashboardShell>
  );
}
```

### Step 2: Verify brand pages still have back-breadcrumb context

The sidebar already highlights the active page. No breadcrumb needed on brand pages since the sidebar navigation is clear. If desired later, a `← Group Sales` link can be added to the brand pages.

### Step 3: Test manually in browser

Navigate to `http://localhost:3000/sales`:
- [ ] 4 KPI cards load with real numbers
- [ ] Group Revenue KPI card shows YoY badge
- [ ] Clicking "Spa Revenue" card navigates to `/sales/spa`
- [ ] Clicking "Aesthetics Revenue" card navigates to `/sales/aesthetics`
- [ ] Clicking "Slimming Revenue" card navigates to `/sales/slimming`
- [ ] "By Brand" bar chart shows 3 bars
- [ ] Toggle "By Location" shows 10 bars (8 Spa + Aesthetics + Slimming)
- [ ] Comparison table shows This Period / LY / vs LY
- [ ] Longitudinal "Monthly Bars" shows 13 stacked bars
- [ ] Toggle "Trend Lines" shows 6 lines (3 solid + 3 dashed)
- [ ] Numbers match the individual brand pages for the same date range

### Step 4: Verify number consistency

With the same date range selected on `/sales` and `/sales/spa`:
- Spa KPI card value on group page should equal "Net Revenue" on the Spa page

### Step 5: Commit

```bash
git add "app/sales/page.tsx"
git commit -m "feat(sales): group sales dashboard — KPI summary + brand breakdown + 13-month longitudinal"
```

---

## Task 6: Sidebar Navigation Update

**Files:**
- Read and check: `components/layout/Sidebar.tsx`

Check if the sidebar has a "Sales" entry that currently links to `/sales/spa`. If so, update it to link to `/sales` (the new group page) so clicking "Sales" in the nav lands on the group summary.

```bash
grep -n "sales" "components/layout/Sidebar.tsx"
```

If the nav item points to `/sales/spa`, change it to `/sales`. If it already points to `/sales`, no change needed.

### Commit if changed

```bash
git add "components/layout/Sidebar.tsx"
git commit -m "fix(nav): Sales sidebar link points to /sales group page"
```

---

## Summary of New Files

| File | Purpose |
|------|---------|
| `app/api/sales/group/route.ts` | Server API — queries all 3 Supabase tables, returns period + LY + 13-month monthly series |
| `lib/hooks/useGroupRevenue.ts` | Client hook — calls `/api/sales/group` |
| `components/sales/GroupBrandBreakdown.tsx` | Bar chart + comparison table with By Brand/Location toggle |
| `components/sales/GroupLongitudinal.tsx` | 13-month stacked bar + SPLY trend lines with view toggle |
| `app/sales/page.tsx` | Group summary page (replaces redirect) |

**No existing files are modified except:** `app/sales/page.tsx` (currently a redirect), and optionally `Sidebar.tsx` if the nav link needs updating.
