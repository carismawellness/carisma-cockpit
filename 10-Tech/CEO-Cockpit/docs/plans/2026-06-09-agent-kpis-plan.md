# Agent KPIs Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Rename "Individual KPIs" → "Agent KPIs", add 12 nested per-agent sidebar items, make leaderboard cards clickable, add a Re-Sync button with last-synced timestamp, and build a per-agent full-page dashboard at `/crm/individual/[slug]`.

**Architecture:** Navigation uses the existing 3-level `SubSubItem` system in `departments.ts` — no sidebar code changes needed. Per-agent pages reuse the `useCrmAgents` React Query cache (already fetches all 12 agents) and filter client-side. A new lightweight `AgentDetailPanel` component is extracted from `AgentDetailTabs` so both the tab view and per-agent pages share the same charts.

**Tech Stack:** Next.js 14 App Router, TypeScript, Tailwind CSS, Recharts, Supabase JS client, React Query (`@tanstack/react-query`), `date-fns`, `lucide-react`

---

## Task 1: Add "Agent KPIs" nested nav with 12 agent sub-items

**Files:**
- Modify: `lib/constants/departments.ts`

### Step 1: Open the file and locate the CRM section (lines ~79–87)

The CRM block looks like:
```typescript
{
  slug: "crm",
  label: "CRM",
  icon: Headphones,
  path: "/crm",
  children: [
    { slug: "crm-overview",   label: "Overview",        path: "/crm",            icon: Headphones },
    { slug: "crm-individual", label: "Individual KPIs", path: "/crm/individual", icon: Users },
  ],
},
```

### Step 2: Add a `User` import and replace the CRM block

Change the import line (top of file) from:
```typescript
import {
  ...
  Users,
  ...
} from "lucide-react";
```
to also include `User`:
```typescript
import {
  LayoutDashboard,
  Megaphone,
  DollarSign,
  Headphones,
  Users,
  User,
  Settings,
  Activity,
  TrendingUp,
  Sparkles,
  Heart,
  Filter,
  BookOpen,
  RefreshCw,
  ClipboardList,
  type LucideIcon,
} from "lucide-react";
```

### Step 3: Replace the `crm-individual` entry with the nested version

```typescript
{
  slug: "crm",
  label: "CRM",
  icon: Headphones,
  path: "/crm",
  children: [
    { slug: "crm-overview", label: "Overview", path: "/crm", icon: Headphones },
    {
      slug: "crm-individual",
      label: "Agent KPIs",
      path: "/crm/individual",
      icon: Users,
      children: [
        { slug: "agent-abid",     label: "Abid",     path: "/crm/individual/abid",     icon: User },
        { slug: "agent-rana",     label: "Rana",     path: "/crm/individual/rana",     icon: User },
        { slug: "agent-nathalia", label: "Nathalia", path: "/crm/individual/nathalia", icon: User },
        { slug: "agent-adeel",    label: "Adeel",    path: "/crm/individual/adeel",    icon: User },
        { slug: "agent-km",       label: "K&M",      path: "/crm/individual/km",       icon: User },
        { slug: "agent-vj",       label: "VJ",       path: "/crm/individual/vj",       icon: User },
        { slug: "agent-dorianne", label: "Dorianne", path: "/crm/individual/dorianne", icon: User },
        { slug: "agent-juliana",  label: "Juliana",  path: "/crm/individual/juliana",  icon: User },
        { slug: "agent-anni",     label: "Anni",     path: "/crm/individual/anni",     icon: User },
        { slug: "agent-nicci",    label: "Nicci",    path: "/crm/individual/nicci",    icon: User },
        { slug: "agent-april",    label: "April",    path: "/crm/individual/april",    icon: User },
        { slug: "agent-queenee",  label: "Queenee",  path: "/crm/individual/queenee",  icon: User },
      ],
    },
  ],
},
```

### Step 4: Verify the sidebar renders correctly

Start dev server (`npm run dev` from `10-Tech/CEO-Cockpit/`), navigate to any CRM page, expand CRM → Agent KPIs. Should see all 12 agent names nested under it.

### Step 5: Commit

```bash
git add 10-Tech/CEO-Cockpit/lib/constants/departments.ts
git commit -m "feat(crm): rename Individual KPIs → Agent KPIs, add 12 agent sub-nav items"
```

---

