"""
EBIDA Layer v2 — All-brand daily database → Google Sheets

Rows  = line items, grouped by brand section (SPA / Aesthetics / Slimming / Shared)
Cols  = one per calendar day from --date-from to --date-to + TOTAL column

SPA         : All Zoho Books SPA org accounts (income + expense), monthly amount
              placed in the 1st-of-month column.
Aesthetics  : Revenue row (daily totals from aesthetics_sales_daily),
              Cash Salary row (monthly supplement), Zoho expense accounts.
Slimming    : Revenue row (daily totals from slimming_sales_daily),
              Cash Salary row (monthly supplement), Zoho expense accounts.
Shared      : Zoho Aesthetics org accounts with no brand attribution.

Usage:
    cd etl
    py etl_ebida_layer_v2.py
    py etl_ebida_layer_v2.py --date-from 2025-01-01 --date-to 2026-05-31
    py etl_ebida_layer_v2.py --dry-run
"""

import sys, os, argparse, calendar, json, time
from datetime import date, timedelta
from pathlib import Path
from collections import defaultdict

sys.stdout.reconfigure(encoding="utf-8", errors="replace")
sys.stderr.reconfigure(encoding="utf-8", errors="replace")

try:
    from dotenv import load_dotenv
    import requests
except ImportError:
    import subprocess
    subprocess.check_call([sys.executable, "-m", "pip", "install", "python-dotenv", "requests"])
    from dotenv import load_dotenv
    import requests

load_dotenv(Path(__file__).resolve().parents[3] / ".env")
load_dotenv(Path(__file__).resolve().parents[1] / ".env.local")

from zoho_books_client import ZohoBooksClient
from etl_zoho_spa_raw_layer import (
    fetch_month_raw, _walk_account_txns, _SUBSECTION_TYPES,
    _get_google_access_token, _get_or_create_sheet, _clear_tab,
    _write_values, SPREADSHEET_ID, SHEET_TAB_NAME,
)

# ── Constants ─────────────────────────────────────────────────────────────────

LOCATION_NAMES = {
    1: "InterContinental", 2: "Hugos", 3: "Hyatt",
    4: "Ramla Bay", 5: "Labranda", 6: "Sunny Coast",
    7: "Excelsior", 8: "Novotel",
}

# Keywords to detect which Aesthetics-org account belongs to which brand
_AESTH_KEYWORDS  = ["aesthetics", "aesthetic", " aest ", "clinic"]
_SLIM_KEYWORDS   = ["slimming", "slim ", "weight loss", "weight-loss"]

# Column metadata count (frozen pane up to col E)
META_COLS = ["Brand", "Line Item", "Account Code", "EBITDA Category", "Granularity"]

# Section sort within each brand
_SECTION_ORDER = {"Income": 0, "Other Income": 1, "COGS": 2,
                  "Expense": 3, "Other Expense": 4}


# ── Date helpers ──────────────────────────────────────────────────────────────

def all_days(start: date, end: date) -> list[str]:
    days, d = [], start
    while d <= end:
        days.append(d.isoformat())
        d += timedelta(days=1)
    return days


def month_first(year: int, month: int) -> str:
    return f"{year}-{month:02d}-01"


def last_day(year: int, month: int) -> str:
    return f"{year}-{month:02d}-{calendar.monthrange(year, month)[1]:02d}"


def iter_months(df: date, dt: date):
    y, m = df.year, df.month
    while (y, m) <= (dt.year, dt.month):
        yield y, m
        m += 1
        if m > 12:
            m, y = 1, y + 1


def month_label(year: int, month: int) -> str:
    return f"{date(year, month, 1).strftime('%b')}-{str(year)[2:]}"


# ── Supabase helpers ──────────────────────────────────────────────────────────

def _supa_headers() -> dict:
    key = os.environ["SUPABASE_SERVICE_ROLE_KEY"]
    return {"apikey": key, "Authorization": f"Bearer {key}"}


def _supa_url(table: str) -> str:
    base = os.environ.get("SUPABASE_URL") or os.environ["NEXT_PUBLIC_SUPABASE_URL"]
    return f"{base}/rest/v1/{table}"


def supa_fetch_all(table: str, params: dict) -> list[dict]:
    """Fetch all rows, paginating in chunks of 1000."""
    rows, offset, limit = [], 0, 1000
    while True:
        hdrs = {**_supa_headers(), "Range-Unit": "items",
                "Range": f"{offset}-{offset + limit - 1}"}
        resp = requests.get(_supa_url(table), headers=hdrs, params=params, timeout=30)
        resp.raise_for_status()
        chunk = resp.json()
        rows.extend(chunk)
        if len(chunk) < limit:
            break
        offset += limit
    return rows


