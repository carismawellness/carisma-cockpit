"""
ETL: Aesthetics Sales Google Sheet → Supabase aesthetics_sales_daily

Reads each "Sale MONTH YEAR" tab from the public Google Sheet.
VAT rules (applied to Price column which is inc-VAT):
  - Note column contains "Francesca" or "Giovanni" → 12% VAT
  - All others → 18% VAT
Date format: D/M/YYYY or D/M (day-first Maltese format); year/month inferred
from tab name when missing.

Sync strategy: delete all rows for the tab, then insert fresh rows.
This means all fields are always fresh — no partial overwrites.
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

SHEET_ID = "1Mr_aRRbRf3ex--WmUJIqXwko7okCyD82KxBOXWYnW24"

LOW_VAT_PERSONS = {"francesca", "giovanni", "kendra"}   # 12% VAT
DEFAULT_VAT     = 0.18
LOW_VAT         = 0.12

MONTH_NAMES = [
    "January","February","March","April","May","June",
    "July","August","September","October","November","December",
]

# ── Google OAuth access token ──────────────────────────────────────────────────

_CACHED_ACCESS_TOKEN: str | None = None

def _get_access_token() -> str | None:
    """Exchange stored refresh token for a short-lived access token (cached per run)."""
    global _CACHED_ACCESS_TOKEN
    if _CACHED_ACCESS_TOKEN:
        return _CACHED_ACCESS_TOKEN
    client_id     = os.environ.get("GOOGLE_SHEETS_CLIENT_ID")     or os.environ.get("GOOGLE_CLIENT_ID")
    client_secret = os.environ.get("GOOGLE_SHEETS_CLIENT_SECRET") or os.environ.get("GOOGLE_CLIENT_SECRET")
    refresh_token = os.environ.get("GOOGLE_SHEETS_REFRESH_TOKEN") or os.environ.get("GOOGLE_REFRESH_TOKEN")
    if not all([client_id, client_secret, refresh_token]):
        print("  Warning: Google OAuth credentials not found in env — cannot access private sheet")
        return None
    try:
        import urllib.request, urllib.parse as _uparse
        data = _uparse.urlencode({
            "client_id":     client_id,
            "client_secret": client_secret,
            "refresh_token": refresh_token,
            "grant_type":    "refresh_token",
        }).encode()
        req  = urllib.request.Request(
            "https://oauth2.googleapis.com/token",
            data=data,
            method="POST",
        )
        with urllib.request.urlopen(req, timeout=30) as resp:
            token_data = json.loads(resp.read().decode())
        _CACHED_ACCESS_TOKEN = token_data.get("access_token")
        if _CACHED_ACCESS_TOKEN:
            print("  Google OAuth token obtained.")
        return _CACHED_ACCESS_TOKEN
    except Exception as exc:
        print(f"  Warning: could not obtain Google access token: {exc}")
        return None


# ── Sheet helpers ──────────────────────────────────────────────────────────────

def tab_name_for(year: int, month: int) -> str:
    return f"Sale {MONTH_NAMES[month - 1]} {year}"


def fetch_tab(tab: str) -> list[dict]:
    """Fetch a Google Sheet tab via Sheets API v4 (supports OAuth for private sheets)."""
    import urllib.parse
    token = _get_access_token()
    if not token:
        raise RuntimeError(
            "No Google OAuth token available — set GOOGLE_SHEETS_CLIENT_ID, "
            "GOOGLE_SHEETS_CLIENT_SECRET and GOOGLE_SHEETS_REFRESH_TOKEN in .env"
        )
    # Sheets API v4: get all values from the tab (columns A–Z)
    range_param = urllib.parse.quote(f"'{tab}'!A:Z")
    url = (
        f"https://sheets.googleapis.com/v4/spreadsheets/{SHEET_ID}"
        f"/values/{range_param}"
    )
    resp = _req.get(url, headers={"Authorization": f"Bearer {token}"}, timeout=30)
    if resp.status_code == 404:
        return []
    resp.raise_for_status()
    data = resp.json()
    values = data.get("values", [])
    if len(values) < 2:
        return []
    # Convert rows to list-of-dicts using first row as header
    headers_row = [str(h).strip().lower() for h in values[0]]
    rows = []
    for row in values[1:]:
        # Pad short rows
        padded = row + [""] * (len(headers_row) - len(row))
        rows.append(dict(zip(headers_row, padded)))
    return rows


# ── Date parsing (fuzzy, day-first) ───────────────────────────────────────────

def parse_date(raw: str, fallback_year: int, fallback_month: int) -> date | None:
    raw = raw.strip()
    if not raw:
        return None
    # Strip ordinal suffixes (1st, 2nd, 3rd, 4th …)
    raw = re.sub(r"(\d+)(st|nd|rd|th)\b", r"\1", raw, flags=re.I)

    # D/M/YYYY or D-M-YYYY or D.M.YYYY
    m = re.match(r"^(\d{1,2})[/\-.\\](\d{1,2})[/\-.\\](\d{4})$", raw)
    if m:
        try:
            return date(int(m.group(3)), int(m.group(2)), int(m.group(1)))
        except ValueError:
            pass

    # D/M (no year — infer from tab)
    m = re.match(r"^(\d{1,2})[/\-.\\](\d{1,2})$", raw)
    if m:
        try:
            return date(fallback_year, int(m.group(2)), int(m.group(1)))
        except ValueError:
            pass

    # Plain day number — infer month and year from tab
    m = re.match(r"^(\d{1,2})$", raw)
    if m:
        try:
            return date(fallback_year, fallback_month, int(m.group(1)))
        except ValueError:
            pass

    # "5 April" or "April 5" text format
    for idx, mn in enumerate(MONTH_NAMES, 1):
        for pat in [rf"^{mn[:3]}\w*\s+(\d{{1,2}})", rf"^(\d{{1,2}})\s+{mn[:3]}\w*"]:
            mo = re.search(pat, raw, re.I)
            if mo:
                try:
                    return date(fallback_year, idx, int(mo.group(1)))
                except ValueError:
                    pass

    return None


# ── VAT logic ─────────────────────────────────────────────────────────────────

def get_vat_rate(note_person: str | None) -> float:
    if note_person and note_person.strip().lower() in LOW_VAT_PERSONS:
        return LOW_VAT
    return DEFAULT_VAT


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


def delete_tab(tab: str) -> None:
    import urllib.parse
    resp = _req.delete(
        f"{_sb_base()}/rest/v1/aesthetics_sales_daily",
        headers=_sb_headers(),
        params={"sheet_tab": f"eq.{tab}"},
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
            f"{_sb_base()}/rest/v1/aesthetics_sales_daily",
            headers={**_sb_headers(), "Prefer": "return=minimal"},
            json=rows[i : i + CHUNK],
            timeout=30,
        )
        resp.raise_for_status()
        total += len(rows[i : i + CHUNK])
    return total


# ── Tab processor ──────────────────────────────────────────────────────────────

def process_tab(tab: str, year: int, month: int) -> list[dict]:
    raw_rows = fetch_tab(tab)
    if not raw_rows:
        return []

    month_key = date(year, month, 1).isoformat()
    results: list[dict] = []

    for row in raw_rows:
        # Normalise header variants (sheet has typos: "Costumer", "Sales Staf")
        def col(*keys: str) -> str:
            for k in keys:
                v = row.get(k, "")
                if v:
                    return str(v).strip()
            return ""

        invoice      = col("invoice")      or None
        customer     = col("costumer", "customer") or None
        service      = col("service / products", "service/products") or None
        date_raw     = col("date of service")
        price_raw    = col("paid")
        payment      = col("payment")      or None
        sales_staff  = col("sales staf", "sales staff") or None
        note         = col("note")

        # Skip rows with no price
        if not price_raw or price_raw.strip() in ("", "-"):
            continue
        try:
            price_inc = abs(float(
                price_raw.replace("€", "").replace("$", "").replace(",", "").strip()
            ))
        except ValueError:
            continue
        if price_inc == 0:
            continue

        note_person  = note.strip() or None

        # Skip summary/total rows: note says "total", or no identifying fields at all
        if note_person and note_person.lower() == "total":
            continue
        if not customer and not service and not invoice:
            continue

        rate         = get_vat_rate(note_person)
        price_ex     = round(price_inc / (1 + rate), 2)
        svc_date     = parse_date(date_raw, year, month)

        results.append({
            "sheet_tab":       tab,
            "month":           month_key,
            "date_of_service": svc_date.isoformat() if svc_date else None,
            "invoice":         invoice,
            "customer":        customer,
            "service_product": service,
            "price_inc_vat":   round(price_inc, 2),
            "vat_rate":        rate,
            "price_ex_vat":    price_ex,
            "payment_method":  payment,
            "sales_staff":     sales_staff,
            "note_person":     note_person,
        })

    return results


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
    months = months_in_range(d_from, d_to)

    total_rows = 0
    processed  = []

    for year, month in months:
        tab = tab_name_for(year, month)
        print(f"Fetching {tab}…", flush=True)
        rows = process_tab(tab, year, month)
        if not rows:
            print(f"  {tab}: not found or empty — skipping")
            continue
        delete_tab(tab)
        n = insert_rows(rows)
        total_rows += n
        processed.append(tab)
        print(f"  {tab}: {n} rows inserted")

    print(f"\nDone — {total_rows} total rows inserted across {len(processed)} tab(s).")
    return {"rows_inserted": total_rows, "tabs": processed}


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--date-from", required=True)
    parser.add_argument("--date-to",   required=True)
    args = parser.parse_args()
    result = run(args.date_from, args.date_to)
    print(json.dumps(result, indent=2))
