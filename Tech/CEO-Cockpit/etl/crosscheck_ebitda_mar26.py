"""
STRICT CROSS-CHECK: Dashboard SPA EBITDA (March 2026)

Formula:
  Dashboard EBITDA total = Zoho P&L Net Income (all mapped accounts) - Salary Supplement
  => Dashboard EBITDA + Salary Supplement = Zoho Net Income

Steps:
  1. Read actual per-location EBITDA from spa_ebitda_monthly (Supabase)
  2. Read salary supplement from salary_supplement_monthly (Supabase)
  3. Fetch Zoho SPA P&L for Mar 2026, compute net income from raw accounts
  4. Reconcile
"""
import sys, calendar
from pathlib import Path
sys.stdout.reconfigure(encoding="utf-8", errors="replace")
sys.stderr.reconfigure(encoding="utf-8", errors="replace")

try:
    from dotenv import load_dotenv
except ImportError:
    import subprocess
    subprocess.check_call([sys.executable, "-m", "pip", "install", "python-dotenv"])
    from dotenv import load_dotenv

load_dotenv(Path(__file__).resolve().parents[1] / ".env.local")
load_dotenv(Path(__file__).resolve().parents[3] / ".env")

from zoho_books_client import ZohoBooksClient
from shared.supabase_client import select
from etl_zoho_books_spa_ebitda import fetch_pl_accounts

YEAR, MONTH = 2026, 3
FROM_DATE  = f"{YEAR}-{MONTH:02d}-01"
TO_DATE    = f"{YEAR}-{MONTH:02d}-{calendar.monthrange(YEAR, MONTH)[1]:02d}"
MONTH_KEY  = FROM_DATE
LOC_NAMES  = {1: "InterContinental", 2: "Hugo's", 3: "Hyatt", 4: "Ramla",
              5: "Labranda",         6: "Sunny Coast", 7: "Excelsior", 8: "Novotel"}

sep = "─" * 70

# ── 1. Dashboard EBITDA (Supabase spa_ebitda_monthly) ─────────────────────
print(f"\n{'═'*70}")
print(f"  CROSS-CHECK: SPA EBITDA — March 2026")
print(f"{'═'*70}\n")

ebitda_rows = select("spa_ebitda_monthly", {"month": MONTH_KEY})
if not ebitda_rows:
    print("ERROR: No rows in spa_ebitda_monthly for 2026-03-01. Run the ETL first.")
    sys.exit(1)

print("1. DASHBOARD — spa_ebitda_monthly")
print(sep)
print(f"  {'Location':<20} {'Revenue':>10} {'Wages':>10} {'Other Costs':>12} {'EBITDA':>10}")
print(sep)

db_total_rev = db_total_wages = db_total_costs = db_total_ebitda = 0
db_by_loc: dict[int, dict] = {}

for r in sorted(ebitda_rows, key=lambda x: x["location_id"]):
    loc_id = r["location_id"]
    rev    = float(r.get("revenue")     or 0)
    cogs   = float(r.get("cogs")        or 0)
    wages  = float(r.get("wages")       or 0)
    adv    = float(r.get("advertising") or 0)
    rent   = float(r.get("rent")        or 0)
    utils  = float(r.get("utilities")   or 0)
    sga    = float(r.get("sga")         or 0)
    costs  = cogs + wages + adv + rent + utils + sga
    ebitda = rev - costs
    db_by_loc[loc_id] = dict(revenue=rev, wages=wages, ebitda=ebitda)
    name = LOC_NAMES.get(loc_id, f"loc_{loc_id}")
    print(f"  {name:<20} {rev:>10,.0f} {wages:>10,.0f} {costs-wages:>12,.0f} {ebitda:>10,.0f}")
    db_total_rev    += rev
    db_total_wages  += wages
    db_total_costs  += costs
    db_total_ebitda += ebitda

print(sep)
print(f"  {'TOTAL':<20} {db_total_rev:>10,.0f} {db_total_wages:>10,.0f} {db_total_costs-db_total_wages:>12,.0f} {db_total_ebitda:>10,.0f}")
print(f"\n  Dashboard EBITDA Total: €{db_total_ebitda:,.0f}")

# ── 2. Salary Supplement (Supabase salary_supplement_monthly) ─────────────
print(f"\n2. SALARY SUPPLEMENT — salary_supplement_monthly")
print(sep)

supp_rows = select("salary_supplement_monthly", {"month": MONTH_KEY})
used_month = MONTH_KEY
if not supp_rows:
    prev_key = "2026-02-01"
    supp_rows = select("salary_supplement_monthly", {"month": prev_key, "is_frozen": "true"})
    used_month = prev_key
    if supp_rows:
        print(f"  [No March frozen data — using {prev_key} as fallback (ETL prorates by day)]\n")

total_supplement = 0
if supp_rows:
    print(f"  {'Slug':<15} {'Amount':>10} {'Frozen':>8}")
    print(sep)
    for sr in sorted(supp_rows, key=lambda x: x.get("spa_slug", "")):
        slug   = sr.get("spa_slug", "?")
        amt    = float(sr.get("amount") or 0)
        frozen = "YES" if sr.get("is_frozen") else "no"
        print(f"  {slug:<15} {amt:>10,.0f} {frozen:>8}")
        total_supplement += amt
    print(sep)
    print(f"  {'TOTAL':<15} {total_supplement:>10,.0f}")
    if used_month == MONTH_KEY:
        print(f"  (March 2026 data — no proration needed)")
    else:
        days_march = calendar.monthrange(2026, 3)[1]
        days_feb   = calendar.monthrange(2026, 2)[1]
        prorated   = total_supplement / days_feb * days_march
        print(f"  (Feb 2026 data prorated {days_march}/{days_feb} days = €{prorated:,.0f})")
        total_supplement = prorated
