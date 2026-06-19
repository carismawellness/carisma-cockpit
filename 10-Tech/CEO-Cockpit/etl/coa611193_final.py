import sys
sys.stdout.reconfigure(encoding="utf-8", errors="replace")
sys.stderr.reconfigure(encoding="utf-8", errors="replace")
"""
FINAL breakdown of SPA Zoho COA 611193 (Consulting - Professional Services),
Jan 2025 -> Apr 2026.

Reuses the cached detail records from coa611193_breakdown.py. Attribution waterfall
follows the user's stated priority:  1) vendor/contact  2) name in notes  3) bank-feed payee.
Each payee is tagged with its Zoho Cost-Centre tag and a derived role/category tag.
"""
import json, re, csv
from collections import defaultdict
from datetime import date
from pathlib import Path
from dotenv import load_dotenv

load_dotenv(r"c:\Users\Deepa Patel\OneDrive - Project Payables ltd\Desktop\Cockpit\carisma-support\.env")
from zoho_books_client import ZohoBooksClient

ACCT      = "128265000000446177"
DATE_FROM = date(2025, 1, 1)
DATE_TO   = date(2026, 4, 30)
CACHE     = Path(r"c:/tmp/coa611193_detail_cache.json")
OUT_CSV   = Path(r"c:/tmp/coa611193_breakdown_final.csv")
OUT_MD    = Path(r"c:/tmp/coa611193_breakdown_final.md")

cache = json.loads(CACHE.read_text(encoding="utf-8"))
client = ZohoBooksClient(org="spa")

raw = client.get_all_pages("chartofaccounts/transactions", "transactions",
                           {"account_id": ACCT, "from_date": DATE_FROM.isoformat(), "to_date": DATE_TO.isoformat()})
def in_window(d):
    try: return DATE_FROM <= date.fromisoformat(d) <= DATE_TO
    except Exception: return False
lines = [t for t in raw if in_window(t.get("transaction_date",""))]

# ── Canonical payee aliases: (substring to match, Canonical name, Category tag) ──
# Order matters; first hit wins. Categories double as the role tag.
ALIASES = [
    ("a plus solutions",        "A Plus Solutions Ltd",                 "Recruitment/Staffing agency"),
    ("outreach recruitment",    "Outreach Recruitment Limited",         "Recruitment agency"),
    ("kathleen concio",         "Kathleen Concio",                      "Consultant (monthly retainer)"),
    ("ruksana shaikh",          "Ruksana Shaikh",                       "Accounting & Finance"),
    ("yofana virgianne",        "Yofana Virgianne",                     "Consultant (monthly)"),
    ("putri puspitha",          "Putri Puspitha Gusti Agung",           "Professional services"),
    ("mandar talele",           "Mandar Talele",                        "Web design / Creative direction"),
    ("melissa castellino",      "Melissa Castellino",                   "HR Consultant"),
    ("donna whisken",           "Donna Whisken",                        "Operations/Training consultant"),
    ("yaren gokerkan",          "Yaren Gokerkan",                       "HR / Recruitment consultant"),
    ("reloka",                  "Reloka Ltd",                           "Consultancy (K Cassar)"),
    ("olbia architecture",      "Olbia Architecture",                   "Architecture consulting"),
    ("dean meli",               "Dean Meli",                            "Grant/Funding consultant"),
    ("ceren barut",             "Ceren Barut",                          "Corporate consultancy (TR)"),
    ("authority hook",          "Authority Hook",                       "SEO consultancy"),
    ("stephanie fiteni",        "Stephanie Fiteni Coaching & Consulting","SEO/Marketing consultancy"),
    ("margarette cristel millo","Margarette Cristel Millo Frogoso",     "CRM Support Representative"),
    ("madhav chawla",           "Madhav Chawla",                        "Marketing/Web consultant"),
    ("muhammad ammar",          "Muhammad Ammar",                       "Zoho/IT support"),
    ("melih murat",             "Melih Murat Kizilcelik",               "Survey works (Novotel)"),
    ("vrushali",                "Vrushali Vilas Chavan",                "CRM Consultant"),
    ("parth goghari",           "Parth Goghari",                        "Consultant/Developer"),
    ("johann mifsud",           "Johann Mifsud",                        "Professional services"),
    ("sustain ventures",        "Sustain Ventures",                     "Consultancy"),
    ("alexia cassar",           "Alexia Cassar",                        "Consultant"),
    ("morissa andres",          "Morissa Andres Fargose",               "Consultancy"),
    ("keith fenech",            "Keith Fenech Melillo",                 "Consultant (agreement)"),
    ("raj kumar",               "Raj Kumar",                            "Growth Manager"),
    ("dhanarajan",              "Dhanarajan Tamilmaran",                "Zoho implementation (freelance)"),
    ("ena chawla",              "Ena Chawla",                           "Consultant"),
    ("ralph aguila",            "Ralph Aguila",                         "Consultant"),
    ("sheldon",                 "Sheldon Michael",                      "Consultant (via Ruksana)"),
    ("upwork",                  "Upwork (freelance platform)",          "Freelancers via Upwork"),
    ("payoneer",                "Payoneer.com",                         "Freelance payment platform"),
    ("josephine saliba",        "Donna Whisken",                        "Operations/Training consultant"),
    ("j. saliba",               "Donna Whisken",                        "Operations/Training consultant"),
]

