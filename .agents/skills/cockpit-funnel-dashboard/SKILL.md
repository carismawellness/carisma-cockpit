---
name: cockpit-funnel-dashboard
description: "Maintains the CEO Cockpit Funnel Dashboard — updating campaign data, heatmap metrics, and brand funnels when new campaigns are created or metrics change. Use this whenever campaigns are added/removed/updated across Spa, Aesthetics, or Slimming."
version: "1.0.0"
user-invocable: true
allowed-tools: Read, Write, Edit, Glob, Grep, Bash
argument-hint: "[update-campaigns|update-heatmap|update-funnels] [brand]"
metadata:
  author: Carisma
  agent-role: Cockpit Dashboard Maintainer
  runtime: Claude Code
  tags:
    - cockpit
    - funnel
    - dashboard
    - campaigns
    - ceo
  triggers:
    - "update funnel dashboard"
    - "new campaign"
    - "add campaign"
    - "update campaigns"
    - "funnel dashboard"
    - "cockpit funnel"
---

# Cockpit Funnel Dashboard — Maintenance Skill

You maintain the **Funnel Dashboard** in the CEO Cockpit (`/funnel` route). This dashboard gives the CEO a full-funnel view across all 3 brands (Spa, Aesthetics, Slimming) with three sections:

1. **Constraint Heatmap** — 8 metrics color-coded across brands
2. **Brand Funnels** — Lead → Booked → Showed per brand
3. **Campaign Drill-Down** — Per-campaign table with consolidating chart

## Dashboard Architecture

```
10-Tech/CEO-Cockpit/
├── app/funnel/page.tsx                          # Page route (DashboardShell wrapper)
├── components/funnel/
│   ├── ConstraintHeatmap.tsx                    # Section 1: metric × brand matrix
│   ├── BrandFunnelCard.tsx                      # Section 2: per-brand vertical funnel
│   ├── CampaignFunnelPanel.tsx                  # Section 3: campaign tables + charts
│   ├── CampaignFunnelCard.tsx                   # DEPRECATED — no longer used
│   └── ConstraintBadge.tsx                      # Pill badge for constraint display
├── lib/funnel/constraint-detection.ts           # Severity logic, benchmarks, types
└── lib/charts/config.ts                         # Brand colors, formatters
```

## Brand Colors

```ts
chartColors = {
  spa: "#B79E61",        // warm gold
  aesthetics: "#96B2B2", // muted teal-blue
  slimming: "#8EB093",   // sage green
}
```

---

## Section 1: Constraint Heatmap

**File:** `components/funnel/ConstraintHeatmap.tsx`

Displays 8 metrics in full-funnel order with color-coded severity cells per brand.

### Metric Order (reflects funnel flow)

| # | Metric | Unit | Benchmark | Formatting |
|---|--------|------|-----------|------------|
| 1 | Ad Refresh | d | ≤14d | `{value}d` |
| 2 | Daily Leads | — | none | `.toLocaleString()` |
| 3 | Cost per Lead | € | ≤€12 | `€{value.toFixed(2)}` |
| 4 | Speed to Lead | m | ≤5m | `{value.toFixed(1)}m` |
| 5 | Leads/Day/Agent | — | 8 | `{value.toFixed(1)}` |
| 6 | Booking Conversion | % | 20% | `{value.toFixed(1)}%` |
| 7 | Deposit Rate | % | 70% | `{value.toFixed(1)}%` |
| 8 | Show Rate | % | 80% | `{value.toFixed(1)}%` |

### Severity Thresholds

| Metric | Green | Amber | Red |
|--------|-------|-------|-----|
| Ad Refresh | ≤14 days | 15-30 days | >30 days |
| Cost per Lead | ratio ≥ 1.0 | ratio ≥ 0.75 | ratio < 0.75 |
| Speed to Lead | ratio ≥ 1.0 | ratio ≥ 0.75 | ratio < 0.75 |
| Leads/Day/Agent | ≥8 | ≥5 | <5 |
| Booking Conversion | ≥20% | ≥15% | <15% |
| Deposit Rate | ratio ≥ 1.0 | ratio ≥ 0.75 | ratio < 0.75 |
| Show Rate | ratio ≥ 1.0 | ratio ≥ 0.75 | ratio < 0.75 |
| Zero values | — | — | Show as gray "-" with `off` severity |

