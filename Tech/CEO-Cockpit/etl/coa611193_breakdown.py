import sys
sys.stdout.reconfigure(encoding="utf-8", errors="replace")
sys.stderr.reconfigure(encoding="utf-8", errors="replace")
"""
Transaction-level breakdown of SPA Zoho Books COA 611193
(Consulting - Professional Services), Jan 2025 -> Apr 2026.

Pulls every GL line posted to the account, enriches each with its underlying
detail record (expense / bill / journal), then attributes each line to a payee
using a fuzzy-logic waterfall:

    1. Vendor / contact name        (bills, expenses with a contact set)
    2. Name mentioned in notes      (line-item description / expense description)
    3. Bank-feed description         (imported_transactions payee / paid-through)

Outputs:
    c:/tmp/coa611193_transactions.csv   - one row per GL line (auditable)
    c:/tmp/coa611193_breakdown.md       - grouped "who is in this account" report
"""
import json
import re
import time
import csv
from collections import defaultdict
from difflib import SequenceMatcher
from datetime import date
from pathlib import Path
from dotenv import load_dotenv

load_dotenv(r"c:\Users\Deepa Patel\OneDrive - Project Payables ltd\Desktop\Cockpit\carisma-support\.env")
from zoho_books_client import ZohoBooksClient

ACCT       = "128265000000446177"
DATE_FROM  = date(2025, 1, 1)
DATE_TO    = date(2026, 4, 30)
CACHE      = Path(r"c:/tmp/coa611193_detail_cache.json")
OUT_CSV    = Path(r"c:/tmp/coa611193_transactions.csv")
OUT_MD     = Path(r"c:/tmp/coa611193_breakdown.md")

client = ZohoBooksClient(org="spa")

# ---------------------------------------------------------------------------
# 1. Pull all GL lines, clamp to the requested window by transaction_date
# ---------------------------------------------------------------------------
print("Fetching GL lines for 611193 ...", flush=True)
raw = client.get_all_pages(
    "chartofaccounts/transactions", "transactions",
    {"account_id": ACCT, "from_date": DATE_FROM.isoformat(), "to_date": DATE_TO.isoformat()},
)

def in_window(d: str) -> bool:
    try:
        dd = date.fromisoformat(d)
    except Exception:
        return False
    return DATE_FROM <= dd <= DATE_TO

lines = [t for t in raw if in_window(t.get("transaction_date", ""))]
print(f"  {len(raw)} returned, {len(lines)} within {DATE_FROM}..{DATE_TO}", flush=True)

# ---------------------------------------------------------------------------
# 2. Enrich each line with its detail record (cached on disk)
# ---------------------------------------------------------------------------
cache: dict = json.loads(CACHE.read_text(encoding="utf-8")) if CACHE.exists() else {}

def fetch_detail(ttype: str, tid: str) -> dict:
    key = f"{ttype}:{tid}"
    if key in cache:
        return cache[key]
    out = {}
    try:
        if ttype in ("expense", "expense_refund"):
            d = client.get(f"expenses/{tid}").get("expense", {})
            imported = d.get("imported_transactions") or []
            bank_payee = (imported[0].get("payee") if imported else "") or ""
            bank_desc  = (imported[0].get("description") if imported else "") or ""
            out = {
                "vendor":   d.get("vendor_name") or d.get("merchant_name") or "",
                "notes":    d.get("description") or "",
                "ref":      d.get("reference_number") or "",
                "bank":     bank_payee or bank_desc,
                "paid_through": d.get("paid_through_account_name") or "",
                "cost_centre": _tag(d.get("tags")),
            }
        elif ttype == "bill":
            d = client.get(f"bills/{tid}").get("bill", {})
            li = d.get("line_items") or []
            descs = " | ".join(x.get("description","").strip() for x in li
                                if str(x.get("account_code","")) == "611193" and x.get("description","").strip())
            out = {
                "vendor": d.get("vendor_name") or "",
                "notes":  descs or d.get("notes") or "",
                "ref":    d.get("reference_number") or d.get("bill_number") or "",
                "bank":   "",
                "paid_through": "",
                "cost_centre": _tag((li[0].get("tags") if li else None)),
            }
        elif ttype == "journal":
            d = client.get(f"journals/{tid}").get("journal", {})
            out = {"vendor": "", "notes": d.get("notes") or d.get("reference_number") or "",
                   "ref": d.get("journal_number") or "", "bank": "", "paid_through": "", "cost_centre": ""}
        else:  # opening_balance and anything else
            out = {"vendor": "", "notes": "", "ref": "", "bank": "", "paid_through": "", "cost_centre": ""}
    except Exception as e:
        out = {"vendor": "", "notes": f"[detail fetch error: {e}]", "ref": "", "bank": "", "paid_through": "", "cost_centre": ""}
    cache[key] = out
    return out

