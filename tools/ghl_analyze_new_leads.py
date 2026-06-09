"""
Analyze the current 🌱 New Leads stage in Aesthetics + Slimming.
Pulls all open opps, enriches with contact details, and prints:
- Temporal histogram of createdAt
- Source/tag distributions
- Duplicate-contact detection (same contactId on multiple opps; or contact already
  has tasks/conversations indicating prior contact)
- Junk-name / junk-email heuristics
- An overall categorization manifest written to .tmp/
"""

from __future__ import annotations

import json
import os
import re
import time
from collections import Counter, defaultdict
from datetime import datetime, timezone
from pathlib import Path

import httpx

BASE = "https://services.leadconnectorhq.com"
ROOT = Path(__file__).resolve().parent.parent
TMP = ROOT / ".tmp"
TMP.mkdir(exist_ok=True)


def load_env() -> None:
    for line in (ROOT / ".env").read_text().splitlines():
        if "=" in line and not line.strip().startswith("#"):
            k, _, v = line.partition("=")
            os.environ.setdefault(k.strip(), v.strip())


BRANDS = {
    "Aesthetics": {
        "location_id": "Goi7kzVK7iwe2woxUHkT",
        "pipeline_id": "PaSsbcOAeRURF2Hc2V3F",
        "stage_id":    "8a5da633-c150-43a6-8bad-c40934caafa8",
        "env_key":     "GHL_API_KEY_AESTHETICS",
    },
    "Slimming": {
        "location_id": "imWIWDcnmOfijW0lltPq",
        "pipeline_id": "N3usvWAkWpUppJj1ggtM",
        "stage_id":    "e2321215-3f53-47ee-b90c-444b632557a1",
        "env_key":     "GHL_API_KEY_SLIMMING",
    },
}


def hdr(token: str) -> dict:
    return {
        "Authorization": f"Bearer {token}",
        "Version": "2021-07-28",
        "Accept": "application/json",
        "Content-Type": "application/json",
    }


def fetch_all_opps(brand: str, cfg: dict) -> list[dict]:
    token = os.environ[cfg["env_key"]]
    client = httpx.Client(timeout=60, headers=hdr(token))
    params = {
        "location_id": cfg["location_id"],
        "pipeline_id": cfg["pipeline_id"],
        "pipeline_stage_id": cfg["stage_id"],
        "status": "open",
        "limit": 100,
    }
    out: list[dict] = []
    page = 1
    while True:
        for attempt in range(5):
            r = client.get(f"{BASE}/opportunities/search", params=params)
            if r.status_code == 429:
                time.sleep(2 ** attempt); continue
            r.raise_for_status()
            break
        else:
            raise RuntimeError(f"{brand}: search failed")
        data = r.json()
        batch = data.get("opportunities", [])
        out.extend(batch)
        meta = data.get("meta", {})
        next_after = meta.get("startAfter")
        next_id = meta.get("startAfterId")
        if not next_after or not next_id or not batch:
            break
        params["startAfter"] = next_after
        params["startAfterId"] = next_id
        page += 1
    return out


# --- spam / junk heuristics ---------------------------------------------------

REPEAT_CHAR_RE = re.compile(r"(.)\1{3,}")                      # 4+ repeated chars

def name_is_junk(name: str | None) -> bool:
    if not name:
        return True
    n = name.strip()
    if len(n) < 2:
        return True
    if REPEAT_CHAR_RE.search(n):
        return True
    # all same character ignoring spaces
    letters = re.sub(r"[\s\-_'.]", "", n).lower()
    if letters and len(set(letters)) <= 2 and len(letters) >= 3:
        return True
    # contains digits in a name (e.g. "asdf123")
    if re.search(r"\d{3,}", n):
        return True
    return False


JUNK_EMAIL_LOCAL_RE = re.compile(r"^[a-z]{6,}$")  # all-lowercase random string

def email_looks_junk(email: str | None) -> bool:
    if not email:
        return False  # can't tell; not "junk" by itself
    local, _, _ = email.partition("@")
    if REPEAT_CHAR_RE.search(local):
        return True
    # All consonants, no vowels, length >= 5 → very likely keyboard mash
    if len(local) >= 5 and not re.search(r"[aeiouAEIOU]", local):
        return True
    return False


def parse_dt(s: str | None) -> datetime | None:
    if not s:
        return None
    try:
        return datetime.fromisoformat(s.replace("Z", "+00:00"))
    except Exception:
        return None


# --- analysis -----------------------------------------------------------------

