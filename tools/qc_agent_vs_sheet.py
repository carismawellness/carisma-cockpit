"""
QC script: compare one agent's May 2026 totals in the CRM Master sheet
vs Supabase crm_agent_daily.

Usage:
  python3 Tools/qc_agent_vs_sheet.py <slug> [<start_date> <end_date>]

Outputs a comparison block per agent: sheet sums, Supabase sums, deltas,
and a likely-cause hypothesis when they don't match.
"""

from __future__ import annotations

import json
import os
import re
import sys
import urllib.request
import urllib.error
from datetime import date, datetime
from pathlib import Path

# ── Env loading (mirrors sync_crm_agents_to_supabase.py) ──────────────────────
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

# ── Google auth (reuses go-google-mcp token) ──────────────────────────────────
import gspread  # noqa: E402
from google.oauth2.credentials import Credentials  # noqa: E402
from google.auth.transport.requests import Request  # noqa: E402

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

AGENTS = {
    "adeel":    "Adeel",
    "rana":     "Rana",
    "abid":     "Abid",
    "km":       "K&M",
    "vj":       "VJ",
    "dorianne": "Dorianne",
    "juliana":  "Juliana",
    "anni":     "Anni",
    "nicci":    "Nicci",
    "nathalia": "Nathalia",
    "april":    "April",
    "queenee":  "Queenee",
}

SUPABASE_URL = (
    os.environ.get("SUPABASE_URL")
    or os.environ.get("NEXT_PUBLIC_SUPABASE_URL")
    or ""
).rstrip("/")
SUPABASE_KEY = os.environ.get("SUPABASE_SERVICE_ROLE_KEY") or ""

# ── Parsing helpers ───────────────────────────────────────────────────────────
def _cell(row: list, idx: int) -> str:
    try:
        return str(row[idx]).strip() if idx < len(row) else ""
    except (IndexError, TypeError):
        return ""

def parse_currency(val: str) -> float:
    v = re.sub(r"[€,\s]", "", val.strip())
    if not v: return 0.0
    try: return float(v)
    except ValueError: return 0.0

def parse_integer(val: str) -> int:
    v = re.sub(r"[^\d]", "", val.strip())
    if not v: return 0
    try: return int(v)
    except ValueError: return 0

def parse_percent(val: str) -> float:
    v = val.strip().rstrip("%").strip()
    if not v: return 0.0
    try: return float(v)
    except ValueError: return 0.0

def parse_date(val: str):
    """Match the Vercel route's date parser exactly: try M/D first, swap if month > 12."""
    v = val.strip()
    if not v or v.lower() == "date":
        return None
    m = re.match(r"^(\d{1,2})/(\d{1,2})/(\d{2,4})$", v)
    if not m:
        try:
            return datetime.strptime(v, "%Y-%m-%d").date()
        except ValueError:
            return None
    mo, d, y = m.group(1), m.group(2), m.group(3)
    if len(y) == 2:
        y = f"20{y}"
    if int(mo) > 12:
        mo, d = d, mo
    if int(mo) > 12 or int(d) > 31 or int(mo) < 1 or int(d) < 1:
        return None
    return date(int(y), int(mo), int(d))

# ── Layout detection ──────────────────────────────────────────────────────────
def detect_layout(header_rows: list[list[str]]) -> str:
    """Return 'sdr' if the tab uses Outbound/Inbound/Chat/Total/KPIs layout,
    otherwise 'chat' (Live Chat/CRM/Other/Total layout)."""
    flat = " ".join(c.lower() for r in header_rows[:2] for c in r)
    if "outbound" in flat and "inbound" in flat:
        return "sdr"
    return "chat"

# ── Sum the sheet across a date range ─────────────────────────────────────────
def sum_sheet_for_range(slug: str, tab_name: str, start: date, end: date) -> dict:
    sh = gc.open_by_key(SPREADSHEET_ID)
    ws = sh.worksheet(tab_name)
    raw = ws.get_all_values()
    layout = detect_layout(raw[:2])

    # Match sync's de-dup policy: last row for a given date wins.
    by_date: dict[str, dict] = {}

    def messages_for(row):
        # Must match app/api/etl/crm-agents/route.ts:
        #   SDR  → total_messages = outbound_dials + inbound_received + chat_convs
        #   chat → total_messages = col 13 (Total Messages from the sheet)
        if layout == "sdr":
            return (parse_integer(_cell(row, 2))
                    + parse_integer(_cell(row, 7))
                    + parse_integer(_cell(row, 11)))
        return parse_integer(_cell(row, 13))

    if layout == "sdr":
        SALES_COL, BOOKED_COL, DEP_COL = 14, 15, 16
    else:
        SALES_COL, BOOKED_COL, DEP_COL = 17, 14, 15

    for row in raw[2:]:
        raw_date = _cell(row, 0)
        if not raw_date: continue
        d = parse_date(raw_date)
        if d is None: continue
        if d < start or d > end: continue
        by_date[d.isoformat()] = {
            "sales":    parse_currency(_cell(row, SALES_COL)),
            "bookings": parse_integer(_cell(row, BOOKED_COL)),
            "deposits": parse_integer(_cell(row, DEP_COL)),
            "messages": messages_for(row),
        }

    sales    = round(sum(r["sales"]    for r in by_date.values()), 2)
    bookings = sum(r["bookings"] for r in by_date.values())
    deposits = sum(r["deposits"] for r in by_date.values())
    messages = sum(r["messages"] for r in by_date.values())
    active_sales_days = sum(1 for r in by_date.values() if r["sales"] > 0)
    return {
        "layout": layout,
        "rows_in_range": len(by_date),
        "sales": sales,
        "bookings": bookings,
        "deposits": deposits,
        "messages": messages,
        "active_sales_days": active_sales_days,
    }

