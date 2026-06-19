# Sales Employee Dashboards + Commission Mapping System — Design

Date: 2026-06-10
Status: approved for implementation (autonomous build, CEO directive)

## Goal

Personalized dashboards for every sales employee (therapist/consultant/practitioner) in each
brand's sales section, mirroring the CRM agent pattern (`/crm/individual/[slug]`), with
**commission as the headline metric** — split into service commission and retail commission —
computed from each employee's own DB-backed commission rates (effective-dated, per-employee).
Plus a robust admin mapping/user-management UI so every revenue name maps to exactly one
employee with accurate rates.

## Data reality (verified 2026-06-10)

| Brand | Service revenue per employee | Retail revenue per employee | Identity column |
|---|---|---|---|
| Spa | `spa_services_by_employee_daily` (`employee_name`, `price_ex_vat`, `service_name`, `location_id`, `date_of_service`) | **gap** — Cockpit "Retail - Spa" tab (gid 1170650850) has `Sales Employee` + `VAT Exclusive Amount ` + `Date` + `Material ` + `Point of Sales ` columns but is aggregated to location on ingest → new ETL + table | `employee_name` |
| Aesthetics | `aesthetics_sales_daily` (`note_person` = Employee col, `price_inc_vat`, `price_ex_vat`, `service_product`, `date_of_service`) — service vs retail NOT flagged → keyword classifier | same table | `note_person` |
| Slimming | `slimming_sales_daily` (`sales_staff`, `paid`, `price_ex_vat`, `service_type`, `date_of_service`) — `service_type='product'` = retail | same table | `sales_staff` |

Spa VAT: dashboards show inc-VAT via `× 1.18`. Aesthetics rows carry per-row `vat_rate`.
Slimming `paid` is gross collected.

Names in sheets vary in case/spacing → matching is on `normalizeName()` =
uppercase, collapse whitespace, trim; employee matches if normalized `display_name`
or any normalized alias equals the data name.

## Schema — migration `073_create_sales_employees.sql`

```sql
CREATE TABLE IF NOT EXISTS sales_employees (
  id              SERIAL PRIMARY KEY,
  slug            TEXT NOT NULL UNIQUE,           -- url-safe, e.g. "laura-camila"
  display_name    TEXT NOT NULL,
  brand_slug      TEXT NOT NULL CHECK (brand_slug IN ('spa','aesthetics','slimming')),
  role            TEXT,                           -- 'Therapist' | 'Consultant' | ...
  location_name   TEXT,
  user_email      TEXT,                           -- links auth user → self-service dashboard
  is_active       BOOLEAN NOT NULL DEFAULT TRUE,
  aliases         TEXT[] NOT NULL DEFAULT '{}',   -- names as they appear in revenue data
  commission_basis TEXT NOT NULL DEFAULT 'ex_vat' CHECK (commission_basis IN ('ex_vat','inc_vat')),
  notes           TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_sales_employees_brand ON sales_employees(brand_slug);
CREATE INDEX idx_sales_employees_email ON sales_employees(user_email);

-- Effective-dated rates: the rate applied to a transaction is the row with the
-- greatest effective_from <= transaction date. No row => 0 (UI flags "rates not set").
CREATE TABLE IF NOT EXISTS sales_employee_commission_rates (
  id             SERIAL PRIMARY KEY,
  employee_id    INTEGER NOT NULL REFERENCES sales_employees(id) ON DELETE CASCADE,
  service_rate   NUMERIC(6,4) NOT NULL DEFAULT 0,  -- 0.06 = 6%
  retail_rate    NUMERIC(6,4) NOT NULL DEFAULT 0,  -- 0.10 = 10%
  effective_from DATE NOT NULL,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(employee_id, effective_from)
);

-- Fills the Spa retail attribution gap (mirrors spa_services_by_employee_daily ETL pattern)
CREATE TABLE IF NOT EXISTS spa_retail_by_employee_daily (
  id            SERIAL PRIMARY KEY,
  month         DATE NOT NULL,
  date          DATE NOT NULL,
  location_id   INTEGER,
  employee_name TEXT NOT NULL,
  product_name  TEXT,
  product_brand TEXT,
  amount_ex_vat NUMERIC(12,2) NOT NULL DEFAULT 0,
  synced_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_spa_retail_emp_date ON spa_retail_by_employee_daily(date);
CREATE INDEX idx_spa_retail_emp_month ON spa_retail_by_employee_daily(month);
CREATE INDEX idx_spa_retail_emp_name ON spa_retail_by_employee_daily(employee_name);
```

