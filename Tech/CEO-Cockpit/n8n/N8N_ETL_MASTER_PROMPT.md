# N8N ETL Pipeline — Master Build Prompt

## Context

You are building the complete ETL data pipeline for the **Carisma Wellness Group CEO Cockpit** — a Next.js dashboard that displays KPIs across Sales, CRM, Marketing, Finance, HR, and Operations for three brands (Spa, Aesthetics, Slimming) across 10 locations in Malta.

The Cockpit's central data warehouse is **Supabase (PostgreSQL)**. Currently, almost every dashboard is running on hardcoded mock data. Your job is to build N8N workflows that pull real data from external sources and write it into the correct Supabase tables on a schedule, so the dashboards light up with live data.

There are **16 ETL pipelines** to build, plus **3 missing data sources** that need new tables and pipelines. Python ETL scripts already exist in the codebase (at `Tech/CEO-Cockpit/etl/`) — you can reference their logic for column mappings and transformations, but the goal is to rebuild these as N8N workflows where practical. For complex Google Sheets parsing with specific row/column logic, consider using N8N's Execute Command node to call the existing Python scripts instead of recreating that logic in N8N Code nodes.

---

## Architecture

```
External Sources → N8N Workflows (scheduled) → Supabase Tables → Next.js Dashboard
```

**Supabase Connection (used by ALL workflows):**
- URL: stored in env var `NEXT_PUBLIC_SUPABASE_URL`
- Key: stored in env var `SUPABASE_SERVICE_ROLE_KEY` (service role — bypasses RLS)
- All writes use **upsert** with conflict columns to avoid duplicates
- After every successful ETL run, log to the `etl_sync_log` table

**ETL Logging — every workflow must do this:**
1. On start: INSERT into `etl_sync_log` with `source_name`, `started_at`, `status='running'`
2. On success: UPDATE with `status='success'`, `rows_upserted`, `completed_at`, `duration_sec`
3. On failure: UPDATE with `status='failed'`, `error_message`, `completed_at`, `duration_sec`

---

## Brand & Location Reference Data

These are pre-seeded in Supabase. Use these IDs in all ETL writes:

### Brands
| brand_id | slug | name |
|----------|------|------|
| 1 | spa | Carisma Spa & Wellness |
| 2 | aesthetics | Carisma Aesthetics |
| 3 | slimming | Carisma Slimming |

### Locations
| location_id | slug | name | brand_id |
|-------------|------|------|----------|
| 1 | inter | InterContinental | 1 (spa) |
| 2 | hugos | Hugos | 1 (spa) |
| 3 | hyatt | Hyatt | 1 (spa) |
| 4 | ramla | Ramla Bay | 1 (spa) |
| 5 | labranda | Labranda | 1 (spa) |
| 6 | odycy | Odycy | 1 (spa) |
| 7 | excelsior | Excelsior | 1 (spa) |
| 8 | novotel | Novotel | 1 (spa) |
| 9 | aesthetics-clinic | Aesthetics Clinic | 2 (aesthetics) |
| 10 | slimming-clinic | Slimming Clinic | 3 (slimming) |

---

## PIPELINE 1: Weekly KPIs (Google Sheets → Supabase)

**Schedule:** Every Monday at 09:00
**Source:** Google Sheet `1JGlBdii7Zu25yha0zrmi72PPH1BFZRdVeGvcig3r6GE`
**Complexity:** HIGH — specific row numbers, trailing spaces in tab names

### Sales Tab → `sales_weekly`
- **Tab name:** `Sales`
- **Week date headers:** Row 2, starting from column D (0-indexed col 3)
- **Spa location revenue rows (1-indexed):** Inter=46, Hugos=47, Hyatt=48, Ramla=49, Labranda=50, Odycy=51, Novotel=52, Excelsior=53
- **Upsert conflict:** `(week_start, location_id)`
- **Columns to write:** `week_start` (DATE), `location_id` (INT), `brand_id` (INT, always 1 for spa), `revenue_ex_vat` (NUMERIC — strip EUR/€/comma symbols before parsing)

### HR Tab → `hr_weekly`
- **Tab name:** `HR ` (NOTE: trailing space!)
- **Week date headers:** Row 2, starting from column D
- **Location names:** Scan column A for location name matches
- **Upsert conflict:** `(week_start, location_id)`
- **Columns to write:** `week_start`, `location_id`, `brand_id`, `hc_pct` (NUMERIC)

### Operations Tab → `operations_weekly`
- **Tab name:** `Operations`
- **Week date headers:** Row 2, starting from column D
- **Location names:** Scan column A for location name matches
- **Upsert conflict:** `(week_start, location_id)`
- **Columns to write:** `week_start`, `location_id`, `brand_id`, `google_reviews_avg` (NUMERIC)

