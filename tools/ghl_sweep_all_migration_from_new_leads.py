"""
Comprehensive sweep: find EVERY opportunity in 🌱 New Leads (Call Pipeline)
across all 3 brands (Spa, Aesthetics, Slimming) — regardless of status —
whose contact carries any Zoho migration tag (`zoho_migrated_2026_04` or
`zoho_migrated_2026_05`), and move them to ❌ Booking Lost with status=lost.

Catches everything the earlier scripts missed:
- migration opps whose status was already 'won' (left over from past activity)
- migration opps whose status was 'lost' but still physically in New Leads
- `_04` tagged opps that previous _05-only scripts skipped

Dry-run by default; --execute to apply. Idempotent.
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

MIGRATION_TAGS = {"zoho_migrated_2026_04", "zoho_migrated_2026_05"}

BRANDS = {
    "Spa": {
        "location_id":     "TrtSnBSSKBOkVVNxJ3AM",
        "pipeline_id":     "4vgVsqiN12VGdloyzyxD",
        "new_leads_id":    "188e01d4-99aa-43e2-8b9a-8997a2557568",
        "booking_lost_id": "5bb020b3-8f55-43d9-9778-4ba14d331fc1",
        "env_key":         "GHL_API_KEY",
    },
    "Aesthetics": {
        "location_id":     "Goi7kzVK7iwe2woxUHkT",
        "pipeline_id":     "PaSsbcOAeRURF2Hc2V3F",
        "new_leads_id":    "8a5da633-c150-43a6-8bad-c40934caafa8",
        "booking_lost_id": "afafed98-adff-4c3d-9d3d-50f72506fa00",
        "env_key":         "GHL_API_KEY_AESTHETICS",
    },
    "Slimming": {
        "location_id":     "imWIWDcnmOfijW0lltPq",
        "pipeline_id":     "N3usvWAkWpUppJj1ggtM",
        "new_leads_id":    "e2321215-3f53-47ee-b90c-444b632557a1",
        "booking_lost_id": "889cb211-7c69-466e-88e8-deda84b2f073",
        "env_key":         "GHL_API_KEY_SLIMMING",
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


def fetch_all_new_leads(brand: str, cfg: dict) -> list[dict]:
    """Pull every opp in 🌱 New Leads regardless of status."""
    token = os.environ[cfg["env_key"]]
    client = httpx.Client(timeout=60, headers=hdr(token))
    params = {
        "location_id": cfg["location_id"],
        "pipeline_id": cfg["pipeline_id"],
        "pipeline_stage_id": cfg["new_leads_id"],
        "status": "all",
        "limit": 100,
    }
    out: list[dict] = []
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
    return out


def is_migration(opp: dict) -> bool:
    tags = set(((opp.get("contact") or {}).get("tags") or []))
    return bool(tags & MIGRATION_TAGS)


def move_to_booking_lost(token: str, opp_id: str, pipeline_id: str, stage_id: str) -> tuple[int, str]:
    body = {"pipelineId": pipeline_id, "pipelineStageId": stage_id, "status": "lost"}
    for attempt in range(6):
        try:
            r = httpx.put(f"{BASE}/opportunities/{opp_id}", headers=hdr(token), json=body, timeout=30)
        except (httpx.ReadTimeout, httpx.ConnectTimeout, httpx.RemoteProtocolError) as e:
            time.sleep(2 ** attempt); continue
        if r.status_code == 429:
            time.sleep(2 ** attempt); continue
        return r.status_code, r.text[:200]
    return 599, "max retries"


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--execute", action="store_true")
    args = parser.parse_args()
    load_env()

    for brand, cfg in BRANDS.items():
        print(f"\n=== {brand} — scanning 🌱 New Leads ===")
        opps = fetch_all_new_leads(brand, cfg)
        targets = [o for o in opps if is_migration(o)]
        by_status = {}
        for o in targets:
            by_status[o.get("status")] = by_status.get(o.get("status"), 0) + 1
        manifest = [{
            "opportunity_id": o["id"],
            "name": o.get("name"),
            "contactId": o.get("contactId"),
            "status_before": o.get("status"),
            "tags": (o.get("contact") or {}).get("tags"),
        } for o in targets]
        path = TMP / f"ghl_new_leads_migration_sweep_{brand.lower()}.json"
        path.write_text(json.dumps(manifest, indent=2))
        print(f"  total in New Leads:   {len(opps)}")
        print(f"  migration-tagged:     {len(targets)}  by status: {by_status}")
        print(f"  manifest:             {path}")

        if not args.execute:
            continue
        token = os.environ[cfg["env_key"]]
        ok = fail = 0
        for i, entry in enumerate(manifest, 1):
            st, body = move_to_booking_lost(token, entry["opportunity_id"], cfg["pipeline_id"], cfg["booking_lost_id"])
            if 200 <= st < 300:
                ok += 1
            else:
                fail += 1
                if fail <= 5:
                    print(f"    FAIL {entry['opportunity_id']} → HTTP {st} {body}")
            if i % 100 == 0:
                print(f"    [{brand}] progress {i}/{len(manifest)}  ok={ok} fail={fail}")
        print(f"  [{brand}] DONE: ok={ok} fail={fail}")

    if args.execute:
        # Verify
        print("\n=== Verifying ===")
        for brand, cfg in BRANDS.items():
            token = os.environ[cfg["env_key"]]
            opps = fetch_all_new_leads(brand, cfg)
            remaining = [o for o in opps if is_migration(o)]
            print(f"  [{brand}] migration-tagged still in New Leads: {len(remaining)} (of {len(opps)} total in stage)")
    else:
        print("\nDRY RUN. Re-run with --execute.")


if __name__ == "__main__":
    main()
