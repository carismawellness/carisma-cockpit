"""
Diagnose specific dates in the KPI-Team tab by reading the raw agent tabs
and showing exactly what data exists for each agent on that date.

Usage:
  python3 Tools/diagnose_kpi_dates.py
  python3 Tools/diagnose_kpi_dates.py --dates 2026-04-15 2026-05-21

Reads UNFORMATTED_VALUE (raw serials) and FORMATTED_VALUE (display string)
so we can see both the actual serial stored and how it displays.
"""

import argparse
import json
from datetime import date as date_cls, timedelta
from pathlib import Path

try:
    import gspread
    from google.oauth2.credentials import Credentials
    from google.auth.transport.requests import Request
except ImportError:
    import subprocess, sys
    subprocess.check_call([sys.executable, "-m", "pip", "install",
                           "gspread", "google-auth", "google-auth-oauthlib"])
    import gspread
    from google.oauth2.credentials import Credentials
    from google.auth.transport.requests import Request

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

SPREADSHEET_ID = "1bHF_7bXic08pcyXQhq310zG6McqXD50oT0EuVkjzDdI"
SHEET_EPOCH    = date_cls(1899, 12, 30)

# (slug, tab_name, type, total_sales_col, bookings_col, messages_col)
AGENTS = [
    ("adeel",    "Adeel",    "chat", "R", "O", "N"),
    ("rana",     "Rana",     "chat", "R", "O", "N"),
    ("abid",     "Abid",     "chat", "R", "O", "N"),
    ("km",       "K&M",      "chat", "R", "O", "N"),
    ("vj",       "VJ",       "sdr",  "O", "P", "S"),
    ("dorianne", "Dorianne", "sdr",  "O", "P", "S"),
    ("juliana",  "Juliana",  "sdr",  "O", "P", "S"),
    ("anni",     "Anni",     "sdr",  "O", "P", "S"),
    ("nicci",    "Nicci",    "sdr",  "O", "P", "S"),
    ("nathalia", "Nathalia", "sdr",  "O", "P", "S"),
    ("april",    "April",    "sdr",  "O", "P", "S"),
    ("queenee",  "Queenee",  "sdr",  "O", "P", "S"),
]

# Convert col letter to 0-indexed
def col_idx(letter: str) -> int:
    letter = letter.upper()
    idx = 0
    for c in letter:
        idx = idx * 26 + (ord(c) - ord('A') + 1)
    return idx - 1


def serial_to_date(val: float) -> date_cls:
    return SHEET_EPOCH + timedelta(days=int(val))


def diagnose_date(sh: gspread.Spreadsheet, target: date_cls) -> None:
    print(f"\n{'='*70}")
    print(f"  DIAGNOSIS: {target.strftime('%d/%m/%Y')}  ({target.isoformat()})")
    print(f"{'='*70}")

    total_sales = 0.0
    total_booked = 0
    total_messages = 0
    active = 0

    for slug, tab_name, atype, s_col, b_col, m_col in AGENTS:
        try:
            ws = sh.worksheet(tab_name)
        except Exception as e:
            print(f"  {tab_name:12s} — ERROR opening tab: {e}")
            continue

        # Read col A raw (serial/text) and formatted (display string)
        raw_a  = ws.get("A3:A600", value_render_option="UNFORMATTED_VALUE")
        fmt_a  = ws.get("A3:A600", value_render_option="FORMATTED_VALUE")

        # Find the row with the target date
        found_row = None
        for i, row in enumerate(raw_a):
            val = row[0] if row else ""
            if isinstance(val, (int, float)):
                stored = serial_to_date(val)
                if stored == target:
                    found_row = i + 3  # 1-indexed sheet row
                    break
            elif isinstance(val, str) and val.strip():
                # Try to read as "YYYY-MM-DD" (already normalized)
                try:
                    d = date_cls.fromisoformat(val.strip())
                    if d == target:
                        found_row = i + 3
                        break
                except ValueError:
                    pass

        if found_row is None:
            display_a = fmt_a[0][0] if fmt_a and fmt_a[0] else "?"
            # Show what the first few dates look like for debugging
            first_dates = [
                f"{(fmt_a[j][0] if fmt_a[j] else '?')}"
                for j in range(min(5, len(fmt_a)))
            ]
            print(f"  {tab_name:12s} — DATE NOT FOUND  (first 5 col-A: {first_dates})")
            continue

        # Read the data row
        # Read enough columns to cover all relevant cols
        data_raw = ws.get(
            f"A{found_row}:T{found_row}",
            value_render_option="UNFORMATTED_VALUE",
        )
        row_data = data_raw[0] if data_raw else []

        def cell(col: str) -> float:
            idx = col_idx(col)
            if idx >= len(row_data):
                return 0.0
            v = row_data[idx]
            return float(v) if isinstance(v, (int, float)) else 0.0

        sales    = cell(s_col)
        bookings = int(cell(b_col))
        messages = int(cell(m_col))

        total_sales   += sales
        total_booked  += bookings
        total_messages += messages
        if sales > 0:
            active += 1

        print(
            f"  {tab_name:12s}  row={found_row:4d}  "
            f"sales=€{sales:8.2f}  booked={bookings:4d}  msgs={messages:4d}  "
            f"[{atype}, sales_col={s_col}]"
        )

    print(f"\n  TOTALS → sales=€{total_sales:.2f}  booked={total_booked}  "
          f"msgs={total_messages}  active_agents={active}")


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument(
        "--dates", nargs="*",
        default=["2026-04-15", "2026-05-21"],
        help="ISO dates to diagnose (default: 2026-04-15 2026-05-21)",
    )
    args = parser.parse_args()

    sh = gc.open_by_key(SPREADSHEET_ID)

    for d_str in args.dates:
        try:
            target = date_cls.fromisoformat(d_str)
            diagnose_date(sh, target)
        except ValueError as e:
            print(f"Bad date '{d_str}': {e}")

    print("\nDone.")


if __name__ == "__main__":
    main()
