"""
SDR KPI Template Builder — "KPI-SDR Template"

Layout:  Date | Outbound (5) | Inbound (4) | Chat (4) | Total (5) | KPIs (2)
         ─────────────────────────────────────────────────────────── 21 cols (A-U)

- Input sections:   Outbound (B-F), Inbound (G-J), Chat (K-N) — all manual
- Total section:    O-S — all formulas (Sales, Booked, w/Deposit, Rate, Dials)
- KPIs section:     T-U — all formulas (Dep. %, AOV)
- 50 blank pre-formatted rows with formulas in Total + KPI columns
- No title row — section headers are Row 1, column headers are Row 2
"""

import json
from google.oauth2.credentials import Credentials
from google.auth.transport.requests import Request
import gspread
from gspread.utils import rowcol_to_a1
from gspread_formatting import (
    format_cell_ranges, CellFormat, Color, TextFormat,
    set_frozen, set_column_width, set_row_height,
)

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
    with open('/Users/mertgulen/.go-google-mcp/token.json', 'w') as f:
        json.dump({
            'access_token': creds.token, 'token_type': 'Bearer',
            'refresh_token': creds.refresh_token,
            'expiry': creds.expiry.isoformat() if creds.expiry else '',
            'expires_in': 3600,
        }, f)

gc = gspread.authorize(creds)
sh = gc.open_by_key('1bHF_7bXic08pcyXQhq310zG6McqXD50oT0EuVkjzDdI')

# ── Column map (1-based) ──────────────────────────────────────────────────────
#  A=1  Date
#  B=2  Outbound Sales       C=3  Outbound Dials
#  D=4  Outbound Answered    E=5  Outbound Booked    F=6  Outbound w/Deposit
#  G=7  Inbound Sales        H=8  Inbound Received
#  I=9  Inbound Booked       J=10 Inbound w/Deposit
#  K=11 Chat Sales           L=12 Chat Conversations
#  M=13 Chat Booked          N=14 Chat w/Deposit
#  O=15 Total Sales          P=16 Total Booked
#  Q=17 Total w/Deposit      R=18 Total Rate         S=19 Total Dials
#  T=20 KPI Dep. %           U=21 KPI AOV

TOTAL_COLS = 21

def cl(c):
    return rowcol_to_a1(1, c)[:-1]

B,C,D,E,F = cl(2),cl(3),cl(4),cl(5),cl(6)
G,H,I,J   = cl(7),cl(8),cl(9),cl(10)
K,L,M,N   = cl(11),cl(12),cl(13),cl(14)
O,P,Q,R,S = cl(15),cl(16),cl(17),cl(18),cl(19)
T,U       = cl(20),cl(21)

# ── Formula builder ───────────────────────────────────────────────────────────
def row_formulas(r):
    return {
        O: f'=IFERROR({B}{r}+{G}{r}+{K}{r},"")',
        P: f'=IFERROR({E}{r}+{I}{r}+{M}{r},"")',
        Q: f'=IFERROR({F}{r}+{J}{r}+{N}{r},"")',
        R: f'=IFERROR({P}{r}/({C}{r}+{H}{r}+{L}{r}),"")',
        S: f'={C}{r}',
        T: f'=IFERROR({Q}{r}/{P}{r},"")',
        U: f'=IFERROR({O}{r}/{P}{r},"")',
    }

# ── Header rows ───────────────────────────────────────────────────────────────
SECTION_HEADERS = [
    'Date',
    'Outbound','','','','',
    'Inbound','','','',
    'Chat','','','',
    'Total','','','','',
    'KPIs','',
]
COLUMN_HEADERS = [
    'Date',
    'Sales','Dials','Answered','Booked','w/ Deposit',
    'Sales','Received','Booked','w/ Deposit',
    'Sales','Conversations','Booked','w/ Deposit',
    'Sales','Booked','w/ Deposit','Rate','Dials',
    'Dep. %','AOV',
]

# ── 50 blank data rows with formulas ─────────────────────────────────────────
DATA_START_ROW = 3
NUM_DATA_ROWS  = 50

data_rows = []
for i in range(NUM_DATA_ROWS):
    r = DATA_START_ROW + i
    f = row_formulas(r)
    row = (
        [''] +           # A: Date
        ['','','','',''] +  # B-F: Outbound
        ['','','',''] +     # G-J: Inbound
        ['','','',''] +     # K-N: Chat
        [f[O],f[P],f[Q],f[R],f[S]] +  # O-S: Total
        [f[T],f[U]]         # T-U: KPIs
    )
    data_rows.append(row)

