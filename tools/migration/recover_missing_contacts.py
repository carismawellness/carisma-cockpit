"""
Recovery: re-upsert contacts that didn't land in GHL with their own email
because of phone-collision-based deduplication.

GHL `/contacts/upsert` matches on email OR phone. When we send (email A + phone P)
and phone P already exists on a different contact, GHL updates THAT contact
(keeping its original email) instead of creating a new contact for email A.
The result: email A never makes it into GHL.

This script:
  1. Loads `05-reports/missing_contacts.csv` (output of reconcile.py)
  2. For each email, finds the original payload in `04-ready/contacts_import.json`
  3. Strips the phone field and re-upserts
  4. Updates `email_to_ghl_id.json` with the new ghl_id
  5. Logs results to `recovered_contacts_report.csv`

Usage:
  python -m Tools.migration.recover_missing_contacts --brand aesthetics
  python -m Tools.migration.recover_missing_contacts --brand slimming --dry-run
"""
import argparse
import asyncio
import csv
import json
from pathlib import Path

from Tools.migration.brand_config import get_brand
from Tools.migration.ghl_importer_fast import FastImporter

BASE = Path(__file__).parent.parent.parent
TMP = BASE / ".tmp" / "migration"


async def recover(brand: str, dry_run: bool = False, concurrency: int = 8) -> dict:
    cfg = get_brand(brand)
    bdir = TMP / brand
    print(f"\n=== Recovering missing contacts for {brand.upper()} (dry_run={dry_run}) ===")

    miss_csv = bdir / "05-reports" / "missing_contacts.csv"
    if not miss_csv.exists():
        print(f"  [ABORT] {miss_csv} not found — run reconcile first")
        return {"brand": brand, "missing": 0, "recovered": 0}

    contacts = json.loads((bdir / "04-ready" / "contacts_import.json").read_text())
    by_email = {(c.get("email") or "").lower(): c for c in contacts}

    missing_emails = [line.strip() for line in miss_csv.read_text().splitlines()[1:] if line.strip()]
    print(f"  Found {len(missing_emails)} missing emails to retry")

    em_path = bdir / "03-mapped" / "email_to_ghl_id.json"
    email_to_ghl_id = json.loads(em_path.read_text()) if em_path.exists() else {}

    imp = FastImporter(brand, concurrency=concurrency, dry_run=dry_run)
    coros = []
    no_payload = []
    for email in missing_emails:
        rec = by_email.get(email)
        if not rec:
            no_payload.append(email)
            continue
        # Strip phone to bypass phone-collision dedup
        no_phone_payload = dict(rec)
        no_phone_payload.pop("phone", None)
        coros.append(imp.upsert_contact(no_phone_payload))

    print(f"  Retrying {len(coros)} email-only upserts (skipped {len(no_payload)} with no payload)")

    results = []
    for coro in asyncio.as_completed(coros):
        r = await coro
        results.append(r)

    recovered = 0
    errors = 0
    for r in results:
        if r.get("ghl_id") and r["status"] in ("created", "updated"):
            email_to_ghl_id[r["email"]] = r["ghl_id"]
            recovered += 1
        elif "error" in (r.get("status") or ""):
            errors += 1

    if not dry_run:
        em_path.write_text(json.dumps(email_to_ghl_id, indent=2))

    out_csv = bdir / "05-reports" / "recovered_contacts_report.csv"
    with open(out_csv, "w", newline="", encoding="utf-8") as f:
        w = csv.DictWriter(f, fieldnames=["zoho_id", "email", "ghl_id", "status"])
        w.writeheader()
        w.writerows(results)

    summary = {
        "brand": brand,
        "missing_input": len(missing_emails),
        "no_payload": len(no_payload),
        "recovered": recovered,
        "errors": errors,
    }
    print(f"\n  ✓ {summary}")
    await imp.close()
    return summary


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--brand", required=True, choices=["spa", "aesthetics", "slimming"])
    ap.add_argument("--dry-run", action="store_true")
    args = ap.parse_args()
    asyncio.run(recover(args.brand, dry_run=args.dry_run))


if __name__ == "__main__":
    main()
