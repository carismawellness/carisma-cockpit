"""
WhatsApp Campaign Smart List Builder
-------------------------------------
Scans all contacts in the Carisma Spa GHL sub-account, applies quality
filters and scoring, then tags qualifying contacts:

  whatsapp-ready    → all qualifying contacts (Smart List anchor tag)
  whatsapp-tier-1   → score ≥ 70  (send first — highest quality)
  whatsapp-tier-2   → score 40–69 (send 48h later if block rate < 2%)

Hard filters (any failure = excluded):
  1. Phone is non-empty
  2. Phone normalises to +356XXXXXXXX (12 chars total)
  3. First digit after +356 is 7 or 9 (Maltese mobile only — 2 = landline)
  4. Not DND for SMS, WhatsApp, or All channels

Quality scoring (0–100):
  +30  Has firstName AND lastName (both non-empty)
  +25  Has email address
  +15  firstName is not a test/placeholder value
  +15  Has any non-empty custom field (treatment interest proxy)
  +15  dateAdded within last 365 days

Usage:
  python Tools/whatsapp_list_builder.py            # scan + tag
  DRY_RUN=true python Tools/whatsapp_list_builder.py  # scan only, no tags
  python Tools/whatsapp_list_builder.py --tag-only    # tag from checkpoint

Checkpoint: progress is saved to .tmp/whatsapp_checkpoint.json every 5,000
contacts so a timeout or crash can be resumed automatically.
"""

import json
import os
import re
import sys
import time
from datetime import datetime, timezone, timedelta
from pathlib import Path

PROJECT_ROOT = Path(__file__).parent.parent
sys.path.insert(0, str(PROJECT_ROOT))

from dotenv import load_dotenv
load_dotenv(PROJECT_ROOT / ".env")

import httpx
from CRM.ghl.client import GHLClient

DRY_RUN = os.getenv("DRY_RUN", "false").lower() in ("true", "1", "yes")
TAG_ONLY = "--tag-only" in sys.argv

CHECKPOINT_FILE = PROJECT_ROOT / ".tmp" / "whatsapp_checkpoint.json"
PHONE_RE = re.compile(r"^\+356[79]\d{7}$")
CUTOFF_DATE = datetime.now(timezone.utc) - timedelta(days=365)
TEST_NAMES = {"test", "testing", "tester", "n/a", "na", "xxx", "demo", "sample", "unknown"}

# ── Helpers ────────────────────────────────────────────────────────────────────

def normalize_phone(raw: str) -> str:
    if not raw:
        return ""
    p = re.sub(r"[\s\-\(\)\/\.]", "", raw.strip())
    if p.startswith("00356"):
        p = "+" + p[2:]
    elif re.match(r"^356[79]\d{7}$", p):
        p = "+" + p
    elif re.match(r"^[79]\d{7}$", p):
        p = "+356" + p
    elif re.match(r"^0[79]\d{7}$", p):
        p = "+356" + p[1:]
    return p


def is_dnd(contact: dict) -> bool:
    if contact.get("dnd") is True:
        return True
    dnd = contact.get("dndSettings") or {}
    for channel in ("SMS", "WhatsApp", "All", "sms", "whatsApp", "all"):
        if (dnd.get(channel) or {}).get("status") == "active":
            return True
    return False


def score_contact(contact: dict) -> int:
    score = 0
    first = (contact.get("firstName") or "").strip()
    last = (contact.get("lastName") or "").strip()
    email = (contact.get("email") or "").strip()

    if first and last:
        score += 30
    if email and "@" in email and "." in email.split("@")[-1]:
        score += 25
    if first and first.lower() not in TEST_NAMES and len(first) > 1:
        score += 15
    if any((cf.get("value") or "").strip() for cf in (contact.get("customFields") or [])):
        score += 15
    date_str = contact.get("dateAdded") or contact.get("createdAt") or ""
    if date_str:
        try:
            dt = datetime.fromisoformat(date_str.replace("Z", "+00:00"))
            if dt >= CUTOFF_DATE:
                score += 15
        except (ValueError, TypeError):
            pass
    return score


def save_checkpoint(state: dict) -> None:
    CHECKPOINT_FILE.parent.mkdir(parents=True, exist_ok=True)
    with open(CHECKPOINT_FILE, "w") as f:
        json.dump(state, f)


def load_checkpoint():
    if CHECKPOINT_FILE.exists():
        with open(CHECKPOINT_FILE) as f:
            return json.load(f)
    return None


