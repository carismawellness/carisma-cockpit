"""
ETL: Zoho CRM -> Supabase
Writes: speed_to_lead_distribution
Schedule: Every 4h

Supports TWO data sources:
1. Deals module — uses Campaign_Entry_Time (when deal entered "New Leads" stage)
   and Speed_to_Lead_Minutes (pre-calculated by Zoho workflow).
   Falls back to First_Contact_Time / First_Call_Time minus Campaign_Entry_Time.
2. Leads module (legacy) — uses First_Contacted_Time vs Created_Time.

The Deals-based approach is preferred as it directly tracks the "New Leads" →
first-contact pipeline. The Leads approach is kept as a fallback.
"""
from collections import defaultdict
from datetime import datetime, timezone
from shared.supabase_client import upsert
from shared.etl_logger import ETLLogger
from shared.etl_config import get_brand_id

BUCKETS = ['<1min', '1-3min', '3-5min', '5-15min', '15-30min', '30min+']

_BUCKET_BOUNDS = [
    (1, '<1min'),
    (3, '1-3min'),
    (5, '3-5min'),
    (15, '5-15min'),
    (30, '15-30min'),
    (float('inf'), '30min+'),
]

# Deals module field names (set by Zoho workflows)
CAMPAIGN_ENTRY_FIELD = 'Campaign_Entry_Time'
STL_MINUTES_FIELD = 'Speed_to_Lead_Minutes'
# First contact fields differ by brand: Spa/Slimming use First_Contact_Time, Aesthetics uses First_Call_Time
FIRST_CONTACT_FIELDS = ['First_Contact_Time', 'First_Call_Time']

# Legacy Leads module field names
CREATED_FIELD = 'Created_Time'
FIRST_CONTACTED_FIELD = 'First_Contacted_Time'
RESPONSE_MINUTES_FIELD = 'Response_Time_Minutes'


def run(data: dict[str, list[dict]], source: str = 'deals') -> dict:
    """Run the ETL.

    Args:
        data: dict mapping brand slug to list of records (deals or leads).
        source: 'deals' (preferred) or 'leads' (legacy).
    """
    logger = ETLLogger('zoho_crm')
    logger.start()
    total = 0
    try:
        for brand_slug, records in data.items():
            brand_id = get_brand_id(brand_slug)
            if source == 'deals':
                total += _process_deals_stl(records, brand_id)
            else:
                total += _process_leads_stl(records, brand_id)
        logger.complete(total)
        return {'rows_upserted': total, 'status': 'success'}
    except Exception as e:
        logger.fail(str(e))
        return {'rows_upserted': total, 'status': 'failed', 'error': str(e)}


def _get_diff_minutes(record: dict) -> float | None:
    """Extract response time in minutes from a Deals record.

    Priority: Speed_to_Lead_Minutes (pre-calculated) > manual calculation
    from Campaign_Entry_Time and First_Contact_Time/First_Call_Time.
    """
    # 1. Pre-calculated by Zoho workflow
    pre_calc = record.get(STL_MINUTES_FIELD)
    if pre_calc is not None:
        try:
            val = float(pre_calc)
            if val >= 0:
                return val
        except (ValueError, TypeError):
            pass

    # 2. Calculate from Campaign_Entry_Time and first contact field
    entry_str = record.get(CAMPAIGN_ENTRY_FIELD, '')
    if not entry_str:
        return None

    contact_str = ''
    for field in FIRST_CONTACT_FIELDS:
        contact_str = record.get(field, '')
        if contact_str:
            break

    if not contact_str:
        return None

    try:
        entry_dt = datetime.fromisoformat(entry_str.replace('Z', '+00:00'))
        contact_dt = datetime.fromisoformat(contact_str.replace('Z', '+00:00'))
        diff = (contact_dt - entry_dt).total_seconds() / 60.0
        return diff if diff >= 0 else None
    except (ValueError, TypeError):
        return None


def _bucket_records(records: list[dict], diff_fn) -> dict[str, dict[str, int]]:
    """Group records into daily STL buckets using a diff_fn(record) -> minutes|None."""
    daily_buckets: dict[str, dict[str, int]] = defaultdict(lambda: {b: 0 for b in BUCKETS})

    for record in records:
        diff_minutes = diff_fn(record)
        if diff_minutes is None:
            continue

        # Determine date key from Campaign_Entry_Time or Created_Time
        date_str = record.get(CAMPAIGN_ENTRY_FIELD) or record.get(CREATED_FIELD, '')
        if not date_str:
            continue

        try:
            date_key = datetime.fromisoformat(
                date_str.replace('Z', '+00:00')
            ).strftime('%Y-%m-%d')
        except (ValueError, TypeError):
            continue

        for upper_bound, bucket_name in _BUCKET_BOUNDS:
            if diff_minutes < upper_bound:
                daily_buckets[date_key][bucket_name] += 1
                break

    return daily_buckets


def _buckets_to_rows(daily_buckets: dict[str, dict[str, int]], brand_id: int) -> list[dict]:
    """Convert daily bucket counts to upsert-ready rows."""
    rows = []
    for date_key, buckets in daily_buckets.items():
        total_count = sum(buckets.values())
        if total_count == 0:
            continue
        for bucket_name in BUCKETS:
            count = buckets[bucket_name]
            rows.append({
                'date': date_key,
                'brand_id': brand_id,
                'bucket': bucket_name,
                'count': count,
                'pct': round(count / total_count * 100, 2) if total_count else 0,
            })
    return rows


def _process_deals_stl(deals: list[dict], brand_id: int) -> int:
    """Process speed-to-lead from Deals module records."""
    if not deals:
        return 0
    daily_buckets = _bucket_records(deals, _get_diff_minutes)
    rows = _buckets_to_rows(daily_buckets, brand_id)
    return upsert('speed_to_lead_distribution', rows, 'date,brand_id,bucket')


def _process_leads_stl(leads: list[dict], brand_id: int) -> int:
    """Legacy: process speed-to-lead from Leads module records."""
    if not leads:
        return 0

    def _legacy_diff(lead: dict) -> float | None:
        pre_calc = lead.get(RESPONSE_MINUTES_FIELD)
        if pre_calc is not None:
            try:
                return float(pre_calc)
            except (ValueError, TypeError):
                pass

        created_str = lead.get(CREATED_FIELD, '')
        contact_str = lead.get(FIRST_CONTACTED_FIELD, '')
        if not created_str or not contact_str:
            return None
        try:
            created_dt = datetime.fromisoformat(created_str.replace('Z', '+00:00'))
            contact_dt = datetime.fromisoformat(contact_str.replace('Z', '+00:00'))
            diff = (contact_dt - created_dt).total_seconds() / 60.0
            return diff if diff >= 0 else None
        except (ValueError, TypeError):
            return None

    daily_buckets = _bucket_records(leads, _legacy_diff)
    rows = _buckets_to_rows(daily_buckets, brand_id)
    return upsert('speed_to_lead_distribution', rows, 'date,brand_id,bucket')
