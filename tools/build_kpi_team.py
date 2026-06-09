"""
Build formula-based "KPI-Team" tab in the CRM Master Sheet.

Uses INDEX-MATCH formulas that reference each agent's RAW tab directly,
so the team view auto-updates whenever agents enter new data — no ETL needed.

Agent column layouts:
  Chat (Adeel, Rana, Abid, K&M):
    A=Date, N=TotalMsgs, O=TotalBooked, P=TotalDep, Q=Rate%, R=TotalSales

  SDR / Outbound (VJ, Dorianne, Juliana, Anni, Nicci, Nathalia, April, Queenee):
    A=Date, O=TotalSales, P=TotalBooked, Q=TotalDep, S=TotalDials

Also fixes column-A date formatting on all 12 raw agent tabs (copies format
from first data row to every date row so colours are consistent).

Usage:
  python3 Tools/build_kpi_team.py
  python3 Tools/build_kpi_team.py --year 2026        # default
  python3 Tools/build_kpi_team.py --skip-fmt-fix     # skip raw-tab formatting
"""

import argparse
import json
import sys
from datetime import date, timedelta
from pathlib import Path

# ── Auth ─────────────────────────────────────────────────────────────────────
try:
    import gspread
    from google.oauth2.credentials import Credentials
    from google.auth.transport.requests import Request
    from gspread.utils import rowcol_to_a1
    from gspread_formatting import (
        format_cell_ranges, CellFormat, Color, TextFormat,
        set_frozen, set_column_width, set_row_height,
    )
except ImportError:
    import subprocess
    subprocess.check_call([sys.executable, "-m", "pip", "install",
                           "gspread", "google-auth", "google-auth-oauthlib", "gspread-formatting"])
    import gspread
    from google.oauth2.credentials import Credentials
    from google.auth.transport.requests import Request
    from gspread.utils import rowcol_to_a1
    from gspread_formatting import (
        format_cell_ranges, CellFormat, Color, TextFormat,
        set_frozen, set_column_width, set_row_height,
    )

TOKEN_PATH   = Path.home() / ".go-google-mcp" / "token.json"
SECRETS_PATH = Path.home() / ".go-google-mcp" / "client_secrets.json"

with open(TOKEN_PATH) as f:
    tok = json.load(f)
with open(SECRETS_PATH) as f:
    sec = json.load(f)["installed"]

creds = Credentials(
    token=tok["access_token"], refresh_token=tok["refresh_token"],
    token_uri=sec["token_uri"], client_id=sec["client_id"],
    client_secret=sec["client_secret"],
    scopes=["https://www.googleapis.com/auth/spreadsheets"],
)
if creds.expired:
    creds.refresh(Request())
gc = gspread.authorize(creds)

# ── Config ────────────────────────────────────────────────────────────────────
SPREADSHEET_ID = "1bHF_7bXic08pcyXQhq310zG6McqXD50oT0EuVkjzDdI"
TAB_NAME = "KPI-Team"

# (display_name, raw_tab_name, format_type)
# format_type "chat" → Total Sales in col R; "sdr" → Total Sales in col O
AGENTS: list[tuple[str, str, str]] = [
    ("Adeel",    "Adeel",    "chat"),
    ("Rana",     "Rana",     "chat"),
    ("Abid",     "Abid",     "chat"),
    ("K&M",      "K&M",      "chat"),
    ("VJ",       "VJ",       "sdr"),
    ("Dorianne", "Dorianne", "sdr"),
    ("Juliana",  "Juliana",  "sdr"),
    ("Anni",     "Anni",     "sdr"),
    ("Nicci",    "Nicci",    "sdr"),
    ("Nathalia", "Nathalia", "sdr"),
    ("April",    "April",    "sdr"),
    ("Queenee",  "Queenee",  "sdr"),
]

# Columns in raw agent tabs (1-indexed sheet letter, 0-indexed python arrays)
CHAT_COLS = {"sales": "R", "booked": "O", "messages": "N", "deposits": "P"}
SDR_COLS  = {"sales": "O", "booked": "P", "messages": "S", "deposits": "Q"}


# ── Formula builders ──────────────────────────────────────────────────────────

def _im(tab: str, col: str, date_ref: str) -> str:
    """
    IFERROR(INDEX(tab!col, MATCH(DATEVALUE(date_ref),
                                  IFERROR(DATEVALUE(tab!A:A),0), 0)), 0)

    Uses DATEVALUE on both sides so the lookup is format-agnostic —
    agent tabs may store dates as "1/5/2026" or "01/05/2026" or a date
    serial; all resolve to the same numeric value.
    """
    t = tab.replace("'", "''")
    return (
        f"IFERROR(INDEX('{t}'!${col}:${col},"
        f"MATCH(DATEVALUE({date_ref}),"
        f"IFERROR(DATEVALUE('{t}'!$A:$A),0),0)),0)"
    )


def sum_formula(metric: str, date_ref: str) -> str:
    """Builds '=part+part+...' across all agents for one metric."""
    parts = []
    for _, tab, fmt in AGENTS:
        col = CHAT_COLS[metric] if fmt == "chat" else SDR_COLS[metric]
        parts.append(_im(tab, col, date_ref))
    return "=" + "+".join(parts)


