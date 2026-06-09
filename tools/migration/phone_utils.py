"""Phone number normalization to E.164 format."""
import re
import phonenumbers


# Malta is the default country when no country code is present
DEFAULT_COUNTRY = "MT"


from typing import Optional, List

def normalize_phone(raw: Optional[str]) -> Optional[str]:
    """
    Normalize a phone number to E.164 format (+356XXXXXXXX for Malta).
    Returns None if the number cannot be parsed or is invalid.
    """
    if not raw:
        return None

    raw = raw.strip()
    if not raw:
        return None

    # Remove common formatting noise
    cleaned = re.sub(r"[\s\-\.\(\)\/]", "", raw)

    # Try parsing as-is (handles numbers with country code)
    try:
        parsed = phonenumbers.parse(cleaned, DEFAULT_COUNTRY)
        if phonenumbers.is_valid_number(parsed):
            return phonenumbers.format_number(parsed, phonenumbers.PhoneNumberFormat.E164)
    except phonenumbers.NumberParseException:
        pass

    # Try with explicit + prefix if not already there
    if not cleaned.startswith("+"):
        try:
            parsed = phonenumbers.parse("+" + cleaned, None)
            if phonenumbers.is_valid_number(parsed):
                return phonenumbers.format_number(parsed, phonenumbers.PhoneNumberFormat.E164)
        except phonenumbers.NumberParseException:
            pass

    return None


def is_valid_phone(raw: Optional[str]) -> bool:
    return normalize_phone(raw) is not None


def normalize_phone_list(phones: List[Optional[str]]) -> List[str]:
    """Normalize a list and return only valid E.164 results, deduplicated."""
    seen = set()
    result = []
    for p in phones:
        normalized = normalize_phone(p)
        if normalized and normalized not in seen:
            seen.add(normalized)
            result.append(normalized)
    return result
