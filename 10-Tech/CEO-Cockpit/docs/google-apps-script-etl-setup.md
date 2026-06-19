# Google Apps Script ETL Setup Guide

How to set up automatic data sync from a Google Sheets "weeks as columns" spreadsheet to Supabase using Google Apps Script.

## Architecture

```
Google Sheet (Weekly KPIs)
    |
    |-- On Edit trigger (real-time)
    |-- Daily cron trigger (6am backup)
    |
    v
Google Apps Script (runs inside the sheet)
    |
    |-- Reads metric labels (column A) + week data (target column)
    |-- Transposes columns → rows
    |-- Cleans values (handles #REF!, currency symbols, empty cells)
    |
    v
Supabase REST API (upsert with merge-duplicates)
    |
    v
CEO Cockpit Dashboard (reads from Supabase)
```

## Why Apps Script (not external cron)

- **Zero auth maintenance** — runs as the sheet owner, no OAuth refresh tokens to manage
- **No server required** — Google hosts and executes it for free
- **Built-in triggers** — on-edit (real-time) + time-driven (cron) without external scheduler
- **Native Sheets access** — reads any cell, tab, or range without API quotas
- **Handles dynamic columns** — the "weeks as columns" layout where new columns appear each week

## Setup Steps

### 1. Create the Apps Script project

1. Open the target Google Sheet
2. Go to **Extensions → Apps Script**
3. Delete the default `myFunction()` code
4. Paste the full ETL script (see template below or `Tools/apps_script_weekly_kpi.js`)
5. **Ctrl+S** / **Cmd+S** to save
6. Rename the project (click "Untitled project" in the header)

### 2. Configure the script

Update these constants at the top of the script:

```javascript
const SUPABASE_URL = "https://praceahubcvbrewuqejh.supabase.co";
const SUPABASE_KEY = "<service_role_key>"; // Never expires, unlike OAuth tokens
```

Update `TAB_CONFIG` to match the actual tab names in the sheet:

```javascript
const TAB_CONFIG = [
  {
    tabName: "Revenue",           // Must match the sheet tab name exactly
    supabaseTable: "weekly_revenue", // Target Supabase table
    headerRow: 1,                 // Row containing week date headers
    dataStartCol: 3,              // Column where week data starts (C = 3)
    metrics: []
  },
  // ... more tabs
];
```

### 3. Discover sheet structure (optional)

Run `discoverSheetStructure()` from the Apps Script editor to inspect:
- All tab names
- Row/column counts
- Sample headers and data rows

This helps you set `tabName`, `headerRow`, and `dataStartCol` correctly.

### 4. Test the connection

1. In the Apps Script editor, select `testConnection` from the function dropdown
2. Click **Run**
3. Check the **Execution log** — should say "SUCCESS: Supabase connection works!"
4. On first run, Google will ask for OAuth permissions:
   - "See, edit, create, and delete all your Google Sheets spreadsheets"
   - "Connect to an external service" (for Supabase HTTP calls)
5. Click **Advanced → Go to [project name] (unsafe) → Select All → Continue**

### 5. Set up triggers

Go to the **Triggers** page (alarm icon in left sidebar):

**Trigger 1 — On Edit (real-time sync):**
- Function: `onEditTrigger`
- Deployment: Head
- Event source: From spreadsheet
- Event type: On edit
- Failure notification: Notify me daily

**Trigger 2 — Daily Backup (cron):**
- Function: `syncLatestWeek`
- Deployment: Head
- Event source: Time-driven
- Type: Day timer
- Time of day: 6am to 7am
- Failure notification: Notify me daily

### 6. Backfill historical data (one-time)

Run `backfillAll()` from the editor to populate Supabase with all existing week columns. This reads every column from `dataStartCol` to the last column, parses dates, and upserts all rows.

**Note:** Backfill includes a 200ms sleep between columns to avoid API rate limits.

## Script Template

The full script lives at `Tools/apps_script_weekly_kpi.js` in the repo.

### Key functions

| Function | Purpose |
|---|---|
| `syncLatestWeek()` | Syncs the rightmost (latest) week column from all configured tabs |
| `onEditTrigger(e)` | Fires on edit — syncs the edited column if it's in a monitored tab |
| `backfillAll()` | One-time: syncs ALL week columns from ALL configured tabs |
| `backfillAllWeeks(tab, table, headerRow, startCol)` | Backfills a single tab |
| `syncColumnGeneric(tab, table, colIndex, weekDate)` | Syncs one column → Supabase rows |
| `discoverSheetStructure()` | Inspects all tabs and logs their structure |
| `testConnection()` | Verifies Supabase credentials work |
| `testPreview()` | Shows what tabs/columns would be synced without writing |

### Data transformation

