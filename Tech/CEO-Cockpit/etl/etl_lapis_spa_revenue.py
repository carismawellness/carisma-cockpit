"""
ETL: Lapis + Zoho Books → Supabase spa_revenue_monthly

Revenue lines per location per month:
  1. Services       — Lapis Service tab  (Unit Price ÷ 1.18, Status=Given|Unplanned)
  2. Product        — Lapis Product tab  (VAT Exclusive Amount, split by Brand)
       sub-lines: product_phytomer | product_purest | product_other
  3. Wholesale      — Zoho Books P&L     (506000, 506200, 506300 — split equally)
  4. Sales Discount — Zoho Books P&L     (20000  — split by sales_ratio)
  5. Sales Refund   — Zoho Books P&L     (SALREF — split by sales_ratio)

Usage:
    cd etl
    py etl_lapis_spa_revenue.py --date-from 2026-01-01 --date-to 2026-04-30
    py etl_lapis_spa_revenue.py --date-from 2026-03-01 --date-to 2026-03-31 --force
"""
import sys
sys.stdout.reconfigure(encoding="utf-8", errors="replace")
sys.stderr.reconfigure(encoding="utf-8", errors="replace")

import argparse
import calendar
import csv
import io
from collections import defaultdict
from datetime import date, datetime, timezone
from pathlib import Path

try:
    import requests
    from dotenv import load_dotenv
except ImportError:
    import subprocess
    subprocess.check_call([sys.executable, "-m", "pip", "install", "requests", "python-dotenv"])
    import requests
    from dotenv import load_dotenv

load_dotenv(Path(__file__).resolve().parents[3] / ".env")

from zoho_books_client import ZohoBooksClient
from shared.supabase_client import upsert, select
from shared.etl_logger import ETLLogger

# ── Constants ─────────────────────────────────────────────────────────────────

SHEET_ID = "195RvbNuZd-oNL-rziKC3Wz6ndy0cDA_a"
SERVICE_GID = "683143306"
PRODUCT_GID  = "1271322967"
VAT_RATE     = 0.18

# Lapis Sales Point → location_id (matches locations table)
LAPIS_SPA_MAP: dict[str, int] = {
    "HUGOS":                         2,   # Hugos
    "INTER":                         1,   # InterContinental
    "RAMLA":                         4,   # Ramla
    "SUNNY COAST":                   6,   # Sunny Coast / Odycy
    "SALES POINT OF EXCELSIOR":      7,   # Excelsior
    "HYATT":                         3,   # Hyatt
    "LABRANDA GENERAL SALES POINT":  5,   # Labranda
    "SALES POINT OF NOV":            8,   # Novotel
}
ALL_LOCATION_IDS = [1, 2, 3, 4, 5, 6, 7, 8]

# Zoho account codes for each revenue line
WHOLESALE_ACCOUNTS  = {"506000", "506200", "506300"}
DISCOUNT_ACCOUNTS   = {"20000"}
REFUND_ACCOUNTS     = {"SALREF"}

# Lapis brand → product column
BRAND_MAP: dict[str, str] = {
    "PHYTOMER": "product_phytomer",
    "PUREST":   "product_purest",
}
# anything not in BRAND_MAP → product_other


# ── Helpers ───────────────────────────────────────────────────────────────────

def fetch_lapis_csv(gid: str) -> list[dict]:
    """Fetch a Lapis sheet tab as list-of-dicts (no auth required — sheet is public).

    The Lapis sheets prefix data with a single-cell title row like
    "Service data is from 1 Jan 2025,,,,," — skip rows with fewer than 3
    non-empty cells to find the real header row (same logic as TypeScript ETL).
    """
    url = f"https://docs.google.com/spreadsheets/d/{SHEET_ID}/export?format=csv&gid={gid}"
    r = requests.get(url, timeout=30)
    r.raise_for_status()
    lines = r.text.splitlines()
    # Find the first row with >= 3 non-empty cells — that's the real header
    header_idx = 0
    for i, line in enumerate(lines[:5]):
        cells = next(csv.reader(io.StringIO(line)))
        if sum(1 for c in cells if c.strip()) >= 3:
            header_idx = i
            break
    reader = csv.DictReader(io.StringIO("\n".join(lines[header_idx:])))
    return list(reader)


def parse_lapis_date(raw: str) -> date | None:
    """Parse Lapis date strings in multiple formats:
      - d/m/yyyy  (service sheet:  "4/6/2026")
      - d/m/yy    (two-digit year: "4/6/26")
      - m/d/yyyy  (US fallback)
      - d Month yyyy (product sheet: "4 June 2026")
    """
    raw = raw.strip()
    if not raw:
        return None
    for fmt in ("%d/%m/%Y", "%d/%m/%y", "%m/%d/%Y", "%d %B %Y", "%d %b %Y"):
        try:
            return datetime.strptime(raw, fmt).date()
        except ValueError:
            continue
    return None


def month_key(d: date) -> str:
    return f"{d.year}-{d.month:02d}-01"