def search_with_retry(client: GHLClient, start_after_id=None, start_after=None, max_retries: int = 5) -> dict:
    """Wrap search_contacts with retry on ReadTimeout/connection errors.

    GHL requires BOTH startAfterId and startAfter (Unix ms timestamp) for
    cursor pagination to advance. Without the timestamp, GHL returns page 1.
    """
    for attempt in range(max_retries):
        try:
            return client.search_contacts(
                limit=100,
                start_after_id=start_after_id,
                start_after=start_after,
            )
        except (httpx.ReadTimeout, httpx.ConnectTimeout, httpx.RemoteProtocolError) as exc:
            wait = 2 ** attempt
            print(f"  Network error ({type(exc).__name__}), retrying in {wait}s... (attempt {attempt+1}/{max_retries})")
            time.sleep(wait)
    raise RuntimeError(f"search_contacts failed after {max_retries} retries")


def add_tags(client: GHLClient, contact_id: str, tags: list[str]) -> None:
    client.post(f"/contacts/{contact_id}/tags", {"tags": tags})

# ── Main ───────────────────────────────────────────────────────────────────────

def run() -> None:
    client = GHLClient()
    mode = "[TAG ONLY]" if TAG_ONLY else ("[DRY RUN]" if DRY_RUN else "")
    print(f"{mode + ' ' if mode else ''}WhatsApp Campaign Smart List Builder")
    print(f"Location: {client.location_id} (Carisma Spa)\n")

    start_time = time.time()

    # ── Phase 1: Scan ──────────────────────────────────────────────────────────
    if not TAG_ONLY:
        # Resume from checkpoint if available
        checkpoint = load_checkpoint()
        if checkpoint and checkpoint.get("scan_complete"):
            print("Checkpoint found — scan already complete, loading results.")
            tier1_ids = checkpoint["tier1_ids"]
            tier2_ids = checkpoint["tier2_ids"]
            total_scanned = checkpoint["total_scanned"]
            counters = checkpoint["counters"]
        else:
            if checkpoint:
                print(f"Resuming from checkpoint at contact #{checkpoint['total_scanned']:,}...")
                tier1_ids = checkpoint["tier1_ids"]
                tier2_ids = checkpoint["tier2_ids"]
                total_scanned = checkpoint["total_scanned"]
                counters = checkpoint["counters"]
                start_after_id = checkpoint.get("start_after_id")
                start_after_ts = checkpoint.get("start_after_ts")
            else:
                tier1_ids = []
                tier2_ids = []
                total_scanned = 0
                counters = {"no_phone": 0, "not_maltese": 0, "landline": 0, "bad_fmt": 0, "dnd": 0, "low_score": 0}
                start_after_id = None
                start_after_ts = None

            # Get total from first page meta before starting loop
            _probe = client.search_contacts(limit=1)
            total_in_db = _probe.get("meta", {}).get("total", "?")
            print(f"Phase 1 — Scanning {total_in_db:,} contacts..." if isinstance(total_in_db, int) else f"Phase 1 — Scanning contacts (total unknown)...")

            start_after_ts = None  # Unix ms timestamp from meta.startAfter

            while True:
                time.sleep(0.4)  # stay under GHL rate limit (100 req/10s)
                resp = search_with_retry(client, start_after_id=start_after_id, start_after=start_after_ts)
                contacts = resp.get("contacts", [])
                if not contacts:
                    break

                for contact in contacts:
                    total_scanned += 1
                    cid = contact.get("id", "")

                    raw_phone = (contact.get("phone") or "").strip()
                    if not raw_phone:
                        counters["no_phone"] += 1
                        continue

                    phone = normalize_phone(raw_phone)
                    if not phone.startswith("+356"):
                        counters["not_maltese"] += 1
                        continue
                    if len(phone) != 12:
                        counters["bad_fmt"] += 1
                        continue
                    if phone[4] == "2":
                        counters["landline"] += 1
                        continue
                    if not PHONE_RE.match(phone):
                        counters["bad_fmt"] += 1
                        continue
                    if is_dnd(contact):
                        counters["dnd"] += 1
                        continue

                    score = score_contact(contact)
                    if score >= 70:
                        tier1_ids.append(cid)
                    elif score >= 40:
                        tier2_ids.append(cid)
                    else:
                        counters["low_score"] += 1

                if total_scanned % 1000 == 0:
                    elapsed = time.time() - start_time
                    print(f"  {total_scanned:,} scanned — Tier1: {len(tier1_ids):,}  Tier2: {len(tier2_ids):,}  ({elapsed:.0f}s)")

                if total_scanned % 5000 == 0:
                    save_checkpoint({
                        "scan_complete": False,
                        "total_scanned": total_scanned,
                        "tier1_ids": tier1_ids,
                        "tier2_ids": tier2_ids,
                        "counters": counters,
                        "start_after_id": start_after_id,
                        "start_after_ts": start_after_ts,
                    })

                meta = resp.get("meta", {})
                # GHL's nextPage field is unreliable; use startAfterId as the cursor signal
                next_cursor_id = meta.get("startAfterId")
                if not next_cursor_id or len(contacts) < 100:
                    break
                start_after_id = next_cursor_id
                start_after_ts = meta.get("startAfter")

            # Mark scan complete
            save_checkpoint({
                "scan_complete": True,
                "total_scanned": total_scanned,
                "tier1_ids": tier1_ids,
                "tier2_ids": tier2_ids,
                "counters": counters,
                "start_after_id": None,
            })
            elapsed_scan = time.time() - start_time
            print(f"\nScan complete: {total_scanned:,} contacts in {elapsed_scan:.0f}s")
    else:
        # TAG_ONLY: load from checkpoint
        checkpoint = load_checkpoint()
        if not checkpoint:
            print("ERROR: No checkpoint found. Run without --tag-only first.")
            sys.exit(1)
        tier1_ids = checkpoint["tier1_ids"]
        tier2_ids = checkpoint["tier2_ids"]
        total_scanned = checkpoint["total_scanned"]
        counters = checkpoint["counters"]

    # ── Phase 2: Tag ──────────────────────────────────────────────────────────
    total_qualify = len(tier1_ids) + len(tier2_ids)

    if DRY_RUN:
        print("\n[DRY RUN] Tagging skipped.")
    elif len(tier1_ids) > 0:
        # Only tag Tier 1 — highest quality contacts only
        print(f"\nPhase 2 — Tagging {len(tier1_ids):,} Tier 1 contacts (this will take ~{len(tier1_ids) * 0.15 / 60:.0f} min)...")
        tagged = 0
        errors = 0
        for cid in tier1_ids:
            time.sleep(0.15)
            try:
                add_tags(client, cid, ["whatsapp-ready", "whatsapp-tier-1"])
            except Exception:
                errors += 1
            tagged += 1
            if tagged % 500 == 0:
                elapsed_tag = time.time() - start_time
                print(f"  Tagged {tagged:,}/{len(tier1_ids):,}... ({elapsed_tag:.0f}s, {errors} errors)")
        print(f"Tagging done. {tagged:,} tagged, {errors} errors.")
        # Clear checkpoint after successful tagging
        CHECKPOINT_FILE.unlink(missing_ok=True)

    # ── Summary ────────────────────────────────────────────────────────────────
    elapsed = time.time() - start_time
    hard_fail = sum([counters["no_phone"], counters["not_maltese"], counters["landline"],
                     counters["bad_fmt"], counters["dnd"]])
    hard_pass = total_qualify + counters["low_score"]

    print(f"""
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
 WhatsApp Campaign Smart List — Summary
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
 Contacts scanned:         {total_scanned:>8,}
 Hard filter passed:       {hard_pass:>8,}
   Tier 1 (score ≥ 70):   {len(tier1_ids):>8,}  → whatsapp-ready + whatsapp-tier-1
   Tier 2 (score 40–69):  {len(tier2_ids):>8,}  → whatsapp-ready + whatsapp-tier-2
   Excluded (score < 40):  {counters['low_score']:>8,}
 Hard filter failed:       {hard_fail:>8,}
   No phone number:        {counters['no_phone']:>8,}
   Not Maltese (+356):     {counters['not_maltese']:>8,}
   Landline (+3562x):      {counters['landline']:>8,}
   Bad format:             {counters['bad_fmt']:>8,}
   DND (opted out):        {counters['dnd']:>8,}
{'─' * 49}
 {'[DRY RUN] No tags applied.' if DRY_RUN else f'Tags applied to {len(tier1_ids):,} Tier 1 contacts.'}
 Time elapsed:             {elapsed:.0f}s
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Next steps:
  1. In GHL → Contacts → Smart Lists → New List
     Filter: Tag is 'whatsapp-ready'
     Save as: 'WhatsApp Campaign Smart List'

  2. Send Tier 1 first. Use an approved WhatsApp template message.
     Cap at 500–1,000 sends/day the first week to build sender reputation.

  3. After 48h, check block rate in WhatsApp Business Manager.
     If block rate < 2%: proceed to send Tier 2.
     If block rate ≥ 2%: pause and review message content first.
""")


if __name__ == "__main__":
    run()
