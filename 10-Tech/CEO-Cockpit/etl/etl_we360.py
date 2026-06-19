"""
ETL: We360 -> Supabase
Writes: we360_daily
Schedule: Daily 22:00
"""
from shared.supabase_client import upsert
from shared.etl_logger import ETLLogger
from shared.sheets_reader import safe_float, safe_int

def run(employee_data: list[dict]) -> dict:
    logger = ETLLogger('we360')
    logger.start()
    total = 0
    try:
        rows = [{
            'date': e['date'],
            'staff_id': e['staff_id'],
            'online_time_min': safe_int(str(e.get('online_time_min', 0))),
            'active_time_min': safe_int(str(e.get('active_time_min', 0))),
            'idle_time_min': safe_int(str(e.get('idle_time_min', 0))),
            'productive_time_min': safe_int(str(e.get('productive_time_min', 0))),
            'unproductive_time_min': safe_int(str(e.get('unproductive_time_min', 0))),
            'neutral_time_min': safe_int(str(e.get('neutral_time_min', 0))),
            'email_time_min': safe_int(str(e.get('email_time_min', 0))),
            'productivity_pct': safe_float(str(e.get('productivity_pct', 0))),
        } for e in employee_data]
        total = upsert('we360_daily', rows, 'date,staff_id')
        logger.complete(total)
        return {'rows_upserted': total, 'status': 'success'}
    except Exception as e:
        logger.fail(str(e))
        return {'rows_upserted': total, 'status': 'failed', 'error': str(e)}
