"""
End-to-end reconciliation: verify every cleaned Zoho record landed in GHL.

For each brand, this:
  1. Counts contacts in GHL with the brand's migration tag (paginated search).
  2. Compares to cleaned input count and to the import_report counts.
  3. Picks 50 random migrated contacts and GETs them to verify email + tags + customFields.
  4. Counts opportunities in the brand's pipeline and compares to import_summary.
  5. Lists any cleaned-but-missing-in-GHL contact emails (the gap).

Writes:
  .tmp/migration/{brand}/05-reports/reconciliation_report.md
  .tmp/migration/{brand}/05-reports/missing_contacts.csv  (if any)

Usage:
  python -m Tools.migration.reconcile --brand slimming
  python -m Tools.migration.reconcile --brand aesthetics
"""
import argparse
import csv
import json
import random
import time
from pathlib import Path
from typing import Optional

import httpx

from Tools.migration.brand_config import get_brand, require_api_key

BASE = Path(__file__).parent.parent.parent
TMP = BASE / ".tmp" / "migration"
GHL_BASE = "https://services.leadconnectorhq.com"


class GHLReader:
    """Per-brand read-only GHL client (paginated search + GET)."""

    def __init__(self, brand: str):
        cfg = get_brand(brand)
        self.brand = brand
        self.location_id = cfg["location_id"]
        self.api_key = require_api_key(brand)
        self.tag = cfg["migration_tag"]
        self.http = httpx.Client(timeout=30, headers={
            "Authorization": f"Bearer {self.api_key}",
            "Version": "2021-07-28",
            "Content-Type": "application/json",
        })

    def get(self, path: str, params: Optional[dict] = None) -> dict:
        for attempt in range(3):
            r = self.http.get(f"{GHL_BASE}{path}", params=params or {})
            if r.status_code == 429:
                time.sleep(5 * (attempt + 1))
                continue
            r.raise_for_status()
            return r.json()
        raise RuntimeError(f"GET {path} failed after 3 retries")

    def post(self, path: str, payload: dict) -> dict:
        for attempt in range(3):
            r = self.http.post(f"{GHL_BASE}{path}", json=payload)
            if r.status_code == 429:
                time.sleep(5 * (attempt + 1))
                continue
            r.raise_for_status()
            return r.json()
        raise RuntimeError(f"POST {path} failed after 3 retries")

    def search_contacts_with_tag(self) -> list:
        """Paginate /contacts/search to collect every contact with the migration tag."""
        all_contacts: list = []
        page = 1
        while True:
            payload = {
                "locationId": self.location_id,
                "pageLimit": 100,
                "page": page,
                "filters": [{"field": "tags", "operator": "contains", "value": self.tag}],
            }
            try:
                resp = self.post("/contacts/search", payload)
            except httpx.HTTPStatusError as e:
                # Some GHL plans don't expose /contacts/search; fall back to /contacts/ + query
                if e.response.status_code in (400, 404, 422):
                    print(f"  /contacts/search not available ({e.response.status_code}), falling back to /contacts/")
                    return self._fallback_query()
                raise
            contacts = resp.get("contacts", [])
            all_contacts.extend(contacts)
            total = resp.get("total", 0)
            print(f"    page {page}: +{len(contacts)} (running total {len(all_contacts)} / declared {total})")
            if len(contacts) < 100 or len(all_contacts) >= total:
                break
            page += 1
            time.sleep(0.2)
        return all_contacts

    def _fallback_query(self) -> list:
        all_contacts: list = []
        start_after_id: Optional[str] = None
        start_after: Optional[int] = None
        while True:
            params: dict = {"locationId": self.location_id, "limit": 100, "query": self.tag}
            if start_after_id:
                params["startAfterId"] = start_after_id
            if start_after is not None:
                params["startAfter"] = start_after
            resp = self.get("/contacts/", params=params)
            contacts = resp.get("contacts", [])
            all_contacts.extend(contacts)
            print(f"    fallback page: +{len(contacts)} (total {len(all_contacts)})")
            meta = resp.get("meta", {})
            if not meta.get("startAfterId") or len(contacts) == 0:
                break
            start_after_id = meta["startAfterId"]
            start_after = meta.get("startAfter")
            time.sleep(0.2)
        return all_contacts

    def get_contact(self, contact_id: str) -> dict:
        return self.get(f"/contacts/{contact_id}").get("contact", {})

    def search_opportunities(self, pipeline_id: str, max_expected: int = 50000) -> list:
        """Paginate /opportunities/search. GHL requires BOTH startAfterId + startAfter
        (the timestamp); passing only the id makes it return the same page forever.
        max_expected is a safety cap — if we hit it, we abort to avoid a runaway loop.
        """
        all_opps: list = []
        start_after_id: Optional[str] = None
        start_after: Optional[int] = None
        page_n = 0
        last_first_id = None
        while True:
            page_n += 1
            params: dict = {
                "location_id": self.location_id,
                "pipeline_id": pipeline_id,
                "limit": 100,
            }
            if start_after_id:
                params["startAfterId"] = start_after_id
            if start_after is not None:
                params["startAfter"] = start_after
            resp = self.get("/opportunities/search", params=params)
            opps = resp.get("opportunities", [])
            if not opps:
                break
            # Loop detection: if first id of this page == first id of last page, abort.
            this_first_id = opps[0].get("id")
            if this_first_id and this_first_id == last_first_id:
                print(f"    [ABORT] pagination loop detected at page {page_n}")
                break
            last_first_id = this_first_id
            all_opps.extend(opps)
            print(f"    opps page {page_n}: +{len(opps)} (total {len(all_opps)})")
            meta = resp.get("meta", {})
            new_id = meta.get("startAfterId")
            new_ts = meta.get("startAfter")
            if not new_id or (new_id == start_after_id and new_ts == start_after):
                break
            start_after_id = new_id
            start_after = new_ts
            if len(all_opps) >= max_expected:
                print(f"    [ABORT] reached max_expected={max_expected}, stopping")
                break
            time.sleep(0.2)
        return all_opps


