"""
Pull WHOOP data (cycles, recovery, sleep, workouts) for the last N days
and write flattened CSVs (and optional raw JSON) to .tmp/whoop_data/.

Usage:
    python Tools/whoop/pull.py --days 90
    python Tools/whoop/pull.py --days 30 --json
"""

import argparse
import csv
import json
import sys
from datetime import datetime, timedelta, timezone
from pathlib import Path

PROJECT_ROOT = Path(__file__).parent.parent.parent
sys.path.insert(0, str(PROJECT_ROOT))

from Tools.whoop.client import WhoopClient

OUT_DIR = PROJECT_ROOT / ".tmp" / "whoop_data"


def iso(dt: datetime) -> str:
    return dt.strftime("%Y-%m-%dT%H:%M:%S.000Z")


def _flatten(d: dict, prefix: str = "") -> dict:
    out: dict = {}
    for k, v in d.items():
        key = f"{prefix}{k}" if not prefix else f"{prefix}.{k}"
        if isinstance(v, dict):
            out.update(_flatten(v, key))
        elif isinstance(v, list):
            out[key] = json.dumps(v)
        else:
            out[key] = v
    return out


def write_csv(path: Path, rows: list[dict]) -> None:
    if not rows:
        return
    flat_rows = [_flatten(r) for r in rows]
    fields: list[str] = []
    seen = set()
    for r in flat_rows:
        for k in r.keys():
            if k not in seen:
                seen.add(k)
                fields.append(k)
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", newline="") as f:
        w = csv.DictWriter(f, fieldnames=fields, extrasaction="ignore")
        w.writeheader()
        for r in flat_rows:
            w.writerow(r)


def main() -> int:
    p = argparse.ArgumentParser()
    p.add_argument("--days", type=int, default=90)
    p.add_argument("--json", action="store_true", help="Also dump raw JSON")
    args = p.parse_args()

    end = datetime.now(timezone.utc)
    start = end - timedelta(days=args.days)
    s, e = iso(start), iso(end)

    print(f"Pulling WHOOP data {start.date()} → {end.date()}")
    c = WhoopClient()

    profile = c.get_profile()
    print(f"  user: {profile.get('email') or profile.get('user_id')}")

    print("  cycles...", end=" ", flush=True)
    cycles = c.get_cycles(s, e)
    print(f"{len(cycles)}")

    print("  recovery...", end=" ", flush=True)
    recovery = c.get_recovery(s, e)
    print(f"{len(recovery)}")

    print("  sleep...", end=" ", flush=True)
    sleep = c.get_sleep(s, e)
    print(f"{len(sleep)}")

    print("  workouts...", end=" ", flush=True)
    workouts = c.get_workouts(s, e)
    print(f"{len(workouts)}")

    OUT_DIR.mkdir(parents=True, exist_ok=True)

    if args.json:
        (OUT_DIR / "cycles.json").write_text(json.dumps(cycles, indent=2, default=str))
        (OUT_DIR / "recovery.json").write_text(json.dumps(recovery, indent=2, default=str))
        (OUT_DIR / "sleep.json").write_text(json.dumps(sleep, indent=2, default=str))
        (OUT_DIR / "workouts.json").write_text(json.dumps(workouts, indent=2, default=str))
        (OUT_DIR / "profile.json").write_text(json.dumps(profile, indent=2, default=str))

    write_csv(OUT_DIR / "cycles.csv", cycles)
    write_csv(OUT_DIR / "recovery.csv", recovery)
    write_csv(OUT_DIR / "sleep.csv", sleep)
    write_csv(OUT_DIR / "workouts.csv", workouts)

    print(f"\nSaved to {OUT_DIR}/")
    return 0


if __name__ == "__main__":
    sys.exit(main())
