"""
ETL: Slimming Sales Google Sheet -> Supabase
Writes: sales_by_rep, consult_funnel
Schedule: Daily 20:00
"""
from shared.supabase_client import upsert
from shared.etl_logger import ETLLogger
from shared.etl_config import get_sheet_config, get_brand_id
from shared.sheets_reader import safe_float, safe_int

def run(sheet_data: dict[str, list[list[str]]]) -> dict:
    logger = ETLLogger('slimming_sales')
    logger.start()
    total = 0
    brand_id = get_brand_id('slimming')
    try:
        for tab_name, raw in sheet_data.items():
            if tab_name.startswith('Sales'):
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
    """Parse slimming sales tab into sales_by_rep rows.

    Config columns: date=A(0), paid=H(7).
    First row is assumed to be a header; data starts at row index 1.
    """
    config = get_sheet_config('slimming_sales')
    cols = config['columns']
    date_col = _col_index(cols['date'])   # A -> 0
    paid_col = _col_index(cols['paid'])   # H -> 7
    # sale_of column tracks who made the sale (optional rep info)
    sale_of_col = _col_index(cols.get('sale_of', 'I'))  # I -> 8
    rows = []
    # Skip header row (index 0)
    for row in raw[1:]:
        if len(row) <= paid_col:
            continue
        date_val = str(row[date_col]).strip()
        if not date_val:
            continue
        revenue = safe_float(str(row[paid_col]))
        if revenue == 0.0:
            continue
        staff_val = ''
        if len(row) > sale_of_col:
            staff_val = str(row[sale_of_col]).strip()
        row_dict = {
            'date': date_val,
            'brand_id': brand_id,
            'revenue': revenue,
        }
        if staff_val:
            row_dict['staff_name'] = staff_val
        rows.append(row_dict)
    return rows
