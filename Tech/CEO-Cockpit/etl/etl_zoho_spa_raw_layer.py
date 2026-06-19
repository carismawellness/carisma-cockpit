"""
ETL: Zoho Books SPA raw P&L → Google Sheets "EBIDA Layer" tab

Purpose:
    Build a granular, account-level database in the monthly KPI Google Sheet.
    Every row is a single Zoho Books account; every column is a calendar month.
    Values are raw Zoho totals — NO splitting, NO COA mapping, NO allocation.

    This tab acts as:
    - A QC / audit layer to verify the Supabase EBITDA numbers
    - A fallback source of truth
    - A staging table the dashboard can eventually read from directly

Usage:
    cd etl
    py etl_zoho_spa_raw_layer.py                              # Jan 2025 – current month
    py etl_zoho_spa_raw_layer.py --date-from 2025-01-01 --date-to 2026-05-31
    py etl_zoho_spa_raw_layer.py --dry-run                    # print data, skip sheet write
"""

import sys
import argparse
import calendar
import json
import os
import time
from datetime import date, datetime
from pathlib import Path

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

_env_path = Path(__file__).resolve().parents[3] / ".env"
load_dotenv(_env_path)

from zoho_books_client import ZohoBooksClient

# ── Target spreadsheet ────────────────────────────────────────────────────────
SPREADSHEET_ID = "1WWM7W6S5wtSC-5hdlcuJgW3zbYaO7YRgg4_-Bju4-5s"
SHEET_TAB_NAME = "EBIDA Layer"

# ── COA map for annotation only (not used for allocation) ─────────────────────
# Imported from the SPA EBITDA ETL — used to annotate each account row
# with its intended EBITDA category and split rule, as reference columns.
try:
    from etl_zoho_books_spa_ebitda import COA_MAP
    _COA_AVAILABLE = True
except Exception:
    COA_MAP = {}
    _COA_AVAILABLE = False


# ═══════════════════════════════════════════════════════════════════════════════
# Section type maps (same as spa ebitda ETL)
# ═══════════════════════════════════════════════════════════════════════════════

_SUBSECTION_TYPES: dict[str, str] = {
    "operating income":        "Income",
    "income":                  "Income",
    "revenue":                 "Income",
    "non operating income":    "Other Income",
    "other income":            "Other Income",
    "cost of goods sold":      "COGS",
    "operating expense":       "Expense",
    "operating expenses":      "Expense",
    "expense":                 "Expense",
    "expenses":                "Expense",
    "non operating expense":   "Other Expense",
    "non operating expenses":  "Other Expense",
    "other expense":           "Other Expense",
    "other expenses":          "Other Expense",
}

_EBITDA_LINE_LABELS: dict[str, str] = {
    "revenue":     "Revenue",
    "cogs":        "COGS",
    "wages":       "Wages & Salaries",
    "advertising": "Advertising",
    "rent":        "Rent",
    "utilities":   "Utilities",
    "sga":         "SG&A",
}


# ═══════════════════════════════════════════════════════════════════════════════
# Zoho P&L fetching (raw — no splitting)
# ═══════════════════════════════════════════════════════════════════════════════

def _walk_account_txns(nodes: list, section_type: str | None, result: list) -> None:
    """Recursively walk Zoho account_transactions and collect leaf accounts."""
    for node in nodes:
        if not isinstance(node, dict):
            continue
        raw_name = (node.get("name") or "").lower().strip()
        if raw_name.startswith("total "):
            raw_name = raw_name[6:]
        stype = _SUBSECTION_TYPES.get(raw_name, section_type)

        sub = node.get("account_transactions")
        if sub:
            _walk_account_txns(sub, stype, result)
        else:
            if not stype:
                continue
            code   = str(node.get("account_code") or "").strip()
            name   = str(node.get("name") or "").strip()
            if not name and not code:
                continue
            amount = abs(float(node.get("total") or 0))
            result.append({"code": code, "name": name, "section": stype, "amount": amount})