RLS: enable on all three; `authenticated` may SELECT (middleware self-access lookup uses the
session client); writes go through service-role server clients only. Mirror the policy style of
migration 053/056.

## Commission engine — `lib/sales-employees/`

- `types.ts` — shared TS interfaces (below).
- `names.ts` — `normalizeName()`, `buildNameLookup(employees)`.
- `classify.ts` — `isAestheticsRetail(serviceProduct)` keyword classifier
  (cream|serum|skincare|spf|sunscreen|cleanser|moisturiser|moisturizer|mask kit|home care|
  retail|product|kit\b …, case-insensitive). Default = service.
- `engine.ts` — `pickRate(rateRows, date)` (greatest `effective_from` ≤ date, else null) and
  `computeCommission(rows)` summing `basisAmount × rate` per row per kind. **Rates are resolved
  per transaction date**, so historical rate changes stay accurate.

## API contract (all under `app/api/sales/`)

All admin-mutating routes verify `isAdminEmail()` server-side (see `lib/auth/admins.ts`
usage in `app/api/admin/invitations/route.ts`); stats GET requires any session.

### `GET /api/sales/employees?brand=spa|aesthetics|slimming` (brand optional)
```json
{ "employees": [ {
  "id": 1, "slug": "laura-camila", "display_name": "Laura Camila",
  "brand_slug": "spa", "role": "Therapist", "location_name": "Ramla",
  "user_email": null, "is_active": true, "aliases": ["LAURA CAMILA"],
  "commission_basis": "ex_vat", "notes": null,
  "current_rates": { "id": 9, "service_rate": 0.06, "retail_rate": 0.1, "effective_from": "2026-01-01" },
  "rate_history": [ { "id": 9, "service_rate": 0.06, "retail_rate": 0.1, "effective_from": "2026-01-01" } ]
} ] }
```

### `POST /api/sales/employees`
Body: `{ display_name, brand_slug, slug?, role?, location_name?, user_email?, aliases?,
commission_basis?, is_active?, notes?, service_rate?, retail_rate?, effective_from? }`
— auto-slugifies if slug omitted; creates initial rate row when rates provided.
→ `{ employee }` (same shape as list item). 409 on duplicate slug.

### `PATCH /api/sales/employees` — Body `{ id, ...mutable fields }` → `{ employee }`
### `DELETE /api/sales/employees?id=N` → `{ ok: true }`

### `POST /api/sales/employees/rates`
Body `{ employee_id, service_rate, retail_rate, effective_from }` — upsert on
`(employee_id, effective_from)` → `{ rate }`.
### `DELETE /api/sales/employees/rates?id=N` → `{ ok: true }`

### `GET /api/sales/employees/unmapped?brand=spa&from=YYYY-MM-DD&to=YYYY-MM-DD`
Distinct normalized names in that brand's revenue data within range that match **no**
employee/alias of that brand:
```json
{ "unmapped": [ { "name": "GABRIELY PRADO", "kind": "retail", "revenue": 1234.5, "tx_count": 17, "last_seen": "2026-06-01" } ] }
```
(spa scans both service + retail tables; excludes `CARISMA (SALES)`.)

### `GET /api/sales/employee-stats?brand=spa&slug=laura-camila&from=...&to=...`
```json
{
  "employee": { "slug": "...", "display_name": "...", "brand_slug": "spa", "role": "...",
                 "is_active": true, "commission_basis": "ex_vat", "rates_set": true },
  "rates": { "service_rate": 0.06, "retail_rate": 0.1, "effective_from": "2026-01-01" },
  "totals": {
    "service_revenue": 0, "retail_revenue": 0, "total_revenue": 0,
    "service_tx": 0, "retail_tx": 0, "total_tx": 0,
    "commission_service": 0, "commission_retail": 0, "commission_total": 0,
    "avg_ticket": 0, "active_days": 0
  },
  "daily": [ { "date": "2026-06-01", "service_revenue": 0, "retail_revenue": 0, "commission": 0 } ],
  "service_breakdown": [ { "name": "Deep Tissue 60", "revenue": 0, "tx_count": 0 } ],
  "retail_breakdown":  [ { "name": "Oligoforce Serum", "revenue": 0, "tx_count": 0 } ],
  "brand_extras": { }
}
```
Revenue figures are in the employee's `commission_basis` (default ex-VAT). `brand_extras`:
spa → `{ by_location: [{name, revenue}] }`; aesthetics → `{ payment_mix: [{type, revenue}] }`;
slimming → `{ category_mix: [{category, revenue}], collected_vs_full: {paid, full_price} }`.
Server-side pagination: loop `.range()` in 1000-row pages (PostgREST cap).

