"""
Remove the `to-do` tag from every contact that has BOTH `to-do` AND a Zoho
migration tag (`zoho_migrated_2026_04` or `zoho_migrated_2026_05`).

Runs across all three brands: Spa, Aesthetics, Slimming.
This empties the "TO DOs" smart list of migrated-Zoho contacts so setters
stop seeing them as fresh tasks.

Dry-run by default; --execute to apply.
"""

from __future__ import annotations

import argparse
import json
import os
import time
from pathlib import Path

import httpx

BASE = "https://services.leadconnectorhq.com"
ROOT = Path(__file__).resolve().parent.parent
TMP = ROOT / ".tmp"
TMP.mkdir(exist_ok=True)

MIGRATION_TAGS = ["zoho_migrated_2026_04", "zoho_migrated_2026_05"]
TODO_TAG = "to-do"

BRANDS = {
    "Spa":        {"location_id": "TrtSnBSSKBOkVVNxJ3AM", "env_key": "GHL_API_KEY"},
    "Aesthetics": {"location_id": "Goi7kzVK7iwe2woxUHkT", "env_key": "GHL_API_KEY_AESTHETICS"},
    "Slimming":   {"location_id": "imWIWDcnmOfijW0lltPq", "env_key": "GHL_API_KEY_SLIMMING"},
}


def load_env() -> None:
    for line in (ROOT / ".env").read_text().splitlines():
        if "=" in line and not line.strip().startswith("#"):
            k, _, v = line.partition("=")
            os.environ.setdefault(k.strip(), v.strip())


def hdr(token: str) -> dict:
    return {
        "Authorization": f"Bearer {token}",
        "Version": "2021-07-28",
        "Accept": "application/json",
        "Content-Type": "application/json",
    }


def search_contacts(token: str, location_id: str, mig_tag: str) -> list[dict]:
    """Page through contacts where tags contain both TODO_TAG and mig_tag."""
    out: list[dict] = []
    search_after: list | None = None
    page = 1
    while True:
        body = {
            "locationId": location_id,
            "pageLimit": 100,
            "filters": [
                {"field": "tags", "operator": "contains", "value": TODO_TAG},
                {"field": "tags", "operator": "contains", "value": mig_tag},
            ],
        }
        if search_after:
            body["searchAfter"] = search_after
        for attempt in range(5):
            r = httpx.post(f"{BASE}/contacts/search", headers=hdr(token), json=body, timeout=60)
            if r.status_code == 429:
                time.sleep(2 ** attempt); continue
            r.raise_for_status()
            break
        else:
            raise RuntimeError("contacts/search retries exhausted")
        data = r.json()
        batch = data.get("contacts", [])
        out.extend(batch)
        if len(batch) < 100:
            break
        # GHL v2 uses sort tuple from last result
        last = batch[-1]
        search_after = last.get("searchAfter") or [last.get("dateAdded"), last.get("id")]
        page += 1
        if page > 500:
            print("  WARN: page guard hit"); break
    return out


def remove_tag(token: str, contact_id: str, tag: str) -> tuple[int, str]:
    body = {"tags": [tag]}
    for attempt in range(6):
        try:
            r = httpx.request(
                "DELETE", f"{BASE}/contacts/{contact_id}/tags",
                headers=hdr(token), json=body, timeout=30,
            )
        except (httpx.ReadTimeout, httpx.ConnectTimeout, httpx.RemoteProtocolError,
                httpx.ConnectError) as e:
            wait = 2 ** attempt
            print(f"    network error on {contact_id} ({e!r}); sleep {wait}s")
            time.sleep(wait); continue
        if r.status_code == 429:
            time.sleep(2 ** attempt); continue
        return r.status_code, r.text[:200]
    return 599, "max retries"


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--execute", action="store_true")
    args = parser.parse_args()
    load_env()

    print("Scanning all brands for contacts with `to-do` + migration tag...\n")
    by_brand: dict[str, dict] = {}
    for brand, cfg in BRANDS.items():
        token = os.environ[cfg["env_key"]]
        contacts_by_id: dict[str, dict] = {}
        for tag in MIGRATION_TAGS:
            batch = search_contacts(token, cfg["location_id"], tag)
            for c in batch:
                contacts_by_id[c["id"]] = c
            print(f"  [{brand}] tag={tag!r:30s} → {len(batch)} contacts")
        by_brand[brand] = contacts_by_id
        manifest = [{"id": c["id"], "name": c.get("contactName"),
                     "email": c.get("email"), "tags": c.get("tags")}
                    for c in contacts_by_id.values()]
        path = TMP / f"ghl_todo_migration_{brand.lower()}.json"
        path.write_text(json.dumps(manifest, indent=2))
        print(f"  [{brand}] TOTAL unique contacts: {len(contacts_by_id)} → {path}\n")

    grand_total = sum(len(v) for v in by_brand.values())
    print(f"\n=== GRAND TOTAL: {grand_total} contacts will have `to-do` tag removed ===")

    if not args.execute:
        print("\nDRY RUN. Re-run with --execute to apply.")
        return

    print("\n=== EXECUTING — removing `to-do` tag ===")
    for brand, cfg in BRANDS.items():
        contacts = by_brand[brand]
        token = os.environ[cfg["env_key"]]
        print(f"\n  [{brand}] removing tag from {len(contacts)} contacts...")
        ok = fail = 0
        for i, cid in enumerate(contacts, 1):
            status, body = remove_tag(token, cid, TODO_TAG)
            if 200 <= status < 300:
                ok += 1
            else:
                fail += 1
                if fail <= 5:
                    print(f"    FAIL {cid} → HTTP {status} {body}")
            if i % 200 == 0:
                print(f"    [{brand}] progress {i}/{len(contacts)}  ok={ok} fail={fail}")
        print(f"  [{brand}] DONE: ok={ok} fail={fail}")

    # Verify
    print("\n=== Verifying ===")
    for brand, cfg in BRANDS.items():
        token = os.environ[cfg["env_key"]]
        remaining_total = 0
        for tag in MIGRATION_TAGS:
            r = httpx.post(f"{BASE}/contacts/search",
                           headers=hdr(token),
                           json={"locationId": cfg["location_id"], "pageLimit": 1,
                                 "filters": [
                                     {"field": "tags", "operator": "contains", "value": TODO_TAG},
                                     {"field": "tags", "operator": "contains", "value": tag},
                                 ]},
                           timeout=30)
            remaining_total += r.json().get("total", 0)
        print(f"  [{brand}] contacts with both `to-do` + any migration tag still: {remaining_total}")


if __name__ == "__main__":
    main()
