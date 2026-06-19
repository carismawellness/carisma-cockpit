"""
ETL: Zoho Books Chart of Accounts -> CSV mapping file

Fetches the full Chart of Accounts from both Zoho Books organisations
(SPA and Aesthetics) and writes them to the zoho-coa-mapping folder
so the dashboard mapping spreadsheet can be built from real account names.

Usage:
    cd carisma-support/10-Tech/CEO-Cockpit/etl
    python etl_zoho_books_coa.py

Output:
    zoho-coa-mapping/zoho_coa_spa_raw.csv
    zoho-coa-mapping/zoho_coa_aesthetics_raw.csv
    zoho-coa-mapping/zoho_coa_spa_mapped.csv       <- ready for QC review
    zoho-coa-mapping/zoho_coa_aesthetics_mapped.csv
"""

import csv
import sys
from pathlib import Path

# ---------------------------------------------------------------------------
# Dependency check
# ---------------------------------------------------------------------------
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

_OUTPUT_DIR = Path(__file__).resolve().parents[4] / "zoho-coa-mapping"
_OUTPUT_DIR.mkdir(exist_ok=True)

# ---------------------------------------------------------------------------
# Dashboard category rules
# Each rule is (account_type, name_keywords) -> dashboard_category
# Evaluated top-to-bottom; first match wins.
# ---------------------------------------------------------------------------

_ACCOUNT_TYPE_MAP = {
    # Zoho account_type -> dashboard category (fallback by type alone)
    "income":              "revenue",
    "other_income":        "excluded",
    "cost_of_goods_sold":  "cogs",
    "other_current_liability": "excluded",
    "fixed_asset":         "excluded",
    "long_term_liability": "excluded",
    "equity":              "excluded",
    "other_asset":         "excluded",
    "other_current_asset": "excluded",
    "accounts_receivable": "excluded",
    "accounts_payable":    "excluded",
    "bank":                "excluded",
    "cash":                "excluded",
    "credit_card":         "excluded",
}

_NAME_KEYWORD_MAP = [
    # (keywords_any_of, dashboard_category)
    # --- Revenue ---
    (["sales", "revenue", "income from", "membership", "day pass", "gift voucher redeem",
      "treatment income", "service income"], "revenue"),
    # --- COGS ---
    (["cost of goods", "cogs", "consumable", "product cost", "cost of product",
      "treatment supply", "treatment material"], "cogs"),
    # --- Wages ---
    (["salary", "salaries", "wage", "overtime", "bonus", "commission",
      "employer ni", "national insurance", "social security", "maternity",
      "sick pay", "staff benefit", "uniform"], "wages"),
    # --- Advertising ---
    (["advertis", "marketing", "influencer", "pr fee", "photograp", "video content",
      "promotion", "social media", "hootsuite", "later.com", "meta ads", "google ads",
      "digital ads", "print", "ooh"], "advertising"),
    # --- Rent ---
    (["rent", "service charge", "rates", "property tax", "property insurance",
      "common area", "occupancy", "lease"], "rent"),
    # --- Utilities ---
    (["electric", "water", "sewage", "internet", "broadband", "telephone",
      "mobile", "gas", "heating", "utility"], "utilities"),
    # --- Below EBITDA ---
    (["interest", "corporation tax", "income tax", "tax payable", "loan repay",
      "finance charge", "hire purchase"], "excluded"),
    # --- SG&A (catch-all for remaining expenses) ---
    (["admin", "office", "software", "subscription", "bank charge", "merchant fee",
      "card processing", "professional fee", "legal", "accountan", "consultancy",
      "training", "development", "cleaning", "janitorial", "laundry", "linen",
      "repair", "maintenance", "equipment hire", "travel", "subsistence",
      "depreciation", "amortis", "sundry", "miscellaneous"], "sga"),
]

_INCLUDE_IN_EBITDA = {
    "revenue":     True,
    "cogs":        True,
    "wages":       True,
    "advertising": True,
    "rent":        True,
    "utilities":   True,
    "sga":         True,
    "excluded":    False,
}


def _classify(account: dict) -> str:
    """Return dashboard category for a Zoho account record."""
    account_type = (account.get("account_type") or "").lower().replace(" ", "_")
    name = (account.get("account_name") or "").lower()

    # 1. Keyword match on name (highest priority)
    for keywords, category in _NAME_KEYWORD_MAP:
        if any(kw in name for kw in keywords):
            return category

    # 2. Fallback to account type
    return _ACCOUNT_TYPE_MAP.get(account_type, "review")  # "review" = needs manual check


def fetch_and_write(org: str):
    print(f"\nFetching Chart of Accounts — {org.upper()} org...")
    client = ZohoBooksClient(org=org)

    try:
        accounts = client.get_all_pages("chartofaccounts", "chartofaccounts")
    except Exception as e:
        print(f"  ERROR: {e}")
        return

    print(f"  {len(accounts)} accounts retrieved.")

    # --- Raw dump ---
    raw_path = _OUTPUT_DIR / f"zoho_coa_{org}_raw.csv"
    raw_fields = ["account_id", "account_name", "account_type", "account_code",
                  "currency_id", "description", "is_active", "parent_account_name"]
    with open(raw_path, "w", newline="", encoding="utf-8") as f:
        writer = csv.DictWriter(f, fieldnames=raw_fields, extrasaction="ignore")
        writer.writeheader()
        writer.writerows(accounts)
    print(f"  Raw CoA saved: {raw_path.name}")

    # --- Mapped file (ready for QC) ---
    mapped_path = _OUTPUT_DIR / f"zoho_coa_{org}_mapped.csv"
    mapped_fields = [
        "account_code", "account_name", "account_type", "parent_account",
        "dashboard_category", "include_in_ebitda", "is_active", "notes"
    ]
    rows = []
    needs_review = []
    for acc in accounts:
        category = _classify(acc)
        if category == "review":
            needs_review.append(acc.get("account_name", ""))
        rows.append({
            "account_code":      acc.get("account_code", ""),
            "account_name":      acc.get("account_name", ""),
            "account_type":      acc.get("account_type", ""),
            "parent_account":    acc.get("parent_account_name", ""),
            "dashboard_category": category,
            "include_in_ebitda": "YES" if _INCLUDE_IN_EBITDA.get(category, False) else "NO",
            "is_active":         "YES" if acc.get("is_active") else "NO",
            "notes":             "NEEDS REVIEW — category unclear" if category == "review" else "",
        })

    # Sort: active first, then by category order
    _ORDER = ["revenue", "cogs", "wages", "advertising", "rent", "utilities", "sga", "excluded", "review"]
    rows.sort(key=lambda r: (_ORDER.index(r["dashboard_category"]) if r["dashboard_category"] in _ORDER else 99,
                             r["account_name"]))

    with open(mapped_path, "w", newline="", encoding="utf-8") as f:
        writer = csv.DictWriter(f, fieldnames=mapped_fields)
        writer.writeheader()
        writer.writerows(rows)
    print(f"  Mapped CoA saved: {mapped_path.name}")

    if needs_review:
        print(f"\n  {len(needs_review)} accounts flagged for manual review:")
        for name in needs_review:
            print(f"    - {name}")


def main():
    print("=== Zoho Books Chart of Accounts Fetcher ===")
    fetch_and_write("spa")
    fetch_and_write("aesthetics")
    print("\nDone. Open zoho-coa-mapping/ to review the files.")
    print("Import *_mapped.csv into the Google Sheets QC spreadsheet.")


if __name__ == "__main__":
    main()
