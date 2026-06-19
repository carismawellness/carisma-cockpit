# Brand Standards Dashboard — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Build a fully functional Brand Standards dashboard inside the CEO Cockpit at `/brand-standards` with 3 tabs (Facility, Front Desk, Mystery Guest), monthly navigation, location filtering, and executive-quality Recharts visualizations — all backed by a Supabase table populated via ETL from the Accounting Master Google Sheet.

**Architecture:** ETL Python script reads 6 Google Sheet tabs, normalizes TRUE/FALSE checklist data into a flat `brand_standards` Supabase table, and the Next.js dashboard page queries it via React Query. Reuses existing DashboardShell, KPICardRow, DataTable, and Recharts patterns.

**Tech Stack:** Next.js 16 (App Router), React 19, Recharts 3.8, Supabase, Tailwind CSS 4, shadcn/ui, date-fns, Python 3.11 (ETL)

**Design doc:** `docs/plans/2026-04-15-brand-standards-design.md`

---

## Task 1: Create Supabase table

**Files:**
- Create: `Tech/CEO-Cockpit/supabase/migrations/20260415_brand_standards.sql`

**Step 1: Write the migration SQL**

```sql
-- 20260415_brand_standards.sql
CREATE TABLE IF NOT EXISTS brand_standards (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  month DATE NOT NULL,
  standard_type TEXT NOT NULL CHECK (standard_type IN ('facility', 'front_desk', 'mystery_guest')),
  category TEXT NOT NULL,
  item TEXT NOT NULL,
  location TEXT NOT NULL,
  result BOOLEAN NOT NULL,
  created_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(month, standard_type, item, location)
);

CREATE INDEX IF NOT EXISTS idx_brand_standards_month ON brand_standards(month);
CREATE INDEX IF NOT EXISTS idx_brand_standards_type ON brand_standards(standard_type);
CREATE INDEX IF NOT EXISTS idx_brand_standards_location ON brand_standards(location);

-- RLS: allow authenticated reads
ALTER TABLE brand_standards ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Allow authenticated read" ON brand_standards FOR SELECT TO authenticated USING (true);
```

**Step 2: Run the migration against Supabase**

Run from project root:
```bash
cd Tech/CEO-Cockpit && npx supabase db push
```

If `supabase` CLI is not configured, run the SQL directly via the Supabase dashboard SQL editor at the project URL.

**Step 3: Verify table exists**

Check: query `SELECT * FROM brand_standards LIMIT 1;` — should return empty result, no error.

**Step 4: Commit**

```bash
git add supabase/migrations/20260415_brand_standards.sql
git commit -m "feat(cockpit): add brand_standards table migration"
```

---

## Task 2: Add brand_standards config to cockpit_sources.json

**Files:**
- Modify: `Config/cockpit_sources.json`

**Step 1: Add the brand_standards sheet config**

Add this entry inside `"google_sheets"`, after the `"ebitda"` block (since it uses the same spreadsheet):

```json
"brand_standards": {
  "spreadsheet_id": "1WWM7W6S5wtSC-5hdlcuJgW3zbYaO7YRgg4_-Bju4-5s",
  "title": "Brand Standards (Accounting Master)",
  "tabs": {
    "facility_24": { "tab_name": "Facility standards", "standard_type": "facility" },
    "facility_25": { "tab_name": "Facility standards 25", "standard_type": "facility" },
    "facility_26": { "tab_name": "Facility standards 26", "standard_type": "facility" },
    "front_desk_24": { "tab_name": "Front desk standards", "standard_type": "front_desk" },
    "front_desk_25": { "tab_name": "Front desk standards 25", "standard_type": "front_desk" },
    "front_desk_26": { "tab_name": "Front desk standards 26", "standard_type": "front_desk" },
    "mystery_guest_24": { "tab_name": "Mystery guest standards", "standard_type": "mystery_guest" },
    "mystery_guest_25_26": { "tab_name": "Mystery guest standards 25 from AUGUST to 2026", "standard_type": "mystery_guest" }
  }
}
```

**Step 2: Commit**

```bash
git add Config/cockpit_sources.json
git commit -m "feat(cockpit): add brand_standards sheet config"
```

---

## Task 3: Write ETL script

**Files:**
- Create: `Tech/CEO-Cockpit/etl/etl_brand_standards.py`

**Step 1: Write the ETL script**

This script follows the existing ETL pattern: imports from `shared/`, uses `ETLLogger`, calls `upsert()`.

