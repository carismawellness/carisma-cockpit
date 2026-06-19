import sys
sys.stdout.reconfigure(encoding="utf-8", errors="replace")
sys.stderr.reconfigure(encoding="utf-8", errors="replace")
"""
ETL: Zoho Books SPA org -> Supabase spa_ebitda_monthly

For each calendar month in the requested date range:
  1. Fetches the Profit & Loss report from Zoho Books (SPA org)
  2. Maps every account to a dashboard EBITDA line (revenue/cogs/wages/
     advertising/rent/utilities/sga) using the approved CoA mapping
  3. Distributes shared costs across the 8 spa locations using:
       - Direct label  → 100% to the named location
       - equal         → ÷ 8 equally
       - sales_ratio   → weighted by each location's revenue that month
       - salary_cost   → weighted by each location's direct salary cost
  4. Upserts rows into spa_ebitda_monthly (idempotent)

Usage:
    cd etl
    py etl_zoho_books_spa_ebitda.py --date-from 2025-01-01 --date-to 2025-03-31
    py etl_zoho_books_spa_ebitda.py --date-from 2025-01-01 --date-to 2025-03-31 --force
"""

import argparse
import sys
import calendar
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

# ---------------------------------------------------------------------------
# Location mapping  (location key → Supabase locations.id)
# Matches seed/002_locations.sql insertion order for brand_id=1 (SPA)
# ---------------------------------------------------------------------------
LOCATION_MAP: dict[str, int] = {
    "intercontinental": 1,
    "hugos": 2,
    "hyatt": 3,
    "ramla": 4,
    "labranda": 5,
    "sunny_coast": 6,   # stored as "Odycy" in DB; displayed as "Sunny Coast" in UI
    "excelsior": 7,
    "novotel": 8,
}
ALL_LOCATION_IDS: list[int] = list(LOCATION_MAP.values())

# Benchmark monthly rent (ex-VAT) per location — used as last-resort fallback
# when neither current-month nor previous-month Zoho data is available.
# Sources: confirmed rent contracts. Sunny Coast billed quarterly (÷3 for monthly equiv).
BENCHMARK_RENT_MONTHLY: dict[int, float] = {
    LOCATION_MAP["intercontinental"]: 5100.00,
    LOCATION_MAP["hugos"]:            1000.00,
    LOCATION_MAP["hyatt"]:            1407.00,
    LOCATION_MAP["ramla"]:            1000.00,
    LOCATION_MAP["labranda"]:         1000.00,
    LOCATION_MAP["sunny_coast"]:       944.44,  # €2833.305/quarter ÷ 3
    LOCATION_MAP["excelsior"]:        2500.00,
    LOCATION_MAP["novotel"]:             0.00,  # see FIXED_RENT_MONTHLY (hardwired)
}

# Hardwired rents that NEVER flow from Zoho. The fixed monthly amount always
# overrides any Zoho-posted rent and the fallback chain; it is pro-rated to the
# period for partial months. Add a location here only when its rent is a fixed
# off-Zoho lease that must be hardcoded.
FIXED_RENT_MONTHLY: dict[int, float] = {
    LOCATION_MAP["novotel"]: 2750.00,  # fixed €2750/month lease, never billed through Zoho
}

# Revenue-based rent surcharge: a fraction of the period's net revenue added ON
# TOP of the base rent (whatever the rules above resolve to). Already period-
# scoped because net revenue is pulled for the same period, so no extra proration.
REVENUE_RENT_SURCHARGE: dict[int, float] = {
    LOCATION_MAP["excelsior"]: 0.05,  # base rent + 5% of net revenue
}

# Maps salary_supplement_monthly.spa_slug → spa_ebitda_monthly.location_id
SUPP_SLUG_TO_LOC: dict[str, int] = {
    "inter":     LOCATION_MAP["intercontinental"],
    "hugos":     LOCATION_MAP["hugos"],
    "hyatt":     LOCATION_MAP["hyatt"],
    "ramla":     LOCATION_MAP["ramla"],
    "labranda":  LOCATION_MAP["labranda"],
    "odycy":     LOCATION_MAP["sunny_coast"],
    "excelsior": LOCATION_MAP["excelsior"],
    "novotel":   LOCATION_MAP["novotel"],
}

# Salary accounts used as the base for "split by salary cost".
# Excludes Directors (616110), Other (616112), Center (602220) per approved rules.
SALARY_RATIO_ACCOUNTS: dict[str, int] = {
    "30001": 1,   # Salaries & Wages - Inter       → InterContinental
    "30002": 2,   # Salaries & Wages - Hugo's      → Hugos
    "30003": 3,   # Salaries & Wages - Hyatt       → Hyatt
    "30005": 4,   # Salaries & Wages - Ramla       → Ramla
    "30006": 5,   # Salaries & Wages - Labranda    → Labranda
    "30004": 6,   # Salaries & Wages - Sunny       → Sunny Coast
    "602221": 7,  # Salaries & Wages - Excelsior   → Excelsior
    "602222": 8,  # Salaries & Wages - Novotel     → Novotel
}

