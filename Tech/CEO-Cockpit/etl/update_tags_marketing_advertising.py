import sys
sys.stdout.reconfigure(encoding="utf-8", errors="replace")
sys.stderr.reconfigure(encoding="utf-8", errors="replace")
"""
Update Zoho Books reporting tags for "Marketing - Advertising" (account 611113).

Changes every transaction line tagged "HQ" → "Unallocated" between
2025-01-01 and today, in the SPA org.

Usage (from the etl/ directory):
    py update_tags_marketing_advertising.py          # dry-run — preview only
    py update_tags_marketing_advertising.py --apply  # write changes to Zoho

Supported transaction types: expense, bill, manual_journal
Unsupported types are logged and skipped (no data is lost).
"""

import argparse
import time
from pathlib import Path

try:
    from dotenv import load_dotenv
    import requests
except ImportError:
    import subprocess
    subprocess.check_call([sys.executable, "-m", "pip", "install", "python-dotenv", "requests"])
    from dotenv import load_dotenv
    import requests

load_dotenv(Path(__file__).resolve().parents[3] / ".env")

import os

CLIENT_ID     = os.environ["ZOHO_BOOKS_CLIENT_ID"]
CLIENT_SECRET = os.environ["ZOHO_BOOKS_CLIENT_SECRET"]
REFRESH_TOKEN = os.environ["ZOHO_BOOKS_SPA_REFRESH_TOKEN"]
ORG_ID        = os.environ["ZOHO_BOOKS_SPA_ORG_ID"]

AUTH_BASE = "https://accounts.zoho.eu/oauth/v2"
API_BASE  = "https://www.zohoapis.eu/books/v3"

DATE_FROM     = "2025-01-01"
DATE_TO       = "2026-05-15"
ACCOUNT_CODE  = "611113"            # Marketing - Advertising
FROM_TAG_NAME = "HQ"
TO_TAG_NAME   = "Unallocated"

# ---------------------------------------------------------------------------
# Auth
# ---------------------------------------------------------------------------
_access_token: str | None = None
_token_expiry: float = 0.0


def _refresh() -> str:
    global _access_token, _token_expiry
    resp = requests.post(
        f"{AUTH_BASE}/token",
        params={
            "refresh_token": REFRESH_TOKEN,
            "client_id":     CLIENT_ID,
            "client_secret": CLIENT_SECRET,
            "grant_type":    "refresh_token",
        },
        timeout=15,
    )
    resp.raise_for_status()
    data = resp.json()
    if "access_token" not in data:
        raise RuntimeError(f"Token refresh failed: {data}")
    _access_token = data["access_token"]
    _token_expiry = time.time() + int(data.get("expires_in", 3600)) - 60
    return _access_token


def token() -> str:
    if _access_token and time.time() < _token_expiry:
        return _access_token
    return _refresh()


def headers() -> dict:
    return {"Authorization": f"Zoho-oauthtoken {token()}"}


def zget(endpoint: str, params: dict | None = None) -> dict:
    url = f"{API_BASE}/{endpoint}"
    p = {"organization_id": ORG_ID, **(params or {})}
    r = requests.get(url, headers=headers(), params=p, timeout=30)
    r.raise_for_status()
    return r.json()


def zput(endpoint: str, payload: dict) -> dict:
    url = f"{API_BASE}/{endpoint}"
    params = {"organization_id": ORG_ID}
    r = requests.put(url, headers=headers(), params=params, json=payload, timeout=30)
    r.raise_for_status()
    return r.json()


def get_all_pages(endpoint: str, list_key: str, params: dict | None = None) -> list[dict]:
    results, page = [], 1
    while True:
        data = zget(endpoint, {**(params or {}), "page": page, "per_page": 200})
        items = data.get(list_key, [])
        results.extend(items)
        if not data.get("page_context", {}).get("has_more_page", False):
            break
        page += 1
    return results


# ---------------------------------------------------------------------------
# Step 1 — discover reporting tags
# ---------------------------------------------------------------------------

def get_tag_options() -> tuple[str, str, str]:
    """
    Returns (tag_id, from_option_name, to_option_name).

    In Zoho Books EU the settings/tags endpoint returns:
      reporting_tags[].tag_options  →  "Excelsior,HQ,Hugos,..."  (comma-separated string)
    Tag options don't have separate IDs — the option *value* (string) is used directly
    when reading/writing transaction tags.
    """
    data = zget("settings/tags")
    tags = data.get("reporting_tags", [])
    for tag in tags:
        options_str = tag.get("tag_options", "")
        options = [o.strip() for o in options_str.split(",") if o.strip()]
        if FROM_TAG_NAME in options and TO_TAG_NAME in options:
            print(f"  Reporting tag found: '{tag['tag_name']}' (id={tag['tag_id']})")
            print(f"    Contains '{FROM_TAG_NAME}' and '{TO_TAG_NAME}' ✓")
            # Return the tag_id and the string values (no separate option IDs in this org)
            return tag["tag_id"], FROM_TAG_NAME, TO_TAG_NAME

    print("\nAvailable reporting tags:")
    for tag in tags:
        print(f"  {tag['tag_name']} (id={tag['tag_id']}): {tag.get('tag_options','')}")
    raise RuntimeError(
        f"Could not find a reporting tag containing both '{FROM_TAG_NAME}' and '{TO_TAG_NAME}'. "
        "See tag list above."
    )