```python
"""
ETL: Brand Standards (Facility, Front Desk, Mystery Guest) -> Supabase
Reads: Accounting Master Google Sheet (6 tabs)
Writes: brand_standards
Schedule: 1st of month 08:00 (or on-demand)
"""
import re
from datetime import datetime
from shared.supabase_client import upsert
from shared.etl_logger import ETLLogger
from shared.etl_config import get_sheet_config

# Month name patterns for parsing headers
_MONTH_NAMES = {
    'january': 1, 'february': 2, 'march': 3, 'april': 4,
    'may': 5, 'june': 6, 'july': 7, 'august': 8,
    'september': 9, 'october': 10, 'november': 11, 'december': 12,
    'jan': 1, 'feb': 2, 'mar': 3, 'apr': 4,
    'jun': 6, 'jul': 7, 'aug': 8, 'sep': 9, 'oct': 10, 'nov': 11, 'dec': 12,
}

# Location name normalization
_LOCATION_ALIASES = {
    'inter': 'Inter',
    'intercontinental': 'Inter',
    'hugos': 'Hugos',
    "hugo's": 'Hugos',
    'hyatt': 'Hyatt',
    'ramla': 'Ramla',
    'labranda': 'Labranda',
    'sunny': 'Sunny',
    'excelsior': 'Excelsior',
    'novotel': 'Novotel',
    'riviera': 'Riviera',
    'odycy': 'Odycy',
}


def _parse_month_header(header: str) -> str | None:
    """Parse a month header like 'August 2024' or 'January 2025' into '2024-08-01'."""
    if not header or not isinstance(header, str):
        return None
    header = header.strip()
    match = re.match(r'(\w+)\s+(\d{4})', header)
    if match:
        month_str = match.group(1).lower()
        year = int(match.group(2))
        month_num = _MONTH_NAMES.get(month_str)
        if month_num:
            return f"{year}-{month_num:02d}-01"
    return None


def _normalize_location(name: str) -> str | None:
    """Normalize location name to canonical form."""
    if not name or not isinstance(name, str):
        return None
    cleaned = name.strip().lower()
    return _LOCATION_ALIASES.get(cleaned)


def _is_bool_value(val) -> bool:
    """Check if a cell value is a TRUE/FALSE boolean."""
    if isinstance(val, bool):
        return True
    if isinstance(val, str):
        return val.strip().upper() in ('TRUE', 'FALSE')
    return False


def _parse_bool(val) -> bool | None:
    """Parse a cell value to boolean."""
    if isinstance(val, bool):
        return val
    if isinstance(val, str):
        upper = val.strip().upper()
        if upper == 'TRUE':
            return True
        if upper == 'FALSE':
            return False
    return None


def _process_tab(raw: list[list], standard_type: str) -> list[dict]:
    """Process a single sheet tab into brand_standards rows.
    
    Sheet layout:
    - Row 0 (or 1): Month headers spanning multiple location columns
    - Row 1 (or 2): Location names under each month
    - Row 2 (or 3): Overall % scores (skip these)
    - Rows 3+: Checklist items with TRUE/FALSE per location
    - Section headers: rows with text in col A or B but no TRUE/FALSE values
    """
    if not raw or len(raw) < 4:
        return []

    # Detect header rows — find the row with month names and the row with locations
    month_row_idx = None
    location_row_idx = None
    
    for i in range(min(3, len(raw))):
        row = raw[i]
        # Check if this row has month-like headers
        month_count = sum(1 for cell in row if _parse_month_header(str(cell)) is not None)
        if month_count >= 1:
            month_row_idx = i
            break
    
    if month_row_idx is None:
        return []
    
    # Location row is the next row after month row
    location_row_idx = month_row_idx + 1
    if location_row_idx >= len(raw):
        return []
    
    # Build column-to-(month, location) mapping
    month_row = raw[month_row_idx]
    location_row = raw[location_row_idx]
    
    col_map: dict[int, tuple[str, str]] = {}  # col_idx -> (month_date, location_name)
    current_month = None
    
    for col_idx in range(len(month_row)):
        # Check if this column has a new month header
        month_val = _parse_month_header(str(month_row[col_idx])) if col_idx < len(month_row) else None
        if month_val:
            current_month = month_val
        
        # Get location from location row
        if current_month and col_idx < len(location_row):
            loc = _normalize_location(str(location_row[col_idx]))
            if loc:
                col_map[col_idx] = (current_month, loc)
    
    if not col_map:
        return []
    
    # Process data rows (skip month, location, and percentage rows)
    data_start = location_row_idx + 2  # Skip location row and percentage row
    current_category = "General"
    rows = []
    
    for row_idx in range(data_start, len(raw)):
        row = raw[row_idx]
        if not row:
            continue
        
        # Get the item text (could be in column 0 or 1)
        item_text = ''
        for col in range(min(2, len(row))):
            cell = str(row[col]).strip()
            if cell and cell not in ('', 'FALSE', 'TRUE'):
                item_text = cell
                break
        
        if not item_text:
            continue
        
        # Check if this is a category header (has text but no TRUE/FALSE values in data columns)
        has_bool_data = False
        for col_idx in col_map:
            if col_idx < len(row) and _is_bool_value(row[col_idx]):
                has_bool_data = True
                break
        
        if not has_bool_data:
            # This is a category header or sub-header
            # Clean up: remove trailing colons, numbers, percentages
            cleaned = re.sub(r'[:\d%]+$', '', item_text).strip()
            if cleaned and len(cleaned) > 2:
                current_category = cleaned
            continue
        
        # This is a checklist item — extract TRUE/FALSE per location
        for col_idx, (month_date, location) in col_map.items():
            if col_idx < len(row):
                result = _parse_bool(row[col_idx])
                if result is not None:
                    rows.append({
                        'month': month_date,
                        'standard_type': standard_type,
                        'category': current_category,
                        'item': item_text[:500],  # Truncate very long items
                        'location': location,
                        'result': result,
                    })
    
    return rows


def run(sheet_data: dict[str, list[list]]) -> dict:
    """Main ETL entry point. Called with pre-fetched sheet data."""
    logger = ETLLogger('brand_standards')
    logger.start()
    total = 0
    
    try:
        cfg = get_sheet_config('brand_standards')
        tabs = cfg.get('tabs', {})
        
        for tab_key, tab_cfg in tabs.items():
            tab_name = tab_cfg['tab_name']
            standard_type = tab_cfg['standard_type']
            
            if tab_name not in sheet_data:
                continue
            
            raw = sheet_data[tab_name]
            rows = _process_tab(raw, standard_type)
            
            if rows:
                count = upsert('brand_standards', rows, 'month,standard_type,item,location')
                total += count
        
        logger.complete(total)
        return {'rows_upserted': total, 'status': 'success'}
    
    except Exception as e:
        logger.fail(str(e))
        return {'rows_upserted': total, 'status': 'failed', 'error': str(e)}


def run_standalone():
    """Run ETL directly using Google Sheets MCP or API.
    
    For standalone execution: reads sheet data via google-workspace MCP,
    then calls run() with the data.
    """
    import os
    from supabase import create_client
    from dotenv import load_dotenv
    
    load_dotenv(os.path.join(os.path.dirname(__file__), '..', '.env.local'))
    
    # This would be called via the MCP or Apps Script — for manual runs,
    # use the Google Sheets API directly
    print("Use 'python -m etl.etl_brand_standards' or trigger via Apps Script")
    print("For manual backfill, call run() with sheet_data dict")


if __name__ == '__main__':
    run_standalone()
```

