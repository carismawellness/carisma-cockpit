"""
Build consolidated "KPI-Team" tab in the CRM Master Sheet.

Reads normalized daily data from Supabase crm_agent_daily (populated by
Tools/sync_crm_agents_to_supabase.py) and writes two sections:

  Part 1 — Daily Team Totals: one row per date, all agents summed
  Part 2 — Agent Summary: one row per agent, period totals + averages

Idempotent — run any time to refresh.

Usage:
  python Tools/build_consolidated_kpi.py
  python Tools/build_consolidated_kpi.py --from 2026-04-01 --to 2026-06-09
"""

import argparse
import json
import os
import re
import sys
from datetime import datetime
from pathlib import Path

import requests

# ── Env loading ───────────────────────────────────────────────────────────────
_REPO_ROOT = Path(__file__).resolve().parents[1]


def _load_env_file(path: Path) -> None:
    if not path.exists():
        return
    with open(path, encoding="utf-8") as f:
        for line in f:
            line = line.strip()
            if not line or line.startswith("#") or "=" not in line:
                continue
            key, _, val = line.partition("=")
            os.environ.setdefault(key.strip(), val.strip().strip('"').strip("'"))


_load_env_file(_REPO_ROOT / ".env")
_load_env_file(_REPO_ROOT / "Tech" / "CEO-Cockpit" / ".env.local")

# ── Google OAuth ──────────────────────────────────────────────────────────────
try:
    import gspread
    from google.oauth2.credentials import Credentials
    from google.auth.transport.requests import Request
except ImportError:
    import subprocess
    subprocess.check_call([sys.executable, "-m", "pip", "install", "gspread", "google-auth", "google-auth-oauthlib"])
    import gspread
    from google.oauth2.credentials import Credentials
    from google.auth.transport.requests import Request

try:
    from gspread.utils import rowcol_to_a1
    from gspread_formatting import (
        format_cell_ranges,
        CellFormat,
        Color,
        TextFormat,
        set_frozen,
        set_column_width,
        set_row_height,
    )
except ImportError:
    import subprocess
    subprocess.check_call([sys.executable, "-m", "pip", "install", "gspread-formatting"])
    from gspread.utils import rowcol_to_a1
    from gspread_formatting import (
        format_cell_ranges,
        CellFormat,
        Color,
        TextFormat,
        set_frozen,
        set_column_width,
        set_row_height,
    )

TOKEN_PATH   = Path.home() / ".go-google-mcp" / "token.json"
SECRETS_PATH = Path.home() / ".go-google-mcp" / "client_secrets.json"

with open(TOKEN_PATH) as f:
    tok = json.load(f)
with open(SECRETS_PATH) as f:
    sec = json.load(f)["installed"]

creds = Credentials(
    token=tok["access_token"],
    refresh_token=tok["refresh_token"],
    token_uri=sec["token_uri"],
    client_id=sec["client_id"],
    client_secret=sec["client_secret"],
    scopes=["https://www.googleapis.com/auth/spreadsheets"],
)
if creds.expired:
    creds.refresh(Request())

gc = gspread.authorize(creds)

# ── Constants ─────────────────────────────────────────────────────────────────
SPREADSHEET_ID = "1bHF_7bXic08pcyXQhq310zG6McqXD50oT0EuVkjzDdI"
TAB_NAME = "KPI-Team"

AGENT_ORDER = [
    "adeel", "rana", "abid", "km", "vj",
    "dorianne", "juliana", "anni", "nicci", "nathalia", "april", "queenee",
]
AGENT_NAMES: dict[str, str] = {
    "adeel": "Adeel", "rana": "Rana", "abid": "Abid", "km": "K&M",
    "vj": "VJ", "dorianne": "Dorianne", "juliana": "Juliana", "anni": "Anni",
    "nicci": "Nicci", "nathalia": "Nathalia", "april": "April", "queenee": "Queenee",
}

# ── Supabase fetch ────────────────────────────────────────────────────────────
_SUPABASE_URL = (
    os.environ.get("SUPABASE_URL")
    or os.environ.get("NEXT_PUBLIC_SUPABASE_URL")
    or ""
).rstrip("/")
_SUPABASE_KEY = os.environ.get("SUPABASE_SERVICE_ROLE_KEY") or ""

if not _SUPABASE_URL or not _SUPABASE_KEY:
    print("ERROR: SUPABASE_URL / NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set.")
    sys.exit(1)

PAGE_SIZE = 1000