## Task 2: Create sync-status API route

**Files:**
- Create: `10-Tech/CEO-Cockpit/app/api/crm/sync-status/route.ts`

### Step 1: Create the file

```typescript
import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export const dynamic = "force-dynamic";

export async function GET() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseUrl || !supabaseKey) {
    return NextResponse.json({ last_synced: null });
  }

  const supabase = createClient(supabaseUrl, supabaseKey);

  const { data, error } = await supabase
    .from("crm_agent_daily")
    .select("etl_synced_at")
    .order("etl_synced_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error || !data) {
    return NextResponse.json({ last_synced: null });
  }

  return NextResponse.json({ last_synced: data.etl_synced_at });
}
```

### Step 2: Test the endpoint

```bash
curl http://localhost:3000/api/crm/sync-status
```
Expected: `{"last_synced":"2026-06-09T..."}` or `{"last_synced":null}`

### Step 3: Commit

```bash
git add "10-Tech/CEO-Cockpit/app/api/crm/sync-status/route.ts"
git commit -m "feat(crm): add sync-status API route for last-synced timestamp"
```

---

## Task 3: Extract `AgentDetailPanel` component

**Files:**
- Create: `10-Tech/CEO-Cockpit/components/crm/AgentDetailPanel.tsx`
- Modify: `10-Tech/CEO-Cockpit/components/crm/AgentDetailTabs.tsx`

The goal is to pull the `AgentDetail` function (lines 91–194 of `AgentDetailTabs.tsx`) into its own exported component so the per-agent page can reuse it without duplicating charts.

### Step 1: Create `AgentDetailPanel.tsx`

