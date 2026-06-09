"""
Normalize column-A date values across all 12 agent raw tabs.

The CRM Master Sheet uses US locale (MM/DD/YYYY). Agents enter dates in
DD/MM/YYYY European format, which causes two classes of corruption:

  - Day ≤ 12: "1/5/2026" → Sheets reads as Jan 5 (month=1, day=5)
    Cell stores serial 46027 (2026-01-05) instead of intended 2026-05-01.
  - Day > 12: "13/05/2026" → Sheets can't parse as US date → stored as text.

Fix strategy for each col-A cell:
  - integer/float (date serial) → swap stored.day↔stored.month to recover EU intent
  - string "DD/MM/YYYY" → parse EU format, write back as ISO "YYYY-MM-DD"

Both cases write ISO "YYYY-MM-DD" with value_input_option="USER_ENTERED"
so Sheets stores a proper date serial regardless of spreadsheet locale.

After running this script, rebuild KPI-Team with:
  python3 Tools/build_kpi_team.py
"""

import json
import re
import sys
from datetime import date as date_cls, timedelta
from pathlib import Path

try:
    import gspread
    from google.oauth2.credentials import Credentials
    from google.auth.transport.requests import Request
except ImportError:
    import subprocess
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
SHEET_EPOCH    = date_cls(1899, 12, 30)   # Google Sheets date epoch
MAX_ROWS       = 500                       # more than enough per agent tab

AGENT_TABS = [
    "Adeel", "Rana", "Abid", "K&M",
    "VJ", "Dorianne", "Juliana", "Anni",
    "Nicci", "Nathalia", "April", "Queenee",
]


def serial_to_date(serial: float) -> date_cls:
    return SHEET_EPOCH + timedelta(days=int(serial))


def swap_dm(d: date_cls) -> date_cls:
    """
    Swap day↔month to undo US-locale misparse of a DD/MM/YYYY entry.

    When an agent enters "05/03/2026" (March 5), Sheets in US locale stores
    month=5, day=3 (May 3). Swapping recovers: month=3, day=5 (March 5).

    Only fails if stored.day > 12, which never occurs for date serials
    (those only arise when both day and month ≤ 12 in the original entry).
    """
    try:
        return date_cls(d.year, d.day, d.month)
    except ValueError:
        return d  # stored serial is already correct; leave untouched


def parse_eu_text(s: str) -> date_cls | None:
    """Parse 'DD/MM/YYYY' or 'D/M/YYYY' text → date."""
    m = re.match(r'^(\d{1,2})/(\d{1,2})/(\d{2,4})$', s.strip())
    if not m:
        return None
    day, mon, y = int(m.group(1)), int(m.group(2)), int(m.group(3))
    y = 2000 + y if y < 100 else y
    try:
        return date_cls(y, mon, day)
    except ValueError:
        return None


def normalize_tab(ws: gspread.Worksheet) -> int:
    raw = ws.get(f"A3:A{2 + MAX_ROWS}", value_render_option="UNFORMATTED_VALUE")
    if not raw:
        return 0

    corrected: list[list] = []
    changes = 0

    for row in raw:
        val = row[0] if row else ""

        if val == "" or (isinstance(val, str) and val.strip().lower() in ("", "date")):
            corrected.append([""])
            continue

        fixed: date_cls | None = None

        if isinstance(val, (int, float)):
            stored = serial_to_date(val)
            swapped = swap_dm(stored)
            # Idempotency guard: if swap produces the same date (day == month)
            # or would create an impossible date, the serial is already correct.
            if swapped == stored:
                corrected.append([val])
                continue
            fixed = swapped
        elif isinstance(val, str) and val.strip():
            fixed = parse_eu_text(val)

        if fixed is not None:
            corrected.append([fixed.strftime("%Y-%m-%d")])
            changes += 1
        else:
            corrected.append([val])

    if changes:
        end_row = 2 + len(corrected)
        ws.update(
            values=corrected,
            range_name=f"A3:A{end_row}",
            value_input_option="USER_ENTERED",
        )

    return changes


def main() -> None:
    sh    = gc.open_by_key(SPREADSHEET_ID)
    total = 0

    print("Normalizing agent tab dates…\n")
    for tab in AGENT_TABS:
        try:
            ws     = sh.worksheet(tab)
            n      = normalize_tab(ws)
            total += n
            label  = f"corrected {n} cells" if n else "nothing to change"
            print(f"  {tab}: {label}")
        except Exception as e:
            print(f"  {tab}: ERROR — {e}")

    print(f"\nTotal date cells corrected: {total}")
    print("Next step: python3 Tools/build_kpi_team.py")


if __name__ == "__main__":
    main()