**Step 2: Commit**

```bash
git add etl/etl_brand_standards.py
git commit -m "feat(cockpit): add brand_standards ETL script"
```

---

## Task 4: Run initial data load

**Files:**
- No new files — uses MCP tools to read sheets and the ETL script to process

**Step 1: Read all sheet data via Google Workspace MCP**

Use `mcp__google-workspace__sheets_read_values` to read all 8 tabs from spreadsheet `1WWM7W6S5wtSC-5hdlcuJgW3zbYaO7YRgg4_-Bju4-5s`. Read full range (A1:AZ100) for each:
- `Facility standards!A1:AZ100`
- `Facility standards 25!A1:AZ100`
- `Facility standards 26!A1:AZ100`
- `Front desk standards!A1:AZ100`
- `Front desk standards 25!A1:AZ100`
- `Front desk standards 26!A1:AZ100`
- `Mystery guest standards!A1:AZ100`
- `Mystery guest standards 25 from AUGUST to 2026!A1:AZ100`

**Step 2: Process and insert via Supabase**

Use the ETL logic to transform the data and upsert into `brand_standards` table. Can be done via a one-off Python script or by directly inserting via Supabase MCP/API.

**Step 3: Verify data**

Query: `SELECT standard_type, COUNT(*), COUNT(DISTINCT month), COUNT(DISTINCT location) FROM brand_standards GROUP BY standard_type;`

Expected: ~3 rows showing facility, front_desk, mystery_guest with hundreds of records each across multiple months and locations.

**Step 4: Commit** (no files changed — data load only)

---

## Task 5: Add Brand Standards to sidebar navigation

**Files:**
- Modify: `Tech/CEO-Cockpit/lib/constants/departments.ts`

**Step 1: Add the import and entry**

Add `ClipboardCheck` to the lucide-react import, and add a new entry to the departments array:

In the import line, add `ClipboardCheck`:
```typescript
import {
  LayoutDashboard,
  Megaphone,
  DollarSign,
  Headphones,
  PiggyBank,
  Users,
  UserRound,
  Settings,
  Activity,
  ClipboardCheck,
  type LucideIcon,
} from "lucide-react";
```

Add to the `departments` array (after "operations", before "customers"):
```typescript
{ slug: "brand-standards", label: "Brand Standards", icon: ClipboardCheck, path: "/brand-standards" },
```

**Step 2: Verify sidebar renders**

Run: `cd Tech/CEO-Cockpit && npm run dev`
Check: sidebar shows "Brand Standards" link between Operations and Customers.

**Step 3: Commit**

```bash
git add lib/constants/departments.ts
git commit -m "feat(cockpit): add Brand Standards to sidebar nav"
```

---

## Task 6: Create MonthPicker component

**Files:**
- Create: `Tech/CEO-Cockpit/components/brand-standards/MonthPicker.tsx`

**Step 1: Write the component**

