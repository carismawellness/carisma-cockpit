"""
Carisma Intelligence — Email Composer
Collects pending alerts and sends a formatted daily brief via Gmail MCP.
"""
import os
from collections import Counter, defaultdict
from datetime import datetime, timedelta, timezone
from supabase import create_client
from dotenv import load_dotenv

load_dotenv(os.path.join(os.path.dirname(__file__), '..', '.env.local'))

SEVERITY_EMOJI = {
    'critical': '\U0001f534',
    'warning': '\U0001f7e1',
    'info': '\U0001f535',
}

def get_client():
    return create_client(
        os.environ['NEXT_PUBLIC_SUPABASE_URL'],
        os.environ['SUPABASE_SERVICE_ROLE_KEY'],
    )

def compose_daily_brief() -> dict | None:
    client = get_client()
    result = client.table('ci_alerts').select('*').eq('status', 'pending').order('severity').execute()
    alerts = result.data
    if not alerts:
        return None
    critical = sum(1 for a in alerts if a['severity'] == 'critical')
    warning = sum(1 for a in alerts if a['severity'] == 'warning')
    info = sum(1 for a in alerts if a['severity'] == 'info')
    today = datetime.now(timezone.utc).strftime('%d %B %Y')
    subject = f"CI Daily Brief — {len(alerts)} alert{'s' if len(alerts) != 1 else ''}"
    if critical > 0:
        subject += f" ({critical} critical)"
    body_lines = [
        f"# Carisma Intelligence Daily Brief",
        f"**Date:** {today}",
        f"**Alerts:** {critical} critical, {warning} warning, {info} info",
        "", "---", "",
    ]
    for alert in alerts:
        emoji = SEVERITY_EMOJI.get(alert['severity'], '')
        body_lines.extend([
            f"### {emoji} [{alert['severity'].upper()}] {alert['title']}",
            f"**Department:** {alert['department']}", "",
            f"{alert['description']}", "",
            f"**Recommendation:** {alert['recommendation']}", "",
            f"**Action:** Reply with `approve {alert['id']}` or `dismiss {alert['id']}`",
            "", "---", "",
        ])
    body = '\n'.join(body_lines)
    alert_ids = [a['id'] for a in alerts]
    for aid in alert_ids:
        client.table('ci_alerts').update({'status': 'emailed'}).eq('id', aid).execute()
    return {
        'to': os.environ.get('CI_EMAIL_TO', 'mert@carismawellness.com'),
        'subject': subject,
        'body': body,
    }

def compose_weekly_summary() -> dict | None:
    client = get_client()
    since = (datetime.now(timezone.utc) - timedelta(days=7)).isoformat()
    result = client.table('ci_alerts').select('*').gte('created_at', since).order('created_at').execute()
    alerts = result.data
    if not alerts:
        return None

    # Counts by severity
    critical = sum(1 for a in alerts if a['severity'] == 'critical')
    warning = sum(1 for a in alerts if a['severity'] == 'warning')
    info = sum(1 for a in alerts if a['severity'] == 'info')

    # Group by department
    departments = defaultdict(list)
    for a in alerts:
        departments[a.get('department', 'Other')].append(a)

    # Actions taken
    approved = sum(1 for a in alerts if a['status'] == 'approved')
    dismissed = sum(1 for a in alerts if a['status'] == 'dismissed')
    executed = sum(1 for a in alerts if a['status'] == 'executed')
    pending = sum(1 for a in alerts if a['status'] in ('pending', 'emailed'))

    week_end = datetime.now(timezone.utc).strftime('%d %B %Y')
    week_start = (datetime.now(timezone.utc) - timedelta(days=7)).strftime('%d %B %Y')
    subject = f"CI Weekly Summary — {len(alerts)} alert{'s' if len(alerts) != 1 else ''} ({week_start} – {week_end})"

    body_lines = [
        f"# Carisma Intelligence Weekly Summary",
        f"**Period:** {week_start} – {week_end}",
        f"**Total Alerts:** {len(alerts)} ({critical} critical, {warning} warning, {info} info)",
        "", "---", "",
        "## Department Breakdown", "",
    ]

    dept_order = ['Marketing', 'Sales', 'Finance', 'HR', 'Operations']
    seen = set()
    for dept in dept_order:
        if dept in departments:
            seen.add(dept)
            _append_dept_section(body_lines, dept, departments[dept])
    for dept in sorted(departments.keys()):
        if dept not in seen:
            _append_dept_section(body_lines, dept, departments[dept])

    body_lines.extend([
        "## Actions Taken", "",
        f"- **Approved:** {approved}",
        f"- **Executed:** {executed}",
        f"- **Dismissed:** {dismissed}",
        f"- **Still Pending:** {pending}",
        "",
    ])

    return {
        'to': os.environ.get('CI_EMAIL_TO', 'mert@carismawellness.com'),
        'subject': subject,
        'body': '\n'.join(body_lines),
    }


