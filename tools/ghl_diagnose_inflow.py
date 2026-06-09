"""
Deep-dive diagnostics on the New Leads inflow:
- Show the junk-name / junk-email samples
- Identify opps whose stage was moved into 🌱 New Leads in the last 48h
  (lastStageChangeAt) — these are the "bounced back to new" candidates
- For those, fetch the contact's recent tasks/notes to confirm prior contact
- Find same-email duplicates across different contactIds
- Show samples of yesterday's inflow (2026-05-11) and today's (2026-05-12) Aes
"""

from __future__ import annotations

import json
import os
import time
from collections import defaultdict
from datetime import datetime, timezone, timedelta
from pathlib import Path

import httpx

BASE = "https://services.leadconnectorhq.com"
ROOT = Path(__file__).resolve().parent.parent
TMP = ROOT / ".tmp"

BRANDS = {
    "Aesthetics": {"env_key": "GHL_API_KEY_AESTHETICS"},
    "Slimming":   {"env_key": "GHL_API_KEY_SLIMMING"},
}


def load_env() -> None:
    for line in (ROOT / ".env").read_text().splitlines():
        if "=" in line and not line.strip().startswith("#"):
            k, _, v = line.partition("=")
            os.environ.setdefault(k.strip(), v.strip())


def hdr(token: str) -> dict:
    return {"Authorization": f"Bearer {token}", "Version": "2021-07-28", "Accept": "application/json"}


def parse_dt(s):
    if not s: return None
    try: return datetime.fromisoformat(s.replace("Z","+00:00"))
    except Exception: return None


def get_tasks(token: str, contact_id: str) -> list[dict]:
    for attempt in range(3):
        r = httpx.get(f"{BASE}/contacts/{contact_id}/tasks", headers=hdr(token), timeout=30)
        if r.status_code == 429:
            time.sleep(2 ** attempt); continue
        if r.status_code == 200:
            return r.json().get("tasks", [])
        return []
    return []


def main() -> None:
    load_env()
    now = datetime.now(timezone.utc)
    cutoff_48h = now - timedelta(hours=48)

    for brand in BRANDS:
        print("\n" + "=" * 70)
        print(f"  {brand.upper()}")
        print("=" * 70)
        token = os.environ[BRANDS[brand]["env_key"]]
        opps = json.loads((TMP / f"ghl_open_new_leads_{brand.lower()}.json").read_text())
        print(f"Loaded {len(opps)} opps from cache.")

        # --- 1. Junk samples ---
        analysis = json.loads((TMP / f"ghl_analysis_{brand.lower()}.json").read_text())
        print(f"\n--- JUNK-NAME samples (up to 20 of {len(analysis['junk_name'])}) ---")
        for e in analysis["junk_name"][:20]:
            print(f"  opp={e['opp']}  name={e['name']!r:30s} email={e['email']!r}  src={e['source']!r}  at={e['createdAt']}")
        print(f"\n--- JUNK-EMAIL samples (up to 20 of {len(analysis['junk_email'])}) ---")
        for e in analysis["junk_email"][:20]:
            print(f"  opp={e['opp']}  name={e['name']!r:30s} email={e['email']!r}  src={e['source']!r}  at={e['createdAt']}")

        # --- 2. Bounced-back: opps with recent lastStageChangeAt ---
        bounced = []
        for o in opps:
            dt = parse_dt(o.get("lastStageChangeAt"))
            if dt and dt >= cutoff_48h:
                bounced.append(o)
        bounced.sort(key=lambda o: o.get("lastStageChangeAt") or "", reverse=True)
        print(f"\n--- Opps moved INTO New Leads in last 48h (lastStageChangeAt): {len(bounced)} ---")
        for o in bounced[:25]:
            created = o.get("createdAt"); changed = o.get("lastStageChangeAt")
            same = "(new)" if created == changed else "(BOUNCED — opp existed before)"
            c = o.get("contact") or {}
            print(f"  opp={o['id']}  name={(o.get('name') or '')!r:25s} "
                  f"created={created}  stageChange={changed}  {same}")

        # Among bounced, isolate those where createdAt is OLDER than lastStageChangeAt
        true_bounces = [o for o in bounced if parse_dt(o.get("createdAt")) and parse_dt(o.get("lastStageChangeAt"))
                        and (parse_dt(o.get("lastStageChangeAt")) - parse_dt(o.get("createdAt"))).total_seconds() > 3600]
        print(f"\n--- TRUE bounce-backs (opp >1h old, moved into New Leads recently): {len(true_bounces)} ---")
        for o in true_bounces[:30]:
            print(f"  opp={o['id']}  name={(o.get('name') or '')!r:25s} "
                  f"created={o.get('createdAt')}  stageChange={o.get('lastStageChangeAt')}  "
                  f"contactId={o.get('contactId')}")

        # For top 10 true bounce-backs, fetch tasks to confirm prior contact
        print(f"\n--- Sampling tasks for first 10 true bounce-backs ---")
        for o in true_bounces[:10]:
            tasks = get_tasks(token, o["contactId"])
            recent_tasks = []
            for t in tasks:
                td = parse_dt(t.get("dueDate")) or parse_dt(t.get("updatedAt"))
                if td and td >= (now - timedelta(days=7)):
                    recent_tasks.append({
                        "title": t.get("title"),
                        "completed": t.get("completed"),
                        "due": t.get("dueDate"),
                        "updated": t.get("updatedAt"),
                    })
            print(f"  opp={o['id']}  name={(o.get('name') or '')!r:25s}  tasks_last_7d={len(recent_tasks)}")
            for t in recent_tasks[:3]:
                print(f"      title={t['title']!r}  completed={t['completed']}  due={t['due']}")

        # --- 3. Same-email duplicates (different contactIds, same email) ---
        by_email = defaultdict(list)
        for o in opps:
            email = ((o.get("contact") or {}).get("email") or "").strip().lower()
            if email:
                by_email[email].append(o)
        dup_emails = {e: ops for e, ops in by_email.items() if len(ops) > 1}
        print(f"\n--- Same-email duplicates in New Leads: {len(dup_emails)} emails span >1 opp ---")
        for email, ops in list(dup_emails.items())[:15]:
            print(f"  email={email}")
            for o in ops:
                print(f"      opp={o['id']}  contactId={o.get('contactId')}  created={o.get('createdAt')}")

        # --- 4. Today + yesterday inflow samples ---
        for day_offset, label in [(0, "TODAY"), (1, "YESTERDAY")]:
            day = (now - timedelta(days=day_offset)).date().isoformat()
            todays = [o for o in opps if (o.get("createdAt") or "").startswith(day)]
            print(f"\n--- {label} ({day}) inflow: {len(todays)} opps ---")
            for o in todays[:15]:
                c = o.get("contact") or {}
                print(f"  opp={o['id']}  name={(o.get('name') or '')!r:25s} email={c.get('email')!r:35s} src={c.get('source')!r}  tags={c.get('tags')}")


if __name__ == "__main__":
    main()
