---
name: n8n-etl-pipelines
description: "Use when working with CEO Cockpit ETL data pipelines — building, debugging, modifying, or monitoring the 20 n8n workflows that feed live data into Supabase for the dashboard."
---

# n8n ETL Pipelines — Carisma CEO Cockpit

## Overview

20 ETL pipelines built as n8n workflows feed live data from external sources into Supabase (PostgreSQL) for the CEO Cockpit Next.js dashboard. Each pipeline runs on a schedule, pulls data, transforms it, and upserts to the correct table.

## Architecture

```
External Sources → N8N Workflows (scheduled) → Supabase Tables → Next.js Dashboard
```

**Two workflow types:**
- **Native n8n** — API-based pipelines (Meta Ads, GA4, GSC, Klaviyo, Zoho CRM, Ad Creatives, Message Queue)
- **Execute Command** — Complex Google Sheets parsing pipelines that call existing Python scripts in `etl/`

## Pipeline Registry

| # | Name | Source | Table | Schedule | Type |
|---|------|--------|-------|----------|------|
| 1 | Weekly KPIs | Google Sheets | sales_weekly, hr_weekly, operations_weekly | Mon 09:00 | Execute Cmd |
| 2 | CRM Master | Google Sheets | crm_daily, crm_by_rep | Daily 09:00 | Execute Cmd |
| 3 | EBITDA | Google Sheets | ebitda_monthly | 5th/month 10:00 | Execute Cmd |
| 4 | Aesthetics Sales | Google Sheets | sales_by_rep | Daily 20:00 | Execute Cmd |
| 5 | Slimming Sales | Google Sheets | sales_by_rep | Daily 20:00 | Execute Cmd |
| 6 | Salary Master | Google Sheets | hr_weekly | 1st/month 10:00 | Execute Cmd |
| 7 | Budget Calendar | Google Sheets | budget_vs_actual | Mon 08:00 | Execute Cmd |
| 8 | Brand Standards | Google Sheets | brand_standards | 1st/month 09:00 | Execute Cmd |
| 9 | Meta Ads | Meta Graph API | marketing_daily | Every 6h | Native |
| 10 | Google Ads | Google Ads API | marketing_daily | Every 6h | Native |
| 11 | GA4 | GA4 Data API | ga4_daily | Daily 06:00 | Native |
| 12 | GSC | GSC API | gsc_daily | Daily 06:00 | Native |
| 13 | Klaviyo | Klaviyo API | klaviyo_campaigns | Daily 08:00 | Native |
| 14 | Zoho CRM STL | Zoho CRM API | speed_to_lead_distribution | Every 4h | Native |
| 15 | Wix | Wix API | ga4_daily | Daily 07:00 | Execute Cmd |
| 16 | We360 | We360 API | we360_daily | Daily 22:00 | Execute Cmd |
| 17 | Google Reviews | Google Business API | google_reviews | Daily 08:00 | Native |
| 18 | Diligence Audit | POS/Booking TBD | diligence_audit | Daily 23:00 | Placeholder |
| 19 | Message Queue | WhatsApp + Zoho | message_queue | Every 2h | Native |
| 20 | Ad Creatives | Meta Graph API | ad_creatives | Every 6h | Native |

## Key Files

- **Workflow JSONs:** `10-Tech/CEO-Cockpit/n8n/workflows/pipeline-{NN}-{name}.json`
- **Python ETL scripts:** `10-Tech/CEO-Cockpit/etl/etl_{name}.py`
- **Shared utilities:** `10-Tech/CEO-Cockpit/etl/shared/` (supabase_client, etl_logger, etl_config, sheets_reader)
- **Master prompt:** `10-Tech/CEO-Cockpit/n8n/N8N_ETL_MASTER_PROMPT.md`

## ETL Logging

Every workflow logs to `etl_sync_log`:
1. On start: INSERT `{ source_name, status: 'running' }`
2. On success: UPDATE `{ status: 'success', rows_upserted, completed_at, duration_sec }`
3. On failure: UPDATE `{ status: 'failed', error_message, completed_at, duration_sec }`

## Supabase Connection

- All writes use **upsert** with conflict columns to avoid duplicates
- Service role key bypasses RLS
- Access via env vars: `$env.SUPABASE_URL`, `$env.SUPABASE_SERVICE_KEY`

## n8n Access

- **UI:** http://localhost:5678
- **API:** http://localhost:5678/api/v1
- **Start command:** `N8N_LICENSE_KEY="bfa824be-5259-4c72-bcaf-14bff991605f" GENERIC_TIMEZONE="Europe/Malta" SUPABASE_URL="https://praceahubcvbrewuqejh.supabase.co" SUPABASE_SERVICE_KEY="..." n8n start`

## Common Operations

### Check pipeline status
Query `etl_sync_log` for recent runs:
```sql
SELECT source_name, status, rows_upserted, duration_sec, started_at 
FROM etl_sync_log ORDER BY started_at DESC LIMIT 20;
```

### Manually trigger a pipeline
Via n8n API: `POST /api/v1/workflows/{id}/run`

### Debug a failed pipeline
1. Check `etl_sync_log` for error_message
2. Open the workflow in n8n UI → Executions tab
3. Check node-level errors
4. For Execute Command workflows, check Python script output

### Add a new pipeline
1. Add entry to this skill's Pipeline Registry
2. Create workflow JSON in `n8n/workflows/`
3. Deploy via API or import in n8n UI
4. Update N8N_ETL_MASTER_PROMPT.md

## Brand & Location IDs

**Brands:** spa=1, aesthetics=2, slimming=3

**Locations:** Inter=1, Hugo's=2, Hyatt=3, Ramla=4, Labranda=5, Odycy=6, Excelsior=7, Novotel=8, Aesthetics Clinic=9, Slimming Clinic=10