def _tag(tags):
    if not tags:
        return ""
    try:
        return tags[0].get("tag_option_name", "") or ""
    except Exception:
        return ""

for i, t in enumerate(lines, 1):
    t["_detail"] = fetch_detail(t["transaction_type"], t["transaction_id"])
    if i % 25 == 0:
        print(f"  enriched {i}/{len(lines)}", flush=True)
        CACHE.write_text(json.dumps(cache, ensure_ascii=False), encoding="utf-8")
        time.sleep(0.3)
CACHE.write_text(json.dumps(cache, ensure_ascii=False), encoding="utf-8")
print("  enrichment complete", flush=True)

# ---------------------------------------------------------------------------
# 3. Fuzzy-logic attribution
# ---------------------------------------------------------------------------
# Strip bank-feed noise so "Upwork -918388578ref" -> "upwork"
_NOISE = re.compile(
    r"\b(ref|reference|payment|pmt|pos|card|sepa|sct|trf|transfer|invoice|inv|"
    r"eur|gbp|usd|ltd|limited|paypal|revolut|bank|tfr|dd|so|fpi|fps|chq|cheque)\b",
    re.I,
)
def normalize(s: str) -> str:
    s = (s or "").lower()
    s = re.sub(r"https?://\S+", " ", s)
    s = re.sub(r"[^a-z\s]", " ", s)          # drop digits & punctuation
    s = _NOISE.sub(" ", s)
    s = re.sub(r"\s+", " ", s).strip()
    # keep up to first 3 meaningful words (vendor names are short)
    return " ".join(s.split()[:3])

def attribute(t: dict):
    """Return (payee_display, source) using the 3-tier waterfall."""
    det = t["_detail"]
    vendor = (det.get("vendor") or "").strip()
    notes  = (det.get("notes")  or "").strip()
    bank   = (det.get("bank")   or "").strip()
    gl_payee = (t.get("payee") or "").strip()   # GL-line payee (populated for bills)

    if vendor:
        return vendor, "vendor/contact"
    if gl_payee:
        return gl_payee, "vendor/contact"
    if notes:
        return notes, "notes"
    if bank:
        return bank, "bank description"
    pt = (det.get("paid_through") or "").strip()
    if pt:
        return pt, "paid-through (bank)"
    return "(unidentified)", "none"

for t in lines:
    payee, source = attribute(t)
    t["_payee"]  = payee
    t["_source"] = source
    t["_norm"]   = normalize(payee) or payee.lower().strip()
    deb = float(t.get("debit_amount")  or 0)
    cre = float(t.get("credit_amount") or 0)
    t["_net"] = deb - cre   # refunds/credits reduce the spend

# Cluster normalized keys with fuzzy merge (>=0.86 similarity)
clusters: dict[str, str] = {}   # norm_key -> canonical norm_key
canon_label: dict[str, str] = {}
def canon_for(norm: str, display: str) -> str:
    for c in clusters.values():
        if c == norm or SequenceMatcher(None, c, norm).ratio() >= 0.86:
            clusters[norm] = c
            return c
    clusters[norm] = norm
    canon_label[norm] = display
    return norm

groups: dict[str, dict] = defaultdict(lambda: {"net": 0.0, "n": 0, "sources": set(),
                                               "examples": set(), "dates": [], "display": ""})
