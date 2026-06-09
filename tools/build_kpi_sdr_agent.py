"""
SDR KPI Builder — parameterized
Usage:  python3 build_kpi_sdr_agent.py --agent VJ
        python3 build_kpi_sdr_agent.py --agent "K&M"

Source row map (0-indexed rows, 2-indexed date cols):
  Outbound : Sales=11  Dials=12  Answered=13  Booked=14  Deps=15
  Inbound  : Sales=20  Received=21  Booked=22  Deps=23
  Chat     : Sales=29  Conversations=26  Booked=27  Deps=28
  Total/KPIs: formulas

Layout: Date | Outbound(5) | Inbound(4) | Chat(4) | Total(5) | KPIs(2) = 21 cols
"""

import json, re, sys, argparse
from datetime import datetime
import gspread
from gspread.utils import rowcol_to_a1
from gspread_formatting import (
    format_cell_ranges, CellFormat, Color, TextFormat,
)
from google.oauth2.credentials import Credentials
from google.auth.transport.requests import Request

ap = argparse.ArgumentParser()
ap.add_argument('--agent', required=True, help='Source sheet name (e.g. VJ)')
args = ap.parse_args()

AGENT_NAME = args.agent
TAB_NAME   = AGENT_NAME

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

# ── Source data ───────────────────────────────────────────────────────────────
src_ws = sh.worksheet(f'{AGENT_NAME} (src)')
raw    = src_ws.get_all_values()

# ── Per-agent row overrides ───────────────────────────────────────────────────
# Anni: no OB Sales row; all Outbound rows shift up by 1; IB and Chat also shifted
_OVERRIDES = {
    'Anni': {
        'Outbound': [('Sales',None,'currency'),('Dials',11,'integer'),('Answered',12,'integer'),
                     ('Booked',13,'integer'),('w/ Deposit',14,'integer')],
        'Inbound':  [('Sales',19,'currency'),('Received',20,'integer'),
                     ('Booked',21,'integer'),('w/ Deposit',22,'integer')],
        'Chat':     [('Sales',28,'currency'),('Conversations',25,'integer'),
                     ('Booked',26,'integer'),('w/ Deposit',27,'integer')],
    },
}

# ── Source row mappings ───────────────────────────────────────────────────────
OUTBOUND_METRICS = _OVERRIDES.get(AGENT_NAME, {}).get('Outbound') or [
    ('Sales',      11, 'currency'),
    ('Dials',      12, 'integer'),
    ('Answered',   13, 'integer'),
    ('Booked',     14, 'integer'),
    ('w/ Deposit', 15, 'integer'),
]
INBOUND_METRICS = _OVERRIDES.get(AGENT_NAME, {}).get('Inbound') or [
    ('Sales',      20, 'currency'),
    ('Received',   21, 'integer'),
    ('Booked',     22, 'integer'),
    ('w/ Deposit', 23, 'integer'),
]
CHAT_METRICS = _OVERRIDES.get(AGENT_NAME, {}).get('Chat') or [
    ('Sales',          29, 'currency'),
    ('Conversations',  26, 'integer'),
    ('Booked',         27, 'integer'),
    ('w/ Deposit',     28, 'integer'),
]
TOTAL_METRICS = [
    ('Sales',      None, 'currency'),
    ('Booked',     None, 'integer'),
    ('w/ Deposit', None, 'integer'),
    ('Rate',       None, 'percent'),
    ('Dials',      None, 'integer'),
]
KPI_METRICS = [
    ('Dep. %',     None, 'percent'),
    ('AOV',        None, 'currency2'),
]

SECTIONS = {
    'Outbound': OUTBOUND_METRICS,
    'Inbound':  INBOUND_METRICS,
    'Chat':     CHAT_METRICS,
    'Total':    TOTAL_METRICS,
    'KPIs':     KPI_METRICS,
}
SECTION_ORDER = ['Outbound', 'Inbound', 'Chat', 'Total', 'KPIs']
AUTO_SECTIONS = {'Total', 'KPIs'}

NCOLS = {s: len(SECTIONS[s]) for s in SECTION_ORDER}
TOTAL_COLS = 1 + sum(NCOLS.values())   # 1+5+4+4+5+2 = 21

