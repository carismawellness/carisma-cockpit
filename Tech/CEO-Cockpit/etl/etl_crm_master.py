"""
ETL: CRM Master Google Sheet -> Supabase
Reads: ' Spa', ' Aes', ' Slm' tabs (KPIs), 'Spa', 'Aes', 'Slm' tabs (Dials)
Writes: crm_daily, crm_by_rep
Schedule: Daily 09:00
"""
from shared.supabase_client import upsert
from shared.etl_logger import ETLLogger
from shared.etl_config import get_brand_id
from shared.sheets_reader import parse_sheet_values, safe_float, safe_int

def run(sheet_data: dict[str, list[list[str]]]) -> dict:
    logger = ETLLogger('crm_master')
    logger.start()
    total = 0
    try:
        brand_tabs = {' Spa': 'spa', ' Aes': 'aesthetics', ' Slm': 'slimming'}
        for tab_name, brand_slug in brand_tabs.items():
            if tab_name in sheet_data:
                brand_id = get_brand_id(brand_slug)
                crm_rows = _process_kpi_tab(sheet_data[tab_name], brand_id)
                count = upsert('crm_daily', crm_rows, 'date,brand_id')
                total += count
        dial_tabs = {'Spa': 'spa', 'Aes': 'aesthetics', 'Slm': 'slimming'}
        for tab_name, brand_slug in dial_tabs.items():
            if tab_name in sheet_data:
                brand_id = get_brand_id(brand_slug)
                rep_rows = _process_dials_tab(sheet_data[tab_name], brand_id)
                count = upsert('crm_by_rep', rep_rows, 'date,staff_id')
                total += count
        logger.complete(total)
        return {'rows_upserted': total, 'status': 'success'}
    except Exception as e:
        logger.fail(str(e))
        return {'rows_upserted': total, 'status': 'failed', 'error': str(e)}

def _process_kpi_tab(raw: list[list[str]], brand_id: int) -> list[dict]:
    """Parse CRM KPI tab into crm_daily rows.

    Expected layout: header row 0 with columns like
    Date | Total Leads | Meta Leads | CRM Leads | In Hours | Out Hours |
    Speed to Lead (Median) | Speed to Lead (Mean) | Conversion % |
    Total Calls | Outbound Calls | ...
    """
    parsed = parse_sheet_values(raw, header_row=0)
    rows = []
    for record in parsed:
        # Try common header names for the date column
        date_val = (record.get('Date') or record.get('date') or '').strip()
        if not date_val:
            continue
        row = {
            'date': date_val,
            'brand_id': brand_id,
            'total_leads': safe_int(record.get('Total Leads', '')),
            'leads_meta': safe_int(record.get('Meta Leads', '') or record.get('Leads Meta', '')),
            'leads_crm': safe_int(record.get('CRM Leads', '') or record.get('Leads CRM', '')),
            'leads_in_hours': safe_int(record.get('In Hours', '')),
            'leads_out_hours': safe_int(record.get('Out Hours', '')),
            'speed_to_lead_median_min': safe_float(record.get('Speed to Lead (Median)', '') or record.get('STL Median', '')),
            'speed_to_lead_mean_min': safe_float(record.get('Speed to Lead (Mean)', '') or record.get('STL Mean', '')),
            'conversion_rate_pct': safe_float(record.get('Conversion %', '') or record.get('Conversion Rate', '')),
            'total_calls': safe_int(record.get('Total Calls', '')),
            'outbound_calls': safe_int(record.get('Outbound Calls', '') or record.get('Outbound', '')),
            'appointments_booked': safe_int(record.get('Appointments Booked', '') or record.get('Appts Booked', '')),
        }
        rows.append(row)
    return rows


def _process_dials_tab(raw: list[list[str]], brand_id: int) -> list[dict]:
    """Parse CRM dials tab into crm_by_rep rows.

    Expected layout: header row 0 with columns like
    Date | Rep / Staff | Leads Assigned | Calls Made | Appts Booked |
    Conversions | Conversion % | STL Avg
    """
    parsed = parse_sheet_values(raw, header_row=0)
    rows = []
    for record in parsed:
        date_val = (record.get('Date') or record.get('date') or '').strip()
        if not date_val:
            continue
        # staff_id is resolved upstream or stored as raw identifier
        staff_raw = (record.get('Rep') or record.get('Staff') or record.get('Name') or '').strip()
        if not staff_raw:
            continue
        row = {
            'date': date_val,
            'brand_id': brand_id,
            # staff_id must be resolved; store raw name for now — caller maps to staff table
            'staff_name': staff_raw,
            'leads_assigned': safe_int(record.get('Leads Assigned', '') or record.get('Assigned', '')),
            'calls_made': safe_int(record.get('Calls Made', '') or record.get('Calls', '') or record.get('Dials', '')),
            'appointments_booked': safe_int(record.get('Appointments Booked', '') or record.get('Appts Booked', '') or record.get('Appts', '')),
            'conversions': safe_int(record.get('Conversions', '') or record.get('Converted', '')),
            'conversion_rate_pct': safe_float(record.get('Conversion %', '') or record.get('Conv %', '')),
            'speed_to_lead_avg_min': safe_float(record.get('STL Avg', '') or record.get('Speed to Lead', '')),
        }
        rows.append(row)
    return rows