```tsx
"use client";

import { useState } from "react";
import { format, addMonths, subMonths } from "date-fns";
import { ChevronLeft, ChevronRight, CalendarDays } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";

interface MonthPickerProps {
  value: Date;
  onChange: (month: Date) => void;
  availableMonths?: Date[];
}

export function MonthPicker({ value, onChange, availableMonths }: MonthPickerProps) {
  const [yearView, setYearView] = useState(value.getFullYear());
  const [open, setOpen] = useState(false);

  const months = [
    "Jan", "Feb", "Mar", "Apr", "May", "Jun",
    "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
  ];

  function isAvailable(year: number, monthIdx: number): boolean {
    if (!availableMonths || availableMonths.length === 0) return true;
    return availableMonths.some(
      (d) => d.getFullYear() === year && d.getMonth() === monthIdx
    );
  }

  function handlePrev() {
    onChange(subMonths(value, 1));
  }

  function handleNext() {
    const next = addMonths(value, 1);
    if (next <= new Date()) {
      onChange(next);
    }
  }

  function handleSelect(monthIdx: number) {
    onChange(new Date(yearView, monthIdx, 1));
    setOpen(false);
  }

  return (
    <div className="flex items-center gap-1">
      <Button
        variant="ghost"
        size="icon"
        className="h-8 w-8 text-text-secondary hover:text-gold"
        onClick={handlePrev}
      >
        <ChevronLeft className="h-4 w-4" />
      </Button>

      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger className="inline-flex items-center gap-2 rounded-lg border border-warm-border bg-white px-3 py-1.5 text-sm font-medium text-charcoal hover:border-gold/30 transition-colors">
          <CalendarDays className="h-4 w-4 text-gold" />
          {format(value, "MMMM yyyy")}
        </PopoverTrigger>
        <PopoverContent className="w-64 p-3" align="start">
          <div className="flex items-center justify-between mb-3">
            <Button
              variant="ghost"
              size="icon"
              className="h-7 w-7"
              onClick={() => setYearView(yearView - 1)}
            >
              <ChevronLeft className="h-4 w-4" />
            </Button>
            <span className="text-sm font-semibold">{yearView}</span>
            <Button
              variant="ghost"
              size="icon"
              className="h-7 w-7"
              onClick={() => setYearView(yearView + 1)}
            >
              <ChevronRight className="h-4 w-4" />
            </Button>
          </div>
          <div className="grid grid-cols-3 gap-1">
            {months.map((m, idx) => {
              const isSelected =
                value.getFullYear() === yearView && value.getMonth() === idx;
              const available = isAvailable(yearView, idx);
              return (
                <button
                  key={m}
                  disabled={!available}
                  onClick={() => handleSelect(idx)}
                  className={`px-2 py-1.5 rounded-md text-xs font-medium transition-all ${
                    isSelected
                      ? "bg-gold text-white"
                      : available
                      ? "text-text-secondary hover:bg-warm-gray hover:text-charcoal"
                      : "text-gray-300 cursor-not-allowed"
                  }`}
                >
                  {m}
                </button>
              );
            })}
          </div>
        </PopoverContent>
      </Popover>

      <Button
        variant="ghost"
        size="icon"
        className="h-8 w-8 text-text-secondary hover:text-gold"
        onClick={handleNext}
      >
        <ChevronRight className="h-4 w-4" />
      </Button>
    </div>
  );
}
```

**Step 2: Commit**

```bash
git add components/brand-standards/MonthPicker.tsx
git commit -m "feat(cockpit): add MonthPicker component for brand standards"
```

---

## Task 7: Create LocationFilter component

**Files:**
- Create: `Tech/CEO-Cockpit/components/brand-standards/LocationFilter.tsx`

**Step 1: Write the component**

```tsx
"use client";

import { cn } from "@/lib/utils";

const LOCATIONS = [
  "Inter", "Hugos", "Hyatt", "Ramla",
  "Labranda", "Sunny", "Excelsior", "Novotel",
  "Riviera", "Odycy",
];

interface LocationFilterProps {
  selected: string | null;
  onChange: (location: string | null) => void;
  availableLocations?: string[];
}

export function LocationFilter({ selected, onChange, availableLocations }: LocationFilterProps) {
  const locations = availableLocations || LOCATIONS;

  return (
    <div className="flex items-center gap-1 bg-warm-gray rounded-lg p-1 flex-wrap">
      <button
        onClick={() => onChange(null)}
        className={cn(
          "px-3 py-1.5 rounded-md text-xs font-medium transition-all",
          selected === null
            ? "bg-gold text-white shadow-sm"
            : "text-text-secondary hover:text-charcoal"
        )}
      >
        All
      </button>
      {locations.map((loc) => (
        <button
          key={loc}
          onClick={() => onChange(loc)}
          className={cn(
            "px-2 py-1.5 rounded-md text-xs font-medium transition-all",
            selected === loc
              ? "bg-gold text-white shadow-sm"
              : "text-text-secondary hover:text-charcoal"
          )}
        >
          {loc}
        </button>
      ))}
    </div>
  );
}
```

**Step 2: Commit**

```bash
git add components/brand-standards/LocationFilter.tsx
git commit -m "feat(cockpit): add LocationFilter component for brand standards"
```

---

## Task 8: Create useBrandStandards hook

**Files:**
- Create: `Tech/CEO-Cockpit/lib/hooks/useBrandStandards.ts`

**Step 1: Write the hook**