# ---------------------------------------------------------------------------
# Full CoA mapping: account_code → (split_rule, ebitda_line)
#
# split_rule: a location key from LOCATION_MAP, or:
#   "equal"        → divide equally across 8 locations
#   "sales_ratio"  → weight by each location's revenue
#   "salary_cost"  → weight by direct salary accounts (SALARY_RATIO_ACCOUNTS)
#
# ebitda_line: "revenue" | "cogs" | "wages" | "advertising" | "rent" | "utilities" | "sga"
#
# Source: ListChartOfAccounts_Mapping.xlsx columns G & H (approved 2026-04-24)
# ---------------------------------------------------------------------------
COA_MAP: dict[str, tuple[str, str]] = {

    # ── COGS ──────────────────────────────────────────────────────────────
    "651110": ("sales_ratio",      "cogs"),   # General Purchases - Professional Products
    "651120": ("sales_ratio",      "cogs"),   # General Purchases - Retail Products
    "651210": ("intercontinental", "cogs"),
    "651220": ("intercontinental", "cogs"),
    "651310": ("ramla",            "cogs"),
    "651320": ("ramla",            "cogs"),
    "651410": ("sunny_coast",      "cogs"),
    "651420": ("sunny_coast",      "cogs"),
    "651510": ("hugos",            "cogs"),
    "651520": ("hugos",            "cogs"),
    "651610": ("hyatt",            "cogs"),   # Hyatt Purchases - Professional Products
    "651620": ("hyatt",            "cogs"),   # Hyatt Purchases - Retail Products
    "651630": ("sales_ratio",      "cogs"),   # Nails - Retail
    "651640": ("sales_ratio",      "cogs"),   # Others - Retail
    "655110": ("sales_ratio",      "cogs"),   # Paypal - C.C. Processing
    "659110": ("sales_ratio",      "cogs"),   # Product - Commission
    "659120": ("sales_ratio",      "cogs"),   # Service - Commission
    "659130": ("sales_ratio",      "cogs"),   # Re-Book - Commission
    "659140": ("sales_ratio",      "cogs"),   # Sale - Commission
    "659150": ("sales_ratio",      "cogs"),   # Spa Club/Sessions - Commission
    "659151": ("equal",            "cogs"),   # Freight, Insurance and Duty
    "659152": ("equal",            "cogs"),   # Stock Written off
    "659153": ("equal",            "cogs"),   # Closing Stock
    "651111": ("equal",            "cogs"),   # Opening Stock
    "5552":   ("equal",            "cogs"),   # Local purchases of raw materials
    "147806": ("sales_ratio",      "cogs"),   # Linen Cost
    "651625": ("equal",            "cogs"),   # Purchase-Stock
    "659172": ("sales_ratio",      "cogs"),   # Cost of goods sold - The Purest Solutions
    "651130": ("equal",            "sga"),    # Tester Products (mapped to SG&A per spreadsheet)

    # ── WAGES & SALARIES ──────────────────────────────────────────────────
    "616100": ("sales_ratio",      "wages"),  # Salaries & Wages (parent)
    "616110": ("sales_ratio",      "wages"),  # Salaries & Wages - Directors
    "616111": ("sales_ratio",      "wages"),  # Salaries & Wages - Corporative Manager
    "616112": ("sales_ratio",      "wages"),  # Salaries & Wages - Other
    "616113": ("sales_ratio",      "wages"),  # Salary & payroll taxes (FS5) Corporative
    "616114": ("intercontinental", "wages"),  # Salary & payroll taxes (FS5) Inter
    "616115": ("hugos",            "wages"),  # Salary & payroll taxes (FS5) Hugo
    "616116": ("hyatt",            "wages"),  # Salary & payroll taxes (FS5) Hyatt
    "616117": ("ramla",            "wages"),  # Salary & payroll taxes (FS5) Ramla
    "616118": ("sunny_coast",      "wages"),  # Salary & payroll taxes (FS5) Seashell&Qawra
    "616120": ("intercontinental", "wages"),
    "616121": ("hugos",            "wages"),
    "616122": ("hyatt",            "wages"),
    "616123": ("ramla",            "wages"),
    "616124": ("sunny_coast",      "wages"),
    "616130": ("intercontinental", "wages"),
    "616131": ("hugos",            "wages"),
    "616132": ("hyatt",            "wages"),
    "616133": ("ramla",            "wages"),
    "616134": ("sunny_coast",      "wages"),
    "616140": ("intercontinental", "wages"),
    "616141": ("hugos",            "wages"),
    "616142": ("hyatt",            "wages"),
    "616143": ("ramla",            "wages"),
    "616144": ("sunny_coast",      "sga"),    # Therapist Seashell&Qawra — mapped SG&A per spreadsheet
    "616145": ("sales_ratio",      "wages"),  # Salaries & Wages - Hairdresser
    "616150": ("sales_ratio",      "wages"),  # Salaries & Wages - Support
    "616660": ("salary_cost",      "wages"),  # N.I. & PAYE - General
    "30001":  ("intercontinental", "wages"),
    "30002":  ("hugos",            "wages"),
    "30003":  ("hyatt",            "wages"),
    "30004":  ("sunny_coast",      "wages"),
    "30005":  ("ramla",            "wages"),
    "30006":  ("labranda",         "wages"),
    "602220": ("sales_ratio",      "wages"),  # Salary & Wages - Center
    "602221": ("excelsior",        "wages"),
    "602222": ("novotel",          "wages"),
    "1":      ("sales_ratio",      "wages"),  # Salaries & Wages - Masseuse
    "11":     ("sales_ratio",      "wages"),  # Salaries & Wages - Receptionist
    "123":    ("sunny_coast",      "wages"),  # Salaries & Wages - MANAGER [SUNNYCOAST]
    "145":    ("sales_ratio",      "wages"),  # Salaries & Wages - Graphic Designer
    "659171": ("sales_ratio",      "wages"),  # Salaries and Wages - The Purest Solutions

    # ── ADVERTISING ───────────────────────────────────────────────────────
    "611111": ("sales_ratio", "advertising"),
    "611112": ("sales_ratio", "advertising"),
    "611113": ("sales_ratio", "advertising"),
    "659168": ("equal",       "advertising"),  # The Purest Solutions

    # ── RENT ──────────────────────────────────────────────────────────────
    "619000": ("equal",            "rent"),   # Rent (parent/unallocated)
    "619110": ("ramla",            "rent"),
    "619120": ("sunny_coast",      "rent"),
    "619121": ("excelsior",        "rent"),
    "619123": ("novotel",          "rent"),
    "619140": ("intercontinental", "rent"),
    "619150": ("hyatt",            "rent"),
    "619160": ("hugos",            "rent"),
    "10001":  ("sunny_coast",      "rent"),
    "0":      ("labranda",         "rent"),
    "619500": ("equal",            "rent"),   # Rent - Motor Vehicle
    "619510": ("equal",            "rent"),   # Rent - Equipment
    "619520": ("equal",            "rent"),   # Rent - Storage
    "619530": ("equal",            "rent"),   # Rent - Flat
    "7786":   ("equal",            "rent"),   # Mobile and Telephone Rent
    "659162": ("equal",            "rent"),   # Rent - The Purest Solutions

    # ── UTILITIES ─────────────────────────────────────────────────────────
    "100":     ("equal",            "utilities"),
    "9090":    ("labranda",         "utilities"),
    "611511":  ("intercontinental", "utilities"),
    "611521":  ("hyatt",            "utilities"),
    "611531":  ("hugos",            "utilities"),
    "611541":  ("sunny_coast",      "utilities"),
    "611551":  ("ramla",            "utilities"),
    "611561":  ("sales_ratio",      "utilities"),  # Office W&E - split by revenue
    "611562":  ("labranda",         "utilities"),
    "611563":  ("novotel",          "utilities"),
    "611564":  ("excelsior",        "utilities"),
    "12346":   ("sunny_coast",      "utilities"),
    "6125000": ("equal",            "utilities"),
    "659163":  ("equal",            "utilities"),

    # ── SG&A ──────────────────────────────────────────────────────────────
    "616780":  ("equal",            "sga"),   # Bank Fees and Charges
    "611120":  ("sales_ratio",      "sga"),   # Consumables
    "611130":  ("equal",            "sga"),   # Research & Development
    "611141":  ("equal",            "sga"),   # Buildings - Repairs & Maintenance
    "611142":  ("equal",            "sga"),   # Motor Vehicles - Repairs & Maintenance
    "611143":  ("equal",            "sga"),   # Machines & Equipment - Repairs & Maintenance
    "611151":  ("salary_cost",      "sga"),   # Car - Fuel
    "611152":  ("intercontinental", "sga"),   # Hammam - Fuel - Inter Continental
    "611160":  ("equal",            "sga"),
    "611170":  ("sales_ratio",      "sga"),   # Discounts
    "611180":  ("equal",            "sga"),
    "611191":  ("equal",            "sga"),
    "611192":  ("equal",            "sga"),
    "611193":  ("sales_ratio",      "sga"),
    "611194":  ("equal",            "sga"),
    "611195":  ("equal",            "sga"),
    "611200":  ("equal",            "sga"),
    "611220":  ("equal",            "sga"),
    "611221":  ("equal",            "sga"),
    "611222":  ("equal",            "sga"),
    "611223":  ("equal",            "sga"),
    "611224":  ("equal",            "sga"),
    "611225":  ("equal",            "sga"),
    "611230":  ("equal",            "sga"),
    "611240":  ("equal",            "sga"),
    "611251":  ("sales_ratio",      "sga"),
    "611252":  ("sales_ratio",      "sga"),
    "611253":  ("equal",            "sga"),
    "611254":  ("sales_ratio",      "sga"),
    # InterContinental direct
    "611512":  ("intercontinental", "sga"),   # Telephony & Wifi
    "611513":  ("intercontinental", "sga"),   # Cleaning
    "611514":  ("intercontinental", "sga"),   # Laundry
    "611515":  ("intercontinental", "sga"),   # Consumables
    "611516":  ("intercontinental", "sga"),   # Meals & Entertainment
    "611517":  ("intercontinental", "sga"),   # Spa Insurance
    "611518":  ("intercontinental", "sga"),   # Repairs & Maintenance
    "611519":  ("equal",            "sga"),   # Repairs & Maintenance - Buildings
    "611520":  ("equal",            "sga"),   # Laundry (general)
    # Hyatt direct
    "611522":  ("hyatt",            "sga"),
    "611523":  ("hyatt",            "sga"),
    "611524":  ("hyatt",            "sga"),
    "611525":  ("hyatt",            "sga"),
    "611526":  ("hyatt",            "sga"),
    "611527":  ("hyatt",            "sga"),
    "611528":  ("hyatt",            "sga"),
    # Hugos direct
    "611530":  ("sales_ratio",      "sga"),   # Telephone & Communications (general)
    "611532":  ("hugos",            "sga"),
    "611533":  ("hugos",            "sga"),
    "611534":  ("hugos",            "sga"),
    "611535":  ("hugos",            "sga"),
    "611536":  ("hugos",            "sga"),
    "611537":  ("hugos",            "sga"),
    "611538":  ("hugos",            "sga"),
    # General Meals & Entertainment
    "611539":  ("salary_cost",      "sga"),
    "611540":  ("equal",            "sga"),   # Mobile, Telephone and Communications
    # Sunny Coast direct
    "611542":  ("sunny_coast",      "sga"),
    "611543":  ("sunny_coast",      "sga"),
    "611544":  ("sunny_coast",      "sga"),
    "611545":  ("sunny_coast",      "sga"),
    "611546":  ("sunny_coast",      "sga"),
    "611547":  ("sunny_coast",      "sga"),
    "611548":  ("sunny_coast",      "sga"),
    # Excelsior direct
    "611550":  ("excelsior",        "sga"),
    "611570":  ("excelsior",        "sga"),
    # Ramla direct
    "611552":  ("ramla",            "sga"),
    "611553":  ("ramla",            "sga"),
    "611554":  ("ramla",            "sga"),
    "611555":  ("ramla",            "sga"),
    "611556":  ("ramla",            "sga"),
    "611557":  ("ramla",            "sga"),
    "611558":  ("ramla",            "sga"),
    "611559":  ("equal",            "sga"),   # Repairs & Maintenance - General
    # Novotel direct
    "611560":  ("novotel",          "sga"),
    "611572":  ("novotel",          "sga"),
    # Grand Hotel / shared
    "611571":  ("equal",            "sga"),
    # Depreciation / general
    "611110":  ("equal",            "sga"),
    "611114":  ("equal",            "sga"),
    "611115":  ("equal",            "sga"),
    "611196":  ("equal",            "sga"),
    "612520":  ("equal",            "sga"),
    "651180":  ("equal",            "sga"),
    "400025":  ("equal",            "sga"),
    "600":     ("equal",            "sga"),
    "12":      ("equal",            "sga"),
    "2222":    ("salary_cost",      "sga"),
    "98765":   ("equal",            "sga"),
    "4411":    ("labranda",         "sga"),
    "619122":  ("labranda",         "sga"),
    "619126":  ("labranda",         "sga"),
    "1457":    ("sunny_coast",      "sga"),
    "1566":    ("labranda",         "sga"),
    "14575":   ("novotel",          "sga"),
    "60007":   ("labranda",         "sga"),
    "123456":  ("equal",            "sga"),
    "123455":  ("equal",            "sga"),
    "CUST":    ("equal",            "sga"),
    # The Purest Solutions (split equally by default)
    "659157":  ("equal",            "sga"),
    "659158":  ("equal",            "sga"),
    "659159":  ("equal",            "sga"),
    "659160":  ("equal",            "sga"),
    "659161":  ("equal",            "sga"),
    "659164":  ("equal",            "sga"),
    "659165":  ("equal",            "sga"),
    "659166":  ("equal",            "sga"),
    "659167":  ("equal",            "sga"),
    "659169":  ("equal",            "sga"),
    "659170":  ("equal",            "sga"),
    "659173":  ("salary_cost",      "sga"),
    "659174":  ("sales_ratio",      "sga"),
    "659175":  ("equal",            "sga"),
    "659176":  ("equal",            "sga"),
    "659177":  ("equal",            "sga"),
    # Travel / welfare / general
    "616610":  ("sales_ratio",      "sga"),
    "616611":  ("sales_ratio",      "sga"),
    "616620":  ("sales_ratio",      "sga"),
    "616630":  ("sales_ratio",      "sga"),
    "616640":  ("salary_cost",      "sga"),
    "616641":  ("intercontinental", "sga"),
    "616642":  ("sunny_coast",      "sga"),
    "616643":  ("ramla",            "sga"),
    "616644":  ("salary_cost",      "sga"),
    "616650":  ("equal",            "sga"),
    "616670":  ("sales_ratio",      "sga"),
    "616671":  ("ramla",            "sga"),
    "616680":  ("equal",            "sga"),
    "616681":  ("equal",            "sga"),
    "616700":  ("equal",            "sga"),
    "616710":  ("sales_ratio",      "sga"),
    "616720":  ("equal",            "sga"),
    "616730":  ("equal",            "sga"),
    "616740":  ("equal",            "sga"),
    "616750":  ("equal",            "sga"),
    "616770":  ("equal",            "sga"),
    "616771":  ("labranda",         "sga"),
    # Below-EBITDA items — user mapped these to SG&A in the spreadsheet
    "605":     ("equal",            "sga"),   # Interest Paid
    "6050005": ("equal",            "sga"),   # Subcontractor
    "2356":    ("equal",            "sga"),   # Assets Written Off
    "616800":  ("equal",            "sga"),   # Corporate Tax
    "25":      ("equal",            "sga"),   # Unprocessed transactions
    "999":     ("equal",            "sga"),   # Repairs & Maintenance (parent)
}

