"""
Klaviyo Unengaged Suppression Tool
-----------------------------------
Scans ALL account profiles, finds those NOT in 90D_Engaged,
and suppresses them to reduce billable contacts.

Usage:
  python Tools/klaviyo_suppress_unengaged.py --dry-run   # preview only
  python Tools/klaviyo_suppress_unengaged.py             # run suppression
"""

import os
import time
import argparse
import requests
from dotenv import load_dotenv

load_dotenv()

API_KEY = os.environ["KLAVIYO_PRIVATE_API_KEY"]
SEGMENT_NAME = "90D_Engaged"
SEGMENT_ID = "RutKek"
REVISION = "2024-10-15"

HEADERS = {
    "Authorization": f"Klaviyo-API-Key {API_KEY}",
    "revision": REVISION,
    "accept": "application/json",
    "content-type": "application/json",
}

BASE_URL = "https://a.klaviyo.com/api"


def req_with_retry(method, url, retries=5, **kwargs):
    """HTTP request with exponential backoff on any error."""
    for attempt in range(retries):
        try:
            r = requests.request(method, url, headers=HEADERS, timeout=30, **kwargs)
            r.raise_for_status()
            return r
        except Exception as e:
            if attempt < retries - 1:
                wait = (attempt + 1) * 4
                print(f"\n  Retry {attempt+1}/{retries} after {wait}s: {type(e).__name__}")
                time.sleep(wait)
            else:
                raise


def get_all_emails_from_segment(segment_id):
    """Paginate through a segment and return all profile emails."""
    emails = set()
    url = f"{BASE_URL}/segments/{segment_id}/profiles/"
    params = {"fields[profile]": "email", "page[size]": 100}

    print(f"  Fetching 90D_Engaged profiles...", end="", flush=True)
    while url:
        r = req_with_retry("GET", url, params=params)
        data = r.json()
        for profile in data.get("data", []):
            email = profile.get("attributes", {}).get("email")
            if email:
                emails.add(email.lower())
        print(f"\r  Fetching 90D_Engaged profiles... {len(emails):,}", end="", flush=True)
        url = data.get("links", {}).get("next")
        params = {}
        if url:
            time.sleep(0.1)
    print()
    return emails


def get_all_account_emails():
    """Paginate through ALL account profiles and return emails."""
    emails = set()
    url = f"{BASE_URL}/profiles/"
    params = {"fields[profile]": "email", "page[size]": 100}

    print(f"  Scanning all account profiles...", end="", flush=True)
    while url:
        r = req_with_retry("GET", url, params=params)
        data = r.json()
        for profile in data.get("data", []):
            email = profile.get("attributes", {}).get("email")
            if email:
                emails.add(email.lower())
        print(f"\r  Scanning all account profiles... {len(emails):,}", end="", flush=True)
        url = data.get("links", {}).get("next")
        params = {}
        if url:
            time.sleep(0.12)
    print()
    return emails


def suppress_emails(emails, dry_run=False):
    """Suppress a list of emails in batches of 100."""
    if dry_run:
        print(f"\n  [DRY RUN] Would suppress {len(emails):,} profiles.")
        print(f"  [DRY RUN] Sample (first 10): {emails[:10]}")
        return 0

    url = f"{BASE_URL}/profile-suppression-bulk-create-jobs/"
    suppressed = 0
    batch_size = 100
    total_batches = (len(emails) + batch_size - 1) // batch_size

    print(f"\n  Suppressing {len(emails):,} profiles in {total_batches} batches...")

    for i in range(0, len(emails), batch_size):
        batch = emails[i: i + batch_size]
        payload = {
            "data": {
                "type": "profile-suppression-bulk-create-job",
                "attributes": {
                    "profiles": {
                        "data": [
                            {"type": "profile", "attributes": {"email": e}}
                            for e in batch
                        ]
                    }
                },
            }
        }
        req_with_retry("POST", url, json=payload)
        suppressed += len(batch)
        batch_num = i // batch_size + 1
        print(
            f"\r  Progress: {batch_num}/{total_batches} batches | {suppressed:,}/{len(emails):,}",
            end="",
            flush=True,
        )
        time.sleep(0.25)

    print()
    return suppressed


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--dry-run", action="store_true", help="Preview only, no suppression")
    args = parser.parse_args()

    print("=" * 60)
    print("Klaviyo Unengaged Suppression — Account-Wide Sweep")
    print("=" * 60)

    # 1. Fetch engaged segment
    print("\n[1/3] Fetching 90D_Engaged segment...")
    engaged_emails = get_all_emails_from_segment(SEGMENT_ID)
    print(f"  Engaged: {len(engaged_emails):,} profiles")

    # 2. Scan all account profiles
    print("\n[2/3] Scanning all account profiles...")
    all_emails = get_all_account_emails()
    print(f"  Total with email: {len(all_emails):,}")

    # 3. Compute delta
    to_suppress = list(all_emails - engaged_emails)
    print(f"\n[3/3] Delta:")
    print(f"  Total profiles:  {len(all_emails):,}")
    print(f"  90D_Engaged:     {len(engaged_emails):,}")
    print(f"  To suppress:     {len(to_suppress):,}")

    if not to_suppress:
        print("\n  Nothing to suppress. Already clean.")
        return

    if args.dry_run:
        suppress_emails(to_suppress, dry_run=True)
        print("\n[DRY RUN COMPLETE] Re-run without --dry-run to execute.")
        return

    suppressed = suppress_emails(to_suppress)
    print(f"\n  Done. {suppressed:,} profiles suppressed.")
    print(f"  Billing should drop to ~{len(engaged_emails):,} active profiles.")
    print(f"  Allow 24-48h for Klaviyo billing dashboard to update.")


if __name__ == "__main__":
    main()