# ── Dept detection ────────────────────────────────────────────────────────────

def _detect_dept(name: str) -> str | None:
    low = f" {name.lower()} "
    if any(kw in low for kw in _AESTH_KEYWORDS):
        return "aesthetics"
    if any(kw in low for kw in _SLIM_KEYWORDS):
        return "slimming"
    return None


# ── Row builder ───────────────────────────────────────────────────────────────

class Row:
    """A single row in the output sheet."""
    __slots__ = ("brand", "label", "account_code", "ebitda_cat", "granularity",
                 "section_order", "name_sort", "data", "is_header", "is_subtotal")

    def __init__(self, brand: str, label: str, account_code: str = "",
                 ebitda_cat: str = "", granularity: str = "Monthly",
                 section_order: int = 9, is_header: bool = False,
                 is_subtotal: bool = False):
        self.brand        = brand
        self.label        = label
        self.account_code = account_code
        self.ebitda_cat   = ebitda_cat
        self.granularity  = granularity
        self.section_order = section_order
        self.name_sort    = label.lower()
        self.data: dict[str, float] = {}   # {date_str: amount}
        self.is_header    = is_header
        self.is_subtotal  = is_subtotal

    def set(self, date_str: str, amount: float):
        if amount:
            self.data[date_str] = self.data.get(date_str, 0.0) + amount

    def total(self) -> float:
        return round(sum(self.data.values()), 2)


# ── Data fetchers ─────────────────────────────────────────────────────────────

def fetch_spa_zoho(months: list[tuple[int, int]]) -> list[Row]:
    """Fetch raw SPA Zoho P&L for all months. Monthly total → 1st of month."""
    print("\n[SPA — Zoho Books] Fetching P&L accounts...")
    client = ZohoBooksClient(org="spa")

    # {(code, name, section): Row}
    row_map: dict[tuple, Row] = {}

    for y, m in months:
        lbl = month_label(y, m)
        print(f"  {lbl}...", end=" ", flush=True)
        try:
            accounts = fetch_month_raw(client, f"{y}-{m:02d}-01", last_day(y, m))
        except Exception as e:
            print(f"ERROR {e}")
            continue
        non_zero = [a for a in accounts if a["amount"] > 0]
        print(f"{len(non_zero)} accounts")
        date_key = month_first(y, m)
        for acc in non_zero:
            key = (acc["code"], acc["name"], acc["section"])
            if key not in row_map:
                sec_ord = _SECTION_ORDER.get(acc["section"], 9)
                row_map[key] = Row(
                    brand="SPA", label=acc["name"],
                    account_code=acc["code"], ebitda_cat=acc["section"],
                    granularity="Monthly", section_order=sec_ord,
                )
            row_map[key].set(date_key, acc["amount"])

    return list(row_map.values())


def fetch_aesth_zoho(months: list[tuple[int, int]]) -> tuple[list[Row], list[Row], list[Row]]:
    """
    Fetch Aesthetics org P&L. Split accounts by label into:
    - aesthetics_rows, slimming_rows, shared_rows
    Monthly total → 1st of month.
    """
    print("\n[Aesthetics+Slimming — Zoho Books] Fetching P&L accounts...")
    client = ZohoBooksClient(org="aesthetics")

    aesth_map:  dict[tuple, Row] = {}
    slim_map:   dict[tuple, Row] = {}
    shared_map: dict[tuple, Row] = {}

    for y, m in months:
        lbl = month_label(y, m)
        print(f"  {lbl}...", end=" ", flush=True)
        try:
            accounts = fetch_month_raw(client, f"{y}-{m:02d}-01", last_day(y, m))
        except Exception as e:
            print(f"ERROR {e}")
            continue
        non_zero = [a for a in accounts if a["amount"] > 0]
        print(f"{len(non_zero)} accounts")
        date_key = month_first(y, m)

        for acc in non_zero:
            dept = _detect_dept(acc["name"])
            sec_ord = _SECTION_ORDER.get(acc["section"], 9)
            key = (acc["code"], acc["name"], acc["section"])

            if dept == "aesthetics":
                target = aesth_map
                brand  = "Aesthetics"
            elif dept == "slimming":
                target = slim_map
                brand  = "Slimming"
            else:
                target = shared_map
                brand  = "Shared"

            if key not in target:
                target[key] = Row(
                    brand=brand, label=acc["name"],
                    account_code=acc["code"], ebitda_cat=acc["section"],
                    granularity="Monthly", section_order=sec_ord,
                )
            target[key].set(date_key, acc["amount"])

    return list(aesth_map.values()), list(slim_map.values()), list(shared_map.values())


