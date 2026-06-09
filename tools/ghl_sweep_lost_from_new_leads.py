"""
Sweep EVERY opportunity with status=lost currently sitting in the
🌱 New Leads stage of the Call Pipeline (Aesthetics + Slimming) into the
❌ Booking Lost stage.

Catches both:
  - Opps we marked status=lost in earlier passes but didn't stage-move
  - Pre-existing status=lost opps that were always in New Leads

Dry-run by default; --execute to apply.
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

BRANDS = {
    "Aesthetics": {
        "location_id":      "Goi7kzVK7iwe2woxUHkT",
        "pipeline_id":      "PaSsbcOAeRURF2Hc2V3F",
        "new_leads_id":     "8a5da633-c150-43a6-8bad-c40934caafa8",
        "booking_lost_id":  "afafed98-adff-4c3d-9d3d-50f72506fa00",
        "env_key":          "GHL_API_KEY_AESTHETICS",
    },
    "Slimming": {
        "location_id":      "imWIWDcnmOfijW0lltPq",
        "pipeline_id":      "N3usvWAkWpUppJj1ggtM",
        "new_leads_id":     "e2321215-3f53-47ee-b90c-444b632557a1",
        "booking_lost_id":  "889cb211-7c69-466e-88e8-deda84b2f073",
        "env_key":          "GHL_API_KEY_SLIMMING",
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


def fetch_lost_in_new_leads(brand: str, cfg: dict) -> list[dict]:
    token = os.environ[cfg["env_key"]]
    client = httpx.Client(timeout=60, headers=hdr(token))
    params = {
        "location_id": cfg["location_id"],
        "pipeline_id": cfg["pipeline_id"],
        "pipeline_stage_id": cfg["new_leads_id"],
        "status": "lost",
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


def move(token: str, opp_id: str, pipeline_id: str, stage_id: str) -> tuple[int, str]:
    body = {"pipelineId": pipeline_id, "pipelineStageId": stage_id, "status": "lost"}
    for attempt in range(5):
        r = httpx.put(f"{BASE}/opportunities/{opp_id}", headers=hdr(token), json=body, timeout=30)
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
        print(f"\n=== {brand} ===")
        opps = fetch_lost_in_new_leads(brand, cfg)
        print(f"  found {len(opps)} status=lost opps in 🌱 New Leads")
        manifest = [{"opportunity_id": o["id"], "name": o.get("name"),
                     "contactId": o.get("contactId"),
                     "tags": (o.get("contact") or {}).get("tags"),
                     "createdAt": o.get("createdAt")} for o in opps]
        path = TMP / f"ghl_lost_in_new_leads_{brand.lower()}.json"
        path.write_text(json.dumps(manifest, indent=2))
        if not args.execute:
            print(f"  (dry-run; manifest saved to {path})")
            continue
        token = os.environ[cfg["env_key"]]
        ok = fail = 0
        for i, o in enumerate(opps, 1):
            status, body = move(token, o["id"], cfg["pipeline_id"], cfg["booking_lost_id"])
            if 200 <= status < 300:
                ok += 1
            else:
                fail += 1
                if fail <= 5:
                    print(f"    FAIL {o['id']} → HTTP {status} {body}")
            if i % 100 == 0:
                print(f"    [{brand}] progress {i}/{len(opps)}  ok={ok} fail={fail}")
        print(f"  [{brand}] DONE: ok={ok} fail={fail}")

    # Verify
    if args.execute:
        print("\n=== Verifying ===")
        for brand, cfg in BRANDS.items():
            token = os.environ[cfg["env_key"]]
            r = httpx.get(
                f"{BASE}/opportunities/search",
                params={"location_id": cfg["location_id"], "pipeline_id": cfg["pipeline_id"],
                        "pipeline_stage_id": cfg["new_leads_id"], "status": "lost", "limit": 1},
                headers=hdr(token), timeout=30,
            )
            remaining = r.json().get("meta", {}).get("total")
            print(f"  [{brand}] status=lost still in 🌱 New Leads: {remaining}")


if __name__ == "__main__":
    main()
