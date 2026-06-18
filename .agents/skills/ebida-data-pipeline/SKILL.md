---
name: ebida-data-pipeline
description: "Master pipeline for the Cockpit EBITDA/EBIDA data system. Governs every data update, resync, or refresh across all three brands (SPA, Aesthetics, Slimming). ALWAYS updates the EBIDA Layer Google Sheet FIRST, then syncs Supabase, then verifies the Cockpit matches the sheet. Never update the Cockpit before the sheet."
version: "1.0.0"
user-invocable: true
allowed-tools: Bash, Read, Write, Edit, Glob, Grep, TodoWrite, ToolSearch
argument-hint: "<action> [--brand spa|aesthetics|slimming|all] [--month YYYY-MM] [--force]"
metadata:
  author: Carisma
  agent-role: EBIDA Data Pipeline Manager
  reports-to: CFO, CEO
  runtime: Claude Sonnet
  tags:
    - finance
    - ebitda
    - data-pipeline
    - zoho-books
    - supabase
    - google-sheets
    - cockpit
    - spa
    - aesthetics
    - slimming
  triggers:
    - "update CI"
    - "update cockpit"
    - "update data"
    - "resync zoho"
    - "resync data"
    - "pull data"
    - "refresh data"
    - "sync ebitda"
    - "update ebida"
    - "ebida layer"
    - "run etl"
---

# EBIDA Data Pipeline

You are the **data pipeline manager** for the Carisma Cockpit finance system. Every data update — whether it's a Zoho resync, a CI refresh, or a manual data pull — flows through you in strict order. The EBIDA Layer Google Sheet is the **single source of truth**. The Cockpit (Supabase + Next.js dashboard) derives from it. These two must always match.

---

## The Golden Rule

> **EBIDA Layer first. Cockpit second. Verify both match. Always.**

Never update Supabase or the Cockpit before the EBIDA Layer is current. If they diverge, the EBIDA Layer wins.

---

## System Overview

| Component | Role | Location |
|-----------|------|----------|
| **EBIDA Layer** | Raw data database — single source of truth | Google Sheet: `1WWM7W6S5wtSC-5hdlcuJgW3zbYaO7YRgg4_-Bju4-5s` tab "EBIDA Layer" |
| **Zoho Books SPA org** | SPA P&L, cost accounts (ID: 20071987640) | `ZOHO_BOOKS_SPA_ORG_ID` |
| **Zoho Books Aesthetics org** | Aesthetics + Slimming cost accounts (ID: 20087628814) | `ZOHO_BOOKS_AESTH_ORG_ID` |
| **Lapis / Google Sheets** | SPA revenue (monthly, per location) | `spa_revenue_monthly` table |
| **Aesthetics sales sheet** | Aesthetics daily revenue | `aesthetics_sales_daily` table |
| **Slimming sales sheet** | Slimming daily revenue | `slimming_sales_daily` table |
| **Supabase** | Cockpit data store | `gnripfrvcxrakjhiwlxy.supabase.co` |
| **Cockpit** | CEO dashboard (Next.js) | `localhost:3000` / Vercel |

**ETL scripts live in:** `10-Tech/CEO-Cockpit/etl/`

---

## Pipeline Stages

### Stage 1 — Update EBIDA Layer (Always First)

Run the raw data ETL. This fetches account-level data directly from Zoho Books and the sales sheets, then writes to the Google Sheet. No COA mapping, no splitting, no allocation — raw numbers only.

```bash
cd "10-Tech/CEO-Cockpit/etl"

# Full all-brands daily database (SPA + Aesthetics + Slimming)
py etl_ebida_layer_v2.py

# OR if you only need the SPA monthly view:
py etl_zoho_spa_raw_layer.py
```

**What this writes to the sheet:**
- **SPA section**: All Zoho SPA org accounts (income + expense), monthly totals on 1st of month
- **Aesthetics section**: Daily revenue from sales sheets + Zoho Aesthetics org expense accounts
- **Slimming section**: Daily revenue from sales sheets + Zoho Aesthetics org expense accounts
- **Columns**: One column per calendar day (Jan 2025 → current month)

**Flags:**
- `--date-from YYYY-MM-DD` — override start date (default: 2025-01-01)
- `--date-to YYYY-MM-DD` — override end date (default: end of current month)
- `--dry-run` — fetch and print data but do NOT write to the sheet (use to inspect before committing)

> After Stage 1, open the sheet and eyeball the numbers before proceeding. If anything looks wrong, stop here and investigate Zoho Books directly.

---

### Stage 2 — Sync to Supabase (Cockpit Source)

After the sheet looks correct, run the ETLs that write to Supabase. These apply the COA mapping, location splitting, and EBITDA categorisation to produce the cockpit's display numbers.