def fetch_aesthetics_daily(date_from: date, date_to: date) -> Row:
    """Fetch Aesthetics daily revenue from Supabase aesthetics_sales_daily."""
    print("\n[Aesthetics — Sales Sheet] Fetching daily revenue from Supabase...")
    row = Row(brand="Aesthetics", label="Revenue", ebitda_cat="Revenue",
              granularity="Daily", section_order=0)
    try:
        records = supa_fetch_all("aesthetics_sales_daily", {
            "select":           "date_of_service,price_ex_vat",
            "date_of_service":  f"gte.{date_from.isoformat()}",
        })
        for r in records:
            d   = str(r.get("date_of_service") or "")[:10]
            amt = float(r.get("price_ex_vat") or 0)
            if d and amt:
                row.set(d, amt)
        print(f"  {len(records)} transactions → {sum(1 for v in row.data.values() if v)} active days")
    except Exception as e:
        print(f"  ERROR: {e}")
    return row


def fetch_slimming_daily(date_from: date, date_to: date) -> Row:
    """Fetch Slimming daily revenue from Supabase slimming_sales_daily."""
    print("[Slimming — Sales Sheet] Fetching daily revenue from Supabase...")
    row = Row(brand="Slimming", label="Revenue", ebitda_cat="Revenue",
              granularity="Daily", section_order=0)
    try:
        records = supa_fetch_all("slimming_sales_daily", {
            "select":           "date_of_service,price_ex_vat",
            "date_of_service":  f"gte.{date_from.isoformat()}",
        })
        for r in records:
            d   = str(r.get("date_of_service") or "")[:10]
            amt = float(r.get("price_ex_vat") or 0)
            if d and amt:
                row.set(d, amt)
        print(f"  {len(records)} transactions → {sum(1 for v in row.data.values() if v)} active days")
    except Exception as e:
        print(f"  ERROR: {e}")
    return row


def fetch_salary_supplements(months: list[tuple[int, int]]) -> tuple[Row, Row]:
    """Fetch salary_supplement_monthly for aesthetics + slimming slugs."""
    print("[Salary Supplements] Fetching from Supabase...")
    aesth_row = Row(brand="Aesthetics", label="Cash Salary (Supplement)",
                    ebitda_cat="Wages & Salaries", granularity="Monthly", section_order=1)
    slim_row  = Row(brand="Slimming",   label="Cash Salary (Supplement)",
                    ebitda_cat="Wages & Salaries", granularity="Monthly", section_order=1)
    try:
        records = supa_fetch_all("salary_supplement_monthly", {
            "select": "month,spa_slug,amount,is_frozen",
        })
        for r in records:
            slug = (r.get("spa_slug") or "").lower()
            amt  = float(r.get("amount") or 0)
            month_key = str(r.get("month") or "")[:10]
            if not month_key or amt == 0:
                continue
            if slug == "aesthetics":
                aesth_row.set(month_key, amt)
            elif slug == "slimming":
                slim_row.set(month_key, amt)
        print(f"  Aesthetics supplement total: €{aesth_row.total():,.2f}")
        print(f"  Slimming supplement total:   €{slim_row.total():,.2f}")
    except Exception as e:
        print(f"  ERROR (supplements): {e}")
    return aesth_row, slim_row


# ── Sheet assembly ────────────────────────────────────────────────────────────

def section_header(brand: str) -> Row:
    r = Row(brand=brand, label=brand, is_header=True,
            ebitda_cat="", granularity="", section_order=-1)
    return r


def subtotal_row(brand: str, label: str, rows: list[Row],
                 days: list[str]) -> Row:
    r = Row(brand=brand, label=label, is_subtotal=True,
            ebitda_cat="", granularity="")
    for row in rows:
        for d, v in row.data.items():
            r.set(d, v)
    return r


def sort_data_rows(rows: list[Row]) -> list[Row]:
    return sorted(rows, key=lambda r: (r.section_order, r.name_sort))


