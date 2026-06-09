"""
KPI QC Agent — verifies every source value is correctly transferred to KPI tab.
Usage:
  python3 qc_kpi_agent.py --agent Adeel --type chat
  python3 qc_kpi_agent.py --agent VJ    --type sdr
"""

import json, re, argparse
from datetime import datetime
import gspread
from google.oauth2.credentials import Credentials
from google.auth.transport.requests import Request

ap = argparse.ArgumentParser()
ap.add_argument('--agent', required=True)
ap.add_argument('--type',  required=True, choices=['chat', 'sdr'])
args = ap.parse_args()

AGENT = args.agent
TYPE  = args.type
TAB   = AGENT

# ── Auth ──────────────────────────────────────────────────────────────────────
with open('/Users/mertgulen/.go-google-mcp/token.json') as f:
    tok = json.load(f)
with open('/Users/mertgulen/.go-google-mcp/client_secrets.json') as f:
    sec = json.load(f)['installed']

creds = Credentials(
    token=tok['access_token'], refresh_token=tok['refresh_token'],
    token_uri=sec['token_uri'], client_id=sec['client_id'],
    client_secret=sec['client_secret'],
    scopes=['https://www.googleapis.com/auth/spreadsheets']
)
if creds.expired:
    creds.refresh(Request())

gc = gspread.authorize(creds)
sh = gc.open_by_key('1bHF_7bXic08pcyXQhq310zG6McqXD50oT0EuVkjzDdI')

src_raw = sh.worksheet(f'{AGENT} (src)').get_all_values()
kpi_raw = sh.worksheet(TAB).get_all_values()

YEAR = 2026

def parse_date(val):
    val = str(val).strip()
    for fmt in ('%d-%b %Y', '%d-%B %Y'):
        try:
            return datetime.strptime(f'{val} {YEAR}', fmt)
        except ValueError:
            pass
    for fmt in ('%d/%m/%Y', '%m/%d/%Y'):
        try:
            return datetime.strptime(val, fmt)
        except ValueError:
            pass
    return None

def clean(v):
    v = str(v).strip()
    if not v or v.startswith('#'):
        return None
    return re.sub(r'[€,\s]', '', v).rstrip('%') or None

def to_float(v):
    c = clean(v)
    if c is None:
        return None
    try:
        return float(c)
    except ValueError:
        return None

# ── Source date → col index ───────────────────────────────────────────────────
src_header = src_raw[0] if src_raw else []
src_date_to_col = {}
for ci in range(2, min(60, len(src_header))):
    dt = parse_date(src_header[ci])
    if dt:
        src_date_to_col[dt.strftime('%d/%m/%Y')] = ci

# ── KPI date → row index ──────────────────────────────────────────────────────
kpi_date_to_row = {}
for ri in range(2, len(kpi_raw)):
    dt = parse_date(kpi_raw[ri][0]) if kpi_raw[ri] else None
    if dt:
        kpi_date_to_row[dt.strftime('%d/%m/%Y')] = ri

# ── Per-agent field overrides (mirror builder _OVERRIDES) ────────────────────
_QC_OVERRIDES = {
    'chat': {
        'Abid': [
            ('LC Sales',    11, 1), ('LC Msgs',  12, 2), ('LC Booked', 14, 3), ('LC Deps', 15, 4),
            ('CRM Sales',   18, 5), ('CRM Msgs', 19, 6), ('CRM Booked',21, 7), ('CRM Deps', 22, 8),
            ('Oth Sales',   28, 9), ('Oth Msgs', 25,10), ('Oth Booked',26,11), ('Oth Deps', 27,12),
        ],
        'K&M': [
            ('LC Sales',    11, 1), ('LC Msgs',  12, 2), ('LC Booked', 14, 3), ('LC Deps', 15, 4),
            ('CRM Sales',   18, 5), ('CRM Msgs', 19, 6), ('CRM Booked',21, 7), ('CRM Deps', 22, 8),
            ('Oth Sales',   28, 9), ('Oth Msgs', 25,10), ('Oth Booked',26,11), ('Oth Deps', 27,12),
        ],
    },
    'sdr': {
        'Anni': [
            ('OB Sales',   None, 1), ('OB Dials', 11, 2), ('OB Ans',   12, 3), ('OB Booked',13, 4), ('OB Deps',14, 5),
            ('IB Sales',     19, 6), ('IB Rcvd',  20, 7), ('IB Booked',21, 8), ('IB Deps',  22, 9),
            ('Chat Sales',   28,10), ('Chat Conv', 25,11), ('Chat Book',26,12), ('Chat Deps',27,13),
        ],
    },
}

