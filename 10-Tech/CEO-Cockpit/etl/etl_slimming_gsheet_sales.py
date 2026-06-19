"""
ETL: Slimming Treatments Google Sheet → Supabase slimming_sales_daily

Tab naming convention:  "Sales {MonthName} {YY}"  e.g. "Sales April 26"
Revenue source:         Column H (index 7) — the 8th column of each tab.
Sync strategy:          Delete all rows for the sheet_tab, then insert fresh rows.
"""

import sys, csv, io, re, json, os, argparse
from datetime import date
from pathlib import Path

sys.stdout.reconfigure(encoding="utf-8", errors="replace")
sys.stderr.reconfigure(encoding="utf-8", errors="replace")

try:
    from dotenv import load_dotenv
    import requests as _req
except ImportError:
    import subprocess
    subprocess.check_call([sys.executable, "-m", "pip", "install", "python-dotenv", "requests"])
    from dotenv import load_dotenv
    import requests as _req

load_dotenv(Path(__file__).resolve().parents[1] / ".env.local")
load_dotenv(Path(__file__).resolve().parents[3] / ".env")

# ── Constants ──────────────────────────────────────────────────────────────────

SHEET_ID = "1j6tz8k8TRSulB35Sg4X1xSlcV_JLf-8QKx-32UUkoBc"
VAT_RATE  = 0.18

MONTH_NAMES = [
    "January","February","March","April","May","June",
    "July","August","September","October","November","December",
]

# Column name that holds the sales amount (inc-VAT) in each monthly tab
PRICE_COL = "Paid"


# ── Tab name candidates for a given month ──────────────────────────────────────

def tab_names_for_month(year: int, month: int) -> list[str]:
    """Return candidate tab names to try, in priority order."""
    m = MONTH_NAMES[month - 1]
    yy   = str(year)[2:]   # e.g. "26"
    yyyy = str(year)        # e.g. "2026"
    return [
        f"Sales {m} {yy}",    # preferred: "Sales April 26"
        f"Sales {m} {yyyy}",  # fallback:  "Sales April 2026"
        f"Sales {m.lower()} {yy}",
        f"Sales {m.upper()} {yy}",
    ]


# ── Sheet fetch ────────────────────────────────────────────────────────────────

def fetch_by_name(tab_name: str) -> tuple[list[str], list[list[str]]]:
    """
    Fetch a tab by its name via the gviz CSV endpoint.
    Returns (headers, data_rows) as lists, or ([], []) if not found.
    """
    url = (
        f"https://docs.google.com/spreadsheets/d/{SHEET_ID}"
        f"/gviz/tq?tqx=out:csv&sheet={_req.utils.quote(tab_name)}"
    )
    try:
        resp = _req.get(url, timeout=20)
        if resp.status_code in (400, 404):
            return [], []
        resp.raise_for_status()
        all_rows = list(csv.reader(io.StringIO(resp.text)))
        if not all_rows:
            return [], []
        headers = all_rows[0]
        # Guard: gviz silently returns the first sheet when the name doesn't
        # match. Reject the result if the "Paid" column isn't present.
        if not any(h.strip().lower() == PRICE_COL.lower() for h in headers):
            return [], []
        return headers, all_rows[1:]
    except Exception:
        return [], []


# ── Date parsing ───────────────────────────────────────────────────────────────

def parse_date(raw: str) -> date | None:
    raw = raw.strip()
    if not raw:
        return None
    raw = re.sub(r"(\d+)(st|nd|rd|th)\b", r"\1", raw, flags=re.I)

    # D/M/YYYY  or  D-M-YYYY  (4-digit year)
    m = re.match(r"^(\d{1,2})[/\-.](\d{1,2})[/\-.](\d{4})$", raw)
    if m:
        try:
            return date(int(m.group(3)), int(m.group(2)), int(m.group(1)))
        except ValueError:
            pass

    # D/M/YY  or  D-M-YY  (2-digit year — "Sales April 26" style sheets)
    m = re.match(r"^(\d{1,2})[/\-.](\d{1,2})[/\-.](\d{2})$", raw)
    if m:
        try:
            return date(2000 + int(m.group(3)), int(m.group(2)), int(m.group(1)))
        except ValueError:
            pass

    return None


# ── Price parsing ──────────────────────────────────────────────────────────────

def parse_price(raw: str) -> float | None:
    if not raw or raw.strip() in ("", "-", "—"):
        return None
    cleaned = raw.replace("€","").replace("$","").replace("£","").replace(",","").strip()
    try:
        val = float(cleaned)
        return val if val >= 0 else None
    except ValueError:
        return None


# ── Column lookup by header name ───────────────────────────────────────────────

def make_col_fn(headers: list[str], row: list[str]):
    """Return a helper that looks up a cell by header name (case-insensitive)."""
    header_index = {h.strip().lower(): i for i, h in enumerate(headers)}
    def col(*keys: str) -> str:
        for k in keys:
            idx = header_index.get(k.lower())
            if idx is not None and idx < len(row) and row[idx].strip():
                return row[idx].strip()
        return ""
    return col


# ── Process rows from a tab ────────────────────────────────────────────────────

