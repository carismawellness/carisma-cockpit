---
name: diligence-audit-metrics
description: How the three auto-computed diligence audit metrics (cash sales, discounted cash, complimentary) are defined, where they come from, and how they are computed.
metadata:
  type: reference
---

# Diligence Audit — Auto-Computed Metrics

## Overview

Three of the six diligence audit metrics are now auto-computed from the
**Cockpit datasheet "Service - Spa" tab** (GID `1281126329`) rather than
relying on manual entry in the Accounting Master.

The other three (Total Sales, Deleted & Cancelled, Unattended) still come
from the Accounting Master and are manually entered by hotel managers.

---

## Metric Definitions

### 1. Cash Sales

**What it measures:** Total revenue collected in cash for the period.

**Filter:**
- `Sales Status` = "Sold"
- `Payment Type` = "Cash"

**Aggregation:** `SUM(Unit Price)` per month + location

**Threshold:** < 12% of Total Sales (above this = governance concern)

---

### 2. Discounted Cash

**What it measures:** Total revenue from cash transactions where a discount was applied.
This is a fraud/governance metric — cash + discount = highest risk for unauthorised write-downs.

**Filter:**
- `Sales Status` = "Sold"
- `Payment Type` = "Cash"
- `Discount (%)` > 0

**Aggregation:** `SUM(Unit Price)` per month + location
(Unit Price = the discounted amount the customer paid, not the discount itself)

**Threshold:** < 5% of Total Sales

**Note:** The user describes this as "discounted cash amounts" — the CSV has
`List Price`, `Discount (%)`, and `Unit Price` (after discount). The metric
tracks the total revenue from these discounted cash transactions, not the
discount amount itself.

---

### 3. Complimentary

**What it measures:** Total value of complimentary treatments given (zero- or
reduced-cost services where the hotel/property absorbs the cost).

**Filter:**
- `Sales Status` = "Sold"
- `Payment Type` = "Payment Center" OR "Open Account"

**Why "Payment Center"?**
The Lapis POS UI shows this button as "Open Account", but the CSV export
writes the value as "Payment Center". Both are captured in the filter.
QC confirmed `Payment Center` matches the Accounting Master figures exactly
(May 2026 QC: all 8 locations within 1pp). `Open Account` rows in
`spa_transactions_raw` all have null service_date (ETL gap) so Supabase
cannot be used for this metric — the cockpit CSV is the only reliable source.

**Aggregation:** `SUM(Unit Price)` per month + location

**Threshold:** ~2% of Total Sales

---

## Data Source

**Primary:** Cockpit datasheet (Excel file), "Service - Spa" tab
- URL: `https://docs.google.com/spreadsheets/d/195RvbNuZd-oNL-rziKC3Wz6ndy0cDA_a/export?format=csv&gid=1281126329`
- Zero-auth CSV export — no OAuth needed
- Date format in CSV: `D/M/YYYY`

**Why NOT `spa_transactions_raw`?**
- `Open Account` / `Payment Center` rows have `null` service_date in the DB
  (the ETL filters them out or fails to parse the date for these rows)
- Using the CSV directly avoids this ETL gap

---

## ETL Pipeline

**Files:**
- `lib/etl/diligence-metrics.ts` — CSV parser + aggregation logic
- `app/api/etl/diligence-metrics/route.ts` — POST endpoint
- `app/api/cron/nightly-refresh/route.ts` — called in Phase 2 (after `diligence-audit`)

**Cron ordering (critical):**
1. Phase 1: `diligence-audit` runs → upserts full rows from Accounting Master
   (sets total_sales, deleted_cancelled, unattended_count AND the three computed fields
   using manual accounting figures)
2. Phase 2: `diligence-metrics` runs → upserts ONLY the three computed fields,
   overwriting the manual accounting values with auto-computed cockpit values

**Target table:** `diligence_audit` (existing table, shared with Accounting Master ETL)
- Upsert on conflict `(month, location_id)` — only updates `cash_sales`,
  `discounted_cash`, `complimentary`
- Does NOT touch `total_sales`, `deleted_cancelled`, `unattended_count`

---

## Column Mapping (cockpit CSV → computed metric)

| CSV Column    | Used For                        |
|---------------|---------------------------------|
| Sales Status  | Filter: must be "Sold"          |
| Service Date  | Group by month (D/M/YYYY)       |
| Sales Point   | Group by location (→ location_id) |
| Payment Type  | Identify Cash / Payment Center  |
| Unit Price    | Value to SUM                    |
| Discount (%)  | Identify discounted rows        |

---

## Sales Point → location_id Mapping

| Sales Point (CSV, uppercased)    | location_id |
|----------------------------------|-------------|
| INTER                            | 1           |
| HUGOS                            | 2           |
| HYATT                            | 3           |
| RAMLA                            | 4           |
| LABRANDA GENERAL SALES POINT     | 5           |
| SUNNY COAST                      | 6           |
| SALES POINT OF EXCELSIOR         | 7           |
| SALES POINT OF NOV               | 8           |

Unmapped Sales Points (e.g. CENTER, QAWRA, AESTHETICS) are skipped with a warning
logged in the ETL response.

---

## Known Issues / QC Findings (May 2026)

- **Excelsior discounted cash discrepancy:** DB (Accounting Master) shows €886,
  cockpit CSV shows €10. The gap is in the hotel manager's manual entry, not the
  ETL. Root cause unknown — investigate with Excelsior manager.
- **Complimentary source verified:** Payment Center in CSV ↔ `diligence_audit.complimentary`
  from Accounting Master match within 1pp for all locations. Minor EUR gaps
  (Hyatt -€15, Ramla +€59) are ETL timing lag.

---

## How to Trigger Manually

```bash
curl -X POST https://carisma-support-u2vb.vercel.app/api/etl/diligence-metrics \
  -H "x-cron-secret: $CRON_SECRET"
```