# ---------------------------------------------------------------------------
# Step 2 — find the account_id for "Marketing - Advertising" (code 611113)
# ---------------------------------------------------------------------------

def find_account_id() -> str:
    accounts = get_all_pages("chartofaccounts", "chartofaccounts")
    for acc in accounts:
        if acc.get("account_code") == ACCOUNT_CODE or acc.get("account_name") == "Marketing - Advertising":
            print(f"  Account found: '{acc['account_name']}' (id={acc['account_id']}, code={acc.get('account_code','')})")
            return acc["account_id"]
    raise RuntimeError(f"Account with code '{ACCOUNT_CODE}' not found in SPA org chart of accounts.")


# ---------------------------------------------------------------------------
# Step 3 — collect transactions across all relevant transaction types
# ---------------------------------------------------------------------------

def get_transactions_for_account(account_id: str) -> list[dict]:
    """
    Returns a flat list of dicts: {"id": ..., "type": "expense"|"bill"|"journal", "date": ..., "ref": ...}

    Zoho Books EU v3 has no generic account-transactions endpoint, so we query
    each transaction type separately and filter by account / date range.
    """
    results = []

    # 1. Expenses (can filter directly by account_id)
    exps = get_all_pages("expenses", "expenses", {
        "account_id": account_id,
        "date_start": DATE_FROM,
        "date_end":   DATE_TO,
    })
    for e in exps:
        results.append({
            "id":   e["expense_id"],
            "type": "expense",
            "date": e.get("date", ""),
            "ref":  e.get("reference_number", "") or e.get("expense_id", ""),
        })

    # 2. Bills (no account_id filter — fetch all in range, check line items)
    bills = get_all_pages("bills", "bills", {
        "date_start": DATE_FROM,
        "date_end":   DATE_TO,
    })
    for b in bills:
        for li in b.get("line_items", []):
            if li.get("account_id") == account_id:
                results.append({
                    "id":   b["bill_id"],
                    "type": "bill",
                    "date": b.get("date", ""),
                    "ref":  b.get("bill_number", "") or b.get("reference_number", ""),
                })
                break  # only add once per bill even if multiple lines match

    # 3. Manual journals (fetch all in range, check line items)
    journals = get_all_pages("journals", "journals", {
        "date_start": DATE_FROM,
        "date_end":   DATE_TO,
    })
    for j in journals:
        for li in j.get("line_items", []):
            if li.get("account_id") == account_id:
                results.append({
                    "id":   j["journal_id"],
                    "type": "journal",
                    "date": j.get("journal_date", j.get("date", "")),
                    "ref":  j.get("journal_number", "") or j.get("reference_number", ""),
                })
                break

    return results


# ---------------------------------------------------------------------------
# Step 4 — helpers to check/swap tags
# ---------------------------------------------------------------------------

def _has_hq_tag(tags: list[dict], tag_id: str, from_opt: str) -> bool:
    """Check if any tag entry matches the HQ option (by name or option_id)."""
    for t in tags:
        if t.get("tag_id") == tag_id:
            # Zoho Books EU uses tag_option_name (string), not a numeric option_id
            if t.get("tag_option_name") == from_opt or t.get("tag_option_id") == from_opt:
                return True
    return False


def _swap_tag(tags: list[dict], tag_id: str, from_opt: str, to_opt: str) -> tuple[list[dict], bool]:
    """Return (new_tags_list, changed). Replaces from_opt with to_opt."""
    changed = False
    new_tags = []
    for t in tags:
        if t.get("tag_id") == tag_id and (
            t.get("tag_option_name") == from_opt or t.get("tag_option_id") == from_opt
        ):
            # Preserve the structure but replace the value in whichever field is present
            entry = dict(t)
            if "tag_option_name" in entry:
                entry["tag_option_name"] = to_opt
            if "tag_option_id" in entry:
                entry["tag_option_id"] = to_opt
            new_tags.append(entry)
            changed = True
        else:
            new_tags.append(t)
    return new_tags, changed


# ---------------------------------------------------------------------------
# Step 5 — update handlers per transaction type
# ---------------------------------------------------------------------------

