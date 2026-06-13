---
name: diligence-qc
description: QC skill for reconciling cash sales, discounted cash, and complimentary metrics between the Cockpit datasheet (ground truth) and the CEO-Cockpit dashboard (Supabase). Run whenever Ben or an agent has manually calculated these figures and wants to confirm they match what the dashboard shows.
metadata:
  type: reference
---

# Diligence Audit — QC Reconciliation Skill

## When to use this skill

Run this QC whenever:
- Ben or a finance sub-agent has manually calculated cash sales, discounted cash, or complimentary for a given month
- The nightly `diligence-metrics` ETL has just run and you want to verify the dashboard is correct
- A discrepancy is suspected between what the dashboard shows and what raw data says
- Monthly close — before sending numbers to management

---

## What this QC checks

Three metrics, per location, per month:

| Metric | CSV definition | Dashboard source |
|--------|---------------|-----------------|
| **Cash Sales** | SUM(Unit Price) WHERE PaymentType=Cash AND Sold | `diligence_audit.cash_sales` |
| **Discounted Cash** | SUM(Unit Price) WHERE PaymentType=Cash AND Discount>0 AND Sold | `diligence_audit.discounted_cash` |
| **Complimentary** | SUM(Unit Price) WHERE PaymentType="Payment Center" AND Sold | `diligence_audit.complimentary` |

**Tolerance:** Flag if CSV vs Dashboard differ by >2 percentage points OR >€100 in absolute EUR.

---

## How to run (automated — preferred)

```bash
python3 Tools/qc_diligence_metrics.py 2026-05
```

Replace `2026-05` with the month to check (or omit for previous calendar month).

Exit code `0` = all metrics reconcile. Exit code `1` = mismatches found.

The script:
1. Fetches the Cockpit datasheet "Service - Spa" CSV (zero-auth, no OAuth)
2. Computes cash/discounted_cash/complimentary from raw transactions
3. Fetches `diligence_audit` from Supabase for the same month
4. Prints a per-location comparison table and flags discrepancies

---

## How to run (agent — manual steps)

If you need to run the QC without the Python script, follow these steps:

### Step 1 — Fetch Cockpit CSV

```bash
curl -L "https://docs.google.com/spreadsheets/d/195RvbNuZd-oNL-rziKC3Wz6ndy0cDA_a/export?format=csv&gid=1281126329" \
  -o /tmp/cockpit_spa.csv
```

### Step 2 — Compute from CSV with Python

```python
import csv, io, json

# Read headers — first row with ≥3 non-empty cells
rows = list(csv.reader(open('/tmp/cockpit_spa.csv')))
hi = next(i for i,r in enumerate(rows[:5]) if sum(1 for c in r if c.strip())>=3)
hdrs = [h.strip() for h in rows[hi]]
data = [dict(zip(hdrs,[c.strip() for c in r])) for r in rows[hi+1:]]

TARGET = "2026-05-01"  # change to target month

LOCMAP = {
  "HUGOS":2,"INTER":1,"RAMLA":4,"SUNNY COAST":6,
  "SALES POINT OF EXCELSIOR":7,"HYATT":3,
  "LABRANDA GENERAL SALES POINT":5,"SALES POINT OF NOV":8,
}

acc = {}
for row in data:
    if row.get("Sales Status","").lower() != "sold": continue
    # Parse D/M/YYYY date
    raw = row.get("Service Date") or row.get("Sales Date","")
    p = raw.split("/")
    if len(p)==3:
        y=int(p[2]); m=int(p[1]); d=int(p[0])
        if y<100: y+=2000
        mk = f"{y}-{m:02d}-01"
    else:
        continue
    if mk != TARGET: continue
    sp = row.get("Sales Point","").strip().upper()
    loc = LOCMAP.get(sp)
    if not loc: continue
    u = float(row.get("Unit Price","0").replace(",","") or 0)
    d2 = float(row.get("Discount (%)","0").replace(",","") or 0)
    pt = row.get("Payment Type","").strip()
    if loc not in acc: acc[loc]={"total":0,"cash":0,"disc":0,"comp":0}
    acc[loc]["total"] += u
    if pt=="Cash":
        acc[loc]["cash"] += u
        if d2>0: acc[loc]["disc"] += u
    if pt in ("Payment Center","Open Account"):
        acc[loc]["comp"] += u

for loc,v in sorted(acc.items()):
    t=v["total"] or 1
    print(f"Loc {loc}: cash={v['cash']:.0f} ({v['cash']/t*100:.1f}%) disc={v['disc']:.0f} ({v['disc']/t*100:.1f}%) comp={v['comp']:.0f} ({v['comp']/t*100:.1f}%)")
```