def strip(row: dict, key: str) -> str:
    """Get a stripped string value from a row, tolerating trailing spaces in key."""
    # Try exact, then stripped versions of keys
    for k in [key, key.strip(), key + " "]:
        if k in row:
            return str(row[k]).strip()
    return ""


def safe_float(val: str) -> float:
    try:
        return float(str(val).replace(",", "").strip() or "0")
    except ValueError:
        return 0.0


# ── Lapis data fetching ───────────────────────────────────────────────────────

def fetch_lapis_services(date_from: date, date_to: date) -> dict[int, dict[str, float]]:
    """
    Returns: {location_id: {month_key: services_ex_vat}}
    """
    print("  Fetching Lapis service data…")
    rows = fetch_lapis_csv(SERVICE_GID)
    print(f"  → {len(rows)} service rows in sheet")

    totals: dict[int, dict[str, float]] = defaultdict(lambda: defaultdict(float))

    for row in rows:
        status = strip(row, "Status")
        if status not in ("Given", "Unplanned"):
            continue

        raw_date = strip(row, "Service Date")
        d = parse_lapis_date(raw_date)
        if d is None or not (date_from <= d <= date_to):
            continue

        spa_raw = strip(row, "Sales Point")
        loc_id  = LAPIS_SPA_MAP.get(spa_raw)
        if loc_id is None:
            continue

        unit_price = safe_float(strip(row, "Unit Price"))
        amount_ex  = round(unit_price / (1 + VAT_RATE), 2)
        totals[loc_id][month_key(d)] += amount_ex

    # Round to 2dp
    return {loc: {mk: round(v, 2) for mk, v in months.items()}
            for loc, months in totals.items()}


def fetch_lapis_products(date_from: date, date_to: date) -> dict[int, dict[str, dict[str, float]]]:
    """
    Returns: {location_id: {month_key: {col: amount}}}
    where col is one of product_phytomer | product_purest | product_other
    """
    print("  Fetching Lapis product data…")
    rows = fetch_lapis_csv(PRODUCT_GID)
    print(f"  → {len(rows)} product rows in sheet")

    totals: dict[int, dict[str, dict[str, float]]] = defaultdict(
        lambda: defaultdict(lambda: defaultdict(float))
    )

    for row in rows:
        raw_date = strip(row, "Date")
        d = parse_lapis_date(raw_date)
        if d is None or not (date_from <= d <= date_to):
            continue

        # Point of Sales column has trailing space in header
        spa_raw = strip(row, "Point of Sales") or strip(row, "Point of Sales ")
        loc_id  = LAPIS_SPA_MAP.get(spa_raw)
        if loc_id is None:
            continue

        amount = safe_float(strip(row, "VAT Exclusive Amount") or strip(row, "VAT Exclusive Amount "))
        if amount <= 0:
            continue

        brand     = strip(row, "Brand").upper()
        col       = BRAND_MAP.get(brand, "product_other")
        totals[loc_id][month_key(d)][col] += amount

    return {
        loc: {mk: {col: round(v, 2) for col, v in cols.items()}
              for mk, cols in months.items()}
        for loc, months in totals.items()
    }


# ── Zoho data fetching ────────────────────────────────────────────────────────

def walk_pl(obj, target_codes: set, result: dict[str, float]) -> None:
    """Walk a Zoho P&L response tree and accumulate totals for target account codes."""
    if isinstance(obj, list):
        for item in obj:
            walk_pl(item, target_codes, result)
    elif isinstance(obj, dict):
        code = str(obj.get("account_code", "") or "").strip()
        if code in target_codes:
            raw = obj.get("total", 0)
            try:
                result[code] = result.get(code, 0.0) + float(raw or 0)
            except (TypeError, ValueError):
                pass
        for v in obj.values():
            if isinstance(v, (list, dict)):
                walk_pl(v, target_codes, result)


def fetch_zoho_revenue_accounts(
    client: ZohoBooksClient,
    year: int,
    month: int,
    target_codes: set,
) -> dict[str, float]:
    """Fetch a Zoho Books P&L for one month and return totals per account code."""
    last_day = calendar.monthrange(year, month)[1]
    from_str = f"{year}-{month:02d}-01"
    to_str   = f"{year}-{month:02d}-{last_day:02d}"

    data = client.get("reports/profitandloss", params={
        "from_date":        from_str,
        "to_date":          to_str,
        "cash_based":       "false",
        "comparison_value": "0",
    })

    result: dict[str, float] = {}
    walk_pl(data, target_codes, result)
    return result


# ── Month processing ──────────────────────────────────────────────────────────

