"""
ETL: Wix -> Supabase
Writes: ga4_daily (supplement with Wix conversion data)
Schedule: Daily 07:00

Wix data arrives as a dict with keys per brand site:
{
  'spa': [{'date': '...', 'sessions': N, 'conversions': N, 'page_views': N, ...}],
  'aesthetics': [...],
  'slimming': [...],
}
"""
from shared.supabase_client import upsert
from shared.etl_logger import ETLLogger
from shared.etl_config import get_brand_id


def run(wix_data: dict) -> dict:
    logger = ETLLogger('wix')
    logger.start()
    total = 0
    try:
        for brand_slug, site_records in wix_data.items():
            if not site_records:
                continue
            brand_id = get_brand_id(brand_slug)
            rows = _process_site_data(site_records, brand_id)
            total += upsert('ga4_daily', rows, 'date,brand_id')
        logger.complete(total)
        return {'rows_upserted': total, 'status': 'success'}
    except Exception as e:
        logger.fail(str(e))
        return {'rows_upserted': total, 'status': 'failed', 'error': str(e)}


def _process_site_data(records: list[dict], brand_id: int) -> list[dict]:
    """Transform Wix site analytics records into ga4_daily rows.

    Wix analytics fields are mapped to GA4-compatible columns so the
    dashboard can blend both data sources.
    """
    rows = []
    for rec in records:
        date_val = rec.get('date', '').strip()
        if not date_val:
            continue
        rows.append({
            'date': date_val,
            'brand_id': brand_id,
            'sessions': rec.get('sessions', 0) or 0,
            'total_users': rec.get('visitors', 0) or rec.get('total_users', 0) or 0,
            'new_users': rec.get('new_visitors', 0) or rec.get('new_users', 0) or 0,
            'page_views': rec.get('page_views', 0) or 0,
            'avg_session_duration_sec': rec.get('avg_session_duration', 0) or 0,
            'bounce_rate_pct': rec.get('bounce_rate', 0) or 0,
            'conversions': rec.get('conversions', 0) or rec.get('form_submissions', 0) or 0,
        })
    return rows
