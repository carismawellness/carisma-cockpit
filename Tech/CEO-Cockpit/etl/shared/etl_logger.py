import os
import json
import requests
from datetime import datetime, timezone

def _headers():
    key = os.environ['SUPABASE_SERVICE_ROLE_KEY']
    return {"apikey": key, "Authorization": f"Bearer {key}", "Content-Type": "application/json", "Prefer": "return=representation"}

def _url(table: str) -> str:
    base = os.environ.get('SUPABASE_URL') or os.environ['NEXT_PUBLIC_SUPABASE_URL']
    return f"{base}/rest/v1/{table}"

class ETLLogger:
    def __init__(self, source_name: str):
        self.source_name = source_name
        self.started_at = datetime.now(timezone.utc)
        self.log_id: int | None = None

    def start(self):
        try:
            resp = requests.post(_url('etl_sync_log'), headers=_headers(), data=json.dumps({
                'source_name': self.source_name,
                'started_at': self.started_at.isoformat(),
                'status': 'running',
            }), timeout=10)
            resp.raise_for_status()
            data = resp.json()
            if data:
                self.log_id = data[0]['id']
        except Exception:
            pass

    def complete(self, rows_upserted: int):
        if not self.log_id:
            return
        try:
            now = datetime.now(timezone.utc)
            requests.patch(f"{_url('etl_sync_log')}?id=eq.{self.log_id}", headers=_headers(), data=json.dumps({
                'completed_at': now.isoformat(),
                'status': 'success',
                'rows_upserted': rows_upserted,
                'duration_sec': round((now - self.started_at).total_seconds(), 2),
            }), timeout=10)
        except Exception:
            pass

    def fail(self, error_message: str):
        if not self.log_id:
            return
        try:
            now = datetime.now(timezone.utc)
            requests.patch(f"{_url('etl_sync_log')}?id=eq.{self.log_id}", headers=_headers(), data=json.dumps({
                'completed_at': now.isoformat(),
                'status': 'failed',
                'error_message': error_message[:500],
                'duration_sec': round((now - self.started_at).total_seconds(), 2),
            }), timeout=10)
        except Exception:
            pass
