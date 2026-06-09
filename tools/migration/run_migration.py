"""
Migration orchestrator — runs all phases for the Zoho → GHL migration.

Usage:
    python Tools/migration/run_migration.py --phase extract --brand spa
    python Tools/migration/run_migration.py --phase clean   --brand all
    python Tools/migration/run_migration.py --phase map     --brand spa
    python Tools/migration/run_migration.py --phase import  --brand spa --dry-run
    python Tools/migration/run_migration.py --phase import  --brand spa
    python Tools/migration/run_migration.py --phase verify  --brand spa

Phases in order:
    1. extract  — Pull data from Zoho (run via Claude Code MCP, not this script)
    2. clean    — Dedup, normalize phones, drop phone-only contacts
    3. map      — Transform Zoho fields → GHL fields, apply stage mapping
    4. approve  — Human writes APPROVED into 04-ready/APPROVAL.txt
    5. import   — Push to GHL (dry-run first, then live)
    6. verify   — Check row counts and spot-check records

IMPORTANT: Only spa imports to GHL. aesthetics/slimming stop at map phase.
"""
import argparse
import json
import sys
from pathlib import Path

BASE = Path(__file__).parent.parent.parent
TMP = BASE / ".tmp" / "migration"

BRANDS = ["spa", "aesthetics", "slimming"]
IMPORT_BRANDS = ["spa"]  # Only spa has a GHL account configured


def check_approval(brand: str) -> bool:
    approval_file = TMP / brand / "04-ready" / "APPROVAL.txt"
    if not approval_file.exists():
        print(f"\n  ⛔ APPROVAL REQUIRED")
        print(f"  Review the files in .tmp/migration/{brand}/04-ready/")
        print(f"  Review the stage mapping in .tmp/migration/{brand}/03-mapped/stage_map.json")
        print(f"  Then create: .tmp/migration/{brand}/04-ready/APPROVAL.txt")
        print(f"  Content: APPROVED <date> <your initials>")
        print(f"  Example: APPROVED 2026-04-21 MG")
        return False
    content = approval_file.read_text().strip()
    if not content.startswith("APPROVED"):
        print(f"  ⛔ APPROVAL.txt exists but does not start with 'APPROVED'. Got: {content[:50]}")
        return False
    print(f"  ✓ Approval confirmed: {content}")
    return True


def phase_clean(brands: list[str]) -> None:
    from Tools.migration.data_cleaner import clean_brand
    for brand in brands:
        clean_brand(brand)


def phase_map(brands: list[str]) -> None:
    from Tools.migration.field_mapper import map_brand
    for brand in brands:
        map_brand(brand)


def phase_import(brands: list[str], dry_run: bool = False) -> None:
    from Tools.migration.ghl_importer import import_brand
    for brand in brands:
        if brand not in IMPORT_BRANDS:
            print(f"\n  [{brand.upper()}] Skipped — GHL account not yet configured. Data is ready in 04-ready/ for future import.")
            continue
        if not dry_run and not check_approval(brand):
            print(f"\n  Stopping — approval required before live import of {brand}.")
            sys.exit(1)
        import_brand(brand, dry_run=dry_run)


def phase_verify(brands: list[str]) -> None:
    from Tools.migration.migration_verifier import verify_brand
    for brand in brands:
        verify_brand(brand)


def print_summary() -> None:
    """Print current state of all brand extraction files."""
    print("\n=== MIGRATION STATUS ===")
    for brand in BRANDS:
        print(f"\n{brand.upper()}:")
        for phase_dir in ["01-raw", "02-cleaned", "03-mapped", "04-ready", "05-reports"]:
            d = TMP / brand / phase_dir
            if d.exists():
                files = list(d.glob("*.json"))
                total = sum(1 for f in files)
                print(f"  {phase_dir}: {total} files")
                for f in sorted(files)[:5]:
                    try:
                        data = json.loads(f.read_text())
                        count = len(data) if isinstance(data, list) else "dict"
                        print(f"    {f.name}: {count} records")
                    except Exception:
                        print(f"    {f.name}")
            else:
                print(f"  {phase_dir}: (not created)")


def main():
    parser = argparse.ArgumentParser(description="Zoho → GHL Migration Orchestrator")
    parser.add_argument("--phase", choices=["extract", "clean", "map", "import", "verify", "status"],
                        required=True, help="Which phase to run")
    parser.add_argument("--brand", default="all",
                        help="Brand to process: spa | aesthetics | slimming | all")
    parser.add_argument("--dry-run", action="store_true",
                        help="Simulate import without writing to GHL")
    args = parser.parse_args()

    brands = BRANDS if args.brand == "all" else [args.brand]

    if args.phase == "extract":
        print("Extraction runs via Claude Code MCP agents (see plan Phase 1).")
        print("Run the 3 parallel agents from Claude Code session, then re-run --phase clean.")

    elif args.phase == "clean":
        phase_clean(brands)

    elif args.phase == "map":
        phase_map(brands)

    elif args.phase == "import":
        phase_import(brands, dry_run=args.dry_run)

    elif args.phase == "verify":
        phase_verify(brands)

    elif args.phase == "status":
        print_summary()


if __name__ == "__main__":
    main()
