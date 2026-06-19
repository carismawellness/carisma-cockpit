"""
Fetch rent per month per spa from Zoho Books SPA org using the P&L report.

For each month in the range, queries the Profit & Loss report to get rent amounts
per account code. Groups by location, shows monthly amounts and account/vendor names.
Quarterly bill detection: flags months where amount is 3x the usual monthly amount.

Usage:
    cd etl
    py fetch_rent_bills.py
    py fetch_rent_bills.py --date-from 2025-01-01 --date-to 2026-04-30
"""
import sys
sys.stdout.reconfigure(encoding="utf-8", errors="replace")
sys.stderr.reconfigure(encoding="utf-8", errors="replace")

import argparse
import calendar
from collections import defaultdict
from datetime import date
from pathlib import Path

from dotenv import load_dotenv
load_dotenv(Path(__file__).resolve().parents[3] / ".env")

from zoho_books_client import ZohoBooksClient

# ── Rent account codes → location key ──────────────────────────────────────────
RENT_ACCOUNTS: dict[str, str] = {
    "619110": "ramla",
    "619120": "sunny_coast",
    "619121": "excelsior",
    "619123": "novotel",
    "619140": "intercontinental",
    "619150": "hyatt",
    "619160": "hugos",
    "10001":  "sunny_coast",
    "000":    "labranda",
    "619000": "equal",
    "619500": "equal",
    "619510": "equal",
    "619520": "equal",
    "619530": "equal",
    "7786":   "equal",
    "659162": "equal",
}

LOCATION_DISPLAY: dict[str, str] = {
    "intercontinental": "InterContinental",
    "hugos":            "Hugos",
    "hyatt":            "Hyatt",
    "ramla":            "Ramla Bay",
    "labranda":         "Labranda",
    "sunny_coast":      "Sunny Coast",
    "excelsior":        "Excelsior",
    "novotel":          "Novotel",
    "equal":            "(Shared/Equal split)",
}

ALL_LOCATIONS = ["intercontinental", "hugos", "hyatt", "ramla",
                 "labranda", "sunny_coast", "excelsior", "novotel", "equal"]


def fetch_rent_for_month(client: ZohoBooksClient, year: int, month: int) -> dict[str, dict[str, float]]:
    """Return {location: {account_name: amount}} for one month using P&L report."""
    last_day = calendar.monthrange(year, month)[1]
    from_str = f"{year}-{month:02d}-01"
    to_str   = f"{year}-{month:02d}-{last_day:02d}"

    data = client.get("reports/profitandloss", params={
        "from_date":        from_str,
        "to_date":          to_str,
        "cash_based":       "false",
        "comparison_value": "0",
    })

    result: dict[str, dict[str, float]] = defaultdict(dict)

    def walk(nodes: list) -> None:
        for node in nodes:
            code = str(node.get("account_code", "")).strip()
            name = node.get("account_name", "")
            if code in RENT_ACCOUNTS:
                loc = RENT_ACCOUNTS[code]
                # amount is in the "total" field for leaf accounts
                total = node.get("total")
                if total is None:
                    # Try pulling from the first period's value
                    for v in node.get("account_values", []):
                        total = v.get("debit") or v.get("credit") or v.get("total") or 0
                        break
                if total is None:
                    total = 0
                amount = abs(float(total))
                if amount > 0:
                    result[loc][f"{code} — {name}"] = amount
            # Recurse into children
            walk(node.get("sub_accounts", []) or node.get("child_accounts", []) or [])

    # P&L response structure: root has account_transactions or income/expense sections
    pl = data.get("profit_and_loss") or data
    for section_key in ("income", "expense", "operating_expenses", "account_transactions", "sections"):
        section = pl.get(section_key, [])
        if isinstance(section, list):
            walk(section)
        elif isinstance(section, dict):
            walk([section])

    # Also walk the top-level if it's a flat list
    if not result:
        walk(pl if isinstance(pl, list) else [])

    return result


def walk_pl_for_rent(nodes: list, result: dict) -> None:
    """Recursive P&L walker that handles Zoho's nested account structure."""
    for node in nodes:
        code = str(node.get("account_code", "")).strip()
        # P&L uses "name" field; CoA uses "account_name"
        name = node.get("name") or node.get("account_name", "")

        if code in RENT_ACCOUNTS:
            loc = RENT_ACCOUNTS[code]
            # Zoho P&L leaf nodes have "total" as a string or float
            raw = node.get("total", 0)
            try:
                amount = abs(float(raw))
            except (TypeError, ValueError):
                amount = 0.0
            if amount > 0:
                result[loc][f"{code} — {name}"] = amount

        # Recurse into children
        children = (
            node.get("sub_accounts")
            or node.get("child_accounts")
            or node.get("account_transactions")
            or []
        )
        if isinstance(children, list) and children:
            walk_pl_for_rent(children, result)


