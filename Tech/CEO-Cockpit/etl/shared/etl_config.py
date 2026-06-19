import json
import os

_config: dict | None = None

def get_config() -> dict:
    global _config
    if _config is None:
        config_path = os.path.join(
            os.path.dirname(__file__), '..', '..', '..', 'config', 'cockpit_sources.json'
        )
        with open(config_path) as f:
            _config = json.load(f)
    return _config

def get_sheet_config(sheet_key: str) -> dict:
    return get_config()['google_sheets'][sheet_key]

def get_api_config(api_key: str) -> dict:
    return get_config()['api_sources'][api_key]

def get_brand_id(slug: str) -> int:
    mapping = {'spa': 1, 'aesthetics': 2, 'slimming': 3}
    return mapping[slug]


# Location IDs matching cockpit/supabase/seed/002_locations.sql insertion order.
_LOCATION_MAP: dict[str, int] = {
    'Inter': 1, 'InterContinental': 1,
    'Hugos': 2, "Hugo's": 2,
    'Hyatt': 3,
    'Ramla': 4, 'Ramla Bay': 4,
    'Labranda': 5,
    'Odycy': 6,
    'Excelsior': 7,
    'Novotel': 8,
    'Aesthetics Clinic': 9, 'Aesthetics': 9,
    'Slimming Clinic': 10, 'Slimming': 10,
}


def get_location_id(name: str) -> int:
    """Resolve a location display name to its database ID.

    Raises KeyError if the name is not recognised.
    """
    loc_id = _LOCATION_MAP.get(name)
    if loc_id is None:
        raise KeyError(f"Unknown location: {name!r}")
    return loc_id