### Step 3 — Fetch dashboard values from Supabase

```bash
curl -s "https://gnripfrvcxrakjhiwlxy.supabase.co/rest/v1/diligence_audit?month=eq.2026-05-01&select=location_id,total_sales,cash_sales,discounted_cash,complimentary&order=location_id.asc" \
  -H "apikey: $SUPABASE_SERVICE_ROLE_KEY" \
  -H "Authorization: Bearer $SUPABASE_SERVICE_ROLE_KEY"
```

### Step 4 — Compare and report

For each location, compare:
- `cash_sales` (dashboard) vs CSV `cash` → flag if >2pp difference
- `discounted_cash` (dashboard) vs CSV `disc` → flag if >2pp difference  
- `complimentary` (dashboard) vs CSV `comp` → flag if >2pp difference

Use each source's own total for % (dashboard uses accounting `total_sales`;
CSV uses raw `total_sold` — denominators will differ slightly).

---

## Reconciling with Ben's manual figures

When Ben has calculated his own figures:

1. Ask Ben for his numbers: cash sales total (EUR), discounted cash total (EUR), complimentary total (EUR), and which month/location they cover.
2. Run the Python script or manual steps above to get the CSV-computed values.
3. Compare Ben's figures against the CSV figures (not the dashboard directly).
   - If Ben ≈ CSV: CSV is correct; dashboard should reflect this after next ETL run.
   - If Ben ≠ CSV: investigate at the raw transaction level (which rows did Ben include that differ?).
4. Compare dashboard values against CSV to confirm the ETL wrote correctly.

**Key principle:** CSV is always ground truth. Dashboard = what ETL wrote from CSV.
Ben's manual = independent check on the raw data.

---

## Interpreting results

| Pattern | Likely cause |
|---------|-------------|
| Dashboard vs CSV match (all locations) | ETL is healthy. No action needed. |
| Dashboard vs CSV mismatch (one location) | Check if that location's Sales Point name changed in the CSV, or if a manual override was entered in the Accounting Master that the ETL preserved. |
| Ben's figure ≠ CSV for same location | Ben may be including a different date range, using List Price instead of Unit Price, or including non-Sold rows. |
| Complimentary = 0 in Supabase but non-zero in CSV | ETL lag — `spa_transactions_raw` drops Payment Center rows. Run `diligence-metrics` ETL manually (see below). |
| Large Excelsior discounted_cash gap | Known issue — Excelsior manager enters a manual figure higher than the POS records. Escalate to hotel manager. |

---

## Force a fresh ETL run

If the dashboard is stale or a mismatch needs to be fixed:

```bash
# Trigger diligence-audit first (Accounting Master figures)
curl -X POST https://carisma-support-u2vb.vercel.app/api/etl/diligence-audit \
  -H "x-cron-secret: $CRON_SECRET"

# Then trigger diligence-metrics (cockpit CSV auto-computed values)
curl -X POST https://carisma-support-u2vb.vercel.app/api/etl/diligence-metrics \
  -H "x-cron-secret: $CRON_SECRET"
```

Wait ~30 seconds between the two calls to ensure ordering.

---

## Reference

- ETL source: `lib/etl/diligence-metrics.ts`
- API route: `app/api/etl/diligence-metrics/route.ts`
- Supabase table: `diligence_audit` (columns: month, location_id, total_sales, cash_sales, discounted_cash, complimentary, deleted_cancelled, unattended_count)
- QC script: `Tools/qc_diligence_metrics.py`
- Definitions: [[diligence-audit-metrics]]
