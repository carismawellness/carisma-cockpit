"""
QC tool: reconcile diligence audit metrics between the Cockpit datasheet
(ground truth) and the CEO-Cockpit dashboard (Supabase diligence_audit table).

Checks three auto-computed metrics per location for a given month:
  1. Cash Sales       — PaymentType=Cash, SalesStatus=Sold
  2. Discounted Cash  — PaymentType=Cash AND Discount>0, SalesStatus=Sold
  3. Complimentary    — PaymentType=Payment Center, SalesStatus=Sold

Usage:
  python3 Tools/qc_diligence_metrics.py [YYYY-MM]

If no month is given, defaults to the most recent complete calendar month.

Output:
  A per-location reconciliation table with EUR amounts and % of Total Sales,
  flagging any metric where CSV vs Dashboard diverges by >2 percentage points
  or >€100 in absolute value.

Exit codes:
  0 — all metrics reconcile (no mismatches above threshold)
  1 — one or more mismatches detected
"""

from __future__ import annotations

import csv
import io
import json
import os
import sys
import urllib.request
import urllib.error
from datetime import date, datetime
from pathlib import Path

# ── Env loading ────────────────────────────────────────────────────────────────
_REPO_ROOT = Path(__file__).resolve().parents[1]

def _load_env_file(path: Path) -> None:
    if not path.exists():
        return
    with open(path, encoding="utf-8") as f:
        for line in f:
            line = line.strip()
            if not line or line.startswith("#") or "=" not in line:
                continue
            k, _, v = line.partition("=")
            os.environ.setdefault(k.strip(), v.strip().strip('"').strip("'"))

_load_env_file(_REPO_ROOT / ".env")
_load_env_file(_REPO_ROOT / "Tech" / "CEO-Cockpit" / ".env.local")

SUPABASE_URL = os.environ.get("NEXT_PUBLIC_SUPABASE_URL", "https://gnripfrvcxrakjhiwlxy.supabase.co")
SUPABASE_KEY = os.environ.get("SUPABASE_SERVICE_ROLE_KEY", "")

# ── Cockpit datasheet ──────────────────────────────────────────────────────────
COCKPIT_SHEET_ID = "195RvbNuZd-oNL-rziKC3Wz6ndy0cDA_a"
SERVICE_GID      = "1281126329"

LOCATION_MAP: dict[str, int] = {
    "HUGOS":                        2,
    "INTER":                        1,
    "RAMLA":                        4,
    "SUNNY COAST":                  6,
    "SALES POINT OF EXCELSIOR":     7,
    "HYATT":                        3,
    "LABRANDA GENERAL SALES POINT": 5,
    "SALES POINT OF NOV":           8,
}

LOC_NAMES: dict[int, str] = {
    1: "Inter", 2: "Hugos", 3: "Hyatt", 4: "Ramla",
    5: "Labranda", 6: "Sunny", 7: "Excelsior", 8: "Novotel",
}

TOLERANCE_PP  = 2.0   # percentage-point delta that triggers a flag
TOLERANCE_EUR = 100.0 # absolute EUR delta that triggers a flag (secondary check)

# ── Helpers ────────────────────────────────────────────────────────────────────

def parse_month_key(raw: str) -> str | None:
    """Return 'YYYY-MM-01' from D/M/YYYY, YYYY-MM-DD, or 'D Month YYYY'."""
    s = raw.strip()
    if not s:
        return None
    MONTHS = {
        "january":"01","february":"02","march":"03","april":"04",
        "may":"05","june":"06","july":"07","august":"08",
        "september":"09","october":"10","november":"11","december":"12",
        "jan":"01","feb":"02","mar":"03","apr":"04","jun":"06","jul":"07",
        "aug":"08","sep":"09","oct":"10","nov":"11","dec":"12",
    }
    # D/M/YYYY or D/M/YY
    parts = s.split("/")
    if len(parts) == 3:
        d, m, y = parts
        y_int = int(y) if int(y) > 100 else 2000 + int(y)
        if 1 <= int(m) <= 12 and 1 <= int(d) <= 31:
            return f"{y_int}-{int(m):02d}-01"
    # YYYY-MM-DD
    if len(s) == 10 and s[4] == "-" and s[7] == "-":
        return f"{s[:7]}-01"
    # D Month YYYY
    parts2 = s.split()
    if len(parts2) == 3:
        mo = MONTHS.get(parts2[1].lower())
        if mo:
            return f"{parts2[2]}-{mo}-01"
    return None

