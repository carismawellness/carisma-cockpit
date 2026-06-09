"""
ETL: CRM Master Sheet → Supabase crm_agent_daily
Reads individual agent tabs from the CRM Master Sheet and upserts to Supabase.

Spreadsheet: 1bHF_7bXic08pcyXQhq310zG6McqXD50oT0EuVkjzDdI
Agents: Adeel, Rana, Abid, K&M, VJ, Dorianne, Juliana, Anni, Nicci, Nathalia, April, Queenee

Column structure (0-indexed):
  A[0]:  Date (DD/MM/YYYY)
  B[1]:  Live Chat - Sales (€480 format)
  C[2]:  Live Chat - Messages
  D[3]:  Live Chat - Booked
  E[4]:  Live Chat - w/Deposit
  F[5]:  CRM - Sales
  G[6]:  CRM - Messages
  H[7]:  CRM - Booked
  I[8]:  CRM - w/Deposit
  J[9]:  Other - Sales
  K[10]: Other - Messages
  L[11]: Other - Booked
  M[12]: Other - w/Deposit
  N[13]: Total - Messages
  O[14]: Total - Booked
  P[15]: Total - w/Deposit (deposit count)
  Q[16]: Rate (conversion rate %, e.g. "21.6%")
  R[17]: Total Sales (€950 format)
  S[18]: Deposit % (e.g. "63.6%")
  T[19]: AOV (e.g. "€86.36")

Data rows start at index 2 (rows 0 and 1 are headers).
"""

import sys
import os
import json
import re
import requests
from datetime import datetime
from pathlib import Path

# ── Env loading ───────────────────────────────────────────────────────────────
# Support both running from the repo root (.env) and from the cockpit context
# (.env.local). Mirrors the pattern used in Tools/escalation_check.py.
_REPO_ROOT = Path(__file__).resolve().parents[1]

def _load_env_file(path: Path) -> None:
    """Minimal .env file loader — no external dependency required."""
    if not path.exists():
        return
    with open(path, encoding="utf-8") as f:
        for line in f:
            line = line.strip()
            if not line or line.startswith("#") or "=" not in line:
                continue
            key, _, val = line.partition("=")
            key = key.strip()
            val = val.strip().strip('"').strip("'")
            os.environ.setdefault(key, val)

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

AGENTS = [
    ("adeel",    "Adeel"),
    ("rana",     "Rana"),
    ("abid",     "Abid"),
    ("km",       "K&M"),
    ("vj",       "VJ"),
    ("dorianne", "Dorianne"),
    ("juliana",  "Juliana"),
    ("anni",     "Anni"),
    ("nicci",    "Nicci"),
    ("nathalia", "Nathalia"),
    ("april",    "April"),
    ("queenee",  "Queenee"),
]

# ── Supabase REST client ──────────────────────────────────────────────────────
_SUPABASE_URL = (
    os.environ.get("SUPABASE_URL")
    or os.environ.get("NEXT_PUBLIC_SUPABASE_URL")
    or ""
).rstrip("/")
_SUPABASE_KEY = os.environ.get("SUPABASE_SERVICE_ROLE_KEY") or ""

if not _SUPABASE_URL or not _SUPABASE_KEY:
    print("ERROR: SUPABASE_URL / NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set.")
    sys.exit(1)


def _supabase_upsert(table: str, rows: list[dict], on_conflict: str) -> int:
    """POST rows to Supabase REST with upsert (merge-duplicates) semantics."""
    if not rows:
        return 0
    headers = {
        "apikey":        _SUPABASE_KEY,
        "Authorization": f"Bearer {_SUPABASE_KEY}",
        "Content-Type":  "application/json",
        "Prefer":        "return=representation,resolution=merge-duplicates",
    }
    url = f"{_SUPABASE_URL}/rest/v1/{table}?on_conflict={on_conflict}"
    resp = requests.post(url, headers=headers, data=json.dumps(rows), timeout=60)
    resp.raise_for_status()
    return len(resp.json()) if resp.text else 0


# ── Parse helpers ─────────────────────────────────────────────────────────────
def _cell(row: list, idx: int) -> str:
    """Safe cell access — returns empty string if out of bounds."""
    try:
        return str(row[idx]).strip() if idx < len(row) else ""
    except (IndexError, TypeError):
        return ""


