"""
ETL: Aesthetics Sales Google Sheet -> Supabase
Writes: sales_by_rep, consult_funnel
Schedule: Daily 20:00
"""
from shared.supabase_client import upsert
from shared.etl_logger import ETLLogger
from shared.etl_config import get_sheet_config, get_brand_id
from shared.sheets_reader import safe_float, safe_int

def run(sheet_data: dict[str, list[list[str]]]) -> dict:
    logger = ETLLogger('aesthetics_sales')
    logger.start()
    total = 0
    brand_id = get_brand_id('aesthetics')
    try:
        for tab_name, raw in sheet_data.items():
            if tab_name.startswith('Sale'):
                rep_rows = _process_sales_tab(raw, brand_id)
                count = upsert('sales_by_rep', rep_rows, 'date,staff_id')
                total += count
        logger.complete(total)
        return {'rows_upserted': total, 'status': 'success'}
    except Exception as e:
        logger.fail(str(e))
        return {'rows_upserted': total, 'status': 'failed', 'error': str(e)}

def _col_index(col_letter: str) -> int:
    """Convert a column letter (A, B, ...) to a 0-based index."""
    return ord(col_letter.upper()) - ord('A')


def _process_sales_tab(raw: list[list[str]], brand_id: int) -> list[dict]:
    """Parse aesthetics sales tab into sales_by_rep rows.

    Config columns: date_of_service=D(3), price=E(4), sales_staff=G(6).
    First row is assumed to be a header; data starts at row index 1.
    """
    config = get_sheet_config('aesthetics_sales')
    cols = config['columns']
    date_col = _col_index(cols['date_of_service'])       # D -> 3
    price_col = _col_index(cols['price'])                 # E -> 4
    staff_col = _col_index(cols['sales_staff'])           # G -> 6
    rows = []
    # Skip header row (index 0)
    for row in raw[1:]:
        if len(row) <= max(date_col, price_col, staff_col):
            continue
        date_val = str(row[date_col]).strip()
        staff_val = str(row[staff_col]).strip()
        if not date_val or not staff_val:
            continue
        revenue = safe_float(str(row[price_col]))
        if revenue == 0.0:
            continue
        rows.append({
            'date': date_val,
            'brand_id': brand_id,
            'staff_name': staff_val,
            'revenue': revenue,
        })
    return rows
