# Sales Dashboard Design

**Date:** 2026-04-18
**Status:** Approved

## Navigation Structure

Sales gets nested sub-pages in the sidebar, matching the existing CRM/Finance/HR/Operations pattern:

```
Sales (top-level)
├── General    → /sales          (company-wide overview, default)
├── Spa        → /sales/spa
├── Aesthetics → /sales/aesthetics
└── Slimming   → /sales/slimming
```

## General Dashboard (`/sales`)

### KPI Summary Cards (Top Row)

Each card shows current value + YoY % change in the same box:

| Card | Value | YoY Comparison |
|------|-------|----------------|
| Total Net Revenue | EUR sum | % vs same period last year |
| Services Revenue | EUR sum | % vs LY |
| Retail Revenue | EUR sum + % of total | % vs LY |
| Add-on Revenue | EUR sum + % of total | % vs LY |
| Avg Revenue / Available Hour | EUR | % vs LY |
| Spa Club Memberships | member count | % vs LY |
| Hotel Guest Capture Rate | % | delta vs LY |
| Local Guest % | % | delta vs LY |

### Visualization 1: Revenue by Hotel (Stacked Bar + Line)

Stacked bar chart per hotel location:
- Bar 1 (bottom): Service revenue
- Bar 2 (middle): Retail revenue
- Bar 3 (top): Add-on revenue
- Line overlay: Last year's total revenue for same period
- YoY delta highlighted per hotel (green/red badge)

Date-filter driven — no hardcoded weekly/monthly assumptions.

### Visualization 2: Average Order Value by Location

- Bar chart: AOV per hotel for selected period
- Line overlay: Last year's AOV
- YoY delta labels per location

### Visualization 3: Staff Performance

- Retail revenue by staff member (horizontal bar)
- Service revenue by staff member (horizontal bar)
Side-by-side or tabbed within one card.

## Spa Sub-Dashboard (`/sales/spa`)

Inherits all General dashboard KPIs + visualizations, filtered to Spa brand only. Same cards, same charts — brand filter locked to "Spa."

## Aesthetics Sub-Dashboard (`/sales/aesthetics`)

### KPI Summary Cards

| Card | Notes |
|------|-------|
| Total Net Revenue | + YoY |
| Services Revenue | + YoY |
| Retail Revenue + % of total | + YoY |
| Avg Revenue / Available Hour | + YoY |
| Total Active Members | + YoY |
| Repeat Customer % | count + % of business |

No add-ons, no capture rate, no location breakdown.

### Funnel Visualization

Horizontal/vertical funnel:
- New Leads → Consultations → Bookings
- Each step: count + conversion rate to next step
- Show rates: consultation show rate, booking show rate

### Additional Metrics

- Consultation Conversion Rate
- Service Revenue Breakdown (by service type)
- Average Order Value

## Slimming Sub-Dashboard (`/sales/slimming`)

### KPI Summary Cards

| Card | Notes |
|------|-------|
| Total Service Revenue | + YoY |
| Retail Revenue | + YoY |
| Avg Revenue / Available Hour | + YoY |
| Total Active Members | + YoY |
| Consultation → Retail Conversion | % |
| Medical Doctor Conversion Rate | % |

### Funnel Visualization

Extended funnel with course-type split:
- Leads → Consultations Calendared → Consultations Attended → Bookings
- Split at booking: Regular Course vs Max Course (separate conversion rates)
- Show rates: consultation show rate, booking show rate

## Data Architecture

Deferred — UI built with mock data first. Data wiring comes after.

## Component Strategy

| Need | Approach |
|------|----------|
| KPI cards with YoY | Extend existing KPICard.tsx |
| Stacked bar + line combo | New ComposedChart component (Recharts) |
| Funnel visualization | New FunnelChart component |
| Staff performance bars | New horizontal BarChart component |
| Data tables | Reuse DataTable.tsx |
| Grid layout | Reuse KPICardRow.tsx |
