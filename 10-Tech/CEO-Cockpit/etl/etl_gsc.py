"""
ETL: Google Search Console -> Supabase
Writes: gsc_daily
Schedule: Daily 06:00
"""
from shared.supabase_client import upsert
from shared.etl_logger import ETLLogger
from shared.etl_config import get_brand_id
from shared.sheets_reader import safe_float, safe_int

def run(report_data: dict[str, list[dict]]) -> dict:
    logger = ETLLogger('gsc')
    logger.start()
    total = 0
    try:
        for brand_slug, daily_rows in report_data.items():
            brand_id = get_brand_id(brand_slug)
            rows = [{
                'date': day['date'],
                'brand_id': brand_id,
                'clicks': safe_int(str(day.get('clicks', 0))),
                'impressions': safe_int(str(day.get('impressions', 0))),
                'ctr_pct': round(safe_float(str(day.get('ctr', 0))) * 100, 2),
                'avg_position': safe_float(str(day.get('position', 0))),
            } for day in daily_rows]
            total += upsert('gsc_daily', rows, 'date,brand_id')
        logger.complete(total)
        return {'rows_upserted': total, 'status': 'success'}
    except Exception as e:
        logger.fail(str(e))
        return {'rows_upserted': total, 'status': 'failed', 'error': str(e)}
