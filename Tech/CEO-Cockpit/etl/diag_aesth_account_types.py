"""
Diagnostic: fetch Aesthetics Zoho accounts WITH account_type, show count by type,
and mark OtherIncome / OtherExpense / system accounts as 'excluded' in DB.

Run from the etl/ directory:
    py diag_aesth_account_types.py
    py diag_aesth_account_types.py --apply     # actually update the DB
"""
import sys, os, argparse
sys.stdout.reconfigure(encoding="utf-8", errors="replace")
from pathlib import Path
from dotenv import load_dotenv

load_dotenv(Path(__file__).resolve().parents[3] / ".env")

import requests

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------
def _refresh_token() -> str:
    cid    = os.environ["ZOHO_BOOKS_CLIENT_ID"]
    csec   = os.environ["ZOHO_BOOKS_CLIENT_SECRET"]
    rtok   = os.environ["ZOHO_BOOKS_REFRESH_TOKEN"]
    r = requests.post(
        "https://accounts.zoho.eu/oauth/v2/token",
        params={"refresh_token": rtok, "client_id": cid,
                "client_secret": csec, "grant_type": "refresh_token"},
        timeout=15,
    )
    r.raise_for_status()
    d = r.json()
    if "access_token" not in d:
        raise RuntimeError(f"Token refresh failed: {d}")
    return d["access_token"]


def fetch_all_accounts(token: str, org_id: str) -> list[dict]:
    """Return all accounts with name, account_type, account_code, account_id."""
    url     = "https://www.zohoapis.eu/books/v3/chartofaccounts"
    headers = {"Authorization": f"Zoho-oauthtoken {token}"}
    params  = {"organization_id": org_id, "per_page": 200, "page": 1}
    all_accs = []
    while True:
        r = requests.get(url, headers=headers, params=params, timeout=20)
        r.raise_for_status()
        data = r.json()
        accs = data.get("chartofaccounts", [])
        all_accs.extend(accs)
        page_ctx = data.get("page_context", {})
        if not page_ctx.get("has_more_page"):
            break
        params["page"] += 1
    return all_accs


def supabase_headers() -> dict:
    key = os.environ["SUPABASE_SERVICE_ROLE_KEY"]
    return {"apikey": key, "Authorization": f"Bearer {key}", "Content-Type": "application/json"}


def sb_get(path: str, params: dict = None):
    base = os.environ.get("SUPABASE_URL") or os.environ["NEXT_PUBLIC_SUPABASE_URL"]
    r = requests.get(f"{base}/rest/v1/{path}", headers=supabase_headers(), params=params, timeout=15)
    r.raise_for_status()
    return r.json()


def sb_patch(path: str, params: dict, body: dict):
    base = os.environ.get("SUPABASE_URL") or os.environ["NEXT_PUBLIC_SUPABASE_URL"]
    r = requests.patch(
        f"{base}/rest/v1/{path}",
        headers={**supabase_headers(), "Prefer": "return=minimal"},
        params=params,
        json=body,
        timeout=15,
    )
    r.raise_for_status()
    return r


# ---------------------------------------------------------------------------
# Account types the user counts as "income and expense" (per standard Zoho)
# Zoho returns snake_case type names
# ---------------------------------------------------------------------------
COUNTED_TYPES = {"income", "expense", "cost_of_goods_sold"}

# These types are system / balance-sheet / other — excluded from the 109 count
EXCLUDED_TYPES = {"other_income", "other_expense", "fixed_asset", "equity",
                  "liability", "asset", "accounts_receivable", "accounts_payable",
                  "bank", "cash", "other_current_liability", "other_current_asset",
                  "other_asset", "long_term_liability", "long_term_asset",
                  "other_liability", "payment_clearing", "stock"}


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--apply", action="store_true",
                        help="Actually set ebitda_line='excluded' for non-counted accounts in DB")
    args = parser.parse_args()

    org_id = os.environ["ZOHO_BOOKS_AESTH_ORG_ID"]
    print(f"Fetching accounts from Zoho Aesthetics org ({org_id}) …")
    token   = _refresh_token()
    accounts = fetch_all_accounts(token, org_id)
    print(f"Zoho returned {len(accounts)} accounts total.\n")

    # Group by account_type
    from collections import defaultdict
    by_type: dict[str, list[dict]] = defaultdict(list)
    for a in accounts:
        by_type[a.get("account_type", "Unknown")].append(a)

    print("=== Account count by type ===")
    counted = 0
    excluded_accs: list[dict] = []
    for atype in sorted(by_type):
        n = len(by_type[atype])
        tag = "✓ counted" if atype in COUNTED_TYPES else "✗ excluded"
        print(f"  {atype:<30} {n:>4}   {tag}")
        if atype in COUNTED_TYPES:
            counted += n
        else:
            excluded_accs.extend(by_type[atype])

    print(f"\nCounted (Income + Expense + COGS): {counted}")
    print(f"Excluded (other types):            {len(excluded_accs)}")
    print(f"Total:                             {len(accounts)}\n")

    if not excluded_accs:
        print("No excluded accounts found — nothing to update.")
        return

    print("=== Accounts that should be EXCLUDED from EBITDA mapping ===")
    for a in sorted(excluded_accs, key=lambda x: x.get("account_type", "")):
        code = a.get("account_code") or a.get("account_id", "")
        print(f"  [{a['account_type']:<25}]  {code:<25}  {a.get('account_name','')}")

    if not args.apply:
        print("\nDry-run complete. Re-run with --apply to set ebitda_line='excluded' in DB.")
        return

    # -- Apply: update Supabase rows --
    print("\nApplying to Supabase …")
    updated = 0
    not_found = 0
    for a in excluded_accs:
        code = a.get("account_code") or a.get("account_id", "")
        if not code:
            continue
        # Try to find the row in DB
        rows = sb_get("zoho_coa_mapping", {"account_code": f"eq.{code}", "zoho_org": "eq.aesthetics"})
        if not rows:
            # Maybe stored as Zoho internal ID
            rows = sb_get("zoho_coa_mapping", {"account_code": f"eq.{a.get('account_id','')}",
                                                "zoho_org": "eq.aesthetics"})
        if not rows:
            not_found += 1
            print(f"  NOT IN DB: {code}  {a.get('account_name','')}")
            continue
        db_code = rows[0]["account_code"]
        sb_patch("zoho_coa_mapping",
                 {"account_code": f"eq.{db_code}", "zoho_org": "eq.aesthetics"},
                 {"ebitda_line": "excluded", "split_rule_id": None})
        updated += 1
        print(f"  ✓ excluded: {db_code}  {a.get('account_name','')}")

    print(f"\nDone. Updated: {updated}  |  Not in DB (skipped): {not_found}")


if __name__ == "__main__":
    main()