def safe_float(val: str) -> float:
    try:
        return float(val.replace(",", "").strip())
    except ValueError:
        return 0.0

def http_get(url: str, headers: dict[str, str] | None = None) -> bytes:
    req = urllib.request.Request(url, headers=headers or {})
    with urllib.request.urlopen(req, timeout=60) as r:
        return r.read()

# ── Step 1: compute from Cockpit CSV ──────────────────────────────────────────

def compute_from_csv(target_month: str) -> tuple[dict[int, dict[str, float]], dict[int, float]]:
    """
    Returns:
      main  — {location_id: {total_sold, cash, disc_cash, complimentary}}
      oa    — {location_id: open_account_sum}   (surfaced separately, not in main metrics)
    """
    url = (
        f"https://docs.google.com/spreadsheets/d/{COCKPIT_SHEET_ID}"
        f"/export?format=csv&gid={SERVICE_GID}"
    )
    print(f"  Fetching Cockpit CSV…", end=" ", flush=True)
    raw = http_get(url)
    text = raw.decode("utf-8", errors="replace")
    print("done")

    reader = csv.reader(io.StringIO(text))
    all_rows = list(reader)

    # Find real header row (≥3 non-empty cells, within first 5 rows)
    header_idx = 0
    for i, row in enumerate(all_rows[:5]):
        if sum(1 for c in row if c.strip()) >= 3:
            header_idx = i
            break
    headers = [h.strip() for h in all_rows[header_idx]]
    data_rows = [
        dict(zip(headers, [c.strip() for c in row]))
        for row in all_rows[header_idx + 1:]
    ]

    acc: dict[int, dict[str, float]] = {}
    oa:  dict[int, float] = {}   # Open Account — separate from main metrics

    for row in data_rows:
        if row.get("Sales Status", "").lower() != "sold":
            continue

        date_raw = row.get("Service Date") or row.get("Sales Date") or ""
        mk = parse_month_key(date_raw)
        if mk != target_month:
            continue

        sp = row.get("Sales Point", "").strip().upper()
        loc_id = LOCATION_MAP.get(sp)
        if not loc_id:
            continue

        if loc_id not in acc:
            acc[loc_id] = {"total_sold": 0.0, "cash": 0.0, "disc_cash": 0.0, "comp": 0.0}

        unit  = safe_float(row.get("Unit Price", "0"))
        disc  = safe_float(row.get("Discount (%)", "0"))
        ptype = row.get("Payment Type", "").strip()

        acc[loc_id]["total_sold"] += unit

        if ptype == "Cash":
            acc[loc_id]["cash"] += unit
            if disc > 0:
                acc[loc_id]["disc_cash"] += unit

        # Complimentary = Payment Center only (matches Accounting Master definition).
        # QC confirmed this matches exactly (May 2026, all 8 locations).
        if ptype == "Payment Center":
            acc[loc_id]["comp"] += unit

        # Open Account rows exist but accounting does NOT count them as complimentary.
        # Surfaced separately so Ben/management can decide how to classify them.
        if ptype == "Open Account":
            oa[loc_id] = oa.get(loc_id, 0.0) + unit

    return acc, oa

# ── Step 2: fetch dashboard values from Supabase ──────────────────────────────

def fetch_dashboard(target_month: str) -> dict[int, dict[str, float]]:
    """Returns {location_id: {total_sales, cash_sales, discounted_cash, complimentary}}."""
    if not SUPABASE_KEY:
        raise RuntimeError("SUPABASE_SERVICE_ROLE_KEY not set — cannot fetch dashboard values")

    url = (
        f"{SUPABASE_URL}/rest/v1/diligence_audit"
        f"?month=eq.{target_month}&select=location_id,total_sales,cash_sales,discounted_cash,complimentary"
    )
    headers = {
        "apikey": SUPABASE_KEY,
        "Authorization": f"Bearer {SUPABASE_KEY}",
    }
    print(f"  Fetching Supabase diligence_audit…", end=" ", flush=True)
    raw = http_get(url, headers)
    rows = json.loads(raw.decode())
    print(f"{len(rows)} rows")

    result: dict[int, dict[str, float]] = {}
    for r in rows:
        result[r["location_id"]] = {
            "total_sales":    float(r.get("total_sales")    or 0),
            "cash_sales":     float(r.get("cash_sales")     or 0),
            "discounted_cash":float(r.get("discounted_cash") or 0),
            "complimentary":  float(r.get("complimentary")  or 0),
        }
    return result