**RECOMMENDATION:** This is the most complex Sheets parsing. Consider using N8N's Execute Command node to run `python etl/etl_weekly_kpis.py` instead of recreating the row-scanning logic in JavaScript Code nodes.

---

## PIPELINE 2: CRM Master (Google Sheets → Supabase)

**Schedule:** Daily at 09:00
**Source:** Google Sheet `1bHF_7bXic08pcyXQhq310zG6McqXD50oT0EuVkjzDdI`

### KPI Tabs → `crm_daily`
- **Tab names:** ` Spa`, ` Aes`, ` Slm` (NOTE: leading space on all three!)
- **Brand mapping:** ` Spa` → brand_id=1, ` Aes` → brand_id=2, ` Slm` → brand_id=3
- **Header row:** Row 0
- **Column mapping (header names → DB columns):**
  - `Date` → `date` (DATE)
  - `Total Leads` → `total_leads` (INT)
  - `Meta Leads` → `leads_meta` (INT)
  - `CRM Leads` → `leads_crm` (INT)
  - `In Hours` → `leads_in_hours` (INT)
  - `Out Hours` → `leads_out_hours` (INT)
  - `Speed to Lead (Median)` → `speed_to_lead_median_min` (NUMERIC)
  - `Speed to Lead (Mean)` → `speed_to_lead_mean_min` (NUMERIC)
  - `Conversion %` → `conversion_rate_pct` (NUMERIC)
  - `Total Calls` → `total_calls` (INT)
  - `Outbound Calls` → `outbound_calls` (INT)
  - `Appointments Booked` → `appointments_booked` (INT)
- **Upsert conflict:** `(date, brand_id)`

### Dials Tabs → `crm_by_rep`
- **Tab names:** `Spa`, `Aes`, `Slm` (NO leading space — different from KPI tabs!)
- **Header row:** Row 0
- **Column mapping:**
  - `Date` → `date` (DATE)
  - `Rep` or `Staff` or `Name` → look up `staff_id` from `staff` table
  - `Leads Assigned` → `leads_assigned` (INT)
  - `Calls Made` or `Dials` → `calls_made` (INT)
  - `Appointments Booked` or `Appts` → `appointments_booked` (INT)
  - `Conversions` → `conversions` (INT)
  - `Conversion %` → `conversion_rate_pct` (NUMERIC)
  - `STL Avg` → `speed_to_lead_avg_min` (NUMERIC)
- **Upsert conflict:** `(date, staff_id)`

---

## PIPELINE 3: EBITDA (Google Sheets → Supabase)

**Schedule:** 5th of every month at 10:00
**Source:** Google Sheet `1WWM7W6S5wtSC-5hdlcuJgW3zbYaO7YRgg4_-Bju4-5s`
**Tab:** `EBITDA Summary`

- **Layout:** Month headers in row 0 starting from column B. Brand section rows contain labeled metrics.
- **For each brand section, read these metric rows:**
  - `Revenue` → `revenue` (NUMERIC)
  - `COGS` → `cogs` (NUMERIC)
  - `Gross Profit` → `gross_profit` (NUMERIC)
  - `Opex` → `opex` (NUMERIC)
  - `EBITDA` → `ebitda` (NUMERIC)
  - `EBITDA Margin %` → `ebitda_margin_pct` (NUMERIC)
- **Target table:** `ebitda_monthly`
- **Upsert conflict:** `(month, brand_id)`
- **Columns:** `month` (DATE — first of month), `brand_id`, `revenue`, `cogs`, `gross_profit`, `opex`, `ebitda`, `ebitda_margin_pct`

---

## PIPELINE 4: Aesthetics Sales (Google Sheets → Supabase)

**Schedule:** Daily at 20:00
**Source:** Google Sheet `1Mr_aRRbRf3ex--WmUJIqXwko7okCyD82KxBOXWYnW24`

- **Tabs:** All tabs whose name starts with `Sale` (e.g., "Sales January 2026")
- **Skip header row 0**
- **Column mapping (0-indexed):**
  - Col D (3) = `date_of_service` → `date` (DATE)
  - Col E (4) = `price` → `revenue` (NUMERIC)
  - Col G (6) = `sales_staff` → look up `staff_id` from `staff` table
- **Target table:** `sales_by_rep`
- **Hard-code:** `brand_id = 2` (aesthetics)
- **Upsert conflict:** `(date, staff_id)`
- **Aggregate:** Sum revenue per staff per day before upserting

---

## PIPELINE 5: Slimming Sales (Google Sheets → Supabase)

**Schedule:** Daily at 20:00
**Source:** Google Sheet `1j6tz8k8TRSulB35Sg4X1xSlcV_JLf-8QKx-32UUkoBc`