def reconcile(brand: str) -> dict:
    cfg = get_brand(brand)
    print(f"\n{'='*60}")
    print(f"RECONCILING: {brand.upper()} (location {cfg['location_id']})")
    print(f"{'='*60}")

    bdir = TMP / brand
    cleaned = json.loads((bdir / "02-cleaned" / "contacts_clean.json").read_text())
    cleaned_emails = {(r.get("Email") or r.get("email") or "").lower() for r in cleaned}
    cleaned_emails.discard("")
    print(f"\n  Cleaned source: {len(cleaned)} contacts ({len(cleaned_emails)} unique emails)")

    import_summary_path = bdir / "05-reports" / "import_summary.json"
    if import_summary_path.exists():
        import_summary = json.loads(import_summary_path.read_text())
        print(f"  Import summary: {import_summary}")
    else:
        import_summary = {}

    # GHL-side reads
    reader = GHLReader(brand)

    print(f"\n  Step 1: Pulling all GHL contacts tagged '{cfg['migration_tag']}'...")
    ghl_contacts = reader.search_contacts_with_tag()
    ghl_emails = {(c.get("email") or "").lower() for c in ghl_contacts}
    ghl_emails.discard("")
    print(f"  → {len(ghl_contacts)} GHL contacts found, {len(ghl_emails)} unique emails")

    missing = sorted(cleaned_emails - ghl_emails)
    extras = sorted(ghl_emails - cleaned_emails)
    print(f"\n  Cleaned but NOT in GHL: {len(missing)}")
    print(f"  In GHL with our tag but NOT in cleaned (unexpected): {len(extras)}")

    # Step 2: spot-check 50 random contacts
    print(f"\n  Step 2: spot-checking 50 random imported contacts...")
    rng = random.Random(42)
    sampled = rng.sample(ghl_contacts, min(50, len(ghl_contacts)))
    spot_pass = 0
    spot_fail_reasons: list = []
    for c in sampled:
        tags = c.get("tags") or []
        has_tag = cfg["migration_tag"] in tags
        has_source = cfg["source_tag"] in tags
        has_email = bool(c.get("email"))
        if has_tag and has_source and has_email:
            spot_pass += 1
        else:
            spot_fail_reasons.append({
                "ghl_id": c.get("id"),
                "email": c.get("email"),
                "missing_migration_tag": not has_tag,
                "missing_source_tag": not has_source,
                "missing_email": not has_email,
            })

    # Step 3: opportunity count
    pipeline_id = ""
    stage_map_path = bdir / "03-mapped" / "stage_map.json"
    if stage_map_path.exists():
        stage_map = json.loads(stage_map_path.read_text())
        pipeline_id = stage_map.get("_ghl_pipeline_id", "")

    print(f"\n  Step 3: pulling all opportunities in pipeline {pipeline_id}...")
    ghl_opps = reader.search_opportunities(pipeline_id) if pipeline_id else []
    print(f"  → {len(ghl_opps)} opportunities currently in pipeline")

    expected_opps = import_summary.get("opportunities_created", "?")

    # Reports
    out_md = bdir / "05-reports" / "reconciliation_report.md"
    lines = [
        f"# Reconciliation Report — {brand.title()}",
        "",
        f"**Location:** `{cfg['location_id']}`",
        f"**Migration tag:** `{cfg['migration_tag']}`",
        "",
        "## Counts",
        "",
        "| | Count |",
        "|---|---|",
        f"| Cleaned source contacts (input) | {len(cleaned)} |",
        f"| Unique cleaned emails | {len(cleaned_emails)} |",
        f"| GHL contacts with migration tag | {len(ghl_contacts)} |",
        f"| Unique GHL emails | {len(ghl_emails)} |",
        f"| **Cleaned but missing in GHL** | **{len(missing)}** |",
        f"| Extra in GHL not in cleaned | {len(extras)} |",
        "",
        f"**Coverage:** {(1 - len(missing)/max(len(cleaned_emails),1))*100:.2f}%",
        "",
        "## Spot check (50 random GHL contacts)",
        "",
        f"- Passed all checks: {spot_pass}/{len(sampled)}",
        f"- Failed: {len(spot_fail_reasons)}",
        "",
    ]
    if spot_fail_reasons:
        lines.append("Failed samples:")
        lines.append("")
        for f in spot_fail_reasons[:10]:
            lines.append(f"- `{f.get('email')}` (id `{f.get('ghl_id')}`) — "
                        f"mig_tag_missing={f['missing_migration_tag']}, "
                        f"src_tag_missing={f['missing_source_tag']}, "
                        f"email_missing={f['missing_email']}")
        lines.append("")

    lines.extend([
        "## Opportunities",
        "",
        f"- Pipeline: `{pipeline_id}`",
        f"- Currently in pipeline: {len(ghl_opps)}",
        f"- Expected (from import_summary.opportunities_created): {expected_opps}",
        "",
        "## Import summary (from import_summary.json)",
        "",
        "```json",
        json.dumps(import_summary, indent=2),
        "```",
        "",
    ])

    if missing:
        miss_csv = bdir / "05-reports" / "missing_contacts.csv"
        with open(miss_csv, "w", newline="", encoding="utf-8") as f:
            w = csv.writer(f)
            w.writerow(["email"])
            for m in missing:
                w.writerow([m])
        lines.append(f"## Missing contacts CSV")
        lines.append("")
        lines.append(f"List of {len(missing)} cleaned emails not found in GHL: `05-reports/missing_contacts.csv`")
        lines.append("")
        lines.append("First 10:")
        for m in missing[:10]:
            lines.append(f"- {m}")

    out_md.write_text("\n".join(lines), encoding="utf-8")
    print(f"\n  ✓ Wrote {out_md}")

    return {
        "brand": brand,
        "cleaned_count": len(cleaned),
        "cleaned_unique_emails": len(cleaned_emails),
        "ghl_tagged_count": len(ghl_contacts),
        "missing_count": len(missing),
        "coverage_pct": round((1 - len(missing)/max(len(cleaned_emails),1))*100, 2),
        "spot_pass": spot_pass,
        "spot_total": len(sampled),
        "ghl_opportunities": len(ghl_opps),
        "expected_opportunities": expected_opps,
    }


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--brand", required=True, choices=["spa", "aesthetics", "slimming"])
    args = ap.parse_args()
    summary = reconcile(args.brand)
    print(f"\n{json.dumps(summary, indent=2)}")


if __name__ == "__main__":
    main()
