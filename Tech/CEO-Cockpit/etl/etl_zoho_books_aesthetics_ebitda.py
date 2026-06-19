import sys
sys.stdout.reconfigure(encoding="utf-8", errors="replace")
sys.stderr.reconfigure(encoding="utf-8", errors="replace")
"""
ETL: Zoho Books Aesthetics org -> Supabase aesthetics_ebitda_monthly

Both Aesthetics and Slimming departments share one Zoho Books organisation
(Carisma Aesthetics). This ETL produces TWO rows per month — one per department.

Cost distribution logic (same priority as SPA):
  1. Label check  — if account name contains an Aesthetics or Slimming keyword
                    → 100% to that department (overrides configured rule)
  2. Split rule   — from Supabase CoA mapping (loaded per account):
       a. By sales ratio   — weighted by each dept's revenue that month
       b. By salary ratio  — weighted by each dept's direct wage cost
       c. Equal            — 50 / 50
       d. Custom fixed     — explicit % stored in coa_split_rules.config
                             keys: "aesthetics" and "slimming"

Revenue base  : aesthetics_sales_daily  + slimming_sales_daily  (Supabase)
Salary base   : Zoho wages accounts already labelled per department

Usage:
    cd etl
    py etl_zoho_books_aesthetics_ebitda.py --date-from 2026-04-01 --date-to 2026-04-30
    py etl_zoho_books_aesthetics_ebitda.py --date-from 2026-04-01 --date-to 2026-04-08 --force
"""

import argparse
import calendar
import json
import os
from datetime import datetime, date, timezone
from pathlib import Path

try:
    from dotenv import load_dotenv
    import requests
except ImportError:
    import subprocess
    subprocess.check_call([sys.executable, "-m", "pip", "install", "python-dotenv", "requests"])
    from dotenv import load_dotenv
    import requests

load_dotenv(Path(__file__).resolve().parents[3] / ".env")

from zoho_books_client import ZohoBooksClient
from shared.supabase_client import upsert, select
from shared.etl_logger import ETLLogger
from etl_zoho_books_spa_ebitda import fetch_pl_accounts

# ---------------------------------------------------------------------------
# Department constants
# ---------------------------------------------------------------------------
DEPTS = ["aesthetics", "slimming"]

# Keywords that directly assign 100 % to a department (label-check step)
_DEPT_KEYWORDS: list[tuple[list[str], str]] = [
    (["aesthetics", "aesthetic", " aest ", "clinic"], "aesthetics"),
    (["slimming", "slim", "weight loss", "weight-loss"], "slimming"),
]

def _detect_dept(name: str) -> str | None:
    low = f" {name.lower()} "
    for keywords, dept in _DEPT_KEYWORDS:
        if any(kw in low for kw in keywords):
            return dept
    return None

# ---------------------------------------------------------------------------
# Benchmark monthly rent (ex-VAT) — last-resort fallback
# ---------------------------------------------------------------------------
BENCHMARK_RENT_MONTHLY: dict[str, float] = {
    "aesthetics": 0.0,   # TODO: confirm Aesthetics clinic rent with finance
    "slimming":   0.0,   # TODO: confirm Slimming clinic rent with finance
}
RENT_ZERO_THRESHOLD = 1.0

# ---------------------------------------------------------------------------
# Name-based EBITDA line detection (for accounts not in CoA map)
# ---------------------------------------------------------------------------
def _detect_line(name: str, section: str) -> str:
    low = name.lower()
    if section == "income":
        return "revenue"
    if any(k in low for k in ["salary", "salaries", "wage", "overtime", "bonus",
                               "national insurance", "ni ", "payroll", "sick pay"]):
        return "wages"
    if any(k in low for k in ["rent", "lease"]):
        return "rent"
    if any(k in low for k in ["electric", "water", "internet", "broadband",
                               "telephone", "mobile", "utility", "wifi"]):
        return "utilities"
    if any(k in low for k in ["advertis", "marketing", "digital", "social media",
                               "meta ads", "google ads", "influenc"]):
        return "advertising"
    if section in ("cogs", "cost_of_goods_sold"):
        return "cogs"
    return "sga"