def fetch_month_raw(client: ZohoBooksClient, from_date: str, to_date: str) -> list[dict]:
    """Fetch all P&L accounts for a month. Returns list of {code, name, section, amount}."""
    data = client.get("reports/profitandloss", {
        "from_date":  from_date,
        "to_date":    to_date,
        "cash_based": "false",
    })
    pl = data.get("profit_and_loss", data)
    accounts: list[dict] = []

    if isinstance(pl, list):
        _walk_account_txns(pl, None, accounts)
    elif isinstance(pl, dict):
        # Legacy dict format
        _SECTION_TYPES = {
            "income": "Income", "revenue": "Income", "other_income": "Other Income",
            "cost_of_goods_sold": "COGS", "cogs": "COGS",
            "operating_expense": "Expense", "expense": "Expense", "expenses": "Expense",
            "other_expense": "Other Expense",
        }
        def _extract(node, stype, result):
            if isinstance(node, list):
                for item in node:
                    _extract(item, stype, result)
                return
            if not isinstance(node, dict):
                return
            sub = node.get("accounts")
            if sub:
                _extract(sub, stype, result)
                return
            code   = str(node.get("account_code") or "").strip()
            name   = str(node.get("account_name") or "").strip()
            if not name and not code:
                return
            amount = abs(float(node.get("bcy_balance") or node.get("total") or node.get("balance") or 0))
            result.append({"code": code, "name": name, "section": stype, "amount": amount})
        for key, stype in _SECTION_TYPES.items():
            if key in pl:
                _extract(pl[key], stype, accounts)

    return accounts


# ═══════════════════════════════════════════════════════════════════════════════
# Month helpers
# ═══════════════════════════════════════════════════════════════════════════════

def last_day(year: int, month: int) -> str:
    return f"{year}-{month:02d}-{calendar.monthrange(year, month)[1]:02d}"


def month_label(year: int, month: int) -> str:
    """e.g. 'Jan-25'"""
    return f"{date(year, month, 1).strftime('%b')}-{str(year)[2:]}"


def iter_months(date_from: date, date_to: date):
    y, m = date_from.year, date_from.month
    while (y, m) <= (date_to.year, date_to.month):
        yield y, m
        m += 1
        if m > 12:
            m, y = 1, y + 1


# ═══════════════════════════════════════════════════════════════════════════════
# Google Sheets helpers
# ═══════════════════════════════════════════════════════════════════════════════

_GOOGLE_TOKEN_CACHE: dict[str, tuple[str, float]] = {}


def _get_google_access_token() -> str:
    """Exchange GOOGLE_SHEETS_REFRESH_TOKEN for a fresh access token."""
    client_id     = os.environ.get("GOOGLE_SHEETS_CLIENT_ID")     or os.environ.get("GOOGLE_CLIENT_ID")
    client_secret = os.environ.get("GOOGLE_SHEETS_CLIENT_SECRET") or os.environ.get("GOOGLE_CLIENT_SECRET")
    refresh_token = os.environ.get("GOOGLE_SHEETS_REFRESH_TOKEN") or os.environ.get("GOOGLE_REFRESH_TOKEN")

    if not all([client_id, client_secret, refresh_token]):
        raise RuntimeError(
            "Google Sheets credentials not found in .env — need GOOGLE_SHEETS_CLIENT_ID, "
            "GOOGLE_SHEETS_CLIENT_SECRET, GOOGLE_SHEETS_REFRESH_TOKEN"
        )

    cache_key = f"{client_id}:sheets"
    cached = _GOOGLE_TOKEN_CACHE.get(cache_key)
    if cached and time.time() < cached[1]:
        return cached[0]

    resp = requests.post(
        "https://oauth2.googleapis.com/token",
        data={
            "client_id":     client_id,
            "client_secret": client_secret,
            "refresh_token": refresh_token,
            "grant_type":    "refresh_token",
        },
        timeout=20,
    )
    resp.raise_for_status()
    token_data    = resp.json()
    access_token  = token_data.get("access_token")
    if not access_token:
        raise RuntimeError(f"Token refresh failed: {token_data}")
    expires_in = int(token_data.get("expires_in", 3600))
    _GOOGLE_TOKEN_CACHE[cache_key] = (access_token, time.time() + expires_in - 60)
    return access_token


def _sheets_headers() -> dict:
    return {"Authorization": f"Bearer {_get_google_access_token()}", "Content-Type": "application/json"}


def _get_or_create_sheet(spreadsheet_id: str, tab_name: str) -> int:
    """Return the sheetId of tab_name, creating it if it doesn't exist."""
    meta = requests.get(
        f"https://sheets.googleapis.com/v4/spreadsheets/{spreadsheet_id}",
        headers=_sheets_headers(),
        params={"fields": "sheets.properties"},
        timeout=20,
    ).json()
    for s in meta.get("sheets", []):
        if s["properties"]["title"] == tab_name:
            return s["properties"]["sheetId"]

    # Create it
    resp = requests.post(
        f"https://sheets.googleapis.com/v4/spreadsheets/{spreadsheet_id}:batchUpdate",
        headers=_sheets_headers(),
        json={"requests": [{"addSheet": {"properties": {"title": tab_name}}}]},
        timeout=20,
    )
    resp.raise_for_status()
    return resp.json()["replies"][0]["addSheet"]["properties"]["sheetId"]


