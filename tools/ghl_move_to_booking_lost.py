"""
Move every opp listed in .tmp/ghl_migration_targets_<brand>.json into the
❌ Booking Lost stage of the brand's Call Pipeline.

Builds on the earlier cleanup script: those opps already have status=lost,
but their pipelineStageId is still 🌱 New Leads. This script issues the
PUT /opportunities/{id} that physically moves them to the Booking Lost column.

Dry-run by default; pass --execute to apply.
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

BRANDS = {
    "Aesthetics": {
        "pipeline_id":      "PaSsbcOAeRURF2Hc2V3F",
        "booking_lost_id":  "afafed98-adff-4c3d-9d3d-50f72506fa00",
        "env_key":          "GHL_API_KEY_AESTHETICS",
    },
    "Slimming": {
        "pipeline_id":      "N3usvWAkWpUppJj1ggtM",
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


def move(token: str, opp_id: str, pipeline_id: str, stage_id: str) -> tuple[int, str]:
    body = {"pipelineId": pipeline_id, "pipelineStageId": stage_id, "status": "lost"}
    for attempt in range(5):
        r = httpx.put(f"{BASE}/opportunities/{opp_id}", headers=hdr(token), json=body, timeout=30)
        if r.status_code == 429:
            time.sleep(2 ** attempt); continue
        return r.status_code, r.text[:200]
    return 599, "max retries"


def run(execute: bool) -> None:
    for brand, cfg in BRANDS.items():
        path = TMP / f"ghl_migration_targets_{brand.lower()}.json"
        if not path.exists():
            print(f"[{brand}] no manifest at {path}; skip."); continue
        manifest = json.loads(path.read_text())
        print(f"\n=== {brand} — {len(manifest)} opps to move into ❌ Booking Lost ===")
        if not execute:
            print(f"  (dry-run; would PUT /opportunities/<id> with pipelineStageId={cfg['booking_lost_id']})")
            continue
        token = os.environ[cfg["env_key"]]
        ok = fail = 0
        for i, entry in enumerate(manifest, 1):
            status, body = move(token, entry["opportunity_id"], cfg["pipeline_id"], cfg["booking_lost_id"])
            if 200 <= status < 300:
                ok += 1
            else:
                fail += 1
                if fail <= 5:
                    print(f"    FAIL {entry['opportunity_id']} → HTTP {status} {body}")
            if i % 100 == 0:
                print(f"    [{brand}] progress {i}/{len(manifest)}  ok={ok} fail={fail}")
        print(f"  [{brand}] DONE: ok={ok} fail={fail}")


def verify() -> None:
    print("\n=== Verifying — sampling 5 opps per brand ===")
    for brand, cfg in BRANDS.items():
        path = TMP / f"ghl_migration_targets_{brand.lower()}.json"
        if not path.exists(): continue
        manifest = json.loads(path.read_text())
        token = os.environ[cfg["env_key"]]
        moved = still_in_new_leads = err = 0
        for entry in manifest[:10]:
            r = httpx.get(f"{BASE}/opportunities/{entry['opportunity_id']}", headers=hdr(token), timeout=30)
            if r.status_code != 200:
                err += 1; continue
            stage = r.json().get("opportunity", {}).get("pipelineStageId")
            if stage == cfg["booking_lost_id"]:
                moved += 1
            else:
                still_in_new_leads += 1
        print(f"  [{brand}] sample 10  moved_to_booking_lost={moved}  not_moved={still_in_new_leads}  err={err}")


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--execute", action="store_true")
    parser.add_argument("--verify", action="store_true")
    args = parser.parse_args()
    load_env()
    if args.verify:
        verify(); return
    run(args.execute)
    if args.execute:
        verify()


if __name__ == "__main__":
    main()