```typescript
"use client";

import { useQuery } from "@tanstack/react-query";
import { createClient } from "@/lib/supabase/client";
import { format, startOfMonth, endOfMonth } from "date-fns";

interface BrandStandardsRow {
  id: string;
  month: string;
  standard_type: string;
  category: string;
  item: string;
  location: string;
  result: boolean;
}

interface UseBrandStandardsOptions {
  standardType: string;
  month: Date;
  location: string | null;
}

export function useBrandStandards({ standardType, month, location }: UseBrandStandardsOptions) {
  const monthStr = format(startOfMonth(month), "yyyy-MM-dd");

  const queryResult = useQuery({
    queryKey: ["brand_standards", standardType, monthStr, location],
    queryFn: async () => {
      const supabase = createClient();
      let query = supabase
        .from("brand_standards")
        .select("*")
        .eq("standard_type", standardType)
        .eq("month", monthStr);

      if (location) {
        query = query.eq("location", location);
      }

      const { data, error } = await query;
      if (error) throw new Error(error.message);
      return (data as BrandStandardsRow[]) || [];
    },
  });

  // Compute available months (all months with data for this standard_type)
  const availableMonthsQuery = useQuery({
    queryKey: ["brand_standards_months", standardType],
    queryFn: async () => {
      const supabase = createClient();
      const { data, error } = await supabase
        .from("brand_standards")
        .select("month")
        .eq("standard_type", standardType)
        .order("month", { ascending: true });

      if (error) throw new Error(error.message);

      // Deduplicate months
      const unique = [...new Set((data || []).map((r) => r.month))];
      return unique.map((m) => new Date(m));
    },
    staleTime: 10 * 60 * 1000, // 10 minutes
  });

  return {
    data: queryResult.data || [],
    loading: queryResult.isLoading,
    error: queryResult.error?.message || null,
    availableMonths: availableMonthsQuery.data || [],
    availableMonthsLoading: availableMonthsQuery.isLoading,
  };
}

// ---- Aggregation helpers ----

export interface LocationScore {
  location: string;
  total: number;
  passed: number;
  score: number; // 0-100
}

export interface CategoryScore {
  category: string;
  total: number;
  passed: number;
  score: number;
}

export interface ChecklistItem {
  item: string;
  category: string;
  locations: Record<string, boolean>; // location -> pass/fail
  passRate: number;
}

export function computeLocationScores(data: BrandStandardsRow[]): LocationScore[] {
  const map = new Map<string, { total: number; passed: number }>();
  for (const row of data) {
    const entry = map.get(row.location) || { total: 0, passed: 0 };
    entry.total++;
    if (row.result) entry.passed++;
    map.set(row.location, entry);
  }
  return Array.from(map.entries())
    .map(([location, { total, passed }]) => ({
      location,
      total,
      passed,
      score: total > 0 ? Math.round((passed / total) * 100) : 0,
    }))
    .sort((a, b) => b.score - a.score);
}

export function computeCategoryScores(data: BrandStandardsRow[]): CategoryScore[] {
  const map = new Map<string, { total: number; passed: number }>();
  for (const row of data) {
    const entry = map.get(row.category) || { total: 0, passed: 0 };
    entry.total++;
    if (row.result) entry.passed++;
    map.set(row.category, entry);
  }
  return Array.from(map.entries())
    .map(([category, { total, passed }]) => ({
      category,
      total,
      passed,
      score: total > 0 ? Math.round((passed / total) * 100) : 0,
    }))
    .sort((a, b) => b.score - a.score);
}

export function computeChecklistItems(data: BrandStandardsRow[]): ChecklistItem[] {
  const map = new Map<string, { category: string; locations: Record<string, boolean> }>();
  for (const row of data) {
    if (!map.has(row.item)) {
      map.set(row.item, { category: row.category, locations: {} });
    }
    map.get(row.item)!.locations[row.location] = row.result;
  }
  return Array.from(map.entries()).map(([item, { category, locations }]) => {
    const values = Object.values(locations);
    const passRate = values.length > 0 ? Math.round((values.filter(Boolean).length / values.length) * 100) : 0;
    return { item, category, locations, passRate };
  });
}

export function computeOverallScore(data: BrandStandardsRow[]): number {
  if (data.length === 0) return 0;
  const passed = data.filter((r) => r.result).length;
  return Math.round((passed / data.length) * 100);
}
```

**Step 2: Commit**

```bash
git add lib/hooks/useBrandStandards.ts
git commit -m "feat(cockpit): add useBrandStandards hook with aggregation helpers"
```

---

## Task 9: Create StandardTab component (reusable tab content)

**Files:**
- Create: `Tech/CEO-Cockpit/components/brand-standards/StandardTab.tsx`

**Step 1: Write the component**

This is the core visualization component — renders KPIs, heatmap, trend, category breakdown, and detail table for any standard type.