# UI config key (in coa_split_rules.config) → LOCATION_MAP key
_UI_KEY_TO_LOC: dict[str, str] = {
    "inter":     "intercontinental",
    "hugos":     "hugos",
    "hyatt":     "hyatt",
    "ramla":     "ramla",
    "labranda":  "labranda",
    "odycy":     "sunny_coast",
    "excelsior": "excelsior",
    "novotel":   "novotel",
}


def _rule_from_db(rule_type: str, config: dict | None) -> str:
    """Convert a DB split rule into the string format expected by distribute()."""
    if rule_type in ("equal", "sales_ratio", "salary_cost"):
        return rule_type
    if rule_type == "direct":
        return "equal"  # label check is now always implicit; direct → equal fallback
    if rule_type == "custom_fixed" and config:
        # If 100% to a single location, use the location key directly
        non_zero = {k: v for k, v in config.items() if v > 0}
        if len(non_zero) == 1:
            ui_key = next(iter(non_zero))
            if non_zero[ui_key] >= 99.9:
                return _UI_KEY_TO_LOC.get(ui_key, "equal")
        # Multi-location: encode as "custom:{ui_key:pct,...}"
        import json
        return f"custom:{json.dumps(config, separators=(',', ':'))}"
    return "equal"


def load_coa_from_supabase(org: str = "spa") -> dict[str, tuple[str, str]] | None:
    """
    Load the COA mapping from Supabase zoho_coa_mapping table.
    Returns a dict in the same format as COA_MAP, or None if the table is empty.
    Falls back to the hardcoded COA_MAP when called from run_month().
    """
    import os, requests as _req
    try:
        base = os.environ.get("SUPABASE_URL") or os.environ["NEXT_PUBLIC_SUPABASE_URL"]
        key  = os.environ["SUPABASE_SERVICE_ROLE_KEY"]
        headers = {
            "apikey": key,
            "Authorization": f"Bearer {key}",
        }
        resp = _req.get(
            f"{base}/rest/v1/zoho_coa_mapping",
            headers=headers,
            params={
                "select":      "account_code,ebitda_line,coa_split_rules(rule_type,config)",
                "zoho_org":    f"eq.{org}",
                "ebitda_line": "not.is.null",
                "split_rule_id": "not.is.null",
            },
            timeout=30,
        )
        resp.raise_for_status()
        data = resp.json()
        if not data:
            return None
        result: dict[str, tuple[str, str]] = {}
        for row in data:
            code = str(row["account_code"]).strip()
            line = row["ebitda_line"]
            if line == "excluded":
                continue
            rule_obj = row.get("coa_split_rules") or {}
            rule_str = _rule_from_db(
                rule_obj.get("rule_type", "equal"),
                rule_obj.get("config"),
            )
            result[code] = (rule_str, line)
        return result if result else None
    except Exception as e:
        print(f"  [warn] Could not load COA mapping from Supabase: {e}. Using hardcoded map.")
        return None


