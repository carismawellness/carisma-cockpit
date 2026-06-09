"""
Field mapper: transforms cleaned Zoho records into GHL-shaped import payloads.
Reads stage_map.json (which embeds the GHL pipeline + stage IDs for the brand)
and writes to 04-ready/.

Usage:
    python -m Tools.migration.field_mapper spa
    python -m Tools.migration.field_mapper aesthetics
    python -m Tools.migration.field_mapper slimming
"""
import json
import sys
from pathlib import Path
from typing import Optional, Tuple

from Tools.migration.brand_config import get_brand

BASE = Path(__file__).parent.parent.parent
TMP = BASE / ".tmp" / "migration"


def load_json(path: Path):
    with open(path, encoding="utf-8") as f:
        return json.load(f)


def save_json(data, path: Path) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with open(path, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=2)
    count = len(data)
    print(f"  Saved {count} records → {path.name}")


def load_stage_map(brand: str) -> dict:
    path = TMP / brand / "03-mapped" / "stage_map.json"
    if path.exists():
        return load_json(path)
    print(f"  [WARN] No stage_map.json for {brand}, all stages → 🌱 New Leads")
    return {}


def get_pipeline_id(stage_map: dict) -> Optional[str]:
    """Pull the GHL pipeline ID embedded in stage_map metadata (key '_ghl_pipeline_id')."""
    pid = stage_map.get("_ghl_pipeline_id")
    if not pid:
        print("  [WARN] stage_map.json missing '_ghl_pipeline_id'. Deals will fail to import.")
    return pid


def get_default_stage(stage_map: dict) -> Tuple[str, str]:
    """First non-meta entry in stage_map is the default fallback stage."""
    for k, v in stage_map.items():
        if k.startswith("_") or not isinstance(v, dict):
            continue
        if v.get("ghl_stage_id"):
            return v.get("ghl_stage", "🌱 New Leads"), v["ghl_stage_id"]
    return "🌱 New Leads", ""


def map_stage(zoho_stage: Optional[str], stage_map: dict) -> Tuple[str, str]:
    """Returns (ghl_stage_name, ghl_stage_id). Falls back to first stage in map."""
    default_name, default_id = get_default_stage(stage_map)
    if not zoho_stage:
        return default_name, default_id
    entry = stage_map.get(zoho_stage)
    if entry and isinstance(entry, dict) and entry.get("ghl_stage_id"):
        return entry["ghl_stage"], entry["ghl_stage_id"]
    return default_name, default_id


def _split_name(first: str, last: str, full: str) -> Tuple[str, str]:
    """Best-effort firstName/lastName resolution.

    Zoho data often has Full_Name set but First_Name empty (the entire name lands
    in Last_Name). Split intelligently:
      1. If first is set, return as-is.
      2. Else if Full_Name has a space, split on first space.
      3. Else if Last_Name has a space, split on first space.
      4. Else leave first empty (single-token name → all in lastName).
    """
    first = (first or "").strip()
    last = (last or "").strip()
    full = (full or "").strip()
    if first:
        return first, last
    source = full if " " in full else (last if " " in last else "")
    if source:
        head, _, tail = source.partition(" ")
        return head.strip(), tail.strip()
    return "", last


def map_contact(rec: dict, brand_cfg: dict) -> dict:
    """Map a cleaned Zoho contact/lead record to GHL contact payload."""
    first, last = _split_name(rec.get("First_Name"), rec.get("Last_Name"), rec.get("Full_Name"))

    # Phone: prefer already-normalized Phone, fall back to Mobile
    phone = rec.get("Phone") or rec.get("Mobile")

    # Tags: combine existing tags with brand-specific migration + source tags
    existing_tags = []
    raw_tags = rec.get("Tag", [])
    if isinstance(raw_tags, list):
        existing_tags = [t.get("name", t) if isinstance(t, dict) else str(t) for t in raw_tags]
    elif isinstance(raw_tags, str) and raw_tags:
        existing_tags = [raw_tags]

    tags = sorted(set(existing_tags + [brand_cfg["migration_tag"], brand_cfg["source_tag"]]))

    # Source
    lead_source = rec.get("Lead_Source") or rec.get("lead_source") or ""

    payload = {
        "firstName": first,
        "lastName": last,
        "email": rec.get("Email") or rec.get("email"),
        "phone": phone,
        "tags": tags,
        "source": lead_source,
        "customFields": [
            {"key": "zoho_id", "field_value": rec.get("id", "")},
            {"key": "zoho_source", "field_value": rec.get("_zoho_module", "Contacts")},
            {"key": "zoho_created_at", "field_value": rec.get("Created_Time", "")},
            {"key": "zoho_owner", "field_value": _owner_name(rec.get("Owner"))},
        ],
    }

    # Address
    street = rec.get("Mailing_Street") or rec.get("mailing_street") or ""
    city = rec.get("Mailing_City") or rec.get("mailing_city") or ""
    if street or city:
        payload["address1"] = street
        payload["city"] = city
        payload["country"] = "MT"

    return payload


