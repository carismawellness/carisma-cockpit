"""
ETL: Google Ads -> Supabase
Writes: marketing_daily (platform='google')
Schedule: Every 6h
"""
from shared.supabase_client import upsert
from shared.etl_logger import ETLLogger
from shared.etl_config import get_brand_id
from shared.sheets_reader import safe_float, safe_int

def run(campaign_data: dict[str, list[dict]]) -> dict:
    logger = ETLLogger('google_ads')
    logger.start()
    total = 0
    try:
        for brand_slug, daily_rows in campaign_data.items():
            brand_id = get_brand_id(brand_slug)
            rows = [{
                'date': day['date'],
                'brand_id': brand_id,
                'platform': 'google',
                'spend': safe_float(str(day.get('cost', 0))),
                'impressions': safe_int(str(day.get('impressions', 0))),
                'clicks': safe_int(str(day.get('clicks', 0))),
                'leads': safe_int(str(day.get('conversions', 0))),
                'cpl': safe_float(str(day.get('cost_per_conversion', 0))),
                'roas': safe_float(str(day.get('conversion_value_per_cost', 0))),
                'ctr_pct': safe_float(str(day.get('ctr', 0))),
                'cpc': safe_float(str(day.get('average_cpc', 0))),
            } for day in daily_rows]
            total += upsert('marketing_daily', rows, 'date,brand_id,platform')
        logger.complete(total)
        return {'rows_upserted': total, 'status': 'success'}
    except Exception as e:
        logger.fail(str(e))
        return {'rows_upserted': total, 'status': 'failed', 'error': str(e)}