def fetch_agent_rows(date_from: str | None, date_to: str | None) -> list[dict]:
    """Paginate through crm_agent_daily, optionally filtered by date range."""
    headers = {
        "apikey":        _SUPABASE_KEY,
        "Authorization": f"Bearer {_SUPABASE_KEY}",
        "Range-Unit":    "items",
    }

    all_rows: list[dict] = []
    offset = 0

    while True:
        # Use list of tuples so duplicate keys (two date filters) are preserved
        params: list[tuple[str, str]] = [
            ("select", "*"),
            ("order",  "date.asc,agent_slug.asc"),
        ]
        if date_from:
            params.append(("date", f"gte.{date_from}"))
        if date_to:
            params.append(("date", f"lte.{date_to}"))

        headers["Range"] = f"{offset}-{offset + PAGE_SIZE - 1}"

        resp = requests.get(
            f"{_SUPABASE_URL}/rest/v1/crm_agent_daily",
            headers=headers,
            params=params,
            timeout=60,
        )
        if not resp.ok:
            raise RuntimeError(
                f"Supabase query failed: HTTP {resp.status_code} — {resp.text[:300]}"
            )

        page: list[dict] = resp.json()
        all_rows.extend(page)

        if len(page) < PAGE_SIZE:
            break
        offset += PAGE_SIZE

    return all_rows


# ── Aggregation ────────────────────────────────────────────────────────────────

def _n(row: dict, key: str) -> float:
    """Safe numeric accessor — returns 0.0 for None/missing."""
    v = row.get(key)
    return float(v) if v is not None else 0.0


def build_daily_totals(rows: list[dict]) -> list[dict]:
    """Sum numeric fields per calendar date across all agents."""
    by_date: dict[str, dict] = {}

    for r in rows:
        d = r["date"]
        if d not in by_date:
            by_date[d] = {
                "date": d,
                "total_sales":         0.0,
                "total_booked":        0,
                "total_messages":      0,
                "total_deposit_count": 0,
                "active_agents":       0,
            }
        e = by_date[d]
        e["total_sales"]         += _n(r, "total_sales")
        e["total_booked"]        += int(_n(r, "total_booked"))
        e["total_messages"]      += int(_n(r, "total_messages"))
        e["total_deposit_count"] += int(_n(r, "total_deposit_count"))
        if _n(r, "total_sales") > 0 or _n(r, "total_booked") > 0:
            e["active_agents"] += 1

    for e in by_date.values():
        msgs   = e["total_messages"]
        booked = e["total_booked"]
        sales  = e["total_sales"]
        deps   = e["total_deposit_count"]
        e["conv_rate"]   = round(booked / msgs * 100, 1)  if msgs   > 0 else 0.0
        e["deposit_pct"] = round(deps   / booked * 100, 1) if booked > 0 else 0.0
        e["aov"]         = round(sales  / booked, 2)        if booked > 0 else 0.0

    return sorted(by_date.values(), key=lambda x: x["date"])


def build_agent_summary(rows: list[dict]) -> list[dict]:
    """Compute per-agent period totals and averages over active days."""
    acc: dict[str, dict] = {
        slug: {
            "slug": slug, "name": AGENT_NAMES[slug],
            "total_sales": 0.0, "total_booked": 0,
            "total_messages": 0, "total_deposit_count": 0,
            "active_days": 0,
            "_convs": [], "_deps": [], "_aovs": [],
        }
        for slug in AGENT_ORDER
    }

    for r in rows:
        slug = r.get("agent_slug", "")
        if slug not in acc:
            continue
        e = acc[slug]
        sales   = _n(r, "total_sales")
        booked  = int(_n(r, "total_booked"))
        msgs    = int(_n(r, "total_messages"))
        deps    = int(_n(r, "total_deposit_count"))
        conv    = _n(r, "conversion_rate_pct")
        dep_pct = _n(r, "deposit_pct")
        aov     = _n(r, "aov")

        e["total_sales"]         += sales
        e["total_booked"]        += booked
        e["total_messages"]      += msgs
        e["total_deposit_count"] += deps

        if sales > 0 or booked > 0:
            e["active_days"] += 1
            if conv    > 0: e["_convs"].append(conv)
            if dep_pct > 0: e["_deps"].append(dep_pct)
            if aov     > 0: e["_aovs"].append(aov)

    result = []
    for slug in AGENT_ORDER:
        e = acc[slug]
        convs = e.pop("_convs")
        deps  = e.pop("_deps")
        aovs  = e.pop("_aovs")
        e["avg_conv_rate"]   = round(sum(convs) / len(convs), 1) if convs else 0.0
        e["avg_deposit_pct"] = round(sum(deps)  / len(deps),  1) if deps  else 0.0
        e["avg_aov"]         = round(sum(aovs)  / len(aovs),  2) if aovs  else 0.0
        result.append(e)

    return sorted(result, key=lambda x: x["total_sales"], reverse=True)


