"""
Generate MIGRATION_SUMMARY.md per brand: counts, stage breakdown, sample records,
and the APPROVAL.txt sentinel that gates Phase 4.

Usage:
    python -m Tools.migration.build_migration_summary --brand aesthetics
    python -m Tools.migration.build_migration_summary --brand slimming
"""
import argparse
import json
import random
from collections import Counter
from pathlib import Path

from Tools.migration.brand_config import get_brand

BASE = Path(__file__).parent.parent.parent
TMP = BASE / ".tmp" / "migration"


def fmt_money(n) -> str:
    try:
        return f"€{float(n):,.0f}"
    except (TypeError, ValueError):
        return "€0"


def build(brand: str) -> Path:
    cfg = get_brand(brand)
    bdir = TMP / brand
    ready = bdir / "04-ready"
    reports = bdir / "05-reports"
    mapped = bdir / "03-mapped"

    contacts = json.loads((ready / "contacts_import.json").read_text())
    deals = json.loads((ready / "deals_import.json").read_text()) if (ready / "deals_import.json").exists() else []
    notes = json.loads((ready / "notes_import.json").read_text()) if (ready / "notes_import.json").exists() else []
    tasks = json.loads((ready / "tasks_import.json").read_text()) if (ready / "tasks_import.json").exists() else []
    stage_map = json.loads((mapped / "stage_map.json").read_text())
    clean_summary = json.loads((reports / "clean_summary.json").read_text()) if (reports / "clean_summary.json").exists() else {}

    # Tag frequency (top 20)
    tag_counter: Counter = Counter()
    for c in contacts:
        for t in c.get("tags", []):
            tag_counter[t] += 1

    # Stage counts on mapped deals
    stage_counter: Counter = Counter(d.get("_ghl_stage_name", "(unmapped)") for d in deals)
    status_counter: Counter = Counter(d.get("_ghl_status", "open") for d in deals)
    deal_total_value = sum(float(d.get("Amount") or 0) for d in deals)
    deal_won_value = sum(float(d.get("Amount") or 0) for d in deals if d.get("_ghl_status") == "won")

    # 5 random contact samples
    rng = random.Random(42)
    sample_contacts = rng.sample(contacts, min(5, len(contacts)))

    lines = []
    lines.append(f"# Migration Summary — {brand.title()}")
    lines.append("")
    lines.append(f"**Generated:** auto, after `field_mapper.py {brand}`")
    lines.append(f"**Source:** Zoho CRM ({cfg['zoho_env']})")
    lines.append(f"**Target GHL location:** `{cfg['location_id']}`")
    lines.append(f"**Target pipeline:** `{stage_map.get('_ghl_pipeline_name')}` (`{stage_map.get('_ghl_pipeline_id')}`)")
    lines.append(f"**Migration tag:** `{cfg['migration_tag']}` · **Source tag:** `{cfg['source_tag']}`")
    lines.append("")
    lines.append("## Counts")
    lines.append("")
    lines.append(f"| Module       | Input (raw) | Cleaned/Mapped | Notes |")
    lines.append(f"|--------------|-------------|----------------|-------|")
    lines.append(f"| Contacts     | {clean_summary.get('input_contacts','?')} | {len(contacts)} | dedup + phone-only drop applied |")
    lines.append(f"| Leads        | {clean_summary.get('input_leads','?')} | merged into contacts | |")
    lines.append(f"| Deals        | {len(deals)} | {len(deals)} | mapped to '{stage_map.get('_ghl_pipeline_name')}' |")
    lines.append(f"| Notes        | {len(notes)} | {len(notes)} | |")
    lines.append(f"| Tasks        | {len(tasks)} | {len(tasks)} | stale tasks (>90d) auto-completed at import |")
    lines.append("")
    lines.append(f"**Drop reasons:**")
    lines.append(f"- Phone-only (no email): {clean_summary.get('dropped_phone_only', 0)}")
    lines.append(f"- No email, no phone: {clean_summary.get('dropped_no_contact', 0)}")
    lines.append(f"- Merged duplicates: {clean_summary.get('merged_duplicates', 0)}")
    lines.append("")
    lines.append("## Pipeline distribution (mapped deals)")
    lines.append("")
    lines.append("| GHL stage | Count | Status |")
    lines.append("|-----------|-------|--------|")
    for stage_name, count in stage_counter.most_common():
        # Find one deal in this stage to derive status
        ex_status = next((d.get("_ghl_status") for d in deals if d.get("_ghl_stage_name") == stage_name), "?")
        lines.append(f"| {stage_name} | {count:,} | {ex_status} |")
    lines.append("")
    lines.append(f"**Total deal value:** {fmt_money(deal_total_value)}  ·  **Won deals value:** {fmt_money(deal_won_value)}")
    lines.append("")
    lines.append("## Top 20 tags going to GHL")
    lines.append("")
    lines.append("| Tag | Count |")
    lines.append("|-----|-------|")
    for tag, c in tag_counter.most_common(20):
        lines.append(f"| `{tag}` | {c:,} |")
    lines.append("")
    lines.append("## Zoho stage → GHL stage map (sorted by Zoho count)")
    lines.append("")
    lines.append("| Zoho stage | Zoho count | GHL stage | Status |")
    lines.append("|------------|------------|-----------|--------|")
    rows = []
    for k, v in stage_map.items():
        if k.startswith("_") or not isinstance(v, dict):
            continue
        rows.append((v.get("_zoho_count", 0), k, v.get("ghl_stage", "?"), v.get("status", "?")))
    rows.sort(key=lambda r: -r[0])
    for cnt, zoho_stage, ghl_stage, status in rows:
        lines.append(f"| {zoho_stage} | {cnt:,} | {ghl_stage} | {status} |")
    lines.append("")
    lines.append("## Sample contacts (5 random)")
    lines.append("")
    for c in sample_contacts:
        cf = {f["key"]: f["field_value"] for f in c.get("customFields", [])}
        lines.append(f"- **{c.get('firstName')} {c.get('lastName')}** <{c.get('email')}>")
        lines.append(f"  - phone: `{c.get('phone')}` · source: `{c.get('source','-')}`")
        lines.append(f"  - tags: {', '.join(c.get('tags', []))}")
        lines.append(f"  - zoho_id: `{cf.get('zoho_id','')}` · zoho_source: `{cf.get('zoho_source','')}` · zoho_owner: `{cf.get('zoho_owner','')}`")
    lines.append("")
    lines.append("---")
    lines.append("")
    lines.append("## Approval gate")
    lines.append("")
    lines.append(f"To proceed with import to GHL location `{cfg['location_id']}`, replace the contents of `04-ready/APPROVAL.txt` with:")
    lines.append("")
    lines.append("```")
    lines.append(f"APPROVED YYYY-MM-DD <your initials>")
    lines.append("```")
    lines.append("")
    lines.append("Then run:")
    lines.append("```")
    lines.append(f"python -m Tools.migration.run_migration --phase import --brand {brand} --dry-run   # validate first")
    lines.append(f"python -m Tools.migration.run_migration --phase import --brand {brand}             # live import")
    lines.append("```")
    lines.append("")
    lines.append("## Rollback (one-liner)")
    lines.append(f"All migrated GHL records are tagged `{cfg['migration_tag']}` for mass rollback.")
    lines.append("")

    out = ready / "MIGRATION_SUMMARY.md"
    out.write_text("\n".join(lines), encoding="utf-8")

    # Pre-create APPROVAL.txt with the awaiting sentinel
    approval = ready / "APPROVAL.txt"
    if not approval.exists():
        approval.write_text(
            "AWAITING HUMAN APPROVAL\n"
            f"To approve, replace this file's contents with: APPROVED <YYYY-MM-DD> <initials>\n"
            f"Brand: {brand}\nLocation: {cfg['location_id']}\n"
        )

    print(f"  ✓ Wrote {out}")
    print(f"  ✓ APPROVAL.txt at {approval} (still awaiting approval)")
    return out


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--brand", required=True, choices=["spa", "aesthetics", "slimming"])
    args = ap.parse_args()
    build(args.brand)


if __name__ == "__main__":
    main()
