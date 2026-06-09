"""
Zoho CRM extractor — pulls all records from a brand's Zoho CRM via MCP tools
and writes them to .tmp/migration/{brand}/01-raw/.

Usage:
    from Tools.migration.zoho_extractor import extract_brand
    extract_brand("spa")    # uses mcp__zoho-crm-spa__* tools
    extract_brand("aesthetics")
    extract_brand("slimming")

Since this runs inside Claude Code (MCP context), extraction is done by
calling the appropriate MCP list/note tools rather than direct HTTP.
The script produces JSON files consumable by data_cleaner.py.
"""
import json
import os
from pathlib import Path

BASE = Path(__file__).parent.parent.parent
TMP = BASE / ".tmp" / "migration"


def get_output_dir(brand: str) -> Path:
    d = TMP / brand / "01-raw"
    d.mkdir(parents=True, exist_ok=True)
    return d


def save_json(data: list | dict, path: Path) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with open(path, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=2)
    print(f"  Saved {len(data) if isinstance(data, list) else 1} records → {path.name}")


def load_json(path: Path) -> list | dict | None:
    if path.exists():
        with open(path, encoding="utf-8") as f:
            return json.load(f)
    return None


def merge_pages(existing: list | None, new_page: list) -> list:
    if existing is None:
        return new_page
    return existing + new_page


# ── Extraction helpers called by Claude Code directly ──────────────────────────

def save_contacts_page(brand: str, records: list, page: int) -> dict:
    """Save a page of contacts. Call this after each mcp__zoho-crm-{brand}__zoho_list_records response."""
    out_dir = get_output_dir(brand)
    page_file = out_dir / f"contacts_page_{page:03d}.json"
    save_json(records, page_file)
    return {"brand": brand, "module": "Contacts", "page": page, "count": len(records)}


def save_leads_page(brand: str, records: list, page: int) -> dict:
    out_dir = get_output_dir(brand)
    page_file = out_dir / f"leads_page_{page:03d}.json"
    save_json(records, page_file)
    return {"brand": brand, "module": "Leads", "page": page, "count": len(records)}


def save_deals_page(brand: str, records: list, page: int) -> dict:
    out_dir = get_output_dir(brand)
    page_file = out_dir / f"deals_page_{page:03d}.json"
    save_json(records, page_file)
    return {"brand": brand, "module": "Deals", "page": page, "count": len(records)}


def consolidate_pages(brand: str, module: str) -> Path:
    """
    After all pages are saved, merge page files into a single module file.
    E.g. contacts_page_001.json + contacts_page_002.json → contacts.json
    """
    out_dir = get_output_dir(brand)
    prefix = module.lower().rstrip("s")  # contacts→contact, leads→lead, deals→deal
    module_lower = module.lower()

    page_files = sorted(out_dir.glob(f"{module_lower[:-1]}s_page_*.json"))
    if not page_files:
        # Try singular
        page_files = sorted(out_dir.glob(f"{module_lower}_page_*.json"))

    all_records = []
    for pf in page_files:
        with open(pf) as f:
            all_records.extend(json.load(f))

    out_file = out_dir / f"{module_lower}.json"
    save_json(all_records, out_file)

    # Clean up page files
    for pf in page_files:
        pf.unlink()

    print(f"  [{brand}] {module}: {len(all_records)} total records → {out_file.name}")
    return out_file


def save_notes(brand: str, notes: list) -> Path:
    out_dir = get_output_dir(brand)
    out_file = out_dir / "notes.json"
    existing = load_json(out_file) or []
    save_json(existing + notes, out_file)
    return out_file


def save_tasks(brand: str, tasks: list) -> Path:
    out_dir = get_output_dir(brand)
    out_file = out_dir / "tasks.json"
    existing = load_json(out_file) or []
    save_json(existing + tasks, out_file)
    return out_file


def save_tags(brand: str, tags: list) -> Path:
    out_dir = get_output_dir(brand)
    out_file = out_dir / "tags.json"
    save_json(tags, out_file)
    return out_file


def save_users(brand: str, users: list) -> Path:
    out_dir = get_output_dir(brand)
    out_file = out_dir / "users.json"
    save_json(users, out_file)
    return out_file


def extraction_summary(brand: str) -> dict:
    """Print a summary of what was extracted for a brand."""
    out_dir = get_output_dir(brand)
    summary = {"brand": brand, "modules": {}}
    for module_file in ["contacts.json", "leads.json", "deals.json", "notes.json", "tasks.json", "tags.json"]:
        path = out_dir / module_file
        if path.exists():
            with open(path) as f:
                data = json.load(f)
            count = len(data) if isinstance(data, list) else 1
            summary["modules"][module_file.replace(".json", "")] = count
        else:
            summary["modules"][module_file.replace(".json", "")] = 0
    return summary


# ── Extraction instruction generator ──────────────────────────────────────────

def print_extraction_plan(brand: str) -> None:
    """Print the MCP calls needed to extract a brand. Run this to get the call sequence."""
    mcp = f"mcp__zoho-crm-{brand}__"
    print(f"\n{'='*60}")
    print(f"EXTRACTION PLAN FOR: {brand.upper()}")
    print(f"{'='*60}")
    print(f"Step 1 — Contacts (paginate until count < 200):")
    print(f"  {mcp}zoho_list_records(module='Contacts', per_page=200, page=1)")
    print(f"  → save_contacts_page('{brand}', records, 1)")
    print(f"  Repeat with page=2,3,... until len(records) < 200")
    print(f"\nStep 2 — Leads (unconverted):")
    print(f"  {mcp}zoho_list_records(module='Leads', per_page=200, page=1)")
    print(f"  → save_leads_page('{brand}', records, 1)")
    print(f"\nStep 3 — Deals:")
    print(f"  {mcp}zoho_list_records(module='Deals', per_page=200, page=1)")
    print(f"  → save_deals_page('{brand}', records, 1)")
    print(f"\nStep 4 — Notes:")
    print(f"  {mcp}zoho_list_notes(module='Contacts', per_page=200, page=1)")
    print(f"  → save_notes('{brand}', notes)")
    print(f"\nStep 5 — Tasks (via Activities):")
    print(f"  {mcp}zoho_list_records(module='Tasks', per_page=200, page=1)")
    print(f"  → save_tasks('{brand}', tasks)")
    print(f"\nStep 6 — Tags:")
    print(f"  {mcp}zoho_list_tags(module='Contacts')")
    print(f"  → save_tags('{brand}', tags)")
    print(f"\nStep 7 — Users:")
    print(f"  {mcp}zoho_list_users()")
    print(f"  → save_users('{brand}', users)")
    print(f"\nStep 8 — Consolidate pages:")
    print(f"  consolidate_pages('{brand}', 'Contacts')")
    print(f"  consolidate_pages('{brand}', 'Leads')")
    print(f"  consolidate_pages('{brand}', 'Deals')")


if __name__ == "__main__":
    import sys
    brand = sys.argv[1] if len(sys.argv) > 1 else "spa"
    print_extraction_plan(brand)
    print(f"\nExtraction summary for {brand}:")
    print(json.dumps(extraction_summary(brand), indent=2))
