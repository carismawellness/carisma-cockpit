# Practitioner Productivity Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add a "Practitioner Productivity" table to `/finance/ebitda-v2` showing every therapist + practitioner across Spa, Aesthetics, and Slimming with their period salary, revenue generated, and K% (salary / revenue).

**Architecture:** New Supabase table for Spa per-employee service revenue (ETL from Cockpit "Service - Spa" tab), new API endpoint joining salary + revenue per employee with name normalization, new UI section appended below the existing P&L. Role filter `therapist | practitioner` excludes managers, reception, CRM, HQ.

**Tech Stack:** Next.js 16 (App Router), React 19, Supabase, TypeScript, existing Cockpit Datasheet public CSV pattern.

**Design doc:** `docs/plans/2026-06-10-practitioner-productivity-design.md`

**Verification approach:** This codebase has no test runner. Verification is done by (a) running ETLs and spot-checking row counts/totals against the source sheet, (b) hitting API endpoints and validating response shape + sample numbers, (c) loading the page locally and visually confirming. Explicit verification steps are included in every task.

---

### Task 1: Supabase migration — `spa_services_by_employee_daily` + `practitioner_name_aliases`

**Files:**
- Create: `supabase/migrations/064_create_spa_services_by_employee_daily.sql`
- Create: `supabase/migrations/065_create_practitioner_name_aliases.sql`

**Step 1: Write the migration for the Spa employee revenue table**

`supabase/migrations/064_create_spa_services_by_employee_daily.sql`:

```sql
-- Spa per-employee service revenue (Practitioner Productivity)
-- Source: Cockpit "Service - Spa" tab, Employee(s) column
-- Excludes rows where Employee(s) = 'CARISMA (SALES)' (non-therapist walk-in sales)
CREATE TABLE IF NOT EXISTS spa_services_by_employee_daily (
    id              SERIAL PRIMARY KEY,
    month           DATE      NOT NULL,           -- YYYY-MM-01
    date_of_service DATE      NOT NULL,
    location_id     INT       NOT NULL,
    employee_name   TEXT      NOT NULL,
    service_name    TEXT,
    price_ex_vat    NUMERIC(10,2) NOT NULL,
    synced_at       TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS spa_svc_emp_month_idx    ON spa_services_by_employee_daily(month);
CREATE INDEX IF NOT EXISTS spa_svc_emp_location_idx ON spa_services_by_employee_daily(location_id);
CREATE INDEX IF NOT EXISTS spa_svc_emp_name_idx     ON spa_services_by_employee_daily(employee_name);
```

`supabase/migrations/065_create_practitioner_name_aliases.sql`:

```sql
-- Manual overrides when revenue-source names don't match canonical employee names
-- (e.g. "BLERINA" in Spa sheet → "Blerina Petani" in Zoho wages)
-- venue: "spa" | "aesthetics" | "slimming"
CREATE TABLE IF NOT EXISTS practitioner_name_aliases (
    revenue_name   TEXT NOT NULL,
    canonical_name TEXT NOT NULL,
    venue          TEXT NOT NULL,
    created_at     TIMESTAMPTZ DEFAULT now(),
    PRIMARY KEY (revenue_name, venue)
);
```

**Step 2: Apply both migrations to Supabase**

Run via the Supabase SQL Editor or psql against the project database. Paste each file's contents in order.

Expected: both `CREATE TABLE` statements succeed without error.

**Step 3: Verify the tables exist**

Run in Supabase SQL editor:

```sql
SELECT table_name FROM information_schema.tables
WHERE table_name IN ('spa_services_by_employee_daily', 'practitioner_name_aliases');
```

Expected: 2 rows returned.

**Step 4: Commit**

```bash
git add supabase/migrations/064_create_spa_services_by_employee_daily.sql \
        supabase/migrations/065_create_practitioner_name_aliases.sql
git commit -m "feat(ebitda): supabase tables for practitioner productivity (Spa per-employee revenue + name aliases)"
```

---

### Task 2: ETL — Spa per-employee service revenue

**Files:**
- Create: `lib/etl/spa-services-by-employee.ts`

**Step 1: Write the ETL module**

Pattern: copy the shape of `lib/etl/slimming-treatments.ts`. Key differences: read from Cockpit `SPA_SERVICES` tab; map sales-point label → `location_id` using the same map used in `lib/etl/spa-revenue.ts` (`COCKPIT_SPA_LOCATION_MAP`); ex-VAT price = `Unit Price / 1.18`; skip rows where `Employee(s)` is empty or equals `CARISMA (SALES)`; skip rows where `Status` not in `Given | Unplanned`.

