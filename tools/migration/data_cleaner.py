"""
Data cleaning pipeline: dedup, phone normalization, drop rules.
Run AFTER extraction, BEFORE field mapping.

Usage:
    python -m Tools.migration.data_cleaner spa
    python -m Tools.migration.data_cleaner aesthetics
    python -m Tools.migration.data_cleaner slimming
"""
import json
import sys
from pathlib import Path
from Tools.migration.dedup_utils import deduplicate, build_dedup_report, normalize_email
from Tools.migration.phone_utils import normalize_phone

BASE = Path(__file__).parent.parent.parent
TMP = BASE / ".tmp" / "migration"


def load(brand: str, module: str) -> list:
    path = TMP / brand / "01-raw" / f"{module}.json"
    if not path.exists():
        print(f"  [WARN] {brand}/{module}.json not found, skipping")
        return []
    with open(path, encoding="utf-8") as f:
        return json.load(f)


def save(data: list, brand: str, filename: str) -> None:
    path = TMP / brand / "02-cleaned" / filename
    path.parent.mkdir(parents=True, exist_ok=True)
    with open(path, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=2)
    print(f"  Saved {len(data)} records → {path}")


def normalize_record_phones(rec: dict) -> dict:
    """Normalize Phone and Mobile fields in-place."""
    for field in ("Phone", "Mobile", "phone", "mobile"):
        if rec.get(field):
            normalized = normalize_phone(rec[field])
            rec[field] = normalized  # None if invalid
    return rec


def clean_brand(brand: str) -> dict:
    print(f"\n{'='*50}")
    print(f"CLEANING: {brand.upper()}")
    print(f"{'='*50}")

    # ── 1. Load contacts + leads, merge into unified contact list ──────────────
    contacts = load(brand, "contacts")
    leads = load(brand, "leads")

    # Tag source so we can track origin
    for r in contacts:
        r.setdefault("_zoho_module", "Contacts")
    for r in leads:
        r.setdefault("_zoho_module", "Leads")
        # Normalise lead field names to match contacts
        if "Last_Name" not in r and "last_name" in r:
            r["Last_Name"] = r.pop("last_name")
        if "First_Name" not in r and "first_name" in r:
            r["First_Name"] = r.pop("first_name")

    all_people = contacts + leads
    print(f"  Loaded: {len(contacts)} contacts + {len(leads)} leads = {len(all_people)} total")

    # ── 2. Normalize phones on all records ────────────────────────────────────
    all_people = [normalize_record_phones(r) for r in all_people]

    # ── 3. Deduplicate ────────────────────────────────────────────────────────
    clean_people, dropped = deduplicate(all_people)
    print(f"  After dedup: {len(clean_people)} kept, {len(dropped)} dropped")

    # ── 4. Save reports ───────────────────────────────────────────────────────
    report_path = str(TMP / brand / "05-reports" / "drop_report.csv")
    build_dedup_report(dropped, report_path)

    dedup_dropped = [r for r in dropped if r.get("_drop_reason") not in ("phone_only_no_email", "no_email_no_phone")]
    dedup_merged = [r for r in clean_people if r.get("_was_deduped")]
    print(f"  Dropped (phone-only):    {sum(1 for r in dropped if r.get('_drop_reason') == 'phone_only_no_email')}")
    print(f"  Dropped (no contact):    {sum(1 for r in dropped if r.get('_drop_reason') == 'no_email_no_phone')}")
    print(f"  Merged duplicates:       {len(dedup_merged)}")

    # ── 5. Save cleaned contacts ──────────────────────────────────────────────
    save(clean_people, brand, "contacts_clean.json")

    # ── 6. Clean deals (normalize phone refs, keep FK to contact email) ────────
    deals = load(brand, "deals")
    deals_clean = []
    for deal in deals:
        # Deals link to contacts via Contact_Name (name object) or email
        # Keep as-is; field_mapper will resolve the GHL contact ID
        deals_clean.append(deal)
    save(deals_clean, brand, "deals_clean.json")
    print(f"  Deals: {len(deals_clean)} kept (no drop rules on deals)")

    # ── 7. Pass-through notes and tasks ───────────────────────────────────────
    notes = load(brand, "notes")
    save(notes, brand, "notes_clean.json")

    tasks = load(brand, "tasks")
    save(tasks, brand, "tasks_clean.json")

    summary = {
        "brand": brand,
        "input_contacts": len(contacts),
        "input_leads": len(leads),
        "input_total": len(all_people),
        "output_contacts": len(clean_people),
        "dropped_total": len(dropped),
        "dropped_phone_only": sum(1 for r in dropped if r.get("_drop_reason") == "phone_only_no_email"),
        "dropped_no_contact": sum(1 for r in dropped if r.get("_drop_reason") == "no_email_no_phone"),
        "merged_duplicates": len(dedup_merged),
        "deals": len(deals_clean),
        "notes": len(notes),
        "tasks": len(tasks),
    }

    # Save summary
    summary_path = TMP / brand / "05-reports" / "clean_summary.json"
    summary_path.parent.mkdir(parents=True, exist_ok=True)
    with open(summary_path, "w") as f:
        json.dump(summary, f, indent=2)

    print(f"\n  ✓ {brand} cleaning complete")
    return summary


if __name__ == "__main__":
    brand = sys.argv[1] if len(sys.argv) > 1 else "spa"
    summary = clean_brand(brand)
    print(f"\nSummary: {json.dumps(summary, indent=2)}")