- **Tabs:** All tabs whose name starts with `Sales` (e.g., "Sales January")
- **Skip header row 0**
- **Column mapping (0-indexed):**
  - Col A (0) = `date` → `date` (DATE)
  - Col H (7) = `paid` → `revenue` (NUMERIC)
  - Col I (8) = `sale_of` → look up `staff_id` from `staff` table
- **Target table:** `sales_by_rep`
- **Hard-code:** `brand_id = 3` (slimming)
- **Upsert conflict:** `(date, staff_id)`
- **Aggregate:** Sum revenue per staff per day before upserting

---

## PIPELINE 6: Salary Master (Google Sheets → Supabase)

**Schedule:** 1st of every month at 10:00
**Source:** Google Sheet `1AAnfm-SAYso6RpJhbdhJbTbcGDH1Ftlk0FHBPHfN98w`

- **Tabs:** All matching pattern `{Mon} {YY} (C)` (e.g., "Apr 26 (C)")
- **Layout:** Col A = location name. Header row has a `Total` column — find it, or scan rightward for last numeric value.
- **Target table:** `hr_weekly`
- **Use first-of-month as `week_start`**
- **Upsert conflict:** `(week_start, location_id)`
- **Columns:** `week_start`, `location_id`, `brand_id` (infer from location), `total_salary_cost` (NUMERIC)

---

## PIPELINE 7: Budget Calendar (Google Sheets → Supabase)

**Schedule:** Every Monday at 08:00
**Source:** Google Sheet `1q40Ke8wRsjnoVOngDupVdwxIWiTFXwYfh1ZwvUa9xtc`

- **Tabs:** `Calendar '25`, `Calendar '26`
- **Layout:** Header row has month columns (Jan–Dec). Col A = department/channel label.
- **Brand inference:** Scan label for keywords (spa/aesthetics/slimming), default to spa if ambiguous.
- **Target table:** `budget_vs_actual`
- **Upsert conflict:** `(month, brand_id, department)`
- **Columns:** `month` (DATE — first of month), `brand_id`, `department` (TEXT), `budgeted` (NUMERIC)

---

## PIPELINE 8: Brand Standards (Google Sheets → Supabase)

**Schedule:** 1st of every month at 09:00
**Source:** Google Sheet `1WWM7W6S5wtSC-5hdlcuJgW3zbYaO7YRgg4_-Bju4-5s` (same sheet as EBITDA)

- **Tabs to read:**
  - `Facility standards`, `Facility standards 25`, `Facility standards 26`
  - `Front desk standards`, `Front desk standards 25`, `Front desk standards 26`
  - `Mystery guest standards`, `Mystery guest standards 25 from AUGUST to 2026`
- **standard_type mapping:** Tab name containing "Facility" → `facility`, "Front desk" → `front_desk`, "Mystery guest" → `mystery_guest`
- **Layout:** Row 0 = month headers (e.g., "August 2024"), Row 1 = location names, Row 2 = % scores (skip), Row 3+ = checklist items with TRUE/FALSE cells
- **Target table:** `brand_standards`
- **Upsert conflict:** `(month, standard_type, item, location)`
- **Columns:** `month` (DATE), `standard_type` (TEXT), `category` (TEXT), `item` (TEXT), `location` (TEXT), `result` (BOOLEAN)

---

## PIPELINE 9: Meta Ads (Meta Marketing API → Supabase)

**Schedule:** Every 6 hours
**Source:** Meta Marketing API (3 ad accounts)

### Ad Account IDs
| Brand | Account ID |
|-------|-----------|
| Spa (brand_id=1) | `act_654279452039150` |
| Aesthetics (brand_id=2) | `act_382359687910745` |
| Slimming (brand_id=3) | `act_1496776195316716` |

### API Call
For each account, pull **account-level insights** for the last 7 days:
- Endpoint: `GET /{act_id}/insights`
- Fields: `spend`, `impressions`, `clicks`, `actions`, `purchase_roas`, `ctr`, `cpc`
- Time increment: `1` (daily breakdown)
- Date preset: `last_7d`

### Field Mapping → `marketing_daily`
- `date_start` → `date` (DATE)
- `spend` → `spend` (NUMERIC)
- `impressions` → `impressions` (INT)
- `clicks` → `clicks` (INT)
- From `actions` array: find item where `action_type == 'lead'` → `leads` (INT)
- From `purchase_roas` array: first element's `value` → `roas` (NUMERIC)
- `ctr` → `ctr_pct` (NUMERIC)
- `cpc` → `cpc` (NUMERIC)
- Compute: `cpl = spend / leads` (handle division by zero → NULL)
- Hard-code: `platform = 'meta'`