# ── Step 3: reconcile and report ──────────────────────────────────────────────

def pct(num: float, denom: float) -> float:
    return round(num / denom * 100, 2) if denom else 0.0

def flag(csv_pct: float, db_pct: float, csv_eur: float, db_eur: float) -> str:
    pp_delta = abs(csv_pct - db_pct)
    eur_delta = abs(csv_eur - db_eur)
    if pp_delta > TOLERANCE_PP or eur_delta > TOLERANCE_EUR:
        return f"⚠  MISMATCH  (Δ {pp_delta:.2f}pp / Δ€{eur_delta:.0f})"
    return "✓ OK"

def reconcile(target_month: str) -> int:
    print(f"\nDiligence QC — {target_month}\n{'='*60}")

    csv_data, oa_data = compute_from_csv(target_month)
    dash_data = fetch_dashboard(target_month)

    all_locs  = sorted(set(csv_data) | set(dash_data))
    mismatches = 0

    metrics = [
        ("Cash Sales",       "cash",       "cash_sales"),
        ("Discounted Cash",  "disc_cash",  "discounted_cash"),
        ("Complimentary",    "comp",       "complimentary"),
    ]

    for metric_label, csv_key, db_key in metrics:
        print(f"\n── {metric_label} ──")
        print(f"{'Location':<14} {'DB EUR':>10} {'CSV EUR':>10} {'DB %':>7} {'CSV %':>7}  Status")
        print("-" * 70)

        for loc_id in all_locs:
            name = LOC_NAMES.get(loc_id, f"Loc{loc_id}")
            csv_row  = csv_data.get(loc_id,  {})
            dash_row = dash_data.get(loc_id, {})

            csv_eur  = csv_row.get(csv_key, 0.0)
            db_eur   = dash_row.get(db_key, 0.0)

            # Use each source's own total for % (DB uses accounting total_sales, CSV uses raw sum)
            csv_total = csv_row.get("total_sold", 0.0)
            db_total  = dash_row.get("total_sales", 0.0) or csv_total

            csv_p = pct(csv_eur, csv_total)
            db_p  = pct(db_eur,  db_total)
            status = flag(csv_p, db_p, csv_eur, db_eur)
            if "MISMATCH" in status:
                mismatches += 1

            print(f"{name:<14} {db_eur:>10,.2f} {csv_eur:>10,.2f} {db_p:>6.2f}% {csv_p:>6.2f}%  {status}")

    # Open Account summary — these are NOT in the main metrics but should be reviewed
    if oa_data:
        oa_total = sum(oa_data.values())
        print(f"\n── Open Account (NOT counted as complimentary — needs classification) ──")
        print(f"{'Location':<14} {'EUR':>10}  Note")
        print("-" * 55)
        for loc_id in sorted(oa_data):
            name = LOC_NAMES.get(loc_id, f"Loc{loc_id}")
            v = oa_data[loc_id]
            print(f"{name:<14} {v:>10,.2f}  → ask Ben: complimentary or hotel billing?")
        print(f"{'TOTAL':<14} {oa_total:>10,.2f}")

    print(f"\n{'='*60}")
    if mismatches == 0:
        print(f"✓  All metrics reconcile for {target_month}. No action required.")
    else:
        print(f"⚠  {mismatches} mismatch(es) found for {target_month}. Investigate above.")
    if oa_data:
        print(f"ℹ  Open Account rows found (€{sum(oa_data.values()):.0f} total) — not yet classified.")

    return 1 if mismatches else 0

# ── Entry point ────────────────────────────────────────────────────────────────

if __name__ == "__main__":
    if len(sys.argv) > 1:
        arg = sys.argv[1]
        # Accept YYYY-MM or YYYY-MM-01
        if len(arg) == 7:
            arg += "-01"
        target = arg
    else:
        # Default: most recent complete calendar month
        today = date.today()
        if today.month == 1:
            target = f"{today.year - 1}-12-01"
        else:
            target = f"{today.year}-{today.month - 1:02d}-01"

    sys.exit(reconcile(target))