def _append_dept_section(body_lines: list, dept: str, alerts: list):
    dept_critical = sum(1 for a in alerts if a['severity'] == 'critical')
    dept_warning = sum(1 for a in alerts if a['severity'] == 'warning')
    dept_info = sum(1 for a in alerts if a['severity'] == 'info')
    body_lines.append(f"### {dept}")
    body_lines.append(f"**{len(alerts)} alerts** — {dept_critical} critical, {dept_warning} warning, {dept_info} info")
    body_lines.append("")
    for a in alerts:
        emoji = SEVERITY_EMOJI.get(a['severity'], '')
        body_lines.append(f"- {emoji} {a['title']} ({a['status']})")
    body_lines.extend(["", "---", ""])


def compose_monthly_executive() -> dict | None:
    client = get_client()
    since = (datetime.now(timezone.utc) - timedelta(days=30)).isoformat()
    result = client.table('ci_alerts').select('*').gte('created_at', since).order('created_at').execute()
    alerts = result.data
    if not alerts:
        return None

    # Counts by severity
    critical = sum(1 for a in alerts if a['severity'] == 'critical')
    warning = sum(1 for a in alerts if a['severity'] == 'warning')
    info = sum(1 for a in alerts if a['severity'] == 'info')

    # KPI data — best-effort, skip if tables don't exist
    sales_data = _safe_query(client, 'sales_weekly', since)
    marketing_data = _safe_query(client, 'marketing_daily', since)
    hr_data = _safe_query(client, 'hr_weekly', since)

    # Department health
    departments = defaultdict(list)
    for a in alerts:
        departments[a.get('department', 'Other')].append(a)

    # Top recurring themes — count alert titles to find repeats
    title_counts = Counter(a['title'] for a in alerts)
    top_themes = title_counts.most_common(3)

    month_label = datetime.now(timezone.utc).strftime('%B %Y')
    subject = f"CI Monthly Executive Summary — {month_label}"

    body_lines = [
        f"# Carisma Intelligence Executive Summary",
        f"**Month:** {month_label}",
        "", "---", "",
        "## Headline Stats", "",
    ]

    # Revenue / KPI highlights from sales_weekly
    if sales_data:
        total_revenue = sum(float(r.get('revenue', 0) or 0) for r in sales_data)
        body_lines.append(f"- **Total Revenue (sales_weekly):** EUR {total_revenue:,.2f}")
    else:
        body_lines.append("- **Revenue data:** Not available")

    if marketing_data:
        total_spend = sum(float(r.get('spend', 0) or 0) for r in marketing_data)
        total_leads = sum(int(r.get('leads', 0) or 0) for r in marketing_data)
        body_lines.append(f"- **Marketing Spend:** EUR {total_spend:,.2f}")
        body_lines.append(f"- **Total Leads:** {total_leads:,}")

    if hr_data:
        body_lines.append(f"- **HR records this month:** {len(hr_data)}")

    body_lines.extend(["", "---", ""])

    # Alert summary
    body_lines.extend([
        "## Alert Summary", "",
        f"**Total:** {len(alerts)} ({critical} critical, {warning} warning, {info} info)", "",
    ])

    # Department health overview
    body_lines.extend(["## Department Health Overview", ""])
    dept_order = ['Marketing', 'Sales', 'Finance', 'HR', 'Operations']
    seen = set()
    for dept in dept_order:
        if dept in departments:
            seen.add(dept)
            dept_alerts = departments[dept]
            dept_crit = sum(1 for a in dept_alerts if a['severity'] == 'critical')
            status = '\U0001f534 Needs Attention' if dept_crit > 0 else '\U0001f7e2 Healthy'
            body_lines.append(f"- **{dept}:** {status} ({len(dept_alerts)} alerts, {dept_crit} critical)")
    for dept in sorted(departments.keys()):
        if dept not in seen:
            dept_alerts = departments[dept]
            dept_crit = sum(1 for a in dept_alerts if a['severity'] == 'critical')
            status = '\U0001f534 Needs Attention' if dept_crit > 0 else '\U0001f7e2 Healthy'
            body_lines.append(f"- **{dept}:** {status} ({len(dept_alerts)} alerts, {dept_crit} critical)")
    body_lines.extend(["", "---", ""])

    # Top 3 recurring themes
    body_lines.extend(["## Top 3 Recurring Alert Themes", ""])
    if top_themes:
        for i, (title, count) in enumerate(top_themes, 1):
            body_lines.append(f"{i}. **{title}** — appeared {count} time{'s' if count != 1 else ''}")
    else:
        body_lines.append("No recurring themes detected.")
    body_lines.append("")

    return {
        'to': os.environ.get('CI_EMAIL_TO', 'mert@carismawellness.com'),
        'subject': subject,
        'body': '\n'.join(body_lines),
    }


def _safe_query(client, table: str, since: str) -> list:
    """Query a KPI table, returning [] if it doesn't exist or errors."""
    try:
        result = client.table(table).select('*').gte('created_at', since).execute()
        return result.data or []
    except Exception:
        return []