else:
    print("  No salary supplement data found for March or February 2026.")
    print("  Proceeding with supplement = 0.")

# ── 3. Zoho Books P&L — raw net income ────────────────────────────────────
print(f"\n3. ZOHO BOOKS SPA — P&L Net Income (Mar 2026)")
print(sep)
print("  Fetching Zoho SPA P&L…")

client   = ZohoBooksClient(org="spa")
accounts = fetch_pl_accounts(client, FROM_DATE, TO_DATE)

if not accounts:
    print("  ERROR: No accounts returned from Zoho P&L.")
    sys.exit(1)

zoho_income       = sum(a["amount"] for a in accounts if a["section"] == "income")
zoho_other_income = sum(a["amount"] for a in accounts if a["section"] == "other_income")
zoho_cogs         = sum(a["amount"] for a in accounts if a["section"] == "cogs")
zoho_expenses     = sum(a["amount"] for a in accounts if a["section"] in ("expense", "other_expense"))
zoho_net          = zoho_income + zoho_other_income - zoho_cogs - zoho_expenses

print(f"  Revenue (income):       €{zoho_income:>10,.0f}")
print(f"  Other Income:           €{zoho_other_income:>10,.0f}")
print(f"  COGS:                  (€{zoho_cogs:>10,.0f})")
print(f"  Operating + Other Exp: (€{zoho_expenses:>10,.0f})")
print(sep)
print(f"  Zoho Net Income:        €{zoho_net:>10,.0f}")

# ── 4. Reconciliation ─────────────────────────────────────────────────────
print(f"\n{'═'*70}")
print("4. RECONCILIATION")
print(f"{'═'*70}")
print()
print(f"  Zoho Net Income:                  €{zoho_net:>10,.0f}")
print(f"  Less: Salary Supplement:         (€{total_supplement:>10,.0f})")
print(f"  ─────────────────────────────────────────────")
expected = zoho_net - total_supplement
print(f"  EXPECTED Dashboard EBITDA:        €{expected:>10,.0f}")
print()
print(f"  ACTUAL Dashboard EBITDA:          €{db_total_ebitda:>10,.0f}")
diff = db_total_ebitda - expected
print(f"  ─────────────────────────────────────────────")
print(f"  DIFFERENCE (actual - expected):   €{diff:>+10,.0f}")
print()

if abs(diff) < 5:
    print("  ✓  MATCH — difference within €5 rounding tolerance")
elif abs(diff) < 500:
    print("  ~  NEAR MATCH — small rounding/proration gap, likely acceptable")
else:
    pct = abs(diff) / max(abs(db_total_ebitda), 1) * 100
    print(f"  ✗  MISMATCH — €{diff:,.0f} ({pct:.1f}% of EBITDA)")
    print()
    print("  Possible causes:")
    print("  - Zoho has accounts not in COA_MAP that are excluded from EBITDA")
    print("  - Other income items excluded from dashboard mapping")
    print("  - Salary supplement proration mismatch")
    print("  - Revenue in dashboard uses Lapis (not Zoho) — run with --show-revenue-gap")

# ── 5. Revenue cross-check (Zoho vs Lapis) ────────────────────────────────
print(f"\n5. REVENUE NOTE")
print(sep)
lapis_rows = select("spa_revenue_monthly", {"month": MONTH_KEY})
if lapis_rows:
    lapis_total = sum(
        (float(r.get("services") or 0) + float(r.get("product_phytomer") or 0) +
         float(r.get("product_purest") or 0) + float(r.get("product_other") or 0) +
         float(r.get("wholesale") or 0) - float(r.get("sales_discount") or 0) -
         float(r.get("sales_refund") or 0))
        for r in lapis_rows
    )
    print(f"  Zoho Revenue (in spa_ebitda_monthly):  €{db_total_rev:>10,.0f}")
    print(f"  Lapis Net Revenue (spa_revenue_monthly): €{lapis_total:>10,.0f}")
    rev_gap = lapis_total - db_total_rev
    print(f"  Gap (Lapis - Zoho):                    €{rev_gap:>+10,.0f}")
    if abs(rev_gap) > 100:
        print(f"  NOTE: The frontend EBITDA uses Lapis revenue (not Zoho).")
        print(f"        Recalculating with Lapis revenue:")
        lapis_ebitda = lapis_total - (db_total_costs - db_total_rev + db_total_rev - db_total_wages) - db_total_wages
        # costs = total_costs (which = rev - ebitda_zoho = db_total_rev - db_total_ebitda)
        zoho_total_costs_only = db_total_rev - db_total_ebitda  # all costs
        lapis_based_ebitda = lapis_total - zoho_total_costs_only
        print(f"        Lapis-based EBITDA:  €{lapis_based_ebitda:>10,.0f}  (shown on frontend)")
        expected_lapis = zoho_net - total_supplement + rev_gap
        diff_lapis = lapis_based_ebitda - expected_lapis
        print(f"        (vs expected incl. Lapis gap: €{expected_lapis:,.0f}, diff €{diff_lapis:+,.0f})")
else:
    print(f"  Zoho Revenue (db):  €{db_total_rev:>10,.0f}")
    print(f"  Lapis data not found in spa_revenue_monthly for {MONTH_KEY}")

print()
print(f"{'═'*70}\n")
