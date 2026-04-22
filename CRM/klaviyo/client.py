"""
Klaviyo REST client — thin httpx wrapper for profile subscription.

Reads credentials from environment:
  KLAVIYO_PRIVATE_API_KEY  — private API key from Klaviyo account settings
  KLAVIYO_LIST_ID          — default list to subscribe leads to (e.g. XfDjPT)

Usage:
  from klaviyo.client import KlaviyoClient
  client = KlaviyoClient()
  client.subscribe_to_list(email="jane@example.com", first_name="Jane", list_id="XfDjPT")
"""

import logging
import os
from typing import Optional

import httpx
from dotenv import load_dotenv

load_dotenv()

log = logging.getLogger(__name__)

KLAVIYO_PRIVATE_API_KEY = os.getenv("KLAVIYO_PRIVATE_API_KEY", "")
KLAVIYO_LIST_ID         = os.getenv("KLAVIYO_LIST_ID", "XfDjPT")  # Email List
KLAVIYO_BASE_URL        = "https://a.klaviyo.com/api"
KLAVIYO_API_REVISION    = "2024-10-15"


class KlaviyoClient:
    """Thin httpx wrapper for Klaviyo profile subscription."""

    def __init__(self, api_key: Optional[str] = None, list_id: Optional[str] = None):
        self._api_key = api_key or KLAVIYO_PRIVATE_API_KEY
        self._list_id = list_id or KLAVIYO_LIST_ID
        if not self._api_key:
            raise RuntimeError("KLAVIYO_PRIVATE_API_KEY is not set.")
        self._http = httpx.Client(
            timeout=20,
            headers={
                "Authorization": f"Klaviyo-API-Key {self._api_key}",
                "revision": KLAVIYO_API_REVISION,
                "Content-Type": "application/json",
            },
        )

    def subscribe_to_list(
        self,
        email: str,
        first_name: str = "",
        last_name: str = "",
        phone: str = "",
        list_id: Optional[str] = None,
    ) -> bool:
        """
        Subscribe a profile to email marketing on the given list.
        Returns True on success, False on failure (errors are logged, not raised).
        """
        if not email:
            log.warning("klaviyo.subscribe_to_list: no email provided — skipping")
            return False

        target_list = list_id or self._list_id

        profile_attrs: dict = {
            "email": email,
            "subscriptions": {
                "email": {
                    "marketing": {"consent": "SUBSCRIBED"}
                }
            },
        }
        if first_name:
            profile_attrs["first_name"] = first_name
        if last_name:
            profile_attrs["last_name"] = last_name
        if phone:
            profile_attrs["phone_number"] = phone

        body = {
            "data": {
                "type": "profile-subscription-bulk-create-job",
                "attributes": {
                    "profiles": {
                        "data": [
                            {"type": "profile", "attributes": profile_attrs}
                        ]
                    }
                },
                "relationships": {
                    "list": {
                        "data": {"type": "list", "id": target_list}
                    }
                },
            }
        }

        try:
            resp = self._http.post(
                f"{KLAVIYO_BASE_URL}/profile-subscription-bulk-create-jobs/",
                json=body,
            )
            if resp.status_code in (200, 202):
                log.info("klaviyo: subscribed %s to list %s", email, target_list)
                return True
            log.error(
                "klaviyo: subscribe failed for %s → HTTP %d: %s",
                email, resp.status_code, resp.text[:300],
            )
            return False
        except Exception as exc:
            log.error("klaviyo: exception subscribing %s: %s", email, exc)
            return False

    def upsert_profile(
        self,
        email: str,
        first_name: str = "",
        last_name: str = "",
        phone: str = "",
        custom_properties: Optional[dict] = None,
    ) -> Optional[str]:
        """
        Create or update a Klaviyo profile. Returns the profile ID or None on failure.
        Use this when you want to set profile properties without subscribing.
        """
        if not email:
            return None

        profile_attrs: dict = {"email": email}
        if first_name:
            profile_attrs["first_name"] = first_name
        if last_name:
            profile_attrs["last_name"] = last_name
        if phone:
            profile_attrs["phone_number"] = phone
        if custom_properties:
            profile_attrs["properties"] = custom_properties

        body = {
            "data": {
                "type": "profile",
                "attributes": profile_attrs,
            }
        }

        try:
            resp = self._http.post(
                f"{KLAVIYO_BASE_URL}/profile-import/",
                json=body,
            )
            if resp.status_code in (200, 201):
                data = resp.json()
                profile_id = data.get("data", {}).get("id")
                log.info("klaviyo: upserted profile %s → id=%s", email, profile_id)
                return profile_id
            log.error(
                "klaviyo: upsert failed for %s → HTTP %d: %s",
                email, resp.status_code, resp.text[:300],
            )
            return None
        except Exception as exc:
            log.error("klaviyo: exception upserting %s: %s", email, exc)
            return None