# ---------------------------------------------------------------------------
# CoA map loader from Supabase  (aesthetics org)
# Returns: {account_code: (rule_str, ebitda_line)}
# rule_str options: "aesthetics" | "slimming" | "equal" | "sales_ratio" |
#                   "salary_ratio" | "custom:{json}"
# ---------------------------------------------------------------------------
def load_coa_map(org: str = "aesthetics") -> dict[str, tuple[str, str]]:
    base = os.environ.get("SUPABASE_URL") or os.environ["NEXT_PUBLIC_SUPABASE_URL"]
    key  = os.environ["SUPABASE_SERVICE_ROLE_KEY"]
    headers = {"apikey": key, "Authorization": f"Bearer {key}"}
    resp = requests.get(
        f"{base}/rest/v1/zoho_coa_mapping",
        headers=headers,
        params={
            "select":        "account_code,ebitda_line,coa_split_rules(rule_type,config)",
            "zoho_org":      f"eq.{org}",
            "ebitda_line":   "not.is.null",
            "split_rule_id": "not.is.null",
        },
        timeout=30,
    )
    resp.raise_for_status()
    result: dict[str, tuple[str, str]] = {}
    for row in resp.json():
        code = str(row["account_code"]).strip()
        line = row["ebitda_line"]
        if line == "excluded":
            result[code] = ("excluded", "excluded")
            continue
        rule_obj = row.get("coa_split_rules") or {}
        rtype    = rule_obj.get("rule_type", "equal")
        config   = rule_obj.get("config") or {}
        if rtype == "direct":
            rule_str = "equal"           # label check already handles true direct
        elif rtype in ("equal", "sales_ratio", "marketing_spend_ratio"):
            rule_str = rtype
        elif rtype in ("salary_ratio", "salary_cost"):
            rule_str = "salary_ratio"
        elif rtype == "custom_fixed":
            rule_str = f"custom:{json.dumps(config, separators=(',', ':'))}"
        else:
            rule_str = "equal"
        result[code] = (rule_str, line)
    return result

# ---------------------------------------------------------------------------
# Marketing spend ratio: read weekly totals from the Growth Google Sheet
# ---------------------------------------------------------------------------
# Sheet: https://docs.google.com/spreadsheets/d/1JGlBdii7Zu25yha0zrmi72PPH1BFZRdVeGvcig3r6GE
# Tab GID: 335421089  (Growth Sheet)
# Row 2: week-start dates across columns
# Looks for section headers "AESTHETICS" / "SLIMMING" and the first
# "Marketing spend week" row beneath each header.
_GROWTH_SHEET_ID  = "1JGlBdii7Zu25yha0zrmi72PPH1BFZRdVeGvcig3r6GE"
_GROWTH_SHEET_GID = "335421089"