def active_agents_formula(date_ref: str) -> str:
    """Count of agents with non-zero sales on date_ref."""
    parts = []
    for _, tab, fmt in AGENTS:
        col = CHAT_COLS["sales"] if fmt == "chat" else SDR_COLS["sales"]
        t = tab.replace("'", "''")
        parts.append(
            f"(IFERROR(INDEX('{t}'!${col}:${col},"
            f"MATCH(DATEVALUE({date_ref}),"
            f"IFERROR(DATEVALUE('{t}'!$A:$A),0),0)),0)>0)*1"
        )
    return "=" + "+".join(parts)


# ── Colour palette ────────────────────────────────────────────────────────────
def rgb(r: int, g: int, b: int) -> Color:
    return Color(r / 255, g / 255, b / 255)


P = {
    "navy":     rgb(30,  61,  89),
    "white":    rgb(255, 255, 255),
    "gold":     rgb(184, 148, 62),
    "date_bg":  rgb(232, 240, 232),   # soft sage green (matches agent tabs)
    "date_fg":  rgb(39,  78,  19),
    "sales_bg": rgb(235, 251, 238),
    "kpi_bg":   rgb(255, 251, 235),
    "zero_bg":  rgb(248, 248, 248),
    "dark":     rgb(15,  23,  42),
    "muted":    rgb(100, 116, 139),
}


def cl(col_idx: int) -> str:
    return rowcol_to_a1(1, col_idx)[:-1]


# ── Main ──────────────────────────────────────────────────────────────────────

def build_kpi_team(year: int, sh: gspread.Spreadsheet) -> None:
    # Date sequence: every day of the year, plus future days through Dec 31
    start = date(year, 1, 1)
    end   = date(year, 12, 31)
    dates = []
    d = start
    while d <= end:
        dates.append(d.strftime("%d/%m/%Y"))
        d += timedelta(days=1)

    N_COLS = 9   # Date | Sales | Bookings | Messages | Deposits | Conv Rate | Dep% | AOV | Active
    HDR = ["Date", "Team Sales", "Bookings", "Messages", "Deposits",
           "Conv Rate", "Dep %", "AOV", "Active Agents"]

    sheet_rows: list[list] = []
    sheet_rows.append([f"TEAM KPI — {year}"] + [""] * (N_COLS - 1))
    sheet_rows.append(HDR)

    for i, date_str in enumerate(dates):
        row_num = 3 + i   # 1-indexed sheet row; row 1=title, row 2=headers
        dr = f'"{date_str}"'   # literal date string for MATCH

        sheet_rows.append([
            date_str,
            sum_formula("sales",    dr),
            sum_formula("booked",   dr),
            sum_formula("messages", dr),
            sum_formula("deposits", dr),
            f"=IFERROR(C{row_num}/D{row_num},\"\")",
            f"=IFERROR(E{row_num}/C{row_num},\"\")",
            f"=IFERROR(B{row_num}/C{row_num},\"\")",
            active_agents_formula(dr),
        ])

    # ── Write ─────────────────────────────────────────────────────────────────
    try:
        ws = sh.worksheet(TAB_NAME)
        ws.clear()
        sh.batch_update({"requests": [{"unmergeCells": {"range": {
            "sheetId": ws.id, "startRowIndex": 0, "endRowIndex": len(sheet_rows) + 5,
            "startColumnIndex": 0, "endColumnIndex": N_COLS + 2,
        }}}]})
    except gspread.exceptions.WorksheetNotFound:
        ws = sh.add_worksheet(TAB_NAME, rows=len(sheet_rows) + 20, cols=N_COLS + 2)

    ws.update(range_name="A1", values=sheet_rows, value_input_option="USER_ENTERED")
    print(f"  Wrote {len(sheet_rows)} rows × {N_COLS} cols")

    # ── Format ────────────────────────────────────────────────────────────────
    LC = cl(N_COLS)
    n_data = len(dates)
    DS = 3          # data start row (1-indexed)
    DE = 2 + n_data # data end row

    fmt: list[tuple[str, CellFormat]] = []

    def add(rng: str, f: CellFormat) -> None:
        fmt.append((rng, f))

    # Title row
    add(f"A1:{LC}1", CellFormat(
        backgroundColor=P["navy"],
        textFormat=TextFormat(bold=True, fontSize=11, foregroundColor=P["white"], fontFamily="Arial"),
        horizontalAlignment="LEFT", verticalAlignment="MIDDLE",
    ))

    # Header row
    add(f"A2:{LC}2", CellFormat(
        backgroundColor=P["gold"],
        textFormat=TextFormat(bold=True, fontSize=9, foregroundColor=P["white"], fontFamily="Arial"),
        horizontalAlignment="CENTER", verticalAlignment="MIDDLE",
    ))

    if n_data > 0:
        # Date column
        add(f"A{DS}:A{DE}", CellFormat(
            backgroundColor=P["date_bg"],
            textFormat=TextFormat(bold=True, fontSize=9, foregroundColor=P["date_fg"], fontFamily="Arial"),
            horizontalAlignment="CENTER",
        ))
        # Sales column
        add(f"B{DS}:B{DE}", CellFormat(
            backgroundColor=P["sales_bg"],
            textFormat=TextFormat(fontSize=9, foregroundColor=P["dark"], fontFamily="Arial"),
            horizontalAlignment="CENTER",
        ))
        # Count cols C-E
        add(f"C{DS}:E{DE}", CellFormat(
            backgroundColor=P["white"],
            textFormat=TextFormat(fontSize=9, foregroundColor=P["dark"], fontFamily="Arial"),
            horizontalAlignment="CENTER",
        ))
        # KPI cols F-H
        add(f"F{DS}:H{DE}", CellFormat(
            backgroundColor=P["kpi_bg"],
            textFormat=TextFormat(fontSize=9, foregroundColor=P["dark"], fontFamily="Arial"),
            horizontalAlignment="CENTER",
        ))
        # Active agents
        add(f"I{DS}:I{DE}", CellFormat(
            backgroundColor=P["white"],
            textFormat=TextFormat(fontSize=9, foregroundColor=P["muted"], fontFamily="Arial"),
            horizontalAlignment="CENTER",
        ))

        # Number formats
        add(f"B{DS}:B{DE}", CellFormat(numberFormat={"type": "CURRENCY", "pattern": "€#,##0"}))
        add(f"F{DS}:G{DE}", CellFormat(numberFormat={"type": "PERCENT", "pattern": "0.0%"}))
        add(f"H{DS}:H{DE}", CellFormat(numberFormat={"type": "CURRENCY", "pattern": "€#,##0.00"}))

    format_cell_ranges(ws, fmt)

    # Freeze first, then merge title row
    set_frozen(ws, rows=2, cols=0)
    ws.merge_cells(f"A1:{LC}1")

    # Sizes
    set_column_width(ws, "A", 90)
    set_column_width(ws, "B", 88)
    for letter in ("C", "D", "E", "F", "G", "H", "I"):
        set_column_width(ws, letter, 78)
    set_row_height(ws, "1", 30)
    set_row_height(ws, "2", 32)
    if n_data > 0:
        set_row_height(ws, f"{DS}:{DE}", 20)

    print(f"  Formatting done — KPI-Team ready for {year}")
    print(f"  https://docs.google.com/spreadsheets/d/{SPREADSHEET_ID}/edit#gid={ws.id}")


