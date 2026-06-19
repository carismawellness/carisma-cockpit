"""
ETL: EBITDA Google Sheet -> Supabase
Writes: ebitda_monthly
Schedule: 5th of month 10:00
"""
from shared.supabase_client import upsert
from shared.etl_logger import ETLLogger
from shared.etl_config import get_brand_id, get_sheet_config
from shared.sheets_reader import safe_float

# EBITDA Summary tab expected row labels (column A) mapped to brand slugs.
# The sheet has sections per brand with rows: Revenue, COGS, Gross Profit, Opex, EBITDA, EBITDA Margin %.
_BRAND_SECTIONS = {
    'Spa': 'spa',
    'Aesthetics': 'aesthetics',
    'Slimming': 'slimming',
}


def run(sheet_data: dict[str, list[list[str]]]) -> dict:
    logger = ETLLogger('ebitda')
    logger.start()
    total = 0
    try:
        cfg = get_sheet_config('ebitda')
        summary_tab = cfg['output_tabs']['ebitda_summary']
        if summary_tab in sheet_data:
            rows = _process_ebitda_summary(sheet_data[summary_tab])
            total += upsert('ebitda_monthly', rows, 'month,brand_id')
        logger.complete(total)
        return {'rows_upserted': total, 'status': 'success'}
    except Exception as e:
        logger.fail(str(e))
        return {'rows_upserted': total, 'status': 'failed', 'error': str(e)}


def _process_ebitda_summary(raw: list[list[str]]) -> list[dict]:
    """Parse EBITDA Summary tab.

    Layout: Row 0 has month headers starting from column B/C onward.
    Then brand sections with metric rows (Revenue, COGS, Gross Profit, Opex, EBITDA, EBITDA Margin %).
    """
    if len(raw) < 3:
        return []

    # Find month columns from header row (row 0 or 1)
    month_row = raw[0]
    month_start_col = 1  # Column B onward
    months = []
    for col_idx in range(month_start_col, len(month_row)):
        val = str(month_row[col_idx]).strip()
        if val:
            months.append((col_idx, val))

    if not months:
        # Try row 1 as header
        if len(raw) > 1:
            month_row = raw[1]
            for col_idx in range(month_start_col, len(month_row)):
                val = str(month_row[col_idx]).strip()
                if val:
                    months.append((col_idx, val))

    if not months:
        return []

    # Scan rows for brand section headers and their metric rows
    rows = []
    current_brand_slug = None
    metric_rows: dict[str, int] = {}
    metric_labels = ['revenue', 'cogs', 'gross profit', 'opex', 'ebitda margin', 'ebitda']

    for row_idx, row in enumerate(raw):
        if not row:
            continue
        label = str(row[0]).strip()
        label_lower = label.lower()

        # Check for brand section header
        for brand_label, slug in _BRAND_SECTIONS.items():
            if brand_label.lower() == label_lower:
                # Emit previous brand if we have data
                if current_brand_slug and metric_rows:
                    rows.extend(_emit_brand_months(raw, current_brand_slug, metric_rows, months))
                current_brand_slug = slug
                metric_rows = {}
                break

        # Check for metric row labels
        for metric in metric_labels:
            if metric in label_lower:
                # Use most specific match: 'ebitda margin' before 'ebitda'
                if metric == 'ebitda' and 'margin' in label_lower:
                    metric_rows['ebitda_margin_pct'] = row_idx
                elif metric == 'ebitda margin':
                    metric_rows['ebitda_margin_pct'] = row_idx
                elif metric == 'gross profit':
                    metric_rows['gross_profit'] = row_idx
                else:
                    metric_rows[metric] = row_idx
                break

    # Emit last brand
    if current_brand_slug and metric_rows:
        rows.extend(_emit_brand_months(raw, current_brand_slug, metric_rows, months))

    return rows


def _emit_brand_months(
    raw: list[list[str]],
    brand_slug: str,
    metric_rows: dict[str, int],
    months: list[tuple[int, str]],
) -> list[dict]:
    """Build ebitda_monthly rows for one brand across all month columns."""
    brand_id = get_brand_id(brand_slug)
    rows = []
    for col_idx, month_label in months:
        row = {
            'month': month_label,
            'brand_id': brand_id,
        }
        for metric_key, row_idx in metric_rows.items():
            data_row = raw[row_idx]
            val = str(data_row[col_idx]) if col_idx < len(data_row) else ''
            row[metric_key] = safe_float(val)
        rows.append(row)
    return rows
