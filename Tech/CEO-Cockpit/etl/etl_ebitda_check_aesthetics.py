"""
EBITDA Reconciliation Check — Aesthetics org
Fetches live Zoho P&L (Carisma Aesthetics org), compares to
aesthetics_ebitda_monthly (all depts combined), and accounts for
the sales_daily revenue override.
Returns JSON to stdout.
"""
import sys, json, os
from pathlib import Path
sys.stdout.reconfigure(encoding="utf-8", errors="replace")
sys.stderr.reconfigure(encoding="utf-8", errors="replace")

try:
    from dotenv import load_dotenv
    import requests as _req
except ImportError:
    import subprocess
    subprocess.check_call([sys.executable, "-m", "pip", "install", "python-dotenv", "requests"])
    from dotenv import load_dotenv
    import requests as _req

load_dotenv(Path(__file__).resolve().parents[1] / ".env.local")
load_dotenv(Path(__file__).resolve().parents[3] / ".env")

from zoho_books_client import ZohoBooksClient
from shared.supabase_client import select
from etl_zoho_books_spa_ebitda import fetch_pl_accounts
from etl_zoho_books_aesthetics_ebitda import load_coa_map

# ── Below-EBITDA detection ────────────────────────────────────────────────────

BELOW_EBITDA_KEYWORDS = [
    "depreciat", "amortis", "amortiz",
    "interest paid", "finance charge", "bank interest",
    "corporate tax", "income tax",
]

def is_below_ebitda(code: str, name: str) -> tuple[bool, str]:
    low = name.lower()
    for kw in BELOW_EBITDA_KEYWORDS:
        if kw in low:
            label = (
                "Depreciation & Amortisation" if any(k in low for k in ["depreciat", "amortis", "amortiz"])
                else "Interest & Finance Charges" if "interest" in low or "finance" in low
                else "Corporate Tax"
            )
            return True, label
    return False, ""


# ── All CoA rows from DB ──────────────────────────────────────────────────────

def load_all_coa_from_db(org: str = "aesthetics") -> dict[str, dict]:
    base = os.environ.get("SUPABASE_URL") or os.environ["NEXT_PUBLIC_SUPABASE_URL"]
    key  = os.environ["SUPABASE_SERVICE_ROLE_KEY"]
    headers = {"apikey": key, "Authorization": f"Bearer {key}"}
    resp = _req.get(
        f"{base}/rest/v1/zoho_coa_mapping",
        headers=headers,
        params={"select": "account_code,account_name,ebitda_line,split_rule_id",
                "zoho_org": f"eq.{org}", "limit": "2000"},
        timeout=30,
    )
    resp.raise_for_status()
    return {r["account_code"]: r for r in resp.json()}


# ── Sales daily revenue ───────────────────────────────────────────────────────

def load_sales_revenue(from_date: str, to_date: str) -> dict[str, float]:
    base = os.environ.get("SUPABASE_URL") or os.environ["NEXT_PUBLIC_SUPABASE_URL"]
    key  = os.environ["SUPABASE_SERVICE_ROLE_KEY"]
    headers = {"apikey": key, "Authorization": f"Bearer {key}"}
    result: dict[str, float] = {"aesthetics": 0.0, "slimming": 0.0}
    for table, dept in [("aesthetics_sales_daily", "aesthetics"),
                         ("slimming_sales_daily",   "slimming")]:
        try:
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
                result[dept] = sum(float(r.get("price_ex_vat") or 0) for r in resp.json())
        except Exception as exc:
            print(f"  Warning: could not load {table}: {exc}", file=sys.stderr)
    return result


# ── Gap analysis ──────────────────────────────────────────────────────────────