def load_marketing_ratio(from_date: str, to_date: str) -> dict[str, float]:
    """
    Return {dept: share} (summing to 1.0) from the Growth Sheet for
    the weeks that overlap with from_date..to_date.
    Falls back to equal split on any error.
    """
    import csv, io, urllib.request
    from datetime import date as _date, timedelta

    sheet_id  = os.environ.get("GROWTH_SHEET_ID",  _GROWTH_SHEET_ID)
    sheet_gid = os.environ.get("GROWTH_SHEET_GID", _GROWTH_SHEET_GID)
    url = (f"https://docs.google.com/spreadsheets/d/{sheet_id}"
           f"/export?format=csv&gid={sheet_gid}")

    try:
        req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0"})
        with urllib.request.urlopen(req, timeout=15) as resp:
            content = resp.read().decode("utf-8")
    except Exception as exc:
        print(f"  ⚠ Marketing ratio: could not fetch sheet ({exc}) — using equal split")
        return {d: 1.0 / len(DEPTS) for d in DEPTS}

    rows = list(csv.reader(io.StringIO(content)))
    if len(rows) < 3:
        return {d: 1.0 / len(DEPTS) for d in DEPTS}

    from_d = _date.fromisoformat(from_date)
    to_d   = _date.fromisoformat(to_date)

    # Row index 1 = spreadsheet row 2: week-start dates
    date_row = rows[1]
    relevant_cols: list[int] = []
    for col_idx, cell in enumerate(date_row[1:], start=1):
        cell = cell.strip()
        if not cell:
            continue
        for fmt in ("%d/%m/%Y", "%m/%d/%Y", "%Y-%m-%d", "%-d/%-m/%Y"):
            try:
                d = _date.strptime(cell, fmt)
                # A week starting d overlaps [from_d, to_d] if d <= to_d and d+6 >= from_d
                if d <= to_d and (d + timedelta(days=6)) >= from_d:
                    relevant_cols.append(col_idx)
                break
            except ValueError:
                continue

    if not relevant_cols:
        print(f"  ⚠ Marketing ratio: no weekly columns match {from_date}..{to_date} — using equal split")
        return {d: 1.0 / len(DEPTS) for d in DEPTS}

    # Scan rows: find section headers then first "marketing spend week" under each
    current_section: str | None = None
    marketing_row_idx: dict[str, int] = {}

    for row_idx, row in enumerate(rows):
        if not row:
            continue
        label = (row[0] or "").strip()
        label_up  = label.upper()
        label_low = label.lower()
        if label_up == "AESTHETICS":
            current_section = "aesthetics"
        elif label_up in ("SLIMMING", "SLIM", "SLIMMING SECTION"):
            current_section = "slimming"
        elif current_section and "marketing spend week" in label_low:
            if current_section not in marketing_row_idx:
                marketing_row_idx[current_section] = row_idx

    dept_spend: dict[str, float] = {d: 0.0 for d in DEPTS}
    for dept, ridx in marketing_row_idx.items():
        row = rows[ridx]
        for col_idx in relevant_cols:
            if col_idx < len(row):
                raw = row[col_idx].strip().replace(",", "").lstrip("€£$")
                try:
                    dept_spend[dept] += float(raw)
                except ValueError:
                    pass

    total = sum(dept_spend.values())
    if total <= 0:
        print(f"  ⚠ Marketing ratio: spend totals are zero — using equal split")
        return {d: 1.0 / len(DEPTS) for d in DEPTS}

    ratio = {d: dept_spend[d] / total for d in DEPTS}
    print(f"  Marketing spend ratio ({from_date}..{to_date}): "
          + ", ".join(f"{d}={ratio[d]:.1%}" for d in DEPTS))
    return ratio


# ---------------------------------------------------------------------------
# Salary supplement: extra wages not in Zoho payroll
# ---------------------------------------------------------------------------
def load_salary_supplement(month_key: str) -> dict[str, float]:
    """Return {dept: total_supplement} for aesthetics/slimming from salary_supplement_monthly."""
    supplement: dict[str, float] = {d: 0.0 for d in DEPTS}
    try:
        base = os.environ.get("SUPABASE_URL") or os.environ["NEXT_PUBLIC_SUPABASE_URL"]
        key  = os.environ["SUPABASE_SERVICE_ROLE_KEY"]
        headers = {"apikey": key, "Authorization": f"Bearer {key}"}
        resp = requests.get(
            f"{base}/rest/v1/salary_supplement_monthly",
            headers=headers,
            params=[
                ("select",    "spa_slug,amount"),
                ("month",     f"eq.{month_key}"),
                ("spa_slug",  "in.(aesthetics,slimming)"),
            ],
            timeout=30,
        )
        if resp.ok:
            for row in resp.json():
                slug = row.get("spa_slug")
                if slug in supplement:
                    supplement[slug] += float(row.get("amount") or 0)
    except Exception as exc:
        print(f"  Warning: could not load salary supplement: {exc}")
    return supplement


# ---------------------------------------------------------------------------
# Revenue base: sum from Supabase sales tables
# ---------------------------------------------------------------------------
def load_revenue_base(from_date: str, to_date: str) -> dict[str, float]:
    """Return {dept: total_ex_vat} for the reporting period."""
    rev: dict[str, float] = {"aesthetics": 0.0, "slimming": 0.0}
    try:
        import requests as _req
        base = os.environ.get("SUPABASE_URL") or os.environ["NEXT_PUBLIC_SUPABASE_URL"]
        key  = os.environ["SUPABASE_SERVICE_ROLE_KEY"]
        headers = {"apikey": key, "Authorization": f"Bearer {key}"}

        for table, dept in [("aesthetics_sales_daily", "aesthetics"),
                             ("slimming_sales_daily",   "slimming")]:
            resp = _req.get(
                f"{base}/rest/v1/{table}",
                headers=headers,
                params=[
                    ("select", "price_ex_vat"),
                    ("date_of_service", f"gte.{from_date}"),
                    ("date_of_service", f"lte.{to_date}"),
                ],
                timeout=30,
            )
            if resp.ok:
                rev[dept] = sum(float(r.get("price_ex_vat") or 0) for r in resp.json())
    except Exception as exc:
        print(f"  Warning: could not load revenue base: {exc}")
    return rev

