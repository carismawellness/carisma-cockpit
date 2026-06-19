"""
Carisma Intelligence — Rule Definitions
Each rule defines: name, department, query, condition, severity, recommendation template, action payload.
"""

RULES = [
    {
        'name': 'cpl_spike',
        'department': 'marketing',
        'severity': 'critical',
        'query': """
            SELECT brand_id, AVG(cpl) as avg_cpl, COUNT(*) as days
            FROM marketing_daily
            WHERE date >= CURRENT_DATE - INTERVAL '3 days'
              AND platform = 'meta'
            GROUP BY brand_id
        """,
        'targets_query': """
            SELECT brand_id, target_value
            FROM kpi_targets
            WHERE department = 'marketing' AND metric_name = 'cpl' AND is_active = true
        """,
        'condition': lambda row, target: row['avg_cpl'] > target * 1.5,
        'title_template': '{brand} CPL at EUR {avg_cpl:.2f} — {pct:.0f}% above target',
        'recommendation': 'Pause underperforming ad sets and review creative fatigue.',
        'action_type': 'pause_meta_ad',
    },
    {
        'name': 'roas_drop',
        'department': 'marketing',
        'severity': 'critical',
        'query': """
            SELECT brand_id, AVG(roas) as avg_roas
            FROM marketing_daily
            WHERE date >= CURRENT_DATE - INTERVAL '7 days'
            GROUP BY brand_id
            HAVING AVG(roas) < 3.0
        """,
        'condition': lambda row, _: row['avg_roas'] < 3.0,
        'title_template': '{brand} ROAS dropped to {avg_roas:.1f}x (7-day avg)',
        'recommendation': 'Review creative fatigue and audience saturation. Consider refreshing top-of-funnel creatives.',
        'action_type': 'alert_only',
    },
    {
        'name': 'speed_to_lead_breach',
        'department': 'sales',
        'severity': 'critical',
        'query': """
            SELECT brand_id, AVG(speed_to_lead_median_min) as avg_stl
            FROM crm_daily
            WHERE date >= CURRENT_DATE - INTERVAL '3 days'
            GROUP BY brand_id
            HAVING AVG(speed_to_lead_median_min) > 10
        """,
        'condition': lambda row, _: row['avg_stl'] > 10,
        'title_template': '{brand} speed to lead at {avg_stl:.1f}m median — needs urgent attention',
        'recommendation': 'Alert sales manager. Review CRM team assignment and response workflow.',
        'action_type': 'send_email',
    },
    {
        'name': 'conversion_drop',
        'department': 'sales',
        'severity': 'warning',
        'query': """
            SELECT brand_id, AVG(conversion_rate_pct) as avg_conv
            FROM crm_daily
            WHERE date >= CURRENT_DATE - INTERVAL '7 days'
            GROUP BY brand_id
            HAVING AVG(conversion_rate_pct) < 15
        """,
        'condition': lambda row, _: row['avg_conv'] < 15,
        'title_template': '{brand} conversion rate at {avg_conv:.1f}% — below 15% threshold',
        'recommendation': 'Review lead quality and rep performance. Check if lead source mix changed.',
        'action_type': 'alert_only',
    },
    {
        'name': 'hc_over_budget',
        'department': 'hr',
        'severity': 'warning',
        'query': """
            SELECT location_id, brand_id, hc_pct, l.name as location_name
            FROM hr_weekly h
            JOIN locations l ON l.id = h.location_id
            WHERE week_start = (SELECT MAX(week_start) FROM hr_weekly)
              AND hc_pct > 45
        """,
        'condition': lambda row, _: row['hc_pct'] > 45,
        'title_template': '{location_name} HC% at {hc_pct:.1f}% — exceeds 45% threshold',
        'recommendation': 'Flag to HR and Finance. Review staffing levels vs revenue.',
        'action_type': 'alert_only',
    },
    {
        'name': 'utilization_low',
        'department': 'hr',
        'severity': 'warning',
        'query': """
            SELECT location_id, brand_id, utilization_pct, l.name as location_name
            FROM hr_weekly h
            JOIN locations l ON l.id = h.location_id
            WHERE week_start = (SELECT MAX(week_start) FROM hr_weekly)
              AND utilization_pct < 60
        """,
        'condition': lambda row, _: row['utilization_pct'] < 60,
        'title_template': '{location_name} utilization at {utilization_pct:.1f}% — below 60%',
        'recommendation': 'Review scheduling and consider rebalancing therapist allocation.',
        'action_type': 'alert_only',
    },
    {
        'name': 'crm_lead_mismatch',
        'department': 'sales',
        'severity': 'warning',
        'query': """
            SELECT brand_id, SUM(leads_meta) as total_meta, SUM(leads_crm) as total_crm
            FROM crm_daily
            WHERE date >= CURRENT_DATE - INTERVAL '7 days'
            GROUP BY brand_id
        """,
        'condition': lambda row, _: (
            row['total_meta'] > 0 and
            abs(row['total_meta'] - row['total_crm']) / row['total_meta'] > 0.2
        ),
        'title_template': '{brand} lead mismatch: {total_meta} Meta vs {total_crm} CRM ({diff_pct:.0f}% gap)',
        'recommendation': 'Audit CRM data entry. Check if leads are being logged correctly.',
        'action_type': 'alert_only',
    },
    {
        'name': 'consult_noshow_spike',
        'department': 'operations',
        'severity': 'warning',
        'query': """
            SELECT brand_id, showup_pct
            FROM consult_funnel
            WHERE week_start = (SELECT MAX(week_start) FROM consult_funnel)
              AND showup_pct < 70
        """,
        'condition': lambda row, _: row['showup_pct'] < 70,
        'title_template': '{brand} consult show-up at {showup_pct:.1f}% — below 70%',
        'recommendation': 'Increase reminder frequency. Consider adding WhatsApp confirmation.',
        'action_type': 'alert_only',
    },
    {
        'name': 'google_reviews_drop',
        'department': 'operations',
        'severity': 'info',
        'query': """
            SELECT location_id, brand_id, google_reviews_avg, l.name as location_name
            FROM operations_weekly o
            JOIN locations l ON l.id = o.location_id
            WHERE week_start = (SELECT MAX(week_start) FROM operations_weekly)
              AND google_reviews_avg < 4.0
        """,
        'condition': lambda row, _: row['google_reviews_avg'] < 4.0,
        'title_template': '{location_name} Google rating at {google_reviews_avg:.1f} — below 4.0',
        'recommendation': 'Flag to operations manager. Review recent negative reviews.',
        'action_type': 'alert_only',
    },
    {
        'name': 'budget_overspend',
        'department': 'finance',
        'severity': 'critical',
        'query': """
            SELECT brand_id, department, budgeted, actual, variance_pct
            FROM budget_vs_actual
            WHERE month = DATE_TRUNC('month', CURRENT_DATE)
              AND actual > budgeted * 1.2
        """,
        'condition': lambda row, _: row['actual'] > row['budgeted'] * 1.2,
        'title_template': '{department} overspend: EUR {actual:.0f} vs EUR {budgeted:.0f} budget ({variance_pct:.1f}%)',
        'recommendation': 'Pause discretionary spend. Alert department head.',
        'action_type': 'alert_only',
    },
]