## New ETL — Spa retail by employee

`lib/etl/spa-retail-by-employee.ts` + `app/api/etl/spa-retail-by-employee/route.ts`,
mirroring `lib/etl/spa-services-by-employee.ts` exactly (CSV export of gid 1170650850,
skip the banner row — headers are on row 2; columns `Date`, `Sales Employee`,
`VAT Exclusive Amount `, `Material `, `Brand`, `Point of Sales ` (note trailing spaces);
month-scoped `deleteWhere(month)` + insert). Register in the `revenue-refresh` fan-out.

## Routes & nav

- Pages: `app/sales/{brand}/employees/page.tsx` (team index) and
  `app/sales/{brand}/employees/[slug]/page.tsx` (personal dashboard) ×3 brands.
- `departments.ts`: each brand SubItem gains `children: [{ slug: "{brand}-employees",
  label: "Employees", path: "/sales/{brand}/employees", icon: Users }]` → permission key
  `sales/{brand}/employees` auto-derived (covers slug pages by prefix).
- Shared UI in `components/sales/employees/`: `CommissionHero.tsx` (service + retail + total,
  modeled on `components/crm/CommissionHeroBanner.tsx`), `EmployeeStatCards.tsx`,
  `EmployeeTrendChart.tsx`, `EmployeeBreakdownTable.tsx` — brand pages pass brand accent color.
- Shared hooks: `lib/hooks/useSalesEmployees.ts` (list, react-query) and
  `lib/hooks/useSalesEmployeeStats.ts` (stats by brand+slug+range).

## Middleware self-access (employee sees only their own page)

In `lib/supabase/middleware.ts`, after invitation check, before permission check:
path matches `^/sales/(spa|aesthetics|slimming)/employees/([^/]+)$` → allow when
`sales_employees` has a row with `user_email = email`, matching brand + slug.
Fallback redirect: a user with zero dashboard permissions who IS a mapped employee gets
redirected to their own dashboard instead of `/unauthorized`.
Invite flow: create invitation with no permissions + set `user_email` on the employee →
they can log in and see exactly one page.

## Admin UI — `/settings/sales-employees`

Tabs per brand. Features: employee table (name, role, aliases, rates, basis, linked email,
active, rates-set flag); add/edit dialog; rate editor with effective-dated history
(add revision, delete revision); alias chips editor; **Unmapped names panel** (date-window
scan with one-click "Create employee" / "Add as alias to…"); "Invite to Cockpit" button
(POST `/api/admin/invitations` with all-false permissions, then PATCH employee.user_email).
Graceful degradation: if `sales_employees` 404s (migration not applied), show a banner with
the migration path instead of crashing.
Registered in `departments.ts` Settings children (singleKey, no new permission).

## Seeding

`scripts/seed-sales-employees.ts` (run: `npx tsx --env-file=.env.local scripts/seed-sales-employees.ts`)
— scans last 12 months of all three sources, dedupes per brand, upserts employees with the raw
sheet name as alias. No rate rows are seeded (commission shows €0 + "rates not set" until the
CEO enters real rates in Settings).

## Accuracy invariants

1. Rates resolve per transaction date (effective-dated) — rate edits never corrupt history.
2. Name matching is normalized + alias-based; the unmapped panel makes gaps visible instead of silent.
3. Commission basis explicit per employee (ex-VAT default).
4. Spa walk-in `CARISMA (SALES)` rows are excluded from employee attribution (existing convention).
5. No hard-coded rates in code (unlike CRM agents' `lib/constants/agents.ts`) — DB only.

## Out of scope (deliberate)

- Migrating CRM agent commissions into this system (later unification candidate).
- Tiered/threshold commission schemes — flat % per kind per employee for now; the
  effective-dated table leaves room to extend.
- Payroll export.
