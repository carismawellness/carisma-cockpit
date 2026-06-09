"""
Analyze pulled WHOOP data for chronic-stress markers:
  - HRV trend (linear regression slope over window)
  - RHR trend
  - Recovery score trend
  - Sleep performance trend
  - Day-of-week patterns

Reads CSVs from .tmp/whoop_data/ produced by pull.py.

Usage:
    python Tools/whoop/analyze.py
    python Tools/whoop/analyze.py --window 30   # rolling window in days
"""

import argparse
import csv
import statistics
import sys
from datetime import datetime
from pathlib import Path

PROJECT_ROOT = Path(__file__).parent.parent.parent
DATA_DIR = PROJECT_ROOT / ".tmp" / "whoop_data"


def load_csv(path: Path) -> list[dict]:
    if not path.exists():
        return []
    with path.open() as f:
        return list(csv.DictReader(f))


def to_float(v) -> float | None:
    try:
        return float(v) if v not in (None, "", "None") else None
    except (TypeError, ValueError):
        return None


def linreg_slope(values: list[float]) -> float:
    """Simple slope of values vs index, in units-per-day."""
    n = len(values)
    if n < 3:
        return 0.0
    xs = list(range(n))
    mean_x = sum(xs) / n
    mean_y = sum(values) / n
    num = sum((x - mean_x) * (y - mean_y) for x, y in zip(xs, values))
    den = sum((x - mean_x) ** 2 for x in xs)
    return num / den if den else 0.0


def summarize(name: str, values: list[float], unit: str = "") -> None:
    values = [v for v in values if v is not None]
    if not values:
        print(f"  {name}: no data")
        return
    slope = linreg_slope(values)
    direction = "↑" if slope > 0 else ("↓" if slope < 0 else "→")
    pct_change = (slope * len(values)) / statistics.mean(values) * 100 if statistics.mean(values) else 0
    print(
        f"  {name}: mean {statistics.mean(values):.1f}{unit}  "
        f"median {statistics.median(values):.1f}  "
        f"slope {slope:+.3f}/day {direction}  "
        f"({pct_change:+.1f}% over window)"
    )


def main() -> int:
    p = argparse.ArgumentParser()
    p.add_argument("--window", type=int, default=None,
                   help="Limit to last N days; default = all available")
    args = p.parse_args()

    recovery = load_csv(DATA_DIR / "recovery.csv")
    cycles = load_csv(DATA_DIR / "cycles.csv")
    sleep = load_csv(DATA_DIR / "sleep.csv")

    if not recovery and not cycles and not sleep:
        print(f"No data in {DATA_DIR}. Run: python Tools/whoop/pull.py --days 90", file=sys.stderr)
        return 1

    # Sort recovery by created_at ascending
    def _key(r):
        return r.get("created_at") or r.get("createdAt") or ""
    recovery.sort(key=_key)
    cycles.sort(key=_key)
    sleep.sort(key=_key)

    if args.window:
        recovery = recovery[-args.window:]
        cycles = cycles[-args.window:]
        sleep = sleep[-args.window:]

    print(f"=== WHOOP analysis ({len(recovery)} recovery records) ===\n")

    # Recovery metrics
    print("Recovery & Autonomic Markers:")
    summarize("HRV (rmssd)",
              [to_float(r.get("score.hrv_rmssd_milli")) for r in recovery], " ms")
    summarize("RHR",
              [to_float(r.get("score.resting_heart_rate")) for r in recovery], " bpm")
    summarize("Recovery score",
              [to_float(r.get("score.recovery_score")) for r in recovery], "%")
    summarize("SpO2 avg",
              [to_float(r.get("score.spo2_percentage")) for r in recovery], "%")
    summarize("Skin temp",
              [to_float(r.get("score.skin_temp_celsius")) for r in recovery], "°C")

    # Sleep metrics
    print("\nSleep:")
    summarize("Sleep performance",
              [to_float(s.get("score.sleep_performance_percentage")) for s in sleep], "%")
    summarize("Sleep efficiency",
              [to_float(s.get("score.sleep_efficiency_percentage")) for s in sleep], "%")
    summarize("Total in bed (h)",
              [(to_float(s.get("score.stage_summary.total_in_bed_time_milli")) or 0) / 3_600_000
               for s in sleep], " h")
    summarize("REM (h)",
              [(to_float(s.get("score.stage_summary.total_rem_sleep_time_milli")) or 0) / 3_600_000
               for s in sleep], " h")
    summarize("Deep / SWS (h)",
              [(to_float(s.get("score.stage_summary.total_slow_wave_sleep_time_milli")) or 0) / 3_600_000
               for s in sleep], " h")
    summarize("Disturbances",
              [to_float(s.get("score.stage_summary.disturbance_count")) for s in sleep])

    # Strain / cycles
    print("\nStrain (daily cycle):")
    summarize("Day strain",
              [to_float(c.get("score.strain")) for c in cycles])
    summarize("Avg HR (cycle)",
              [to_float(c.get("score.average_heart_rate")) for c in cycles], " bpm")
    summarize("Max HR (cycle)",
              [to_float(c.get("score.max_heart_rate")) for c in cycles], " bpm")
    summarize("Kilojoules",
              [to_float(c.get("score.kilojoule")) for c in cycles])

    # Stress signal — derived
    hrv = [to_float(r.get("score.hrv_rmssd_milli")) for r in recovery]
    rhr = [to_float(r.get("score.resting_heart_rate")) for r in recovery]
    hrv = [v for v in hrv if v is not None]
    rhr = [v for v in rhr if v is not None]

    print("\nChronic-stress read:")
    if len(hrv) >= 14 and len(rhr) >= 14:
        hrv_slope = linreg_slope(hrv)
        rhr_slope = linreg_slope(rhr)
        flags = []
        if hrv_slope < 0:
            flags.append(f"HRV trending down ({hrv_slope:+.3f} ms/day)")
        if rhr_slope > 0:
            flags.append(f"RHR trending up ({rhr_slope:+.3f} bpm/day)")
        if not flags:
            print("  No autonomic drift in window — system looks adapted.")
        else:
            print("  Flags:")
            for f in flags:
                print(f"    • {f}")
            if len(flags) == 2:
                print("  → Both autonomic markers drifting wrong way. Classic allostatic-load signature.")
    else:
        print("  Not enough data — pull at least 14 days.")

    return 0


if __name__ == "__main__":
    sys.exit(main())