def parse_currency(val: str) -> float:
    """Strip €, commas, whitespace → float. Returns 0.0 on empty/invalid."""
    v = re.sub(r"[€,\s]", "", val.strip())
    if not v:
        return 0.0
    try:
        return float(v)
    except ValueError:
        return 0.0


def parse_integer(val: str) -> int:
    """Strip non-numeric chars → int. Returns 0 on empty/invalid."""
    v = re.sub(r"[^\d]", "", val.strip())
    if not v:
        return 0
    try:
        return int(v)
    except ValueError:
        return 0


def parse_percent(val: str) -> float:
    """Strip % → float (raw percentage, e.g. 21.6 for 21.6%). Returns 0.0 on empty/invalid."""
    v = val.strip().rstrip("%").strip()
    if not v:
        return 0.0
    try:
        return float(v)
    except ValueError:
        return 0.0


def parse_date(val: str) -> str | None:
    """
    Parse DD/MM/YYYY or D/M/YYYY → ISO 'YYYY-MM-DD'.
    Returns None if the cell is empty, equals 'Date', or is not parseable.
    """
    v = val.strip()
    if not v or v.lower() == "date":
        return None
    for fmt in ("%d/%m/%Y", "%d/%m/%y"):
        try:
            return datetime.strptime(v, fmt).strftime("%Y-%m-%d")
        except ValueError:
            continue
    return None


# ── Main sync logic ───────────────────────────────────────────────────────────
def sync_agent(slug: str, tab_name: str, sh: gspread.Spreadsheet) -> int:
    """Read one agent tab, build rows, upsert to Supabase. Returns row count synced."""
    ws = sh.worksheet(tab_name)
    raw = ws.get_all_values()

    rows: list[dict] = []

    # Data rows start at index 2 (indices 0 and 1 are header rows)
    for row in raw[2:]:
        date_iso = parse_date(_cell(row, 0))
        if date_iso is None:
            continue  # skip header rows, blank rows, non-parseable dates

        record: dict = {
            "agent_slug":          slug,
            "date":                date_iso,
            # Live Chat
            "lc_sales":            parse_currency(_cell(row, 1)),
            "lc_messages":         parse_integer(_cell(row, 2)),
            "lc_booked":           parse_integer(_cell(row, 3)),
            "lc_deposit":          parse_integer(_cell(row, 4)),
            # CRM
            "crm_sales":           parse_currency(_cell(row, 5)),
            "crm_messages":        parse_integer(_cell(row, 6)),
            "crm_booked":          parse_integer(_cell(row, 7)),
            "crm_deposit":         parse_integer(_cell(row, 8)),
            # Other
            "other_sales":         parse_currency(_cell(row, 9)),
            "other_messages":      parse_integer(_cell(row, 10)),
            "other_booked":        parse_integer(_cell(row, 11)),
            "other_deposit":       parse_integer(_cell(row, 12)),
            # Totals
            "total_messages":      parse_integer(_cell(row, 13)),
            "total_booked":        parse_integer(_cell(row, 14)),
            "total_deposit_count": parse_integer(_cell(row, 15)),
            "conversion_rate_pct": parse_percent(_cell(row, 16)),
            "total_sales":         parse_currency(_cell(row, 17)),
            "deposit_pct":         parse_percent(_cell(row, 18)),
            "aov":                 parse_currency(_cell(row, 19)),
        }
        rows.append(record)

    count = _supabase_upsert("crm_agent_daily", rows, "agent_slug,date")
    return count


def main() -> None:
    sh = gc.open_by_key(SPREADSHEET_ID)
    total = 0
    for slug, tab_name in AGENTS:
        try:
            count = sync_agent(slug, tab_name, sh)
            print(f"Synced {slug}: {count} rows")
            total += count
        except gspread.exceptions.WorksheetNotFound:
            print(f"WARNING: Tab '{tab_name}' not found — skipping {slug}")
        except Exception as e:
            print(f"ERROR syncing {slug} ({tab_name}): {e}")
    print(f"\nTotal synced: {total} rows across {len(AGENTS)} agents")


if __name__ == "__main__":
    main()
