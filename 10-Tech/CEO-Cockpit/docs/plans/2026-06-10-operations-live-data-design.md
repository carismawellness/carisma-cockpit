# Operations Dashboard — Live Data Design

**Date:** 2026-06-10
**Goal:** Replace all mocked data on `/operations` with real, regularly-refreshed data in Supabase, shipped live to Vercel.

The user approved this scope directly ("pull the actual real-life data… build this into our Supabase database platform structure with ETL… done on a regular basis") and requested autonomous execution with sub-agents + QC. Decisions below were made in place of live clarifying questions; assumptions are flagged.

## Current state (verified)

- `app/operations/page.tsx` (646 lines) renders 4 sections from hardcoded constants: `REVIEW_LOCATIONS`, `DILIGENCE_DATA`, `FACILITY_STANDARDS`, `MYSTERY_GUEST`.
- Supabase: `locations` (12 rows) + `brands` dims exist. `brand_standards` table exists (empty). `google_reviews` / `diligence_audit` migration files (021/022) exist but were **never applied**.
- Accounting Master sheet `1WWM7W6S5wtSC-5hdlcuJgW3zbYaO7YRgg4_-Bju4-5s` is **link-readable** → zero-auth CSV export works (same pattern as all existing ETL routes). Verified live.
  - `Diligence audit` (gid 912652373): months Jan-2024 → May-2026 in column blocks (6 → 7 → 8 locations wide over time). Rows: Total sales inc VAT, Total deleted & cancelled (combined), Total complimentary, Total cash sales, Total discounted cash, Total unattended. Values are EUR amounts except unattended (count).
  - `Facility standards 26` (gid 1523717837), `Facility standards 25` (48304779), `Facility standards` (2099637249), `Mystery guest standards 25 from AUGUST to 2026` (263663566), `Mystery guest standards` (1422994359), `Front desk standards 26/25/(base)` (1897103524 / 1673151431 / 386903760): row 1 = month labels (merged), row 2 = location names per block, row 3 = overall %, rows 4+ = checklist items grouped under section headers, values TRUE/FALSE.
- `GOOGLE_SHEETS_REFRESH_TOKEN` OAuth client is **dead** (`invalid_client`) — irrelevant here because CSV export needs no auth.
- No Google Places API key exists anywhere in env.
- Migrations are applied via the Supabase dashboard SQL editor (Playwright browser session is logged in).
- RLS pattern: `authenticated` SELECT + service_role writes (062).

## Architecture

Three new ETL routes following the existing `lib/etl/*.ts` + `app/api/etl/<name>/route.ts` + `ETLLogger` + nightly-cron pattern:

### 1. Google Reviews → `google_reviews`
- Table per migration 021 (date, location_id, brand_id, total_reviews, avg_rating, star buckets).
- Mapping `lib/constants/google-places.ts`: location slug → Google `place_id`.
- ETL route `api/etl/google-reviews`: Places API (New) `GET places/{place_id}?fields=rating,userRatingCount` with `GOOGLE_PLACES_API_KEY`; upserts one snapshot row per location per day. Registered in nightly cron.
- **Seed + place-id discovery (one-time, today):** local Playwright session finds each location's Google Maps listing, captures place_id + current rating/review count, seeds today's snapshot so the dashboard is live immediately.
- **Assumption / manual step:** `GOOGLE_PLACES_API_KEY` must be created by Mert (Google Cloud → enable Places API (New) → API key) and added to Vercel env + `.env.local`. Until then the nightly job logs a clear skip message and the seeded snapshot serves the dashboard. Place Details Essentials free tier (10k/mo) covers 10 locations × 30 days with huge margin.
- Frontend: latest snapshot per location; previous-month snapshot (nearest ≤ 28-35 days back) drives the trend arrow.

### 2. Diligence audit → `diligence_audit` (redesigned, migration 072)
- The sheet combines deleted+cancelled; values are EUR. Schema: `month DATE, location_id, brand_id, total_sales, deleted_cancelled, complimentary, cash_sales, discounted_cash, unattended_count, UNIQUE(month, location_id)`. Percentages computed in the UI (as the sheet does).
- ETL route `api/etl/diligence-audit`: parses month blocks dynamically from rows 1-2 (no fixed column indexes — block widths change over time), full-history upsert each run.
- Location label → slug aliases: Inter→inter, Hugos→hugos, Hyatt→hyatt, Ramla→ramla, Labranda→labranda, **Riviera→labranda** (Labranda Riviera is the same venue, renamed in 2026 tabs), Sunny→odycy, Excelsior→excelsior, Novotel→novotel.
- **Accounting team spec (deliverable):** keep appending month blocks to the existing `Diligence audit` tab — exactly the current format (per location per month: total sales inc VAT, total deleted & cancelled, total complimentary, total cash sales, total discounted cash sales, total unattended count). ETL picks up new months automatically each night.

### 3. Facility / Mystery Guest / Front Desk → `brand_standards` (table exists)
- Port the parsing logic from `etl/etl_brand_standards.py` to `lib/etl/brand-standards.ts`; read all 8 tabs via CSV export; normalize to one row per (month, standard_type, category, item, location, result).
- Month labels need normalization ("Mart 2025" → March 2025, "January and February " → ambiguous block: assign to February of that year, "May " → May of the tab's year, blank header → skip block).
- Frontend: score % per location for the latest month in range = TRUE / (TRUE+FALSE); issues list = FALSE items. Page shows facility + mystery guest (front desk data is loaded for future use).

### Shared integration (single agent, after A/B/C finish — avoids file conflicts)
- `app/operations/page.tssx` → replace 4 mock constants with React-Query hooks (`useKPIData` pattern; month-grain tables use range-intersection filtering).
- Register all 3 ETLs in `app/api/cron/nightly-refresh/route.ts` Phase 1 + `api/etl/status` + settings/data-sources if applicable.
- RLS: new tables get `authenticated` SELECT policy (matching 062) — applied in migration 072.

## QC gate (final agent)
1. Diligence: spot-check ≥5 (month, location) cells of `diligence_audit` against the sheet CSV, including a 6-wide 2024 block, a 7-wide mid-2025 block, and an 8-wide 2026 block.
2. Standards: recompute 3 location-month scores from the sheet and compare with dashboard query; verify counts of distinct items per tab.
3. Reviews: verify each seeded row's place matches the right venue (name in listing) and totals are plausible vs the mock (~715 total).
4. RLS: confirm `authenticated` can read all 3 tables and `anon` cannot write.
5. `npm run build` passes; ETL routes return 200 with rows_upserted > 0; etl_sync_log entries exist.
6. Verify Vercel deploy succeeded via `gh api` (carisma-support-u2vb env).

## Out of scope
- Splitting deleted vs cancelled (source report combines them; revisit if accounting separates).
- Front-desk standards UI section (data lands in `brand_standards`, page section can be added later).
- Fixing the dead `GOOGLE_SHEETS_REFRESH_TOKEN` OAuth client (not needed for these ETLs; flagged separately).
