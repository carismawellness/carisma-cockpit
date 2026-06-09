"""
Transposed KPI Tracker — Abid (v1)
Same structure as KPI-Rana, reads from "Abid" source sheet.
Layout: Date | Live Chat (4) | CRM (4) | Other (4) | Total (4) | KPIs (3) = 20 cols
"""

import json, re
from datetime import datetime
import gspread
from gspread.utils import rowcol_to_a1
from gspread_formatting import (
    format_cell_ranges, CellFormat, Color, TextFormat,
    set_frozen, set_column_width, set_row_height,
)
from google.oauth2.credentials import Credentials
from google.auth.transport.requests import Request

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
src_ws = sh.worksheet('Abid')
raw    = src_ws.get_all_values()

# ── Column structure ──────────────────────────────────────────────────────────
# A=Date, B-E=Live Chat(4), F-I=CRM(4), J-M=Other(4), N-Q=Total(4), R-T=KPIs(3)
LIVE_CHAT_METRICS = [
    ('Sales',      11, 'currency'),
    ('Messages',   12, 'integer'),
    ('Booked',     14, 'integer'),   # skip row 13 Replied
    ('w/ Deposit', 15, 'integer'),
]
CRM_METRICS = [
    ('Sales',      18, 'currency'),  # row 17 = "CRM" label, row 18 = Sales
    ('Messages',   19, 'integer'),
    ('Booked',     21, 'integer'),   # skip row 20 Reply Chats
    ('w/ Deposit', 22, 'integer'),
]
OTHER_METRICS = [
    ('Sales',      28, 'currency'),
    ('Messages',   25, 'integer'),   # Total Conversations
    ('Booked',     26, 'integer'),   # Bookings
    ('w/ Deposit', 27, 'integer'),
]
TOTAL_METRICS = [
    ('Messages',   None, 'integer'),
    ('Booked',     None, 'integer'),
    ('w/ Deposit', None, 'integer'),
    ('Rate',       None, 'percent'),
]
KPI_METRICS = [
    ('Sales',      None, 'currency'),
    ('Dep. %',     None, 'percent'),
    ('AOV',        None, 'currency2'),
]

SECTIONS = {
    'Live Chat': LIVE_CHAT_METRICS,
    'CRM':       CRM_METRICS,
    'Other':     OTHER_METRICS,
    'Total':     TOTAL_METRICS,
    'KPIs':      KPI_METRICS,
}
SECTION_ORDER = ['Live Chat', 'CRM', 'Other', 'Total', 'KPIs']
AUTO_SECTIONS = {'Total', 'KPIs'}

NCOLS = {s: len(SECTIONS[s]) for s in SECTION_ORDER}
TOTAL_COLS = 1 + sum(NCOLS.values())   # 1+4+4+4+4+3 = 20

section_col_starts = {}
cur = 2
for s in SECTION_ORDER:
    section_col_starts[s] = cur
    cur += NCOLS[s]

def cl(c):
    return rowcol_to_a1(1, c)[:-1]

# Column letters
LC = section_col_starts['Live Chat']
LC_SALES, LC_MSGS, LC_BOOKED, LC_DEPS = [cl(LC+i) for i in range(4)]  # B C D E
CR = section_col_starts['CRM']
CR_SALES, CR_MSGS, CR_BOOKED, CR_DEPS = [cl(CR+i) for i in range(4)]  # F G H I
OT = section_col_starts['Other']
OT_SALES, OT_MSGS, OT_BOOKED, OT_DEPS = [cl(OT+i) for i in range(4)] # J K L M
TO = section_col_starts['Total']
TO_MSGS, TO_BOOKED, TO_DEPS, TO_RATE = [cl(TO+i) for i in range(4)]   # N O P Q
KP = section_col_starts['KPIs']
KP_SALES, KP_DEP, KP_AOV = [cl(KP+i) for i in range(3)]               # R S T

def row_formulas(n):
    return {
        'to_msgs':   f'={LC_MSGS}{n}+{CR_MSGS}{n}+{OT_MSGS}{n}',
        'to_booked': f'={LC_BOOKED}{n}+{CR_BOOKED}{n}+{OT_BOOKED}{n}',
        'to_deps':   f'={LC_DEPS}{n}+{CR_DEPS}{n}+{OT_DEPS}{n}',
        'to_rate':   f'=IFERROR({TO_BOOKED}{n}/{TO_MSGS}{n},"")',
        'kp_sales':  f'={LC_SALES}{n}+{CR_SALES}{n}+{OT_SALES}{n}',
        'kp_dep':    f'=IFERROR({TO_DEPS}{n}/{TO_BOOKED}{n},"")',
        'kp_aov':    f'=IFERROR({KP_SALES}{n}/{TO_BOOKED}{n},"")',
    }

# ── Parse helpers ─────────────────────────────────────────────────────────────
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
     for ci in range(2, min(55, len(header)))
     if parse_date(header[ci])],
    key=lambda x: x[1]
)
print(f"Abid dates: {date_cols[0][2]} → {date_cols[-1][2]}  ({len(date_cols)} cols)")

