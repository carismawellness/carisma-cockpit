import os
import json
import requests
from dotenv import load_dotenv

load_dotenv(os.path.join(os.path.dirname(__file__), '..', '..', '.env.local'))
load_dotenv(os.path.join(os.path.dirname(__file__), '..', '..', '..', '..', '.env'))

def _headers():
    key = os.environ['SUPABASE_SERVICE_ROLE_KEY']
    return {
        "apikey":        key,
        "Authorization": f"Bearer {key}",
        "Content-Type":  "application/json",
        "Prefer":        "return=representation,resolution=merge-duplicates",
    }

def _url(table: str) -> str:
    base = os.environ['SUPABASE_URL'] or os.environ['NEXT_PUBLIC_SUPABASE_URL']
    return f"{base}/rest/v1/{table}"


def get_client():
    return None  # not needed — all ops use REST directly


def upsert(table: str, rows: list[dict], on_conflict: str) -> int:
    if not rows:
        return 0
    headers = {**_headers(), "Prefer": f"return=representation,resolution=merge-duplicates"}
    resp = requests.post(
        f"{_url(table)}?on_conflict={on_conflict}",
        headers=headers,
        data=json.dumps(rows),
        timeout=30,
    )
    resp.raise_for_status()
    return len(resp.json()) if resp.text else 0


def select(table: str, filters: dict | None = None) -> list[dict]:
    params = {k: f"eq.{v}" for k, v in (filters or {}).items()}
    resp = requests.get(_url(table), headers=_headers(), params=params, timeout=30)
    resp.raise_for_status()
    return resp.json()
