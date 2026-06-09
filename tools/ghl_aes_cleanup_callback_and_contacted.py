"""
Aesthetics-only cleanup:
  TASK A: 🔁 Call Back stage — every opp with no `assignedTo` → ❌ Booking Lost
  TASK B: 📞 Contacted stage — every opp with status=lost (stage mismatch)
          → ❌ Booking Lost

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

LOC = "Goi7kzVK7iwe2woxUHkT"
PIPE = "PaSsbcOAeRURF2Hc2V3F"
STAGE_CALLBACK     = "b890428f-d6a6-4057-87bd-619be5a02844"  # 🔁 Call Back
STAGE_CONTACTED    = "49ec294f-8b75-4667-9572-cc291ce0855d"  # 📞 Contacted
STAGE_BOOKING_LOST = "afafed98-adff-4c3d-9d3d-50f72506fa00"  # ❌ Booking Lost


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


def fetch_stage(token: str, stage_id: str, status: str = "all") -> list[dict]:
    client = httpx.Client(timeout=60, headers=hdr(token))
    params = {"location_id": LOC, "pipeline_id": PIPE,
              "pipeline_stage_id": stage_id, "status": status, "limit": 100}
    out: list[dict] = []
    while True:
        for attempt in range(5):
            r = client.get(f"{BASE}/opportunities/search", params=params)
            if r.status_code == 429:
                time.sleep(2 ** attempt); continue
            r.raise_for_status()
            break
        else:
            raise RuntimeError("search failed")
        data = r.json()
        batch = data.get("opportunities", [])
        out.extend(batch)
        meta = data.get("meta", {})
        next_after = meta.get("startAfter"); next_id = meta.get("startAfterId")
        if not next_after or not next_id or not batch:
            break
        params["startAfter"] = next_after; params["startAfterId"] = next_id
    return out


def move_to_booking_lost(token: str, opp_id: str) -> tuple[int, str]:
    body = {"pipelineId": PIPE, "pipelineStageId": STAGE_BOOKING_LOST, "status": "lost"}
    for attempt in range(6):
        try:
            r = httpx.put(f"{BASE}/opportunities/{opp_id}", headers=hdr(token), json=body, timeout=30)
        except (httpx.ReadTimeout, httpx.ConnectTimeout, httpx.RemoteProtocolError,
                httpx.ConnectError):
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
    token = os.environ["GHL_API_KEY_AESTHETICS"]

    # TASK A: Call Back, unassigned
    print("\n=== TASK A: 🔁 Call Back — unassigned opps ===")
    callback = fetch_stage(token, STAGE_CALLBACK, status="all")
    unassigned = [o for o in callback if not (o.get("assignedTo") or "").strip()]
    print(f"  total in Call Back stage:   {len(callback)}")
    print(f"  unassigned (no agent):      {len(unassigned)}")
    by_status = {}
    for o in unassigned:
        by_status[o.get("status")] = by_status.get(o.get("status"), 0) + 1
    print(f"  by current status:          {by_status}")
    if unassigned[:5]:
        print(f"  Sample (first 5):")
        for o in unassigned[:5]:
            c = o.get("contact") or {}
            print(f"    {o['id']}  name={o.get('name')!r:25s} status={o.get('status')}  email={c.get('email')!r}")

    # TASK B: Contacted, status=lost
    print("\n=== TASK B: 📞 Contacted — status=lost opps ===")
    contacted_lost = fetch_stage(token, STAGE_CONTACTED, status="lost")
    print(f"  status=lost stuck in Contacted: {len(contacted_lost)}")
    if contacted_lost[:5]:
        print(f"  Sample (first 5):")
        for o in contacted_lost[:5]:
            print(f"    {o['id']}  name={o.get('name')!r:25s} assignedTo={o.get('assignedTo')!r}")

    # Save manifests
    Path(TMP / "ghl_aes_callback_unassigned.json").write_text(
        json.dumps([{"id": o["id"], "name": o.get("name"),
                     "status_before": o.get("status"), "contactId": o.get("contactId")}
                    for o in unassigned], indent=2))
    Path(TMP / "ghl_aes_contacted_lost.json").write_text(
        json.dumps([{"id": o["id"], "name": o.get("name"),
                     "contactId": o.get("contactId")}
                    for o in contacted_lost], indent=2))

    grand = len(unassigned) + len(contacted_lost)
    print(f"\n=== GRAND TOTAL to move → ❌ Booking Lost: {grand} ===")
    if not args.execute:
        print("\nDRY RUN. Re-run with --execute.")
        return

    # Execute both
    for label, group in [("Call Back unassigned", unassigned), ("Contacted lost", contacted_lost)]:
        print(f"\n  Moving {len(group)} from {label}...")
        ok = fail = 0
        for i, o in enumerate(group, 1):
            st, body = move_to_booking_lost(token, o["id"])
            if 200 <= st < 300:
                ok += 1
            else:
                fail += 1
                if fail <= 5:
                    print(f"    FAIL {o['id']} → HTTP {st} {body}")
            if i % 100 == 0:
                print(f"    progress {i}/{len(group)}  ok={ok} fail={fail}")
        print(f"  DONE: ok={ok} fail={fail}")

    # Fresh verification
    print("\n=== FRESH VERIFICATION ===")
    cb2 = fetch_stage(token, STAGE_CALLBACK, status="all")
    cb_unassigned = [o for o in cb2 if not (o.get("assignedTo") or "").strip()]
    ct_lost = fetch_stage(token, STAGE_CONTACTED, status="lost")
    print(f"  Call Back unassigned remaining: {len(cb_unassigned)} (of {len(cb2)} total in stage)")
    print(f"  Contacted status=lost remaining: {len(ct_lost)}")


if __name__ == "__main__":
    main()