# ── Color palette ─────────────────────────────────────────────────────────────
def rgb(r: int, g: int, b: int) -> Color:
    return Color(r / 255, g / 255, b / 255)


P = {
    "navy_bg":   rgb(30,  61,  89),
    "navy_fg":   rgb(255, 255, 255),
    "gold_bg":   rgb(184, 148, 62),
    "gold_fg":   rgb(255, 255, 255),
    "date_bg":   rgb(241, 245, 249),
    "date_fg":   rgb(30,  41,  59),
    "sales_bg":  rgb(240, 253, 244),
    "kpi_bg":    rgb(255, 251, 235),
    "top_bg":    rgb(255, 247, 237),
    "white":     rgb(255, 255, 255),
    "total_bg":  rgb(226, 232, 240),
    "dark_txt":  rgb(15,  23,  42),
    "muted_txt": rgb(100, 116, 139),
}

# ── Sheet helpers ─────────────────────────────────────────────────────────────

def col_letter(col_idx: int) -> str:
    """1-indexed column index → A1-notation letter."""
    return rowcol_to_a1(1, col_idx)[:-1]


def _fmt_range(ws_range: str, fmt: CellFormat) -> tuple[str, CellFormat]:
    return (ws_range, fmt)


# ── Main ──────────────────────────────────────────────────────────────────────