# ── Field mapping: (label, src_row, kpi_col_0idx) ────────────────────────────
if TYPE == 'chat':
    FIELDS = _QC_OVERRIDES['chat'].get(AGENT) or [
        ('LC Sales',    11, 1),
        ('LC Msgs',     12, 2),
        ('LC Booked',   14, 3),
        ('LC Deps',     15, 4),
        ('CRM Sales',   19, 5),
        ('CRM Msgs',    20, 6),
        ('CRM Booked',  22, 7),
        ('CRM Deps',    23, 8),
        ('Oth Sales',   29, 9),
        ('Oth Msgs',    26, 10),
        ('Oth Booked',  27, 11),
        ('Oth Deps',    28, 12),
    ]
else:  # sdr
    FIELDS = _QC_OVERRIDES['sdr'].get(AGENT) or [
        ('OB Sales',   11, 1),
        ('OB Dials',   12, 2),
        ('OB Ans',     13, 3),
        ('OB Booked',  14, 4),
        ('OB Deps',    15, 5),
        ('IB Sales',   20, 6),
        ('IB Rcvd',    21, 7),
        ('IB Booked',  22, 8),
        ('IB Deps',    23, 9),
        ('Chat Sales', 29, 10),
        ('Chat Conv',  26, 11),
        ('Chat Book',  27, 12),
        ('Chat Deps',  28, 13),
    ]

# ── QC loop ───────────────────────────────────────────────────────────────────
mismatches = []
checked = 0
missing_dates = []

common_dates = set(src_date_to_col) & set(kpi_date_to_row)
only_src = set(src_date_to_col) - set(kpi_date_to_row)
only_kpi = set(kpi_date_to_row) - set(src_date_to_col)

for date_str in sorted(common_dates):
    sci = src_date_to_col[date_str]
    kri = kpi_date_to_row[date_str]

    for label, src_row, kpi_col in FIELDS:
        if src_row is None:
            checked += 1
            continue
        src_val = (src_raw[src_row][sci]
                   if src_row < len(src_raw) and sci < len(src_raw[src_row])
                   else '')
        kpi_val = (kpi_raw[kri][kpi_col]
                   if kri < len(kpi_raw) and kpi_col < len(kpi_raw[kri])
                   else '')

        sv = to_float(src_val)
        kv = to_float(kpi_val)

        # Both empty/zero → pass
        if sv is None and kv is None:
            checked += 1
            continue
        if sv in (None, 0.0) and kv in (None, 0.0):
            checked += 1
            continue

        if sv != kv:
            mismatches.append(
                f"  {date_str} | {label}: src={src_val!r} → kpi={kpi_val!r}"
            )
        checked += 1

# ── Report ─────────────────────────────────────────────────────────────────────
print(f"\n{'='*60}")
print(f"QC Report — {AGENT} ({TYPE.upper()})  →  {TAB}")
print(f"{'='*60}")
print(f"Dates in source:  {len(src_date_to_col)}")
print(f"Dates in KPI tab: {len(kpi_date_to_row)}")
print(f"Common dates:     {len(common_dates)}")
if only_src:
    print(f"Only in source:   {sorted(only_src)}")
if only_kpi:
    print(f"Only in KPI tab:  {sorted(only_kpi)}")
print(f"Fields checked:   {checked}")
print(f"Mismatches:       {len(mismatches)}")
if mismatches:
    print("\nMISMATCHES:")
    for m in mismatches:
        print(m)
    print(f"\n❌ FAIL — {len(mismatches)} mismatches found")
else:
    print(f"\n✅ PASS — all {checked} field values match")