# ── Build rows ────────────────────────────────────────────────────────────────
# Row 1: section headers (no title row)
# Row 2: column headers
# Row 3+: data
SECTION_ROW = ['Date']
METRIC_ROW  = ['Date']
for s in SECTION_ORDER:
    n = NCOLS[s]
    SECTION_ROW += [s] + [''] * (n - 1)
    METRIC_ROW  += [name for name, _, _ in SECTIONS[s]]

output_rows = []
for sheet_row, (ci, dt, _) in enumerate(date_cols, start=3):  # data starts row 3
    f = row_formulas(sheet_row)
    row = [dt.strftime('%d/%m/%Y')]

    for _, sr, fmt in LIVE_CHAT_METRICS:
        row.append(parse_num(cell(sr, ci), fmt))
    for _, sr, fmt in CRM_METRICS:
        row.append(parse_num(cell(sr, ci), fmt))
    for _, sr, fmt in OTHER_METRICS:
        row.append(parse_num(cell(sr, ci), fmt))

    row += [f['to_msgs'], f['to_booked'], f['to_deps'], f['to_rate']]
    row += [f['kp_sales'], f['kp_dep'], f['kp_aov']]
    output_rows.append(row)

all_rows = [SECTION_ROW, METRIC_ROW] + output_rows
print(f"Rows: {len(output_rows)}  Cols: {TOTAL_COLS}")

# ── Prepare worksheet ─────────────────────────────────────────────────────────
try:
    ws = sh.worksheet('KPI-Abid')
    ws.clear()
    sh.batch_update({'requests': [{'unmergeCells': {'range': {
        'sheetId': ws.id, 'startRowIndex': 0, 'endRowIndex': 200,
        'startColumnIndex': 0, 'endColumnIndex': 25,
    }}}]})
except Exception:
    ws = sh.add_worksheet('KPI-Abid', rows=200, cols=25)

ws.update(range_name='A1', values=all_rows, value_input_option='USER_ENTERED')
print("Data written")

# ── Palette (exact from user-approved KPI-Rana tab) ───────────────────────────
def rgb(r, g, b):
    return Color(r/255, g/255, b/255)

C = {
    'date_hdr':   (rgb(217,234,211), rgb(39, 78, 19)),   # sage green
    'lc_hdr':     (rgb(255,242,204), rgb(127,96,  0)),   # amber
    'crm_hdr':    (rgb(252,229,205), rgb(120,63,  4)),   # peach-orange
    'ot_hdr':     (rgb(244,204,204), rgb(102, 0,  0)),   # pink-red
    'calc_hdr':   (rgb(230,184,175), rgb( 91,15,  0)),   # salmon (Total + KPIs same)
    'date_data':  rgb(250,246,240),
    'input_data': rgb(255,255,255),
    'tot_data':   rgb(255,243,236),
    'kpi_data':   rgb(255,235,222),
    'dark_txt':   rgb(42, 30, 14),
    'mid_txt':    rgb(80, 62, 34),
    'cream_txt':  rgb(255,252,245),
}

SECTION_HDR_CLR = {
    'Live Chat': C['lc_hdr'],
    'CRM':       C['crm_hdr'],
    'Other':     C['ot_hdr'],
    'Total':     C['calc_hdr'],
    'KPIs':      C['calc_hdr'],
}
SECTION_DATA_BG = {
    'Live Chat': C['input_data'],
    'CRM':       C['input_data'],
    'Other':     C['input_data'],
    'Total':     C['tot_data'],
    'KPIs':      C['kpi_data'],
}

last_col = cl(TOTAL_COLS)
DR_START = 3
DR_END   = 2 + len(output_rows)

fmt_list = []

# Row 1: section headers
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

# Row 2: column headers
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

# Data rows
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

# Number formats
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

# ── Freeze then merge ─────────────────────────────────────────────────────────
set_frozen(ws, rows=2, cols=1)

for s in SECTION_ORDER:
    sc, ec = section_col_starts[s], section_col_starts[s] + NCOLS[s] - 1
    if ec > sc:
        ws.merge_cells(f'{cl(sc)}1:{cl(ec)}1')
print("Merges + freeze applied")

# ── Column widths ─────────────────────────────────────────────────────────────
set_column_width(ws, 'A', 85)
col_widths = {
    'B': 62, 'C': 58, 'D': 55, 'E': 65,
    'F': 62, 'G': 58, 'H': 55, 'I': 65,
    'J': 62, 'K': 58, 'L': 55, 'M': 65,
    'N': 58, 'O': 55, 'P': 65, 'Q': 52,
    'R': 62, 'S': 52, 'T': 62,
}
for col, w in col_widths.items():
    set_column_width(ws, col, w)

set_row_height(ws, '1', 22)
set_row_height(ws, '2', 38)
if output_rows:
    set_row_height(ws, f'{DR_START}:{DR_END}', 20)

print(f"\nDone — {len(output_rows)} rows × {TOTAL_COLS} cols")
print(f"URL: https://docs.google.com/spreadsheets/d/1bHF_7bXic08pcyXQhq310zG6McqXD50oT0EuVkjzDdI/edit#gid={ws.id}")