def _clear_tab(spreadsheet_id: str, tab_name: str) -> None:
    requests.post(
        f"https://sheets.googleapis.com/v4/spreadsheets/{spreadsheet_id}/values/{tab_name}!A1:ZZ10000:clear",
        headers=_sheets_headers(),
        timeout=20,
    ).raise_for_status()


def _write_values(spreadsheet_id: str, tab_name: str, values: list[list]) -> None:
    requests.put(
        f"https://sheets.googleapis.com/v4/spreadsheets/{spreadsheet_id}/values/{tab_name}!A1",
        headers=_sheets_headers(),
        params={"valueInputOption": "USER_ENTERED"},
        json={"values": values},
        timeout=60,
    ).raise_for_status()


def _apply_formatting(spreadsheet_id: str, sheet_id: int, num_months: int, num_data_rows: int) -> None:
    """Apply header freeze, bold headers, alternating row shading, number format."""
    num_cols = 5 + num_months + 1  # code + name + section + ebitda line + split rule + months + total

    requests_list = []

    # Freeze row 1 + column A
    requests_list.append({
        "updateSheetProperties": {
            "properties": {
                "sheetId": sheet_id,
                "gridProperties": {"frozenRowCount": 1, "frozenColumnCount": 2}
            },
            "fields": "gridProperties.frozenRowCount,gridProperties.frozenColumnCount"
        }
    })

    # Header row — dark background, white bold text, center
    requests_list.append({
        "repeatCell": {
            "range": {"sheetId": sheet_id, "startRowIndex": 0, "endRowIndex": 1,
                      "startColumnIndex": 0, "endColumnIndex": num_cols},
            "cell": {"userEnteredFormat": {
                "backgroundColor":      {"red": 0.15, "green": 0.15, "blue": 0.15},
                "textFormat":           {"bold": True, "fontSize": 10,
                                        "foregroundColor": {"red": 1, "green": 1, "blue": 1}},
                "horizontalAlignment":  "CENTER",
                "verticalAlignment":    "MIDDLE",
                "wrapStrategy":         "WRAP",
            }},
            "fields": "userEnteredFormat(backgroundColor,textFormat,horizontalAlignment,verticalAlignment,wrapStrategy)"
        }
    })

    # Section-header rows (Income, COGS, Expense, etc.) — detected by section column (col C, index 2)
    # We'll apply subtle background to alternating groups of Income vs Expense rows.
    # Simpler: apply EUR number format to all data cells (columns 5 onward).
    month_start_col = 5  # columns A-E are metadata (0-4), then months start at 5
    total_col       = month_start_col + num_months

    requests_list.append({
        "repeatCell": {
            "range": {"sheetId": sheet_id, "startRowIndex": 1, "endRowIndex": num_data_rows + 1,
                      "startColumnIndex": month_start_col, "endColumnIndex": total_col + 1},
            "cell": {"userEnteredFormat": {
                "numberFormat": {"type": "NUMBER", "pattern": "#,##0.00"},
                "horizontalAlignment": "RIGHT",
            }},
            "fields": "userEnteredFormat(numberFormat,horizontalAlignment)"
        }
    })

    # Column widths
    widths = {0: 90, 1: 280, 2: 110, 3: 130, 4: 100}  # code, name, section, ebitda line, split rule
    for col, px in widths.items():
        requests_list.append({
            "updateDimensionProperties": {
                "range": {"sheetId": sheet_id, "dimension": "COLUMNS",
                          "startIndex": col, "endIndex": col + 1},
                "properties": {"pixelSize": px},
                "fields": "pixelSize"
            }
        })
    # Month columns — narrower
    for i in range(num_months):
        requests_list.append({
            "updateDimensionProperties": {
                "range": {"sheetId": sheet_id, "dimension": "COLUMNS",
                          "startIndex": month_start_col + i,
                          "endIndex": month_start_col + i + 1},
                "properties": {"pixelSize": 80},
                "fields": "pixelSize"
            }
        })
    # Total column
    requests_list.append({
        "updateDimensionProperties": {
            "range": {"sheetId": sheet_id, "dimension": "COLUMNS",
                      "startIndex": total_col, "endIndex": total_col + 1},
            "properties": {"pixelSize": 90},
            "fields": "pixelSize"
        }
    })

    # Total column — bold
    requests_list.append({
        "repeatCell": {
            "range": {"sheetId": sheet_id, "startRowIndex": 0, "endRowIndex": num_data_rows + 1,
                      "startColumnIndex": total_col, "endColumnIndex": total_col + 1},
            "cell": {"userEnteredFormat": {
                "textFormat": {"bold": True},
            }},
            "fields": "userEnteredFormat(textFormat)"
        }
    })

    requests.post(
        f"https://sheets.googleapis.com/v4/spreadsheets/{SPREADSHEET_ID}:batchUpdate",
        headers=_sheets_headers(),
        json={"requests": requests_list},
        timeout=30,
    ).raise_for_status()


