"""
Per-brand migration configuration: GHL location IDs, API keys, and tag conventions.

Single source of truth. field_mapper.py, ghl_importer.py, and any future
brand-aware migration tooling should import from here rather than hardcoding.

API keys are read from .env at import time:
    GHL_API_KEY            — Spa private integration token (legacy var)
    GHL_API_KEY_AESTHETICS — Aesthetics PIT (must be supplied before aesthetics import)
    GHL_API_KEY_SLIMMING   — Slimming PIT (must be supplied before slimming import)
"""
import os
from pathlib import Path
from typing import Optional

from dotenv import load_dotenv

BASE = Path(__file__).parent.parent.parent
load_dotenv(BASE / ".env")

# Migration tag conventions — different month per batch so rollback is scoped.
# Spa was imported in 2026-04. Aesthetics + Slimming are 2026-05.
MIGRATION_TAGS = {
    "spa":        "zoho_migrated_2026_04",
    "aesthetics": "zoho_migrated_2026_05",
    "slimming":   "zoho_migrated_2026_05",
}


BRAND_CONFIG = {
    "spa": {
        "location_id": "TrtSnBSSKBOkVVNxJ3AM",
        "api_key_env": "GHL_API_KEY",
        "source_tag":  "source:zoho_spa",
        "zoho_env":    "SPA",
    },
    "aesthetics": {
        "location_id": "Goi7kzVK7iwe2woxUHkT",
        "api_key_env": "GHL_API_KEY_AESTHETICS",
        "source_tag":  "source:zoho_aesthetics",
        "zoho_env":    "AES",
    },
    "slimming": {
        "location_id": "imWIWDcnmOfijW0lltPq",
        "api_key_env": "GHL_API_KEY_SLIMMING",
        "source_tag":  "source:zoho_slimming",
        "zoho_env":    "SLIM",
    },
}


def get_brand(brand: str) -> dict:
    if brand not in BRAND_CONFIG:
        raise ValueError(f"Unknown brand: {brand!r}. Known: {list(BRAND_CONFIG)}")
    cfg = dict(BRAND_CONFIG[brand])
    cfg["brand"] = brand
    cfg["migration_tag"] = MIGRATION_TAGS[brand]
    return cfg


def require_api_key(brand: str) -> str:
    """Return the GHL API key for a brand. Raises if not set in .env."""
    cfg = get_brand(brand)
    key = os.getenv(cfg["api_key_env"])
    if not key:
        raise RuntimeError(
            f"Missing env var {cfg['api_key_env']} for brand {brand}. "
            f"Set it in .env to a GHL Private Integration Token for location "
            f"{cfg['location_id']} with scopes contacts.write, opportunities.write, "
            f"tags.write, notes.write, tasks.write, customFields.write/read."
        )
    return key


def get_api_key(brand: str) -> Optional[str]:
    """Return the GHL API key for a brand, or None if not set (for soft checks)."""
    cfg = get_brand(brand)
    return os.getenv(cfg["api_key_env"])