def process_rows(
    tab_name: str,
    headers: list[str],
    data_rows: list[list[str]],
    year: int,
    month: int,
) -> list[dict]:
    month_key = date(year, month, 1).isoformat()
    results: list[dict] = []
    last_date: date | None = None

    for row in data_rows:
        col = make_col_fn(headers, row)

        date_raw  = col("Date")
        client    = col("Client") or None
        treatment = col("Treatment", "Treatments") or None
        therapist = col("Therapist") or None

        # Sales amount comes from the "Paid" column
        price_raw = col(PRICE_COL)
        price = parse_price(price_raw)

        # Skip rows with no client and no treatment
        if not client and not treatment:
            continue
        # Skip rows with no price and no meaningful content
        if price is None and not treatment:
            continue
        # Rows labelled "total" in therapist are data-entry artefacts
        if therapist and "total" in therapist.lower():
            therapist = None

        revenue = price or 0.0

        # Date carry-forward (some sheets group same-day rows with blank date)
        parsed = parse_date(date_raw)
        if parsed:
            last_date = parsed
        svc_date = last_date

        # Only keep rows belonging to this month
        if svc_date and (svc_date.year != year or svc_date.month != month):
            continue

        price_ex = round(revenue / (1 + VAT_RATE), 2) if revenue > 0 else 0.0

        results.append({
            "sheet_tab":           tab_name,
            "month":               month_key,
            "date_of_service":     svc_date.isoformat() if svc_date else None,
            "client":              client,
            "service_type":        "treatment",
            "service_description": treatment,
            "full_price":          round(revenue, 2),
            "paid":                round(revenue, 2),
            "vat_rate":            VAT_RATE,
            "price_ex_vat":        price_ex,
            "sales_staff":         therapist,
        })

    return results


# ── Supabase helpers ───────────────────────────────────────────────────────────

def _sb_headers() -> dict:
    key = os.environ["SUPABASE_SERVICE_ROLE_KEY"]
    return {
        "apikey":        key,
        "Authorization": f"Bearer {key}",
        "Content-Type":  "application/json",
    }

def _sb_base() -> str:
    return os.environ.get("SUPABASE_URL") or os.environ["NEXT_PUBLIC_SUPABASE_URL"]


def delete_month(month_key: str) -> None:
    """Delete ALL rows for a month regardless of sheet_tab name.
    This clears out stale GID-tagged rows from old ETL runs before inserting fresh data."""
    resp = _req.delete(
        f"{_sb_base()}/rest/v1/slimming_sales_daily",
        headers=_sb_headers(),
        params={"month": f"eq.{month_key}"},
        timeout=30,
    )
    resp.raise_for_status()


def insert_rows(rows: list[dict]) -> int:
    if not rows:
        return 0
    CHUNK = 200
    total = 0
    for i in range(0, len(rows), CHUNK):
        resp = _req.post(
            f"{_sb_base()}/rest/v1/slimming_sales_daily",
            headers={**_sb_headers(), "Prefer": "return=minimal"},
            json=rows[i : i + CHUNK],
            timeout=30,
        )
        resp.raise_for_status()
        total += len(rows[i : i + CHUNK])
    return total


# ── Main run ───────────────────────────────────────────────────────────────────

def months_in_range(date_from: date, date_to: date) -> list[tuple[int, int]]:
    months = []
    y, m = date_from.year, date_from.month
    while (y, m) <= (date_to.year, date_to.month):
        months.append((y, m))
        m += 1
        if m > 12:
            m, y = 1, y + 1
    return months


def run(date_from: str, date_to: str) -> dict:
    d_from = date.fromisoformat(date_from)
    d_to   = date.fromisoformat(date_to)
    target_months = months_in_range(d_from, d_to)

    total_rows = 0
    processed  = []

    for year, month in target_months:
        label = f"{MONTH_NAMES[month-1]} {year}"
        candidates = tab_names_for_month(year, month)

        headers, data_rows = [], []
        matched_name = None

        for candidate in candidates:
            h, d = fetch_by_name(candidate)
            if h and d:
                headers, data_rows = h, d
                matched_name = candidate
                print(f"  {label}: found tab '{candidate}'")
                break

        if not matched_name:
            print(f"  {label}: no tab found (tried {candidates}) — skipping")
            continue

        rows = process_rows(matched_name, headers, data_rows, year, month)

        if not rows:
            print(f"  {label} ('{matched_name}'): 0 usable rows — skipping")
            continue

        paid_total   = sum(r["full_price"]   for r in rows)
        ex_vat_total = sum(r["price_ex_vat"] for r in rows)
        print(f"    Paid (inc-VAT) total from sheet : €{paid_total:,.2f}")
        print(f"    Revenue ex-VAT (÷1.18)          : €{ex_vat_total:,.2f}")
        print(f"    Rows captured                   : {len(rows)}")

        month_key = rows[0]["month"]
        delete_month(month_key)
        n = insert_rows(rows)
        total_rows += n
        processed.append(matched_name)
        print(f"  {label} ('{matched_name}'): {n} rows inserted")

    print(f"\nDone — {total_rows} total rows inserted across {len(processed)} tab(s).")
    return {"rows_inserted": total_rows, "tabs": processed}


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--date-from", required=True)
    parser.add_argument("--date-to",   required=True)
    args = parser.parse_args()
    result = run(args.date_from, args.date_to)
    print(json.dumps(result, indent=2))