def update_expense(txn_id: str, tag_id: str, from_opt: str, to_opt: str, apply: bool) -> bool:
    data = zget(f"expenses/{txn_id}")
    exp = data.get("expense", {})

    new_tags, changed = _swap_tag(exp.get("tags", []), tag_id, from_opt, to_opt)
    if not changed:
        return False

    if apply:
        payload = dict(exp)
        payload["tags"] = new_tags
        zput(f"expenses/{txn_id}", payload)
    return True


def update_bill(txn_id: str, account_id: str, tag_id: str, from_opt: str, to_opt: str, apply: bool) -> bool:
    data = zget(f"bills/{txn_id}")
    bill = data.get("bill", {})

    any_changed = False
    for li in bill.get("line_items", []):
        if li.get("account_id") == account_id:
            new_tags, changed = _swap_tag(li.get("tags", []), tag_id, from_opt, to_opt)
            if changed:
                li["tags"] = new_tags
                any_changed = True

    if not any_changed:
        # Fallback: check transaction-level tags
        new_tags, changed = _swap_tag(bill.get("tags", []), tag_id, from_opt, to_opt)
        if changed:
            bill["tags"] = new_tags
            any_changed = True

    if not any_changed:
        return False

    if apply:
        zput(f"bills/{txn_id}", bill)
    return True


def update_journal(txn_id: str, account_id: str, tag_id: str, from_opt: str, to_opt: str, apply: bool) -> bool:
    data = zget(f"journals/{txn_id}")
    journal = data.get("journal", {})

    any_changed = False
    for li in journal.get("line_items", []):
        if li.get("account_id") == account_id:
            new_tags, changed = _swap_tag(li.get("tags", []), tag_id, from_opt, to_opt)
            if changed:
                li["tags"] = new_tags
                any_changed = True

    if not any_changed:
        return False

    if apply:
        zput(f"journals/{txn_id}", journal)
    return True


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

def main():
    parser = argparse.ArgumentParser(description="Update 'HQ' → 'Unallocated' tags on Marketing - Advertising transactions")
    parser.add_argument("--apply", action="store_true", help="Actually apply changes (default is dry-run)")
    args = parser.parse_args()
    apply = args.apply

    mode = "APPLY" if apply else "DRY-RUN"
    print(f"\n{'='*60}")
    print(f"  Mode: {mode}")
    print(f"  Org:  SPA ({ORG_ID})")
    print(f"  Account: Marketing - Advertising ({ACCOUNT_CODE})")
    print(f"  Date range: {DATE_FROM} → {DATE_TO}")
    print(f"  Tag change: '{FROM_TAG_NAME}' → '{TO_TAG_NAME}'")
    print(f"{'='*60}\n")

    print("Step 1: Looking up reporting tags...")
    tag_id, from_opt, to_opt = get_tag_options()

    print("\nStep 2: Finding account ID...")
    account_id = find_account_id()

    print(f"\nStep 3: Fetching transactions ({DATE_FROM} → {DATE_TO})...")
    transactions = get_transactions_for_account(account_id)
    print(f"  Found {len(transactions)} transactions in range")

    updated = 0
    skipped_no_hq = 0
    errors = []

    print(f"\nStep 4: Processing transactions ({mode})...")
    for i, txn in enumerate(transactions, 1):
        txn_id   = txn["id"]
        txn_type = txn["type"]
        txn_date = txn["date"]
        txn_ref  = txn["ref"]

        try:
            if txn_type == "expense":
                changed = update_expense(txn_id, tag_id, from_opt, to_opt, apply)
            elif txn_type == "bill":
                changed = update_bill(txn_id, account_id, tag_id, from_opt, to_opt, apply)
            elif txn_type == "journal":
                changed = update_journal(txn_id, account_id, tag_id, from_opt, to_opt, apply)
            else:
                changed = False

            if changed:
                action = "UPDATED" if apply else "WOULD UPDATE"
                print(f"  [{i:>4}] {action}  {txn_date}  {txn_type:<20} {txn_ref}")
                updated += 1
            else:
                skipped_no_hq += 1

        except requests.HTTPError as e:
            msg = f"  [{i:>4}] ERROR  {txn_date}  {txn_type}  {txn_ref}: HTTP {e.response.status_code} — {e.response.text[:120]}"
            print(msg)
            errors.append(msg)

        # Polite rate-limiting: ~2 req/sec for GET + PUT pairs
        time.sleep(0.5)

    print(f"\n{'='*60}")
    print(f"  {'Updated' if apply else 'Would update'}: {updated}")
    print(f"  No HQ tag (skipped):  {skipped_no_hq}")
    print(f"  Errors:               {len(errors)}")
    print(f"{'='*60}")

    if not apply and updated > 0:
        print(f"\nRe-run with --apply to commit these {updated} changes.")

    if errors:
        print("\nError details:")
        for e in errors:
            print(e)
        sys.exit(1)


if __name__ == "__main__":
    main()