### Data Structure

```ts
interface HeatmapRow {
  metric: string;
  unit: string;
  benchmark: number | null;
  values: Record<string, {
    value: number;
    severity: "green" | "amber" | "red" | "off";
  }>;
}
```

### How to Update

Edit the `HEATMAP_DATA` array in `ConstraintHeatmap.tsx`. Each row has values for `spa`, `aesthetics`, and `slimming`. Use the severity functions from `constraint-detection.ts`:

- `severityColor(benchmark, actual)` — generic ratio-based
- `overallConversionSeverity(pct)` — booking conversion (20/15 thresholds)
- `leadsPerAgentSeverity(val)` — leads/day/agent (8/5 thresholds)
- `adRefreshSeverity(days)` — ad refresh (14/30 thresholds, local function)

---

## Section 2: Brand Funnels

**File:** `components/funnel/BrandFunnelCard.tsx`

Shows a simplified 3-stage funnel per brand: **Lead → Booked → Showed**.

### Stage Data

Each brand has a `FunnelStage[]` array and an `agentCount`:

```ts
// Example: Spa
const SPA_STAGES: FunnelStage[] = [
  { label: "Lead", value: 420, conversionPct: null },
  { label: "Booked", value: 96, conversionPct: 22.9 },
  { label: "Showed", value: 82, conversionPct: 85.4 },
];
```

**Key fields:**
- `conversionPct` on "Booked" = `(booked / leads) * 100`
- `conversionPct` on "Showed" = `(showed / booked) * 100`
- `agentCount` — number of SDR agents for that brand (used for Leads/Day/Agent calc)

**Slimming has a split** below the funnel bars showing Regular Course vs Max Course with their own conversion percentages.

### KPI Pills

Two pills above the funnel bars:
1. **Conv Rate** — `(bottom_stage / top_stage) * 100`, benchmark 20%
2. **Leads/day/agent** — `leads / daysInPeriod / agentCount`, min 8

### How to Update

Edit the `SPA_STAGES`, `AESTHETICS_STAGES`, `SLIMMING_STAGES` arrays and `BRAND_FUNNELS` record in `BrandFunnelCard.tsx`. Ensure `conversionPct` values are mathematically consistent with the stage values.

---

## Section 3: Campaign Drill-Down

**File:** `components/funnel/CampaignFunnelPanel.tsx`

Per-brand campaign tables with a consolidating bar chart showing Conv % and Show % side-by-side.

### Campaign Data Structure

```ts
interface CampaignRow {
  campaignName: string;     // Short name (brand prefix removed)
  spend: number;            // EUR spend
  cpl: number;              // Cost per lead (spend / leads)
  leads: number;            // Total leads
  booked: number;           // Leads that booked
  showed: number;           // Bookings that showed up
  conversionPct: number;    // (booked / leads) * 100
  showRatePct: number;      // (showed / booked) * 100
  expectedRevenue: number;  // Expected EUR revenue from showed bookings
}
```

### Table Columns

| Column | Highlighted | Severity Logic |
|--------|-------------|----------------|
| Campaign | — | — |
| Conv % | Yes (brand color header) | ≥20% green, ≥15% amber, <15% red |
| Show % | Yes (brand color header) | ≥80% green, ≥65% amber, <65% red |
| CPL | — | Plain text |
| Spend | — | Plain text |
| Exp. Rev | — | Plain text |
| ROAS | Yes (severity colored) | ≥3.0x green, ≥2.0x amber, <2.0x red |

### Footer Row

