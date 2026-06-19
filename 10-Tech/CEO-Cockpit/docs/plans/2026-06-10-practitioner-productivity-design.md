# Practitioner Productivity — EBITDA v2

**Date:** 2026-06-10
**Status:** Design approved (Mert), ready to execute

## Goal

Add a "Practitioner Productivity" table to the point-in-time EBITDA sheet (`/finance/ebitda-v2`) that shows every practitioner / therapist across Spa, Aesthetics, and Slimming with:

- Total salary cost for the selected period (wages + supplement, prorated)
- Total revenue they generated for the selected period (ex-VAT, prorated)
- K% = salary / revenue (the productivity ratio)

Roles included: `therapist`, `practitioner` only. Managers, reception, CRM are excluded — they don't generate service revenue.

## Data audit

| Brand      | Salary per employee                                                                 | Revenue per practitioner                                            |
| ---------- | ----------------------------------------------------------------------------------- | ------------------------------------------------------------------- |
| Aesthetics | ✅ `transactions_raw` (wages) + `salary_supplement_monthly` + `wage_role_mapping`   | ✅ `aesthetics_sales_daily.sales_staff`                              |
| Slimming   | ✅ same as above                                                                    | ✅ `slimming_treatments_daily.therapist`                             |
| Spa        | ✅ same as above (8 venues)                                                         | ⚠️ Source exists (Cockpit "Service - Spa" tab, `Employee(s)` column), no Supabase table yet |

The Spa Service tab `Employee(s)` column contains the actual therapist name. Rows with `Employee(s) = "CARISMA (SALES)"` are walk-in product / spa-day sales not attributable to a therapist — exclude from the productivity table.

## Components

### 1. New Supabase table

```sql
create table spa_services_by_employee_daily (
  month            date         not null,
  date_of_service  date         not null,
  location_id      int          not null,
  employee_name    text         not null,
  service_name     text,
  price_ex_vat     numeric      not null,
  inserted_at      timestamptz  default now()
);
create index on spa_services_by_employee_daily (month, location_id);
create index on spa_services_by_employee_daily (employee_name);
```

Shape mirrors `slimming_treatments_daily` for consistency.

### 2. New ETL

`lib/etl/spa-services-by-employee.ts`

- Reads Cockpit Service-Spa tab via existing public CSV path
- Filters: `Status` in (`Given`, `Unplanned`); `Employee(s)` ≠ `CARISMA (SALES)`
- Computes `price_ex_vat = Unit Price / 1.18`
- Buckets by month, deletes-then-inserts per month
- Wired into nightly refresh + manual sync route in `app/api/cron/nightly-refresh/route.ts` and the data-sources settings page

### 3. New API

`app/api/finance/practitioner-productivity/route.ts`

**Query params:** `date_from`, `date_to`

**Response:**

```ts
{
  spa: Practitioner[],
  aesthetics: Practitioner[],
  slimming: Practitioner[],
}

type Practitioner = {
  employee_name: string;
  venue: string;          // e.g. "inter", "hugos", "aesthetics", "slimming"
  role: string;           // "therapist" | "practitioner"
  salary: number;         // ex-VAT, period-prorated
  revenue: number;        // ex-VAT, period-prorated
  k_pct: number | null;   // null when revenue == 0
  flag: "no_match" | "no_revenue" | "no_salary" | null;
};
```

**Salary computation** reuses the existing pattern from `app/api/finance/ebitda-v2/drill/route.ts`:

- `transactions_raw` where `ebitda_line='wages'`, date in range
- Plus `salary_supplement_monthly` (frozen rows), prorated by days-in-range / days-in-month
- Filter to therapist + practitioner role via `wage_role_mapping`

**Revenue computation per brand:**

- Spa: sum `spa_services_by_employee_daily.price_ex_vat` where date in range, grouped by `employee_name`
- Aesthetics: sum `aesthetics_sales_daily.price_ex_vat` where date in range, grouped by `sales_staff`
- Slimming: sum `slimming_treatments_daily.price_ex_vat` where date in range, grouped by `therapist`

**Join salary ⇄ revenue** by normalized employee name.

### 4. Name normalization

Therapist names differ across systems ("BLERINA" in Spa sheet vs "Blerina Petani" in Zoho). Strategy:

1. Normalize both sides: `toLowerCase().trim().replace(/\s+/g, " ")`
2. Exact match first
3. Within a venue, fall back to first-name match when unambiguous (single candidate)
4. New optional settings table for manual overrides:

```sql
create table practitioner_name_aliases (
  revenue_name    text not null,
  canonical_name  text not null,
  venue           text not null,
  primary key (revenue_name, venue)
);
```

5. Rows that match on one side only get a `flag` ("no_revenue" or "no_salary") so they show up in the UI as "needs reconciliation" rather than silent zeroes.

### 5. UI

New section in `app/finance/ebitda-v2/page.tsx`, rendered below the existing P&L table.

Section title: **Practitioner Productivity · {periodLabel}**

Three sub-tables under brand tabs (Spa | Aesthetics | Slimming), each with columns:

| Practitioner       | Venue | Salary | Revenue | K%    | Status                  |
| ------------------ | ----- | ------ | ------- | ----- | ----------------------- |
| Blerina Petani     | inter | €2.1K  | €8.4K   | **25%** | ✅                      |
| Svetlana Matviets  | hugos | €2.3K  | €11.2K  | **21%** | ✅                      |
| Maria Vella        | ramla | €1.9K  | —       | n/a   | ⚠️ revenue not matched  |

Default sort: K% descending (worst productivity at top — actionable).

K% color thresholds (placeholders, tunable):
- ≤ 30%: emerald
- 30–50%: amber
- > 50% or null: red

Period label & dates from the same `DashboardShell` date picker that drives the P&L — no separate state.

## Ship sequence

1. Supabase migration: create `spa_services_by_employee_daily` (+ `practitioner_name_aliases` empty table)
2. Build Spa ETL, run once for the active YTD period, spot-check 3–5 known therapists' totals against the sheet
3. Build API endpoint, verify: per-venue salary totals (sum of `salary` for venue) match the existing wages-by-therapist drill total
4. Build UI section
5. Local smoke test: render page with current date range, validate at least one venue per brand shows non-zero K%
6. Push to `carismawellness/carisma-support` main → Vercel auto-deploys to `carisma-support-u2vb.vercel.app`
7. Verify the live deploy via `gh api` and a quick browser check before reporting done

## Out of scope (now)

- Hours-worked or utilization data (would give a richer "revenue per productive hour" metric — needs Fresha integration)
- Longitudinal view (this is point-in-time only, matching the page name)
- Drill-down dialog from each row (can be added later if useful)
- Cross-brand totals — the productivity table is per-brand by design
