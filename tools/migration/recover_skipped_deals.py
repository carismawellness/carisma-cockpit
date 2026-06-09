"""
Recovery: convert deals that couldn't become GHL opportunities into contact notes.

GHL allows only ONE opportunity per contact per pipeline. Zoho often has multiple
deals per contact (e.g., 3 separate booking attempts). When migrating, the first
deal succeeds; subsequent deals for the same contact fail with:

    400 Bad Request — "Can not create duplicate opportunity for the contact."

This script preserves those skipped deals as notes attached to the contact, so
no Zoho history is lost.

Reads:
  .tmp/migration/{brand}/05-reports/opportunity_import_report.csv
  .tmp/migration/{brand}/04-ready/deals_import.json
  .tmp/migration/{brand}/03-mapped/email_to_ghl_id.json

Writes notes via GHL API and reports to:
  .tmp/migration/{brand}/05-reports/recovered_deals_report.csv

Usage:
  python -m Tools.migration.recover_skipped_deals --brand slimming
  python -m Tools.migration.recover_skipped_deals --brand aesthetics --dry-run
"""
import argparse
import csv
import json
from pathlib import Path

from Tools.migration.brand_config import get_brand
from Tools.migration.ghl_importer import BrandImporter

BASE = Path(__file__).parent.parent.parent
TMP = BASE / ".tmp" / "migration"


def fmt_deal_note(deal: dict) -> str:
    parts = ["[Migrated from Zoho — skipped as duplicate opportunity]"]
    if deal.get("Deal_Name"):
        parts.append(f"Deal: {deal['Deal_Name']}")
    if deal.get("Stage"):
        parts.append(f"Zoho Stage: {deal['Stage']}")
    if deal.get("_ghl_stage_name"):
        parts.append(f"Mapped GHL stage: {deal['_ghl_stage_name']} (status={deal.get('_ghl_status','open')})")
    if deal.get("Amount") is not None:
        try:
            parts.append(f"Amount: €{float(deal['Amount']):,.2f}")
        except (TypeError, ValueError):
            parts.append(f"Amount: {deal.get('Amount')}")
    if deal.get("Closing_Date"):
        parts.append(f"Closing date: {deal['Closing_Date']}")
    if deal.get("Created_Time"):
        parts.append(f"Zoho created: {deal['Created_Time']}")
    if deal.get("Modified_Time"):
        parts.append(f"Zoho modified: {deal['Modified_Time']}")
    owner = deal.get("Owner")
    owner_name = owner.get("name") if isinstance(owner, dict) else owner
    if owner_name:
        parts.append(f"Owner: {owner_name}")
    if deal.get("Description"):
        parts.append(f"Description: {deal['Description']}")
    if deal.get("id"):
        parts.append(f"Zoho deal id: {deal['id']}")
    return "\n".join(parts)


def recover(brand: str, dry_run: bool = False) -> dict:
    cfg = get_brand(brand)
    bdir = TMP / brand
    print(f"\n=== Recovering skipped deals for {brand.upper()} (dry_run={dry_run}) ===")

    report_csv = bdir / "05-reports" / "opportunity_import_report.csv"
    deals_file = bdir / "04-ready" / "deals_import.json"
    email_map_file = bdir / "03-mapped" / "email_to_ghl_id.json"
    if not (report_csv.exists() and deals_file.exists() and email_map_file.exists()):
        print(f"  [ABORT] missing inputs for {brand} — skipping")
        return {"brand": brand, "skipped": 0, "recovered": 0, "errors": 0}

    deals = json.loads(deals_file.read_text(encoding="utf-8"))
    deals_by_id = {str(d.get("id")): d for d in deals}
    email_to_ghl_id = json.loads(email_map_file.read_text(encoding="utf-8"))

    # Find deals that failed with the "duplicate opportunity" error OR were skipped
    failed: list = []
    with open(report_csv, encoding="utf-8") as f:
        for row in csv.DictReader(f):
            status = row.get("status", "")
            if "duplicate" in status.lower() or "error" in status.lower():
                failed.append(row)

    print(f"  Found {len(failed)} deal-import failures to recover as notes")
    if not failed:
        return {"brand": brand, "skipped": 0, "recovered": 0, "errors": 0}

    importer = BrandImporter(brand, dry_run=dry_run)
    recovered = 0
    errors = 0
    no_contact = 0
    rows = []

    for i, row in enumerate(failed):
        zoho_id = row.get("zoho_id")
        deal = deals_by_id.get(str(zoho_id))
        if not deal:
            errors += 1
            rows.append({"zoho_id": zoho_id, "status": "no_deal_in_ready", "ghl_note_id": ""})
            continue

        parent_email = (deal.get("_contact_email") or "").lower()
        ghl_contact_id = email_to_ghl_id.get(parent_email)
        if not ghl_contact_id:
            no_contact += 1
            rows.append({"zoho_id": zoho_id, "status": "no_contact_match", "ghl_note_id": ""})
            continue

        note_body = fmt_deal_note(deal)
        note_id, status = importer.create_note(ghl_contact_id, note_body)
        if note_id and status == "created":
            recovered += 1
            rows.append({"zoho_id": zoho_id, "status": "recovered_as_note", "ghl_note_id": note_id})
        else:
            errors += 1
            rows.append({"zoho_id": zoho_id, "status": f"note_failed:{status}", "ghl_note_id": ""})

        if (i + 1) % 50 == 0:
            print(f"    {i+1}/{len(failed)} ({recovered} recovered, {errors} errors)")

    out_csv = bdir / "05-reports" / "recovered_deals_report.csv"
    with open(out_csv, "w", newline="", encoding="utf-8") as f:
        w = csv.DictWriter(f, fieldnames=["zoho_id", "status", "ghl_note_id"])
        w.writeheader()
        w.writerows(rows)

    summary = {
        "brand": brand,
        "dry_run": dry_run,
        "input_failed": len(failed),
        "recovered_as_notes": recovered,
        "no_contact_match": no_contact,
        "errors": errors,
    }
    print(f"\n  ✓ {summary}")
    return summary


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--brand", required=True, choices=["spa", "aesthetics", "slimming"])
    ap.add_argument("--dry-run", action="store_true")
    args = ap.parse_args()
    recover(args.brand, dry_run=args.dry_run)


if __name__ == "__main__":
    main()