The script transposes "weeks as columns" into normalized rows:

**Sheet layout (input):**
```
        | 7-Apr | 14-Apr | 21-Apr |
Revenue |  1200 |   1350 |   1400 |
Costs   |   800 |    850 |    900 |
```

**Supabase rows (output):**
```json
{ "week_start": "2026-04-07", "metric": "Revenue", "value": 1200, "tab": "Revenue" }
{ "week_start": "2026-04-07", "metric": "Costs",   "value": 800,  "tab": "Revenue" }
{ "week_start": "2026-04-14", "metric": "Revenue", "value": 1350, "tab": "Revenue" }
...
```

### Date parsing

Handles multiple date formats in column headers:
- Date objects (Google Sheets serial dates)
- `"23-Mar"` or `"23-Mar-26"` (short month)
- `"2026-03-23"` (ISO format)
- Any format `new Date()` can parse

### Value cleaning

- Strips `#REF!`, `#N/A`, `#DIV/0!` errors → `null`
- Removes currency symbols (`€`, `$`, `£`) and commas
- Converts `"-"` and empty strings → `null`
- Returns `null` for non-numeric values

### Upsert strategy

Uses Supabase's `Prefer: resolution=merge-duplicates` header, which:
- Inserts new rows if the unique key combination doesn't exist
- Updates existing rows if the key combination matches
- Requires a unique constraint on `(week_start, metric, tab)` in Supabase

## Supabase Table Schema

Each target table should have at minimum:

```sql
CREATE TABLE weekly_revenue (
  id BIGSERIAL PRIMARY KEY,
  week_start DATE NOT NULL,
  metric TEXT NOT NULL,
  value NUMERIC,
  tab TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(week_start, metric, tab)
);
```

## Automation via Playwright (for Claude Code)

When setting up via Playwright browser automation:

### Key challenges and solutions

1. **Monaco editor** — Apps Script uses Monaco. Direct `click()` on the textarea fails because overlay divs intercept pointer events. Solution: access `window.monaco.editor.getEditors()[0].setValue(code)` via `page.evaluate()`.

2. **Google Material dropdowns** — The trigger form uses custom Material Design listboxes, not native `<select>`. Options render in `.OA0qNb.ncFHed` overlay panels. Solution: open the listbox via Playwright click, then `page.evaluate()` to find and click the option in the panel.

3. **Google OAuth consent** — On first trigger save, Google opens an OAuth consent page. The "Select all" checkbox and individual permission checkboxes use Material Design components that ignore synthetic DOM events. Solution: use `page.mouse.click(x, y)` with exact coordinates from `getBoundingClientRect()` — this creates trusted browser events.

4. **Unverified app warning** — Click "Advanced" → "Go to [project name] (unsafe)" to proceed.

### Playwright automation sequence

```
1. Navigate to the Google Sheet URL
2. Open Extensions → Apps Script (use dispatchEvent for menu clicks)
3. Switch to the Apps Script tab
4. Set code via Monaco API: monaco.editor.getEditors()[0].setValue(code)
5. Cmd+S to save
6. Rename project via the Rename button + dialog
7. Navigate to Triggers page
8. Add Trigger → configure via panel clicks → Save
9. Handle OAuth: Advanced → Go to (unsafe) → mouse.click on checkboxes → Continue
10. Add second trigger (time-driven)
```

## Current Deployments

### Weekly KPI Sheet
- **Sheet ID:** `1JGlBdii7Zu25yha0zrmi72PPH1BFZRdVeGvcig3r6GE`
- **Apps Script Project ID:** `1AHexXYnIrkG2fiAOx2qYJiUvH_jLx4yAd2Rr0ZvDtkHgebm2MGNhJVCW`
- **Project Name:** Carisma Weekly KPI → Supabase ETL
- **Triggers:** 2 (on-edit + daily 6am)
- **Tabs monitored:** Revenue, EBITDA, CRM, Operations
- **Supabase tables:** weekly_revenue, weekly_ebitda, weekly_crm, weekly_operations
- **Date set up:** 2026-04-15

## Troubleshooting

| Issue | Solution |
|---|---|
| "Tab not found: Revenue" | Tab name in sheet doesn't match `TAB_CONFIG.tabName` exactly (check for spaces, capitalization) |
| Supabase 404 error | Table doesn't exist yet — create it with the schema above |
| Supabase 409 conflict | Missing `UNIQUE` constraint on `(week_start, metric, tab)` |
| "Could not parse date from header" | Date format not recognized — add a case to `parseWeekDate()` |
| No data syncing on edit | Check trigger is set to "On edit" not "On open"; check `dataStartCol` matches |
| OAuth token expired | Won't happen — Apps Script handles auth internally (this is the whole point) |