def map_opportunity(deal: dict, stage_map: dict, contact_email_to_ghl_id: dict, pipeline_id: str) -> Optional[dict]:
    """Map a Zoho deal to a GHL opportunity payload."""
    contact_ref = deal.get("Contact_Name")
    contact_email = None
    if isinstance(contact_ref, dict):
        contact_email = contact_ref.get("email") or contact_ref.get("Email")
    elif isinstance(contact_ref, str):
        contact_email = contact_ref if "@" in contact_ref else None

    ghl_contact_id = contact_email_to_ghl_id.get((contact_email or "").lower())
    if not ghl_contact_id:
        return None

    stage_name, stage_id = map_stage(deal.get("Stage"), stage_map)

    return {
        "name": deal.get("Deal_Name") or deal.get("Name") or "Untitled Deal",
        "pipelineId": pipeline_id,
        "pipelineStageId": stage_id,
        "contactId": ghl_contact_id,
        "monetaryValue": _safe_float(deal.get("Amount")),
        "status": _deal_status(deal.get("Stage"), stage_map),
        "customFields": [
            {"key": "zoho_id", "field_value": deal.get("id", "")},
            {"key": "zoho_stage_original", "field_value": deal.get("Stage", "")},
        ],
    }


def map_note(note: dict, contact_email_to_ghl_id: dict) -> Optional[dict]:
    email = note.get("_contact_email", "")
    ghl_contact_id = contact_email_to_ghl_id.get(email.lower())
    if not ghl_contact_id:
        return None
    return {
        "contactId": ghl_contact_id,
        "body": note.get("Note_Content") or note.get("note_content") or "",
        "userId": "",
    }


def _owner_name(owner) -> str:
    if isinstance(owner, dict):
        return owner.get("name", "")
    return str(owner) if owner else ""


def _safe_float(val) -> float:
    try:
        return float(val) if val is not None else 0.0
    except (ValueError, TypeError):
        return 0.0


def _deal_status(zoho_stage, stage_map: dict) -> str:
    if not zoho_stage:
        return "open"
    entry = stage_map.get(zoho_stage, {})
    ghl_stage = entry.get("ghl_stage", "")
    if "Won" in ghl_stage:
        return "won"
    if "Lost" in ghl_stage:
        return "lost"
    return "open"


def build_zoho_id_to_email(contacts: list) -> dict:
    """Build a comprehensive map: every Zoho contact/lead id → canonical email.

    A merged-dedup contact has multiple Zoho ids in `_merged_from_ids`. Every
    one of them must resolve to the canonical record's email so deals/notes/tasks
    referencing the old id still link correctly.
    """
    out: dict = {}
    for rec in contacts:
        email = (rec.get("Email") or rec.get("email") or "").lower()
        if not email:
            continue
        for zid in [rec.get("id")] + (rec.get("_merged_from_ids") or []):
            if zid:
                out[str(zid)] = email
    return out


def _resolve_parent_email(child: dict, zid_to_email: dict, fields: tuple) -> str:
    """Look up a child record's parent contact email by trying ID fields in order."""
    for field in fields:
        ref = child.get(field)
        if isinstance(ref, dict):
            zid = ref.get("id")
            if zid and str(zid) in zid_to_email:
                return zid_to_email[str(zid)]
        elif isinstance(ref, str) and ref in zid_to_email:
            return zid_to_email[ref]
    return ""