# ═══════════════════════════════════════════════════════════════════════════════
# Main ETL
# ═══════════════════════════════════════════════════════════════════════════════

# Section sort order for the output table
_SECTION_ORDER = {
    "Income": 0, "Other Income": 1,
    "COGS": 2,
    "Expense": 3,
    "Other Expense": 4,
}


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Write raw Zoho SPA P&L account data to 'EBIDA Layer' Google Sheet tab"
    )
    today = date.today()
    default_from = "2025-01-01"
    default_to   = last_day(today.year, today.month)

    parser.add_argument("--date-from", default=default_from, help=f"Start date YYYY-MM-DD (default: {default_from})")
    parser.add_argument("--date-to",   default=default_to,   help=f"End date YYYY-MM-DD (default: {default_to})")
    parser.add_argument("--dry-run",   action="store_true",  help="Fetch and print data without writing to sheet")
    args = parser.parse_args()

    date_from = date.fromisoformat(args.date_from)
    date_to   = date.fromisoformat(args.date_to)
    months    = list(iter_months(date_from, date_to))

    print(f"\nEBIDA Layer ETL — Zoho SPA raw P&L")
    print(f"Range  : {args.date_from} → {args.date_to} ({len(months)} months)")
    print(f"Target : '{SHEET_TAB_NAME}' tab in https://docs.google.com/spreadsheets/d/{SPREADSHEET_ID}/")
    if args.dry_run:
        print("Mode   : DRY RUN — data will be printed but NOT written to the sheet\n")
    else:
        print("Mode   : LIVE — data will be written to the sheet\n")

    client = ZohoBooksClient(org="spa")

    # ── Step 1: Collect raw data for all months ────────────────────────────────
    # Structure: {(code, name, section): {month_label: amount}}
    all_accounts: dict[tuple[str, str, str], dict[str, float]] = {}
    month_labels: list[str] = []

    for y, m in months:
        from_date = f"{y}-{m:02d}-01"
        to_date   = last_day(y, m)
        label     = month_label(y, m)
        month_labels.append(label)

        print(f"  Fetching {label} ({from_date} – {to_date})...", end=" ", flush=True)
        try:
            raw = fetch_month_raw(client, from_date, to_date)
        except Exception as e:
            print(f"ERROR: {e}")
            # Still include the month column but leave amounts blank
            continue

        non_zero = [r for r in raw if r["amount"] > 0]
        print(f"{len(non_zero)} accounts with non-zero amounts")

        for acc in raw:
            key = (acc["code"], acc["name"], acc["section"])
            if key not in all_accounts:
                all_accounts[key] = {}
            if acc["amount"] != 0:
                all_accounts[key][label] = round(acc["amount"], 2)

    print(f"\nTotal unique accounts across all months: {len(all_accounts)}")

    # ── Step 2: Build the output matrix ───────────────────────────────────────
    # Sort: by section order first, then by account code (numeric where possible)
    def sort_key(k: tuple[str, str, str]):
        code, name, section = k
        sec_ord = _SECTION_ORDER.get(section, 9)
        try:
            code_ord = int(code)
        except (ValueError, TypeError):
            code_ord = 999999
        return (sec_ord, code_ord, code, name)

    sorted_accounts = sorted(all_accounts.keys(), key=sort_key)

    # Build header row
    header = [
        "Account Code",
        "Account Name",
        "Section",
        "EBITDA Category",
        "Split Rule",
        *month_labels,
        "TOTAL",
    ]

    # Build data rows
    data_rows: list[list] = [header]
    for key in sorted_accounts:
        code, name, section = key
        month_amounts = all_accounts[key]

        # Look up COA annotation (reference only)
        coa_entry = COA_MAP.get(code) if _COA_AVAILABLE else None
        if coa_entry:
            split_rule, ebitda_line = coa_entry
            ebitda_label = _EBITDA_LINE_LABELS.get(ebitda_line, ebitda_line)
        else:
            split_rule   = ""
            ebitda_label = ""

        # Monthly amounts
        month_values = [month_amounts.get(lbl, 0) for lbl in month_labels]
        row_total    = round(sum(month_values), 2)

        row = [
            code,
            name,
            section,
            ebitda_label,
            split_rule,
            *month_values,
            row_total,
        ]
        data_rows.append(row)

    # ── Step 3: Print summary ─────────────────────────────────────────────────
    print(f"\n{'─'*70}")
    print(f"  DATA SUMMARY")
    print(f"{'─'*70}")
    print(f"  Months       : {', '.join(month_labels)}")
    print(f"  Total rows   : {len(data_rows) - 1}  (excluding header)")

    # Section breakdown
    from collections import Counter
    section_counts = Counter(k[2] for k in sorted_accounts)
    for sec, cnt in sorted(section_counts.items(), key=lambda x: _SECTION_ORDER.get(x[0], 9)):
        print(f"  {sec:<20}: {cnt} accounts")

    # Revenue sanity check (first month)
    if month_labels:
        first_m = month_labels[0]
        income_total  = sum(
            all_accounts[k].get(first_m, 0)
            for k in sorted_accounts if k[2] in ("Income", "Other Income")
        )
        expense_total = sum(
            all_accounts[k].get(first_m, 0)
            for k in sorted_accounts if k[2] in ("COGS", "Expense", "Other Expense")
        )
        print(f"\n  {first_m} Income  : €{income_total:>12,.2f}")
        print(f"  {first_m} Expenses: €{expense_total:>12,.2f}")
        print(f"  {first_m} Net     : €{income_total - expense_total:>12,.2f}")

    if args.dry_run:
        print(f"\n[Dry run] Skipping Google Sheets write.")
        print(f"  Re-run without --dry-run to populate the '{SHEET_TAB_NAME}' tab.")
        print(f"\n  First 5 data rows:")
        for row in data_rows[1:6]:
            print(f"    {row[0]:<12} {row[1][:40]:<40} {row[2]:<14} {row[3]:<20} {row[5]:>10.2f}")
        return

    # ── Step 4: Write to Google Sheets ────────────────────────────────────────
    print(f"\n{'─'*70}")
    print(f"  WRITING TO GOOGLE SHEETS")
    print(f"{'─'*70}")

    print(f"  Authenticating with Google Sheets...", end=" ", flush=True)
    try:
        token = _get_google_access_token()
        print("OK")
    except RuntimeError as e:
        print(f"\n  ERROR: {e}")
        print(f"\n  To fix: run google_reauth.py with write scope then re-run this script.")
        sys.exit(1)

    print(f"  Getting/creating '{SHEET_TAB_NAME}' tab...", end=" ", flush=True)
    try:
        sheet_id = _get_or_create_sheet(SPREADSHEET_ID, SHEET_TAB_NAME)
        print(f"OK (sheetId={sheet_id})")
    except requests.HTTPError as e:
        if e.response is not None and e.response.status_code == 403:
            print(
                f"\n  ERROR 403: The Google token does not have write access to this spreadsheet.\n"
                f"  Fix: run  py etl/google_reauth_write.py  to re-authorize with write scope,\n"
                f"  then re-run this script."
            )
        else:
            print(f"\n  ERROR: {e}")
        sys.exit(1)

    print(f"  Clearing existing data...", end=" ", flush=True)
    _clear_tab(SPREADSHEET_ID, SHEET_TAB_NAME)
    print("OK")

    print(f"  Writing {len(data_rows)} rows × {len(header)} columns...", end=" ", flush=True)
    _write_values(SPREADSHEET_ID, SHEET_TAB_NAME, data_rows)
    print("OK")

    print(f"  Applying formatting...", end=" ", flush=True)
    _apply_formatting(SPREADSHEET_ID, sheet_id, num_months=len(month_labels), num_data_rows=len(data_rows) - 1)
    print("OK")

    print(f"\n  ✓ '{SHEET_TAB_NAME}' tab updated successfully.")
    print(f"  ✓ {len(data_rows) - 1} account rows × {len(month_labels)} months")
    sheet_url = f"https://docs.google.com/spreadsheets/d/{SPREADSHEET_ID}"
    print(f"  Sheet: {sheet_url}")


if __name__ == "__main__":
    main()
