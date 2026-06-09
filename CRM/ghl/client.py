"""
GHL API client — thin httpx wrapper with rate-limit backoff.

Reads credentials from .env:
  GHL_API_KEY      — private integration key
  GHL_LOCATION_ID  — sub-account / location ID
  GHL_BASE_URL     — default: https://services.leadconnectorhq.com
"""

import logging
import os
import time
from typing import Any, Optional

import httpx
from dotenv import load_dotenv

load_dotenv()

log = logging.getLogger(__name__)

GHL_API_KEY     = os.getenv("GHL_API_KEY", "")
GHL_LOCATION_ID = os.getenv("GHL_LOCATION_ID", "")
GHL_BASE_URL    = os.getenv("GHL_BASE_URL", "https://services.leadconnectorhq.com")

_DEFAULT_HEADERS = {
    "Authorization": f"Bearer {GHL_API_KEY}",
    "Version": "2021-07-28",
    "Content-Type": "application/json",
}


class GHLClient:
    """Thin httpx wrapper for the Go High Level v2 API."""

    def __init__(self):
        if not GHL_API_KEY:
            raise RuntimeError("GHL_API_KEY is not set. Check your .env file.")
        if not GHL_LOCATION_ID:
            raise RuntimeError("GHL_LOCATION_ID is not set. Check your .env file.")
        self._http = httpx.Client(timeout=30, headers=_DEFAULT_HEADERS)
        self.location_id = GHL_LOCATION_ID

    # ── Internal request with rate-limit retry ────────────────────────────────

    def _request(self, method: str, path: str, *, retry: int = 3, **kwargs) -> dict:
        url = f"{GHL_BASE_URL}{path}"
        for attempt in range(retry):
            resp = self._http.request(method, url, **kwargs)
            if resp.status_code == 429:
                wait = 2 ** attempt
                log.warning("Rate limited — waiting %ds (attempt %d/%d)", wait, attempt + 1, retry)
                time.sleep(wait)
                continue
            if resp.status_code == 204:
                return {}
            try:
                resp.raise_for_status()
            except httpx.HTTPStatusError as exc:
                log.error("HTTP %s %s → %s: %s", method, path, resp.status_code, resp.text)
                raise exc
            return resp.json()
        raise RuntimeError(f"Request failed after {retry} retries: {method} {path}")

    def get(self, path: str, params: Optional[dict] = None) -> dict:
        return self._request("GET", path, params=params)

    def post(self, path: str, body: dict) -> dict:
        return self._request("POST", path, json=body)

    def put(self, path: str, body: dict) -> dict:
        return self._request("PUT", path, json=body)

    def delete(self, path: str) -> dict:
        return self._request("DELETE", path)

    # ── Contacts ──────────────────────────────────────────────────────────────

    def get_contact(self, contact_id: str) -> dict:
        data = self.get(f"/contacts/{contact_id}")
        return data.get("contact", data)

    def search_contacts(
        self,
        query: str = "",
        limit: int = 100,
        start_after_id: Optional[str] = None,
        start_after: Optional[int] = None,
    ) -> dict:
        """Returns full response dict (contacts + meta).

        GHL cursor pagination requires BOTH startAfterId AND startAfter (Unix ms
        timestamp). Pass both from meta.startAfterId and meta.startAfter of the
        previous response to advance to the next page.
        """
        params: dict[str, Any] = {"locationId": self.location_id, "limit": limit}
        if query:
            params["query"] = query
        if start_after_id:
            params["startAfterId"] = start_after_id
        if start_after is not None:
            params["startAfter"] = start_after
        return self.get("/contacts/", params=params)

    def update_contact(self, contact_id: str, fields: dict) -> dict:
        return self.put(f"/contacts/{contact_id}", fields)

    # ── Opportunities ─────────────────────────────────────────────────────────

    def get_opportunity(self, opp_id: str) -> dict:
        data = self.get(f"/opportunities/{opp_id}")
        return data.get("opportunity", data)

    def search_opportunities(
        self,
        pipeline_id: Optional[str] = None,
        stage_id: Optional[str] = None,
        limit: int = 100,
        start_after: Optional[str] = None,
        extra_params: Optional[dict] = None,
    ) -> dict:
        """Returns full response dict (opportunities + meta) so callers can paginate."""
        params: dict[str, Any] = {
            "location_id": self.location_id,
            "limit": limit,
        }
        if start_after:
            params["startAfter"] = start_after
        if pipeline_id:
            params["pipeline_id"] = pipeline_id
        if stage_id:
            params["pipeline_stage_id"] = stage_id
        if extra_params:
            params.update(extra_params)
        return self.get("/opportunities/search", params=params)

    def update_opportunity(self, opp_id: str, fields: dict) -> dict:
        return self.put(f"/opportunities/{opp_id}", fields)

    # ── Tasks ─────────────────────────────────────────────────────────────────

    def get_tasks(self, contact_id: str) -> list[dict]:
        data = self.get(f"/contacts/{contact_id}/tasks")
        return data.get("tasks", [])

    def create_task(self, contact_id: str, payload: dict) -> dict:
        return self.post(f"/contacts/{contact_id}/tasks", payload)

    def update_task(self, contact_id: str, task_id: str, payload: dict) -> dict:
        return self.put(f"/contacts/{contact_id}/tasks/{task_id}", payload)

    def complete_task(self, contact_id: str, task_id: str) -> dict:
        return self.put(f"/contacts/{contact_id}/tasks/{task_id}", {"completed": True})

    # ── Pipelines ─────────────────────────────────────────────────────────────

    def get_pipelines(self) -> list[dict]:
        data = self.get("/opportunities/pipelines", params={"locationId": self.location_id})
        return data.get("pipelines", [])

    def create_opportunity(
        self,
        contact_id: str,
        pipeline_id: str,
        stage_id: str,
        name: str,
        monetary_value: int = 0,
        assigned_to: str = "",
    ) -> dict:
        body: dict = {
            "pipelineId":      pipeline_id,
            "pipelineStageId": stage_id,
            "contactId":       contact_id,
            "locationId":      self.location_id,
            "name":            name,
            "status":          "open",
        }
        if monetary_value:
            body["monetaryValue"] = monetary_value
        if assigned_to:
            body["assignedTo"] = assigned_to
        return self.post("/opportunities/", body)

    def patch_opportunity_value(self, opp_id: str, monetary_value: int) -> dict:
        """Set the monetary value on an existing opportunity."""
        return self.put(f"/opportunities/{opp_id}", {"monetaryValue": monetary_value})

    def get_contact_opportunities(self, contact_id: str) -> list[dict]:
        """Return all opportunities linked to a contact (most recent first)."""
        data = self.get(f"/contacts/{contact_id}/opportunities")
        return data.get("opportunities", [])

    # ── Users / Assignment ────────────────────────────────────────────────────

    def count_open_tasks_for_user(self, user_id: str) -> int:
        """Return the number of open (pending/in-progress) tasks assigned to a user."""
        try:
            data = self.get("/tasks/search", params={
                "locationId": self.location_id,
                "assignedTo": user_id,
                "status": "pending",
                "limit": 100,
            })
            tasks = data.get("tasks", [])
            return len(tasks)
        except Exception:
            return 0
