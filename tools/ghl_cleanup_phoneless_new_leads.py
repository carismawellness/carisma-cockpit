"""
GHL cleanup — mark phone-less opportunities in the "🌱 New Leads" stage as Closed Lost.

Targets the Aesthetics and Slimming sub-accounts (Call Pipeline only).
Dry-run by default. Pass --execute to write changes.

Reads PIT tokens from .env: GHL_API_KEY_AESTHETICS, GHL_API_KEY_SLIMMING.
Writes a JSON manifest of candidate opp IDs to .tmp/ghl_phoneless_<brand>.json
so the execute step can use the exact same list the dry-run inspected.
"""

import argparse
import json
import os
import sys
import time
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


def headers(token: str) -> dict:
    return {
        "Authorization": f"Bearer {token}",
        "Version": "2021-07-28",
        "Accept": "application/json",
        "Content-Type": "application/json",
    }


def has_phone(opp: dict) -> bool:
    """An opp is considered to have a phone if either the embedded contact.phone
    or the opp-level phone field is non-empty after stripping whitespace."""
    contact_phone = ((opp.get("contact") or {}).get("phone") or "").strip()
    opp_phone = (opp.get("phone") or "").strip()
    return bool(contact_phone or opp_phone)


def fetch_all_opps(brand: str, cfg: dict) -> list[dict]:
    token = os.environ[cfg["env_key"]]
    client = httpx.Client(timeout=60, headers=headers(token))
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
                wait = 2 ** attempt
                print(f"  [{brand}] rate-limited, sleeping {wait}s", file=sys.stderr)
                time.sleep(wait); continue
            r.raise_for_status()
            break
        else:
            raise RuntimeError(f"{brand}: search failed after retries")
        data = r.json()
        batch = data.get("opportunities", [])
        out.extend(batch)
        meta = data.get("meta", {})
        total = meta.get("total")
        print(f"  [{brand}] page {page}: +{len(batch)} (running total {len(out)}/{total})")
        next_after = meta.get("startAfter")
        next_id = meta.get("startAfterId")
        if not next_after or not next_id or not batch:
            break
        params["startAfter"] = next_after
        params["startAfterId"] = next_id
        page += 1
    return out


def mark_lost(brand: str, cfg: dict, opp_id: str) -> tuple[int, str]:
    token = os.environ[cfg["env_key"]]
    for attempt in range(5):
        r = httpx.put(
            f"{BASE}/opportunities/{opp_id}/status",
            headers=headers(token),
            json={"status": "lost"},
            timeout=30,
        )
        if r.status_code == 429:
            time.sleep(2 ** attempt); continue
        return r.status_code, r.text[:200]
    return 599, "max retries"


def run_scan() -> dict:
    summary = {}
    for brand, cfg in BRANDS.items():
        print(f"\n=== Scanning {brand} New Leads ===")
        opps = fetch_all_opps(brand, cfg)
        phoneless = [o for o in opps if not has_phone(o)]
        manifest_path = TMP / f"ghl_phoneless_{brand.lower()}.json"
        manifest_path.write_text(json.dumps([
            {
                "opportunity_id": o["id"],
                "name": o.get("name"),
                "contact_id": o.get("contactId"),
                "contact_email": (o.get("contact") or {}).get("email"),
                "created_at": o.get("createdAt"),
            } for o in phoneless
        ], indent=2))
        summary[brand] = {
            "total_open_in_new_leads": len(opps),
            "phoneless_count": len(phoneless),
            "manifest": str(manifest_path),
        }
        print(f"  → {brand}: total={len(opps)}  phoneless={len(phoneless)}")
        if phoneless:
            print("  Sample (first 5):")
            for o in phoneless[:5]:
                c = o.get("contact") or {}
                print(f"    {o['id']}  name={o.get('name')!r:30s}  email={c.get('email')!r}")
    return summary


def run_execute() -> None:
    print("\n=== EXECUTING — marking phone-less opps as Closed Lost ===")
    for brand, cfg in BRANDS.items():
        path = TMP / f"ghl_phoneless_{brand.lower()}.json"
        if not path.exists():
            print(f"  [{brand}] no manifest at {path}; run scan first.")
            continue
        manifest = json.loads(path.read_text())
        print(f"\n  [{brand}] updating {len(manifest)} opportunities...")
        ok = fail = 0
        for i, entry in enumerate(manifest, 1):
            status, body = mark_lost(brand, cfg, entry["opportunity_id"])
            if 200 <= status < 300:
                ok += 1
            else:
                fail += 1
                print(f"    FAIL {entry['opportunity_id']} → HTTP {status} {body}")
            if i % 50 == 0:
                print(f"    [{brand}] progress {i}/{len(manifest)}  ok={ok} fail={fail}")
        print(f"  [{brand}] DONE: ok={ok} fail={fail}")


def run_verify() -> None:
    print("\n=== Verifying post-update state ===")
    for brand, cfg in BRANDS.items():
        token = os.environ[cfg["env_key"]]
        r = httpx.get(
            f"{BASE}/opportunities/search",
            params={
                "location_id": cfg["location_id"],
                "pipeline_id": cfg["pipeline_id"],
                "pipeline_stage_id": cfg["stage_id"],
                "status": "open",
                "limit": 100,
            },
            headers=headers(token),
            timeout=30,
        )
        data = r.json()
        opps_page = data.get("opportunities", [])
        phoneless_on_page = sum(1 for o in opps_page if not has_phone(o))
        print(f"  [{brand}] open in New Leads total={data.get('meta',{}).get('total')}  "
              f"phoneless on first 100={phoneless_on_page}")


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--execute", action="store_true",
                        help="Actually update opportunity status to 'lost'. Default is dry-run.")
    parser.add_argument("--verify", action="store_true",
                        help="Re-query New Leads after execute to confirm cleanup.")
    args = parser.parse_args()
    load_env()
    if args.verify:
        run_verify(); return
    summary = run_scan()
    print("\n--- SUMMARY ---")
    print(json.dumps(summary, indent=2))
    if args.execute:
        run_execute()
        run_verify()
    else:
        print("\nDRY RUN ONLY. Re-run with --execute to apply.")


if __name__ == "__main__":
    main()