def main() -> None:
    parser = argparse.ArgumentParser(description="Refresh KPI-Team consolidated tab")
    parser.add_argument("--from", dest="date_from", metavar="YYYY-MM-DD",
                        help="Start date (inclusive). Defaults to all data.")
    parser.add_argument("--to",   dest="date_to",   metavar="YYYY-MM-DD",
                        help="End date (inclusive). Defaults to all data.")
    args = parser.parse_args()

    print("Fetching data from Supabase crm_agent_daily …")
    rows = fetch_agent_rows(args.date_from, args.date_to)
    print(f"  {len(rows):,} rows fetched")

    daily   = build_daily_totals(rows)
    agents  = build_agent_summary(rows)
    team_total_sales = sum(a["total_sales"] for a in agents)
    print(f"  {len(daily)} unique dates  |  {len(agents)} agents  |  €{team_total_sales:,.2f} total sales")

    # ── Assemble sheet rows ───────────────────────────────────────────────────
    N_COLS = 10  # fits both sections

    def blank() -> list:
        return [""] * N_COLS

    # Part 1 headers
    P1_TITLE = ["DAILY TEAM TOTALS"] + [""] * (N_COLS - 1)
    P1_HDR   = ["Date", "Total Sales", "Bookings", "Messages",
                "Deposits", "Conv Rate", "Deposit %", "AOV", "Active Agents", ""]

    # Part 1 data rows (dates sorted ascending)
    p1_data = []
    for d in daily:
        p1_data.append([
            datetime.fromisoformat(d["date"]).strftime("%d/%m/%Y"),
            round(d["total_sales"], 2),
            d["total_booked"],
            d["total_messages"],
            d["total_deposit_count"],
            d["conv_rate"]   / 100,     # stored as decimal → PERCENT format
            d["deposit_pct"] / 100,
            d["aov"],
            d["active_agents"],
            "",
        ])

    # Part 2 headers
    P2_TITLE = ["AGENT PERFORMANCE SUMMARY"] + [""] * (N_COLS - 1)
    P2_HDR   = ["Rank", "Agent", "Total Sales", "Bookings", "Messages",
                "Deposits", "Avg Conv Rate", "Avg Deposit %", "Avg AOV", "Active Days"]

    # Part 2 data rows (sorted by total_sales DESC already)
    p2_data = []
    for rank, a in enumerate(agents, 1):
        p2_data.append([
            rank,
            a["name"],
            round(a["total_sales"], 2),
            a["total_booked"],
            a["total_messages"],
            a["total_deposit_count"],
            a["avg_conv_rate"]   / 100,
            a["avg_deposit_pct"] / 100,
            a["avg_aov"],
            a["active_days"],
        ])

    # Team total row
    p2_total = [
        "",
        "TEAM TOTAL",
        round(sum(a["total_sales"]         for a in agents), 2),
        sum(a["total_booked"]        for a in agents),
        sum(a["total_messages"]      for a in agents),
        sum(a["total_deposit_count"] for a in agents),
        "", "", "", "",
    ]

    # Row layout (1-indexed)
    ROW_P1_TITLE  = 1
    ROW_P1_HDR    = 2
    ROW_P1_DATA_S = 3
    ROW_P1_DATA_E = 2 + len(p1_data)      # inclusive
    ROW_GAP1      = ROW_P1_DATA_E + 1
    ROW_GAP2      = ROW_P1_DATA_E + 2
    ROW_P2_TITLE  = ROW_P1_DATA_E + 3
    ROW_P2_HDR    = ROW_P1_DATA_E + 4
    ROW_P2_DATA_S = ROW_P1_DATA_E + 5
    ROW_P2_DATA_E = ROW_P2_DATA_S + len(p2_data) - 1
    ROW_P2_TOTAL  = ROW_P2_DATA_E + 1

    total_rows = ROW_P2_TOTAL

    # Build flat list in sheet order
    sheet_rows = []
    sheet_rows.append(P1_TITLE)
    sheet_rows.append(P1_HDR)
    sheet_rows.extend(p1_data)
    sheet_rows.append(blank())
    sheet_rows.append(blank())
    sheet_rows.append(P2_TITLE)
    sheet_rows.append(P2_HDR)
    sheet_rows.extend(p2_data)
    sheet_rows.append(p2_total)

    # ── Write to sheet ────────────────────────────────────────────────────────
    sh = gc.open_by_key(SPREADSHEET_ID)
    try:
        ws = sh.worksheet(TAB_NAME)
        ws.clear()
        sh.batch_update({"requests": [{"unmergeCells": {"range": {
            "sheetId":          ws.id,
            "startRowIndex":    0,
            "endRowIndex":      total_rows + 5,
            "startColumnIndex": 0,
            "endColumnIndex":   N_COLS + 2,
        }}}]})
    except gspread.exceptions.WorksheetNotFound:
        ws = sh.add_worksheet(TAB_NAME, rows=total_rows + 20, cols=N_COLS + 2)

    ws.update(range_name="A1", values=sheet_rows, value_input_option="USER_ENTERED")
    print(f"Data written: {len(sheet_rows)} rows × {N_COLS} cols")

    # ── Formatting ────────────────────────────────────────────────────────────
    LC = col_letter(N_COLS)   # last column letter

    fmt_list: list[tuple[str, CellFormat]] = []

    def add(rng: str, fmt: CellFormat) -> None:
        fmt_list.append((rng, fmt))

    # Title rows
    for tr in (ROW_P1_TITLE, ROW_P2_TITLE):
        add(f"A{tr}:{LC}{tr}", CellFormat(
            backgroundColor=P["navy_bg"],
            textFormat=TextFormat(bold=True, fontSize=10,
                                  foregroundColor=P["navy_fg"], fontFamily="Arial"),
            horizontalAlignment="LEFT", verticalAlignment="MIDDLE",
        ))

    # Sub-header rows
    for hr in (ROW_P1_HDR, ROW_P2_HDR):
        add(f"A{hr}:{LC}{hr}", CellFormat(
            backgroundColor=P["gold_bg"],
            textFormat=TextFormat(bold=True, fontSize=9,
                                  foregroundColor=P["gold_fg"], fontFamily="Arial"),
            horizontalAlignment="CENTER", verticalAlignment="MIDDLE",
        ))

    # Part 1 data rows
    if ROW_P1_DATA_E >= ROW_P1_DATA_S:
        s, e = ROW_P1_DATA_S, ROW_P1_DATA_E
        add(f"A{s}:A{e}", CellFormat(
            backgroundColor=P["date_bg"],
            textFormat=TextFormat(bold=True, fontSize=9,
                                  foregroundColor=P["date_fg"], fontFamily="Arial"),
            horizontalAlignment="CENTER",
        ))
        add(f"B{s}:B{e}", CellFormat(  # Total Sales
            backgroundColor=P["sales_bg"],
            textFormat=TextFormat(fontSize=9, foregroundColor=P["dark_txt"], fontFamily="Arial"),
            horizontalAlignment="CENTER",
        ))
        add(f"C{s}:E{e}", CellFormat(  # counts
            backgroundColor=P["white"],
            textFormat=TextFormat(fontSize=9, foregroundColor=P["dark_txt"], fontFamily="Arial"),
            horizontalAlignment="CENTER",
        ))
        add(f"F{s}:H{e}", CellFormat(  # KPI %s + AOV
            backgroundColor=P["kpi_bg"],
            textFormat=TextFormat(fontSize=9, foregroundColor=P["dark_txt"], fontFamily="Arial"),
            horizontalAlignment="CENTER",
        ))
        add(f"I{s}:I{e}", CellFormat(  # Active Agents
            backgroundColor=P["white"],
            textFormat=TextFormat(fontSize=9, foregroundColor=P["muted_txt"], fontFamily="Arial"),
            horizontalAlignment="CENTER",
        ))
        # Number formats
        add(f"B{s}:B{e}", CellFormat(numberFormat={"type": "CURRENCY", "pattern": "€#,##0"}))
        add(f"F{s}:G{e}", CellFormat(numberFormat={"type": "PERCENT",  "pattern": "0.0%"}))
        add(f"H{s}:H{e}", CellFormat(numberFormat={"type": "CURRENCY", "pattern": "€#,##0.00"}))

    # Part 2 data rows
    if ROW_P2_DATA_E >= ROW_P2_DATA_S:
        s, e = ROW_P2_DATA_S, ROW_P2_DATA_E
        # Top performer highlight
        add(f"A{s}:{LC}{s}", CellFormat(
            backgroundColor=P["top_bg"],
            textFormat=TextFormat(fontSize=9, foregroundColor=P["dark_txt"], fontFamily="Arial"),
            horizontalAlignment="CENTER",
        ))
        # Agent name bold
        add(f"B{s}:B{e}", CellFormat(
            textFormat=TextFormat(bold=True, fontSize=9, fontFamily="Arial"),
        ))
        if e > s:
            add(f"A{s+1}:{LC}{e}", CellFormat(
                backgroundColor=P["white"],
                textFormat=TextFormat(fontSize=9, foregroundColor=P["dark_txt"], fontFamily="Arial"),
                horizontalAlignment="CENTER",
            ))
        # Number formats
        add(f"C{s}:C{e}", CellFormat(numberFormat={"type": "CURRENCY", "pattern": "€#,##0"}))
        add(f"G{s}:H{e}", CellFormat(numberFormat={"type": "PERCENT",  "pattern": "0.0%"}))
        add(f"I{s}:I{e}", CellFormat(numberFormat={"type": "CURRENCY", "pattern": "€#,##0.00"}))

    # Team total row
    tr = ROW_P2_TOTAL
    add(f"A{tr}:{LC}{tr}", CellFormat(
        backgroundColor=P["total_bg"],
        textFormat=TextFormat(bold=True, fontSize=9,
                              foregroundColor=P["dark_txt"], fontFamily="Arial"),
        horizontalAlignment="CENTER",
    ))
    add(f"C{tr}:C{tr}", CellFormat(numberFormat={"type": "CURRENCY", "pattern": "€#,##0"}))

    format_cell_ranges(ws, fmt_list)
    print("Formatting applied")

    # ── Freeze BEFORE merges (merges that span col A block column-freeze) ─────
    set_frozen(ws, rows=2, cols=0)

    # ── Merges ────────────────────────────────────────────────────────────────
    for tr in (ROW_P1_TITLE, ROW_P2_TITLE):
        ws.merge_cells(f"A{tr}:{LC}{tr}")

    set_column_width(ws, "A", 90)
    set_column_width(ws, "B", 88)
    for letter in ("C", "D", "E", "F", "G", "H", "I", "J"):
        set_column_width(ws, letter, 78)

    set_row_height(ws, "1", 28)
    set_row_height(ws, "2", 32)
    if ROW_P1_DATA_E >= ROW_P1_DATA_S:
        set_row_height(ws, f"{ROW_P1_DATA_S}:{ROW_P1_DATA_E}", 20)
    set_row_height(ws, str(ROW_P2_TITLE), 28)
    set_row_height(ws, str(ROW_P2_HDR),   32)
    if ROW_P2_DATA_E >= ROW_P2_DATA_S:
        set_row_height(ws, f"{ROW_P2_DATA_S}:{ROW_P2_TOTAL}", 22)

    print("Merges, freeze, and sizes applied")

    print(f"\nDone — KPI-Team refreshed")
    print(f"  {len(daily)} daily rows  |  {len(agents)} agents  |  €{team_total_sales:,.2f} team sales")
    print(f"  https://docs.google.com/spreadsheets/d/{SPREADSHEET_ID}/edit#gid={ws.id}")


if __name__ == "__main__":
    main()