ALL_ROWS = [SECTION_HEADERS, COLUMN_HEADERS] + data_rows
print(f"Rows to write: {len(ALL_ROWS)}  Cols: {TOTAL_COLS}")

# ── Prepare worksheet ─────────────────────────────────────────────────────────
TAB_NAME = 'KPI-SDR Template'
try:
    ws = sh.worksheet(TAB_NAME)
    ws.clear()
    sh.batch_update({'requests': [{'unmergeCells': {'range': {
        'sheetId': ws.id,
        'startRowIndex': 0, 'endRowIndex': 200,
        'startColumnIndex': 0, 'endColumnIndex': TOTAL_COLS + 2,
    }}}]})
    print(f"Cleared existing '{TAB_NAME}'")
except gspread.exceptions.WorksheetNotFound:
    ws = sh.add_worksheet(TAB_NAME, rows=200, cols=TOTAL_COLS + 2)
    print(f"Created new '{TAB_NAME}'")

ws.update(range_name='A1', values=ALL_ROWS, value_input_option='USER_ENTERED')
print("Data written")

# ── Palette ───────────────────────────────────────────────────────────────────
def rgb(r,g,b): return Color(r/255, g/255, b/255)

C = {
    'date_hdr_bg':  rgb(217,234,211), 'date_hdr_txt': rgb(39,78,19),
    'ob_hdr_bg':    rgb(255,242,204), 'ob_hdr_txt':   rgb(127,96,0),
    'ib_hdr_bg':    rgb(252,229,205), 'ib_hdr_txt':   rgb(120,63,4),
    'ch_hdr_bg':    rgb(244,204,204), 'ch_hdr_txt':   rgb(102,0,0),
    'to_hdr_bg':    rgb(230,184,175), 'to_hdr_txt':   rgb(91,15,0),
    'kp_hdr_bg':    rgb(230,184,175), 'kp_hdr_txt':   rgb(91,15,0),
    'date_data_bg': rgb(250,246,240), 'date_data_txt':rgb(80,62,34),
    'in_data_bg':   rgb(255,255,255), 'in_data_txt':  rgb(42,30,14),
    'to_data_bg':   rgb(255,243,236), 'to_data_txt':  rgb(42,30,14),
    'kp_data_bg':   rgb(255,235,222), 'kp_data_txt':  rgb(42,30,14),
}

DR_START = DATA_START_ROW
DR_END   = DATA_START_ROW + NUM_DATA_ROWS - 1

fmt_list = []

# Row 1 — section headers
for rng, bg, fg in [
    ('A1',    C['date_hdr_bg'], C['date_hdr_txt']),
    ('B1:F1', C['ob_hdr_bg'],  C['ob_hdr_txt']),
    ('G1:J1', C['ib_hdr_bg'],  C['ib_hdr_txt']),
    ('K1:N1', C['ch_hdr_bg'],  C['ch_hdr_txt']),
    ('O1:S1', C['to_hdr_bg'],  C['to_hdr_txt']),
    ('T1:U1', C['kp_hdr_bg'],  C['kp_hdr_txt']),
]:
    fmt_list.append((rng, CellFormat(
        backgroundColor=bg,
        textFormat=TextFormat(bold=True,fontSize=9,foregroundColor=fg,fontFamily='Arial'),
        horizontalAlignment='CENTER', verticalAlignment='MIDDLE',
    )))

# Row 2 — column headers
for rng, bg, fg in [
    ('A2',    C['date_hdr_bg'], C['date_hdr_txt']),
    ('B2:F2', C['ob_hdr_bg'],  C['ob_hdr_txt']),
    ('G2:J2', C['ib_hdr_bg'],  C['ib_hdr_txt']),
    ('K2:N2', C['ch_hdr_bg'],  C['ch_hdr_txt']),
    ('O2:S2', C['to_hdr_bg'],  C['to_hdr_txt']),
    ('T2:U2', C['kp_hdr_bg'],  C['kp_hdr_txt']),
]:
    fmt_list.append((rng, CellFormat(
        backgroundColor=bg,
        textFormat=TextFormat(bold=True,fontSize=8,foregroundColor=fg,fontFamily='Arial'),
        horizontalAlignment='CENTER', verticalAlignment='MIDDLE', wrapStrategy='WRAP',
    )))