**Upsert conflict:** `(date, brand_id, platform)`

**N8N approach:** Use the Facebook Marketing node (or HTTP Request with Meta API token). Loop through the 3 accounts.

---

## PIPELINE 10: Google Ads (Google Ads API → Supabase)

**Schedule:** Every 6 hours
**Source:** Google Ads API

### Field Mapping → `marketing_daily`
- `cost` → `spend` (NUMERIC — Google returns micros, divide by 1,000,000)
- `impressions` → `impressions` (INT)
- `clicks` → `clicks` (INT)
- `conversions` → `leads` (INT)
- `cost_per_conversion` → `cpl` (NUMERIC)
- `conversion_value_per_cost` → `roas` (NUMERIC)
- `ctr` → `ctr_pct` (NUMERIC — multiply by 100 if returned as decimal)
- `average_cpc` → `cpc` (NUMERIC — divide by 1,000,000 if micros)
- Hard-code: `platform = 'google'`

**Upsert conflict:** `(date, brand_id, platform)`

**N8N approach:** Use the Google Ads node or HTTP Request with OAuth2. You'll need customer IDs for each brand's Google Ads account.

---

## PIPELINE 11: Google Analytics 4 (GA4 API → Supabase)

**Schedule:** Daily at 06:00
**Source:** GA4 Data API — one property per brand (3 properties)

### Metrics to Request
`sessions`, `totalUsers`, `newUsers`, `screenPageViews`, `averageSessionDuration`, `bounceRate`, `conversions`

### Dimensions
`date`

### Field Mapping → `ga4_daily`
- `date` → `date` (DATE — GA4 returns YYYYMMDD format, convert to YYYY-MM-DD)
- `sessions` → `sessions` (INT)
- `totalUsers` → `total_users` (INT)
- `newUsers` → `new_users` (INT)
- `screenPageViews` → `page_views` (INT)
- `averageSessionDuration` → `avg_session_duration_sec` (NUMERIC)
- `bounceRate` × 100 → `bounce_rate_pct` (NUMERIC)
- `conversions` → `conversions` (INT)

**Upsert conflict:** `(date, brand_id)`

**N8N approach:** Use the Google Analytics node (GA4 version). Configure 3 parallel branches, one per property.

---

## PIPELINE 12: Google Search Console (GSC API → Supabase)

**Schedule:** Daily at 06:00
**Source:** GSC API — one domain per brand (3 domains)

### Metrics to Request
`clicks`, `impressions`, `ctr`, `position`

### Field Mapping → `gsc_daily`
- `date` → `date` (DATE)
- `clicks` → `clicks` (INT)
- `impressions` → `impressions` (INT)
- `ctr` × 100 → `ctr_pct` (NUMERIC)
- `position` → `avg_position` (NUMERIC)

**Upsert conflict:** `(date, brand_id)`

**N8N approach:** Use HTTP Request node with Google OAuth2 credentials. GSC doesn't have a native N8N node, so call the API directly at `https://www.googleapis.com/webmasters/v3/sites/{site}/searchAnalytics/query`.

---

## PIPELINE 13: Klaviyo (Klaviyo API → Supabase)

**Schedule:** Daily at 08:00
**Source:** Klaviyo API — one account per brand (3 accounts)

### Data to Pull
Campaign performance reports for campaigns sent in the last 7 days.

### Field Mapping → `klaviyo_campaigns`
- `send_date` → `date` (DATE)
- `name` → `campaign_name` (TEXT)
- `sends` → `sends` (INT)
- `opens` → `opens` (INT)
- `clicks` → `clicks` (INT)
- `revenue` → `revenue` (NUMERIC)
- Compute: `revenue_pct_of_total` = this campaign's revenue / total revenue for that date (NUMERIC)

**Upsert conflict:** `(date, brand_id, campaign_name)`

**N8N approach:** Use the Klaviyo node (native N8N node exists) or HTTP Request with API key header `Authorization: Klaviyo-API-Key {key}`.

---

## PIPELINE 14: Zoho CRM — Speed to Lead (Zoho CRM API → Supabase)

**Schedule:** Every 4 hours
**Source:** Zoho CRM API — Deals module (preferred), Leads module (fallback)

### Logic
1. Pull deals/leads created in the last 24 hours
2. For each record, calculate Speed to Lead:
   - **Deals module:** `Speed_to_Lead_Minutes` (pre-calculated field) OR compute from `Campaign_Entry_Time` to (`First_Contact_Time` or `First_Call_Time`)
   - **Leads module (fallback):** `Response_Time_Minutes` (pre-calculated field) OR compute from `Created_Time` to `First_Contacted_Time`