section_col_starts = {}
cur = 2
for s in SECTION_ORDER:
    section_col_starts[s] = cur
    cur += NCOLS[s]

def cl(c):
    return rowcol_to_a1(1, c)[:-1]

OB = section_col_starts['Outbound']
OB_SALES, OB_DIALS, OB_ANS, OB_BOOKED, OB_DEPS = [cl(OB+i) for i in range(5)]
IB = section_col_starts['Inbound']
IB_SALES, IB_RCV, IB_BOOKED, IB_DEPS = [cl(IB+i) for i in range(4)]
CH = section_col_starts['Chat']
CH_SALES, CH_CONVS, CH_BOOKED, CH_DEPS = [cl(CH+i) for i in range(4)]
TO = section_col_starts['Total']
TO_SALES, TO_BOOKED, TO_DEPS, TO_RATE, TO_DIALS = [cl(TO+i) for i in range(5)]
KP = section_col_starts['KPIs']
KP_DEP, KP_AOV = [cl(KP+i) for i in range(2)]

def row_formulas(n):
    return {
        'to_sales':  f'={OB_SALES}{n}+{IB_SALES}{n}+{CH_SALES}{n}',
        'to_booked': f'={OB_BOOKED}{n}+{IB_BOOKED}{n}+{CH_BOOKED}{n}',
        'to_deps':   f'={OB_DEPS}{n}+{IB_DEPS}{n}+{CH_DEPS}{n}',
        'to_rate':   f'=IFERROR({TO_BOOKED}{n}/({OB_DIALS}{n}+{IB_RCV}{n}+{CH_CONVS}{n}),"")',
        'to_dials':  f'={OB_DIALS}{n}',
        'kp_dep':    f'=IFERROR({TO_DEPS}{n}/{TO_BOOKED}{n},"")',
        'kp_aov':    f'=IFERROR({TO_SALES}{n}/{TO_BOOKED}{n},"")',
    }

def parse_num(v, fmt):
    v = str(v).strip()
    if not v or v.startswith('#'):
        return ''
    clean = re.sub(r'[€,\s]', '', v)
    if fmt == 'percent':
        try:
            return round(float(clean.rstrip('%')) / 100, 6)
        except ValueError:
            return ''
    try:
        f = float(clean)
        return int(f) if fmt == 'integer' and f == int(f) else f
    except ValueError:
        return ''

def cell(row_idx, col_idx):
    if row_idx is None:
        return ''
    try:
        return raw[row_idx][col_idx] if row_idx < len(raw) and col_idx < len(raw[row_idx]) else ''
    except IndexError:
        return ''

# ── Date parsing ──────────────────────────────────────────────────────────────
YEAR   = 2026
header = raw[0] if raw else []

def parse_date(val):
    val = val.strip()
    for fmt in ('%d-%b %Y', '%d-%B %Y'):
        try:
            return datetime.strptime(f'{val} {YEAR}', fmt)
        except ValueError:
            continue
    for fmt in ('%d/%m/%Y', '%m/%d/%Y'):
        try:
            return datetime.strptime(val, fmt)
        except ValueError:
            continue
    return None

date_cols = sorted(
    [(ci, parse_date(header[ci]), header[ci].strip())
     for ci in range(2, min(60, len(header)))
     if parse_date(header[ci])],
    key=lambda x: x[1]
)
print(f"{AGENT_NAME} dates: {date_cols[0][2]} → {date_cols[-1][2]}  ({len(date_cols)} cols)")

# ── Build rows ────────────────────────────────────────────────────────────────
SECTION_ROW = ['Date']
METRIC_ROW  = ['Date']
for s in SECTION_ORDER:
    n = NCOLS[s]
    SECTION_ROW += [s] + [''] * (n - 1)
    METRIC_ROW  += [name for name, _, _ in SECTIONS[s]]

output_rows = []
for sheet_row, (ci, dt, _) in enumerate(date_cols, start=3):
    f = row_formulas(sheet_row)
    row = [dt.strftime('%d/%m/%Y')]
    for _, sr, fmt in OUTBOUND_METRICS:
        row.append(parse_num(cell(sr, ci), fmt))
    for _, sr, fmt in INBOUND_METRICS:
        row.append(parse_num(cell(sr, ci), fmt))
    for _, sr, fmt in CHAT_METRICS:
        row.append(parse_num(cell(sr, ci), fmt))
    row += [f['to_sales'], f['to_booked'], f['to_deps'], f['to_rate'], f['to_dials']]
    row += [f['kp_dep'], f['kp_aov']]
    output_rows.append(row)

