"""
Zoho Books API client — shared by all Zoho Books ETL scripts.

Handles:
- Token refresh (access tokens expire in 1 hour; refresh token is permanent)
- EU data-center routing (Malta org uses .eu domains)
- Per-organisation requests (SPA org vs Aesthetics org)

Usage:
    from zoho_books_client import ZohoBooksClient
    client = ZohoBooksClient(org="spa")
    accounts = client.get("chartofaccounts")
"""

import os
import time
import requests
from pathlib import Path
from dotenv import load_dotenv

_ENV_PATH = Path(__file__).resolve().parents[3] / ".env"
load_dotenv(_ENV_PATH)

# Zoho EU data-centre endpoints (Malta/EU organisations)
_AUTH_BASE  = "https://accounts.zoho.eu/oauth/v2"
_API_BASE   = "https://www.zohoapis.eu/books/v3"

# In-process token cache: {client_id: (access_token, expires_at)}
_token_cache: dict[str, tuple[str, float]] = {}


def _refresh_access_token(org: str = "aesthetics") -> str:
    """Exchange the stored refresh token for a fresh access token."""
    client_id     = os.environ["ZOHO_BOOKS_CLIENT_ID"]
    client_secret = os.environ["ZOHO_BOOKS_CLIENT_SECRET"]
    # SPA and Aesthetics use separate Zoho accounts → separate refresh tokens
    if org == "spa":
        refresh_token = os.environ.get("ZOHO_BOOKS_SPA_REFRESH_TOKEN") or os.environ["ZOHO_BOOKS_REFRESH_TOKEN"]
    else:
        refresh_token = os.environ["ZOHO_BOOKS_REFRESH_TOKEN"]

    resp = requests.post(
        f"{_AUTH_BASE}/token",
        params={
            "refresh_token": refresh_token,
            "client_id":     client_id,
            "client_secret": client_secret,
            "grant_type":    "refresh_token",
        },
        timeout=15,
    )
    resp.raise_for_status()
    data = resp.json()

    if "access_token" not in data:
        raise RuntimeError(f"Token refresh failed: {data}")

    access_token = data["access_token"]
    expires_in   = int(data.get("expires_in", 3600))
    expires_at   = time.time() + expires_in - 60  # 60-second buffer

    cache_key = f"{client_id}:{org}"
    _token_cache[cache_key] = (access_token, expires_at)
    return access_token


def _get_access_token(org: str = "aesthetics") -> str:
    cache_key = f"{os.environ['ZOHO_BOOKS_CLIENT_ID']}:{org}"
    cached = _token_cache.get(cache_key)
    if cached and time.time() < cached[1]:
        return cached[0]
    return _refresh_access_token(org)


class ZohoBooksClient:
    """Thin wrapper around the Zoho Books REST API for one organisation."""

    ORG_ENV_KEYS = {
        "spa":        "ZOHO_BOOKS_SPA_ORG_ID",
        "aesthetics": "ZOHO_BOOKS_AESTH_ORG_ID",
    }

    def __init__(self, org: str):
        """
        Args:
            org: "spa" or "aesthetics"
        """
        if org not in self.ORG_ENV_KEYS:
            raise ValueError(f"Unknown org '{org}'. Must be 'spa' or 'aesthetics'.")
        env_key = self.ORG_ENV_KEYS[org]
        self.org_id = os.environ[env_key]
        self.org = org

    def _headers(self) -> dict:
        return {"Authorization": f"Zoho-oauthtoken {_get_access_token(self.org)}"}

    def get(self, endpoint: str, params: dict | None = None) -> dict:
        """GET from Zoho Books API, auto-paginating if 'page' param is present."""
        url = f"{_API_BASE}/{endpoint}"
        p = {"organization_id": self.org_id, **(params or {})}
        resp = requests.get(url, headers=self._headers(), params=p, timeout=30)
        resp.raise_for_status()
        return resp.json()

    def get_all_pages(self, endpoint: str, list_key: str, params: dict | None = None) -> list[dict]:
        """Fetch all pages from a paginated Zoho endpoint."""
        results = []
        page = 1
        while True:
            data = self.get(endpoint, params={**(params or {}), "page": page, "per_page": 200})
            items = data.get(list_key, [])
            results.extend(items)
            page_context = data.get("page_context", {})
            if not page_context.get("has_more_page", False):
                break
            page += 1
        return results
