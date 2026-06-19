"""Helper to parse Google Sheets data."""

def parse_sheet_values(raw_values: list[list[str]], header_row: int = 0) -> list[dict]:
    if not raw_values or len(raw_values) <= header_row:
        return []
    headers = [str(h).strip() for h in raw_values[header_row]]
    rows = []
    for row in raw_values[header_row + 1:]:
        if not any(cell for cell in row):
            continue
        padded = row + [''] * (len(headers) - len(row))
        rows.append(dict(zip(headers, padded)))
    return rows

def safe_float(value: str, default: float = 0.0) -> float:
    if not value or value.strip() == '' or value.strip() == '-':
        return default
    cleaned = value.replace('EUR', '').replace('\u20ac', '').replace(',', '').replace('%', '').strip()
    try:
        return float(cleaned)
    except ValueError:
        return default

def safe_int(value: str, default: int = 0) -> int:
    return int(safe_float(value, float(default)))
