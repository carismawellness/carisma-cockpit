# Spa Historical Migration Plan (2014 – Aug 2023)

**Source:** Google Sheet `1jOdDzPFWqVL-kRPA2TjBSqK6Fj5A6KCQZShlXwESh6I`, tab `Sales MASTER` (gid `1229497505`).

**Verified data shape (column B / Service Date sweep, all 4 chunks B2 → B170000):**

| Year | Row count | Notes |
|---|---|---|
| 2014 | 1 | single stray row, `10/10/2014` |
| 2015 | 16,040 | |
| 2016 | 17,685 | |
| 2017 | 19,570 | |
| 2018 | 23,180 | |
| 2019 | 25,961 | peak year |
| 2020 | 6,802 | COVID dip |
| 2021 | 18,809 | |
| 2022 | 21,804 | |
| 2023 | 17,316 | **Jan 1 → Aug 27 only** (8 months) |
| **Total** | **167,168** | |

Earliest service date: `2014-10-10`. Latest service date: `2023-08-27`. Date format is uniform `D/M/YYYY` or `DD/MM/YYYY` throughout — the suspected "different data type" for 2023 turned out to be a sampling artefact in the prior pass.

Sheet has **42 columns (A–AP)**, not 26. Columns A–Z are the source data; AA–AP are pre-calculated formulas (per-location retail revenue split, VAT amount/ex-VAT amount, "Daily average revenue", a "DONT USE Type of Service (Formula)" column). The formula columns are noise — we re-derive them in Postgres, we do not ingest them.

**Bridge target:** existing Cockpit Datasheet (`195RvbNuZd-oNL-rziKC3Wz6ndy0cDA_a`) which begins **2025-01-01** (verified by parsing the live `Service - Spa` CSV — earliest Service Date `2025-01-01`, latest `2026-06-04`, 70,316 rows) and feeds `spa_revenue_daily` / `spa_revenue_monthly` / `spa_services_by_employee_daily` via `lib/etl/spa-revenue.ts` and `lib/etl/spa-services-by-employee.ts`.

## 🚨 Gap finding — must resolve before migration

| Range | Status |
|---|---|
| 2014-10-10 → 2023-08-27 | covered by historic sheet (this migration) |
| **2023-09-01 → 2024-12-31** | **NO DATA in either source — ~16 months missing** |
| 2025-01-01 → today | covered by live Cockpit Datasheet |

Until this gap is sourced (older Lapis export? Zoho-only? a different sheet?), the cockpit will have continuous monthly history `2014-10 → 2023-08`, then a hole, then `2025-01 → present`. The historic backfill itself is unblocked, but the dashboards will still show a 16-month gap.

## User-confirmed decisions

1. **QAWRA** — historic-only Sales Point (2015–2019). Add as a new row to `locations` with `is_active=false`, brand_id=spa. (Not merging into RAMLA.)
2. **`Spa Club`** in `Service Type` — classify as `services` revenue (not retail). Same bucket as `Service`, `Spa Facilities`, `Add Ons`.
3. **2023 data** — present in source sheet through Aug 27 2023. Migrate fully.

---

## Recommendation up front

**Adopt option (c) — hybrid.** Create one new table `spa_transactions_raw` to land every historical row losslessly, then derive `spa_revenue_daily` (aggregate) and `spa_services_by_employee_daily` (per-row projection) from it for 2015-2023. Keep the live 2024+ ETL exactly as it is; the two date ranges meet at `2024-01-01` and never overlap.

Why not (a) raw only: the cockpit already aggregates 2024+ into `spa_revenue_daily` — dashboards already read that table. We must backfill it for 2015-2023 or every dashboard breaks at the 2024 boundary.

Why not (b) aggregate only: throws away therapist, package, payment type, guest type, customer email — the user explicitly said "no loss of information". A row-level table costs ~25 MB compressed in Postgres for 181k rows; that's cheap insurance.

Why (c) wins: one ingest, two writes, dashboards keep working, and Sarah can later build per-therapist / per-package / hotel-vs-non-hotel historic views without re-ingesting.