```tsx
"use client";

import { useMemo } from "react";
import { Card } from "@/components/ui/card";
import { KPICardRow, KPIData } from "@/components/dashboard/KPICardRow";
import { chartDefaults } from "@/lib/charts/config";
import {
  useBrandStandards,
  computeLocationScores,
  computeCategoryScores,
  computeChecklistItems,
  computeOverallScore,
} from "@/lib/hooks/useBrandStandards";
import {
  BarChart,
  Bar,
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
  Cell,
  ReferenceLine,
} from "recharts";

// Location colors — distinct for each
const LOCATION_COLORS: Record<string, string> = {
  Inter: "#1B3A4B",
  Hugos: "#2A8A7A",
  Hyatt: "#B8943E",
  Ramla: "#E07A5F",
  Labranda: "#6B9080",
  Sunny: "#7C3AED",
  Excelsior: "#DC2626",
  Novotel: "#0EA5E9",
  Riviera: "#D946EF",
  Odycy: "#14B8A6",
};

function scoreColor(score: number): string {
  if (score >= 85) return "#22C55E";
  if (score >= 60) return "#F59E0B";
  return "#EF4444";
}

interface StandardTabProps {
  standardType: string;
  month: Date;
  location: string | null;
  allMonthsData?: Array<{ month: string; location: string; result: boolean }>;
}

export function StandardTab({ standardType, month, location }: StandardTabProps) {
  const { data, loading, error, availableMonths } = useBrandStandards({
    standardType,
    month,
    location,
  });

  // Also fetch all months for trend chart (unfiltered by location)
  const { data: allData } = useBrandStandards({
    standardType,
    month: new Date(2020, 0, 1), // Dummy — we use a different approach below
    location: null,
  });

  const locationScores = useMemo(() => computeLocationScores(data), [data]);
  const categoryScores = useMemo(() => computeCategoryScores(data), [data]);
  const checklistItems = useMemo(() => computeChecklistItems(data), [data]);
  const overallScore = useMemo(() => computeOverallScore(data), [data]);

  if (loading) {
    return (
      <div className="space-y-4">
        {[1, 2, 3].map((i) => (
          <div key={i} className="h-48 bg-warm-gray animate-pulse rounded-xl" />
        ))}
      </div>
    );
  }

  if (error) {
    return (
      <Card className="p-6">
        <p className="text-red-500">Error loading data: {error}</p>
      </Card>
    );
  }

  if (data.length === 0) {
    return (
      <Card className="p-6 text-center">
        <p className="text-muted-foreground">No data available for this month.</p>
      </Card>
    );
  }

  // KPI computations
  const bestLoc = locationScores[0];
  const worstLoc = locationScores[locationScores.length - 1];
  const belowThreshold = categoryScores.filter((c) => c.score < 50).length;

  const kpis: KPIData[] = [
    {
      label: "Overall Score",
      value: `${overallScore}%`,
      trend: overallScore >= 75 ? 1 : -1,
    },
    {
      label: "Best Location",
      value: bestLoc ? `${bestLoc.location} (${bestLoc.score}%)` : "—",
      trend: 1,
    },
    {
      label: "Worst Location",
      value: worstLoc ? `${worstLoc.location} (${worstLoc.score}%)` : "—",
      trend: worstLoc && worstLoc.score < 60 ? -1 : 0,
    },
    {
      label: "Categories Below 50%",
      value: String(belowThreshold),
      trend: belowThreshold === 0 ? 1 : -1,
    },
    {
      label: "Items Checked",
      value: String(data.length),
    },
  ];

  // Locations list for charts
  const locations = locationScores.map((l) => l.location);

  return (
    <div className="space-y-6">
      {/* KPI Cards */}
      <KPICardRow kpis={kpis} />

      {/* Location Compliance Heatmap */}
      <Card className="p-6">
        <h2 className="text-lg font-semibold text-foreground mb-1">
          Compliance by Location
        </h2>
        <p className="text-sm text-muted-foreground mb-4">
          Overall pass rate per location — green {">"}85%, amber 60-85%, red {"<"}60%
        </p>
        <ResponsiveContainer width="100%" height={Math.max(280, locationScores.length * 40)}>
          <BarChart
            data={locationScores}
            layout="vertical"
            margin={{ top: 5, right: 60, left: 20, bottom: 5 }}
          >
            <CartesianGrid strokeDasharray="3 3" horizontal={false} />
            <XAxis type="number" domain={[0, 100]} tickFormatter={(v) => `${v}%`} />
            <YAxis
              type="category"
              dataKey="location"
              width={100}
              tick={{ fontSize: 12 }}
            />
            <Tooltip formatter={(v: number) => [`${v}%`, "Score"]} />
            <ReferenceLine x={85} stroke="#22C55E" strokeDasharray="3 3" />
            <ReferenceLine x={60} stroke="#F59E0B" strokeDasharray="3 3" />
            <Bar dataKey="score" name="Compliance %" radius={[0, 4, 4, 0]} barSize={24}>
              {locationScores.map((entry, index) => (
                <Cell key={index} fill={scoreColor(entry.score)} fillOpacity={0.85} />
              ))}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </Card>

      {/* Category Breakdown */}
      <Card className="p-6">
        <h2 className="text-lg font-semibold text-foreground mb-1">
          Compliance by Category
        </h2>
        <p className="text-sm text-muted-foreground mb-4">
          Which operational areas are strongest and weakest
        </p>
        <ResponsiveContainer width="100%" height={Math.max(280, categoryScores.length * 40)}>
          <BarChart
            data={categoryScores}
            layout="vertical"
            margin={{ top: 5, right: 60, left: 20, bottom: 5 }}
          >
            <CartesianGrid strokeDasharray="3 3" horizontal={false} />
            <XAxis type="number" domain={[0, 100]} tickFormatter={(v) => `${v}%`} />
            <YAxis
              type="category"
              dataKey="category"
              width={180}
              tick={{ fontSize: 11 }}
            />
            <Tooltip formatter={(v: number) => [`${v}%`, "Score"]} />
            <ReferenceLine x={85} stroke="#22C55E" strokeDasharray="3 3" />
            <Bar dataKey="score" name="Compliance %" radius={[0, 4, 4, 0]} barSize={20}>
              {categoryScores.map((entry, index) => (
                <Cell key={index} fill={scoreColor(entry.score)} fillOpacity={0.85} />
              ))}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </Card>

      {/* Checklist Detail Table */}
      <Card className="p-6">
        <h2 className="text-lg font-semibold text-foreground mb-1">
          Checklist Detail
        </h2>
        <p className="text-sm text-muted-foreground mb-4">
          Every item with pass/fail per location
        </p>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border">
                <th className="text-left py-2 px-3 font-medium text-muted-foreground w-[300px]">Item</th>
                <th className="text-left py-2 px-3 font-medium text-muted-foreground w-[140px]">Category</th>
                <th className="text-right py-2 px-3 font-medium text-muted-foreground w-[60px]">Pass %</th>
                {locations.map((loc) => (
                  <th key={loc} className="text-center py-2 px-2 font-medium text-muted-foreground text-xs">
                    {loc}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {checklistItems.map((item, idx) => (
                <tr key={idx} className="border-b border-border/50 hover:bg-warm-gray/50">
                  <td className="py-2 px-3 text-foreground text-xs leading-tight max-w-[300px]">
                    {item.item}
                  </td>
                  <td className="py-2 px-3 text-muted-foreground text-xs">
                    {item.category}
                  </td>
                  <td className="py-2 px-3 text-right font-medium" style={{ color: scoreColor(item.passRate) }}>
                    {item.passRate}%
                  </td>
                  {locations.map((loc) => (
                    <td key={loc} className="py-2 px-2 text-center">
                      {item.locations[loc] !== undefined ? (
                        <span
                          className={`inline-block w-3 h-3 rounded-full ${
                            item.locations[loc] ? "bg-green-500" : "bg-red-500"
                          }`}
                        />
                      ) : (
                        <span className="text-gray-300">—</span>
                      )}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}
```