all_rows = [SECTION_ROW, METRIC_ROW] + output_rows
print(f"Rows: {len(output_rows)}  Cols: {TOTAL_COLS}")

# ── Prepare worksheet ─────────────────────────────────────────────────────────
try:
    ws = sh.worksheet(TAB_NAME)
    ws.clear()
    sh.batch_update({'requests': [{'unmergeCells': {'range': {
        'sheetId': ws.id, 'startRowIndex': 0, 'endRowIndex': 200,
        'startColumnIndex': 0, 'endColumnIndex': TOTAL_COLS + 2,
    }}}]})
except Exception:
    ws = sh.add_worksheet(TAB_NAME, rows=200, cols=TOTAL_COLS + 2)

ws.update(range_name='A1', values=all_rows, value_input_option='USER_ENTERED')
print("Data written")

# ── Palette ───────────────────────────────────────────────────────────────────
def rgb(r, g, b):
    return Color(r/255, g/255, b/255)

C = {
    'date_hdr':  (rgb(217,234,211), rgb(39, 78, 19)),
    'ob_hdr':    (rgb(255,242,204), rgb(127,96,  0)),
    'ib_hdr':    (rgb(252,229,205), rgb(120,63,  4)),
    'ch_hdr':    (rgb(244,204,204), rgb(102, 0,  0)),
    'calc_hdr':  (rgb(230,184,175), rgb( 91,15,  0)),
    'date_data': rgb(250,246,240),
    'input_data':rgb(255,255,255),
    'tot_data':  rgb(255,243,236),
    'kpi_data':  rgb(255,235,222),
    'dark_txt':  rgb(42, 30, 14),
    'mid_txt':   rgb(80, 62, 34),
}

SECTION_HDR_CLR = {
    'Outbound': C['ob_hdr'],
    'Inbound':  C['ib_hdr'],
    'Chat':     C['ch_hdr'],
    'Total':    C['calc_hdr'],
    'KPIs':     C['calc_hdr'],
}
SECTION_DATA_BG = {
    'Outbound': C['input_data'],
    'Inbound':  C['input_data'],
    'Chat':     C['input_data'],
    'Total':    C['tot_data'],
    'KPIs':     C['kpi_data'],
}

DR_START = 3
DR_END   = 2 + len(output_rows)

fmt_list = []

fmt_list.append(('A1', CellFormat(
    backgroundColor=C['date_hdr'][0],
    textFormat=TextFormat(bold=True, fontSize=9, foregroundColor=C['date_hdr'][1], fontFamily='Arial'),
    horizontalAlignment='CENTER', verticalAlignment='MIDDLE',
)))
for s in SECTION_ORDER:
    sc, ec = section_col_starts[s], section_col_starts[s] + NCOLS[s] - 1
    bg, fg = SECTION_HDR_CLR[s]
    fmt_list.append((f'{cl(sc)}1:{cl(ec)}1', CellFormat(
        backgroundColor=bg,
        textFormat=TextFormat(bold=True, fontSize=9, foregroundColor=fg, fontFamily='Arial'),
        horizontalAlignment='CENTER', verticalAlignment='MIDDLE',
    )))

fmt_list.append(('A2', CellFormat(
    backgroundColor=C['date_hdr'][0],
    textFormat=TextFormat(bold=True, fontSize=8, foregroundColor=C['date_hdr'][1], fontFamily='Arial'),
    horizontalAlignment='CENTER', verticalAlignment='MIDDLE', wrapStrategy='WRAP',
)))
for s in SECTION_ORDER:
    sc, ec = section_col_starts[s], section_col_starts[s] + NCOLS[s] - 1
    bg, fg = SECTION_HDR_CLR[s]
    fmt_list.append((f'{cl(sc)}2:{cl(ec)}2', CellFormat(
        backgroundColor=bg,
        textFormat=TextFormat(bold=True, fontSize=8, foregroundColor=fg, fontFamily='Arial'),
        horizontalAlignment='CENTER', verticalAlignment='MIDDLE', wrapStrategy='WRAP',
    )))