# ---------------------------------------------------------------------------
# Distribute an amount across departments
# ---------------------------------------------------------------------------
def distribute(
    rule: str,
    amount: float,
    dept_revenue: dict[str, float],
    total_revenue: float,
    dept_salary: dict[str, float],
    total_salary: float,
    dept_marketing: dict[str, float] | None = None,
    total_marketing: float = 1.0,
) -> dict[str, float]:
    if rule in DEPTS:
        return {d: (amount if d == rule else 0.0) for d in DEPTS}

    if rule == "sales_ratio":
        if total_revenue > 0:
            return {d: amount * dept_revenue[d] / total_revenue for d in DEPTS}
        return {d: amount / len(DEPTS) for d in DEPTS}

    if rule == "salary_ratio":
        if total_salary > 0:
            return {d: amount * dept_salary[d] / total_salary for d in DEPTS}
        return {d: amount / len(DEPTS) for d in DEPTS}

    if rule == "marketing_spend_ratio":
        if dept_marketing and total_marketing > 0:
            return {d: amount * dept_marketing.get(d, 0.0) / total_marketing for d in DEPTS}
        return {d: amount / len(DEPTS) for d in DEPTS}

    if rule.startswith("custom:"):
        try:
            cfg = json.loads(rule[7:])
            total_pct = sum(float(cfg.get(d, 0)) for d in DEPTS)
            if total_pct > 0:
                return {d: amount * float(cfg.get(d, 0)) / total_pct for d in DEPTS}
        except Exception:
            pass
        return {d: amount / len(DEPTS) for d in DEPTS}

    # equal (default)
    return {d: amount / len(DEPTS) for d in DEPTS}

# ---------------------------------------------------------------------------
# Idempotency check
# ---------------------------------------------------------------------------
def month_already_synced(month_key: str) -> bool:
    try:
        rows = select("aesthetics_ebitda_monthly", {"month": month_key})
        return bool(rows)
    except Exception:
        return False

# ---------------------------------------------------------------------------
# Core per-month runner
# ---------------------------------------------------------------------------

