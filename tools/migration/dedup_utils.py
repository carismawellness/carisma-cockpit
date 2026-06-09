"""Deduplication and record merging logic for CRM migration."""
import re
from datetime import datetime
from Tools.migration.phone_utils import normalize_phone


from typing import Optional, List, Tuple

def normalize_email(email: Optional[str]) -> Optional[str]:
    if not email:
        return None
    e = email.strip().lower()
    # Basic validation: must have @ and a dot after @
    if "@" not in e:
        return None
    parts = e.split("@")
    if len(parts) != 2 or "." not in parts[1]:
        return None
    return e


def _parse_dt(val: Optional[str]) -> Optional[datetime]:
    if not val:
        return None
    for fmt in ("%Y-%m-%dT%H:%M:%S%z", "%Y-%m-%dT%H:%M:%S.%f%z", "%Y-%m-%d"):
        try:
            return datetime.strptime(val[:25], fmt[:len(val[:25])])
        except ValueError:
            continue
    return None


def merge_records(records: List[dict]) -> dict:
    """
    Merge a list of duplicate records into one.
    Strategy: for each field, keep the value from the record with the most
    recent Modified_Time. If tie, keep the non-null value.
    Always keep the earliest Created_Time.
    """
    if len(records) == 1:
        return records[0]

    # Sort by Modified_Time descending (most recent first)
    def mod_time(r):
        dt = _parse_dt(r.get("Modified_Time"))
        return dt.timestamp() if dt else 0.0

    sorted_records = sorted(records, key=mod_time, reverse=True)
    merged = {}

    # Collect all field keys
    all_keys = set()
    for r in records:
        all_keys.update(r.keys())

    for key in all_keys:
        # For each key, take the first non-null value from the most-recently-modified record
        for r in sorted_records:
            val = r.get(key)
            if val is not None and val != "" and val != []:
                merged[key] = val
                break
        else:
            merged[key] = None

    # Keep the earliest Created_Time
    created_times = [_parse_dt(r.get("Created_Time")) for r in records]
    valid_times = [t for t in created_times if t]
    if valid_times:
        earliest = min(valid_times)
        merged["Created_Time"] = earliest.isoformat()

    # Track which zoho IDs were merged (for audit)
    merged["_merged_from_ids"] = [r.get("id") for r in records if r.get("id")]

    return merged


def deduplicate(records: List[dict]) -> Tuple[List[dict], List[dict]]:
    """
    Deduplicate records by email (primary) then phone (secondary).
    Returns (clean_records, dropped_records).
    dropped_records includes entries with reason field.
    """
    dropped = []
    # Step 1: group by normalized email
    email_groups: dict[str, list[dict]] = {}
    no_email = []

    for rec in records:
        email = normalize_email(rec.get("Email") or rec.get("email"))
        if email:
            email_groups.setdefault(email, []).append(rec)
        else:
            no_email.append(rec)

    # Step 2: within no-email records, group by phone
    phone_groups: dict[str, list[dict]] = {}
    truly_no_contact = []

    for rec in no_email:
        phone = normalize_phone(rec.get("Phone") or rec.get("Mobile") or rec.get("phone"))
        if phone:
            # Phone-only: drop per migration rules
            rec["_drop_reason"] = "phone_only_no_email"
            dropped.append(rec)
        else:
            rec["_drop_reason"] = "no_email_no_phone"
            dropped.append(rec)

    # Step 3: merge duplicates within each email group
    clean = []
    for email, group in email_groups.items():
        if len(group) == 1:
            clean.append(group[0])
        else:
            merged = merge_records(group)
            merged["_was_deduped"] = True
            merged["_dedup_count"] = len(group)
            clean.append(merged)

    return clean, dropped


def build_dedup_report(dropped: list[dict], output_path: str) -> None:
    import csv, os
    os.makedirs(os.path.dirname(output_path), exist_ok=True)
    with open(output_path, "w", newline="", encoding="utf-8") as f:
        writer = csv.DictWriter(f, fieldnames=[
            "zoho_id", "email", "phone", "first_name", "last_name", "drop_reason"
        ])
        writer.writeheader()
        for r in dropped:
            writer.writerow({
                "zoho_id": r.get("id", ""),
                "email": r.get("Email", r.get("email", "")),
                "phone": r.get("Phone", r.get("Mobile", r.get("phone", ""))),
                "first_name": r.get("First_Name", r.get("first_name", "")),
                "last_name": r.get("Last_Name", r.get("last_name", "")),
                "drop_reason": r.get("_drop_reason", ""),
            })
