"""
ETL: Salary Master Google Sheet -> Supabase
Writes: hr_weekly (total_salary_cost, hc_pct)
Schedule: 1st of month 10:00
"""
import re
from shared.supabase_client import upsert
from shared.etl_logger import ETLLogger
from shared.etl_config import get_brand_id, get_location_id
from shared.sheets_reader import safe_float

# Map tab name pattern "{Mon} {YY} (C)" to first-of-month date string
_MONTH_MAP = {
    'Jan': '01', 'Feb': '02', 'Mar': '03', 'Apr': '04',
    'May': '05', 'Jun': '06', 'Jul': '07', 'Aug': '08',
    'Sep': '09', 'Oct': '10', 'Nov': '11', 'Dec': '12',
}

# Known location labels that appear in column A of salary tabs
_SPA_LOCATIONS = ['Inter', 'Hugos', 'Hyatt', 'Ramla', 'Labranda', 'Odycy', 'Excelsior', 'Novotel']


def _parse_tab_month(tab_name: str) -> str | None:
    """Extract a YYYY-MM-01 date from tab name like 'Apr 26 (C)'."""
    m = re.match(r'(\w{3})\s+(\d{2})\s*\(C\)', tab_name)
    if not m:
        return None
    mon_str, yy = m.group(1), m.group(2)
    mm = _MONTH_MAP.get(mon_str)
    if not mm:
        return None
    return f"20{yy}-{mm}-01"


def run(sheet_data: dict[str, list[list[str]]]) -> dict:
    logger = ETLLogger('salary_master')
    logger.start()
    total = 0
    try:
        for tab_name, raw in sheet_data.items():
            month_date = _parse_tab_month(tab_name)
            if not month_date:
                continue
            rows = _process_salary_tab(raw, month_date)
            total += upsert('hr_weekly', rows, 'week_start,location_id')
        logger.complete(total)
        return {'rows_upserted': total, 'status': 'success'}
    except Exception as e:
        logger.fail(str(e))
        return {'rows_upserted': total, 'status': 'failed', 'error': str(e)}


def _process_salary_tab(raw: list[list[str]], month_date: str) -> list[dict]:
    """Parse a monthly salary tab to extract total salary cost per location.

    Scans rows for location name in column A and a total salary value in the
    rightmost populated numeric column of that row (typically a "Total" column).
    """
    brand_id = get_brand_id('spa')
    rows = []

    # Try to find the "Total" column index from the header row
    total_col = None
    if raw:
        for col_idx, cell in enumerate(raw[0]):
            if 'total' in str(cell).lower():
                total_col = col_idx
                break

    for row in raw[1:]:
        if not row:
            continue
        label = str(row[0]).strip()
        matched_loc = None
        for loc in _SPA_LOCATIONS:
            if loc.lower() in label.lower():
                matched_loc = loc
                break
        if not matched_loc:
            continue

        # Read salary total from the identified total column or last numeric column
        salary = 0.0
        if total_col is not None and total_col < len(row):
            salary = safe_float(str(row[total_col]))
        else:
            # Fallback: scan rightward for the last non-empty numeric value
            for col_idx in range(len(row) - 1, 0, -1):
                val = safe_float(str(row[col_idx]))
                if val != 0.0:
                    salary = val
                    break

        if salary == 0.0:
            continue

        rows.append({
            'week_start': month_date,  # Using first-of-month as week_start for monthly salary data
            'location_id': get_location_id(matched_loc),
            'brand_id': brand_id,
            'total_salary_cost': salary,
        })

    return rows