# ---------------------------------------------------------------------------
# Name-based fallback helpers
# ---------------------------------------------------------------------------

_LOC_KEYWORDS: list[tuple[list[str], str]] = [
    (["intercontinental", " inter "], "intercontinental"),
    (["hugos", "hugo's", "hugo "],    "hugos"),
    (["hyatt"],                        "hyatt"),
    (["ramla"],                        "ramla"),
    (["labranda"],                     "labranda"),
    (["seashell", "qawra", "sunny", "odycy"], "sunny_coast"),
    (["excelsior"],                    "excelsior"),
    (["novotel"],                      "novotel"),
]


def _detect_location(name: str) -> str | None:
    low = f" {name.lower()} "
    for keywords, key in _LOC_KEYWORDS:
        if any(kw in low for kw in keywords):
            return key
    return None


def _detect_line_from_name(name: str, section: str) -> str:
    low = name.lower()
    if section == "income":
        return "revenue"
    if any(k in low for k in ["salary", "salaries", "wage", "overtime", "bonus", "ni ", "paye", "payroll"]):
        return "wages"
    if any(k in low for k in ["rent", "lease"]):
        return "rent"
    if any(k in low for k in ["electric", "water", "utility", "wifi", "telephon", "mobile", "internet"]):
        return "utilities"
    if any(k in low for k in ["marketing", "advertis", "digital", "print", "influenc"]):
        return "advertising"
    if section in ("cogs", "cost_of_goods_sold"):
        return "cogs"
    return "sga"


# ---------------------------------------------------------------------------
# P&L account extraction
# ---------------------------------------------------------------------------

def _extract_accounts(node: object, section_type: str, result: list) -> None:
    """Recursively walk Zoho P&L response and collect leaf accounts."""
    if isinstance(node, list):
        for item in node:
            _extract_accounts(item, section_type, result)
        return
    if not isinstance(node, dict):
        return
    sub = node.get("accounts")
    if sub:
        _extract_accounts(sub, section_type, result)
        return
    # Leaf account
    code = str(node.get("account_code") or "").strip()
    name = str(node.get("account_name") or "").strip()
    if not name and not code:
        return
    amount: float = 0.0
    for field in ("bcy_balance", "balance", "total", "amount", "debit_amount"):
        raw = node.get(field)
        if raw is not None:
            try:
                amount = abs(float(raw))
                break
            except (ValueError, TypeError):
                pass
    if amount == 0:
        debit  = float(node.get("debit_amount")  or 0)
        credit = float(node.get("credit_amount") or 0)
        if section_type == "income":
            amount = max(0.0, credit - debit)
        else:
            amount = max(0.0, debit - credit)
    result.append({"code": code, "name": name, "section": section_type, "amount": amount})