def build_output(days: list[str], spa_rows: list[Row],
                 aesth_revenue: Row, aesth_salary: Row, aesth_cost: list[Row],
                 slim_revenue: Row, slim_salary: Row, slim_cost: list[Row],
                 shared_rows: list[Row]) -> list[list]:
    """Assemble the full 2-D matrix (header row + data rows)."""

    # ── Header ────────────────────────────────────────────────────────────────
    # Date headers formatted as dd-Mon-yy for readability
    def fmt_day(d: str) -> str:
        dt = date.fromisoformat(d)
        return dt.strftime("%-d %b %y") if sys.platform != "win32" else dt.strftime("%#d %b %y")

    header = [*META_COLS, *[fmt_day(d) for d in days], "TOTAL"]
    matrix = [header]

    def add_section(brand: str, data_rows: list[Row],
                    extra_top: list[Row] | None = None):
        # Section header row
        h = [""] * (len(META_COLS) + len(days) + 1)
        h[0] = brand.upper()
        matrix.append(h)

        # Extra rows at top of section (Revenue, Cash Salary)
        for row in (extra_top or []):
            matrix.append(make_row(row))

        # Data rows sorted
        for row in sort_data_rows(data_rows):
            matrix.append(make_row(row))

    def make_row(row: Row) -> list:
        if row.is_header:
            r = [""] * (len(META_COLS) + len(days) + 1)
            r[0] = row.brand.upper()
            return r
        vals = [row.data.get(d, "") for d in days]
        # Replace 0.0 with "" to keep the sheet clean
        vals = [v if v else "" for v in vals]
        total = row.total()
        return [
            row.brand,
            row.label,
            row.account_code,
            row.ebitda_cat,
            row.granularity,
            *vals,
            total if total else "",
        ]

    # SPA
    add_section("SPA", sort_data_rows(spa_rows))

    # Aesthetics
    add_section(
        "Aesthetics",
        sort_data_rows(aesth_cost),
        extra_top=[aesth_revenue, aesth_salary],
    )

    # Slimming
    add_section(
        "Slimming",
        sort_data_rows(slim_cost),
        extra_top=[slim_revenue, slim_salary],
    )

    # Shared (Aesthetics org accounts with no brand label)
    if shared_rows:
        add_section("Shared (Aesthetics + Slimming)", sort_data_rows(shared_rows))

    return matrix


# ── Formatting ────────────────────────────────────────────────────────────────

def apply_formatting(sheet_id: int, matrix: list[list], num_days: int,
                     section_header_rows: list[int]) -> None:
    """Apply header freeze, bold section headers, column widths, number format."""
    total_cols = len(META_COLS) + num_days + 1
    reqs = []

    # Freeze row 0 + first 5 meta columns
    reqs.append({"updateSheetProperties": {
        "properties": {"sheetId": sheet_id,
                       "gridProperties": {"frozenRowCount": 1, "frozenColumnCount": 5}},
        "fields": "gridProperties.frozenRowCount,gridProperties.frozenColumnCount"
    }})

    # Header row — dark bg, white bold
    reqs.append({"repeatCell": {
        "range": {"sheetId": sheet_id, "startRowIndex": 0, "endRowIndex": 1,
                  "startColumnIndex": 0, "endColumnIndex": total_cols},
        "cell": {"userEnteredFormat": {
            "backgroundColor": {"red": 0.13, "green": 0.13, "blue": 0.13},
            "textFormat": {"bold": True, "fontSize": 9,
                           "foregroundColor": {"red": 1, "green": 1, "blue": 1}},
            "horizontalAlignment": "CENTER",
        }},
        "fields": "userEnteredFormat(backgroundColor,textFormat,horizontalAlignment)"
    }})

    # Section header rows — teal background, white bold
    for row_idx in section_header_rows:
        reqs.append({"repeatCell": {
            "range": {"sheetId": sheet_id,
                      "startRowIndex": row_idx, "endRowIndex": row_idx + 1,
                      "startColumnIndex": 0, "endColumnIndex": total_cols},
            "cell": {"userEnteredFormat": {
                "backgroundColor": {"red": 0.10, "green": 0.35, "blue": 0.40},
                "textFormat": {"bold": True, "fontSize": 10,
                               "foregroundColor": {"red": 1, "green": 1, "blue": 1}},
            }},
            "fields": "userEnteredFormat(backgroundColor,textFormat)"
        }})

    # Number format for data cells (cols 5 → end)
    reqs.append({"repeatCell": {
        "range": {"sheetId": sheet_id,
                  "startRowIndex": 1, "endRowIndex": len(matrix),
                  "startColumnIndex": 5, "endColumnIndex": total_cols},
        "cell": {"userEnteredFormat": {
            "numberFormat": {"type": "NUMBER", "pattern": "#,##0.00"},
            "horizontalAlignment": "RIGHT",
        }},
        "fields": "userEnteredFormat(numberFormat,horizontalAlignment)"
    }})

    # Column widths: meta cols wider, day cols narrow
    meta_widths = [90, 260, 85, 120, 70]
    for i, w in enumerate(meta_widths):
        reqs.append({"updateDimensionProperties": {
            "range": {"sheetId": sheet_id, "dimension": "COLUMNS",
                      "startIndex": i, "endIndex": i + 1},
            "properties": {"pixelSize": w}, "fields": "pixelSize"
        }})
    # Day columns — 62px each
    reqs.append({"updateDimensionProperties": {
        "range": {"sheetId": sheet_id, "dimension": "COLUMNS",
                  "startIndex": 5, "endIndex": 5 + num_days},
        "properties": {"pixelSize": 62}, "fields": "pixelSize"
    }})
    # Total column
    reqs.append({"updateDimensionProperties": {
        "range": {"sheetId": sheet_id, "dimension": "COLUMNS",
                  "startIndex": 5 + num_days, "endIndex": 5 + num_days + 1},
        "properties": {"pixelSize": 90}, "fields": "pixelSize"
    }})
    # Row heights — compact
    reqs.append({"updateDimensionProperties": {
        "range": {"sheetId": sheet_id, "dimension": "ROWS",
                  "startIndex": 0, "endIndex": len(matrix)},
        "properties": {"pixelSize": 20}, "fields": "pixelSize"
    }})

    hdrs = {"Authorization": f"Bearer {_get_google_access_token()}",
            "Content-Type": "application/json"}
    requests.post(
        f"https://sheets.googleapis.com/v4/spreadsheets/{SPREADSHEET_ID}:batchUpdate",
        headers=hdrs, json={"requests": reqs}, timeout=30,
    ).raise_for_status()