def gap_analysis(accounts: list[dict], active_coa_codes: set[str],
                 db_map: dict[str, dict]) -> dict:
    income_in_db = {code: row for code, row in db_map.items()
                    if row.get("ebitda_line") == "revenue"}
    zoho_by_code = {a["code"]: a for a in accounts if a["amount"] > 0}

    excluded_exp   : list[dict] = []
    not_linked_exp : list[dict] = []
    not_in_db_exp  : list[dict] = []
    below_exp      : list[dict] = []
    income_missing : list[dict] = []

    for code, acc in zoho_by_code.items():
        if acc["section"] not in ("cogs", "expense", "other_expense"):
            continue
        amt = round(acc["amount"], 2)

        below, label = is_below_ebitda(code, acc["name"])
        if below:
            below_exp.append({"code": code, "name": acc["name"],
                               "amount": amt, "category": label})
            continue

        if code in db_map:
            row  = db_map[code]
            el   = row.get("ebitda_line")
            name = row.get("account_name") or acc["name"]
            if el == "excluded":
                excluded_exp.append({"code": code, "name": name, "amount": amt})
            elif el is None:
                not_linked_exp.append({"code": code, "name": name, "amount": amt,
                                       "note": "In DB but no EBITDA line assigned"})
            continue

        if code not in active_coa_codes:
            not_in_db_exp.append({"code": code, "name": acc["name"], "amount": amt,
                                   "note": "Not in COA mapping (ETL used name-based default)"})

    for code, row in income_in_db.items():
        if code not in zoho_by_code:
            income_missing.append({
                "code":   code,
                "name":   row.get("account_name") or code,
                "amount": 0.0,
                "note":   "Mapped as revenue in settings but no Zoho figure this period",
            })

    def by_amount(lst): return sorted(lst, key=lambda x: -x["amount"])

    return {
        "excluded_expenses":     by_amount(excluded_exp),
        "not_linked_expenses":   by_amount(not_linked_exp),
        "not_in_db_expenses":    by_amount(not_in_db_exp),
        "below_ebitda":          by_amount(below_exp),
        "income_mapped_missing": sorted(income_missing, key=lambda x: x["code"]),
        "totals": {
            "excluded_total":     round(sum(x["amount"] for x in excluded_exp), 2),
            "not_linked_total":   round(sum(x["amount"] for x in not_linked_exp), 2),
            "not_in_db_total":    round(sum(x["amount"] for x in not_in_db_exp), 2),
            "below_ebitda_total": round(sum(x["amount"] for x in below_exp), 2),
        },
    }


# ── Main run ──────────────────────────────────────────────────────────────────