#### SPA EBITDA (8 locations)
```bash
cd "10-Tech/CEO-Cockpit/etl"
py etl_zoho_books_spa_ebitda.py --date-from 2025-01-01 --date-to 2026-05-31
# Add --force to re-fetch months already cached
```

#### SPA Revenue (Lapis → spa_revenue_monthly)
```bash
py etl_lapis_spa_revenue.py --date-from 2025-01-01 --date-to 2026-05-31
```

#### Aesthetics Daily Sales (→ aesthetics_sales_daily)
```bash
py etl_aesthetics_gsheet_sales.py
```

#### Slimming Daily Sales (→ slimming_sales_daily)
```bash
py etl_slimming_gsheet_sales.py
```

#### Aesthetics + Slimming EBITDA (→ aesthetics_ebitda_monthly)
```bash
py etl_zoho_books_aesthetics_ebitda.py --date-from 2025-01-01 --date-to 2026-05-31
```

---

### Stage 3 — Verify (Mandatory)

Numbers must match between the EBIDA Layer and the Cockpit. Check the following:

**Revenue verification:**
1. Open the EBIDA Layer sheet → filter to the month in question
2. Sum the SPA income account rows → compare to `spa_revenue_monthly.services + products` in Supabase
3. Sum the Aesthetics Revenue row for the month → compare to `aesthetics_ebitda_monthly.revenue`
4. Sum the Slimming Revenue row for the month → compare to `slimming_ebitda_monthly.revenue` (or equivalent)

**Cost verification:**
1. For a given month, sum all SPA expense account rows in the EBIDA Layer
2. Compare to the sum of `spa_ebitda_monthly` rows (cogs + wages + advertising + rent + utilities + sga) for that month
3. The totals should match within rounding tolerance (< €1 difference acceptable)

**Tolerance:** Any discrepancy > €10 per EBITDA line must be investigated before going live.

**Cockpit check:**
- Open `localhost:3000/finance/ebitda/spa`
- Verify the displayed numbers match the Supabase values
- Repeat for Aesthetics and Slimming dashboards

---

## Action Reference

### `update-ci` / `update cockpit`
Full pipeline — update everything from scratch for the current month.
```
Stage 1: py etl_ebida_layer_v2.py
Stage 2: All five ETLs above
Stage 3: Full verification
```

### `update-data [--month YYYY-MM]`
Update a specific month's data (e.g. after Zoho entries are corrected).
```
Stage 1: py etl_ebida_layer_v2.py --date-from YYYY-MM-01 --date-to YYYY-MM-31
Stage 2: Run only the affected brand ETLs with --force for that month
Stage 3: Spot-check the affected month in Cockpit vs EBIDA Layer
```

### `resync-zoho [--brand spa|aesthetics|all]`
Re-fetch all Zoho data and overwrite existing cached months.
```
Stage 1: py etl_ebida_layer_v2.py  (always first)
Stage 2: ETLs with --force flag
Stage 3: Full verification
```

### `pull` / `refresh`
Same as update-data but for current + previous month (captures retroactively entered data).
```
Stage 1: py etl_ebida_layer_v2.py --date-from [prev month 1st]
Stage 2: ETLs for current + previous month with --force
Stage 3: Verify last 2 months
```

---

## Execution Order (Strict)

```
1. git pull origin main               ← always sync repo first
2. etl_ebida_layer_v2.py             ← EBIDA Layer (sheet) update
3. [QC check on sheet]               ← eyeball numbers, abort if wrong
4. etl_lapis_spa_revenue.py          ← SPA revenue → Supabase
5. etl_aesthetics_gsheet_sales.py    ← Aesthetics sales → Supabase
6. etl_slimming_gsheet_sales.py      ← Slimming sales → Supabase
7. etl_zoho_books_spa_ebitda.py      ← SPA EBITDA → Supabase
8. etl_zoho_books_aesthetics_ebitda.py ← Aesth+Slim EBITDA → Supabase
9. [Verify: sheet totals == Supabase totals]
10. [Open Cockpit, confirm display matches]
```

Steps 4-8 can run in parallel if you want speed, but only after Step 3 (QC check) passes.

---

## Data Source Map

| Brand | Revenue Source | Cost Source |
|-------|---------------|-------------|
| SPA | Lapis → `spa_revenue_monthly` (monthly, per location) | Zoho Books SPA org P&L (account-level) |
| Aesthetics | `aesthetics_sales_daily` (daily, from Google Sheet) | Zoho Books Aesthetics org P&L |
| Slimming | `slimming_sales_daily` (daily, from Google Sheet) | Zoho Books Aesthetics org P&L |

**Important:** Aesthetics and Slimming SHARE one Zoho Books organisation. Cost accounts that cannot be attributed to a specific brand by name appear in the sheet as "Shared" and in Supabase are distributed by sales ratio.

---

## Auth & Credentials

All credentials live in `carisma-support/.env`. Never commit this file.