def run_month(
    client: ZohoBooksClient,
    year: int,
    month_num: int,
    *,
    force: bool = False,
    active_coa_map: dict | None = None,
    from_date_override: str | None = None,
    to_date_override: str | None = None,
) -> int:
    month_days = calendar.monthrange(year, month_num)[1]
    from_date  = from_date_override or f"{year}-{month_num:02d}-01"
    to_date    = to_date_override   or f"{year}-{month_num:02d}-{month_days:02d}"
    month_key  = f"{year}-{month_num:02d}-01"

    _from_d = date.fromisoformat(from_date)
    _to_d   = date.fromisoformat(to_date)
    period_days_actual = (_to_d - _from_d).days + 1

    if not force and month_already_synced(month_key):
        print(f"  {month_key}: cached — skipping (use --force to re-fetch)")
        return 0

    coa_map = active_coa_map if active_coa_map is not None else {}

    print(f"  {month_key}: fetching from Zoho Books (aesthetics org)...", flush=True)
    raw_accounts = fetch_pl_accounts(client, from_date, to_date)

    if not raw_accounts:
        print(f"  {month_key}: no accounts returned from Zoho")
        return 0

    # ── Step 1: Map every account ─────────────────────────────────────────────
    EBITDA_LINES = {"revenue", "cogs", "wages", "advertising", "rent", "utilities", "sga"}

    # (rule, line, amount) — rule is dept key, "equal", "sales_ratio", etc.
    mapped: list[tuple[str, str, float]] = []
    fallback_mapped: list[dict] = []
    skipped_accounts: list[dict] = []

    for acc in raw_accounts:
        code    = acc["code"]
        name    = acc["name"]
        section = acc["section"]
        amount  = acc["amount"]
        if amount == 0:
            continue
        if section in ("other_income",) and code not in coa_map:
            skipped_accounts.append({"code": code, "name": name,
                                     "section": section, "amount": amount})
            continue

        if code in coa_map:
            configured_rule, line = coa_map[code]
            if line == "excluded":
                continue
            auto = False
        elif section == "income":
            # Only CoA-mapped income accounts are included in revenue.
            # Unmapped income is skipped — revenue comes from sales_daily tables.
            skipped_accounts.append({"code": code, "name": name,
                                     "section": section, "amount": amount})
            continue
        else:
            configured_rule = "equal"
            line = _detect_line(name, section)
            auto = True

        if line not in EBITDA_LINES:
            skipped_accounts.append({"code": code, "name": name,
                                     "section": section, "amount": amount})
            continue

        # Label check always overrides configured rule
        dept = _detect_dept(name)
        rule = dept if dept else configured_rule

        if auto:
            fallback_mapped.append({"code": code, "name": name, "section": section,
                                    "amount": amount, "line": line, "rule": rule})
        mapped.append((rule, line, amount))

    # ── Step 1 check: flag unmapped accounts ──────────────────────────────────
    if fallback_mapped:
        print(f"\n  ⚠  UNMAPPED — auto-detected (add to CoA mapping):")
        print(f"  {'Code':<10} {'Amount':>10}  {'Line':<12}  {'Rule':<14}  Name")
        print(f"  {'-'*10} {'-'*10}  {'-'*12}  {'-'*14}  {'-'*40}")
        for r in sorted(fallback_mapped, key=lambda x: -x["amount"]):
            print(f"  {r['code']:<10} {r['amount']:>10.2f}  {r['line']:<12}  "
                  f"{r['rule']:<14}  {r['name']}")
        print()

    if skipped_accounts:
        print(f"  ℹ  SKIPPED (other_income or unrecognised, amount > 0):")
        for r in sorted(skipped_accounts, key=lambda x: -x["amount"]):
            print(f"  {r['code']:<10} {r['amount']:>10.2f}  [{r['section']}]  {r['name']}")
        print()

    # ── Step 2: Build revenue, salary & marketing bases for ratio splits ────────
    # Revenue: from Supabase sales tables
    dept_revenue = load_revenue_base(from_date, to_date)
    total_revenue = sum(dept_revenue.values()) or 1.0

    # Salary: from Zoho wage accounts already labelled per department
    dept_salary: dict[str, float] = {d: 0.0 for d in DEPTS}
    for rule, line, amount in mapped:
        if line == "wages" and rule in DEPTS:
            dept_salary[rule] += amount
    total_salary = sum(dept_salary.values()) or 1.0

    # Marketing spend: from Growth Sheet (only fetched when the rule is in use)
    dept_marketing: dict[str, float] | None = None
    total_marketing = 1.0
    if any(rule == "marketing_spend_ratio" for rule, _, _ in mapped):
        dept_marketing = load_marketing_ratio(from_date, to_date)
        total_marketing = sum(dept_marketing.values()) or 1.0

    # ── Step 3: Distribute all amounts ────────────────────────────────────────
    totals: dict[str, dict[str, float]] = {
        dept: {ln: 0.0 for ln in EBITDA_LINES} for dept in DEPTS
    }
    for rule, line, amount in mapped:
        dist = distribute(rule, amount, dept_revenue, total_revenue,
                          dept_salary, total_salary,
                          dept_marketing, total_marketing)
        for dept, share in dist.items():
            totals[dept][line] += share

    # ── Step 4: Rent fallback and per-day proration ───────────────────────────
    prev_y, prev_m = (year, month_num - 1) if month_num > 1 else (year - 1, 12)
    prev_key  = f"{prev_y}-{prev_m:02d}-01"
    prev_days = calendar.monthrange(prev_y, prev_m)[1]

    prev_rent: dict[str, float] = {d: 0.0 for d in DEPTS}
    try:
        prev_rows = select("aesthetics_ebitda_monthly", {"month": prev_key})
        for pr in (prev_rows or []):
            dept = pr.get("department")
            if dept in DEPTS:
                prev_rent[dept] = float(pr.get("rent") or 0)
    except Exception as exc:
        print(f"  Warning: could not load previous month rent: {exc}")

    for dept in DEPTS:
        current = totals[dept]["rent"]
        prev    = prev_rent[dept]
        bench   = BENCHMARK_RENT_MONTHLY.get(dept, 0.0)

        if current < RENT_ZERO_THRESHOLD and prev > 0:
            totals[dept]["rent"] = prev / prev_days * period_days_actual
        elif current < RENT_ZERO_THRESHOLD and prev <= 0 and bench > 0:
            totals[dept]["rent"] = bench / month_days * period_days_actual
        elif current >= RENT_ZERO_THRESHOLD and period_days_actual < month_days:
            totals[dept]["rent"] = current / month_days * period_days_actual

    if period_days_actual < month_days:
        print(f"  Rent prorated: {period_days_actual}/{month_days} days")

    # ── Step 4b: Add salary supplement to wages ───────────────────────────────
    supplement = load_salary_supplement(month_key)
    for dept in DEPTS:
        if supplement[dept] > 0:
            totals[dept]["wages"] += supplement[dept]
            print(f"  Salary supplement [{dept:>10}]: +{supplement[dept]:.2f} added to wages")
        else:
            print(f"  Salary supplement [{dept:>10}]: none found for {month_key}")

    # ── Step 5: Upsert two rows to Supabase ───────────────────────────────────
    now_ts = datetime.now(timezone.utc).isoformat()
    rows = [
        {
            "month":          month_key,
            "department":     dept,
            "revenue":        round(totals[dept]["revenue"],     2),
            "cogs":           round(totals[dept]["cogs"],        2),
            "wages":          round(totals[dept]["wages"],       2),
            "advertising":    round(totals[dept]["advertising"], 2),
            "rent":           round(totals[dept]["rent"],        2),
            "utilities":      round(totals[dept]["utilities"],   2),
            "sga":            round(totals[dept]["sga"],         2),
            "zoho_synced_at": now_ts,
        }
        for dept in DEPTS
    ]
    n = upsert("aesthetics_ebitda_monthly", rows, "month,department")
    for r in rows:
        print(f"  {month_key} [{r['department']:>10}]: "
              f"rev={r['revenue']:.0f}  cogs={r['cogs']:.0f}  "
              f"wages={r['wages']:.0f}  rent={r['rent']:.0f}  "
              f"sga={r['sga']:.0f}")
    return n

