"""
Carisma Intelligence — Analyzer
Runs all rules against Supabase, creates ci_alerts for breaches.
"""
import os
from supabase import create_client
from dotenv import load_dotenv
from .ci_rules import RULES

load_dotenv(os.path.join(os.path.dirname(__file__), '..', '.env.local'))

BRAND_NAMES = {1: 'Spa', 2: 'Aesthetics', 3: 'Slimming'}

def get_client():
    return create_client(
        os.environ['NEXT_PUBLIC_SUPABASE_URL'],
        os.environ['SUPABASE_SERVICE_ROLE_KEY'],
    )

def run_analysis() -> list[dict]:
    client = get_client()
    alerts = []
    for rule in RULES:
        try:
            breaches = _evaluate_rule(client, rule)
            for breach in breaches:
                alert = {
                    'department': rule['department'],
                    'brand_id': breach.get('brand_id'),
                    'severity': rule['severity'],
                    'title': _format_title(rule, breach),
                    'description': f"Rule '{rule['name']}' triggered.",
                    'recommendation': rule['recommendation'],
                    'status': 'pending',
                    'action_payload': {
                        'type': rule['action_type'],
                        'rule': rule['name'],
                        'data': breach,
                    },
                }
                client.table('ci_alerts').insert(alert).execute()
                alerts.append(alert)
        except Exception as e:
            print(f"Rule '{rule['name']}' failed: {e}")
            continue
    return alerts

def _evaluate_rule(client, rule: dict) -> list[dict]:
    # Execute the rule's SQL query via the read-only RPC
    result = client.rpc(
        'execute_readonly_query',
        {'query_text': rule['query'].strip()},
    ).execute()
    rows = result.data if result.data else []

    # If the rule has a targets_query, fetch target values keyed by brand_id
    targets_by_brand: dict[int, float] = {}
    if rule.get('targets_query'):
        target_result = client.rpc(
            'execute_readonly_query',
            {'query_text': rule['targets_query'].strip()},
        ).execute()
        for t in (target_result.data or []):
            targets_by_brand[t['brand_id']] = t['target_value']

    # Apply the condition lambda to each row and collect breaches
    breaches = []
    for row in rows:
        brand_id = row.get('brand_id')
        target = targets_by_brand.get(brand_id, 0) if targets_by_brand else None
        try:
            if rule['condition'](row, target):
                if target is not None:
                    row['target'] = target
                breaches.append(row)
        except (TypeError, KeyError, ZeroDivisionError):
            continue

    return breaches

def _format_title(rule: dict, breach: dict) -> str:
    data = {**breach}
    if 'brand_id' in data:
        data['brand'] = BRAND_NAMES.get(data['brand_id'], 'Unknown')
    if 'total_meta' in data and 'total_crm' in data and data['total_meta'] > 0:
        data['diff_pct'] = abs(data['total_meta'] - data['total_crm']) / data['total_meta'] * 100
    if 'avg_cpl' in data and 'target' in data and data['target'] > 0:
        data['pct'] = (data['avg_cpl'] - data['target']) / data['target'] * 100
    try:
        return rule['title_template'].format(**data)
    except KeyError:
        return f"Alert: {rule['name']}"
