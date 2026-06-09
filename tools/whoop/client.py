"""
WHOOP API client — OAuth 2.0 with auto-refresh + v2 data endpoints.

Reads credentials from .env:
  WHOOP_CLIENT_ID      — from developer.whoop.com app
  WHOOP_CLIENT_SECRET  — from developer.whoop.com app

Tokens are persisted to .tmp/whoop_tokens.json (gitignored).
Run Tools/whoop/auth_setup.py once to seed tokens.
"""

import json
import os
import time
from pathlib import Path
from typing import Any

import httpx
from dotenv import load_dotenv

PROJECT_ROOT = Path(__file__).parent.parent.parent
load_dotenv(PROJECT_ROOT / ".env")

API_BASE = "https://api.prod.whoop.com/developer"
TOKEN_URL = "https://api.prod.whoop.com/oauth/oauth2/token"
TOKEN_FILE = PROJECT_ROOT / ".tmp" / "whoop_tokens.json"


class WhoopClient:
    def __init__(self) -> None:
        self.client_id = os.getenv("WHOOP_CLIENT_ID", "")
        self.client_secret = os.getenv("WHOOP_CLIENT_SECRET", "")
        if not self.client_id or not self.client_secret:
            raise RuntimeError(
                "WHOOP_CLIENT_ID / WHOOP_CLIENT_SECRET not set in .env"
            )
        if not TOKEN_FILE.exists():
            raise RuntimeError(
                f"No tokens at {TOKEN_FILE}. "
                f"Run: python Tools/whoop/auth_setup.py"
            )
        self.tokens = json.loads(TOKEN_FILE.read_text())

    def _save_tokens(self, tokens: dict) -> None:
        TOKEN_FILE.parent.mkdir(parents=True, exist_ok=True)
        TOKEN_FILE.write_text(json.dumps(tokens, indent=2))
        self.tokens = tokens

    def _refresh_if_needed(self) -> None:
        if time.time() < self.tokens.get("expires_at", 0) - 60:
            return
        r = httpx.post(
            TOKEN_URL,
            data={
                "grant_type": "refresh_token",
                "refresh_token": self.tokens["refresh_token"],
                "client_id": self.client_id,
                "client_secret": self.client_secret,
                "scope": "offline",
            },
            timeout=30,
        )
        r.raise_for_status()
        data = r.json()
        self._save_tokens({
            "access_token": data["access_token"],
            "refresh_token": data.get("refresh_token", self.tokens["refresh_token"]),
            "expires_at": time.time() + data["expires_in"],
        })

    def _headers(self) -> dict:
        self._refresh_if_needed()
        return {"Authorization": f"Bearer {self.tokens['access_token']}"}

    def _get(self, path: str, params: dict | None = None) -> dict:
        r = httpx.get(
            f"{API_BASE}{path}",
            headers=self._headers(),
            params=params or {},
            timeout=30,
        )
        r.raise_for_status()
        return r.json()

    def _paginate(self, path: str, params: dict | None = None) -> list[dict]:
        params = dict(params or {})
        params.setdefault("limit", 25)
        out: list[dict] = []
        while True:
            data = self._get(path, params)
            out.extend(data.get("records", []))
            next_token = data.get("next_token") or data.get("nextToken")
            if not next_token:
                break
            params["nextToken"] = next_token
        return out

    # ── Data endpoints (v2) ────────────────────────────────────────────────

    def get_cycles(self, start: str, end: str) -> list[dict]:
        return self._paginate("/v2/cycle", {"start": start, "end": end})

    def get_recovery(self, start: str, end: str) -> list[dict]:
        return self._paginate("/v2/recovery", {"start": start, "end": end})

    def get_sleep(self, start: str, end: str) -> list[dict]:
        return self._paginate("/v2/activity/sleep", {"start": start, "end": end})

    def get_workouts(self, start: str, end: str) -> list[dict]:
        return self._paginate("/v2/activity/workout", {"start": start, "end": end})

    def get_profile(self) -> dict:
        return self._get("/v2/user/profile/basic")

    def get_body_measurements(self) -> dict:
        return self._get("/v2/user/measurement/body")