_SECTION_TYPES: dict[str, str] = {
    "income":              "income",
    "revenue":             "income",
    "other_income":        "other_income",
    "cost_of_goods_sold":  "cogs",
    "cogs":                "cogs",
    "operating_expense":   "expense",
    "expense":             "expense",
    "expenses":            "expense",
    "other_expense":       "other_expense",
}

# Maps sub-section names from the account_transactions format to section types.
# Zoho SPA org returns profit_and_loss as a list; accounts are under account_transactions.
_SUBSECTION_TYPES: dict[str, str] = {
    "operating income":        "income",
    "income":                  "income",
    "revenue":                 "income",
    "non operating income":    "other_income",
    "other income":            "other_income",
    "cost of goods sold":      "cogs",
    "operating expense":       "expense",
    "operating expenses":      "expense",
    "expense":                 "expense",
    "expenses":                "expense",
    "non operating expense":   "other_expense",
    "non operating expenses":  "other_expense",
    "other expense":           "other_expense",
    "other expenses":          "other_expense",
}


def _walk_account_txns(nodes: list, section_type: str | None, result: list) -> None:
    """Recursively walk account_transactions lists and collect leaf accounts.

    Zoho P&L for SPA org: profit_and_loss is a list of section groups (e.g. "Gross
    Profit", "Operating Profit"). Each has account_transactions containing sub-section
    nodes (e.g. "Operating Income", "Cost of Goods Sold") and leaf accounts with
    account_code, name, total fields.
    """
    for node in nodes:
        if not isinstance(node, dict):
            continue
        # Determine section type from node name (strip "Total " prefix Zoho sometimes adds)
        raw_name = (node.get("name") or "").lower().strip()
        if raw_name.startswith("total "):
            raw_name = raw_name[6:]
        stype = _SUBSECTION_TYPES.get(raw_name, section_type)

        sub = node.get("account_transactions")
        if sub:
            _walk_account_txns(sub, stype, result)
        else:
            if not stype:
                continue
            code = str(node.get("account_code") or "").strip()
            name = str(node.get("name") or "").strip()
            if not name and not code:
                continue
            amount = abs(float(node.get("total") or 0))
            result.append({"code": code, "name": name, "section": stype, "amount": amount})


def fetch_pl_accounts(client: ZohoBooksClient, from_date: str, to_date: str) -> list[dict]:
    data = client.get("reports/profitandloss", {
        "from_date":    from_date,
        "to_date":      to_date,
        "cash_based":   "false",
    })
    pl = data.get("profit_and_loss", data)
    accounts: list[dict] = []

    if isinstance(pl, list):
        # account_transactions-based format (confirmed SPA org response)
        _walk_account_txns(pl, None, accounts)
    elif isinstance(pl, dict):
        # Legacy dict format (accounts key per section)
        for key, stype in _SECTION_TYPES.items():
            if key in pl:
                _extract_accounts(pl[key], stype, accounts)

    return accounts


# ---------------------------------------------------------------------------
# Distribution logic
# ---------------------------------------------------------------------------

def _empty_loc_totals() -> dict[int, float]:
    return {loc_id: 0.0 for loc_id in ALL_LOCATION_IDS}


def distribute(
    rule: str,
    amount: float,
    loc_revenue: dict[int, float],
    total_revenue: float,
    loc_salary: dict[int, float],
    total_salary: float,
) -> dict[int, float]:
    if rule in LOCATION_MAP:
        result = _empty_loc_totals()
        result[LOCATION_MAP[rule]] = amount
        return result
    if rule == "equal":
        share = amount / 8.0
        return {loc_id: share for loc_id in ALL_LOCATION_IDS}
    if rule == "sales_ratio":
        denom = total_revenue or 1.0
        return {loc_id: amount * (loc_revenue.get(loc_id, 0) / denom) for loc_id in ALL_LOCATION_IDS}
    if rule == "salary_cost":
        denom = total_salary or 1.0
        return {loc_id: amount * (loc_salary.get(loc_id, 0) / denom) for loc_id in ALL_LOCATION_IDS}
    if rule.startswith("custom:"):
        import json
        config: dict[str, float] = json.loads(rule[7:])
        result = _empty_loc_totals()
        total_pct = sum(config.values()) or 100.0
        for ui_key, pct in config.items():
            loc_key = _UI_KEY_TO_LOC.get(ui_key)
            if loc_key and loc_key in LOCATION_MAP:
                result[LOCATION_MAP[loc_key]] += amount * (pct / total_pct)
        return result
    # Unknown rule: equal fallback
    share = amount / 8.0
    return {loc_id: share for loc_id in ALL_LOCATION_IDS}


# ---------------------------------------------------------------------------
# Per-month processing
# ---------------------------------------------------------------------------

def last_day(year: int, month: int) -> str:
    return f"{year}-{month:02d}-{calendar.monthrange(year, month)[1]:02d}"


def month_already_synced(month_key: str) -> bool:
    import os, requests as _req
    base = os.environ.get("SUPABASE_URL") or os.environ["NEXT_PUBLIC_SUPABASE_URL"]
    key  = os.environ["SUPABASE_SERVICE_ROLE_KEY"]
    resp = _req.get(
        f"{base}/rest/v1/spa_ebitda_monthly",
        headers={"apikey": key, "Authorization": f"Bearer {key}"},
        params={"select": "id", "month": f"eq.{month_key}", "limit": "1"},
        timeout=10,
    )
    return bool(resp.json()) if resp.ok else False