```typescript
"use client";

import { format, parseISO } from "date-fns";
import {
  ComposedChart,
  Bar,
  Line,
  BarChart,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
} from "recharts";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { CrmAgent, CrmAgentRow } from "@/lib/hooks/useCrmAgents";
import { chartColors, formatCurrency, formatPercent } from "@/lib/charts/config";

const TARGET_CONV_RATE = 25;
const TARGET_DEPOSIT_PCT = 70;

function TrendBadge({ value, target }: { value: number; target: number }) {
  const delta = value - target;
  const color = delta >= 0 ? "text-emerald-600 bg-emerald-50" : "text-rose-600 bg-rose-50";
  const sign  = delta >= 0 ? "+" : "";
  return (
    <span className={`ml-1.5 inline-block rounded-full px-1.5 py-0.5 text-[10px] font-semibold ${color}`}>
      {sign}{delta.toFixed(1)}% vs target
    </span>
  );
}

interface KpiCardProps {
  label: string;
  value: string;
  target?: number;
  rawValue?: number;
}

function KpiCard({ label, value, target, rawValue }: KpiCardProps) {
  return (
    <Card>
      <CardContent className="pt-4">
        <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{label}</p>
        <p className="mt-1 text-2xl font-bold text-foreground leading-tight">{value}</p>
        {target !== undefined && rawValue !== undefined && (
          <div className="mt-1">
            <TrendBadge value={rawValue} target={target} />
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function CustomTooltip({
  active,
  payload,
  label,
}: {
  active?: boolean;
  payload?: Array<{ name: string; value: number; color: string }>;
  label?: string;
}) {
  if (!active || !payload) return null;
  return (
    <div className="rounded-lg border border-gray-200 bg-white p-3 text-xs shadow-lg">
      <p className="mb-1.5 font-semibold text-foreground">{label}</p>
      {payload.map((entry) => (
        <div key={entry.name} className="flex justify-between gap-4" style={{ color: entry.color }}>
          <span>{entry.name}</span>
          <span className="font-semibold">
            {entry.name.includes("%") || entry.name.includes("Conv")
              ? formatPercent(entry.value)
              : formatCurrency(entry.value)}
          </span>
        </div>
      ))}
    </div>
  );
}

interface AgentDetailPanelProps {
  agent: CrmAgent;
}

export function AgentDetailPanel({ agent }: AgentDetailPanelProps) {
  const { totals, rows } = agent;

  const chartRows = rows.map((r: CrmAgentRow) => ({
    date:          format(parseISO(r.date), "d MMM"),
    "Total Sales": r.total_sales,
    "Conv %":      Number((r.conversion_rate_pct ?? 0).toFixed(1)),
    "LC":          r.lc_sales,
    "CRM":         r.crm_sales,
    "Other":       r.other_sales,
  }));

  return (
    <div className="space-y-6">
      {/* KPI Summary Cards */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
        <KpiCard label="Total Sales"     value={formatCurrency(totals.total_sales)} />
        <KpiCard
          label="Conversion Rate"
          value={formatPercent(totals.avg_conversion_rate)}
          target={TARGET_CONV_RATE}
          rawValue={totals.avg_conversion_rate}
        />
        <KpiCard
          label="Deposit %"
          value={formatPercent(totals.avg_deposit_pct)}
          target={TARGET_DEPOSIT_PCT}
          rawValue={totals.avg_deposit_pct}
        />
        <KpiCard label="AOV"             value={formatCurrency(totals.avg_aov)} />
        <KpiCard label="Active Days"     value={String(totals.active_days)} />
        <KpiCard label="Total Messages"  value={String(totals.total_messages)} />
      </div>

      {/* Daily Sales & Conversion Trend */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base font-semibold">Daily Sales & Conversion Trend</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="h-[280px]">
            <ResponsiveContainer width="100%" height="100%">
              <ComposedChart data={chartRows} margin={{ top: 5, right: 20, left: 0, bottom: 5 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#E5E7EB" />
                <XAxis dataKey="date" tick={{ fontSize: 11 }} />
                <YAxis
                  yAxisId="sales"
                  orientation="left"
                  tickFormatter={(v) => `€${v}`}
                  tick={{ fontSize: 11 }}
                />
                <YAxis
                  yAxisId="pct"
                  orientation="right"
                  tickFormatter={(v) => `${v}%`}
                  tick={{ fontSize: 11 }}
                  domain={[0, 100]}
                />
                <Tooltip content={<CustomTooltip />} />
                <Legend wrapperStyle={{ paddingTop: 8 }} />
                <Bar
                  yAxisId="sales"
                  dataKey="Total Sales"
                  fill={chartColors.spa}
                  radius={[4, 4, 0, 0]}
                  barSize={20}
                />
                <Line
                  yAxisId="pct"
                  type="monotone"
                  dataKey="Conv %"
                  stroke={chartColors.target}
                  strokeWidth={2}
                  dot={{ r: 3, fill: chartColors.target }}
                />
              </ComposedChart>
            </ResponsiveContainer>
          </div>
        </CardContent>
      </Card>

      {/* Channel Breakdown */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base font-semibold">Channel Breakdown (Daily Sales)</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="h-[260px]">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={chartRows} margin={{ top: 5, right: 20, left: 0, bottom: 5 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#E5E7EB" />
                <XAxis dataKey="date" tick={{ fontSize: 11 }} />
                <YAxis tickFormatter={(v) => `€${v}`} tick={{ fontSize: 11 }} />
                <Tooltip content={<CustomTooltip />} />
                <Legend wrapperStyle={{ paddingTop: 8 }} />
                <Bar dataKey="LC"    stackId="ch" fill={chartColors.spa}        radius={[0, 0, 0, 0]} />
                <Bar dataKey="CRM"   stackId="ch" fill={chartColors.aesthetics} radius={[0, 0, 0, 0]} />
                <Bar dataKey="Other" stackId="ch" fill={chartColors.slimming}   radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
```

### Step 2: Update `AgentDetailTabs.tsx` to use the new component

Remove the `TrendBadge`, `KpiCard`, `CustomTooltip`, and `AgentDetail` private functions. Replace the `AgentDetail` usage with `AgentDetailPanel`. The new file should look like:

```typescript
"use client";

import { useState } from "react";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { CrmAgent } from "@/lib/hooks/useCrmAgents";
import { AgentDetailPanel } from "@/components/crm/AgentDetailPanel";

interface AgentDetailTabsProps {
  agents: CrmAgent[];
}

export function AgentDetailTabs({ agents }: AgentDetailTabsProps) {
  const agentsWithData = agents.filter((a) => a.totals.total_sales > 0 || a.rows.length > 0);
  const displayAgents  = agentsWithData.length > 0 ? agentsWithData : agents;

  const [activeSlug, setActiveSlug] = useState<string>(
    displayAgents[0]?.slug ?? ""
  );

  if (displayAgents.length === 0) {
    return (
      <div className="rounded-xl border border-dashed border-gray-300 bg-gray-50 py-10 text-center text-sm text-muted-foreground">
        No data for selected period — run the ETL sync first
      </div>
    );
  }

  const activeAgent = displayAgents.find((a) => a.slug === activeSlug) ?? displayAgents[0];

  return (
    <Tabs value={activeSlug} onValueChange={setActiveSlug}>
      <TabsList className="h-auto flex-wrap gap-1 bg-muted p-1">
        {displayAgents.map((agent) => (
          <TabsTrigger key={agent.slug} value={agent.slug} className="text-xs">
            {agent.name}
          </TabsTrigger>
        ))}
      </TabsList>

      {displayAgents.map((agent) => (
        <TabsContent key={agent.slug} value={agent.slug}>
          {activeAgent.slug === agent.slug && <AgentDetailPanel agent={agent} />}
        </TabsContent>
      ))}
    </Tabs>
  );
}
```

### Step 3: Build check

```bash
cd "10-Tech/CEO-Cockpit" && npx tsc --noEmit
```
Expected: no errors.

### Step 4: Commit

```bash
git add "10-Tech/CEO-Cockpit/components/crm/AgentDetailPanel.tsx" \
        "10-Tech/CEO-Cockpit/components/crm/AgentDetailTabs.tsx"
git commit -m "refactor(crm): extract AgentDetailPanel shared component from AgentDetailTabs"
```

---

## Task 4: Make leaderboard cards clickable

**Files:**
- Modify: `10-Tech/CEO-Cockpit/components/crm/AgentLeaderboardCards.tsx`

### Step 1: Add Link import and wrap each card

Replace the entire file content with:

```typescript
"use client";

import Link from "next/link";
import { CrmAgent } from "@/lib/hooks/useCrmAgents";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { formatCurrency, formatPercent } from "@/lib/charts/config";

interface AgentLeaderboardCardsProps {
  agents: CrmAgent[];
}

export function AgentLeaderboardCards({ agents }: AgentLeaderboardCardsProps) {
  if (agents.length === 0) {
    return (
      <div className="rounded-xl border border-dashed border-gray-300 bg-gray-50 py-10 text-center text-sm text-muted-foreground">
        No data for selected period — run the ETL sync first
      </div>
    );
  }

  const sorted = [...agents].sort(
    (a, b) => b.totals.total_sales - a.totals.total_sales
  );

  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 xl:grid-cols-5">
      {sorted.map((agent, idx) => (
        <Link key={agent.slug} href={`/crm/individual/${agent.slug}`}>
          <Card className="relative cursor-pointer transition-all hover:ring-2 hover:ring-gold/50 hover:shadow-md">
            {idx === 0 && (
              <span className="absolute right-2 top-2 rounded-full bg-amber-100 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-amber-700">
                #1
              </span>
            )}
            <CardHeader className="pb-1">
              <CardTitle className="truncate text-sm font-semibold">
                {agent.name}
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-1.5">
              <p className="text-2xl font-bold text-foreground leading-tight">
                {formatCurrency(agent.totals.total_sales)}
              </p>
              <div className="space-y-0.5 text-xs text-muted-foreground">
                <div className="flex justify-between">
                  <span>Conv Rate</span>
                  <span className="font-medium text-foreground">
                    {formatPercent(agent.totals.avg_conversion_rate)}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span>AOV</span>
                  <span className="font-medium text-foreground">
                    {formatCurrency(agent.totals.avg_aov)}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span>Active Days</span>
                  <span className="font-medium text-foreground">
                    {agent.totals.active_days}
                  </span>
                </div>
              </div>
            </CardContent>
          </Card>
        </Link>
      ))}
    </div>
  );
}
```

Note: `ring-gold` uses the project's custom gold color token from Tailwind config. If `ring-gold` doesn't resolve, use `ring-amber-400` as fallback.

### Step 2: Check Tailwind config for the gold token

```bash
grep -r "gold" "10-Tech/CEO-Cockpit/tailwind.config" 2>/dev/null || grep -r "gold" "10-Tech/CEO-Cockpit/tailwind.config.ts" 2>/dev/null | head -5
```

If `gold` is not a ring-compatible token, replace `hover:ring-gold/50` with `hover:ring-amber-400/50`.

### Step 3: Commit