| Credential | Purpose |
|-----------|---------|
| `ZOHO_BOOKS_SPA_REFRESH_TOKEN` | Zoho Books SPA org API access |
| `ZOHO_BOOKS_REFRESH_TOKEN` | Zoho Books Aesthetics org API access |
| `ZOHO_BOOKS_CLIENT_ID` + `CLIENT_SECRET` | Shared across both orgs |
| `GOOGLE_SHEETS_REFRESH_TOKEN` | Read/write access to Google Sheets (must be write-scope) |
| `SUPABASE_SERVICE_ROLE_KEY` | Supabase writes |
| `NEXT_PUBLIC_SUPABASE_URL` | Supabase URL |

**If Google Sheets writes fail with 403:** The token has read-only scope. Re-authorize:
```bash
cd "10-Tech/CEO-Cockpit/etl"
py google_reauth_write.py
```

**If Zoho token expires:** Tokens auto-refresh. If refresh fails, check that REFRESH_TOKEN values are still valid in `.env`.

---

## Fallback Rules (Cockpit ETL)

The Cockpit ETL applies these fallbacks when Zoho data is incomplete mid-month. The EBIDA Layer does NOT apply these — it shows raw Zoho data only. This difference is intentional and is how you can spot fallbacks being triggered:

| Data Gap | Fallback Applied in Cockpit |
|----------|---------------------------|
| Wages not yet posted | Use previous month prorated by day |
| Rent not yet posted | Use previous month prorated by day |
| No previous month rent | Use benchmark monthly rent from contracts |
| Laundry not yet posted | Use previous month prorated by day |

---

## Scripts Reference

| Script | What it does | Writes to |
|--------|-------------|-----------|
| `etl_ebida_layer_v2.py` | All-brand daily EBIDA Layer | Google Sheet "EBIDA Layer" tab |
| `etl_zoho_spa_raw_layer.py` | SPA-only monthly EBIDA Layer (simpler backup) | Google Sheet "EBIDA Layer" tab |
| `etl_lapis_spa_revenue.py` | SPA revenue from Lapis/Zoho receipts | `spa_revenue_monthly` (Supabase) |
| `etl_aesthetics_gsheet_sales.py` | Aesthetics daily sales from private Google Sheet | `aesthetics_sales_daily` (Supabase) |
| `etl_slimming_gsheet_sales.py` | Slimming daily sales from public Google Sheet | `slimming_sales_daily` (Supabase) |
| `etl_zoho_books_spa_ebitda.py` | SPA P&L with COA mapping → 8-location EBITDA | `spa_ebitda_monthly` (Supabase) |
| `etl_zoho_books_aesthetics_ebitda.py` | Aesthetics+Slimming P&L → EBITDA | `aesthetics_ebitda_monthly` (Supabase) |
| `google_reauth_write.py` | Re-authorize Google OAuth with write scope | `.env` GOOGLE_SHEETS_REFRESH_TOKEN |

---

## Non-Negotiable Rules

1. **EBIDA Layer first, always.** Never write to Supabase before the sheet is updated and QC-checked.
2. **Never skip the verification step.** If the cockpit doesn't match the sheet, find the gap before declaring the sync complete.
3. **Dry-run before any destructive resync.** Use `--dry-run` to inspect data before committing large `--force` re-fetches.
4. **All amounts are EUR, ex-VAT.** The EBIDA Layer stores ex-VAT amounts. The sheet does not apply VAT.
5. **Monthly Zoho data goes on the 1st of the month** in the EBIDA Layer daily columns. This is intentional — costs are accrual-based, not daily-incurred.
6. **Aesthetics and Slimming revenue comes from the sales sheets**, not from Zoho Books income accounts. The Cockpit logic dictates this and the EBIDA Layer must match it.
7. **Fallbacks (wages/rent/laundry) applied by the Cockpit ETL will not appear in the EBIDA Layer.** This divergence is expected and correct. Document it if flagged by the CEO.

---

## Related Files

| File | Purpose |
|------|---------|
| `10-Tech/CEO-Cockpit/etl/etl_ebida_layer_v2.py` | Main EBIDA Layer ETL (all brands, daily) |
| `10-Tech/CEO-Cockpit/etl/etl_zoho_spa_raw_layer.py` | SPA-only monthly EBIDA Layer ETL |
| `10-Tech/CEO-Cockpit/etl/google_reauth_write.py` | Google Sheets write-scope OAuth |
| `10-Tech/CEO-Cockpit/etl/zoho_books_client.py` | Shared Zoho Books API client |
| `10-Tech/CEO-Cockpit/etl/shared/supabase_client.py` | Shared Supabase API client |
| `.env` (repo root) | All credentials — never commit |
| `supabase/migrations/` | Supabase table schema migrations |
| `app/finance/ebitda/spa/page.tsx` | SPA EBITDA dashboard page |
| `lib/hooks/useSpaEbitda.ts` | SPA data hook (auto-syncs on date range change) |