# ── Fix column-A formatting on raw agent tabs ─────────────────────────────────

def fix_agent_tab_formatting(sh: gspread.Spreadsheet) -> None:
    """
    For each raw agent tab, copies the date-cell format from the first real
    data row (row 3) to every row that has content in column A.
    This fixes inconsistent shading when future dates were manually added.
    """
    raw_tab_names = [name for _, name, _ in AGENTS]

    for tab_name in raw_tab_names:
        try:
            ws = sh.worksheet(tab_name)
        except gspread.exceptions.WorksheetNotFound:
            print(f"  SKIP: tab '{tab_name}' not found")
            continue

        # Find how many rows have dates in col A (starting from row 3)
        col_a = ws.col_values(1)   # all values in col A
        n_date_rows = sum(1 for v in col_a[2:] if v.strip())   # skip header rows 1-2

        if n_date_rows == 0:
            print(f"  {tab_name}: no date rows, skipping")
            continue

        # copyPaste PASTE_FORMAT from row 3 (0-indexed: row 2) to all date rows
        # Source is the single first data row; Sheets tiles it over the destination
        sh.batch_update({"requests": [{
            "copyPaste": {
                "source": {
                    "sheetId":          ws.id,
                    "startRowIndex":    2,   # row 3 (0-indexed)
                    "endRowIndex":      3,
                    "startColumnIndex": 0,   # col A
                    "endColumnIndex":   1,
                },
                "destination": {
                    "sheetId":          ws.id,
                    "startRowIndex":    2,   # start from row 3
                    "endRowIndex":      2 + n_date_rows,
                    "startColumnIndex": 0,
                    "endColumnIndex":   1,
                },
                "pasteType":        "PASTE_FORMAT",
                "pasteOrientation": "NORMAL",
            }
        }]})
        print(f"  {tab_name}: fixed {n_date_rows} date rows")


# ── Entry point ───────────────────────────────────────────────────────────────

def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--year",         type=int, default=date.today().year,
                        help="Year to generate (default: current year)")
    parser.add_argument("--skip-fmt-fix", action="store_true",
                        help="Skip fixing column-A formatting on raw agent tabs")
    args = parser.parse_args()

    sh = gc.open_by_key(SPREADSHEET_ID)

    print(f"Building formula-based KPI-Team for {args.year}…")
    build_kpi_team(args.year, sh)

    if not args.skip_fmt_fix:
        print("\nFixing column-A date formatting on raw agent tabs…")
        fix_agent_tab_formatting(sh)

    print("\nDone.")


if __name__ == "__main__":
    main()