3. Bucket each record into time ranges: `<1min`, `1-3min`, `3-5min`, `5-15min`, `15-30min`, `30min+`
4. Count records per bucket per brand per date
5. Compute `pct` = bucket count / total count × 100

### Field Mapping → `speed_to_lead_distribution`
- `date` (DATE — today)
- `brand_id` (INT — infer from deal/lead owner or campaign source)
- `bucket` (TEXT — one of the 6 values above)
- `count` (INT)
- `pct` (NUMERIC)

**Upsert conflict:** `(date, brand_id, bucket)`

**N8N approach:** Use HTTP Request with Zoho OAuth2. Zoho CRM API endpoint: `https://www.zohoapis.eu/crm/v6/Deals` with `fields` and `criteria` parameters. Handle pagination (Zoho returns max 200 records per page).

---

## PIPELINE 15: Wix (Wix API → Supabase)

**Schedule:** Daily at 07:00
**Source:** Wix Analytics/Bookings API — one site per brand (3 sites)

### Field Mapping → `ga4_daily` (supplements GA4 data)
- `date` → `date` (DATE)
- `sessions` → `sessions` (INT)
- `visitors` or `total_users` → `total_users` (INT)
- `new_visitors` or `new_users` → `new_users` (INT)
- `page_views` → `page_views` (INT)
- `avg_session_duration` → `avg_session_duration_sec` (NUMERIC)
- `bounce_rate` → `bounce_rate_pct` (NUMERIC)
- `conversions` or `form_submissions` → `conversions` (INT)

**Upsert conflict:** `(date, brand_id)` — this will MERGE with GA4 data if both run for the same date. If Wix should supplement rather than overwrite, consider a separate `wix_daily` table or conditional upsert.

**N8N approach:** Use HTTP Request with Wix API key. Wix Analytics API endpoint varies by site.

---

## PIPELINE 16: We360 (We360 API → Supabase)