def fetch_pl_rent(client: ZohoBooksClient, year: int, month: int) -> dict[str, dict[str, float]]:
    """Return {location: {account_label: amount}} using P&L for one month."""
    last_day = calendar.monthrange(year, month)[1]
    from_str = f"{year}-{month:02d}-01"
    to_str   = f"{year}-{month:02d}-{last_day:02d}"

    data = client.get("reports/profitandloss", params={
        "from_date":        from_str,
        "to_date":          to_str,
        "cash_based":       "false",
        "comparison_value": "0",
    })

    result: dict[str, dict[str, float]] = defaultdict(dict)

    # Walk the full response tree
    def walk_any(obj):
        if isinstance(obj, list):
            for item in obj:
                walk_any(item)
        elif isinstance(obj, dict):
            walk_pl_for_rent([obj], result)
            for v in obj.values():
                if isinstance(v, (list, dict)):
                    walk_any(v)

    walk_any(data)
    return result


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--date-from", default=None, help="YYYY-MM-DD (default: Jan of last year)")
    parser.add_argument("--date-to",   default=None, help="YYYY-MM-DD (default: today)")
    args = parser.parse_args()

    today    = date.today()
    date_to  = date.fromisoformat(args.date_to)   if args.date_to   else today
    date_from = date.fromisoformat(args.date_from) if args.date_from else date(today.year - 1, 1, 1)

    client = ZohoBooksClient(org="spa")

    # ── Collect monthly data ──────────────────────────────────────────────────
    # Structure: {location: {month_key: {account_label: amount}}}
    loc_month_accounts: dict[str, dict[str, dict[str, float]]] = defaultdict(lambda: defaultdict(dict))

    months = []
    d = date(date_from.year, date_from.month, 1)
    while d <= date_to:
        months.append((d.year, d.month))
        if d.month == 12:
            d = date(d.year + 1, 1, 1)
        else:
            d = date(d.year, d.month + 1, 1)

    print(f"\nFetching P&L rent data for {len(months)} months ({date_from} → {date_to})…\n")

    for year, month in months:
        month_k = f"{year}-{month:02d}"
        sys.stdout.write(f"  {month_k}… ")
        sys.stdout.flush()
        try:
            rent = fetch_pl_rent(client, year, month)
            total_found = sum(sum(v.values()) for v in rent.values())
            sys.stdout.write(f"€{total_found:,.0f}\n")
            for loc, accs in rent.items():
                loc_month_accounts[loc][month_k].update(accs)
        except Exception as e:
            sys.stdout.write(f"ERROR: {e}\n")

    # ── Print results ─────────────────────────────────────────────────────────
    print("\n" + "═" * 100)
    print("  RENT PER LOCATION PER MONTH  —  Zoho Books SPA org")
    print("═" * 100)

    grand_totals: dict[str, float] = defaultdict(float)

    for loc in ALL_LOCATIONS:
        if loc not in loc_month_accounts:
            continue
        loc_name = LOCATION_DISPLAY.get(loc, loc)
        month_data = loc_month_accounts[loc]

        # Calculate monthly totals for quarterly detection
        monthly_totals = {mk: sum(v.values()) for mk, v in month_data.items()}
        non_zero = [v for v in monthly_totals.values() if v > 0]
        avg = sum(non_zero) / len(non_zero) if non_zero else 0

        print(f"\n{'─' * 100}")
        print(f"  {loc_name}")
        print(f"{'─' * 100}")
        print(f"  {'Month':<12} {'Amount':>12}   {'Accounts / Vendor'}  {'Note'}")
        print(f"  {'─'*11} {'─'*12}   {'─'*55}")

        for mk in sorted(month_data.keys()):
            accs  = month_data[mk]
            total = sum(accs.values())
            acc_names = " | ".join(
                name.split(" — ", 1)[1] if " — " in name else name
                for name in accs.keys()
            )

            note = ""
            if avg > 0 and total > avg * 2.2:
                monthly_share = total / 3
                note = f"  ← likely quarterly (÷3 = €{monthly_share:,.0f}/mo)"

            print(f"  {mk:<12} €{total:>10,.2f}   {acc_names[:55]:<55} {note}")
            grand_totals[mk] += total

    print(f"\n{'═' * 100}")
    print(f"  GRAND TOTAL (all locations combined)")
    print(f"{'─' * 100}")
    print(f"  {'Month':<12} {'Total':>12}")
    for mk in sorted(grand_totals.keys()):
        print(f"  {mk:<12} €{grand_totals[mk]:>10,.2f}")
    print(f"{'═' * 100}\n")


if __name__ == "__main__":
    main()
