# Agent Commission Hero Banner Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Show each agent their commission earned (revenue × rate) as a full-width green hero banner at the top of their individual CRM dashboard.

**Architecture:** Add `commissionRate` to the existing `AgentMeta` type in `lib/constants/agents.ts`. Create a new `CommissionHeroBanner` component. Wire it into the slug page above `AgentDetailPanel` — the page computes the euro amount and passes it as props. No API changes.

**Tech Stack:** Next.js 15 App Router, TypeScript, Tailwind CSS, shadcn/ui Card, lucide-react icons, existing `useCrmAgents` hook.

---

### Task 1: Add `commissionRate` to `AgentMeta`

**Files:**
- Modify: `lib/constants/agents.ts`

**Step 1: Open the file and add `commissionRate` to the interface**

In `lib/constants/agents.ts`, update the `AgentMeta` interface and every entry in `AGENT_META`:

```typescript
export interface AgentMeta {
  slug:           string;
  name:           string;
  brand:          AgentBrand;
  role:           AgentRole;
  inactive:       boolean;
  commissionRate: number;   // ← add this line (decimal: 0.01 = 1%)
}

export const AGENT_META: AgentMeta[] = [
  // ── SPA ──────────────────────────────────────────────────────────────────
  { slug: "abid",     name: "Abid",     brand: "SPA",        role: "Chat", inactive: false, commissionRate: 0.01  },
  { slug: "km",       name: "K&M",      brand: "SPA",        role: "Chat", inactive: false, commissionRate: 0.01  },
  { slug: "vj",       name: "VJ",       brand: "SPA",        role: "SDR",  inactive: false, commissionRate: 0.01  },
  { slug: "nicci",    name: "Nicci",    brand: "SPA",        role: "SDR",  inactive: true,  commissionRate: 0.01  },
  // ── AESTHETICS ───────────────────────────────────────────────────────────
  { slug: "rana",     name: "Rana",     brand: "AESTHETICS", role: "Chat", inactive: false, commissionRate: 0.015 },
  { slug: "juliana",  name: "Juliana",  brand: "SPA",        role: "SDR",  inactive: false, commissionRate: 0.01  },
  { slug: "nathalia", name: "Nathalia", brand: "AESTHETICS", role: "SDR",  inactive: false, commissionRate: 0.01  },
  { slug: "april",    name: "April",    brand: "AESTHETICS", role: "SDR",  inactive: false, commissionRate: 0.01  },
  { slug: "anni",     name: "Anni",     brand: "AESTHETICS", role: "SDR",  inactive: true,  commissionRate: 0.01  },
  // ── SLIMMING ─────────────────────────────────────────────────────────────
  { slug: "dorianne", name: "Dorianne", brand: "SLIMMING",   role: "SDR",  inactive: false, commissionRate: 0.01  },
  { slug: "queenee",  name: "Queenee",  brand: "SLIMMING",   role: "SDR",  inactive: false, commissionRate: 0.01  },
  { slug: "adeel",    name: "Adeel",    brand: "SLIMMING",   role: "Chat", inactive: true,  commissionRate: 0.01  },
];
```

**Step 2: Verify TypeScript is happy**

Run from `Tech/CEO-Cockpit/`:
```bash
npx tsc --noEmit
```
Expected: no errors.

**Step 3: Commit**

```bash
git add Tech/CEO-Cockpit/lib/constants/agents.ts
git commit -m "feat(crm): add commissionRate to AgentMeta"
```

---

### Task 2: Create `CommissionHeroBanner` component

**Files:**
- Create: `Tech/CEO-Cockpit/components/crm/CommissionHeroBanner.tsx`

**Step 1: Create the file with this exact content**

```tsx
"use client";

import { Banknote } from "lucide-react";
import { Card } from "@/components/ui/card";

interface CommissionHeroBannerProps {
  agentName:        string;
  commissionEarned: number;
  commissionRate:   number;
  totalSales:       number;
  periodLabel:      string;
}

function formatEur(value: number): string {
  return new Intl.NumberFormat("en-MT", {
    style:                 "currency",
    currency:              "EUR",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(value);
}

export function CommissionHeroBanner({
  agentName,
  commissionEarned,
  commissionRate,
  totalSales,
  periodLabel,
}: CommissionHeroBannerProps) {
  const ratePct = (commissionRate * 100).toLocaleString("en", { maximumFractionDigits: 1 }) + "%";

  return (
    <Card className="w-full bg-gradient-to-br from-emerald-50 to-green-100 border-emerald-200 shadow-sm overflow-hidden">
      <div className="relative px-6 py-6 md:py-8">
        {/* Header row */}
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2 text-emerald-700">
            <Banknote className="h-5 w-5" />
            <span className="text-sm font-semibold uppercase tracking-wide">
              Your Commission
            </span>
          </div>
          <span className="inline-flex items-center rounded-full bg-emerald-100 border border-emerald-200 px-2.5 py-0.5 text-xs font-semibold text-emerald-800">
            {ratePct} of revenue
          </span>
        </div>

        {/* Big amount */}
        <div className="text-center mb-3">
          <span className="text-5xl md:text-6xl font-extrabold text-emerald-700 tracking-tight tabular-nums">
            {formatEur(commissionEarned)}
          </span>
        </div>

        {/* Subtitle */}
        <p className="text-center text-sm text-emerald-600">
          {periodLabel}&nbsp;·&nbsp;Based on {formatEur(totalSales)} revenue
        </p>
      </div>
    </Card>
  );
}

export function CommissionHeroBannerSkeleton() {
  return (
    <div className="h-44 animate-pulse rounded-xl bg-emerald-50 border border-emerald-100" />
  );
}
```