**Schedule:** Daily at 22:00
**Source:** We360 REST API (`https://api.we360.ai/` — check docs at https://we360.ai/api-docs)

### Field Mapping → `we360_daily`
- `date` → `date` (DATE)
- `staff_id` → `staff_id` (INT — map employee email/name to `staff` table)
- `online_time_min` → `online_time_min` (INT)
- `active_time_min` → `active_time_min` (INT)
- `idle_time_min` → `idle_time_min` (INT)
- `productive_time_min` → `productive_time_min` (INT)
- `unproductive_time_min` → `unproductive_time_min` (INT)
- `neutral_time_min` → `neutral_time_min` (INT)
- `email_time_min` → `email_time_min` (INT)
- `productivity_pct` → `productivity_pct` (NUMERIC)

**Upsert conflict:** `(date, staff_id)`

**N8N approach:** HTTP Request with Bearer token auth.

---

## MISSING PIPELINES — Need New Supabase Tables First

These data sources are referenced in the dashboards but have NO existing ETL scripts or database tables:

### PIPELINE 17: Google My Business Reviews (NEW)

**Dashboard need:** CEO Morning Pulse (Google Rating) + Operations (review count, avg rating, review velocity, complaints)

**Suggested new table:**
```sql
CREATE TABLE google_reviews (
  id SERIAL PRIMARY KEY,
  date DATE NOT NULL,
  location_id INTEGER NOT NULL REFERENCES locations(id),
  brand_id INTEGER NOT NULL REFERENCES brands(id),
  total_reviews INTEGER,
  avg_rating NUMERIC(3,2),
  new_reviews_count INTEGER DEFAULT 0,
  five_star INTEGER DEFAULT 0,
  four_star INTEGER DEFAULT 0,
  three_star INTEGER DEFAULT 0,
  two_star INTEGER DEFAULT 0,
  one_star INTEGER DEFAULT 0,
  UNIQUE(date, location_id)
);
```

**Source:** Google Business Profile API (formerly Google My Business API)
**Schedule:** Daily at 08:00
**N8N approach:** HTTP Request with Google OAuth2. Endpoint: `https://mybusiness.googleapis.com/v4/accounts/{accountId}/locations/{locationId}/reviews`

### PIPELINE 18: POS / Booking Diligence Audit (NEW)

**Dashboard need:** Operations (Diligence Audit Heatmap — deleted %, cancelled %, complementary %, cash %, discounted cash %, unattended transactions)

**Suggested new table:**
```sql
CREATE TABLE diligence_audit (
  id SERIAL PRIMARY KEY,
  date DATE NOT NULL,
  location_id INTEGER NOT NULL REFERENCES locations(id),
  brand_id INTEGER NOT NULL REFERENCES brands(id),
  total_transactions INTEGER,
  deleted_count INTEGER DEFAULT 0,
  cancelled_count INTEGER DEFAULT 0,
  complementary_count INTEGER DEFAULT 0,
  cash_count INTEGER DEFAULT 0,
  discounted_cash_count INTEGER DEFAULT 0,
  unattended_count INTEGER DEFAULT 0,
  UNIQUE(date, location_id)
);
```

**Source:** Depends on what POS/booking system Carisma uses (likely Mindbody, Fresha, or a Wix-based system). This needs to be determined before building.
**Schedule:** Daily at 23:00

### PIPELINE 19: WhatsApp / Messaging Unreplied Count (NEW)

**Dashboard need:** CEO Morning Pulse (Unreplied Messages count)

**Suggested new table:**
```sql
CREATE TABLE message_queue (
  id SERIAL PRIMARY KEY,
  snapshot_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  brand_id INTEGER NOT NULL REFERENCES brands(id),
  unreplied_whatsapp INTEGER DEFAULT 0,
  unreplied_email INTEGER DEFAULT 0,
  unreplied_crm INTEGER DEFAULT 0,
  oldest_unreplied_min INTEGER,
  UNIQUE(date_trunc('hour', snapshot_at), brand_id)
);
```

**Source:** WhatsApp Business API or the existing WhatsApp MCP, plus Zoho CRM unworked leads count
**Schedule:** Every 2 hours

**Note:** The `crm_daily` table already has columns `unreplied_crm`, `unreplied_whatsapp`, `unreplied_email` (added in migration 020). So alternatively, you could populate those columns in Pipeline 2 (CRM Master) instead of creating a new table.

---

## PIPELINE 20: Ad Creatives / Creative Fatigue (NEW)

**Dashboard need:** Marketing by Brand (per-creative CTR, frequency, fatigue scoring)

**Suggested new table:**
```sql
CREATE TABLE ad_creatives (
  id SERIAL PRIMARY KEY,
  date DATE NOT NULL,
  brand_id INTEGER NOT NULL REFERENCES brands(id),
  platform TEXT NOT NULL,
  campaign_name TEXT,
  ad_name TEXT NOT NULL,
  creative_url TEXT,
  spend NUMERIC(10,2),
  impressions INTEGER,
  clicks INTEGER,
  ctr_pct NUMERIC(5,2),
  frequency NUMERIC(6,2),
  cpm NUMERIC(8,2),
  leads INTEGER,
  fatigue_status TEXT CHECK (fatigue_status IN ('healthy', 'watch', 'fatigued')),
  UNIQUE(date, brand_id, platform, ad_name)
);
```

**Fatigue logic:** Compare current 3-day avg CTR to the creative's first-week CTR. If dropped >20% AND frequency >3.0 → `fatigued`. If dropped >10% OR frequency >2.5 → `watch`. Else → `healthy`.

**Source:** Meta Marketing API (ad-level insights, not account-level)
- Endpoint: `GET /{act_id}/ads?fields=name,insights{spend,impressions,clicks,ctr,frequency,cpm,actions}&date_preset=last_7d&time_increment=1`

**Schedule:** Every 6 hours (can piggyback on Pipeline 9)

---

## Supabase Table Schema Reference (Complete)

For your reference, here is every table in the database that ETL workflows write to, with exact column definitions:

### `sales_weekly`
```
id SERIAL PK, week_start DATE, location_id INT FK, brand_id INT FK,
revenue_ex_vat NUMERIC(12,2), revenue_yoy_delta_pct NUMERIC(6,2),
retail_pct NUMERIC(5,2), addon_pct NUMERIC(5,2), hotel_capture_pct NUMERIC(5,2),
etl_synced_at TIMESTAMPTZ DEFAULT now()
UNIQUE(week_start, location_id)
```

### `sales_by_rep`
```
id SERIAL PK, date DATE, staff_id INT FK, brand_id INT FK,
revenue NUMERIC(12,2), bookings_count INT, deposits_collected NUMERIC(12,2),
deposit_pct NUMERIC(5,2)
UNIQUE(date, staff_id)
```

### `crm_daily`
```
id SERIAL PK, date DATE, brand_id INT FK,
total_leads INT, leads_meta INT, leads_crm INT, leads_in_hours INT, leads_out_hours INT,
speed_to_lead_median_min NUMERIC(8,2), speed_to_lead_mean_min NUMERIC(8,2),
conversion_rate_pct NUMERIC(5,2), total_calls INT, outbound_calls INT,
calls_outside_hours INT, appointments_booked INT,
total_sales NUMERIC(12,2), deposit_pct NUMERIC(5,2), avg_daily_sales NUMERIC(12,2),
unreplied_crm INT, unreplied_whatsapp INT, unreplied_email INT, unworked_leads INT,
etl_synced_at TIMESTAMPTZ DEFAULT now()
UNIQUE(date, brand_id)
```

### `crm_by_rep`
```
id SERIAL PK, date DATE, staff_id INT FK, brand_id INT FK,
leads_assigned INT, calls_made INT, appointments_booked INT,
conversions INT, conversion_rate_pct NUMERIC(5,2), speed_to_lead_avg_min NUMERIC(8,2),
total_sales NUMERIC(12,2), dials INT, bookings INT, deposit_pct NUMERIC(5,2),
missed_pct NUMERIC(5,2), team_type TEXT CHECK('sdr','chat'), conversations INT
UNIQUE(date, staff_id)
```

### `speed_to_lead_distribution`
```
id SERIAL PK, date DATE, brand_id INT FK,
bucket TEXT ('<1min','1-3min','3-5min','5-15min','15-30min','30min+'),
count INT, pct NUMERIC(5,2)
UNIQUE(date, brand_id, bucket)
```

### `marketing_daily`
```
id SERIAL PK, date DATE, brand_id INT FK, platform TEXT ('meta'/'google'),
spend NUMERIC(10,2), impressions INT, clicks INT, leads INT,
cpl NUMERIC(8,2), roas NUMERIC(6,2), ctr_pct NUMERIC(5,2), cpc NUMERIC(8,2),
etl_synced_at TIMESTAMPTZ DEFAULT now()
UNIQUE(date, brand_id, platform)
```

### `ga4_daily`
```
id SERIAL PK, date DATE, brand_id INT FK,
sessions INT, total_users INT, new_users INT, page_views INT,
avg_session_duration_sec NUMERIC(8,2), bounce_rate_pct NUMERIC(5,2), conversions INT
UNIQUE(date, brand_id)
```

### `gsc_daily`
```
id SERIAL PK, date DATE, brand_id INT FK,
clicks INT, impressions INT, ctr_pct NUMERIC(5,2), avg_position NUMERIC(6,2)
UNIQUE(date, brand_id)
```

### `klaviyo_campaigns`
```
id SERIAL PK, date DATE, brand_id INT FK,
campaign_name TEXT, sends INT, opens INT, clicks INT,
revenue NUMERIC(10,2), revenue_pct_of_total NUMERIC(5,2)
UNIQUE(date, brand_id, campaign_name)
```

### `ebitda_monthly`
```
id SERIAL PK, month DATE, brand_id INT FK,
revenue NUMERIC(12,2), cogs NUMERIC(12,2), gross_profit NUMERIC(12,2),
opex NUMERIC(12,2), ebitda NUMERIC(12,2), ebitda_margin_pct NUMERIC(5,2)
UNIQUE(month, brand_id)
```

### `budget_vs_actual`
```
id SERIAL PK, month DATE, brand_id INT FK,
department TEXT, budgeted NUMERIC(12,2), actual NUMERIC(12,2), variance_pct NUMERIC(6,2)
UNIQUE(month, brand_id, department)
```

### `hr_weekly`
```
id SERIAL PK, week_start DATE, location_id INT FK, brand_id INT FK,
total_salary_cost NUMERIC(12,2), revenue NUMERIC(12,2),
hc_pct NUMERIC(5,2), utilization_pct NUMERIC(5,2),
headcount INT, joiners INT DEFAULT 0, leavers INT DEFAULT 0
UNIQUE(week_start, location_id)
```

### `we360_daily`
```
id SERIAL PK, date DATE, staff_id INT FK,
online_time_min INT, active_time_min INT, idle_time_min INT,
productive_time_min INT, unproductive_time_min INT, neutral_time_min INT,
email_time_min INT, productivity_pct NUMERIC(5,2)
UNIQUE(date, staff_id)
```

### `operations_weekly`
```
id SERIAL PK, week_start DATE, location_id INT FK, brand_id INT FK,
google_reviews_count INT, google_reviews_avg NUMERIC(3,2), complaints_count INT DEFAULT 0
UNIQUE(week_start, location_id)
```

### `brand_standards`
```
id UUID PK DEFAULT gen_random_uuid(), month DATE, standard_type TEXT ('facility','front_desk','mystery_guest'),
category TEXT, item TEXT, location TEXT, result BOOLEAN,
created_at TIMESTAMPTZ DEFAULT now()
UNIQUE(month, standard_type, item, location)
```

### `etl_sync_log`
```
id SERIAL PK, source_name TEXT, started_at TIMESTAMPTZ DEFAULT now(),
completed_at TIMESTAMPTZ, status TEXT ('running','success','partial','failed'),
rows_upserted INT DEFAULT 0, error_message TEXT, duration_sec NUMERIC(8,2)
```

### `crm_booking_mix`
```
id SERIAL PK, date DATE, brand_id INT FK,
treatment_name TEXT, count INT DEFAULT 0
UNIQUE(date, brand_id, treatment_name)
```

### `crm_lead_reconciliation`
```
id SERIAL PK, date DATE, brand_id INT FK,
leads_meta INT DEFAULT 0, leads_crm INT DEFAULT 0,
delta INT GENERATED ALWAYS AS (leads_meta - leads_crm) STORED
UNIQUE(date, brand_id)
```

### `escalation_log`
```
id BIGSERIAL PK, brand_id INT FK, lead_id TEXT, lead_name TEXT, lead_phone TEXT,
campaign TEXT, assigned_rep TEXT, tier INT CHECK(1-4),
minutes_elapsed NUMERIC(8,1), escalated_at TIMESTAMPTZ DEFAULT now(),
channel TEXT CHECK('email','whatsapp','whatsapp_failed')
```

---

## Build Order (Priority)

Build in this order — each pipeline unlocks more dashboard sections:

1. **Pipeline 9: Meta Ads** — highest impact, unlocks Marketing dashboards + CEO ROAS
2. **Pipeline 2: CRM Master** — unlocks CRM dashboard + Speed to Lead
3. **Pipeline 14: Zoho CRM STL** — completes Speed to Lead distribution
4. **Pipeline 1: Weekly KPIs** — unlocks Sales + HR dashboards (use Execute Command for Python)
5. **Pipeline 3: EBITDA** — unlocks Finance dashboards
6. **Pipeline 10: Google Ads** — completes Marketing dashboards
7. **Pipeline 11: GA4** — web analytics
8. **Pipeline 12: GSC** — SEO data
9. **Pipeline 13: Klaviyo** — email marketing
10. **Pipeline 4 & 5: Aesthetics + Slimming Sales** — per-rep sales data
11. **Pipeline 6: Salary Master** — HR cost data
12. **Pipeline 7: Budget Calendar** — budget vs actual
13. **Pipeline 8: Brand Standards** — operations quality
14. **Pipeline 15: Wix** — supplementary web data
15. **Pipeline 16: We360** — productivity tracking
16. **Pipelines 17-20: New sources** — Google Reviews, POS Audit, WhatsApp, Ad Creatives

---

## Error Handling Requirements

Every workflow must:
1. **Log to `etl_sync_log`** (start, success, or failure with error message)
2. **Handle API rate limits** — add Wait nodes with exponential backoff
3. **Handle empty data gracefully** — if a sheet tab is empty or an API returns no results, log `status='partial'` with a note, don't fail
4. **Strip currency symbols** — Google Sheets cells often contain `€`, `EUR`, commas in numbers. Strip these before parsing to numeric.
5. **Handle date formats** — Sheets may return dates as serial numbers (e.g., 44927) or strings ("2023-01-15"). Parse both.
6. **Notify on failure** — after logging to `etl_sync_log`, optionally send a notification (email or webhook) so the team knows a pipeline broke

---

## Credentials You'll Need to Set Up in N8N

| Credential Name | Type | Used By |
|----------------|------|---------|
| `Supabase` | Supabase (URL + service role key) | All pipelines |
| `Google Sheets` | Google OAuth2 | Pipelines 1-8 |
| `Meta Ads` | Facebook Marketing OAuth2 | Pipelines 9, 20 |
| `Google Ads` | Google Ads OAuth2 | Pipeline 10 |
| `Google Analytics` | Google Analytics OAuth2 | Pipeline 11 |
| `Google Search Console` | Google OAuth2 | Pipeline 12 |
| `Klaviyo` | API Key (header) | Pipeline 13 |
| `Zoho CRM` | Zoho OAuth2 (EU datacenter: accounts.zoho.eu) | Pipeline 14 |
| `Wix` | Wix API Key | Pipeline 15 |
| `We360` | Bearer Token | Pipeline 16 |
| `Google Business Profile` | Google OAuth2 | Pipeline 17 |
| `Anthropic` | API Key | CI system (if integrated) |

**Important:** Zoho CRM uses the **EU datacenter** — OAuth token URL is `https://accounts.zoho.eu/oauth/v2/token`, API base URL is `https://www.zohoapis.eu/crm/v6/`.

---

## Testing Checklist

After building each workflow:
1. Run it manually once and verify rows appear in the correct Supabase table
2. Check `etl_sync_log` for a `success` entry with correct `rows_upserted` count
3. Verify the CEO Cockpit dashboard section that reads from that table now shows real data instead of mock data
4. Run it a second time to verify upsert doesn't create duplicate rows
5. Intentionally break the input (e.g., empty sheet tab) to verify error handling logs correctly