def run(date_from: str, date_to: str) -> dict:
    to_y, to_m = int(date_to[:4]), int(date_to[5:7])
    month_keys: list[str] = []
    y, m = int(date_from[:4]), int(date_from[5:7])
    while (y, m) <= (to_y, to_m):
        month_keys.append(f"{y}-{m:02d}-01")
        m += 1
        if m > 12: m = 1; y += 1

    client   = ZohoBooksClient(org="aesthetics")
    accounts = fetch_pl_accounts(client, date_from, date_to)

    try:
        coa_map          = load_coa_map(org="aesthetics")
        active_coa_codes = set(coa_map.keys())
    except Exception as exc:
        active_coa_codes = set()
        print(f"  Warning: could not load active COA map: {exc}", file=sys.stderr)

    try:
        db_map = load_all_coa_from_db(org="aesthetics")
    except Exception as exc:
        db_map = {}
        print(f"  Warning: could not load DB COA map: {exc}", file=sys.stderr)

    # ── Classify Zoho accounts ─────────────────────────────────────────────────
    zoho_total_income = 0.0   # all Zoho income, unfiltered (for raw P&L view)
    ebitda_income     = 0.0   # CoA-mapped revenue only (matches dashboard formula)
    ebitda_costs      = 0.0
    below_items: list[dict] = []
    below_total   = 0.0
    income_accounts: list[dict] = []

    for acc in accounts:
        below, label = is_below_ebitda(acc["code"], acc["name"])
        amt = acc["amount"]
        if below and acc["section"] not in ("income",):
            below_total += amt
            found = next((b for b in below_items if b["label"] == label), None)
            if found: found["amount"] += amt
            else: below_items.append({"label": label, "amount": amt})
        elif acc["section"] == "income":
            db_row    = db_map.get(acc["code"], {})
            ebitda_ln = db_row.get("ebitda_line")
            in_coa    = acc["code"] in active_coa_codes
            coa_rule  = None
            if in_coa:
                rule_tuple = coa_map.get(acc["code"]) if hasattr(coa_map, "get") else None
                if isinstance(rule_tuple, tuple):
                    coa_rule = rule_tuple[0] if rule_tuple[1] != "excluded" else "excluded"
            zoho_total_income += amt   # always accumulate raw Zoho income
            included = in_coa and ebitda_ln == "revenue"
            if included:
                ebitda_income += amt   # CoA-mapped only (dashboard formula)
            # Infer department from account name — accounts with "slimming" in the
            # name are Slimming-specific; everything else belongs to Aesthetics.
            dept_hint = "slimming" if "slimming" in acc["name"].lower() else "aesthetics"
            income_accounts.append({
                "code":        acc["code"] or "(no code)",
                "name":        acc["name"],
                "amount":      round(amt, 2),
                "dept":        dept_hint,
                "ebitda_line": ebitda_ln,
                "split_rule":  coa_rule or "not mapped — excluded",
                "in_coa_map":  in_coa,
                "included":    included,
            })
        elif acc["section"] in ("cogs", "expense", "other_expense"):
            ebitda_costs += amt

    income_accounts.sort(key=lambda x: -x["amount"])
    zoho_ebitda = zoho_total_income - ebitda_costs   # raw Zoho P&L (all income − all costs)
    coa_ebitda  = ebitda_income     - ebitda_costs   # dashboard formula (CoA income − costs)

    # ── Revenue from sales_daily tables ───────────────────────────────────────
    sales_rev   = load_sales_revenue(date_from, date_to)
    sales_total = sum(sales_rev.values())

    # Expected EBITDA = CoA income + sales_daily − costs (all from Zoho live P&L)
    expected_ebitda = coa_ebitda + sales_total

    # ── DB totals from aesthetics_ebitda_monthly ───────────────────────────────
    db_by_dept: dict[str, dict] = {
        "aesthetics": {f: 0.0 for f in ["revenue","cogs","wages","advertising","rent","utilities","sga"]},
        "slimming":   {f: 0.0 for f in ["revenue","cogs","wages","advertising","rent","utilities","sga"]},
    }
    for mk in month_keys:
        rows = select("aesthetics_ebitda_monthly", {"month": mk})
        for r in (rows or []):
            dept = r.get("department", "aesthetics")
            if dept not in db_by_dept:
                continue
            for field in db_by_dept[dept]:
                db_by_dept[dept][field] += float(r.get(field) or 0)

    db_totals: dict[str, dict] = {}
    for dept, d in db_by_dept.items():
        coa_rev = d["revenue"]   # only CoA-mapped income stored by ETL
        costs   = sum(d[f] for f in ["cogs","wages","advertising","rent","utilities","sga"])
        sales   = sales_rev.get(dept, 0.0)
        db_totals[dept] = {
            "coa_revenue":  round(coa_rev,           2),
            "sales_revenue": round(sales,             2),
            "revenue":      round(coa_rev + sales,    2),
            "costs":        round(costs,              2),
            "ebitda":       round(coa_rev + sales - costs, 2),
        }

    frontend_ebitda = sum(v["ebitda"] for v in db_totals.values())
    difference      = frontend_ebitda - expected_ebitda

    return {
        "period": {"date_from": date_from, "date_to": date_to},
        "zoho": {
            "total_income":     round(zoho_total_income, 2),
            "zoho_ebitda":      round(zoho_ebitda,       2),
            "coa_income":       round(ebitda_income,     2),
            "costs":            round(ebitda_costs,      2),
            "coa_ebitda":       round(coa_ebitda,        2),
            "below_ebitda":     [{"label": b["label"], "amount": round(b["amount"], 2)}
                                 for b in below_items],
            "below_total":      round(below_total,       2),
            "income_accounts":  income_accounts,
        },
        "sales_daily": {
            "aesthetics": round(sales_rev["aesthetics"], 2),
            "slimming":   round(sales_rev["slimming"],   2),
            "total":      round(sales_total, 2),
        },
        "db_totals": db_totals,
        "reconciliation": {
            "zoho_coa_income":   round(ebitda_income,   2),
            "zoho_costs":        round(ebitda_costs,    2),
            "zoho_coa_ebitda":   round(coa_ebitda,      2),
            "sales_daily_total": round(sales_total,     2),
            "expected_ebitda":   round(expected_ebitda, 2),
            "frontend_ebitda":   round(frontend_ebitda, 2),
            "difference":        round(difference,       2),
            "status": "ok" if abs(difference) < 500 else "mismatch",
        },
        "gap_analysis": gap_analysis(accounts, active_coa_codes, db_map),
    }


if __name__ == "__main__":
    import argparse
    parser = argparse.ArgumentParser()
    parser.add_argument("--date-from", required=True)
    parser.add_argument("--date-to",   required=True)
    args = parser.parse_args()
    print(json.dumps(run(args.date_from, args.date_to), indent=2))