```bash
git add "10-Tech/CEO-Cockpit/components/crm/AgentLeaderboardCards.tsx"
git commit -m "feat(crm): make leaderboard cards clickable links to per-agent pages"
```

---

## Task 5: Add Re-Sync button + last-synced to the leaderboard page

**Files:**
- Modify: `10-Tech/CEO-Cockpit/app/crm/individual/page.tsx`

### Step 1: Replace the full file

```typescript
"use client";

import { useState, useEffect, useCallback } from "react";
import { DashboardShell } from "@/components/dashboard/DashboardShell";
import { AgentLeaderboardCards } from "@/components/crm/AgentLeaderboardCards";
import { AgentDetailTabs } from "@/components/crm/AgentDetailTabs";
import { AgentComparisonTable } from "@/components/crm/AgentComparisonTable";
import { useCrmAgents } from "@/lib/hooks/useCrmAgents";
import { formatDateRangeLabel } from "@/lib/utils/mock-date-filter";
import { RefreshCw, AlertCircle } from "lucide-react";
import { formatDistanceToNow, parseISO } from "date-fns";

function LastSyncedBadge() {
  const [lastSynced, setLastSynced] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/crm/sync-status")
      .then((r) => r.json())
      .then(({ last_synced }: { last_synced: string | null }) => {
        setLastSynced(last_synced);
      })
      .catch(() => {});
  }, []);

  if (!lastSynced) return null;

  return (
    <span className="text-xs text-muted-foreground">
      Last synced {formatDistanceToNow(parseISO(lastSynced), { addSuffix: true })}
    </span>
  );
}

function IndividualKPIsContent({
  dateFrom,
  dateTo,
}: {
  dateFrom: Date;
  dateTo: Date;
  brandFilter: string | null;
}) {
  const { agents, isLoading, isError, error } = useCrmAgents(dateFrom, dateTo);
  const [isSyncing, setIsSyncing] = useState(false);
  const [syncError, setSyncError] = useState<string | null>(null);

  const handleSync = useCallback(async () => {
    setIsSyncing(true);
    setSyncError(null);
    try {
      const res = await fetch("/api/etl/crm-agents", { method: "POST" });
      if (!res.ok) {
        const json = await res.json().catch(() => ({}));
        setSyncError((json as { error?: string }).error ?? `HTTP ${res.status}`);
      }
    } catch (e) {
      setSyncError(String(e));
    } finally {
      setIsSyncing(false);
    }
  }, []);

  return (
    <>
      {/* Page header */}
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-xl font-bold text-foreground md:text-2xl">
            Agent KPIs
          </h1>
          <p className="mt-0.5 text-sm text-muted-foreground">
            {formatDateRangeLabel(dateFrom, dateTo)} · Per-agent CRM performance
          </p>
          <div className="mt-1">
            <LastSyncedBadge />
          </div>
        </div>
        <button
          onClick={handleSync}
          disabled={isSyncing || isLoading}
          className="flex items-center gap-2 text-xs font-medium px-3 py-2 rounded-lg border hover:bg-muted transition-colors disabled:opacity-50"
        >
          <RefreshCw className={`h-3.5 w-3.5 ${isSyncing ? "animate-spin" : ""}`} />
          {isSyncing ? "Syncing…" : "Re-Sync"}
        </button>
      </div>

      {/* Error states */}
      {isError && (
        <div className="flex items-center gap-2 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          <AlertCircle className="h-4 w-4 flex-shrink-0" />
          <span>Failed to load agent data: {error}</span>
        </div>
      )}
      {syncError && (
        <div className="flex items-center gap-2 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          <AlertCircle className="h-4 w-4 flex-shrink-0" />
          <span>Sync error: {syncError}</span>
        </div>
      )}

      {/* Section 1: Agent Leaderboard Cards */}
      <section>
        <h2 className="mb-3 text-lg font-semibold text-foreground">
          Agent Leaderboard
        </h2>
        {isLoading ? (
          <div className="h-40 animate-pulse rounded-xl bg-gray-100" />
        ) : (
          <AgentLeaderboardCards agents={agents} />
        )}
      </section>

      {/* Section 2: Agent Detail Drill-Down */}
      <section>
        <h2 className="mb-3 text-lg font-semibold text-foreground">
          Agent Detail
        </h2>
        {isLoading ? (
          <div className="h-96 animate-pulse rounded-xl bg-gray-100" />
        ) : (
          <AgentDetailTabs agents={agents} />
        )}
      </section>

      {/* Section 3: Cross-Agent Comparison Table */}
      <section>
        <h2 className="mb-3 text-lg font-semibold text-foreground">
          Cross-Agent Comparison
        </h2>
        {isLoading ? (
          <div className="h-64 animate-pulse rounded-xl bg-gray-100" />
        ) : (
          <AgentComparisonTable agents={agents} />
        )}
      </section>
    </>
  );
}

export default function CRMIndividualPage() {
  return (
    <DashboardShell>
      {({ dateFrom, dateTo, brandFilter }) => (
        <IndividualKPIsContent
          dateFrom={dateFrom}
          dateTo={dateTo}
          brandFilter={brandFilter}
        />
      )}
    </DashboardShell>
  );
}
```

