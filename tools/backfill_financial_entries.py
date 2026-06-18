#!/usr/bin/env python3
"""
Backfill financial_entries from the Aggregated Data Apps Script.

Calls the same Apps Script the ebitda-aggregated API uses, then upserts
every (date, brand, account, venue, contact) row into financial_entries.
Run once to seed historical data; after that, the ETL POST endpoint keeps it updated.

Usage:
    python3 Tools/backfill_financial_entries.py
    python3 Tools/backfill_financial_entries.py --date-from 2026-01-01 --date-to 2026-04-30
"""

import argparse
import os
import sys
import time
from datetime import date

import requests
from dotenv import load_dotenv
from supabase import create_client, Client

# ── Config ────────────────────────────────────────────────────────────────────

load_dotenv(os.path.join(os.path.dirname(__file__), "../10-Tech/CEO-Cockpit/.env.local"))

SUPABASE_URL      = os.environ["NEXT_PUBLIC_SUPABASE_URL"]
SUPABASE_KEY      = os.environ["SUPABASE_SERVICE_ROLE_KEY"]

APPS_SCRIPT_URL   = "https://script.google.com/macros/s/AKfycbwU345ph3xkGH7cHQWze7wm1Bepyr-2ATFYpFnusRbGgjIGtVLIDBC_jL6NT1McJksN/exec"
APPS_SCRIPT_TOKEN = "cbk-ebida-a7f3e91c2d"

DEFAULT_DATE_FROM = "2025-01-01"
DEFAULT_DATE_TO   = date.today().strftime("%Y-%m-%d")
BATCH_SIZE        = 500

# ── Helpers ───────────────────────────────────────────────────────────────────

def fetch_aggregated(org: str, date_from: str, date_to: str) -> dict:
    """Call the Apps Script endpoint exactly as ebitda-aggregated does."""
    print(f"  Fetching org={org} from {date_from} → {date_to}…")
    url = (
        f"{APPS_SCRIPT_URL}"
        f"?token={APPS_SCRIPT_TOKEN}"
        f"&action=aggregated_period"
        f"&org={org}"
        f"&from={date_from}"
        f"&to={date_to}"
    )
    resp = requests.get(url, timeout=120, allow_redirects=True)
    resp.raise_for_status()
    data = resp.json()
    if data.get("error"):
        raise RuntimeError(f"Apps Script error: {data['error']}")
    return data


def build_db_rows(agg: dict, synced_at: str) -> list[dict]:
    """Unroll AggregatedSheetRow.daily into one DB row per non-zero date entry.
    Deduplicates by unique key (date, brand, account_code, venue, contact),
    summing amounts when the same key appears more than once."""
    brand_map = {"AESTHETICS": "AES", "SLIMMING": "SLIM", "SPA": "SPA",
                 "HQ": "HQ", "AES": "AES", "SLIM": "SLIM"}

    # Use a dict keyed by unique constraint to merge duplicates
    merged: dict[tuple, dict] = {}

    for row in agg.get("rows", []):
        brand = brand_map.get(str(row.get("brand", "")).upper(), str(row.get("brand", "")).upper())

        for iso_date, amount in (row.get("daily") or {}).items():
            if not amount:
                continue
            key = (
                iso_date,
                brand,
                row.get("account_code") or "",
                row.get("venue") or "",
                row.get("contact") or "",
            )
            if key in merged:
                merged[key]["amount"] += float(amount)
            else:
                merged[key] = {
                    "date":               iso_date,
                    "brand":              brand,
                    "venue":              row.get("venue") or "",
                    "line_item":          row.get("line_item") or "",
                    "account_code":       row.get("account_code") or "",
                    "ebitda_category":    (row.get("ebitda_category") or "").lower(),
                    "split_rule":         row.get("allocation") or "",
                    "contact":            row.get("contact") or "",
                    "amount":             float(amount),
                    "is_manual_override": False,
                    "zoho_synced_at":     synced_at,
                }

    return list(merged.values())


def upsert_batch(sb: Client, rows: list[dict]) -> int:
    resp = (
        sb.table("financial_entries")
        .upsert(rows, on_conflict="date,brand,account_code,venue,contact")
        .execute()
    )
    return len(rows)


# ── Main ──────────────────────────────────────────────────────────────────────

def main():
    parser = argparse.ArgumentParser(description="Backfill financial_entries")
    parser.add_argument("--date-from", default=DEFAULT_DATE_FROM)
    parser.add_argument("--date-to",   default=DEFAULT_DATE_TO)
    args = parser.parse_args()

    sb         = create_client(SUPABASE_URL, SUPABASE_KEY)
    synced_at  = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
    total_rows = 0

    # Fetch manual override keys so we don't clobber them
    print("Loading manual overrides to skip…")
    overrides_resp = (
        sb.table("financial_entries")
        .select("date, brand, account_code, venue, contact")
        .eq("is_manual_override", True)
        .execute()
    )
    override_keys = {
        f"{r['date']}|{r['brand']}|{r['account_code']}|{r['venue']}|{r['contact']}"
        for r in (overrides_resp.data or [])
    }
    print(f"  {len(override_keys)} manual overrides found — will skip those rows.\n")

    # SPA org covers SPA brand.
    # Aesthetics org covers AES, SLIM, HQ brands.
    for org in ("SPA", "Aesthetics"):
        print(f"\n── Org: {org} ──────────────────────────────────────")
        try:
            agg = fetch_aggregated(org, args.date_from, args.date_to)
        except Exception as e:
            print(f"  ERROR fetching: {e}")
            continue

        all_rows = build_db_rows(agg, synced_at)
        print(f"  {len(all_rows)} non-zero (date, account, venue) entries")

        # Skip manual overrides
        rows_to_upsert = [
            r for r in all_rows
            if f"{r['date']}|{r['brand']}|{r['account_code']}|{r['venue']}|{r['contact']}"
               not in override_keys
        ]
        skipped = len(all_rows) - len(rows_to_upsert)
        if skipped:
            print(f"  Skipping {skipped} rows with manual overrides")

        # Upsert in batches
        for i in range(0, len(rows_to_upsert), BATCH_SIZE):
            batch = rows_to_upsert[i : i + BATCH_SIZE]
            try:
                upsert_batch(sb, batch)
                total_rows += len(batch)
                print(f"  Upserted rows {i+1}–{i+len(batch)}")
            except Exception as e:
                print(f"  ERROR upserting batch {i//BATCH_SIZE + 1}: {e}")
                sys.exit(1)

    print(f"\n✓ Done — {total_rows} rows upserted into financial_entries.")


if __name__ == "__main__":
    main()
