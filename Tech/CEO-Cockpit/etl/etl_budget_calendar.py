"""
ETL: Marketing Budget Calendar -> Supabase
Writes: budget_vs_actual
Schedule: Monday 08:00
"""
from shared.supabase_client import upsert
from shared.etl_logger import ETLLogger
from shared.etl_config import get_brand_id, get_sheet_config
from shared.sheets_reader import safe_float

# Brand slug keywords to match in department/channel column
_BRAND_KEYWORDS = {
    'spa': 'spa',
    'aesthetics': 'aesthetics',
    'slimming': 'slimming',
}


def run(sheet_data: dict[str, list[list[str]]]) -> dict:
    logger = ETLLogger('budget_calendar')
    logger.start()
    total = 0
    try:
        cfg = get_sheet_config('budget_allocation')
        for tab_key, tab_name in cfg['tabs'].items():
            if tab_name in sheet_data:
                rows = _process_calendar_tab(sheet_data[tab_name])
                total += upsert('budget_vs_actual', rows, 'month,brand_id,department')
        logger.complete(total)
        return {'rows_upserted': total, 'status': 'success'}
    except Exception as e:
        logger.fail(str(e))
        return {'rows_upserted': total, 'status': 'failed', 'error': str(e)}


def _process_calendar_tab(raw: list[list[str]]) -> list[dict]:
    """Parse a Calendar tab into budget_vs_actual rows.

    Expected layout: header row with month columns (Jan, Feb, ...) and
    rows with department/channel labels in column A and budget amounts across month columns.
    """
    if len(raw) < 2:
        return []

    # Find month columns from header row
    header = raw[0]
    month_cols: list[tuple[int, str]] = []
    month_names = ['jan', 'feb', 'mar', 'apr', 'may', 'jun',
                   'jul', 'aug', 'sep', 'oct', 'nov', 'dec']
    for col_idx, cell in enumerate(header):
        cell_lower = str(cell).strip().lower()
        for mn in month_names:
            if cell_lower.startswith(mn):
                month_cols.append((col_idx, str(cell).strip()))
                break

    if not month_cols:
        return []

    rows = []
    for data_row in raw[1:]:
        if not data_row:
            continue
        dept_label = str(data_row[0]).strip()
        if not dept_label:
            continue

        # Determine brand from department label
        brand_slug = None
        dept_lower = dept_label.lower()
        for keyword, slug in _BRAND_KEYWORDS.items():
            if keyword in dept_lower:
                brand_slug = slug
                break
        if not brand_slug:
            # Default to spa for generic marketing line items
            brand_slug = 'spa'

        brand_id = get_brand_id(brand_slug)

        for col_idx, month_label in month_cols:
            if col_idx >= len(data_row):
                continue
            budgeted = safe_float(str(data_row[col_idx]))
            if budgeted == 0.0:
                continue
            rows.append({
                'month': month_label,
                'brand_id': brand_id,
                'department': dept_label,
                'budgeted': budgeted,
            })

    return rows