**Step 2: Verify TypeScript**

```bash
npx tsc --noEmit
```
Expected: no errors.

**Step 3: Commit**

```bash
git add "Tech/CEO-Cockpit/components/crm/CommissionHeroBanner.tsx"
git commit -m "feat(crm): add CommissionHeroBanner component"
```

---

### Task 3: Wire the banner into the agent slug page

**Files:**
- Modify: `Tech/CEO-Cockpit/app/crm/individual/[slug]/page.tsx`

**Step 1: Add imports at the top of the file**

After the existing imports, add:

```tsx
import { CommissionHeroBanner, CommissionHeroBannerSkeleton } from "@/components/crm/CommissionHeroBanner";
import { AGENT_META_BY_SLUG } from "@/lib/constants/agents";
import { formatDateRangeLabel } from "@/lib/utils/mock-date-filter";
```

Note: `formatDateRangeLabel` is already imported on line 9 — do not duplicate it.

**Step 2: Compute the commission inside `AgentPageContent`, right after `agent` is resolved**

In the `AgentPageContent` function, after the line:
```tsx
const agent = agents.find((a) => a.slug === slug);
```

Add:
```tsx
const meta             = AGENT_META_BY_SLUG[slug];
const commissionRate   = meta?.commissionRate ?? 0.01;
const commissionEarned = (agent?.totals.total_sales ?? 0) * commissionRate;
const periodLabel      = formatDateRangeLabel(dateFrom, dateTo);
```

**Step 3: Render the banner in the JSX**

In the return block of `AgentPageContent`, the section currently reads:

```tsx
{/* Loading */}
{isLoading && (
  <div className="space-y-4">
    <div className="h-32 animate-pulse rounded-xl bg-gray-100" />
    ...
  </div>
)}
```

Replace the entire loading skeleton block and everything below it with:

```tsx
      {/* Commission Hero — skeleton while loading */}
      {isLoading && <CommissionHeroBannerSkeleton />}

      {/* Commission Hero — live data */}
      {!isLoading && agent && (
        <CommissionHeroBanner
          agentName={AGENT_NAMES[slug] ?? slug}
          commissionEarned={commissionEarned}
          commissionRate={commissionRate}
          totalSales={agent.totals.total_sales}
          periodLabel={periodLabel}
        />
      )}

      {/* Loading (rest of content) */}
      {isLoading && (
        <div className="space-y-4">
          <div className="h-32 animate-pulse rounded-xl bg-gray-100" />
          <div className="h-72 animate-pulse rounded-xl bg-gray-100" />
          <div className="h-64 animate-pulse rounded-xl bg-gray-100" />
        </div>
      )}

      {/* Error */}
      {isError && (
        <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          Failed to load agent data. Try refreshing.
        </div>
      )}

      {/* No data for this agent */}
      {!isLoading && !isError && !agent && (
        <div className="rounded-xl border border-dashed border-gray-300 bg-gray-50 py-16 text-center text-sm text-muted-foreground">
          No data for {AGENT_NAMES[slug]} in the selected period.
        </div>
      )}

      {/* Agent detail */}
      {!isLoading && agent && (
        <AgentDetailPanel agent={agent} />
      )}
```

**Step 4: Verify TypeScript**

```bash
npx tsc --noEmit
```
Expected: no errors.

**Step 5: Start the dev server and visually verify**

```bash
npm run dev
```

Open `http://localhost:3000/crm/individual/abid` — you should see the green hero banner above the KPI row.
Open `http://localhost:3000/crm/individual/rana` — rate pill should read "1.5% of revenue".
Change the date range — commission amount should update.

**Step 6: Commit**

```bash
git add "Tech/CEO-Cockpit/app/crm/individual/[slug]/page.tsx"
git commit -m "feat(crm): wire CommissionHeroBanner into agent dashboard"
```

---

### Task 4: Push to production

```bash
git push production main
```

Verify deploy completes via:
```bash
gh api repos/carismawellness/carisma-support/deployments --jq '.[0].environment'
```

Expected: `"Production"` status goes green within ~2 minutes.
