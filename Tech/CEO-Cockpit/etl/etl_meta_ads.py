"""
ETL: Meta Ads API -> Supabase
Writes: marketing_daily
Schedule: Every 6h
"""
from shared.supabase_client import upsert
from shared.etl_logger import ETLLogger
from shared.etl_config import get_api_config, get_brand_id
from shared.sheets_reader import safe_float, safe_int

AD_ACCOUNTS = {
    'act_654279452039150': 'spa',
    'act_382359687910745': 'aesthetics',
    'act_1496776195316716': 'slimming',
}

def run(insights_by_account: dict[str, list[dict]]) -> dict:
    logger = ETLLogger('meta_ads')
    logger.start()
    total = 0
    try:
        for account_id, insights in insights_by_account.items():
            brand_slug = AD_ACCOUNTS.get(account_id)
            if not brand_slug:
                continue
            brand_id = get_brand_id(brand_slug)
            rows = []
            for day in insights:
                actions = day.get('actions', [])
                leads = sum(int(a.get('value', 0)) for a in actions if a.get('action_type') == 'lead')
                spend = safe_float(str(day.get('spend', 0)))
                cpl = spend / leads if leads > 0 else 0
                rows.append({
                    'date': day['date_start'],
                    'brand_id': brand_id,
                    'platform': 'meta',
                    'spend': round(spend, 2),
                    'impressions': safe_int(str(day.get('impressions', 0))),
                    'clicks': safe_int(str(day.get('clicks', 0))),
                    'leads': leads,
                    'cpl': round(cpl, 2),
                    'roas': safe_float(str(day.get('purchase_roas', [{}])[0].get('value', 0))) if day.get('purchase_roas') else 0,
                    'ctr_pct': safe_float(str(day.get('ctr', 0))),
                    'cpc': safe_float(str(day.get('cpc', 0))),
                })
            count = upsert('marketing_daily', rows, 'date,brand_id,platform')
            total += count
        logger.complete(total)
        return {'rows_upserted': total, 'status': 'success'}
    except Exception as e:
        logger.fail(str(e))
        return {'rows_upserted': total, 'status': 'failed', 'error': str(e)}
