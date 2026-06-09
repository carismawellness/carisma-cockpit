"""
Build a brand-specific stage_map.json by:
  1. Fetching live GHL pipelines for the brand's location.
  2. Picking the booking pipeline (largest by stage count, or matched by name keyword).
  3. Mapping every Zoho deal stage (from .tmp/migration/{brand}/01-raw/deals.json)
     to the closest GHL stage by name + semantic similarity.

Writes:
  .tmp/migration/{brand}/03-mapped/stage_map.json  (brand-specific stage IDs)
  .tmp/migration/{brand}/03-mapped/pipelines_live.json  (raw GHL pipelines snapshot)

Usage:
  python -m Tools.migration.build_stage_map --brand aesthetics
  python -m Tools.migration.build_stage_map --brand slimming
  python -m Tools.migration.build_stage_map --brand aesthetics --pipeline-name "Call Pipeline"
"""
import argparse
import json
import re
from collections import Counter
from pathlib import Path

import httpx

from Tools.migration.brand_config import get_brand, require_api_key

BASE = Path(__file__).parent.parent.parent
TMP = BASE / ".tmp" / "migration"
GHL_BASE = "https://services.leadconnectorhq.com"


def fetch_pipelines(brand: str) -> list:
    cfg = get_brand(brand)
    api_key = require_api_key(brand)
    headers = {
        "Authorization": f"Bearer {api_key}",
        "Version": "2021-07-28",
        "Content-Type": "application/json",
    }
    r = httpx.get(f"{GHL_BASE}/opportunities/pipelines",
                  params={"locationId": cfg["location_id"]},
                  headers=headers, timeout=30)
    r.raise_for_status()
    return r.json().get("pipelines", [])


def pick_pipeline(pipelines: list, hint: str = "") -> dict:
    """Pick the booking pipeline — by name keyword if given, else largest."""
    if hint:
        for p in pipelines:
            if hint.lower() in p["name"].lower():
                return p
        raise ValueError(f"No pipeline matching '{hint}'. Available: {[p['name'] for p in pipelines]}")
    # Fallback: pick the one with the most stages (likely the main booking pipeline)
    return max(pipelines, key=lambda p: len(p.get("stages", [])))


_NORMALIZE_RE = re.compile(r"[^a-z0-9]+")


def normalize(name: str) -> str:
    """Strip emoji, lowercase, collapse non-alphanumeric → for fuzzy compare."""
    return _NORMALIZE_RE.sub(" ", name.lower()).strip()


# Semantic buckets — Zoho stage keywords → GHL stage keyword
SEMANTIC_BUCKETS = {
    "won":         ["won", "booked", "confirmed", "members closed won", "use subscription credit"],
    "lost":        ["lost", "closed lost", "not interested"],
    "nurturing":   ["follow up", "followup", "nurture", "nurturing", "interested in future",
                    "existing customer", "consultation - follow", "campaigns meta"],
    "contacted":   ["contacted", "consultation requested"],
    "no show":     ["no show", "noshow"],
    "call back":   ["call back", "callback"],
    "new":         ["new lead", "new chat", "new"],
}

# GHL stage names (what we expect in each brand's mirrored pipeline). Keys are the
# canonical bucket; values are the keyword to search for in the GHL stage name.
BUCKET_TO_GHL_STAGE_KEYWORD = {
    "won":       "won",
    "lost":      "lost",
    "nurturing": "nurturing",
    "contacted": "contacted",
    "no show":   "no show",
    "call back": "call back",
    "new":       "new",
}


def classify_zoho_stage(stage: str) -> str:
    """Return one of the bucket keys for a Zoho stage name."""
    n = normalize(stage)
    for bucket, kws in SEMANTIC_BUCKETS.items():
        for kw in kws:
            if kw in n:
                return bucket
    return "new"  # default fallback


def find_ghl_stage_for_bucket(bucket: str, ghl_stages: list) -> dict:
    """Find the GHL stage matching a bucket; return dict with name + id."""
    keyword = BUCKET_TO_GHL_STAGE_KEYWORD.get(bucket, "new")
    for s in ghl_stages:
        if keyword in normalize(s["name"]):
            return s
    # No match → fall back to first stage (presumably "New Leads")
    return ghl_stages[0]


def status_for_bucket(bucket: str) -> str:
    if bucket == "won":
        return "won"
    if bucket == "lost":
        return "lost"
    return "open"


def build_for_brand(brand: str, pipeline_hint: str = "") -> dict:
    print(f"\n=== Building stage_map for {brand} ===")
    pipelines = fetch_pipelines(brand)
    print(f"  Found {len(pipelines)} GHL pipelines:")
    for p in pipelines:
        print(f"    - {p['name']} (id={p['id']}, {len(p.get('stages',[]))} stages)")

    pipeline = pick_pipeline(pipelines, pipeline_hint)
    stages = pipeline["stages"]
    print(f"\n  Using pipeline: '{pipeline['name']}' (id={pipeline['id']})")
    print(f"  Stages:")
    for s in stages:
        print(f"    - {s['name']} (id={s['id']})")

    # Snapshot live pipelines for audit
    out_dir = TMP / brand / "03-mapped"
    out_dir.mkdir(parents=True, exist_ok=True)
    (out_dir / "pipelines_live.json").write_text(
        json.dumps(pipelines, indent=2, ensure_ascii=False), encoding="utf-8"
    )

    # Enumerate Zoho stages from raw deals
    deals_file = TMP / brand / "01-raw" / "deals.json"
    if not deals_file.exists():
        raise FileNotFoundError(f"{deals_file} not found — run extraction first.")
    deals = json.loads(deals_file.read_text(encoding="utf-8"))
    zoho_stages = Counter(d.get("Stage") for d in deals if d.get("Stage"))

    # Build the map
    stage_map = {
        "_note": f"Auto-generated by build_stage_map.py for {brand}. Review before import.",
        "_brand": brand,
        "_ghl_pipeline_id": pipeline["id"],
        "_ghl_pipeline_name": pipeline["name"],
    }

    print(f"\n  Mapping {len(zoho_stages)} Zoho stages:")
    for zoho_stage, count in zoho_stages.most_common():
        bucket = classify_zoho_stage(zoho_stage)
        ghl = find_ghl_stage_for_bucket(bucket, stages)
        stage_map[zoho_stage] = {
            "ghl_stage": ghl["name"],
            "ghl_stage_id": ghl["id"],
            "match_method": f"bucket:{bucket}",
            "status": status_for_bucket(bucket),
            "_zoho_count": count,
        }
        print(f"    {count:6d}  {zoho_stage:50s} → {ghl['name']} ({status_for_bucket(bucket)})")

    map_path = out_dir / "stage_map.json"
    map_path.write_text(json.dumps(stage_map, indent=2, ensure_ascii=False), encoding="utf-8")
    print(f"\n  ✓ Wrote {map_path}")
    return stage_map


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--brand", required=True, choices=["spa", "aesthetics", "slimming"])
    ap.add_argument("--pipeline-name", default="",
                    help="Substring of GHL pipeline name to use (e.g. 'Call'). "
                         "Default: largest pipeline by stage count.")
    args = ap.parse_args()
    build_for_brand(args.brand, args.pipeline_name)


if __name__ == "__main__":
    main()
