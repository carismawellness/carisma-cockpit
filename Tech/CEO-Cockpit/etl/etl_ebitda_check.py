"""
EBITDA Reconciliation Check — SPA org
Returns JSON including gap analysis: which Zoho accounts are excluded,
unlinked, not in DB, or below the EBITDA line — with amounts.
"""
import sys, json, os, calendar
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
from etl_zoho_books_spa_ebitda import fetch_pl_accounts, COA_MAP, load_coa_from_supabase

# ── Below-EBITDA detection ────────────────────────────────────────────────────

BELOW_EBITDA_CODES: dict[str, str] = {
    "605":     "Interest & Finance Charges",
    "616800":  "Corporate Tax",
    "2356":    "Assets Written Off / Amortisation",
    "611110":  "Depreciation",
    "611114":  "Depreciation",
    "611115":  "Depreciation",
}
BELOW_EBITDA_KEYWORDS = [
    "depreciat", "amortis", "amortiz",
    "interest paid", "finance charge", "bank interest",
    "corporate tax", "income tax",
]
SPA_SUPP_SLUGS = {"inter", "hugos", "hyatt", "ramla", "labranda",
                  "odycy", "excelsior", "novotel", "hq"}


def is_below_ebitda(code: str, name: str) -> tuple[bool, str]:
    if code in BELOW_EBITDA_CODES:
        return True, BELOW_EBITDA_CODES[code]
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


# ── COA DB loader (all rows, not just active) ─────────────────────────────────

def load_all_coa_from_db(org: str = "spa") -> dict[str, dict]:
    """Load every row in zoho_coa_mapping for this org, regardless of ebitda_line."""
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


# ── Gap analysis ──────────────────────────────────────────────────────────────

