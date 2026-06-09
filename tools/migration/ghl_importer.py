"""
GHL importer: batched upsert of contacts, opportunities, notes to GoHighLevel.
Per-brand: each brand has its own GHL location ID + Private Integration Token.
Uses token-bucket rate limiting (90 req / 10s, GHL's documented limit is 100/10s).

Usage:
    python -m Tools.migration.ghl_importer spa --dry-run
    python -m Tools.migration.ghl_importer aesthetics
    python -m Tools.migration.ghl_importer slimming
"""
import json
import sys
import time
from pathlib import Path

from Tools.migration.brand_config import get_brand, require_api_key

BASE = Path(__file__).parent.parent.parent
TMP = BASE / ".tmp" / "migration"
GHL_BASE_URL = "https://services.leadconnectorhq.com"


# ── Token bucket rate limiter ─────────────────────────────────────────────────

class TokenBucket:
    """Allow max_tokens requests per window_seconds."""
    def __init__(self, max_tokens: int = 90, window_seconds: float = 10.0):
        self.max_tokens = max_tokens
        self.window_seconds = window_seconds
        self.tokens = max_tokens
        self.last_refill = time.monotonic()

    def consume(self, n: int = 1) -> None:
        while True:
            now = time.monotonic()
            elapsed = now - self.last_refill
            if elapsed >= self.window_seconds:
                self.tokens = self.max_tokens
                self.last_refill = now
            if self.tokens >= n:
                self.tokens -= n
                return
            sleep_for = self.window_seconds - (time.monotonic() - self.last_refill)
            time.sleep(max(sleep_for, 0.05))


from typing import Optional, Tuple


class BrandImporter:
    """Per-brand GHL HTTP client + import operations.

    Holds the location-scoped Bearer token + locationId so a single process
    can host one brand at a time without leaking state between runs.
    """

    def __init__(self, brand: str, dry_run: bool = False):
        cfg = get_brand(brand)
        self.brand = brand
        self.location_id = cfg["location_id"]
        self.api_key = require_api_key(brand)
        self.dry_run = dry_run
        self.bucket = TokenBucket(max_tokens=90, window_seconds=10.0)

    def _headers(self) -> dict:
        return {
            "Authorization": f"Bearer {self.api_key}",
            "Content-Type": "application/json",
            "Version": "2021-07-28",
        }

    def post(self, path: str, payload: dict) -> dict:
        import httpx
        if self.dry_run:
            return {"id": f"dry_run_{hash(str(payload)) % 100000}", "_dry_run": True}
        for attempt in range(4):
            try:
                self.bucket.consume()
                resp = httpx.post(f"{GHL_BASE_URL}{path}", json=payload, headers=self._headers(), timeout=30)
                if resp.status_code == 429:
                    time.sleep(10 * (attempt + 1))
                    continue
                resp.raise_for_status()
                return resp.json()
            except httpx.TransportError:
                if attempt == 3:
                    raise
                time.sleep(5 * (attempt + 1))
        raise RuntimeError("Max retries exceeded")

    def upsert_contact(self, payload: dict) -> Tuple[Optional[str], str]:
        email = payload.get("email")
        if not email:
            return None, "skipped_no_email"

        upsert_payload = {
            "locationId": self.location_id,
            "email": email,
            "firstName": payload.get("firstName", ""),
            "lastName": payload.get("lastName", ""),
            "tags": payload.get("tags", []),
            "source": payload.get("source", ""),
        }
        if payload.get("phone"):
            upsert_payload["phone"] = payload["phone"]
        if payload.get("address1"):
            upsert_payload["address1"] = payload["address1"]
            upsert_payload["city"] = payload.get("city", "")
            upsert_payload["country"] = payload.get("country", "MT")
        if payload.get("customFields"):
            upsert_payload["customFields"] = payload["customFields"]

        try:
            result = self.post("/contacts/upsert", upsert_payload)
            contact_id = result.get("contact", {}).get("id") or result.get("id")
            status = "updated" if result.get("contact", {}).get("dateUpdated") else "created"
            return contact_id, status
        except Exception as e:
            return None, f"error:{e}"

    def create_opportunity(self, payload: dict) -> Tuple[Optional[str], str]:
        try:
            opp_payload = {
                "locationId": self.location_id,
                "name": payload["name"],
                "pipelineId": payload["pipelineId"],
                "pipelineStageId": payload["pipelineStageId"],
                "contactId": payload["contactId"],
                "status": payload.get("status", "open"),
                "monetaryValue": payload.get("monetaryValue", 0),
            }
            result = self.post("/opportunities/", opp_payload)
            opp_id = result.get("opportunity", {}).get("id") or result.get("id")
            return opp_id, "created"
        except Exception as e:
            return None, f"error:{e}"

    def create_note(self, contact_id: str, body: str) -> Tuple[Optional[str], str]:
        if not body or not body.strip():
            return None, "skipped_empty"
        try:
            result = self.post(f"/contacts/{contact_id}/notes", {"body": body})
            note_id = result.get("note", {}).get("id") or result.get("id")
            return note_id, "created"
        except Exception as e:
            return None, f"error:{e}"