# Generic note words that are NOT names — used to decide if notes contain a real name.
_GENERIC = re.compile(
    r"(consultation|consultancy|concultancy|condultancy|professional|service|fee|bonus|"
    r"balance|pay|payment|quarterly|crm consultant|growth manager|jan|feb|mar|apr|may|jun|"
    r"jul|aug|sep|oct|nov|dec|january|february|march|april|june|july|august|september|"
    r"october|november|december|\d|inv|ref|total|hours|per hour|usd)", re.I)

def match_alias(text):
    t = (text or "").lower()
    for pat, canon, cat in ALIASES:
        if pat in t:
            return canon, cat
    return None

def strip_to(s):
    s = (s or "").strip()
    return re.sub(r"^(to\s+|\d+-\s*|\d+\s+)", "", s, flags=re.I).strip()

def resolve(t):
    """Return (canonical_payee, category_tag, alloc_source)."""
    det = cache.get(f"{t['transaction_type']}:{t['transaction_id']}", {})
    vendor = (det.get("vendor") or "").strip()
    notes  = (det.get("notes")  or "").strip()
    bank   = (det.get("bank")   or "").strip()
    gl_payee = (t.get("payee") or "").strip()      # populated for bills

    # refunds (detail 404) -> use GL-line reference, mark as refund
    if t["transaction_type"] == "expense_refund" or notes.startswith("[detail fetch error"):
        return "Expense refund (Revolut/card)", "Refund", "refund"

    # 1) vendor / contact
    for v in (vendor, gl_payee):
        if v:
            a = match_alias(v)
            return (a[0], a[1], "vendor/contact") if a else (v.title(), classify(v+" "+notes), "vendor/contact")
    # 2) name in notes (only if it actually contains a name, i.e. an alias hit OR non-generic words)
    a = match_alias(notes)
    if a:
        return a[0], a[1], "notes"
    # 3) bank-feed payee
    a = match_alias(bank)
    if a:
        return a[0], a[1], "bank description"
    # fall back: cleaned bank "To X", else cleaned notes
    nm = strip_to(bank) or strip_to(notes)
    if nm and not _GENERIC.sub("", nm).strip() == "":
        return nm.title(), classify(nm+" "+notes), ("bank description" if bank else "notes")
    return "(unidentified)", "Unclassified", "none"

def classify(text):
    t = text.lower()
    if any(k in t for k in ["hr ", "hr consult", "recruit", "candidate", "interview"]): return "HR / Recruitment"
    if "seo" in t: return "SEO consultancy"
    if "crm" in t: return "CRM"
    if any(k in t for k in ["website","web ","design","branding","creative","marketing"]): return "Marketing/Web"
    if any(k in t for k in ["architect","survey"]): return "Architecture/Survey"
    if any(k in t for k in ["account","finance"]): return "Accounting & Finance"
    if any(k in t for k in ["zoho","implementation"]): return "Zoho/IT"
    if any(k in t for k in ["grant","funding"]): return "Grant/Funding"
    return "General consultancy"