The table includes a **Total / Avg** footer:
- Conv % = `(totalBooked / totalLeads) * 100`
- Show % = `(totalShowed / totalBooked) * 100`
- CPL = `totalSpend / totalLeads`
- Spend = sum
- Exp. Rev = sum
- ROAS = `totalExpRev / totalSpend`

### Consolidating Chart

A Recharts `BarChart` below each brand table showing Conv % (solid brand color) and Show % (brand color at 45% opacity) per campaign. Y-axis 0-100%.

### How to Add a New Campaign

1. Open `components/funnel/CampaignFunnelPanel.tsx`
2. Find the `CAMPAIGN_DATA` record
3. Add a new entry to the appropriate brand array:

```ts
{
  campaignName: "New Campaign Name",  // Keep short, no brand prefix
  spend: 500,                         // Total EUR spend
  cpl: 10.00,                         // spend / leads
  leads: 50,                          // Total leads generated
  booked: 12,                         // Leads that booked
  showed: 10,                         // Bookings that showed
  conversionPct: 24.0,                // (12/50) * 100
  showRatePct: 83.3,                  // (10/12) * 100
  expectedRevenue: 2_500,             // Expected revenue from those shows
},
```

4. Ensure mathematical consistency:
   - `cpl` = `spend / leads`
   - `conversionPct` = `(booked / leads) * 100`
   - `showRatePct` = `(showed / booked) * 100`
   - ROAS is computed automatically as `expectedRevenue / spend`

5. Update the **heatmap** and **brand funnel** totals if the new campaign changes aggregate numbers.

### How to Remove a Campaign

Delete the entry from the `CAMPAIGN_DATA` array for the relevant brand. Update aggregates in heatmap and brand funnels.

---

## Severity System

**File:** `lib/funnel/constraint-detection.ts`

### Tailwind Classes

```ts
severityClasses = {
  green: { bg: "bg-emerald-50", text: "text-emerald-700", border: "border-emerald-200", dot: "bg-emerald-500" },
  amber: { bg: "bg-amber-50", text: "text-amber-700", border: "border-amber-200", dot: "bg-amber-500" },
  red:   { bg: "bg-red-50", text: "text-red-700", border: "border-red-200", dot: "bg-red-500" },
  off:   { bg: "bg-gray-50", text: "text-gray-400", border: "border-gray-200", dot: "bg-gray-300" },
}
```

### Key Constants

- `OVERALL_CONVERSION_BENCHMARK = 20` (20% lead → booking)
- `LEADS_PER_DAY_PER_AGENT_MIN = 8`
- `STAGE_BENCHMARKS` — stage-level conversion benchmarks (used by `detectConstraint()`)

---

## Cross-Section Consistency Checklist

When updating campaign data, ensure these stay in sync:

1. **Heatmap "Daily Leads"** should reflect the sum of leads across all campaigns for each brand divided by days in period
2. **Heatmap "Cost per Lead"** should reflect weighted average CPL across campaigns
3. **Heatmap "Booking Conversion"** should match `(total booked / total leads) * 100` across all campaigns
4. **Brand Funnel "Lead" value** should equal total leads across all campaigns for that brand
5. **Brand Funnel "Booked" value** should equal total booked across all campaigns
6. **Brand Funnel "Showed" value** should equal total showed across all campaigns

---

## Non-Negotiable Rules

1. **ALWAYS keep `conversionPct`, `showRatePct`, and `cpl` mathematically consistent** with `leads`, `booked`, `showed`, and `spend`.
2. **NEVER change severity thresholds** without CEO approval — these are business benchmarks.
3. **ALWAYS run `npx tsc --noEmit`** after edits to verify type safety.
4. **ALWAYS update all 3 sections** (heatmap, brand funnels, campaign tables) when campaign data changes to keep aggregates consistent.
5. **Campaign names should be short** — no brand prefix (e.g., "Deep Tissue Promo" not "Spa - Deep Tissue Promo").
6. **Tables are sorted by spend descending** automatically.
7. **ROAS is computed, not stored** — it's calculated as `expectedRevenue / spend` in the render.
