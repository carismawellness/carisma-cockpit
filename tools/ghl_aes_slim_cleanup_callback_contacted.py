"""
Unified Aesthetics + Slimming cleanup of 🔁 Call Back and 📞 Contacted stages.

Per stage per brand, any opportunity matching ANY of:
  (a) `assignedTo` is empty (unassigned)        — Aes Call Back per user request
  (b) `status == "lost"` (stage-status mismatch) — Aes Contacted per user request
  (c) Contact carries a Zoho migration tag       — both brands, both stages

→ moved to ❌ Booking Lost with status=lost.

Dry-run by default; --execute to apply. Idempotent.
"""

from __future__ import annotations

import argparse
import json
import os
import time
from collections import Counter
from pathlib import Path

import httpx

BASE = "https://services.leadconnectorhq.com"
ROOT = Path(__file__).resolve().parent.parent
TMP = ROOT / ".tmp"
TMP.mkdir(exist_ok=True)

MIGRATION_TAGS = {"zoho_migrated_2026_04", "zoho_migrated_2026_05"}

BRANDS = {
    "Aesthetics": {
        "env_key": "GHL_API_KEY_AESTHETICS",
        "loc":     "Goi7kzVK7iwe2woxUHkT",
        "pipe":    "PaSsbcOAeRURF2Hc2V3F",
        "callback":     "b890428f-d6a6-4057-87bd-619be5a02844",
        "contacted":    "49ec294f-8b75-4667-9572-cc291ce0855d",
        "booking_lost": "afafed98-adff-4c3d-9d3d-50f72506fa00",
    },
    "Slimming": {
        "env_key": "GHL_API_KEY_SLIMMING",
        "loc":     "imWIWDcnmOfijW0lltPq",
        "pipe":    "N3usvWAkWpUppJj1ggtM",
        "callback":     "5ac3c6a1-dd73-4a3f-9fb1-c45aa352865a",
        "contacted":    "9398dd4d-4d93-4af1-9ace-f7f35e4a1654",
        "booking_lost": "889cb211-7c69-466e-88e8-deda84b2f073",
    },
}


def load_env() -> None:
    for line in (ROOT / ".env").read_text().splitlines():
        if "=" in line and not line.strip().startswith("#"):
            k, _, v = line.partition("=")
            os.environ.setdefault(k.strip(), v.strip())


def hdr(token: str) -> dict:
    return {"Authorization": f"Bearer {token}", "Version": "2021-07-28",
            "Accept": "application/json", "Content-Type": "application/json"}


def fetch_stage(token: str, loc: str, pipe: str, stage_id: str) -> list[dict]:
    """All opps in stage (any status)."""
    client = httpx.Client(timeout=60, headers=hdr(token))
    params = {"location_id": loc, "pipeline_id": pipe,
              "pipeline_stage_id": stage_id, "status": "all", "limit": 100}
    out: list[dict] = []
    while True:
        for attempt in range(5):
            r = client.get(f"{BASE}/opportunities/search", params=params)
            if r.status_code == 429: time.sleep(2 ** attempt); continue
            r.raise_for_status(); break
        else:
            raise RuntimeError("search failed")
        data = r.json()
        batch = data.get("opportunities", [])
        out.extend(batch)
        meta = data.get("meta", {})
        nx = meta.get("startAfter"); ni = meta.get("startAfterId")
        if not nx or not ni or not batch:
            break
        params["startAfter"] = nx; params["startAfterId"] = ni
    return out


def is_unassigned(o: dict) -> bool:
    return not (o.get("assignedTo") or "").strip()


def is_lost(o: dict) -> bool:
    return o.get("status") == "lost"


def is_migration(o: dict) -> bool:
    tags = set(((o.get("contact") or {}).get("tags") or []))
    return bool(tags & MIGRATION_TAGS)


def move_to_booking_lost(token: str, opp_id: str, pipe: str, stage_id: str) -> tuple[int, str]:
    body = {"pipelineId": pipe, "pipelineStageId": stage_id, "status": "lost"}
    for attempt in range(6):
        try:
            r = httpx.put(f"{BASE}/opportunities/{opp_id}", headers=hdr(token), json=body, timeout=30)
        except (httpx.ReadTimeout, httpx.ConnectTimeout, httpx.RemoteProtocolError, httpx.ConnectError):
            time.sleep(2 ** attempt); continue
        if r.status_code == 429:
            time.sleep(2 ** attempt); continue
        return r.status_code, r.text[:200]
    return 599, "max retries"


def classify(o: dict) -> list[str]:
    reasons = []
    if is_unassigned(o): reasons.append("unassigned")
    if is_lost(o):       reasons.append("status=lost")
    if is_migration(o):  reasons.append("migration-tagged")
    return reasons


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--execute", action="store_true")
    args = parser.parse_args()
    load_env()

    all_targets: list[dict] = []  # each: {brand, stage, opp, reasons}
    for brand, cfg in BRANDS.items():
        token = os.environ[cfg["env_key"]]
        for stage_label, stage_id in [("Call Back", cfg["callback"]),
                                      ("Contacted", cfg["contacted"])]:
            opps = fetch_stage(token, cfg["loc"], cfg["pipe"], stage_id)
            hits = [o for o in opps if classify(o)]
            print(f"\n[{brand} / {stage_label}] total in stage: {len(opps)}, "
                  f"matching cleanup criteria: {len(hits)}")
            # show breakdown
            counter = Counter()
            for o in hits:
                key = "+".join(classify(o))
                counter[key] += 1
            for k, v in counter.most_common():
                print(f"   {k:35s} {v}")
            for o in hits:
                all_targets.append({
                    "brand": brand,
                    "stage_label": stage_label,
                    "pipe": cfg["pipe"],
                    "booking_lost": cfg["booking_lost"],
                    "env_key": cfg["env_key"],
                    "opp_id": o["id"],
                    "name": o.get("name"),
                    "reasons": classify(o),
                    "status_before": o.get("status"),
                })

    # Manifest
    Path(TMP / "ghl_aes_slim_callback_contacted_cleanup.json").write_text(
        json.dumps(all_targets, indent=2))
    grand = len(all_targets)
    print(f"\n=== GRAND TOTAL to move → ❌ Booking Lost: {grand} ===")

    if not args.execute:
        print("\nDRY RUN. Re-run with --execute.")
        return

    # Execute
    print("\n=== EXECUTING ===")
    ok = fail = 0
    for i, t in enumerate(all_targets, 1):
        token = os.environ[t["env_key"]]
        st, body = move_to_booking_lost(token, t["opp_id"], t["pipe"], t["booking_lost"])
        if 200 <= st < 300:
            ok += 1
        else:
            fail += 1
            if fail <= 5:
                print(f"   FAIL {t['brand']}/{t['stage_label']} {t['opp_id']} → HTTP {st} {body}")
        if i % 100 == 0:
            print(f"   progress {i}/{grand}  ok={ok} fail={fail}")
    print(f"DONE: ok={ok} fail={fail}")

    # Fresh verification
    print("\n=== FRESH VERIFICATION ===")
    for brand, cfg in BRANDS.items():
        token = os.environ[cfg["env_key"]]
        for stage_label, stage_id in [("Call Back", cfg["callback"]),
                                      ("Contacted", cfg["contacted"])]:
            opps = fetch_stage(token, cfg["loc"], cfg["pipe"], stage_id)
            remaining = [o for o in opps if classify(o)]
            print(f"  [{brand} / {stage_label}] total={len(opps)}  "
                  f"still matching cleanup criteria={len(remaining)}")


if __name__ == "__main__":
    main()
