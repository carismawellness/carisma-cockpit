"""
ETL: Klaviyo -> Supabase
Writes: klaviyo_campaigns
Schedule: Daily 08:00
"""
from shared.supabase_client import upsert
from shared.etl_logger import ETLLogger
from shared.etl_config import get_brand_id
from shared.sheets_reader import safe_float, safe_int

def run(campaign_data: dict[str, list[dict]]) -> dict:
    logger = ETLLogger('klaviyo')
    logger.start()
    total = 0
    try:
        for brand_slug, campaigns in campaign_data.items():
            brand_id = get_brand_id(brand_slug)
            rows = [{
                'date': c['send_date'],
                'brand_id': brand_id,
                'campaign_name': c['name'],
                'sends': safe_int(str(c.get('sends', 0))),
                'opens': safe_int(str(c.get('opens', 0))),
                'clicks': safe_int(str(c.get('clicks', 0))),
                'revenue': safe_float(str(c.get('revenue', 0))),
                'revenue_pct_of_total': safe_float(str(c.get('revenue_pct', 0))),
            } for c in campaigns]
            total += upsert('klaviyo_campaigns', rows, 'date,brand_id,campaign_name')
        logger.complete(total)
        return {'rows_upserted': total, 'status': 'success'}
    except Exception as e:
        logger.fail(str(e))
        return {'rows_upserted': total, 'status': 'failed', 'error': str(e)}