**Step 2: Commit**

```bash
git add components/brand-standards/StandardTab.tsx
git commit -m "feat(cockpit): add StandardTab visualization component"
```

---

## Task 10: Create TrendChart component

**Files:**
- Create: `Tech/CEO-Cockpit/components/brand-standards/TrendChart.tsx`

**Step 1: Write the component**

This fetches ALL months for a given standard_type and renders a multi-line time series.

```tsx
"use client";

import { useQuery } from "@tanstack/react-query";
import { createClient } from "@/lib/supabase/client";
import { Card } from "@/components/ui/card";
import { chartDefaults } from "@/lib/charts/config";
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
  ReferenceLine,
} from "recharts";
import { format } from "date-fns";

const LOCATION_COLORS: Record<string, string> = {
  Inter: "#1B3A4B",
  Hugos: "#2A8A7A",
  Hyatt: "#B8943E",
  Ramla: "#E07A5F",
  Labranda: "#6B9080",
  Sunny: "#7C3AED",
  Excelsior: "#DC2626",
  Novotel: "#0EA5E9",
  Riviera: "#D946EF",
  Odycy: "#14B8A6",
};

interface TrendChartProps {
  standardType: string;
  selectedMonth: Date;
  locationFilter: string | null;
}

export function TrendChart({ standardType, selectedMonth, locationFilter }: TrendChartProps) {
  const { data: rawData, isLoading } = useQuery({
    queryKey: ["brand_standards_trend", standardType],
    queryFn: async () => {
      const supabase = createClient();
      const { data, error } = await supabase
        .from("brand_standards")
        .select("month, location, result")
        .eq("standard_type", standardType)
        .order("month", { ascending: true });

      if (error) throw new Error(error.message);
      return data || [];
    },
    staleTime: 10 * 60 * 1000,
  });

  if (isLoading || !rawData) {
    return <div className="h-80 bg-warm-gray animate-pulse rounded-xl" />;
  }

  // Aggregate: per month + location → score %
  const agg = new Map<string, Map<string, { total: number; passed: number }>>();
  for (const row of rawData) {
    if (!agg.has(row.month)) agg.set(row.month, new Map());
    const monthMap = agg.get(row.month)!;
    if (!monthMap.has(row.location)) monthMap.set(row.location, { total: 0, passed: 0 });
    const entry = monthMap.get(row.location)!;
    entry.total++;
    if (row.result) entry.passed++;
  }

  // Get all locations
  const allLocations = [...new Set(rawData.map((r) => r.location))].sort();
  const filteredLocations = locationFilter
    ? allLocations.filter((l) => l === locationFilter)
    : allLocations;

  // Build chart data
  const chartData = [...agg.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([month, locMap]) => {
      const row: Record<string, string | number> = {
        month: format(new Date(month), "MMM yy"),
        monthFull: month,
      };
      for (const loc of filteredLocations) {
        const entry = locMap.get(loc);
        row[loc] = entry && entry.total > 0 ? Math.round((entry.passed / entry.total) * 100) : 0;
      }
      return row;
    });

  return (
    <Card className="p-6">
      <h2 className="text-lg font-semibold text-foreground mb-1">
        Compliance Trend
      </h2>
      <p className="text-sm text-muted-foreground mb-4">
        Monthly compliance scores over time per location
      </p>
      <ResponsiveContainer width="100%" height={340}>
        <LineChart data={chartData} margin={chartDefaults.margin}>
          <CartesianGrid strokeDasharray="3 3" />
          <XAxis dataKey="month" tick={{ fontSize: 11 }} />
          <YAxis domain={[0, 100]} tickFormatter={(v) => `${v}%`} tick={{ fontSize: 11 }} />
          <Tooltip formatter={(v: number) => [`${v}%`, ""]} />
          <Legend />
          <ReferenceLine y={85} stroke="#22C55E" strokeDasharray="3 3" label={{ value: "Target", fill: "#22C55E", fontSize: 10 }} />
          {filteredLocations.map((loc, i) => (
            <Line
              key={loc}
              type="monotone"
              dataKey={loc}
              name={loc}
              stroke={LOCATION_COLORS[loc] || "#666"}
              strokeWidth={2}
              strokeDasharray={i % 2 === 1 ? "5 3" : undefined}
              dot={{ r: 3 }}
              connectNulls
            />
          ))}
        </LineChart>
      </ResponsiveContainer>
    </Card>
  );
}
```

