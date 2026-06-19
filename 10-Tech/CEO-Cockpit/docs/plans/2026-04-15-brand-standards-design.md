# Brand Standards Dashboard — Design Document

**Date:** 2026-04-15
**Status:** Approved

## Overview

A new dashboard page inside the CEO Cockpit at `/brand-standards` that visualizes facility audits, front desk compliance, and mystery guest scores across all Carisma Spa locations. Data is pulled from the Accounting Master Google Sheet, ETL'd into Supabase, and rendered with executive-quality Recharts visualizations.

## Data Source

**Google Sheet:** Accounting Master (`1WWM7W6S5wtSC-5hdlcuJgW3zbYaO7YRgg4_-Bju4-5s`)

Six source tabs merged into three standard types:

| Standard Type | Sheet Tab(s) | Time Range |
|---|---|---|
| `facility` | Facility standards, Facility standards 25, Facility standards 26 | Aug 2024 → present |
| `front_desk` | Front desk standards, Front desk standards 25, Front desk standards 26 | Aug 2024 → present |
| `mystery_guest` | Mystery guest standards, Mystery guest standards 25 from AUGUST to 2026 | Aug 2024 → present |

### Data Structure

Each tab follows the same matrix layout:
- **Row 1:** Month headers spanning multiple location columns
- **Row 2:** Location names (Inter, Hugos, Hyatt, Ramla, Labranda, Sunny, etc.)
- **Row 3:** Overall percentage scores per location
- **Rows 4+:** Checklist items with TRUE/FALSE values; section headers (categories) are rows with text but no values

### Locations

Inter(Continental), Hugos, Hyatt, Ramla, Labranda, Sunny, Excelsior, Novotel, Riviera

## Data Layer

### Supabase Table: `brand_standards`

```sql
CREATE TABLE brand_standards (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  month DATE NOT NULL,                    -- First of month (2024-08-01)
  standard_type TEXT NOT NULL,            -- facility | front_desk | mystery_guest
  category TEXT NOT NULL,                 -- Section header (SPA RECEPTION, INVENTORY, etc.)
  item TEXT NOT NULL,                     -- Checklist question
  location TEXT NOT NULL,                 -- Hotel name
  result BOOLEAN NOT NULL,               -- TRUE = pass, FALSE = fail
  created_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(month, standard_type, item, location)
);

CREATE INDEX idx_brand_standards_month ON brand_standards(month);
CREATE INDEX idx_brand_standards_type ON brand_standards(standard_type);
CREATE INDEX idx_brand_standards_location ON brand_standards(location);
```

### ETL Script: `etl/etl_brand_standards.py`

- Reads all 6 sheet tabs via Google Sheets API
- Parses month headers from row 1, location names from row 2
- Walks rows 4+ to extract checklist items; rows with text but no TRUE/FALSE values = category headers
- Normalizes into flat `(month, standard_type, category, item, location, result)` rows
- Upserts to Supabase with merge-duplicates
- Handles edge cases: empty cells, "FALSE" strings, missing months

## Frontend Architecture

### Page: `/app/brand-standards/page.tsx`

Uses `DashboardShell` wrapper with render function pattern (consistent with all other dashboards). Overrides the default DateRangePicker with a monthly MonthPicker.

### Components

```
components/brand-standards/
├── BrandStandardsContent.tsx    # Main content: tabs + month picker + location filter
├── StandardTab.tsx              # Reusable tab layout (KPIs + charts + table)
├── MonthPicker.tsx              # Month-by-month navigation (< Jan 2026 >)
├── ComplianceHeatmap.tsx        # Horizontal bar chart: location scores
├── TrendChart.tsx               # Multi-line chart: scores over time
├── CategoryBreakdown.tsx        # Grouped bar: compliance by category
├── ChecklistTable.tsx           # Detail table with green/red pass/fail dots
└── TreatmentFunnel.tsx          # Mystery guest journey progression chart
```

### Monthly Navigation (MonthPicker)

- Left/right arrows to step month-by-month
- Dropdown for quick jump to any available month
- Displays: "January 2026" format
- Only allows navigation to months with data
- Replaces the default DateRangePicker for this dashboard

### Location Filter

Repurposes the brand filter area. Buttons: "All" | "Inter" | "Hugos" | "Hyatt" | etc.

### Tab Structure

Three tabs via shadcn `Tabs`: **Facility Standards** | **Front Desk Standards** | **Mystery Guest**

Each tab follows the same layout:

#### 1. KPI Card Row (5 cards)
- Overall Score % (company-wide, selected month)
- Best Location (name + %)
- Worst Location (name + %)
- Month-over-Month Change (delta with trend arrow)
- Items Below 50% (problem area count)

#### 2. Location Compliance Heatmap
Horizontal bar chart. Each bar = one location's overall score for the month.
- Green: >85%
- Amber: 60-85%
- Red: <60%

#### 3. Trend Over Time
Line chart with one line per location, showing monthly compliance scores across all available months. Highlights selected month.

#### 4. Category Breakdown
Grouped bar chart showing compliance % per category for the selected month. Reveals weakest operational areas.

#### 5. Checklist Detail Table
DataTable with:
- Item description (left column)
- One column per location with green/red dot (pass/fail)
- Category grouping with collapsible sections
- Overall pass rate per item

#### Mystery Guest Extra: Treatment Journey Funnel
Shows compliance % at each stage: Welcome → Consultation → Initiation → Treatment → End → Post-Treatment. Reveals where guest experience drops off.

### Data Hook: `useBrandStandards`

```typescript
function useBrandStandards({
  standardType: string,
  month: Date,
  location: string | null
}) => { data, loading, error, availableMonths }
```

Queries `brand_standards` table filtered by type and month. Returns flat array of checklist results plus computed aggregations.

## Visualization Principles

- Use Recharts (consistent with all other dashboards)
- Brand colors from `lib/charts/config.ts`
- Green/amber/red health indicators for compliance levels
- Responsive grids: full-width charts on mobile, 2-column on desktop where appropriate
- Tooltips show exact values and item names
- All charts have descriptive titles and subtitles

## Sidebar Navigation

Add to `lib/constants/departments.ts`:
```typescript
{ slug: "brand-standards", label: "Brand Standards", icon: ClipboardCheck, path: "/brand-standards" }
```

## Success Criteria

1. ETL successfully pulls all historical data from 6 sheet tabs into Supabase
2. Dashboard renders with 3 tabs, each showing KPIs, charts, and detail table
3. MonthPicker navigates between available months
4. Location filter filters all visualizations
5. Charts are executive-quality (clean, readable, properly colored)
6. Page follows existing cockpit patterns (DashboardShell, React Query, Recharts)