# ── Sum Supabase for the same agent + range ───────────────────────────────────
def sum_supabase_for_range(slug: str, start: date, end: date) -> dict:
    if not SUPABASE_URL or not SUPABASE_KEY:
        raise RuntimeError("Supabase env vars missing")
    qs = (
        f"agent_slug=eq.{slug}"
        f"&date=gte.{start.isoformat()}"
        f"&date=lte.{end.isoformat()}"
        f"&select=date,total_sales,total_booked,total_deposit_count,total_messages,lc_sales,crm_sales,other_sales"
    )
    req = urllib.request.Request(
        f"{SUPABASE_URL}/rest/v1/crm_agent_daily?{qs}",
        headers={"apikey": SUPABASE_KEY, "Authorization": f"Bearer {SUPABASE_KEY}"},
    )
    with urllib.request.urlopen(req) as r:
        rows = json.loads(r.read().decode())

    sales = sum(float(x["total_sales"] or 0) for x in rows)
    bookings = sum(int(x["total_booked"] or 0) for x in rows)
    deposits = sum(int(x["total_deposit_count"] or 0) for x in rows)
    messages = sum(int(x["total_messages"] or 0) for x in rows)
    return {
        "rows_in_range": len(rows),
        "sales": round(sales, 2),
        "bookings": bookings,
        "deposits": deposits,
        "messages": messages,
    }

# ── Reporting ─────────────────────────────────────────────────────────────────
def fmt_delta(sheet_val, db_val):
    diff = db_val - sheet_val
    if sheet_val == 0:
        pct = "n/a" if db_val == 0 else "∞"
    else:
        pct = f"{(diff / sheet_val) * 100:+.1f}%"
    return f"{diff:+.2f} ({pct})"

def main():
    if len(sys.argv) < 2:
        print("Usage: python3 qc_agent_vs_sheet.py <slug> [start end]")
        sys.exit(1)
    slug = sys.argv[1].lower()
    if slug not in AGENTS:
        print(f"Unknown slug '{slug}'. Available: {', '.join(AGENTS)}")
        sys.exit(1)

    start = date(2026, 5, 1)
    end   = date(2026, 5, 31)
    if len(sys.argv) >= 4:
        start = datetime.strptime(sys.argv[2], "%Y-%m-%d").date()
        end   = datetime.strptime(sys.argv[3], "%Y-%m-%d").date()

    tab = AGENTS[slug]
    sheet = sum_sheet_for_range(slug, tab, start, end)
    db = sum_supabase_for_range(slug, start, end)

    print(f"┌─ QC: {tab} ({slug}) · {start} → {end}")
    print(f"│ sheet layout detected: {sheet['layout']}")
    print(f"│ rows in range — sheet: {sheet['rows_in_range']}, db: {db['rows_in_range']}")
    print(f"│")
    print(f"│ {'metric':14} {'sheet':>14} {'supabase':>14} {'delta':>22}")
    print(f"│ {'-'*14} {'-'*14:>14} {'-'*14:>14} {'-'*22:>22}")
    for k in ("sales", "bookings", "deposits", "messages"):
        sv = sheet[k]; dv = db[k]
        match = "✓" if abs(dv - sv) < 0.01 else "✗"
        print(f"│ {k:14} {sv:>14} {dv:>14} {fmt_delta(sv, dv):>22} {match}")
    print(f"└─")

    diffs = []
    for k in ("sales", "bookings", "deposits", "messages"):
        if abs(db[k] - sheet[k]) > 0.01:
            diffs.append(k)
    if diffs:
        print(f"\nDISCREPANCY in {', '.join(diffs)}")
        if sheet["layout"] == "sdr" and slug != "nathalia":
            print(f"LIKELY CAUSE: sheet is SDR layout but sync script only treats 'nathalia' as SDR.")
            print(f"FIX: add '{slug}' to SDR_AGENTS in Tools/sync_crm_agents_to_supabase.py and re-run sync.")
        else:
            print(f"Check column mapping for {slug} (layout={sheet['layout']}).")
    else:
        print("\nMATCH — sheet and Supabase are aligned.")

if __name__ == "__main__":
    main()