# ---------------------------------------------------------------------------
# Entry point
# ---------------------------------------------------------------------------

def iter_months(date_from: date, date_to: date):
    y, m = date_from.year, date_from.month
    while (y, m) <= (date_to.year, date_to.month):
        yield y, m
        m += 1
        if m > 12:
            m = 1
            y += 1


def main():
    parser = argparse.ArgumentParser(
        description="Sync Zoho Books Aesthetics org P&L → Supabase aesthetics_ebitda_monthly"
    )
    parser.add_argument("--date-from", required=True, help="Start date YYYY-MM-DD")
    parser.add_argument("--date-to",   required=True, help="End date YYYY-MM-DD")
    parser.add_argument("--force",     action="store_true",
                        help="Re-fetch even if month already cached")
    args = parser.parse_args()

    try:
        date_from = date.fromisoformat(args.date_from)
        date_to   = date.fromisoformat(args.date_to)
    except ValueError as exc:
        print(f"ERROR: bad date format — {exc}")
        sys.exit(1)

    logger = ETLLogger("zoho_aesthetics_ebitda")
    logger.start()
    total = 0

    try:
        client = ZohoBooksClient(org="aesthetics")

        print("Loading CoA mapping…", end=" ", flush=True)
        try:
            active_coa_map = load_coa_map(org="aesthetics")
            print(f"loaded {len(active_coa_map)} accounts from Supabase.")
        except Exception as exc:
            active_coa_map = {}
            print(f"failed ({exc}) — all accounts will use name-based detection.")

        months = list(iter_months(date_from, date_to))
        print(f"Processing {len(months)} month(s): {args.date_from} → {args.date_to}")

        for y, mo in months:
            is_first = (y == date_from.year and mo == date_from.month)
            is_last  = (y == date_to.year   and mo == date_to.month)
            from_override = date_from.isoformat() if is_first else None
            to_override   = date_to.isoformat()   if is_last  else None
            total += run_month(
                client, y, mo,
                force=args.force,
                active_coa_map=active_coa_map,
                from_date_override=from_override,
                to_date_override=to_override,
            )

        logger.complete(total)
        print(f"\nDone — {total} rows upserted.")

    except Exception as exc:
        import traceback
        traceback.print_exc()
        logger.fail(str(exc))
        print(f"ERROR: {exc}", file=sys.stderr)
        sys.exit(1)


if __name__ == "__main__":
    main()