# ── Main ──────────────────────────────────────────────────────────────────────

def main():
    today = date.today()
    parser = argparse.ArgumentParser(
        description="Write all-brand daily EBIDA Layer to Google Sheets"
    )
    parser.add_argument("--date-from", default="2025-01-01")
    parser.add_argument("--date-to",   default=last_day(today.year, today.month))
    parser.add_argument("--dry-run",   action="store_true",
                        help="Fetch data and print summary without writing to sheet")
    args = parser.parse_args()

    date_from = date.fromisoformat(args.date_from)
    date_to   = date.fromisoformat(args.date_to)
    months    = list(iter_months(date_from, date_to))
    days      = all_days(date_from, date_to)

    print(f"\nEBIDA Layer v2 — All-brand daily database")
    print(f"Date range : {args.date_from} → {args.date_to}")
    print(f"Months     : {len(months)}  |  Days: {len(days)}")
    print(f"Target     : '{SHEET_TAB_NAME}' in sheet {SPREADSHEET_ID}")
    if args.dry_run:
        print("Mode       : DRY RUN\n")
    else:
        print("Mode       : LIVE WRITE\n")

    # ── Fetch all data ────────────────────────────────────────────────────────
    spa_rows                           = fetch_spa_zoho(months)
    aesth_cost, slim_cost, shared_rows = fetch_aesth_zoho(months)
    aesth_revenue                      = fetch_aesthetics_daily(date_from, date_to)
    slim_revenue                       = fetch_slimming_daily(date_from, date_to)
    aesth_salary, slim_salary          = fetch_salary_supplements(months)

    # ── Summary ───────────────────────────────────────────────────────────────
    print(f"\n{'─'*65}")
    print("  DATA SUMMARY")
    print(f"{'─'*65}")
    print(f"  SPA Zoho accounts        : {len(spa_rows)} rows")
    print(f"  Aesthetics Zoho costs    : {len(aesth_cost)} rows")
    print(f"  Slimming Zoho costs      : {len(slim_cost)} rows")
    print(f"  Shared costs             : {len(shared_rows)} rows")
    print(f"  Aesthetics revenue total : €{aesth_revenue.total():>12,.2f}  (daily)")
    print(f"  Slimming revenue total   : €{slim_revenue.total():>12,.2f}  (daily)")
    print(f"  Aesth salary supplement  : €{aesth_salary.total():>12,.2f}  (monthly)")
    print(f"  Slim  salary supplement  : €{slim_salary.total():>12,.2f}  (monthly)")

    # Sanity: first month
    first_month = month_first(*months[0])
    spa_income_first = sum(
        r.data.get(first_month, 0) for r in spa_rows
        if r.ebitda_cat in ("Income", "Other Income")
    )
    spa_cost_first = sum(
        r.data.get(first_month, 0) for r in spa_rows
        if r.ebitda_cat not in ("Income", "Other Income")
    )
    lbl0 = month_label(*months[0])
    print(f"\n  {lbl0} SPA Income  : €{spa_income_first:>12,.2f}")
    print(f"  {lbl0} SPA Costs   : €{spa_cost_first:>12,.2f}")
    print(f"  {lbl0} Aesth Rev   : €{aesth_revenue.data.get(first_month, 0):>12,.2f}  ← monthly sum on 1st")
    print(f"  (Aesthetics + Slimming daily revenue shown in individual day columns)")

    if args.dry_run:
        print(f"\n[Dry run] Skipping sheet write.")
        return

    # ── Build matrix ──────────────────────────────────────────────────────────
    print(f"\n{'─'*65}")
    print("  BUILDING MATRIX")
    print(f"{'─'*65}")
    matrix = build_output(
        days, spa_rows,
        aesth_revenue, aesth_salary, aesth_cost,
        slim_revenue, slim_salary, slim_cost,
        shared_rows,
    )

    # Find section header row indices for formatting
    section_header_rows = [
        i for i, row in enumerate(matrix)
        if isinstance(row[0], str) and row[0] in
           ("SPA", "AESTHETICS", "SLIMMING", "SHARED (AESTHETICS + SLIMMING)")
        and all(c == "" for c in row[1:5])
    ]
    print(f"  Total rows: {len(matrix)}  (1 header + {len(matrix)-1} data)")
    print(f"  Total cols: {len(matrix[0])}  (5 meta + {len(days)} days + 1 total)")

    # ── Write to sheet ────────────────────────────────────────────────────────
    print(f"\n{'─'*65}")
    print("  WRITING TO GOOGLE SHEETS")
    print(f"{'─'*65}")

    print("  Authenticating...", end=" ", flush=True)
    try:
        _get_google_access_token()
        print("OK")
    except RuntimeError as e:
        print(f"\n  ERROR: {e}")
        print("  Run: py google_reauth_write.py")
        sys.exit(1)

    print(f"  Getting/creating '{SHEET_TAB_NAME}' tab...", end=" ", flush=True)
    try:
        sheet_id = _get_or_create_sheet(SPREADSHEET_ID, SHEET_TAB_NAME)
        print(f"OK (sheetId={sheet_id})")
    except requests.HTTPError as e:
        if e.response is not None and e.response.status_code == 403:
            print("\n  ERROR 403: token needs write scope. Run: py google_reauth_write.py")
        else:
            print(f"\n  ERROR: {e}")
        sys.exit(1)

    print(f"  Clearing tab...", end=" ", flush=True)
    _clear_tab(SPREADSHEET_ID, SHEET_TAB_NAME)
    print("OK")

    print(f"  Writing {len(matrix)} rows × {len(matrix[0])} cols...", end=" ", flush=True)
    # Write in chunks of 500 rows to avoid request size limits
    CHUNK = 500
    for start in range(0, len(matrix), CHUNK):
        chunk = matrix[start:start + CHUNK]
        end_row = start + len(chunk)
        range_notation = f"'{SHEET_TAB_NAME}'!A{start + 1}"
        hdrs = {"Authorization": f"Bearer {_get_google_access_token()}",
                "Content-Type": "application/json"}
        requests.put(
            f"https://sheets.googleapis.com/v4/spreadsheets/{SPREADSHEET_ID}"
            f"/values/{range_notation}",
            headers=hdrs,
            params={"valueInputOption": "USER_ENTERED"},
            json={"values": chunk},
            timeout=120,
        ).raise_for_status()
    print("OK")

    print(f"  Applying formatting...", end=" ", flush=True)
    apply_formatting(sheet_id, matrix, len(days), section_header_rows)
    print("OK")

    print(f"\n  ✓ EBIDA Layer v2 written successfully")
    print(f"  ✓ {len(matrix)-1} rows  ×  {len(days)} day columns")
    print(f"  Sheet: https://docs.google.com/spreadsheets/d/{SPREADSHEET_ID}")


if __name__ == "__main__":
    main()