```ts
import { deleteWhere, insertRows } from "./supabase-etl";
import { cockpitCsvUrl, COCKPIT_TABS } from "../constants/cockpit-sheets";

const VAT_RATE = 0.18;

const SPA_LOC_MAP: Record<string, number> = {
  "HUGOS": 2, "INTER": 1, "RAMLA": 4, "SUNNY COAST": 6,
  "SALES POINT OF EXCELSIOR": 7, "HYATT": 3,
  "LABRANDA GENERAL SALES POINT": 5, "SALES POINT OF NOV": 8,
};

function parseCSVRow(line: string): string[] {
  const cells: string[] = [];
  let cur = "", inQ = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      if (inQ && line[i + 1] === '"') { cur += '"'; i++; }
      else inQ = !inQ;
    } else if (ch === "," && !inQ) { cells.push(cur); cur = ""; }
    else cur += ch;
  }
  cells.push(cur);
  return cells;
}

async function fetchCockpitCsv(): Promise<Record<string, string>[]> {
  const url  = cockpitCsvUrl(COCKPIT_TABS.SPA_SERVICES.gid);
  const resp = await fetch(url, { redirect: "follow" });
  if (!resp.ok) throw new Error(`Cockpit fetch failed: ${resp.status}`);
  const text  = await resp.text();
  const lines = text.split("\n").filter(l => l.trim());
  if (lines.length < 2) return [];
  let headerIdx = 0;
  for (let i = 0; i < Math.min(lines.length, 5); i++) {
    if (parseCSVRow(lines[i]).filter(c => c.trim()).length >= 3) { headerIdx = i; break; }
  }
  const headers = parseCSVRow(lines[headerIdx]).map(h => h.trim());
  return lines.slice(headerIdx + 1).map(line => {
    const cells = parseCSVRow(line);
    return Object.fromEntries(headers.map((h, i) => [h, (cells[i] ?? "").trim()]));
  });
}

const MONTH_NAMES: Record<string, number> = {
  january:0,february:1,march:2,april:3,may:4,june:5,
  july:6,august:7,september:8,october:9,november:10,december:11,
  jan:0,feb:1,mar:2,apr:3,jun:5,jul:6,aug:7,sep:8,oct:9,nov:10,dec:11,
};

function parseCockpitDate(raw: string): Date | null {
  raw = raw.trim();
  if (!raw) return null;
  const dmy = raw.match(/^(\d{1,2})\s+([A-Za-z]+)\s+(\d{4})$/);
  if (dmy) {
    const mo = MONTH_NAMES[dmy[2].toLowerCase()];
    if (mo !== undefined) return new Date(+dmy[3], mo, +dmy[1]);
  }
  for (const fmt of [
    (s: string) => { const [d, m, y] = s.split("/"); return new Date(+y, +m - 1, +d); },
    (s: string) => { const [d, m, y] = s.split("/"); return new Date(2000 + +y, +m - 1, +d); },
    (s: string) => new Date(s),
  ]) {
    try { const d = fmt(raw); if (!isNaN(d.getTime())) return d; } catch { /* */ }
  }
  return null;
}

function safeFloat(val: string): number {
  return parseFloat(String(val).replace(/,/g, "").trim() || "0") || 0;
}

function monthsInRange(fromDate: string, toDate: string): Set<string> {
  const months = new Set<string>();
  const [fy, fm] = fromDate.split("-").map(Number);
  const [ty, tm] = toDate.split("-").map(Number);
  let y = fy, m = fm;
  while (y < ty || (y === ty && m <= tm)) {
    months.add(`${y}-${String(m).padStart(2, "0")}-01`);
    if (++m > 12) { m = 1; y++; }
  }
  return months;
}

export async function runSpaServicesByEmployee(
  dateFrom: string,
  dateTo: string,
): Promise<{ rowsInserted: number; log: string[] }> {
  const log: string[] = [];
  const rows = await fetchCockpitCsv();
  log.push(`Fetched ${rows.length} raw rows from Cockpit Service-Spa tab`);

  const validMonths = monthsInRange(dateFrom, dateTo);
  const buckets = new Map<string, Record<string, unknown>[]>();
  let skippedSales = 0, skippedStatus = 0, skippedDate = 0, skippedLoc = 0, skippedEmp = 0;

  for (const row of rows) {
    const status = (row["Status"] ?? "").trim();
    if (!["Given", "Unplanned"].includes(status)) { skippedStatus++; continue; }

    const employee = (row["Employee(s)"] ?? "").trim();
    if (!employee) { skippedEmp++; continue; }
    if (employee.toUpperCase() === "CARISMA (SALES)") { skippedSales++; continue; }

    const dateRaw = (row["Service Date"] ?? "").trim();
    const d = parseCockpitDate(dateRaw);
    if (!d) { skippedDate++; continue; }

    const dateStr = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
    const monthKey = `${dateStr.slice(0, 7)}-01`;
    if (!validMonths.has(monthKey)) continue;

    const locId = SPA_LOC_MAP[(row["Sales Point"] ?? "").trim()];
    if (!locId) { skippedLoc++; continue; }

    const unitPrice = safeFloat(row["Unit Price"] ?? "");
    if (unitPrice <= 0) continue;
    const priceEx = +(unitPrice / (1 + VAT_RATE)).toFixed(2);

    if (!buckets.has(monthKey)) buckets.set(monthKey, []);
    buckets.get(monthKey)!.push({
      month:           monthKey,
      date_of_service: dateStr,
      location_id:     locId,
      employee_name:   employee,
      service_name:    (row["Service Name"] ?? "").trim() || null,
      price_ex_vat:    priceEx,
    });
  }

  log.push(`Skipped: ${skippedStatus} non-Given, ${skippedSales} CARISMA(SALES), ${skippedEmp} empty-employee, ${skippedDate} bad-date, ${skippedLoc} unknown-location`);

  let totalRows = 0;
  for (const [monthKey, rows2] of buckets) {
    await deleteWhere("spa_services_by_employee_daily", { month: monthKey });
    const n = await insertRows("spa_services_by_employee_daily", rows2);
    totalRows += n;
    const exTotal = rows2.reduce((s, r) => s + Number(r.price_ex_vat), 0);
    log.push(`  ${monthKey}: ${n} rows — €${exTotal.toFixed(2)} ex-VAT`);
  }

  log.push(`Done — ${totalRows} total rows across ${buckets.size} month(s).`);
  return { rowsInserted: totalRows, log };
}
```