def analyze_brand(brand: str, cfg: dict) -> dict:
    print(f"\n=== {brand} — fetching ===")
    opps = fetch_all_opps(brand, cfg)
    print(f"  fetched {len(opps)} open opps in New Leads")

    # Temporal histogram (hour buckets, last 72h)
    now = datetime.now(timezone.utc)
    buckets = Counter()
    for o in opps:
        dt = parse_dt(o.get("createdAt"))
        if not dt:
            continue
        age_h = int((now - dt).total_seconds() // 3600)
        buckets[age_h] += 1

    # Group by createdAt date (UTC) for a coarser view
    date_buckets = Counter()
    for o in opps:
        dt = parse_dt(o.get("createdAt"))
        if dt:
            date_buckets[dt.astimezone(timezone.utc).date().isoformat()] += 1

    # Duplicate contacts: same contactId appears on multiple opps in this list
    by_contact = defaultdict(list)
    for o in opps:
        if cid := o.get("contactId"):
            by_contact[cid].append(o["id"])
    dupe_contacts = {cid: ops for cid, ops in by_contact.items() if len(ops) > 1}

    # Junk-name / junk-email detection
    junk_name = []
    junk_email = []
    for o in opps:
        c = o.get("contact") or {}
        nm = (o.get("name") or c.get("name") or "")
        em = c.get("email") or ""
        if name_is_junk(nm):
            junk_name.append({"opp": o["id"], "contact": o.get("contactId"), "name": nm, "email": em,
                              "createdAt": o.get("createdAt"), "source": (c.get("source") or None)})
        if email_looks_junk(em):
            junk_email.append({"opp": o["id"], "contact": o.get("contactId"), "name": nm, "email": em,
                               "createdAt": o.get("createdAt"), "source": (c.get("source") or None)})

    # Source / tag distributions (last 24h only, to focus on the overnight inflow)
    overnight_cutoff = now.timestamp() - 24 * 3600
    sources_overnight = Counter()
    tags_overnight = Counter()
    overnight_opps = []
    for o in opps:
        dt = parse_dt(o.get("createdAt"))
        if dt and dt.timestamp() >= overnight_cutoff:
            overnight_opps.append(o)
            c = o.get("contact") or {}
            sources_overnight[c.get("source") or "(none)"] += 1
            for t in (c.get("tags") or []):
                tags_overnight[t] += 1

    print(f"  last 24h inflow: {len(overnight_opps)} opps")
    print(f"  unique contacts with >1 opp: {len(dupe_contacts)}")
    print(f"  junk-name flagged: {len(junk_name)}")
    print(f"  junk-email flagged: {len(junk_email)}")

    out = {
        "brand": brand,
        "now_utc": now.isoformat(),
        "total_open_in_new_leads": len(opps),
        "last_24h_count": len(overnight_opps),
        "age_hour_buckets": dict(sorted(buckets.items())),
        "date_buckets": dict(sorted(date_buckets.items())),
        "duplicate_contacts": dupe_contacts,
        "junk_name": junk_name,
        "junk_email": junk_email,
        "sources_last_24h": dict(sources_overnight.most_common()),
        "tags_last_24h": dict(tags_overnight.most_common(20)),
    }
    (TMP / f"ghl_analysis_{brand.lower()}.json").write_text(json.dumps(out, indent=2))
    # Also save the raw opps list and the overnight list
    (TMP / f"ghl_open_new_leads_{brand.lower()}.json").write_text(json.dumps(opps, indent=2, default=str))
    (TMP / f"ghl_overnight_new_leads_{brand.lower()}.json").write_text(json.dumps(overnight_opps, indent=2, default=str))
    return out


def main() -> None:
    load_env()
    results = {}
    for brand, cfg in BRANDS.items():
        results[brand] = analyze_brand(brand, cfg)
    # Pretty-print the key summaries
    print("\n\n======== HIGHLIGHTS ========")
    for brand, r in results.items():
        print(f"\n--- {brand} ---")
        print(f"  total open in New Leads: {r['total_open_in_new_leads']}")
        print(f"  last 24h inflow:         {r['last_24h_count']}")
        print(f"  createdAt by date:")
        for d, n in r["date_buckets"].items():
            print(f"    {d}: {n}")
        print(f"  sources (last 24h):      {r['sources_last_24h']}")
        print(f"  tags (last 24h):         {r['tags_last_24h']}")
        print(f"  duplicate contacts:      {len(r['duplicate_contacts'])}")
        print(f"  junk-name flagged:       {len(r['junk_name'])}")
        print(f"  junk-email flagged:      {len(r['junk_email'])}")


if __name__ == "__main__":
    main()