# Data rows
for rng, bg, txt, italic in [
    (f'A{DR_START}:A{DR_END}',   C['date_data_bg'], C['date_data_txt'], False),
    (f'B{DR_START}:N{DR_END}',   C['in_data_bg'],   C['in_data_txt'],   False),
    (f'O{DR_START}:S{DR_END}',   C['to_data_bg'],   C['to_data_txt'],   True),
    (f'T{DR_START}:U{DR_END}',   C['kp_data_bg'],   C['kp_data_txt'],   True),
]:
    fmt_list.append((rng, CellFormat(
        backgroundColor=bg,
        textFormat=TextFormat(fontSize=9,foregroundColor=txt,fontFamily='Arial',
                              bold=(rng.startswith('A')),italic=italic),
        horizontalAlignment='CENTER', verticalAlignment='MIDDLE',
    )))

# Number formats
FMT_EUR  = CellFormat(numberFormat={'type':'CURRENCY','pattern':'€#,##0'})
FMT_EUR2 = CellFormat(numberFormat={'type':'CURRENCY','pattern':'€#,##0.00'})
FMT_INT  = CellFormat(numberFormat={'type':'NUMBER','pattern':'#,##0'})
FMT_PCT  = CellFormat(numberFormat={'type':'PERCENT','pattern':'0.0%'})

num_fmts = [
    (f'B{DR_START}:B{DR_END}', FMT_EUR),   # OB Sales
    (f'C{DR_START}:C{DR_END}', FMT_INT),   # OB Dials
    (f'D{DR_START}:D{DR_END}', FMT_INT),   # OB Answered
    (f'E{DR_START}:E{DR_END}', FMT_INT),   # OB Booked
    (f'F{DR_START}:F{DR_END}', FMT_INT),   # OB w/Deposit
    (f'G{DR_START}:G{DR_END}', FMT_EUR),   # IB Sales
    (f'H{DR_START}:H{DR_END}', FMT_INT),   # IB Received
    (f'I{DR_START}:I{DR_END}', FMT_INT),   # IB Booked
    (f'J{DR_START}:J{DR_END}', FMT_INT),   # IB w/Deposit
    (f'K{DR_START}:K{DR_END}', FMT_EUR),   # Chat Sales
    (f'L{DR_START}:L{DR_END}', FMT_INT),   # Chat Conversations
    (f'M{DR_START}:M{DR_END}', FMT_INT),   # Chat Booked
    (f'N{DR_START}:N{DR_END}', FMT_INT),   # Chat w/Deposit
    (f'O{DR_START}:O{DR_END}', FMT_EUR),   # Total Sales
    (f'P{DR_START}:P{DR_END}', FMT_INT),   # Total Booked
    (f'Q{DR_START}:Q{DR_END}', FMT_INT),   # Total w/Deposit
    (f'R{DR_START}:R{DR_END}', FMT_PCT),   # Rate
    (f'S{DR_START}:S{DR_END}', FMT_INT),   # Total Dials
    (f'T{DR_START}:T{DR_END}', FMT_PCT),   # Dep. %
    (f'U{DR_START}:U{DR_END}', FMT_EUR2),  # AOV
]
fmt_list.extend(num_fmts)

format_cell_ranges(ws, fmt_list)
print("Formatting applied")

# ── Freeze (rows=2, cols=1) BEFORE merges ────────────────────────────────────
set_frozen(ws, rows=2, cols=1)
print("Freeze applied")

# ── Merge row 1 section headers AFTER freeze ─────────────────────────────────
ws.merge_cells('B1:F1')
ws.merge_cells('G1:J1')
ws.merge_cells('K1:N1')
ws.merge_cells('O1:S1')
ws.merge_cells('T1:U1')
print("Merges applied")

# ── Column widths ─────────────────────────────────────────────────────────────
widths = {
    'A':85, 'B':62, 'C':58, 'D':68, 'E':58, 'F':68,
    'G':62, 'H':68, 'I':58, 'J':68,
    'K':62, 'L':88, 'M':58, 'N':68,
    'O':62, 'P':58, 'Q':68, 'R':52, 'S':52,
    'T':52, 'U':62,
}
for col, w in widths.items():
    set_column_width(ws, col, w)
print("Column widths set")

# ── Row heights ───────────────────────────────────────────────────────────────
set_row_height(ws, '1', 22)
set_row_height(ws, '2', 38)
set_row_height(ws, f'{DR_START}:{DR_END}', 20)
print("Row heights set")

print(f"\nDone — {NUM_DATA_ROWS} rows x {TOTAL_COLS} cols (A-U)")
print(f"Tab: '{TAB_NAME}'")
print(f"URL: https://docs.google.com/spreadsheets/d/1bHF_7bXic08pcyXQhq310zG6McqXD50oT0EuVkjzDdI/edit#gid={ws.id}")