for t in lines:
    c = canon_for(t["_norm"], t["_payee"])
    g = groups[c]
    g["net"] += t["_net"]
    g["n"]   += 1
    g["sources"].add(t["_source"])
    if t["_payee"] != "(unidentified)":
        g["examples"].add(t["_payee"][:60])
    g["dates"].append(t["transaction_date"])
    if not g["display"]:
        g["display"] = canon_label.get(c, t["_payee"])

# ---------------------------------------------------------------------------
# 4. Write CSV (per-line audit trail)
# ---------------------------------------------------------------------------
OUT_CSV.parent.mkdir(parents=True, exist_ok=True)
with OUT_CSV.open("w", newline="", encoding="utf-8-sig") as f:
    w = csv.writer(f)
    w.writerow(["date","type","entry/ref","attributed_payee","alloc_source",
                "net_eur","vendor_name","notes_description","bank_feed_payee",
                "paid_through","cost_centre","transaction_id"])
    for t in sorted(lines, key=lambda x: x["transaction_date"]):
        d = t["_detail"]
        w.writerow([
            t["transaction_date"], t["transaction_type"],
            t.get("entry_number") or t.get("reference_number") or "",
            t["_payee"], t["_source"], round(t["_net"], 2),
            d.get("vendor",""), d.get("notes",""), d.get("bank",""),
            d.get("paid_through",""), d.get("cost_centre",""), t["transaction_id"],
        ])

# ---------------------------------------------------------------------------
# 5. Write Markdown breakdown
# ---------------------------------------------------------------------------
total_net = sum(t["_net"] for t in lines)
ordered = sorted(groups.values(), key=lambda g: -g["net"])

src_tot = defaultdict(float)
src_cnt = defaultdict(int)
for t in lines:
    src_tot[t["_source"]] += t["_net"]
    src_cnt[t["_source"]] += 1

lines_md = []
lines_md.append(f"# COA 611193 — Consulting / Professional Services (SPA Zoho)")
lines_md.append(f"\n**Period:** {DATE_FROM} → {DATE_TO}  ")
lines_md.append(f"**GL lines:** {len(lines)}  |  **Net total:** €{total_net:,.2f}\n")
lines_md.append("## Who is posted here (grouped, fuzzy-matched)\n")
lines_md.append("| # | Payee / Vendor | Net €| Txns | Allocation basis | Variants seen |")
lines_md.append("|---|---|--:|--:|---|---|")
for i, g in enumerate(ordered, 1):
    ex = "; ".join(sorted(g["examples"]))[:90]
    src = ", ".join(sorted(g["sources"]))
    lines_md.append(f"| {i} | {g['display']} | {g['net']:,.2f} | {g['n']} | {src} | {ex} |")

lines_md.append("\n## Allocation-source confidence\n")
lines_md.append("| Source (priority) | Txns | Net € |")
lines_md.append("|---|--:|--:|")
for s in ["vendor/contact","notes","bank description","paid-through (bank)","none"]:
    if src_cnt.get(s):
        lines_md.append(f"| {s} | {src_cnt[s]} | {src_tot[s]:,.2f} |")

OUT_MD.write_text("\n".join(lines_md), encoding="utf-8")

# ---------------------------------------------------------------------------
# Console summary
# ---------------------------------------------------------------------------
print("\n" + "="*78)
print(f"  COA 611193  {DATE_FROM} -> {DATE_TO}   net total €{total_net:,.2f}  ({len(lines)} lines)")
print("="*78)
print(f"  {'#':>2}  {'Net €':>12}  {'Txns':>4}  {'Basis':<18}  Payee")
for i, g in enumerate(ordered, 1):
    src = sorted(g["sources"])[0]
    print(f"  {i:>2}  {g['net']:>12,.2f}  {g['n']:>4}  {src:<18}  {g['display'][:45]}")
print("="*78)
print("Source mix:")
for s in ["vendor/contact","notes","bank description","paid-through (bank)","none"]:
    if src_cnt.get(s):
        print(f"  {s:<22} {src_cnt[s]:>4} txns  €{src_tot[s]:>12,.2f}")
print(f"\nCSV : {OUT_CSV}")
print(f"MD  : {OUT_MD}")
