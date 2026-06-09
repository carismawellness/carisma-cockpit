"""
Rebuilds daily rep KPI formulas in the MASTER tab (rows 25-37, cols D-K).

Layout reference:
  CHAT tabs (20 cols): A=Date | B-E=LiveChat | F-I=CRM | J-M=Other | N-Q=Total(Msgs/Booked/Deps/Rate) | R-T=KPIs(Sales/Dep%/AOV)
  SDR  tabs (21 cols): A=Date | B-F=OB(Sales/Dials/Ans/Booked/Deps) | G-J=IB(Sales/Rcvd/Booked/Deps) |
                        K-N=Chat(Sales/Convs/Booked/Deps) | O-S=Total(Sales/Booked/Deps/Rate/Dials) | T-U=KPIs(Dep%/AOV)

MASTER columns D-K (rep rows 25-36, total row 37):
  D = Sales        E = Bookings    F = AOV
  G = Booking Eff  H = Booking Rate  I = Dials  J = Texts  K = Deposit %
"""

import json
import gspread
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
ws = sh.worksheet('MASTER')

# Date lookup cell — wrap in DATEVALUE(TEXT()) to normalise serial vs typed date
DATE = 'DATEVALUE(TEXT($D$22,"dd/mm/yyyy"))'

def tab(name):
    """Wrap tab name in single quotes if it has special chars."""
    if any(c in name for c in "&' "):
        return f"'{name}'"
    return name

def sdr_row(name):
    t = tab(name)
    # SDR column index in KPI tab (1-based):
    # O(15)=Total Sales, P(16)=Total Booked, U(21)=AOV
    # E(5)=OB Booked, D(4)=OB Answered → Booking Eff
    # R(18)=Total Rate, S(19)=Total Dials
    # L(12)=Chat Convs (Texts), T(20)=Dep%
    vl = lambda col: f'IFERROR(VLOOKUP({DATE},{t}!$A:$U,{col},0),"")'
    return [
        f'={vl(15)}',                                         # D: Sales
        f'={vl(16)}',                                         # E: Bookings
        f'={vl(21)}',                                         # F: AOV
        f'=IFERROR({vl(5)}/{vl(4)},"")',                      # G: Booking Eff (OB Booked / OB Answered)
        f'={vl(18)}',                                         # H: Booking Rate (Total Rate)
        f'={vl(19)}',                                         # I: Dials
        f'={vl(12)}',                                         # J: Texts (Chat Convs)
        f'={vl(20)}',                                         # K: Deposit %
    ]

def chat_row(name):
    t = tab(name)
    # CHAT column index in KPI tab (1-based):
    # R(18)=KPI Sales, O(15)=Total Booked, T(20)=AOV
    # N(14)=Total Msgs (Texts), S(19)=Dep%
    # No Booking Eff, Booking Rate, Dials for CHAT
    vl = lambda col: f'IFERROR(VLOOKUP({DATE},{t}!$A:$T,{col},0),"")'
    return [
        f'={vl(18)}',   # D: Sales
        f'={vl(15)}',   # E: Bookings
        f'={vl(20)}',   # F: AOV
        '',              # G: Booking Eff — N/A for CHAT
        '',              # H: Booking Rate — N/A for CHAT
        '',              # I: Dials — N/A for CHAT
        f'={vl(14)}',   # J: Texts (Total Msgs)
        f'={vl(19)}',   # K: Deposit %
    ]

# Rep rows 24-35 (Nicci through VJ), TOTAL at row 36
REPS = [
    ('Nicci',    'sdr',  24),
    ('Juliana',  'sdr',  25),
    ('Anni',     'sdr',  26),
    ('Nathalia', 'sdr',  27),
    ('April',    'sdr',  28),
    ('Dorianne', 'sdr',  29),
    ('Queenee',  'sdr',  30),
    ('Rana',     'chat', 31),
    ('Abid',     'chat', 32),
    ('Adeel',    'chat', 33),
    ('K&M',      'chat', 34),
    ('VJ',       'sdr',  35),
]

# Build data rows for D24:K36 (13 rows, 8 cols)
data = []
for name, rtype, _ in REPS:
    if rtype == 'sdr':
        data.append(sdr_row(name))
    else:
        data.append(chat_row(name))

# TOTAL row (row 36): sums over rows 24-35
data.append([
    '=SUM(D24:D35)',                         # D: Total Sales
    '=SUM(E24:E35)',                         # E: Total Bookings
    '=IFERROR(D36/E36,"")',                  # F: Overall AOV
    '',                                       # G: Booking Eff
    '',                                       # H: Booking Rate
    '=SUM(I24:I35)',                         # I: Total Dials
    '=SUM(J24:J35)',                         # J: Total Texts
    '',                                       # K: Deposit %
])

# Clear any stale data from prior incorrect write (rows 25-37 now also have formulas)
ws.batch_clear(['D37:K37'])

ws.update(range_name='D24:K36', values=data, value_input_option='USER_ENTERED')
print(f"Wrote {len(data)} rows × 8 cols to MASTER!D24:K36")
print("Done.")
