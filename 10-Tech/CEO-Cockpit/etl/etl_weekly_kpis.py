"""
ETL: Weekly KPIs Google Sheet -> Supabase
Reads: Sales tab, HR tab, Operations tab, Growth tab
Writes: sales_weekly, hr_weekly, operations_weekly, marketing_daily
Schedule: Monday 09:00
"""
from shared.supabase_client import upsert
from shared.etl_logger import ETLLogger
from shared.etl_config import get_sheet_config, get_brand_id, get_location_id
from shared.sheets_reader import safe_float, safe_int

def run(sheet_data: dict[str, list[list[str]]]) -> dict:
    logger = ETLLogger('weekly_kpis')
    logger.start()
    total = 0
    try:
        if 'Sales' in sheet_data:
            sales_rows = _process_sales_tab(sheet_data['Sales'])
            count = upsert('sales_weekly', sales_rows, 'week_start,location_id')
            total += count
        if 'HR ' in sheet_data:
            hr_rows = _process_hr_tab(sheet_data['HR '])
            count = upsert('hr_weekly', hr_rows, 'week_start,location_id')
            total += count
        if 'Operations' in sheet_data:
            ops_rows = _process_ops_tab(sheet_data['Operations'])
            count = upsert('operations_weekly', ops_rows, 'week_start,location_id')
            total += count
        logger.complete(total)
        return {'rows_upserted': total, 'status': 'success'}
    except Exception as e:
        logger.fail(str(e))
        return {'rows_upserted': total, 'status': 'failed', 'error': str(e)}

def _parse_week_dates(raw: list[list[str]], date_row: int, start_col: int) -> list[str]:
    """Extract week-start date strings from the date row, starting at start_col."""
    if len(raw) <= date_row:
        return []
    row = raw[date_row]
    dates = []
    for col_idx in range(start_col, len(row)):
        val = str(row[col_idx]).strip()
        if val and val != '-':
            dates.append(val)
        else:
            dates.append('')
    return dates


def _process_sales_tab(raw: list[list[str]]) -> list[dict]:
    """Parse Sales tab: weeks-as-columns layout with per-location revenue rows."""
    cfg = get_sheet_config('weekly_kpis')
    sales_cfg = cfg['tabs']['sales']
    # Config uses 1-indexed rows; convert to 0-indexed for array access
    date_row_0 = sales_cfg['week_dates_row'] - 1  # row 2 -> index 1
    start_col_0 = ord(sales_cfg['week_dates_start_col']) - ord('A')  # 'D' -> 3
    week_dates = _parse_week_dates(raw, date_row_0, start_col_0)
    spa_section = sales_cfg['spa_sales_section']
    brand_id = get_brand_id('spa')
    rows = []
    for loc_name, sheet_row_1 in spa_section['spas'].items():
        row_idx = sheet_row_1 - 1  # convert 1-indexed to 0-indexed
        if row_idx >= len(raw):
            continue
        data_row = raw[row_idx]
        for i, week_date in enumerate(week_dates):
            if not week_date:
                continue
            col_idx = start_col_0 + i
            if col_idx >= len(data_row):
                continue
            revenue = safe_float(str(data_row[col_idx]))
            if revenue == 0.0:
                continue
            rows.append({
                'week_start': week_date,
                'location_id': get_location_id(loc_name),
                'brand_id': brand_id,
                'revenue_ex_vat': revenue,
            })
    return rows


def _process_hr_tab(raw: list[list[str]]) -> list[dict]:
    """Parse HR tab: weeks-as-columns layout with HC% and utilization per location."""
    cfg = get_sheet_config('weekly_kpis')
    hr_cfg = cfg['tabs']['hr']
    date_row_0 = hr_cfg['week_dates_row'] - 1
    start_col_0 = ord(hr_cfg['week_dates_start_col']) - ord('A')
    week_dates = _parse_week_dates(raw, date_row_0, start_col_0)
    brand_id = get_brand_id('spa')
    # Scan for location label rows — look for known location names in column A/B
    location_rows: dict[str, int] = {}
    spa_locations = ['Inter', 'Hugos', 'Hyatt', 'Ramla', 'Labranda', 'Odycy', 'Excelsior', 'Novotel']
    for row_idx, row in enumerate(raw):
        if not row:
            continue
        label = str(row[0]).strip()
        for loc in spa_locations:
            if loc.lower() in label.lower():
                location_rows[loc] = row_idx
                break
    rows = []
    for loc_name, row_idx in location_rows.items():
        data_row = raw[row_idx]
        for i, week_date in enumerate(week_dates):
            if not week_date:
                continue
            col_idx = start_col_0 + i
            if col_idx >= len(data_row):
                continue
            val = safe_float(str(data_row[col_idx]))
            if val == 0.0:
                continue
            rows.append({
                'week_start': week_date,
                'location_id': get_location_id(loc_name),
                'brand_id': brand_id,
                'hc_pct': val,
            })
    return rows


def _process_ops_tab(raw: list[list[str]]) -> list[dict]:
    """Parse Operations tab: weeks-as-columns with Google reviews per location."""
    cfg = get_sheet_config('weekly_kpis')
    ops_cfg = cfg['tabs']['operations']
    date_row_0 = ops_cfg['week_dates_row'] - 1
    start_col_0 = ord(ops_cfg['week_dates_start_col']) - ord('A')
    week_dates = _parse_week_dates(raw, date_row_0, start_col_0)
    brand_id = get_brand_id('spa')
    # Scan for location label rows
    location_rows: dict[str, int] = {}
    spa_locations = ['Inter', 'Hugos', 'Hyatt', 'Ramla', 'Labranda', 'Odycy', 'Excelsior', 'Novotel']
    for row_idx, row in enumerate(raw):
        if not row:
            continue
        label = str(row[0]).strip()
        for loc in spa_locations:
            if loc.lower() in label.lower():
                location_rows[loc] = row_idx
                break
    rows = []
    for loc_name, row_idx in location_rows.items():
        data_row = raw[row_idx]
        for i, week_date in enumerate(week_dates):
            if not week_date:
                continue
            col_idx = start_col_0 + i
            if col_idx >= len(data_row):
                continue
            val = safe_float(str(data_row[col_idx]))
            rows.append({
                'week_start': week_date,
                'location_id': get_location_id(loc_name),
                'brand_id': brand_id,
                'google_reviews_avg': val,
            })
    return rows