**Step 2: Sanity-check the file**

Run: `pnpm exec tsc --noEmit lib/etl/spa-services-by-employee.ts 2>&1 | head -20` (or `npx tsc --noEmit ...`).
Expected: no errors. (If tsc complains about missing project context, that's fine — the build step in Task 5 will catch real errors.)

**Step 3: Commit**

```bash
git add lib/etl/spa-services-by-employee.ts
git commit -m "feat(etl): per-employee Spa service revenue ETL"
```

---

### Task 3: ETL route + wire into revenue-refresh

**Files:**
- Create: `app/api/etl/spa-services-by-employee/route.ts`
- Modify: `app/api/etl/revenue-refresh/route.ts`

**Step 1: Create the route handler**

`app/api/etl/spa-services-by-employee/route.ts`:

```ts
import { NextRequest, NextResponse } from "next/server";
import { runSpaServicesByEmployee } from "@/lib/etl/spa-services-by-employee";

export const maxDuration = 60;

export async function POST(req: NextRequest) {
  let dateFrom: string, dateTo: string;
  try {
    const body = await req.json();
    dateFrom = body.date_from;
    dateTo   = body.date_to;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  if (!dateFrom || !dateTo) {
    return NextResponse.json({ error: "date_from and date_to are required" }, { status: 400 });
  }

  try {
    const result = await runSpaServicesByEmployee(dateFrom, dateTo);
    return NextResponse.json({ status: "ok", ...result });
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}
```

**Step 2: Wire into `revenue-refresh`**

Modify `app/api/etl/revenue-refresh/route.ts`. Add a fifth fetch to the `Promise.allSettled` block:

```ts
fetch(`${BASE_URL}/api/etl/spa-services-by-employee`, { method: "POST", headers, body: payload }),
```

…and a fifth field in the `results` object: `spa_employees: outcome(spaEmpRes)`. Add `spaEmpRes` to the destructure.

**Step 3: Commit**

```bash
git add app/api/etl/spa-services-by-employee app/api/etl/revenue-refresh
git commit -m "feat(etl): expose Spa per-employee revenue endpoint + wire into revenue-refresh"
```

---

### Task 4: Backfill — run the ETL for the YTD period

**Files:** none

**Step 1: Start the dev server**

Run in a separate terminal: `cd Tech/CEO-Cockpit && pnpm dev`

Expected: Next.js starts on `http://localhost:3000`.

**Step 2: Trigger the backfill**

Backfill from start of 2025 to today:

```bash
curl -X POST http://localhost:3000/api/etl/spa-services-by-employee \
  -H "Content-Type: application/json" \
  -d '{"date_from":"2025-01-01","date_to":"2026-06-10"}'
```

Expected: JSON response with `status: "ok"` and `rowsInserted` ≥ several thousand. Log mentions row counts per month.

**Step 3: Spot-check the data**

Run in Supabase SQL editor:

```sql
SELECT employee_name, ROUND(SUM(price_ex_vat)::numeric, 2) AS revenue
FROM spa_services_by_employee_daily
WHERE date_of_service >= '2026-01-01' AND date_of_service <= '2026-05-31'
GROUP BY employee_name
ORDER BY revenue DESC
LIMIT 10;
```

Expected: top 10 therapists by YTD revenue. The names should look plausible (recognizable people from the Spa, not "CARISMA (SALES)"). Show the result to the user before continuing.

**Step 4: No commit** (data only, no code change).

---

### Task 5: API endpoint — `/api/finance/practitioner-productivity`

**Files:**
- Create: `app/api/finance/practitioner-productivity/route.ts`

**Step 1: Write the endpoint**

The endpoint must:

1. Read `date_from` / `date_to` params
2. Pull wages (period-prorated): query `transactions_raw` where `ebitda_line='wages'`, `venue IN ([all spa venues + aesthetics + slimming])`, `date BETWEEN`, sum `amount` per `(venue, contact_name)`
3. Pull supplement: query `salary_supplement_monthly` (`is_frozen=true`), prorate by day-overlap with the period, sum per `(spa_slug, employee_name)`
4. Pull roles: `wage_role_mapping` — map `contact_key` → `role`. Only keep `therapist` or `practitioner`
5. Pull Spa revenue: `spa_services_by_employee_daily` where date in range, sum per `(location_id, employee_name)`; map `location_id` → venue slug
6. Pull Aesthetics revenue: `aesthetics_sales_daily` where date in range; prefer `note_person` (the practitioner who performed) over `sales_staff`; sum `price_ex_vat`
7. Pull Slimming revenue: `slimming_treatments_daily` where date in range, sum `price_ex_vat` per `therapist`
8. Pull aliases: `practitioner_name_aliases`
9. Normalize names with `s => s.toLowerCase().trim().replace(/\s+/g, " ")`, apply aliases on revenue side first, then join
10. Compute K% = salary / revenue * 100 (null when revenue = 0)
11. Flag rows: `no_salary` (revenue but no wages match), `no_revenue` (wages but no revenue match), null otherwise
12. Group output by brand: `{ spa: [...], aesthetics: [...], slimming: [...] }`

Full code:

```ts
import { NextResponse } from "next/server";
import { createServerSupabaseClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const SPA_VENUES = ["intercontinental","hugos","hyatt","ramla","labranda","sunny_coast","excelsior","novotel"];
const ALL_VENUES = [...SPA_VENUES, "aesthetics", "slimming"];
const LOC_ID_TO_SLUG: Record<number, string> = {
  1:"intercontinental", 2:"hugos", 3:"hyatt", 4:"ramla",
  5:"labranda", 6:"sunny_coast", 7:"excelsior", 8:"novotel",
};
const PRODUCTIVE_ROLES = new Set(["therapist", "practitioner"]);

function norm(s: string): string {
  return (s || "").toLowerCase().trim().replace(/\s+/g, " ");
}

function parseLocal(s: string): Date {
  const [y, m, d] = s.split("-").map(Number);
  return new Date(y, m - 1, d);
}

function daysBetween(a: string, b: string): number {
  return Math.round((parseLocal(b).getTime() - parseLocal(a).getTime()) / 86_400_000) + 1;
}

type Row = {
  employee_name: string;
  venue: string;
  role: string;
  salary: number;
  revenue: number;
  k_pct: number | null;
  flag: "no_match" | "no_revenue" | "no_salary" | null;
};

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const dateFrom = searchParams.get("date_from");
  const dateTo   = searchParams.get("date_to");
  if (!dateFrom || !dateTo) {
    return NextResponse.json({ error: "date_from and date_to are required" }, { status: 400 });
  }
  const supabase = await createServerSupabaseClient();

  // ── 1. Role mapping ─────────────────────────────────────────────────────────
  const { data: roleData } = await supabase.from("wage_role_mapping").select("contact_key, role");
  const roleMap = new Map<string, string>();
  for (const r of (roleData ?? [])) roleMap.set(norm(r.contact_key as string), (r.role as string).toLowerCase());

  // ── 2. Wages from transactions_raw ──────────────────────────────────────────
  const { data: wageTxns } = await supabase
    .from("transactions_raw")
    .select("venue, contact_name, amount")
    .eq("ebitda_line", "wages")
    .in("venue", ALL_VENUES)
    .gte("date", dateFrom).lte("date", dateTo);

  // (venue|name) → salary
  const salaryMap = new Map<string, { salary: number; role: string; rawName: string; venue: string }>();
  for (const t of (wageTxns ?? [])) {
    const name = (t.contact_name as string) || "";
    if (!name) continue;
    const key = norm(name);
    const role = roleMap.get(key) ?? "unassigned";
    if (!PRODUCTIVE_ROLES.has(role)) continue;
    const venue = t.venue as string;
    const mapKey = `${venue}|${key}`;
    const ex = salaryMap.get(mapKey) ?? { salary: 0, role, rawName: name, venue };
    ex.salary += Number(t.amount ?? 0);
    salaryMap.set(mapKey, ex);
  }

  // ── 3. Salary supplement (prorate per month) ────────────────────────────────
  const months: string[] = [];
  {
    let y = +dateFrom.slice(0, 4), m = +dateFrom.slice(5, 7);
    const ey = +dateTo.slice(0, 4), em = +dateTo.slice(5, 7);
    while (y < ey || (y === ey && m <= em)) {
      months.push(`${y}-${String(m).padStart(2, "0")}-01`);
      m++; if (m > 12) { m = 1; y++; }
    }
  }
  const { data: suppData } = await supabase
    .from("salary_supplement_monthly")
    .select("spa_slug, employee_name, amount, role, month")
    .in("venue", ALL_VENUES.length > 0 ? ALL_VENUES : ["__none__"])  // skip filter if needed
    .in("month", months.length ? months : ["1900-01-01"])
    .eq("is_frozen", true);

  // The schema may use spa_slug, not venue. Re-query if needed:
  let suppRows = suppData;
  if (!suppRows || suppRows.length === 0) {
    const { data: alt } = await supabase
      .from("salary_supplement_monthly")
      .select("spa_slug, employee_name, amount, role, month")
      .in("spa_slug", ALL_VENUES)
      .in("month", months.length ? months : ["1900-01-01"])
      .eq("is_frozen", true);
    suppRows = alt ?? [];
  }

  for (const s of suppRows ?? []) {
    const role = ((s.role as string) || "").toLowerCase().trim();
    if (!PRODUCTIVE_ROLES.has(role)) continue;
    const name = (s.employee_name as string) || "";
    if (!name) continue;
    const venue = (s.spa_slug as string) ?? "";
    if (!venue) continue;

    const m = (s.month as string).slice(0, 10);
    const mY = +m.slice(0, 4), mMo = +m.slice(5, 7);
    const lastD = new Date(mY, mMo, 0).getDate();
    const mEnd = `${mY}-${String(mMo).padStart(2, "0")}-${String(lastD).padStart(2, "0")}`;
    const rs = dateFrom > m    ? dateFrom : m;
    const re = dateTo   < mEnd ? dateTo   : mEnd;
    const dr = rs > re ? 0 : daysBetween(rs, re);
    const prorated = Number(s.amount ?? 0) * (dr / lastD);
    if (prorated <= 0) continue;

    const key = norm(name);
    const mapKey = `${venue}|${key}`;
    const ex = salaryMap.get(mapKey) ?? { salary: 0, role, rawName: name, venue };
    ex.salary += prorated;
    if (!ex.role || ex.role === "unassigned") ex.role = role;
    salaryMap.set(mapKey, ex);
  }

  // ── 4. Aliases ──────────────────────────────────────────────────────────────
  const { data: aliasData } = await supabase
    .from("practitioner_name_aliases")
    .select("revenue_name, canonical_name, venue");
  // (venue|normalized-revenue-name) → normalized-canonical-name
  const aliasMap = new Map<string, string>();
  for (const a of (aliasData ?? [])) {
    aliasMap.set(`${(a.venue as string)}|${norm(a.revenue_name as string)}`, norm(a.canonical_name as string));
  }

  function applyAlias(brand: string, name: string): string {
    return aliasMap.get(`${brand}|${norm(name)}`) ?? norm(name);
  }

  // ── 5. Revenue per practitioner per brand ───────────────────────────────────

  // 5a. Spa
  const { data: spaRev } = await supabase
    .from("spa_services_by_employee_daily")
    .select("location_id, employee_name, price_ex_vat")
    .gte("date_of_service", dateFrom).lte("date_of_service", dateTo);
  // (venue|name) → revenue
  const spaRevMap = new Map<string, { revenue: number; rawName: string; venue: string }>();
  for (const r of (spaRev ?? [])) {
    const venue = LOC_ID_TO_SLUG[r.location_id as number];
    if (!venue) continue;
    const rawName = (r.employee_name as string) || "";
    const key = applyAlias("spa", rawName);
    const mapKey = `${venue}|${key}`;
    const ex = spaRevMap.get(mapKey) ?? { revenue: 0, rawName, venue };
    ex.revenue += Number(r.price_ex_vat ?? 0);
    spaRevMap.set(mapKey, ex);
  }

  // 5b. Aesthetics — prefer note_person (practitioner) over sales_staff
  const { data: aesRev } = await supabase
    .from("aesthetics_sales_daily")
    .select("note_person, sales_staff, price_ex_vat")
    .gte("date_of_service", dateFrom).lte("date_of_service", dateTo);
  const aesRevMap = new Map<string, { revenue: number; rawName: string }>();
  for (const r of (aesRev ?? [])) {
    const rawName = ((r.note_person as string) || (r.sales_staff as string) || "").trim();
    if (!rawName) continue;
    const key = applyAlias("aesthetics", rawName);
    const ex = aesRevMap.get(key) ?? { revenue: 0, rawName };
    ex.revenue += Number(r.price_ex_vat ?? 0);
    aesRevMap.set(key, ex);
  }

  // 5c. Slimming
  const { data: slmRev } = await supabase
    .from("slimming_treatments_daily")
    .select("therapist, price_ex_vat")
    .gte("date_of_service", dateFrom).lte("date_of_service", dateTo);
  const slmRevMap = new Map<string, { revenue: number; rawName: string }>();
  for (const r of (slmRev ?? [])) {
    const rawName = ((r.therapist as string) || "").trim();
    if (!rawName) continue;
    const key = applyAlias("slimming", rawName);
    const ex = slmRevMap.get(key) ?? { revenue: 0, rawName };
    ex.revenue += Number(r.price_ex_vat ?? 0);
    slmRevMap.set(key, ex);
  }

  // ── 6. Join + emit rows per brand ───────────────────────────────────────────
  const out: Record<"spa" | "aesthetics" | "slimming", Row[]> = { spa: [], aesthetics: [], slimming: [] };

  // Spa: per venue
  const spaSalaryKeys = new Set<string>();
  for (const [k, v] of salaryMap) {
    if (!SPA_VENUES.includes(v.venue)) continue;
    spaSalaryKeys.add(k);
    const revEntry = spaRevMap.get(k);
    const revenue = revEntry?.revenue ?? 0;
    const displayName = revEntry?.rawName || v.rawName;
    const flag = revenue === 0 ? "no_revenue" : null;
    out.spa.push({
      employee_name: displayName, venue: v.venue, role: v.role,
      salary: +v.salary.toFixed(2), revenue: +revenue.toFixed(2),
      k_pct: revenue > 0 ? +((v.salary / revenue) * 100).toFixed(1) : null,
      flag,
    });
  }
  // Spa: revenue-only (no matching salary)
  for (const [k, r] of spaRevMap) {
    if (spaSalaryKeys.has(k)) continue;
    out.spa.push({
      employee_name: r.rawName, venue: r.venue, role: "therapist",
      salary: 0, revenue: +r.revenue.toFixed(2), k_pct: null, flag: "no_salary",
    });
  }

  // Aesthetics
  const aesSalaryRows = Array.from(salaryMap.values()).filter(v => v.venue === "aesthetics");
  const aesSalaryNames = new Set<string>();
  for (const v of aesSalaryRows) {
    const nameKey = norm(v.rawName);
    aesSalaryNames.add(nameKey);
    const revEntry = aesRevMap.get(nameKey);
    const revenue = revEntry?.revenue ?? 0;
    out.aesthetics.push({
      employee_name: revEntry?.rawName || v.rawName, venue: "aesthetics", role: v.role,
      salary: +v.salary.toFixed(2), revenue: +revenue.toFixed(2),
      k_pct: revenue > 0 ? +((v.salary / revenue) * 100).toFixed(1) : null,
      flag: revenue === 0 ? "no_revenue" : null,
    });
  }
  for (const [k, r] of aesRevMap) {
    if (aesSalaryNames.has(k)) continue;
    out.aesthetics.push({
      employee_name: r.rawName, venue: "aesthetics", role: "practitioner",
      salary: 0, revenue: +r.revenue.toFixed(2), k_pct: null, flag: "no_salary",
    });
  }

  // Slimming
  const slmSalaryRows = Array.from(salaryMap.values()).filter(v => v.venue === "slimming");
  const slmSalaryNames = new Set<string>();
  for (const v of slmSalaryRows) {
    const nameKey = norm(v.rawName);
    slmSalaryNames.add(nameKey);
    const revEntry = slmRevMap.get(nameKey);
    const revenue = revEntry?.revenue ?? 0;
    out.slimming.push({
      employee_name: revEntry?.rawName || v.rawName, venue: "slimming", role: v.role,
      salary: +v.salary.toFixed(2), revenue: +revenue.toFixed(2),
      k_pct: revenue > 0 ? +((v.salary / revenue) * 100).toFixed(1) : null,
      flag: revenue === 0 ? "no_revenue" : null,
    });
  }
  for (const [k, r] of slmRevMap) {
    if (slmSalaryNames.has(k)) continue;
    out.slimming.push({
      employee_name: r.rawName, venue: "slimming", role: "therapist",
      salary: 0, revenue: +r.revenue.toFixed(2), k_pct: null, flag: "no_salary",
    });
  }

  // Sort each brand by K% descending (worst at top), nulls last
  function sortByKpct(rows: Row[]): Row[] {
    return rows.sort((a, b) => {
      if (a.k_pct == null && b.k_pct == null) return b.revenue - a.revenue;
      if (a.k_pct == null) return 1;
      if (b.k_pct == null) return -1;
      return b.k_pct - a.k_pct;
    });
  }

  return NextResponse.json({
    date_from: dateFrom, date_to: dateTo,
    spa:        sortByKpct(out.spa),
    aesthetics: sortByKpct(out.aesthetics),
    slimming:   sortByKpct(out.slimming),
  });
}
```

> **Note on `salary_supplement_monthly` columns.** The existing drill route filters by `spa_slug` (line 244 of `app/api/finance/ebitda-v2/drill/route.ts`). The code above defensively tries `venue` then falls back to `spa_slug`. If your schema clearly only uses one, simplify the query before committing.

**Step 2: Type-check + lint locally**

Run: `pnpm exec next build 2>&1 | tail -30`
Expected: build succeeds. If type errors, fix before commit.

**Step 3: Hit the endpoint and inspect**

With dev server running:

```bash
curl -s 'http://localhost:3000/api/finance/practitioner-productivity?date_from=2026-01-01&date_to=2026-05-31' | jq '.spa | length, .aesthetics | length, .slimming | length'
```

Expected: three integers, each > 0. Then sample one row from each brand and confirm `salary`, `revenue`, `k_pct` look plausible.

**Step 4: Sanity check against existing wages drill**

Pick one Spa venue (e.g. `hugos`). Hit:
```bash
curl -s 'http://localhost:3000/api/finance/ebitda-v2/drill?venue=hugos&ebitda_line=wages&date_from=2026-01-01&date_to=2026-05-31&wage_role=therapist' | jq '.total, .contacts | length'
```
Then compare to the sum of `salary` for Hugo therapists from this new endpoint:
```bash
curl -s 'http://localhost:3000/api/finance/practitioner-productivity?date_from=2026-01-01&date_to=2026-05-31' | jq '[.spa[] | select(.venue=="hugos") | .salary] | add'
```
Expected: numbers match within €5 (rounding tolerance).

**Step 5: Commit**

```bash
git add app/api/finance/practitioner-productivity
git commit -m "feat(api): practitioner productivity endpoint (salary + revenue + K% per practitioner across all 3 brands)"
```

---

### Task 6: UI section in `/finance/ebitda-v2`

**Files:**
- Create: `components/finance/PractitionerProductivityTable.tsx`
- Modify: `app/finance/ebitda-v2/page.tsx`

**Step 1: Build the component**

`components/finance/PractitionerProductivityTable.tsx`:

```tsx
"use client";

import { useEffect, useState } from "react";
import { AlertTriangle } from "lucide-react";

type Row = {
  employee_name: string;
  venue: string;
  role: string;
  salary: number;
  revenue: number;
  k_pct: number | null;
  flag: "no_match" | "no_revenue" | "no_salary" | null;
};

type ApiData = {
  date_from: string;
  date_to: string;
  spa: Row[];
  aesthetics: Row[];
  slimming: Row[];
};

const BRAND_LABELS: Record<"spa" | "aesthetics" | "slimming", string> = {
  spa: "Spa", aesthetics: "Aesthetics", slimming: "Slimming",
};

function fmtC(v: number): string {
  if (v === 0) return "—";
  const abs = Math.abs(v);
  if (abs >= 1000) return `€${(v / 1000).toFixed(1)}K`;
  return `€${v.toFixed(0)}`;
}

function kBadge(k: number | null) {
  if (k == null) return <span className="text-muted-foreground text-xs">n/a</span>;
  const cls = k <= 30 ? "bg-emerald-100 text-emerald-800"
            : k <= 50 ? "bg-amber-100 text-amber-800"
            : "bg-red-100 text-red-800";
  return <span className={`inline-block rounded px-1.5 py-0.5 text-xs font-semibold ${cls}`}>{k}%</span>;
}

function flagPill(flag: Row["flag"]) {
  if (!flag) return null;
  const label = flag === "no_revenue" ? "no revenue matched"
              : flag === "no_salary"  ? "no salary matched"
              : "no match";
  return (
    <span className="inline-flex items-center gap-1 rounded bg-amber-50 border border-amber-200 px-1.5 py-0.5 text-[10px] text-amber-700">
      <AlertTriangle className="h-2.5 w-2.5" />
      {label}
    </span>
  );
}

export function PractitionerProductivityTable({
  dateFrom, dateTo,
}: { dateFrom: string; dateTo: string }) {
  const [data, setData]   = useState<ApiData | null>(null);
  const [tab, setTab]     = useState<"spa" | "aesthetics" | "slimming">("spa");
  const [loading, setLoad] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setLoad(true); setError(null); setData(null);
    const c = new AbortController();
    fetch(`/api/finance/practitioner-productivity?date_from=${dateFrom}&date_to=${dateTo}`, { signal: c.signal })
      .then(r => r.json())
      .then(d => { if (d.error) throw new Error(d.error); setData(d); setLoad(false); })
      .catch(e => { if (e.name !== "AbortError") { setError(String(e)); setLoad(false); } });
    return () => c.abort();
  }, [dateFrom, dateTo]);

  const rows = data?.[tab] ?? [];

  return (
    <div className="rounded border bg-card">
      <div className="px-4 py-3 border-b flex items-center justify-between">
        <div>
          <h3 className="font-semibold text-sm">Practitioner Productivity</h3>
          <p className="text-xs text-muted-foreground">Salary cost as % of revenue generated, per practitioner. Therapists + practitioners only.</p>
        </div>
        <div className="flex gap-1">
          {(["spa", "aesthetics", "slimming"] as const).map(t => (
            <button key={t} onClick={() => setTab(t)}
              className={`text-xs px-2.5 py-1 rounded border transition-colors ${
                tab === t ? "bg-foreground text-background" : "hover:bg-muted"
              }`}>
              {BRAND_LABELS[t]} {data ? `(${data[t].length})` : ""}
            </button>
          ))}
        </div>
      </div>

      <div className="overflow-x-auto">
        {loading && <p className="text-sm text-muted-foreground py-6 text-center">Loading…</p>}
        {error   && <p className="text-sm text-destructive py-4 px-4">{error}</p>}
        {!loading && !error && rows.length === 0 && (
          <p className="text-sm text-muted-foreground py-6 text-center">No data for this period.</p>
        )}
        {!loading && !error && rows.length > 0 && (
          <table className="w-full text-xs">
            <thead>
              <tr className="text-muted-foreground border-b bg-muted/30">
                <th className="text-left px-3 py-2 font-medium">Practitioner</th>
                <th className="text-left px-3 py-2 font-medium">Venue</th>
                <th className="text-left px-3 py-2 font-medium">Role</th>
                <th className="text-right px-3 py-2 font-medium">Salary</th>
                <th className="text-right px-3 py-2 font-medium">Revenue</th>
                <th className="text-right px-3 py-2 font-medium">K%</th>
                <th className="text-left px-3 py-2 font-medium">Status</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r, i) => (
                <tr key={`${r.venue}-${r.employee_name}-${i}`} className="border-b last:border-0 hover:bg-muted/20">
                  <td className="px-3 py-1.5 font-medium">{r.employee_name}</td>
                  <td className="px-3 py-1.5 capitalize text-muted-foreground">{r.venue.replace(/_/g, " ")}</td>
                  <td className="px-3 py-1.5 capitalize text-muted-foreground">{r.role}</td>
                  <td className="px-3 py-1.5 text-right tabular-nums">{fmtC(r.salary)}</td>
                  <td className="px-3 py-1.5 text-right tabular-nums">{fmtC(r.revenue)}</td>
                  <td className="px-3 py-1.5 text-right">{kBadge(r.k_pct)}</td>
                  <td className="px-3 py-1.5">{flagPill(r.flag)}</td>
                </tr>
              ))}
            </tbody>
            <tfoot className="border-t bg-muted/30">
              <tr>
                <td className="px-3 py-2 font-semibold" colSpan={3}>Total ({rows.length})</td>
                <td className="px-3 py-2 text-right tabular-nums font-semibold">
                  {fmtC(rows.reduce((s, r) => s + r.salary, 0))}
                </td>
                <td className="px-3 py-2 text-right tabular-nums font-semibold">
                  {fmtC(rows.reduce((s, r) => s + r.revenue, 0))}
                </td>
                <td className="px-3 py-2 text-right">
                  {(() => {
                    const totS = rows.reduce((s, r) => s + r.salary, 0);
                    const totR = rows.reduce((s, r) => s + r.revenue, 0);
                    return totR > 0 ? kBadge(+((totS / totR) * 100).toFixed(1)) : kBadge(null);
                  })()}
                </td>
                <td></td>
              </tr>
            </tfoot>
          </table>
        )}
      </div>
    </div>
  );
}
```

**Step 2: Mount it in the EBITDA v2 page**

Modify `app/finance/ebitda-v2/page.tsx`. Add the import at the top:

```ts
import { PractitionerProductivityTable } from "@/components/finance/PractitionerProductivityTable";
```

Then inside the `EbitdaV2Content` component, after the `<div className="overflow-x-auto rounded border bg-card">…</div>` closing tag that holds the main P&L table — but still inside the outer `space-y-4` container, before the fallback summary — add:

```tsx
<PractitionerProductivityTable dateFrom={dfStr} dateTo={dtStr} />
```

Exact placement: after line 828 (`</div>` closing the P&L table wrapper) and before line 831 (the `{data.fallback_applied.length > 0 && …}` block). The component lives between those two.

**Step 3: Run dev server + load the page**

```bash
pnpm dev
```

Open `http://localhost:3000/finance/ebitda-v2`. Use the date picker → set to "Last 6 months".

Expected:
- P&L table renders as before
- New "Practitioner Productivity" section appears below
- All three brand tabs work
- Sample row shows Salary, Revenue, K% all populated for at least 3 known therapists
- "No salary matched" or "No revenue matched" tags appear for the obvious mismatches (e.g. Spa sheet uses first-name only)

**Step 4: Commit**

```bash
git add components/finance/PractitionerProductivityTable.tsx app/finance/ebitda-v2/page.tsx
git commit -m "feat(ebitda-v2): add Practitioner Productivity table — salary cost as % of revenue generated, per practitioner"
```

---

### Task 7: Type-check, lint, and full build

**Files:** none

**Step 1: Run the full build**

```bash
cd Tech/CEO-Cockpit && pnpm build 2>&1 | tail -50
```

Expected: build succeeds with no type errors. If errors appear, fix and re-run.

**Step 2: Run lint**

```bash
pnpm lint 2>&1 | tail -20
```

Expected: 0 errors. Warnings OK.

**Step 3: No commit unless fixes were needed**

---

### Task 8: Push to remote and verify Vercel deploy

**Files:** none

**Step 1: Confirm working directory matches the cockpit deploy repo**

The Cockpit deploy workflow (from project memory) pushes to `carismawellness/carisma-support` main branch. Before pushing, confirm:

```bash
cd Tech/CEO-Cockpit && git remote -v
```

If the remote is the carisma-support repo, continue. If not — STOP and ask the user how to publish. Do NOT use `vercel --prod` from CLI.

**Step 2: Push**

```bash
git push origin main
```

Expected: push succeeds.

**Step 3: Wait for Vercel build and confirm via `gh api`**

```bash
sleep 30
gh api repos/carismawellness/carisma-support/deployments --jq '.[0] | {environment, created_at, statuses_url}'
gh api repos/carismawellness/carisma-support/commits/main/check-runs --jq '.check_runs[] | {name, status, conclusion}'
```

Expected: latest deployment is for the just-pushed commit, status reads `success`.

**Step 4: Verify the live page**

Open `https://carisma-support-u2vb.vercel.app/finance/ebitda-v2`. Confirm:
- Page loads
- Practitioner Productivity section appears
- Numbers populate (not all zero)

Report the URL and a one-line confirmation to the user.

---

## Out of scope

- Hours-worked / utilization (would need Fresha integration)
- Longitudinal trend view
- Drill-down dialog from each productivity row
- Aesthetics revenue: this uses `note_person` falling back to `sales_staff`. If `note_person` is sparsely populated, K% may be skewed — flag this for a follow-up if it shows up in the spot-checks