**Step 2: Commit**

```bash
git add components/brand-standards/TrendChart.tsx
git commit -m "feat(cockpit): add TrendChart for brand standards over time"
```

---

## Task 11: Create the main page

**Files:**
- Create: `Tech/CEO-Cockpit/app/brand-standards/page.tsx`

**Step 1: Write the page**

```tsx
"use client";

import { useState } from "react";
import { startOfMonth } from "date-fns";
import { DashboardShell } from "@/components/dashboard/DashboardShell";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { MonthPicker } from "@/components/brand-standards/MonthPicker";
import { LocationFilter } from "@/components/brand-standards/LocationFilter";
import { StandardTab } from "@/components/brand-standards/StandardTab";
import { TrendChart } from "@/components/brand-standards/TrendChart";
import { CIChat } from "@/components/ci/CIChat";

function BrandStandardsContent() {
  const [month, setMonth] = useState<Date>(startOfMonth(new Date()));
  const [location, setLocation] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState("facility");

  return (
    <>
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <h1 className="text-2xl font-bold text-foreground">Brand Standards</h1>
        <div className="flex flex-col sm:flex-row items-start sm:items-center gap-3">
          <MonthPicker value={month} onChange={setMonth} />
        </div>
      </div>

      <LocationFilter selected={location} onChange={setLocation} />

      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList className="bg-warm-gray">
          <TabsTrigger value="facility" className="data-[state=active]:bg-gold data-[state=active]:text-white">
            Facility Standards
          </TabsTrigger>
          <TabsTrigger value="front_desk" className="data-[state=active]:bg-gold data-[state=active]:text-white">
            Front Desk Standards
          </TabsTrigger>
          <TabsTrigger value="mystery_guest" className="data-[state=active]:bg-gold data-[state=active]:text-white">
            Mystery Guest
          </TabsTrigger>
        </TabsList>

        <TabsContent value="facility" className="mt-6 space-y-6">
          <StandardTab standardType="facility" month={month} location={location} />
          <TrendChart standardType="facility" selectedMonth={month} locationFilter={location} />
        </TabsContent>

        <TabsContent value="front_desk" className="mt-6 space-y-6">
          <StandardTab standardType="front_desk" month={month} location={location} />
          <TrendChart standardType="front_desk" selectedMonth={month} locationFilter={location} />
        </TabsContent>

        <TabsContent value="mystery_guest" className="mt-6 space-y-6">
          <StandardTab standardType="mystery_guest" month={month} location={location} />
          <TrendChart standardType="mystery_guest" selectedMonth={month} locationFilter={location} />
        </TabsContent>
      </Tabs>

      <CIChat />
    </>
  );
}

export default function BrandStandardsPage() {
  return (
    <DashboardShell>
      {() => <BrandStandardsContent />}
    </DashboardShell>
  );
}
```

**Step 2: Verify page renders**

Run: `cd Tech/CEO-Cockpit && npm run dev`
Navigate to: `http://localhost:3000/brand-standards`
Expected: Page renders with title, month picker, location filter, 3 tabs, and empty state or data (depending on whether ETL has run).

**Step 3: Commit**

```bash
git add app/brand-standards/page.tsx
git commit -m "feat(cockpit): add Brand Standards dashboard page with tabs"
```

---

## Task 12: Build check and polish

**Files:**
- No new files

**Step 1: Run build**

```bash
cd Tech/CEO-Cockpit && npm run build
```

Fix any TypeScript errors or import issues.

**Step 2: Run lint**

```bash
cd Tech/CEO-Cockpit && npm run lint
```

Fix any lint errors.

**Step 3: Visual QA**

Open `http://localhost:3000/brand-standards` and verify:
- [ ] Sidebar shows "Brand Standards" link
- [ ] MonthPicker navigates between months
- [ ] LocationFilter toggles between All / individual locations
- [ ] 3 tabs switch content correctly
- [ ] KPI cards show computed scores
- [ ] Location heatmap bar chart renders with green/amber/red colors
- [ ] Category breakdown chart renders
- [ ] Checklist detail table shows green/red dots
- [ ] Trend chart shows multi-line time series
- [ ] Responsive layout works on mobile

**Step 4: Final commit**

```bash
git add -A
git commit -m "feat(cockpit): Brand Standards dashboard — complete implementation"
```
