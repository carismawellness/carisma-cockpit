"""
ETL: Brand Standards Google Sheet -> Supabase
Writes: brand_standards
Schedule: 1st of month 09:00

Parses facility, front desk, and mystery guest checklist tabs from the
Accounting Master spreadsheet.  Each tab has a matrix layout:
  - Row 0: month headers spanning N location columns each
  - Row 1: location names repeating under each month
  - Row 2: overall % scores (skipped)
  - Row 3+: checklist items grouped by category headers
Data cells contain "TRUE" / "FALSE" strings.
"""
from __future__ import annotations

import re
from datetime import datetime

from shared.supabase_client import upsert
from shared.etl_logger import ETLLogger
from shared.etl_config import get_sheet_config

# ---------------------------------------------------------------------------
# Month parsing
# ---------------------------------------------------------------------------

_MONTH_NAMES = {
    'january': 1, 'february': 2, 'march': 3, 'april': 4,
    'may': 5, 'june': 6, 'july': 7, 'august': 8,
    'september': 9, 'october': 10, 'november': 11, 'december': 12,
}

_MONTH_RE = re.compile(
    r'(' + '|'.join(_MONTH_NAMES) + r')\s+(\d{4})',
    re.IGNORECASE,
)


def _parse_month(text: str) -> str | None:
    """'August 2024' -> '2024-08-01', or None if not a month header."""
    m = _MONTH_RE.search(text.strip())
    if not m:
        return None
    month_num = _MONTH_NAMES[m.group(1).lower()]
    year = int(m.group(2))
    return f'{year}-{month_num:02d}-01'


# ---------------------------------------------------------------------------
# Location normalisation
# ---------------------------------------------------------------------------

_LOCATION_ALIASES: dict[str, str] = {
    'inter': 'Inter',
    'intercontinental': 'Inter',
    'hugos': 'Hugos',
    "hugo's": 'Hugos',
    'hyatt': 'Hyatt',
    'ramla': 'Ramla',
    'ramla bay': 'Ramla',
    'labranda': 'Labranda',
    'sunny': 'Sunny',
    'excelsior': 'Excelsior',
    'novotel': 'Novotel',
    'riviera': 'Riviera',
    'odycy': 'Odycy',
}


def _normalise_location(name: str) -> str | None:
    """Return canonical location name or None if unrecognised."""
    key = name.strip().lower()
    return _LOCATION_ALIASES.get(key)


# ---------------------------------------------------------------------------
# Row classification helpers
# ---------------------------------------------------------------------------

def _is_true_false(val: str) -> bool:
    return val.strip().upper() in ('TRUE', 'FALSE')


def _parse_bool(val: str) -> bool:
    return val.strip().upper() == 'TRUE'


def _is_percentage(val: str) -> bool:
    """Detect overall-% rows like '85%' or '0.85'."""
    v = val.strip().rstrip('%')
    try:
        f = float(v)
        return 0 <= f <= 100
    except ValueError:
        return False


def _cell(row: list[str], idx: int) -> str:
    """Safe cell access."""
    if idx < len(row):
        return str(row[idx]).strip()
    return ''


# ---------------------------------------------------------------------------
# Core tab parser
# ---------------------------------------------------------------------------