# ── Main import orchestrator ──────────────────────────────────────────────────

def import_brand(brand: str, dry_run: bool = False) -> dict:
    print(f"\n{'='*50}")
    print(f"IMPORTING: {brand.upper()}" + (" [DRY RUN]" if dry_run else " [LIVE]"))
    print(f"{'='*50}")

    ready_dir = TMP / brand / "04-ready"
    reports_dir = TMP / brand / "05-reports"
    reports_dir.mkdir(parents=True, exist_ok=True)

    # ── Phase A: Contacts ─────────────────────────────────────────────────────
    contacts_file = ready_dir / "contacts_import.json"
    if not contacts_file.exists():
        print(f"  [ERROR] {contacts_file} not found. Run field_mapper first.")
        return {}

    importer = BrandImporter(brand, dry_run=dry_run)
    print(f"  location_id={importer.location_id} dry_run={dry_run}")

    contacts = json.loads(contacts_file.read_text(encoding="utf-8"))
    email_to_ghl_id: dict = {}
    import_results = []

    print(f"\n  Importing {len(contacts)} contacts...")
    for i, contact in enumerate(contacts):
        ghl_id, status = importer.upsert_contact(contact)
        email = (contact.get("email") or "").lower()
        if ghl_id and email:
            email_to_ghl_id[email] = ghl_id
        import_results.append({
            "zoho_id": next((f["field_value"] for f in contact.get("customFields", []) if f["key"] == "zoho_id"), ""),
            "email": email,
            "ghl_id": ghl_id,
            "status": status,
        })
        if (i + 1) % 50 == 0:
            print(f"    {i+1}/{len(contacts)} contacts processed...")

    # Save email→GHL ID map for deal/note linking
    id_map_path = TMP / brand / "03-mapped" / "email_to_ghl_id.json"
    id_map_path.parent.mkdir(parents=True, exist_ok=True)
    id_map_path.write_text(json.dumps(email_to_ghl_id, indent=2), encoding="utf-8")

    # Save contact import report
    import csv
    with open(reports_dir / "contact_import_report.csv", "w", newline="", encoding="utf-8") as f:
        w = csv.DictWriter(f, fieldnames=["zoho_id", "email", "ghl_id", "status"])
        w.writeheader()
        w.writerows(import_results)

    created = sum(1 for r in import_results if r["status"] == "created")
    updated = sum(1 for r in import_results if r["status"] == "updated")
    errors = sum(1 for r in import_results if r["status"].startswith("error"))
    print(f"  Contacts: {created} created, {updated} updated, {errors} errors")

    # ── Phase B: Opportunities ────────────────────────────────────────────────
    deals_file = ready_dir / "deals_import.json"
    opp_results = []
    if deals_file.exists():
        deals = json.loads(deals_file.read_text(encoding="utf-8"))
        print(f"\n  Importing {len(deals)} opportunities...")
        skipped_no_contact = 0
        for i, deal in enumerate(deals):
            contact_email = (deal.get("_contact_email") or "").lower()
            ghl_contact_id = email_to_ghl_id.get(contact_email)
            if not ghl_contact_id:
                skipped_no_contact += 1
                opp_results.append({"zoho_id": deal.get("id"), "status": "skipped_no_contact_match"})
                continue

            pipe_id = deal.get("_ghl_pipeline_id")
            stage_id = deal.get("_ghl_stage_id")
            if not pipe_id or not stage_id:
                opp_results.append({"zoho_id": deal.get("id"), "status": "skipped_no_pipeline_id"})
                continue

            opp_payload = {
                "name": deal.get("Deal_Name") or "Untitled Deal",
                "pipelineId": pipe_id,
                "pipelineStageId": stage_id,
                "contactId": ghl_contact_id,
                "status": deal.get("_ghl_status", "open"),
                "monetaryValue": float(deal.get("Amount") or 0),
            }
            opp_id, status = importer.create_opportunity(opp_payload)
            opp_results.append({"zoho_id": deal.get("id"), "ghl_id": opp_id, "status": status})
            if (i + 1) % 200 == 0:
                print(f"    {i+1}/{len(deals)} deals processed...")

        print(f"  Opportunities: {sum(1 for r in opp_results if r['status'] == 'created')} created, "
              f"{skipped_no_contact} skipped (no contact match), "
              f"{sum(1 for r in opp_results if r['status'].startswith('error'))} errors")
        # Persist per-deal report
        import csv as _csv
        with open(reports_dir / "opportunity_import_report.csv", "w", newline="", encoding="utf-8") as f:
            w = _csv.DictWriter(f, fieldnames=["zoho_id", "ghl_id", "status"])
            w.writeheader()
            for r in opp_results:
                w.writerow({"zoho_id": r.get("zoho_id"), "ghl_id": r.get("ghl_id", ""), "status": r.get("status")})

    # ── Phase C: Notes ────────────────────────────────────────────────────────
    notes_file = ready_dir / "notes_import.json"
    note_count = 0
    note_skipped = 0
    if notes_file.exists():
        notes = json.loads(notes_file.read_text(encoding="utf-8"))
        print(f"\n  Importing {len(notes)} notes...")
        for note in notes:
            parent_email = (note.get("_contact_email") or "").lower()
            ghl_contact_id = email_to_ghl_id.get(parent_email)
            if not ghl_contact_id:
                note_skipped += 1
                continue
            body = note.get("Note_Content") or note.get("note_content") or ""
            _, status = importer.create_note(ghl_contact_id, body)
            if status == "created":
                note_count += 1
        print(f"  Notes: {note_count} created, {note_skipped} skipped (no parent contact)")

    # ── Phase D: Tasks ────────────────────────────────────────────────────────
    tasks_file = ready_dir / "tasks_import.json"
    task_count = 0
    task_skipped = 0
    if tasks_file.exists():
        tasks = json.loads(tasks_file.read_text(encoding="utf-8"))
        print(f"\n  Importing {len(tasks)} tasks...")
        from datetime import datetime, timezone, timedelta
        cutoff = datetime.now(timezone.utc) - timedelta(days=90)
        for t in tasks:
            parent_email = (t.get("_contact_email") or "").lower()
            ghl_contact_id = email_to_ghl_id.get(parent_email)
            if not ghl_contact_id:
                task_skipped += 1
                continue
            title = t.get("Subject") or "(untitled task)"
            body = t.get("Description") or ""
            due_raw = t.get("Due_Date") or t.get("Closed_Time") or t.get("Created_Time")
            # Auto-complete stale (>90d) open tasks per migration spec
            zoho_status = (t.get("Status") or "").lower()
            completed = zoho_status in ("completed", "closed")
            if not completed and due_raw:
                try:
                    due_dt = datetime.fromisoformat(due_raw[:25].replace("Z", "+00:00"))
                    if due_dt < cutoff:
                        completed = True
                except (ValueError, TypeError):
                    pass
            payload = {"title": title, "body": body, "completed": completed}
            if due_raw:
                payload["dueDate"] = due_raw
            try:
                importer.post(f"/contacts/{ghl_contact_id}/tasks", payload)
                task_count += 1
            except Exception:
                task_skipped += 1
        print(f"  Tasks: {task_count} created, {task_skipped} skipped")

    summary = {
        "brand": brand,
        "dry_run": dry_run,
        "contacts_created": created,
        "contacts_updated": updated,
        "contacts_errors": errors,
        "opportunities_created": sum(1 for r in opp_results if r["status"] == "created"),
        "opportunities_skipped_no_contact": sum(1 for r in opp_results if r["status"] == "skipped_no_contact_match"),
        "notes_created": note_count,
        "notes_skipped": note_skipped,
        "tasks_created": task_count,
        "tasks_skipped": task_skipped,
    }

    (reports_dir / "import_summary.json").write_text(json.dumps(summary, indent=2), encoding="utf-8")
    print(f"\n  ✓ Import complete: {summary}")
    return summary


if __name__ == "__main__":
    brand = sys.argv[1] if len(sys.argv) > 1 else "spa"
    dry_run = "--dry-run" in sys.argv
    import_brand(brand, dry_run=dry_run)