def gap_analysis(accounts: list[dict], active_coa_codes: set[str], db_map: dict[str, dict]) -> dict:
    """
    Categorise every Zoho P&L account with amount > 0:

    EXPENSES
      excluded        — in DB with ebitda_line = 'excluded'
      not_linked      — in DB but ebitda_line IS NULL (no EBITDA line assigned)
      not_in_db       — not in zoho_coa_mapping at all (falling through to ETL defaults)
      below_ebitda    — D&A, interest, tax (should be below EBITDA line)

    INCOME
      income_missing  — in DB with ebitda_line = 'revenue' but zero/absent in this period
    """
    # All income accounts mapped as revenue in DB
    income_in_db = {code: row for code, row in db_map.items()
                    if row.get("ebitda_line") == "revenue"}

    # Zoho accounts with amounts, keyed by code
    zoho_by_code = {a["code"]: a for a in accounts if a["amount"] > 0}

    excluded_exp  : list[dict] = []
    not_linked_exp: list[dict] = []
    not_in_db_exp : list[dict] = []
    below_exp     : list[dict] = []
    income_missing: list[dict] = []

    # ── Expense / COGS accounts from Zoho ────────────────────────────────────
    for code, acc in zoho_by_code.items():
        if acc["section"] not in ("cogs", "expense", "other_expense"):
            continue
        amt = round(acc["amount"], 2)

        # 1. Below-EBITDA (D&A, interest, tax)
        below, label = is_below_ebitda(code, acc["name"])
        if below:
            below_exp.append({"code": code, "name": acc["name"],
                               "amount": amt, "category": label})
            continue

        # 2. In DB — check ebitda_line
        if code in db_map:
            row = db_map[code]
            el  = row.get("ebitda_line")
            name = row.get("account_name") or acc["name"]
            if el == "excluded":
                excluded_exp.append({"code": code, "name": name, "amount": amt})
            elif el is None:
                not_linked_exp.append({"code": code, "name": name, "amount": amt,
                                       "note": "In DB but no EBITDA line assigned"})
            # else: properly mapped — not a gap
            continue

        # 3. Not in DB at all
        if code not in active_coa_codes:
            not_in_db_exp.append({"code": code, "name": acc["name"], "amount": amt,
                                   "note": "Not in COA mapping (ETL used name-based default)"})

    # ── Income accounts in DB but missing from Zoho this period ──────────────
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
        "excluded_expenses":    by_amount(excluded_exp),
        "not_linked_expenses":  by_amount(not_linked_exp),
        "not_in_db_expenses":   by_amount(not_in_db_exp),
        "below_ebitda":         by_amount(below_exp),
        "income_mapped_missing": sorted(income_missing, key=lambda x: x["code"]),
        "totals": {
            "excluded_total":   round(sum(x["amount"] for x in excluded_exp), 2),
            "not_linked_total": round(sum(x["amount"] for x in not_linked_exp), 2),
            "not_in_db_total":  round(sum(x["amount"] for x in not_in_db_exp), 2),
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

    client   = ZohoBooksClient(org="spa")
    accounts = fetch_pl_accounts(client, date_from, date_to)

    # Active COA map (Supabase → fallback hardcoded)
    active_coa = load_coa_from_supabase(org="spa") or COA_MAP
    active_coa_codes = set(active_coa.keys())

    # All DB entries (for gap analysis)
    try:
        db_map = load_all_coa_from_db(org="spa")
    except Exception as e:
        db_map = {}
        print(f"[warn] Could not load DB COA map: {e}", file=sys.stderr)

    # ── Classify accounts ─────────────────────────────────────────────────────
    ebitda_income = 0.0
    ebitda_costs  = 0.0
    below_items: list[dict] = []
    below_total   = 0.0

    for acc in accounts:
        below, label = is_below_ebitda(acc["code"], acc["name"])
        amt = acc["amount"]
        if below and acc["section"] not in ("income",):
            below_total += amt
            found = next((b for b in below_items if b["label"] == label), None)
            if found: found["amount"] += amt
            else: below_items.append({"label": label, "amount": amt})
        elif acc["section"] == "income":
            ebitda_income += amt
        elif acc["section"] in ("cogs", "expense", "other_expense"):
            ebitda_costs += amt

    zoho_ebitda = ebitda_income - ebitda_costs

    # ── Salary supplement ─────────────────────────────────────────────────────
    salary_supplement = 0.0
    supp_rows_all: list[dict] = []
    for mk in month_keys:
        rows = select("salary_supplement_monthly", {"month": mk, "is_frozen": "true"})
        if rows: supp_rows_all.extend(rows)
    if not supp_rows_all and month_keys:
        prev_y, prev_m = int(month_keys[0][:4]), int(month_keys[0][5:7]) - 1
        if prev_m == 0: prev_m = 12; prev_y -= 1
        supp_rows_all = select("salary_supplement_monthly",
                               {"month": f"{prev_y}-{prev_m:02d}-01", "is_frozen": "true"}) or []

    supp_by_slug: dict[str, float] = {}
    for sr in supp_rows_all:
        slug = sr.get("spa_slug", "")
        if slug in SPA_SUPP_SLUGS:
            amt = float(sr.get("amount") or 0)
            salary_supplement += amt
            supp_by_slug[slug] = supp_by_slug.get(slug, 0) + amt

    # ── Actual from Supabase ──────────────────────────────────────────────────
    actual_ebitda = 0.0; actual_revenue = 0.0
    for mk in month_keys:
        for r in select("spa_ebitda_monthly", {"month": mk}):
            rev   = float(r.get("revenue") or 0)
            costs = sum(float(r.get(f, 0) or 0)
                        for f in ["cogs","wages","advertising","rent","utilities","sga"])
            actual_ebitda  += rev - costs
            actual_revenue += rev

    lapis_revenue = 0.0
    for mk in month_keys:
        for r in select("spa_revenue_monthly", {"month": mk}):
            lapis_revenue += (
                float(r.get("services") or 0) + float(r.get("product_phytomer") or 0) +
                float(r.get("product_purest") or 0) + float(r.get("product_other") or 0) +
                float(r.get("wholesale") or 0) -
                float(r.get("sales_discount") or 0) - float(r.get("sales_refund") or 0)
            )

    revenue_gap         = lapis_revenue - actual_revenue
    frontend_ebitda     = actual_ebitda + revenue_gap
    expected_ebitda     = zoho_ebitda - salary_supplement
    expected_with_lapis = expected_ebitda + revenue_gap

    return {
        "period": {"date_from": date_from, "date_to": date_to},
        "zoho": {
            "revenue":      round(ebitda_income, 2),
            "costs":        round(ebitda_costs, 2),
            "ebitda":       round(zoho_ebitda, 2),
            "below_ebitda": [{"label": b["label"], "amount": round(b["amount"], 2)}
                             for b in below_items],
            "below_total":  round(below_total, 2),
        },
        "salary_supplement": {
            "total":    round(salary_supplement, 2),
            "by_slug":  {k: round(v, 2) for k, v in supp_by_slug.items()},
        },
        "reconciliation": {
            "zoho_ebitda":            round(zoho_ebitda, 2),
            "salary_supplement":      round(salary_supplement, 2),
            "expected_ebitda":        round(expected_ebitda, 2),
            "actual_ebitda_zoho_rev": round(actual_ebitda, 2),
            "lapis_revenue":          round(lapis_revenue, 2),
            "zoho_revenue":           round(actual_revenue, 2),
            "revenue_gap":            round(revenue_gap, 2),
            "frontend_ebitda":        round(frontend_ebitda, 2),
            "expected_with_lapis":    round(expected_with_lapis, 2),
            "difference":             round(frontend_ebitda - expected_with_lapis, 2),
            "status": "ok" if abs(frontend_ebitda - expected_with_lapis) < 500 else "mismatch",
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
