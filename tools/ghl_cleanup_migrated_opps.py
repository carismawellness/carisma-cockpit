"""
Mark every open opportunity in 🌱 New Leads (Aesthetics + Slimming) whose
contact carries the `zoho_migrated_2026_05` tag as Closed Lost.

These are the "artificially created" leads from the Zoho → GHL migration that
are polluting the New Leads stage.

Dry-run by default; pass --execute to apply. Writes manifests to .tmp/.
"""

from __future__ import annotations

import argparse
import json
import os
import time
from pathlib import Path

import httpx

BASE = "https://services.leadconnectorhq.com"
ROOT = Path(__file__).resolve().parent.parent
TMP = ROOT / ".tmp"
TMP.mkdir(exist_ok=True)

MIGRATION_TAG = "zoho_migrated_2026_05"

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


def load_env() -> None:
    for line in (ROOT / ".env").read_text().splitlines():
        if "=" in line and not line.strip().startswith("#"):
            k, _, v = line.partition("=")
            os.environ.setdefault(k.strip(), v.strip())


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


def mark_lost(token: str, opp_id: str) -> tuple[int, str]:
    for attempt in range(5):
        r = httpx.put(
            f"{BASE}/opportunities/{opp_id}/status",
            headers=hdr(token),
            json={"status": "lost"},
            timeout=30,
        )
        if r.status_code == 429:
            time.sleep(2 ** attempt); continue
        return r.status_code, r.text[:200]
    return 599, "max retries"


def has_migration_tag(opp: dict) -> bool:
    tags = ((opp.get("contact") or {}).get("tags") or [])
    return MIGRATION_TAG in tags


def run_scan() -> dict:
    summary = {}
    for brand, cfg in BRANDS.items():
        print(f"\n=== Scanning {brand} New Leads ===")
        opps = fetch_all_opps(brand, cfg)
        targets = [o for o in opps if has_migration_tag(o)]
        keep = [o for o in opps if not has_migration_tag(o)]
        manifest = [{
            "opportunity_id": o["id"],
            "contact_id": o.get("contactId"),
            "name": o.get("name"),
            "email": (o.get("contact") or {}).get("email"),
            "createdAt": o.get("createdAt"),
            "lastStageChangeAt": o.get("lastStageChangeAt"),
        } for o in targets]
        path = TMP / f"ghl_migration_targets_{brand.lower()}.json"
        path.write_text(json.dumps(manifest, indent=2))
        summary[brand] = {
            "total_open_in_new_leads": len(opps),
            "migration_tagged": len(targets),
            "non_migration": len(keep),
            "manifest": str(path),
        }
        print(f"  total open:        {len(opps)}")
        print(f"  migration-tagged:  {len(targets)}  (will be marked Closed Lost)")
        print(f"  non-migration:     {len(keep)}  (will be kept)")
        if keep:
            print(f"  sample of opps that will be KEPT (first 10):")
            for o in keep[:10]:
                c = o.get("contact") or {}
                print(f"    {o['id']}  name={o.get('name')!r:25s} email={c.get('email')!r}  src={c.get('source')!r}")
    return summary


def run_execute() -> None:
    print("\n=== EXECUTING — marking migration-tagged opps as Closed Lost ===")
    for brand, cfg in BRANDS.items():
        path = TMP / f"ghl_migration_targets_{brand.lower()}.json"
        if not path.exists():
            print(f"  [{brand}] no manifest; run scan first."); continue
        manifest = json.loads(path.read_text())
        token = os.environ[cfg["env_key"]]
        print(f"\n  [{brand}] updating {len(manifest)} opps...")
        ok = fail = 0
        for i, entry in enumerate(manifest, 1):
            status, body = mark_lost(token, entry["opportunity_id"])
            if 200 <= status < 300:
                ok += 1
            else:
                fail += 1
                if fail <= 5:
                    print(f"    FAIL {entry['opportunity_id']} → HTTP {status} {body}")
            if i % 100 == 0:
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
            headers=hdr(token),
            timeout=30,
        )
        data = r.json()
        total = data.get("meta", {}).get("total")
        page = data.get("opportunities", [])
        still_migrated = sum(1 for o in page if has_migration_tag(o))
        print(f"  [{brand}] open in New Leads total={total}  "
              f"migration-tagged on first page={still_migrated}")


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--execute", action="store_true")
    parser.add_argument("--verify", action="store_true")
    args = parser.parse_args()
    load_env()
    if args.verify:
        run_verify(); return
    run_scan()
    if args.execute:
        run_execute()
        run_verify()
    else:
        print("\nDRY RUN ONLY. Re-run with --execute to apply.")


if __name__ == "__main__":
    main()