def _process_tab(raw: list[list[str]], standard_type: str) -> list[dict]:
    """Parse one checklist tab into brand_standards rows."""
    if len(raw) < 4:
        return []

    # ---- Step 1: Build (month, location, col_index) mapping from rows 0-1 ----
    header_row = raw[0]
    location_row = raw[1] if len(raw) > 1 else []

    # Determine which columns have month headers (they span multiple cols).
    # Propagate the last seen month forward.
    col_months: dict[int, str] = {}  # col_index -> date string
    current_month: str | None = None
    for col_idx in range(len(header_row)):
        val = _cell(header_row, col_idx)
        parsed = _parse_month(val) if val else None
        if parsed:
            current_month = parsed
        if current_month:
            col_months[col_idx] = current_month

    if not col_months:
        return []

    # Map each data column to (month, location)
    col_map: list[tuple[str, str]] = []  # indexed by col, value = (month, loc)
    # We'll build a sparse list the size of the widest row
    max_col = max(col_months.keys()) + 1
    if len(location_row) > max_col:
        max_col = len(location_row)

    col_pairs: dict[int, tuple[str, str]] = {}
    for col_idx in range(max_col):
        month = col_months.get(col_idx)
        if not month:
            continue
        loc_name = _cell(location_row, col_idx)
        loc = _normalise_location(loc_name) if loc_name else None
        if loc:
            col_pairs[col_idx] = (month, loc)

    if not col_pairs:
        return []

    # ---- Step 2: Determine where the item text lives ----
    # Facility tabs: item text in col B (index 1), col A often empty
    # Front desk tabs: item text in col A (index 0), col B empty
    # We detect this by checking which column has more non-empty text in data rows.
    data_start = 3  # skip header, locations, percentages
    col_a_count = 0
    col_b_count = 0
    for row_idx in range(data_start, min(len(raw), data_start + 30)):
        r = raw[row_idx]
        a = _cell(r, 0)
        b = _cell(r, 1)
        if a:
            col_a_count += 1
        if b:
            col_b_count += 1

    # If col B has more text, items are in col B; otherwise col A.
    # The "other" column may hold category headers or be empty.
    if col_b_count > col_a_count:
        item_col = 1
        alt_col = 0
    else:
        item_col = 0
        alt_col = 1

    # ---- Step 3: Walk data rows, tracking current category ----
    rows_out: list[dict] = []
    current_category = 'General'

    for row_idx in range(data_start, len(raw)):
        r = raw[row_idx]
        item_text = _cell(r, item_col)
        alt_text = _cell(r, alt_col)

        # Skip completely empty rows
        if not item_text and not alt_text:
            continue

        # Collect all TRUE/FALSE values in data columns for this row
        tf_values: dict[int, bool] = {}
        has_tf = False
        for col_idx in col_pairs:
            val = _cell(r, col_idx)
            if _is_true_false(val):
                tf_values[col_idx] = _parse_bool(val)
                has_tf = True

        # If no TRUE/FALSE values, this is either a category header or a
        # percentage/summary row -> treat as category header if there's text.
        if not has_tf:
            # Use whichever column has text as the category name
            cat_text = item_text or alt_text
            if cat_text:
                # Clean up category: remove trailing colons, normalise whitespace
                cat_text = cat_text.strip().rstrip(':').strip()
                # Skip pure percentage rows (e.g. "85%")
                if cat_text and not _is_percentage(cat_text):
                    current_category = cat_text
            continue

        # This is a checklist item row.
        # Determine the item label: prefer item_col, fall back to alt_col.
        label = item_text or alt_text
        if not label:
            continue  # skip rows with TRUE/FALSE but no label

        # Skip percentage summary rows that happen to have some TRUE/FALSE
        if _is_percentage(label):
            continue

        for col_idx, result in tf_values.items():
            month, location = col_pairs[col_idx]
            rows_out.append({
                'month': month,
                'standard_type': standard_type,
                'category': current_category,
                'item': label,
                'location': location,
                'result': result,
            })

    return rows_out


# ---------------------------------------------------------------------------
# Public entry point
# ---------------------------------------------------------------------------

def run(sheet_data: dict[str, list[list[str]]]) -> dict:
    """Process all brand standards tabs and upsert to Supabase."""
    logger = ETLLogger('brand_standards')
    logger.start()
    total = 0

    try:
        cfg = get_sheet_config('brand_standards')
        tabs = cfg.get('tabs', {})

        all_rows: list[dict] = []
        for tab_key, tab_cfg in tabs.items():
            tab_name = tab_cfg['tab_name']
            standard_type = tab_cfg['standard_type']
            if tab_name not in sheet_data:
                continue
            rows = _process_tab(sheet_data[tab_name], standard_type)
            all_rows.extend(rows)

        if all_rows:
            total = upsert(
                'brand_standards',
                all_rows,
                'month,standard_type,item,location',
            )

        logger.complete(total)
        return {'rows_upserted': total, 'status': 'success'}

    except Exception as e:
        logger.fail(str(e))
        return {'rows_upserted': total, 'status': 'failed', 'error': str(e)}