# ── Aggregate ───────────────────────────────────────────────────────────────
G = defaultdict(lambda: {"net":0.0,"n":0,"cat":set(),"cc":set(),"src":set(),"dates":[],"ex":set()})
for t in lines:
    payee, cat, src = resolve(t)
    det = cache.get(f"{t['transaction_type']}:{t['transaction_id']}", {})
    cc = (det.get("cost_centre") or "").strip() or "—"
    deb = float(t.get("debit_amount") or 0); cre = float(t.get("credit_amount") or 0)
    g = G[payee]
    g["net"] += deb - cre; g["n"] += 1
    g["cat"].add(cat); g["cc"].add(cc); g["src"].add(src)
    g["dates"].append(t["transaction_date"])
    t["_payee"], t["_cat"], t["_src"], t["_cc"] = payee, cat, src, cc

total = sum(g["net"] for g in G.values())
ordered = sorted(G.items(), key=lambda kv: -kv[1]["net"])

# ── CSV per-line ──────────────────────────────────────────────────────────────
with OUT_CSV.open("w", newline="", encoding="utf-8-sig") as f:
    w = csv.writer(f)
    w.writerow(["date","type","entry/ref","payee","category_tag","cost_centre_tag",
                "alloc_source","net_eur","vendor","notes","bank_feed_payee","txn_id"])
    for t in sorted(lines, key=lambda x:x["transaction_date"]):
        det = cache.get(f"{t['transaction_type']}:{t['transaction_id']}", {})
        deb=float(t.get("debit_amount") or 0); cre=float(t.get("credit_amount") or 0)
        w.writerow([t["transaction_date"],t["transaction_type"],
                    t.get("entry_number") or t.get("reference_number") or "",
                    t["_payee"],t["_cat"],t["_cc"],t["_src"],round(deb-cre,2),
                    det.get("vendor",""),det.get("notes","").replace("\n"," "),det.get("bank",""),t["transaction_id"]])

# ── Markdown ─────────────────────────────────────────────────────────────────
md=[f"# COA 611193 — Consulting / Professional Services (SPA Zoho Books)",
    f"\n**Period:** {DATE_FROM} → {DATE_TO}  |  **GL lines:** {len(lines)}  |  **Net total:** €{total:,.2f}\n",
    "## Who is posted in this account\n",
    "| # | Payee / Vendor | Category tag | Cost-Centre tag | Net € | Txns | Allocation basis |",
    "|---|---|---|---|--:|--:|---|"]
for i,(p,g) in enumerate(ordered,1):
    md.append(f"| {i} | {p} | {' / '.join(sorted(g['cat']))} | {' / '.join(sorted(g['cc']))} "
              f"| {g['net']:,.2f} | {g['n']} | {', '.join(sorted(g['src']))} |")
OUT_MD.write_text("\n".join(md), encoding="utf-8")

# ── Console ──────────────────────────────────────────────────────────────────
print("="*100)
print(f"  COA 611193  {DATE_FROM} -> {DATE_TO}   NET TOTAL €{total:,.2f}   ({len(lines)} lines, {len(G)} payees)")
print("="*100)
print(f"  {'#':>2} {'Net €':>11} {'Tx':>3}  {'Cost Centre':<10} {'Category':<30} Payee")
print("  "+"-"*96)
for i,(p,g) in enumerate(ordered,1):
    print(f"  {i:>2} {g['net']:>11,.2f} {g['n']:>3}  {'/'.join(sorted(g['cc'])):<10} "
          f"{(' / '.join(sorted(g['cat'])))[:30]:<30} {p}")
print("="*100)
print(f"CSV: {OUT_CSV}\nMD : {OUT_MD}")
