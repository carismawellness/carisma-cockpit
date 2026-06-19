"""
ETL: Google Analytics 4 -> Supabase
Writes: ga4_daily
Schedule: Daily 06:00
"""
from shared.supabase_client import upsert
from shared.etl_logger import ETLLogger
from shared.etl_config import get_brand_id
from shared.sheets_reader import safe_float, safe_int

def run(report_data: dict[str, list[dict]]) -> dict:
    logger = ETLLogger('ga4')
    logger.start()
    total = 0
    try:
        for brand_slug, daily_rows in report_data.items():
            brand_id = get_brand_id(brand_slug)
            rows = []
            for day in daily_rows:
                rows.append({
                    'date': day['date'],
                    'brand_id': brand_id,
                    'sessions': safe_int(str(day.get('sessions', 0))),
                    'total_users': safe_int(str(day.get('totalUsers', 0))),
                    'new_users': safe_int(str(day.get('newUsers', 0))),
                    'page_views': safe_int(str(day.get('screenPageViews', 0))),
                    'avg_session_duration_sec': safe_float(str(day.get('averageSessionDuration', 0))),
                    'bounce_rate_pct': round(safe_float(str(day.get('bounceRate', 0))) * 100, 2),
                    'conversions': safe_int(str(day.get('conversions', 0))),
                })
            count = upsert('ga4_daily', rows, 'date,brand_id')
            total += count
        logger.complete(total)
        return {'rows_upserted': total, 'status': 'success'}
    except Exception as e:
        logger.fail(str(e))
        return {'rows_upserted': total, 'status': 'failed', 'error': str(e)}