def map_brand(brand: str) -> dict:
    print(f"\n{'='*50}")
    print(f"MAPPING: {brand.upper()}")
    print(f"{'='*50}")

    brand_cfg = get_brand(brand)
    cleaned_dir = TMP / brand / "02-cleaned"
    mapped_dir = TMP / brand / "03-mapped"
    ready_dir = TMP / brand / "04-ready"

    stage_map = load_stage_map(brand)
    pipeline_id = get_pipeline_id(stage_map) or ""

    # ── Map contacts ──────────────────────────────────────────────────────────
    contacts_path = cleaned_dir / "contacts_clean.json"
    if not contacts_path.exists():
        print(f"  [ERROR] {contacts_path} not found. Run data_cleaner first.")
        return {}

    contacts = load_json(contacts_path)
    ghl_contacts = [map_contact(r, brand_cfg) for r in contacts]
    save_json(ghl_contacts, ready_dir / "contacts_import.json")

    # Build email→index map (informational) and zoho_id→email lookup (used by deals/notes/tasks)
    email_index = {
        (r.get("Email") or r.get("email") or "").lower(): i
        for i, r in enumerate(contacts)
        if r.get("Email") or r.get("email")
    }
    save_json(email_index, mapped_dir / "email_to_contact_index.json")

    zid_to_email = build_zoho_id_to_email(contacts)
    save_json(zid_to_email, mapped_dir / "zoho_id_to_email.json")
    print(f"  Built zoho_id → email lookup: {len(zid_to_email)} ids → {len(set(zid_to_email.values()))} unique emails")

    # ── Pre-shape deals with stage + pipeline IDs from this brand's stage_map ─
    deals_path = cleaned_dir / "deals_clean.json"
    shaped_deals = []
    deal_resolved = 0
    if deals_path.exists():
        deals = load_json(deals_path)
        for deal in deals:
            stage_name, stage_id = map_stage(deal.get("Stage"), stage_map)
            parent_email = _resolve_parent_email(deal, zid_to_email, ("Contact_Name", "Account_Name"))
            if parent_email:
                deal_resolved += 1
            shaped_deals.append({
                **deal,
                "_contact_email": parent_email,
                "_ghl_stage_id": stage_id,
                "_ghl_stage_name": stage_name,
                "_ghl_pipeline_id": pipeline_id,
                "_ghl_status": _deal_status(deal.get("Stage"), stage_map),
            })
        save_json(shaped_deals, ready_dir / "deals_import.json")
        print(f"  Deals: {deal_resolved}/{len(shaped_deals)} resolved to a contact email")
    else:
        print("  [WARN] No deals_clean.json found")

    # ── Pass-through notes + tasks with parent email injected ─────────────────
    notes_path = cleaned_dir / "notes_clean.json"
    note_resolved = 0
    if notes_path.exists():
        notes = load_json(notes_path)
        shaped_notes = []
        for n in notes:
            parent_email = _resolve_parent_email(n, zid_to_email, ("Parent_Id",))
            if parent_email:
                note_resolved += 1
            shaped_notes.append({**n, "_contact_email": parent_email})
        save_json(shaped_notes, ready_dir / "notes_import.json")
        print(f"  Notes: {note_resolved}/{len(shaped_notes)} resolved to a contact email")

    # Build deal_zoho_id → contact_email for 2-hop resolution (tasks → deal → contact)
    deal_id_to_email = {}
    for d in shaped_deals:
        if d.get("_contact_email") and d.get("id"):
            deal_id_to_email[str(d["id"])] = d["_contact_email"]
    save_json(deal_id_to_email, mapped_dir / "deal_id_to_email.json")

    tasks_path = cleaned_dir / "tasks_clean.json"
    task_resolved = 0
    task_via_deal = 0
    if tasks_path.exists():
        tasks = load_json(tasks_path)
        shaped_tasks = []
        for t in tasks:
            # First try direct contact resolution
            parent_email = _resolve_parent_email(t, zid_to_email, ("Who_Id", "What_Id"))
            if not parent_email:
                # Fall back: What_Id → deal → contact
                what = t.get("What_Id")
                what_id = (what.get("id") if isinstance(what, dict) else what) if what else None
                if what_id and str(what_id) in deal_id_to_email:
                    parent_email = deal_id_to_email[str(what_id)]
                    task_via_deal += 1
            if parent_email:
                task_resolved += 1
            shaped_tasks.append({**t, "_contact_email": parent_email})
        save_json(shaped_tasks, ready_dir / "tasks_import.json")
        print(f"  Tasks: {task_resolved}/{len(shaped_tasks)} resolved (incl. {task_via_deal} via deal→contact)")

    summary = {
        "brand": brand,
        "location_id": brand_cfg["location_id"],
        "pipeline_id": pipeline_id,
        "contacts_mapped": len(ghl_contacts),
        "deals_mapped": len(shaped_deals),
    }
    print(f"\n  ✓ {brand} mapping complete: {summary}")
    return summary


if __name__ == "__main__":
    brand = sys.argv[1] if len(sys.argv) > 1 else "spa"
    map_brand(brand)