if output_rows:
    fmt_list.append((f'A{DR_START}:A{DR_END}', CellFormat(
        backgroundColor=C['date_data'],
        textFormat=TextFormat(bold=True, fontSize=9, foregroundColor=C['mid_txt'], fontFamily='Arial'),
        horizontalAlignment='CENTER', verticalAlignment='MIDDLE',
    )))
    for s in SECTION_ORDER:
        sc, ec = section_col_starts[s], section_col_starts[s] + NCOLS[s] - 1
        italic = s in AUTO_SECTIONS
        fmt_list.append((f'{cl(sc)}{DR_START}:{cl(ec)}{DR_END}', CellFormat(
            backgroundColor=SECTION_DATA_BG[s],
            textFormat=TextFormat(fontSize=9, foregroundColor=C['dark_txt'],
                                  fontFamily='Arial', italic=italic),
            horizontalAlignment='CENTER', verticalAlignment='MIDDLE',
        )))

FMT = {
    'currency':  {'type': 'CURRENCY', 'pattern': '€#,##0'},
    'currency2': {'type': 'CURRENCY', 'pattern': '€#,##0.00'},
    'integer':   {'type': 'NUMBER',   'pattern': '#,##0'},
    'percent':   {'type': 'PERCENT',  'pattern': '0.0%'},
}
for s in SECTION_ORDER:
    sc = section_col_starts[s]
    for i, (_, _, fmt_type) in enumerate(SECTIONS[s]):
        if fmt_type and DR_START <= DR_END:
            fmt_list.append((f'{cl(sc+i)}{DR_START}:{cl(sc+i)}{DR_END}',
                             CellFormat(numberFormat=FMT[fmt_type])))

format_cell_ranges(ws, fmt_list)
print("Formatting applied")

# ── Single batch_update: freeze + merges + column widths + row heights ────────
col_widths = {'A':85,'B':62,'C':58,'D':68,'E':58,'F':68,'G':62,'H':68,'I':58,'J':68,
              'K':62,'L':88,'M':58,'N':68,'O':62,'P':58,'Q':68,'R':52,'S':52,'T':52,'U':62}
col_letter_to_idx = {c: i for i, c in enumerate('ABCDEFGHIJKLMNOPQRSTUVWXYZ')}

layout_requests = [
    {'updateSheetProperties': {
        'properties': {'sheetId': ws.id,
                       'gridProperties': {'frozenRowCount': 2, 'frozenColumnCount': 1}},
        'fields': 'gridProperties.frozenRowCount,gridProperties.frozenColumnCount',
    }},
]
for s in SECTION_ORDER:
    sc, ec = section_col_starts[s], section_col_starts[s] + NCOLS[s] - 1
    if ec > sc:
        layout_requests.append({'mergeCells': {
            'range': {'sheetId': ws.id, 'startRowIndex': 0, 'endRowIndex': 1,
                      'startColumnIndex': sc - 1, 'endColumnIndex': ec},
            'mergeType': 'MERGE_ALL',
        }})
for col, w in col_widths.items():
    ci = col_letter_to_idx[col]
    layout_requests.append({'updateDimensionProperties': {
        'range': {'sheetId': ws.id, 'dimension': 'COLUMNS',
                  'startIndex': ci, 'endIndex': ci + 1},
        'properties': {'pixelSize': w}, 'fields': 'pixelSize',
    }})
for start, end, height in [(0, 1, 22), (1, 2, 38)] + ([(DR_START-1, DR_END, 20)] if output_rows else []):
    layout_requests.append({'updateDimensionProperties': {
        'range': {'sheetId': ws.id, 'dimension': 'ROWS',
                  'startIndex': start, 'endIndex': end},
        'properties': {'pixelSize': height}, 'fields': 'pixelSize',
    }})

sh.batch_update({'requests': layout_requests})
print("Freeze + merges + col widths + row heights applied (1 batch)")

print(f"\nDone — {len(output_rows)} rows × {TOTAL_COLS} cols")
print(f"Tab: '{TAB_NAME}'")
print(f"URL: https://docs.google.com/spreadsheets/d/1bHF_7bXic08pcyXQhq310zG6McqXD50oT0EuVkjzDdI/edit#gid={ws.id}")