### Step 2: Build check

```bash
cd "10-Tech/CEO-Cockpit" && npx tsc --noEmit
```

### Step 3: Commit

```bash
git add "10-Tech/CEO-Cockpit/app/crm/individual/page.tsx"
git commit -m "feat(crm): add Re-Sync button and last-synced badge to Agent KPIs page"
```

---

## Task 6: Create per-agent page `/crm/individual/[slug]`

**Files:**
- Create: `10-Tech/CEO-Cockpit/app/crm/individual/[slug]/page.tsx`

### Step 1: Create the directory

```bash
mkdir -p "10-Tech/CEO-Cockpit/app/crm/individual/[slug]"
```

### Step 2: Create the page file

```typescript
"use client";

import { use } from "react";
import { notFound } from "next/navigation";
import Link from "next/link";
import { DashboardShell } from "@/components/dashboard/DashboardShell";
import { AgentDetailPanel } from "@/components/crm/AgentDetailPanel";
import { useCrmAgents } from "@/lib/hooks/useCrmAgents";
import { formatDateRangeLabel } from "@/lib/utils/mock-date-filter";
import { ChevronLeft, ExternalLink } from "lucide-react";

// Map from slug → Google Sheet tab name (matches ETL config in /api/etl/crm-agents)
const AGENT_NAMES: Record<string, string> = {
  adeel:    "Adeel",
  rana:     "Rana",
  abid:     "Abid",
  km:       "K&M",
  vj:       "VJ",
  dorianne: "Dorianne",
  juliana:  "Juliana",
  anni:     "Anni",
  nicci:    "Nicci",
  nathalia: "Nathalia",
  april:    "April",
  queenee:  "Queenee",
};

const CRM_MASTER_SHEET_ID = "1bHF_7bXic08pcyXQhq310zG6McqXD50oT0EuVkjzDdI";

function AgentPageContent({
  slug,
  dateFrom,
  dateTo,
}: {
  slug: string;
  dateFrom: Date;
  dateTo: Date;
  brandFilter: string | null;
}) {
  const { agents, isLoading, isError } = useCrmAgents(dateFrom, dateTo);

  const agentName = AGENT_NAMES[slug];
  if (!agentName) notFound();

  const agent = agents.find((a) => a.slug === slug);

  const sheetUrl = `https://docs.google.com/spreadsheets/d/${CRM_MASTER_SHEET_ID}/edit`;

  return (
    <>
      {/* Breadcrumb + header */}
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div className="space-y-1">
          <Link
            href="/crm/individual"
            className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors"
          >
            <ChevronLeft className="h-3 w-3" />
            Agent KPIs
          </Link>
          <h1 className="text-xl font-bold text-foreground md:text-2xl">
            {agentName}
          </h1>
          <p className="text-sm text-muted-foreground">
            {formatDateRangeLabel(dateFrom, dateTo)} · CRM performance
          </p>
        </div>
        <a
          href={sheetUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-1.5 text-xs font-medium px-2.5 py-1 rounded-full border bg-slate-50 text-slate-600 hover:bg-slate-100 transition-colors"
        >
          <ExternalLink className="h-3 w-3" />
          CRM Master Sheet ↗
        </a>
      </div>

      {/* Content */}
      {isLoading && (
        <div className="space-y-4">
          <div className="h-32 animate-pulse rounded-xl bg-gray-100" />
          <div className="h-72 animate-pulse rounded-xl bg-gray-100" />
          <div className="h-64 animate-pulse rounded-xl bg-gray-100" />
        </div>
      )}

      {isError && (
        <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          Failed to load agent data. Try refreshing.
        </div>
      )}

      {!isLoading && !isError && !agent && (
        <div className="rounded-xl border border-dashed border-gray-300 bg-gray-50 py-16 text-center text-sm text-muted-foreground">
          No data for {agentName} in the selected period.
        </div>
      )}

      {!isLoading && agent && (
        <AgentDetailPanel agent={agent} />
      )}
    </>
  );
}