def run_month(client: ZohoBooksClient, year: int, month_num: int, force: bool = False,
              active_coa_map: dict | None = None,
              from_date_override: str | None = None,
              to_date_override: str | None = None) -> int:
    from_date = from_date_override or f"{year}-{month_num:02d}-01"
    to_date   = to_date_override   or last_day(year, month_num)
    month_key = f"{year}-{month_num:02d}-01"  # always the calendar month identifier

    # Actual days in the reporting period (may be < full month for partial runs)
    _from_d = date.fromisoformat(from_date)
    _to_d   = date.fromisoformat(to_date)
    period_days_actual = (_to_d - _from_d).days + 1

    if not force and month_already_synced(month_key):
        print(f"  {month_key}: cached — skipping (use --force to re-fetch)")
        return 0

    # Use DB mapping if provided, else fall back to hardcoded COA_MAP
    coa_map = active_coa_map if active_coa_map is not None else COA_MAP

    print(f"  {month_key}: fetching from Zoho Books...", flush=True)
    raw_accounts = fetch_pl_accounts(client, from_date, to_date)

    if not raw_accounts:
        print(f"  {month_key}: no accounts returned from Zoho")
        return 0

    # ── Step 1: Map every account ─────────────────────────────────────────
    EBITDA_LINES = {"revenue", "cogs", "wages", "advertising", "rent", "utilities", "sga"}
    mapped: list[tuple[str, str, float]] = []  # (rule, line, amount)

    # Collect accounts that fall through to name-based detection (not in coa_map).
    # Printed at end so you can review mis-categorised entries.
    fallback_mapped:  list[dict] = []  # code not in coa_map → auto-detected line
    skipped_accounts: list[dict] = []  # non-zero accounts skipped entirely

    for acc in raw_accounts:
        code    = acc["code"]
        name    = acc["name"]
        section = acc["section"]
        amount  = acc["amount"]
        if amount == 0:
            continue
        # Skip pure other_income / other_expense unless explicitly mapped
        if section in ("other_income",) and code not in COA_MAP:
            skipped_accounts.append({"code": code, "name": name, "section": section, "amount": amount})
            continue

        if code in coa_map:
            configured_rule, line = coa_map[code]
            auto = False
        elif section == "income":
            configured_rule = "sales_ratio"
            line = "revenue"
            auto = True
        else:
            configured_rule = "equal"
            line = _detect_line_from_name(name, section)
            auto = True

        # Label check is always first: if account name contains a location
        # keyword, assign 100% to that location regardless of configured rule.
        loc = _detect_location(name)
        rule = loc if loc else configured_rule

        if line not in EBITDA_LINES:
            skipped_accounts.append({"code": code, "name": name, "section": section, "amount": amount})
            continue

        if auto:
            fallback_mapped.append({
                "code": code, "name": name, "section": section,
                "amount": amount, "line": line, "rule": rule,
            })

        mapped.append((rule, line, amount))

    # ── Step 1 check: flag accounts that used name-based fallback ────────────
    if fallback_mapped:
        print(f"\n  ⚠  UNMAPPED ACCOUNTS — auto-detected line (review in CoA mapping):")
        print(f"  {'Code':<10} {'Amount':>10}  {'→ Line':<12}  {'Rule':<14}  Name")
        print(f"  {'-'*10} {'-'*10}  {'-'*12}  {'-'*14}  {'-'*40}")
        for r in sorted(fallback_mapped, key=lambda x: -x["amount"]):
            print(f"  {r['code']:<10} {r['amount']:>10.2f}  {r['line']:<12}  {r['rule']:<14}  {r['name']}")
        print()

    if skipped_accounts:
        print(f"  ℹ  SKIPPED (other_income or unrecognised line, amount > 0):")
        for r in sorted(skipped_accounts, key=lambda x: -x["amount"]):
            print(f"  {r['code']:<10} {r['amount']:>10.2f}  [{r['section']}]  {r['name']}")
        print()

    # ── Step 2: Build revenue & salary bases for ratio splits ─────────────
    loc_revenue: dict[int, float] = _empty_loc_totals()
    for rule, line, amount in mapped:
        if line == "revenue" and rule in LOCATION_MAP:
            loc_revenue[LOCATION_MAP[rule]] += amount

    loc_salary: dict[int, float] = _empty_loc_totals()
    for acc in raw_accounts:
        if acc["code"] in SALARY_RATIO_ACCOUNTS:
            loc_salary[SALARY_RATIO_ACCOUNTS[acc["code"]]] += acc["amount"]

    total_revenue = sum(loc_revenue.values()) or 1.0
    total_salary  = sum(loc_salary.values())  or 1.0

    # ── Step 3: Distribute all amounts ────────────────────────────────────
    Line = str
    totals: dict[int, dict[Line, float]] = {
        loc_id: {ln: 0.0 for ln in EBITDA_LINES}
        for loc_id in ALL_LOCATION_IDS
    }
    for rule, line, amount in mapped:
        dist = distribute(rule, amount, loc_revenue, total_revenue, loc_salary, total_salary)
        for loc_id, share in dist.items():
            totals[loc_id][line] += share

    # Track laundry subtotals separately so the fallback (Step 3e) can compare
    # against previous month without needing to decompose the sga bucket.
    LAUNDRY_ACCOUNTS = {"611514", "611520"}
    laundry_totals: dict[int, float] = {loc_id: 0.0 for loc_id in ALL_LOCATION_IDS}
    for acc in raw_accounts:
        code = acc.get("code", "")
        if code in LAUNDRY_ACCOUNTS and code in coa_map:
            rule_l, _ = coa_map[code]
            loc_l = _detect_location(acc.get("name", ""))
            effective_rule = loc_l if loc_l else rule_l
            dist = distribute(effective_rule, acc["amount"], loc_revenue, total_revenue, loc_salary, total_salary)
            for loc_id, share in dist.items():
                laundry_totals[loc_id] += share

    # ── Step 3c: Wage fallback — if Zoho has no payroll for period ──────────
    # Triggers when: (a) total wages < €100 absolute, OR
    #                (b) wages < 35% of previous month (partial/no payroll posted)
    WAGE_ZERO_THRESHOLD  = 100.0   # absolute floor
    WAGE_LOW_FRACTION    = 0.35    # relative floor vs previous month Zoho wages
    total_zoho_wages = sum(totals[loc]["wages"] for loc in ALL_LOCATION_IDS)

    prev_y, prev_m = (year, month_num - 1) if month_num > 1 else (year - 1, 12)
    prev_key  = f"{prev_y}-{prev_m:02d}-01"
    prev_days = calendar.monthrange(prev_y, prev_m)[1]
    try:
        prev_ebitda = select("spa_ebitda_monthly", {"month": prev_key})

        # Recover Zoho-only wages for previous month by subtracting its supplement
        prev_supp_rows = select("salary_supplement_monthly",
                                {"month": prev_key, "is_frozen": "true"})
        prev_supp_by_loc: dict[int, float] = {loc: 0.0 for loc in ALL_LOCATION_IDS}
        centre_prev = 0.0
        for sr in prev_supp_rows:
            slug = sr.get("spa_slug")
            amt  = float(sr.get("amount") or 0)
            if slug in SUPP_SLUG_TO_LOC:
                prev_supp_by_loc[SUPP_SLUG_TO_LOC[slug]] += amt
            elif slug == "hq":
                centre_prev += amt
        if centre_prev > 0 and total_salary > 0:
            for loc_id, sal in loc_salary.items():
                prev_supp_by_loc[loc_id] += centre_prev * sal / total_salary
        elif centre_prev > 0:
            for loc_id in ALL_LOCATION_IDS:
                prev_supp_by_loc[loc_id] += centre_prev / len(ALL_LOCATION_IDS)

        prev_zoho_wages_by_loc: dict[int, float] = {}
        prev_total_zoho_wages = 0.0
        if prev_ebitda:
            for pr in prev_ebitda:
                loc_id = pr.get("location_id")
                if loc_id in totals:
                    w = max(0.0, float(pr.get("wages") or 0) - prev_supp_by_loc.get(loc_id, 0.0))
                    prev_zoho_wages_by_loc[loc_id] = w
                    prev_total_zoho_wages += w

        use_fallback = (
            total_zoho_wages < WAGE_ZERO_THRESHOLD or
            (prev_total_zoho_wages > 0 and total_zoho_wages < prev_total_zoho_wages * WAGE_LOW_FRACTION)
        )

        if use_fallback and prev_ebitda:
            for loc_id in totals:
                w = prev_zoho_wages_by_loc.get(loc_id, 0.0)
                totals[loc_id]["wages"] = w / prev_days * period_days_actual
            print(f"  Wages fallback: Zoho wages EUR{total_zoho_wages:,.0f} < "
                  f"{WAGE_LOW_FRACTION:.0%} of {prev_key} EUR{prev_total_zoho_wages:,.0f} — "
                  f"using {prev_key} prorated {period_days_actual}/{prev_days} days")
    except Exception as exc:
        print(f"  Warning: wage fallback failed: {exc}")

    # ── Step 3d: Rent fallback and per-day proration (per location) ──────────
    # Checked per location, not in aggregate:
    #   - If a location has no rent yet AND previous month had rent → fall back + prorate
    #   - If a location has no rent AND previous month also had none → genuinely no rent, leave as 0
    #   - If a location has rent already posted → prorate for partial periods
    RENT_ZERO_THRESHOLD = 1.0   # per-location; below this = not yet posted
    month_days = calendar.monthrange(year, month_num)[1]
    prev_y, prev_m = (year, month_num - 1) if month_num > 1 else (year - 1, 12)
    prev_key  = f"{prev_y}-{prev_m:02d}-01"
    prev_days = calendar.monthrange(prev_y, prev_m)[1]

    prev_rent_by_loc: dict[int, float] = {}
    try:
        prev_ebitda_rows = select("spa_ebitda_monthly", {"month": prev_key})
        for pr in (prev_ebitda_rows or []):
            loc_id = pr.get("location_id")
            if loc_id in totals:
                prev_rent_by_loc[loc_id] = float(pr.get("rent") or 0)
    except Exception as exc:
        print(f"  Warning: could not load previous month rent for fallback: {exc}")

    fallback_count   = 0
    benchmark_count  = 0
    fixed_count      = 0
    for loc_id in ALL_LOCATION_IDS:
        # Hardwired fixed rent (never from Zoho) — always overrides, pro-rated to period.
        if loc_id in FIXED_RENT_MONTHLY:
            totals[loc_id]["rent"] = FIXED_RENT_MONTHLY[loc_id] / month_days * period_days_actual
            fixed_count += 1
            continue

        current_rent = totals[loc_id]["rent"]
        prev_rent    = prev_rent_by_loc.get(loc_id, 0.0)
        benchmark    = BENCHMARK_RENT_MONTHLY.get(loc_id, 0.0)

        if current_rent < RENT_ZERO_THRESHOLD and prev_rent > 0:
            # Tier 1: not yet posted — use previous month's rent prorated per day
            totals[loc_id]["rent"] = prev_rent / prev_days * period_days_actual
            fallback_count += 1
        elif current_rent < RENT_ZERO_THRESHOLD and prev_rent <= 0 and benchmark > 0:
            # Tier 2: no Zoho history at all — use benchmark monthly rent prorated
            totals[loc_id]["rent"] = benchmark / month_days * period_days_actual
            benchmark_count += 1
        elif current_rent >= RENT_ZERO_THRESHOLD and period_days_actual < month_days:
            # Already posted — prorate to actual period days
            totals[loc_id]["rent"] = current_rent / month_days * period_days_actual

    # Revenue-based surcharge: add x% of period net revenue on top of base rent.
    for loc_id in ALL_LOCATION_IDS:
        pct = REVENUE_RENT_SURCHARGE.get(loc_id, 0.0)
        if pct > 0:
            surcharge = totals[loc_id]["revenue"] * pct
            totals[loc_id]["rent"] += surcharge
            print(f"  Rent surcharge: location {loc_id} +EUR{surcharge:.2f} "
                  f"({pct * 100:.0f}% of net revenue EUR{totals[loc_id]['revenue']:.2f})")

    if fixed_count:
        print(f"  Rent hardwired: {fixed_count} location(s) used fixed monthly rent "
              f"prorated {period_days_actual}/{month_days} days (off-Zoho lease)")
    if fallback_count:
        print(f"  Rent fallback: {fallback_count} locations used {prev_key} "
              f"prorated {period_days_actual}/{prev_days} days")
    if benchmark_count:
        print(f"  Rent benchmark: {benchmark_count} locations used hardcoded benchmark "
              f"prorated {period_days_actual}/{month_days} days")
    if period_days_actual < month_days:
        print(f"  Rent prorated: {period_days_actual}/{month_days} days")

    # ── Step 3e: Laundry fallback — if Zoho has no laundry posted yet ────────
    # Triggers when: (a) total laundry < €10 absolute, OR
    #                (b) laundry < 35% of previous month's laundry
    # Adjusts sga by the delta (fallback - actual) and updates laundry_totals.
    LAUNDRY_ZERO_THRESHOLD = 10.0
    LAUNDRY_LOW_FRACTION   = 0.35
    total_zoho_laundry = sum(laundry_totals.values())

    try:
        prev_ebitda_laundry = select("spa_ebitda_monthly", {"month": prev_key})
        prev_laundry_by_loc: dict[int, float] = {}
        prev_total_laundry = 0.0
        for pr in (prev_ebitda_laundry or []):
            loc_id = pr.get("location_id")
            if loc_id in totals:
                l = float(pr.get("laundry") or 0)
                prev_laundry_by_loc[loc_id] = l
                prev_total_laundry += l

        use_laundry_fallback = (
            total_zoho_laundry < LAUNDRY_ZERO_THRESHOLD or
            (prev_total_laundry > 0 and total_zoho_laundry < prev_total_laundry * LAUNDRY_LOW_FRACTION)
        )

        if use_laundry_fallback and prev_total_laundry > 0:
            for loc_id in ALL_LOCATION_IDS:
                fallback_l = prev_laundry_by_loc.get(loc_id, 0.0) / prev_days * period_days_actual
                delta = fallback_l - laundry_totals[loc_id]
                totals[loc_id]["sga"] += delta
                laundry_totals[loc_id] = fallback_l
            print(f"  Laundry fallback: Zoho laundry EUR{total_zoho_laundry:,.0f} < "
                  f"{LAUNDRY_LOW_FRACTION:.0%} of {prev_key} EUR{prev_total_laundry:,.0f} — "
                  f"using {prev_key} prorated {period_days_actual}/{prev_days} days")
    except Exception as exc:
        print(f"  Warning: laundry fallback failed: {exc}")

    # ── Step 3b: Add salary supplement (prorated per day, with fallback) ───
    try:
        month_days = calendar.monthrange(year, month_num)[1]

        # Try current month first; fall back to previous month if not yet frozen
        supp_rows = select("salary_supplement_monthly", {"month": month_key, "is_frozen": "true"})
        supp_days = month_days  # same month — denominator equals numerator

        if not supp_rows:
            prev_y, prev_m = (year, month_num - 1) if month_num > 1 else (year - 1, 12)
            prev_key = f"{prev_y}-{prev_m:02d}-01"
            supp_rows = select("salary_supplement_monthly", {"month": prev_key, "is_frozen": "true"})
            supp_days = calendar.monthrange(prev_y, prev_m)[1]
            if supp_rows:
                print(f"  Supplement: no frozen data for {month_key}, using {prev_key}")

        if supp_rows:
            centre_supplement = 0.0
            assigned_count = 0

            for sr in supp_rows:
                slug = sr.get("spa_slug")
                if not slug:
                    continue
                # Prorate: daily rate × actual days in reporting period
                prorated = float(sr.get("amount") or 0) / supp_days * period_days_actual

                if slug in SUPP_SLUG_TO_LOC:
                    totals[SUPP_SLUG_TO_LOC[slug]]["wages"] += prorated
                    assigned_count += 1
                elif slug == "hq":
                    centre_supplement += prorated
                    assigned_count += 1
                # aesthetics slug intentionally skipped — not part of SPA EBITDA

            if centre_supplement > 0:
                if total_salary > 0:
                    for loc_id, sal in loc_salary.items():
                        totals[loc_id]["wages"] += centre_supplement * sal / total_salary
                else:
                    equal = centre_supplement / len(ALL_LOCATION_IDS)
                    for loc_id in ALL_LOCATION_IDS:
                        totals[loc_id]["wages"] += equal

            print(f"  Supplement: {assigned_count} rows added to wages "
                  f"({period_days_actual}/{supp_days} day proration)")

    except Exception as exc:
        print(f"  Warning: could not load salary supplement: {exc}")

    # ── Step 4: Upsert to Supabase ────────────────────────────────────────
    now_ts = datetime.now(timezone.utc).isoformat()
    rows = [
        {
            "month":          month_key,
            "location_id":    loc_id,
            "revenue":        round(d["revenue"],     2),
            "cogs":           round(d["cogs"],        2),
            "wages":          round(d["wages"],       2),
            "advertising":    round(d["advertising"], 2),
            "rent":           round(d["rent"],        2),
            "utilities":      round(d["utilities"],   2),
            "sga":            round(d["sga"],         2),
            "laundry":        round(laundry_totals[loc_id], 2),
            "total":          round(d["revenue"] - d["cogs"] - d["wages"] - d["advertising"] - d["rent"] - d["utilities"] - d["sga"], 2),
            "zoho_synced_at": now_ts,
        }
        for loc_id, d in totals.items()
    ]
    n = upsert("spa_ebitda_monthly", rows, "month,location_id")
    print(f"  {month_key}: {n} rows upserted")
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
    parser = argparse.ArgumentParser(description="Sync Zoho Books SPA P&L → Supabase spa_ebitda_monthly")
    parser.add_argument("--date-from", required=True, help="Start date YYYY-MM-DD")
    parser.add_argument("--date-to",   required=True, help="End date YYYY-MM-DD")
    parser.add_argument("--force",     action="store_true", help="Re-fetch even if month already cached")
    args = parser.parse_args()

    try:
        date_from = date.fromisoformat(args.date_from)
        date_to   = date.fromisoformat(args.date_to)
    except ValueError as exc:
        print(f"ERROR: bad date format — {exc}")
        sys.exit(1)

    logger = ETLLogger("zoho_spa_ebitda")
    logger.start()
    total = 0

    try:
        client = ZohoBooksClient(org="spa")

        # Try to load COA mapping from Supabase settings; fall back to hardcoded
        print("Loading COA mapping…", end=" ", flush=True)
        active_coa_map = load_coa_from_supabase(org="spa")
        if active_coa_map:
            print(f"loaded {len(active_coa_map)} accounts from Supabase settings.")
        else:
            active_coa_map = COA_MAP
            print(f"Supabase mapping empty — using hardcoded map ({len(COA_MAP)} accounts).")

        months = list(iter_months(date_from, date_to))
        print(f"Processing {len(months)} month(s): {args.date_from} → {args.date_to}")
        for y, mo in months:
            # Pass the user-supplied dates for the first/last month so partial
            # periods (e.g. Apr 3-10) are fetched and prorated correctly.
            is_first = (y == date_from.year and mo == date_from.month)
            is_last  = (y == date_to.year   and mo == date_to.month)
            from_override = date_from.isoformat() if is_first else None
            to_override   = date_to.isoformat()   if is_last  else None
            total += run_month(client, y, mo, force=args.force,
                               active_coa_map=active_coa_map,
                               from_date_override=from_override,
                               to_date_override=to_override)
        logger.complete(total)
        print(f"\nDone — {total} total rows upserted.")
    except Exception as exc:
        import traceback
        traceback.print_exc()
        logger.fail(str(exc))
        print(f"ERROR: {exc}", file=sys.stderr)
        sys.exit(1)


if __name__ == "__main__":
    main()