def run_month(
    year: int,
    month: int,
    lapis_services: dict,
    lapis_products: dict,
    zoho_client: ZohoBooksClient,
    force: bool,
) -> int:
    """Process one calendar month. Returns number of rows upserted."""
    mk = f"{year}-{month:02d}-01"
    now_ts = datetime.now(timezone.utc).isoformat()

    # Skip if already synced (unless --force)
    if not force:
        existing = select("spa_revenue_monthly", {"month": mk})
        synced_locs = {r["location_id"] for r in existing
                       if r.get("lapis_synced_at") and r.get("zoho_synced_at")}
        if len(synced_locs) == len(ALL_LOCATION_IDS):
            print(f"  {mk}: already synced, skipping (use --force to re-run)")
            return 0

    print(f"  Processing {mk}…")

    # ── Lapis services ────────────────────────────────────────────────────────
    # Pre-computed across all months; just pick this month's slice
    loc_services: dict[int, float] = {}
    for loc_id in ALL_LOCATION_IDS:
        loc_services[loc_id] = lapis_services.get(loc_id, {}).get(mk, 0.0)

    # ── Lapis products ────────────────────────────────────────────────────────
    loc_products: dict[int, dict[str, float]] = {}
    for loc_id in ALL_LOCATION_IDS:
        cols = lapis_products.get(loc_id, {}).get(mk, {})
        loc_products[loc_id] = {
            "product_phytomer": cols.get("product_phytomer", 0.0),
            "product_purest":   cols.get("product_purest",   0.0),
            "product_other":    cols.get("product_other",    0.0),
        }

    # ── Zoho: wholesale, discount, refund ─────────────────────────────────────
    all_target = WHOLESALE_ACCOUNTS | DISCOUNT_ACCOUNTS | REFUND_ACCOUNTS
    zoho_totals = fetch_zoho_revenue_accounts(zoho_client, year, month, all_target)

    total_wholesale = sum(abs(zoho_totals.get(c, 0.0)) for c in WHOLESALE_ACCOUNTS)
    total_discount  = abs(zoho_totals.get("20000",  0.0))
    total_refund    = abs(zoho_totals.get("SALREF", 0.0))

    # Split wholesale equally; split discount & refund by sales_ratio
    total_lapis = sum(
        loc_services[loc] + sum(loc_products[loc].values())
        for loc in ALL_LOCATION_IDS
    )

    rows_to_upsert = []
    for loc_id in ALL_LOCATION_IDS:
        loc_total = loc_services[loc_id] + sum(loc_products[loc_id].values())
        ratio     = (loc_total / total_lapis) if total_lapis > 0 else (1 / len(ALL_LOCATION_IDS))

        rows_to_upsert.append({
            "location_id":      loc_id,
            "month":            mk,
            "services":         round(loc_services[loc_id], 2),
            "product_phytomer": round(loc_products[loc_id]["product_phytomer"], 2),
            "product_purest":   round(loc_products[loc_id]["product_purest"],   2),
            "product_other":    round(loc_products[loc_id]["product_other"],    2),
            "wholesale":        round(total_wholesale / len(ALL_LOCATION_IDS), 2),
            "sales_discount":   round(total_discount * ratio, 2),
            "sales_refund":     round(total_refund   * ratio, 2),
            "lapis_synced_at":  now_ts,
            "zoho_synced_at":   now_ts,
        })

    count = upsert("spa_revenue_monthly", rows_to_upsert, "location_id,month")

    svc_total  = sum(loc_services[l] for l in ALL_LOCATION_IDS)
    prod_total = sum(sum(loc_products[l].values()) for l in ALL_LOCATION_IDS)
    print(
        f"  {mk}: services=€{svc_total:,.0f}  products=€{prod_total:,.0f}  "
        f"wholesale=€{total_wholesale:,.0f}  discount=€{total_discount:,.0f}  "
        f"refund=€{total_refund:,.0f}  → {count} rows upserted"
    )
    return count


# ── Main ──────────────────────────────────────────────────────────────────────

def main():
    parser = argparse.ArgumentParser(description="Lapis + Zoho → spa_revenue_monthly")
    parser.add_argument("--date-from", required=True, help="YYYY-MM-DD")
    parser.add_argument("--date-to",   required=True, help="YYYY-MM-DD")
    parser.add_argument("--force",     action="store_true", help="Re-sync even if already synced")
    args = parser.parse_args()

    date_from = date.fromisoformat(args.date_from)
    date_to   = date.fromisoformat(args.date_to)

    logger = ETLLogger("lapis_spa_revenue")
    logger.start()

    try:
        # ── Fetch all Lapis data upfront (one HTTP call per tab) ──────────────
        print("Fetching Lapis data (one-time fetch for full date range)…")
        lapis_services = fetch_lapis_services(date_from, date_to)
        lapis_products = fetch_lapis_products(date_from, date_to)

        # ── Iterate months ────────────────────────────────────────────────────
        zoho_client = ZohoBooksClient(org="spa")
        total_upserted = 0

        d = date(date_from.year, date_from.month, 1)
        while d <= date_to:
            count = run_month(
                d.year, d.month,
                lapis_services, lapis_products,
                zoho_client, args.force,
            )
            total_upserted += count
            # advance month
            if d.month == 12:
                d = date(d.year + 1, 1, 1)
            else:
                d = date(d.year, d.month + 1, 1)

        logger.complete(total_upserted)
        print(f"\nDone — {total_upserted} total rows upserted.")

    except Exception as e:
        logger.fail(str(e))
        print(f"ETL failed: {e}", file=sys.stderr)
        raise


if __name__ == "__main__":
    main()