export default function AgentPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = use(params);

  return (
    <DashboardShell>
      {({ dateFrom, dateTo, brandFilter }) => (
        <AgentPageContent
          slug={slug}
          dateFrom={dateFrom}
          dateTo={dateTo}
          brandFilter={brandFilter}
        />
      )}
    </DashboardShell>
  );
}
```

**Important:** In Next.js 15 App Router, `params` is a `Promise` and must be unwrapped with `use()`. If the project is on Next.js 14, change `params: Promise<{ slug: string }>` to `params: { slug: string }` and remove the `use()` call (access `params.slug` directly).

Check the version:
```bash
grep '"next"' "10-Tech/CEO-Cockpit/package.json"
```

### Step 3: Build check

```bash
cd "10-Tech/CEO-Cockpit" && npx tsc --noEmit
```

### Step 4: Manual smoke test

1. Navigate to `/crm/individual` in the browser
2. Click the "Abid" card → should land on `/crm/individual/abid`
3. Click sidebar "Agent KPIs" → expand → click "Rana" → should land on `/crm/individual/rana`
4. Click "← Agent KPIs" breadcrumb → returns to `/crm/individual`
5. Check that date filter changes reflect on both the leaderboard and per-agent pages

### Step 5: Commit

```bash
git add "10-Tech/CEO-Cockpit/app/crm/individual/[slug]/page.tsx"
git commit -m "feat(crm): add per-agent detail page at /crm/individual/[slug]"
```

---

## Task 7: QC subagent verification

Spawn a QC subagent with the following checklist:

**Routes:**
- [ ] `/crm/individual` loads without error, shows "Agent KPIs" as title
- [ ] `/crm/individual/abid` loads without error, shows "Abid" as title
- [ ] `/crm/individual/rana`, `/crm/individual/nathalia` both load
- [ ] An unknown slug (e.g. `/crm/individual/nobody`) returns 404

**Navigation:**
- [ ] Sidebar CRM → "Agent KPIs" expands to show 12 agent items
- [ ] Clicking an agent item in the sidebar navigates to `/crm/individual/[slug]`
- [ ] Active sidebar item highlights correctly for per-agent pages

**Leaderboard page:**
- [ ] Cards are clickable (cursor:pointer visible on hover)
- [ ] "Re-Sync" button is visible, clicking it calls `POST /api/etl/crm-agents`
- [ ] "Last synced X ago" badge appears below the subtitle

**Per-agent page:**
- [ ] 6 KPI cards render with correct labels
- [ ] Daily Sales & Conversion Trend chart renders
- [ ] Channel Breakdown chart renders
- [ ] "← Agent KPIs" breadcrumb navigates back
- [ ] "CRM Master Sheet ↗" link opens in new tab

**TypeScript:**
- [ ] `npx tsc --noEmit` passes with no errors

### Step 8: Deploy

```bash
git push origin main
```

Vercel will auto-deploy from `main`. Monitor build logs in the Vercel dashboard.

---

## Quick Reference: Key Files

| Purpose | File |
|---------|------|
| Nav structure | `lib/constants/departments.ts` |
| Leaderboard page | `app/crm/individual/page.tsx` |
| Per-agent page | `app/crm/individual/[slug]/page.tsx` |
| Shared charts component | `components/crm/AgentDetailPanel.tsx` |
| Tab view on leaderboard | `components/crm/AgentDetailTabs.tsx` |
| Clickable leaderboard cards | `components/crm/AgentLeaderboardCards.tsx` |
| Sync-status API | `app/api/crm/sync-status/route.ts` |
| ETL trigger (existing) | `app/api/etl/crm-agents/route.ts` |
| Data hook (existing) | `lib/hooks/useCrmAgents.ts` |
| Supabase table (existing) | `crm_agent_daily` |