**Key artefacts to create**
- DDL: `supabase/migrations/070_create_spa_transactions_raw.sql`
- Backfill script: `scripts/spa-historical-backfill.ts` (one-off, idempotent)
- QC script: `scripts/qc-spa-historical.ts`
- API trigger (optional): `app/api/etl/spa-historical/route.ts` — wraps the backfill so it can be invoked from the cockpit, not strictly required.

---

## 1. What's wrong with the source sheet

Documented from sampling rows 2, 20000, 45000, 70000, 90000, 115000, 135000, 160000, 175000, 181275-181280.

| Issue | Where it shows up | Impact |
|---|---|---|
| **Date format drift** | 2022+: `31/12/2022` (zero-padded `DD/MM/YYYY`). 2019/2016: `4/5/2019`, `2/7/2016` (unpadded, ambiguous day-vs-month at a glance — but always day-first). | Parser must accept both `D/M/YYYY` and `DD/MM/YYYY`. Existing `parseCockpitDate` in `lib/etl/spa-revenue.ts` already handles both — reuse it. |
| **Empty `Service Date`** | Last ~thousand rows (placeholder Spa Club guest passes, gift card add-ons; sample rows ~175000 and 181275-181280). | Drop from `spa_revenue_daily` aggregation. Insert into `spa_transactions_raw` with `service_date IS NULL` so they are recoverable. |
| **Column drift in pre-2020 data** | 2016, 2019 rows have `Service Upper Group`, `Package Name`, `Service Group`, `Name`, `Surname`, `E-Mail`, `Payment Type`, `Room`, `Duration` all blank. Only Service Name, Therapist, Sales Point, List Price, Net Revenue, Service Type are reliable. | Schema must allow NULL on every column except primary key + service_date (after filter) + location_id + revenue_ex_vat. |
| **Currency prefix on numerics** | `List Price` and `Net Revenue (Unit price)` are strings like `€19.00`, `€88.33`, `€0.00`. | Strip `€`, `$`, `£`, commas, whitespace, then `parseFloat`. The existing `safeFloat()` in `lib/etl/spa-services-by-employee.ts` already does this — reuse it. |
| **Negative `Net Revenue` and negative `Discount %`** | 2016 rows (e.g. `€32.00` list, `-9.38` discount %, `€35.00` net). | Preserve sign — these are price adjustments / refunds. Do NOT clamp to ≥ 0. |
| **`Discount %` can be empty, `"0"`, negative, or > 100** | Across all years. | Store as numeric, allow NULL. Do not compute discount value from it — use the sheet's own `Discount Value (Formula)` column. |
| **Therapist column holds two different name conventions** | 2022+: single first name (`MILENA`). 2019: full name (`Milena Lazorova Lazorova` — duplicated surname is a known artefact). 2016: often blank. Also includes non-therapist tokens `SPA DAY`, `REC`, `CARISMA (SALES)`. | Land verbatim into `therapist_raw`. For derived `spa_services_by_employee_daily`, normalise via `practitioner_name_aliases` table (already exists) and exclude `CARISMA (SALES)`, `SPA DAY`, `REC`, blank. |
| **Unknown historic location: `QAWRA`** | 2016 (row 160000), 2019 (rows 135000, 78443, 78865). Not in `COCKPIT_SPA_LOCATION_MAP`. | Add a new row to `locations` table for `qawra` (closed branch) OR map `QAWRA → RAMLA` if Mert confirms it was the Qawra branch that became Ramla. **Open question for Mert.** Default plan: add `qawra` as a new closed location with `is_active=false`. |
| **No `Brand` column on retail rows** | 2019 row `PFSVV139L CITYLIFE FACE AND EYE CONTOUR SORBET CREAM 50 ML` is clearly a Phytomer SKU (PFSVV = Phytomer SKU prefix) but the sheet has no Brand column. | For `spa_revenue_daily`, detect Phytomer by SKU regex (`^P[A-Z]{4}\d`), Purest by name regex; everything else → `product_other`. Document the regex list in the backfill script and surface unknown SKUs in the QC report so Mert can fix them. |
| **Service Type taxonomy** | Values seen: `Service`, `Retail`, `Spa Facilities`, `Add Ons`, `Spa Club`. | Map: `Service`, `Spa Facilities`, `Add Ons` → `services` bucket. `Retail` → product bucket (brand by SKU regex). `Spa Club` → **services** (membership redemptions are service revenue). Confirm with Mert. |
| **Duplicate ZOHO IDs theoretically possible** | ZOHO IDs are mostly unique-ish (range 23,000 → 288,000 across the file) but the same ID can appear on multiple physical rows when a single Zoho txn split into multiple service rows. ZOHO ID 245,374 and 245,373 are clearly distinct, but at ~5,000 row sample I saw no actual duplicates. | Do NOT use ZOHO ID as primary key. Use a synthetic `sheet_row_id` (the sheet row number) as the immutable natural key. |
| **VAT-inclusive prices** | All `€` amounts are gross. Live ETL applies `/1.18` to get ex-VAT. | Backfill must apply the same `/1.18` when writing the `revenue_ex_vat` derived column AND when aggregating to `spa_revenue_daily.services`. Store the original gross in `net_revenue_gross` on the raw table so it's recoverable. |
| **Trailing whitespace and `&` HTML-escape in service names** | Sample: `10-B Japanese Neck Back & Shoulder`. | Trim, replace `&` → `&` on insert. |
| **PII present** | `E-Mail`, `Name`, `Surname`. | Land as-is into raw table (it's already in a Google Sheet anyone with the link can read). Add a comment to the migration noting PII. If Mert wants hashed emails, do that in a follow-up — don't block the migration on it. |

---

## 2. Target schema decision and DDL

### Existing tables (do not modify)

| Table | Grain | Already populated 2024+ | Source ETL |
|---|---|---|---|
| `spa_revenue_daily` | (location_id, date) | yes | `lib/etl/spa-revenue.ts` `runSpaRevenueDaily` |
| `spa_revenue_monthly` | (location_id, month) | yes | `lib/etl/spa-revenue.ts` `runSpaRevenue` |
| `spa_services_by_employee_daily` | (date, location_id, employee_name, service_name) | yes | `lib/etl/spa-services-by-employee.ts` |
| `locations` / `brands` | dimensions | yes | `001_create_dimensions.sql` |
| `practitioner_name_aliases` | name lookup | yes | `065_…sql` |

### New table

`supabase/migrations/070_create_spa_transactions_raw.sql`

```sql
-- Spa historical per-transaction landing table (2015-2023 backfill from
-- the legacy "Sales MASTER" sheet 1jOdDzPFWqVL-kRPA2TjBSqK6Fj5A6KCQZShlXwESh6I).
-- Loss-less mirror of 26 sheet columns + a synthetic row id for idempotency.
-- After this lands, derived rows are upserted into spa_revenue_daily and
-- spa_services_by_employee_daily by scripts/spa-historical-backfill.ts.
--
-- PII NOTE: contact_email / first_name / surname are loaded as-is from the
-- source sheet (which is already shared inside the company). If GDPR review
-- requires it, follow up by hashing email and dropping surname.

CREATE TABLE IF NOT EXISTS spa_transactions_raw (
    id                  BIGSERIAL PRIMARY KEY,
    sheet_row_id        INTEGER     NOT NULL,            -- sheet row #, immutable
    zoho_id             TEXT,                            -- "238,495" — keep formatted; not unique
    service_date        DATE,                            -- NULL if blank in source
    service_time        TIME,                            -- NULL ok
    service_upper_group TEXT,
    package_name        TEXT,
    service_group       TEXT,
    service_name        TEXT,
    first_name          TEXT,
    surname             TEXT,
    contact_email       TEXT,
    payment_type        TEXT,
    room                TEXT,
    duration_min        INTEGER,
    list_price_gross    NUMERIC(12,2),                   -- after € strip
    discount_pct        NUMERIC(8,2),                    -- can be negative
    net_revenue_gross   NUMERIC(12,2)  NOT NULL,         -- after € strip; VAT-incl.
    revenue_ex_vat      NUMERIC(12,2)  NOT NULL,         -- net_revenue_gross / 1.18
    lead_type           TEXT,
    location_id         INTEGER        REFERENCES locations(id), -- NULL if unmapped
    sales_point_raw     TEXT           NOT NULL,         -- e.g. 'INTER', 'QAWRA'
    therapist_raw       TEXT,                            -- verbatim from sheet
    therapist_canonical TEXT,                            -- post-alias lookup; NULL if no map
    guest_group         TEXT,                            -- 'HOTEL GUEST' / 'NON-HOTEL GUEST'
    sold_by             TEXT,
    cost_amount         NUMERIC(12,2),                   -- often blank
    profit              NUMERIC(12,2),                   -- often blank
    day_of_week         TEXT,
    service_type        TEXT,                            -- 'Service' | 'Retail' | 'Spa Facilities' | 'Add Ons' | 'Spa Club'
    discount_value      NUMERIC(12,2),
    revenue_bucket      TEXT          NOT NULL,          -- 'services' | 'product_phytomer' | 'product_purest' | 'product_other'
    sheet_synced_at     TIMESTAMPTZ   NOT NULL DEFAULT now(),
    UNIQUE (sheet_row_id)
);

CREATE INDEX IF NOT EXISTS spa_tx_raw_date_idx     ON spa_transactions_raw (service_date);
CREATE INDEX IF NOT EXISTS spa_tx_raw_loc_date_idx ON spa_transactions_raw (location_id, service_date);
CREATE INDEX IF NOT EXISTS spa_tx_raw_therapist_idx ON spa_transactions_raw (therapist_canonical);
CREATE INDEX IF NOT EXISTS spa_tx_raw_bucket_idx   ON spa_transactions_raw (revenue_bucket);

COMMENT ON TABLE spa_transactions_raw IS
  'Per-transaction landing table for 2015-2023 spa historical backfill. Live data (2024+) is aggregated only — this table covers gap before Cockpit Datasheet existed.';
```

### Optional: add QAWRA location

```sql
-- Append to 070_… if Mert confirms QAWRA was a distinct historic branch
INSERT INTO locations (brand_id, slug, name, is_active)
SELECT brand_id, 'qawra', 'Carisma Spa — Qawra (closed)', false
FROM locations WHERE slug = 'ramla'  -- inherit the spa brand_id
ON CONFLICT (slug) DO NOTHING;
```

---

## 3. Column mapping (26 sheet columns → targets)

Header indices are 0-based, matching the order returned by Sheets.

| # | Sheet column | → `spa_transactions_raw` | → `spa_revenue_daily` | → `spa_services_by_employee_daily` | Transformation |
|---|---|---|---|---|---|
| 0 | `ZOHO ID` | `zoho_id` (TEXT) | — | — | Keep as string; do NOT parse (commas inside, not unique). |
| 1 | `Service Date` | `service_date` | aggregation key | `date_of_service` | `parseCockpitDate` — supports `D/M/YYYY`, `DD/MM/YYYY`. NULL on empty. |
| 2 | `Time of Service` | `service_time` | — | — | `HH:MM` → `TIME`. NULL on `"7:00"` placeholder if Mert flags it as junk; keep otherwise. |
| 3 | `Service Upper Group` | `service_upper_group` | — | — | Trim. NULL on empty. |
| 4 | `Package Name` | `package_name` | — | — | Trim. NULL on empty. **Risk: see §6.** |
| 5 | `Service Group` | `service_group` | — | — | Trim. |
| 6 | `Service Name` | `service_name` | — | `service_name` | Trim; replace `&` → `&`. |
| 7 | `Name` | `first_name` | — | — | Trim. PII. |
| 8 | `Surname` | `surname` | — | — | Trim. PII. |
| 9 | `E-Mail` | `contact_email` | — | — | Trim. `@` placeholder → NULL. PII. |
| 10 | `Payment Type` | `payment_type` | — | — | Trim. Common values: `Credit Card`, `Cash`. |
| 11 | `Room` | `room` | — | — | Trim. |
| 12 | `Duration (min)` | `duration_min` | — | — | `parseInt`; NULL on empty/non-numeric. |
| 13 | `List Price` | `list_price_gross` | — | — | Strip `€`, commas, whitespace; `parseFloat`. |
| 14 | `Discount (Indirim %)` | `discount_pct` | — | — | `parseFloat`; allow negative. |
| 15 | `Net Revenue (Unit price)` | `net_revenue_gross` | (input to `services` etc.) | (input to `price_ex_vat`) | Strip `€`, commas; `parseFloat`. Preserve sign. |
| 16 | `Lead Type` | `lead_type` | — | — | Trim. |
| 17 | `Club (Sales Point)` | `location_id` + `sales_point_raw` | aggregation key | `location_id` | Lookup against `COCKPIT_SPA_LOCATION_MAP` (re-use from `spa-revenue.ts`). On miss: log + `location_id=NULL` + still insert into raw. Add `QAWRA → <qawra_id>` mapping. |
| 18 | `Therapist (Employee(s))` | `therapist_raw` + `therapist_canonical` | — | `employee_name` (use canonical) | Trim. Canonical = `practitioner_name_aliases` lookup with `venue='spa'`, fall back to raw if no alias. Exclude `CARISMA (SALES)`, `SPA DAY`, `REC`, `` from the per-employee derived table only — keep in raw. |
| 19 | `Guest Group` | `guest_group` | — | — | Trim. Values: `HOTEL GUEST` / `NON-HOTEL GUEST`. |
| 20 | `Sold By` | `sold_by` | — | — | Trim. |
| 21 | `Cost Amount` | `cost_amount` | — | — | Strip `€`; `parseFloat`; NULL on empty. Often blank → see §6 risk. |
| 22 | `Profit` | `profit` | — | — | Strip `€`; `parseFloat`; NULL on empty. Often blank. |
| 23 | `Date of Week` | `day_of_week` | — | — | Trim. Pure derived data — sanity-check it matches `EXTRACT(DOW FROM service_date)` in QC. |
| 24 | `Service Type` | `service_type` | bucket selector | filter | See bucket logic below. |
| 25 | `Discount Value (Formula)` | `discount_value` | — | — | `parseFloat`; allow negative. |

### Derived column: `revenue_bucket`

Computed during backfill, persisted on the raw row so QC and dashboards can group without re-evaluating regex.

```
if service_type IN ('Service', 'Spa Facilities', 'Add Ons', 'Spa Club'):
    bucket = 'services'
elif service_type == 'Retail':
    sku = service_name.upper().strip()
    if   re.match(r'^P[A-Z]{4}\d', sku):  bucket = 'product_phytomer'
    elif 'PUREST' in sku:                 bucket = 'product_purest'
    else:                                 bucket = 'product_other'
else:
    bucket = 'product_other'  # safety net; surface in QC report
```

### Derived `spa_revenue_daily` row (per location, per date)

For each `(location_id, service_date)` with `service_date IS NOT NULL`:

```
services         = SUM(revenue_ex_vat) WHERE revenue_bucket='services'
product_phytomer = SUM(revenue_ex_vat) WHERE revenue_bucket='product_phytomer'
product_purest   = SUM(revenue_ex_vat) WHERE revenue_bucket='product_purest'
product_other    = SUM(revenue_ex_vat) WHERE revenue_bucket='product_other'
lapis_synced_at  = NOW()
```

UPSERT on `(location_id, date)`. **Do not** touch `spa_revenue_monthly` — let the existing monthly rollup logic re-derive from daily, or write a one-off rollup that mirrors `runMonth`'s output without the Zoho dependency (Zoho data does not exist pre-2023, leave wholesale/discount/refund at 0).

### Derived `spa_services_by_employee_daily` row

For each `(date_of_service, location_id, employee_name, service_name)` with:
- `service_date IS NOT NULL`
- `revenue_bucket = 'services'`
- `therapist_canonical NOT NULL` and not in `{CARISMA (SALES), SPA DAY, REC}`
- `revenue_ex_vat > 0`

Insert row with `price_ex_vat = revenue_ex_vat`. This matches the existing schema exactly.

---

## 4. Bridge between historic and live datasets

### Overlap check
Historic sheet's most recent date sampled = `31/12/2022` (row 2). The Cockpit Datasheet starts `2024-01-01`. **There is a gap of all of 2023.**

→ **Open question for Mert (urgent):** is 2023 data anywhere? If yes, this plan also covers 2023; if not, dashboards will show a hole.

Tentative answer: the historic sheet *probably* contains 2023 — the row-2 sample landed on the newest-ZOHO-ID end but the file isn't sorted strictly by date. Confirm via:

```sql
-- After ingest, in Supabase SQL editor
SELECT EXTRACT(YEAR FROM service_date) AS yr, COUNT(*), MIN(service_date), MAX(service_date)
FROM spa_transactions_raw
WHERE service_date IS NOT NULL
GROUP BY 1 ORDER BY 1;
```

### Reconciliation between historic and live ETL outputs

If 2023 overlaps with the Cockpit Datasheet (it shouldn't, but Mert may have backfilled the cockpit too):

```sql
-- Compare any overlap month between historical-derived and live-derived
WITH historic AS (
  SELECT location_id, date, services, product_phytomer + product_purest + product_other AS products
  FROM spa_revenue_daily
  WHERE date >= '2023-12-01' AND date <= '2024-01-31'
    AND lapis_synced_at < (SELECT MAX(lapis_synced_at) FROM spa_revenue_daily)  -- approximation; better: tag the historic rows
)
SELECT * FROM historic;  -- expect zero rows in 2024 from historic source
```

To make this robust, **add a column `data_source TEXT` to `spa_revenue_daily`** with values `'cockpit_live'` or `'historic_sheet'`. This is a 5-line migration and lets the reconciliation query be a one-line `WHERE data_source = 'historic_sheet'`. Recommend adding this in the same migration `070_…sql`.

```sql
-- Add to 070_…sql
ALTER TABLE spa_revenue_daily   ADD COLUMN IF NOT EXISTS data_source TEXT NOT NULL DEFAULT 'cockpit_live';
ALTER TABLE spa_revenue_monthly ADD COLUMN IF NOT EXISTS data_source TEXT NOT NULL DEFAULT 'cockpit_live';
ALTER TABLE spa_services_by_employee_daily ADD COLUMN IF NOT EXISTS data_source TEXT NOT NULL DEFAULT 'cockpit_live';
```

Backfill script writes `'historic_sheet'`.

---

## 5. Execution plan (ordered, each step committable)

### Step 1 — Confirm 3 open decisions with Mert (blocks DDL)
1. QAWRA — separate closed location, or merge into RAMLA?
2. `Spa Club` rows — `services` bucket (membership revenue = service) or new `services_membership` sub-bucket? Default: roll into `services`.
3. 2023 data — does it exist in this sheet, or in a different artefact? (Run the year-count query above after Step 5 to verify.)

### Step 2 — DDL migration
File: `supabase/migrations/070_create_spa_transactions_raw.sql`
Content: see §2. Includes the `data_source` columns added to existing tables.
Apply via Supabase CLI / dashboard. ~5 seconds. Rollback = `DROP TABLE spa_transactions_raw; ALTER TABLE … DROP COLUMN data_source`.

### Step 3 — Build the backfill script
File: `scripts/spa-historical-backfill.ts`

Skeleton:
```ts
// One-off backfill from sheet 1jOdDzPFWqVL-kRPA2TjBSqK6Fj5A6KCQZShlXwESh6I
// Usage: npx tsx scripts/spa-historical-backfill.ts [--dry-run] [--year=2019]
import { google } from "googleapis";
import { upsert, deleteWhere, insertRows, query } from "../lib/etl/supabase-etl";
import { parseCockpitDate, safeFloat } from "../lib/etl/spa-revenue";  // export these

const SHEET_ID = "1jOdDzPFWqVL-kRPA2TjBSqK6Fj5A6KCQZShlXwESh6I";
const TAB = "Sales MASTER";
const SPA_LOC_MAP: Record<string, number> = {
  INTER: 1, HUGOS: 2, HYATT: 3, RAMLA: 4,
  "LABRANDA GENERAL SALES POINT": 5, "SUNNY COAST": 6,
  "SALES POINT OF EXCELSIOR": 7, "SALES POINT OF NOV": 8,
  QAWRA: 9,                          // pending Mert confirmation
};
const SKIP_EMPLOYEES = new Set(["CARISMA (SALES)", "SPA DAY", "REC", ""]);
const VAT_RATE = 0.18;
const PHYTOMER_SKU_RE = /^P[A-Z]{4}\d/;

async function main() {
  // 1. Fetch full sheet in chunks of 50k rows (Sheets API caps single call at ~10MB).
  // 2. For each row: build txRaw record, derive revenue_bucket + revenue_ex_vat,
  //    look up therapist_canonical via practitioner_name_aliases.
  // 3. Bulk upsert into spa_transactions_raw on sheet_row_id.
  // 4. SELECT … FROM spa_transactions_raw WHERE data_source='historic_sheet' grouped
  //    by (location_id, service_date) → upsert into spa_revenue_daily.
  // 5. Filter raw → upsert spa_services_by_employee_daily (delete-then-insert per month).
  // 6. Print per-year/per-location row counts and revenue totals for QC.
}
```

Key engineering points:
- Use service-account auth + Sheets v4 API (NOT the public CSV export — sheet is private). Mert has `~/.go-google-mcp/token.json` and `GOOGLE_SHEETS_REFRESH_TOKEN` env vars.
- Fetch in chunks of 50,000 rows (`Sales MASTER!A2:Z50001`, then `A50002:Z100001`, etc.). Four chunks total for 181k rows.
- Use `sheet_row_id` (the 1-based row number in the sheet) as the idempotency key. Re-running is safe.
- Wrap inserts in a transaction per 5,000-row batch.
- Print one line per skip reason (bad date, unknown location, blank revenue, etc.) the way `spa-services-by-employee.ts` does.

### Step 4 — Run the backfill in dry-run mode
```bash
npx tsx scripts/spa-historical-backfill.ts --dry-run
```
Expected output: ~181k rows parsed, ~99% with location_id, ~95% with non-null `service_date`, X rows with unknown SKU surfaced for Mert.

### Step 5 — Run the backfill for real
```bash
npx tsx scripts/spa-historical-backfill.ts
```
Should take 3-8 minutes for 181k rows.

### Step 6 — QC

Run `scripts/qc-spa-historical.ts` (small script, ~50 lines) that prints:

```sql
-- Year coverage
SELECT EXTRACT(YEAR FROM service_date)::INT AS yr,
       COUNT(*) AS rows, COUNT(DISTINCT location_id) AS locs,
       SUM(revenue_ex_vat) AS total_ex_vat
FROM spa_transactions_raw
WHERE service_date IS NOT NULL
GROUP BY 1 ORDER BY 1;

-- Per-year total vs sheet (spot-check 3-5 years)
-- For each year, run the same SUM(net_revenue_gross / 1.18) against the
-- sheet (filter year in column B) and compare to the row above.
-- Expected: ≤ 0.5% delta (rounding).

-- Bucket sanity
SELECT revenue_bucket, COUNT(*), SUM(revenue_ex_vat)::INT AS eur
FROM spa_transactions_raw
GROUP BY 1 ORDER BY 1;

-- Aggregation round-trip
SELECT date,
       (SELECT SUM(revenue_ex_vat) FROM spa_transactions_raw r
        WHERE r.location_id = d.location_id AND r.service_date = d.date
          AND r.revenue_bucket='services') AS raw_services,
       d.services
FROM spa_revenue_daily d
WHERE d.data_source='historic_sheet' AND d.date IN ('2022-12-31', '2019-05-04', '2016-07-02')
ORDER BY d.date, d.location_id;

-- Bridge to live
SELECT EXTRACT(YEAR FROM date)::INT AS yr, data_source,
       SUM(services) AS services, SUM(product_phytomer+product_purest+product_other) AS products
FROM spa_revenue_daily
GROUP BY 1, 2 ORDER BY 1, 2;
-- Expected: no year has both data_source values. Years 2015-2023 are historic_sheet,
-- 2024+ are cockpit_live.

-- Unknown locations / unmapped therapists
SELECT sales_point_raw, COUNT(*) FROM spa_transactions_raw WHERE location_id IS NULL GROUP BY 1;
SELECT therapist_raw, COUNT(*) FROM spa_transactions_raw
WHERE therapist_canonical IS NULL AND therapist_raw NOT IN ('', 'CARISMA (SALES)', 'SPA DAY', 'REC')
GROUP BY 1 ORDER BY 2 DESC LIMIT 50;
```

### Step 7 — Verify totals against the source sheet (manual)
For 5 spot-check (year, location_id) tuples, compute `SUM(Net Revenue) / 1.18` in the sheet using `SUMIFS(P:P / 1.18, B:B, ">=2019-01-01", B:B, "<2020-01-01", R:R, "INTER")` and compare to the Supabase `SUM(services + product_*)` for the same window. Delta should be < 0.5%. Document deltas in `09-Miscellaneous/learnings/LEARNINGS.md`.

### Step 8 — Wire dashboards
No code changes needed if dashboards already read `spa_revenue_daily`. Just verify the date-range pickers in `/spa/revenue` page reach back to 2015 instead of capping at 2024.

### Step 9 — Document and lock
- Add the data-source rule to `10-Tech/CEO-Cockpit/AGENTS.md` (live ETL still ONLY pulls Cockpit Datasheet; historic table is a one-off backfill, not re-run nightly).
- Update `10-Tech/CEO-Cockpit/CLAUDE.md` memory note (`project_cockpit_etl.md`) to mention `spa_transactions_raw` exists.

---

## 6. Risks and open questions

| # | Item | Default decision | Needs Mert to confirm? |
|---|---|---|---|
| R1 | `QAWRA` — was it a real branch or a duplicate of RAMLA? | New `qawra` location, `is_active=false`. | YES — affects 2015-2019 location attribution. |
| R2 | Should `Cost Amount` and `Profit` be trusted to compute historical margins? | Land them as-is; don't surface in any KPI yet. | YES — they're sparse pre-2022. |
| R3 | Package double-counting: when a customer buys "SPA DELUXE PACKAGE", do component service rows ALSO appear in the sheet at the same time? | Assume no — sheet appears to be revenue-recognised once, at sale. | YES — sample 20 package transactions to verify. |
| R4 | PII (email, name, surname) — keep, hash, or drop? | Keep as-is for now (sheet is already internal). | YES — GDPR call. |
| R5 | `Spa Club` Service Type — membership upfront vs redemption — both go into `services`? | Yes, roll all `Spa Club` into `services` bucket. | YES — affects services revenue trend line. |
| R6 | Non-EUR rows | None observed in samples; if any exist, default to treating amount as EUR. | Run `SELECT … WHERE list_price_gross > 5000` to flag potential currency anomalies after ingest. |
| R7 | 2023 data — gap between historic (ends 2022-12-31 in row 2 sample) and live (starts 2024-01-01). | Run year-coverage query after Step 5; if 2023 is missing, escalate to Mert before claiming "done". | YES — could be the biggest finding. |
| R8 | Phytomer SKU regex `^P[A-Z]{4}\d` is a heuristic. | Surface every "unknown brand" Retail SKU in QC step 6 report; iterate with Mert. | YES, low-pri — only affects how products split, not total revenue. |
| R9 | The sheet is editable — backfill is one-off, but if the sheet changes later, the cockpit goes stale. | Document "historic data is frozen as of YYYY-MM-DD". If sheet changes meaningfully, re-run the backfill (idempotent on `sheet_row_id`). | NO — convention only. |
| R10 | `spa_revenue_monthly` rollup pre-2024 has no Zoho data (wholesale, sales_discount, sales_refund). | Insert with those three columns = 0, `zoho_synced_at = NULL`. Dashboards already render NULL/0 cleanly. | NO. |

---

## Appendix A — File paths produced by this plan

- DDL: `10-Tech/CEO-Cockpit/supabase/migrations/070_create_spa_transactions_raw.sql`
- Backfill script: `10-Tech/CEO-Cockpit/scripts/spa-historical-backfill.ts`
- QC script: `10-Tech/CEO-Cockpit/scripts/qc-spa-historical.ts`
- Optional ETL API: `10-Tech/CEO-Cockpit/app/api/etl/spa-historical/route.ts`
- Learnings log entry to be added: `09-Miscellaneous/learnings/LEARNINGS.md` (after Step 7 reconciliation)

## Appendix B — Reusable code already in repo

- `parseCockpitDate` — `lib/etl/spa-revenue.ts` lines 77-96. Export from file, import in backfill script.
- `safeFloat` — `lib/etl/spa-services-by-employee.ts` line 85. Same pattern.
- `parseCSVRow` — not needed if we use the Sheets v4 API (returns parsed arrays).
- `upsert`, `deleteWhere`, `insertRows`, `select` — `lib/etl/supabase-etl.ts`.
- `practitioner_name_aliases` lookup — `065_create_practitioner_name_aliases.sql` table, query with `venue='spa'`.
