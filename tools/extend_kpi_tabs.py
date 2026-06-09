"""
Extends all 12 agent KPI tabs by EXTRA_ROWS rows.
- Column A: continues date sequence (+1 day per row)
- CHAT formula cols (N:T): Total Msgs/Booked/Deps/Rate, KPI Sales/Dep%/AOV
- SDR  formula cols (O:U): Total Sales/Booked/Deps/Rate/Dials, KPI Dep%/AOV
Input columns (B-M for CHAT, B-N for SDR) are left blank for manual entry.
"""

import json, time
from datetime import datetime, timedelta
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

EXTRA_ROWS = 3000
CHUNK = 500  # write in chunks to stay within API payload limits

AGENTS = [
    ('Adeel',    'chat'),
    ('Rana',     'chat'),
    ('Abid',     'chat'),
    ('K&M',      'chat'),
    ('Nicci',    'sdr'),
    ('Juliana',  'sdr'),
    ('Anni',     'sdr'),
    ('Nathalia', 'sdr'),
    ('April',    'sdr'),
    ('Dorianne', 'sdr'),
    ('Queenee',  'sdr'),
    ('VJ',       'sdr'),
]

def chat_formulas(n):
    """Formula row for CHAT tab at sheet row n."""
    return [
        f'=C{n}+G{n}+K{n}',            # N: Total Messages
        f'=D{n}+H{n}+L{n}',            # O: Total Booked
        f'=E{n}+I{n}+M{n}',            # P: Total Deps
        f'=IFERROR(O{n}/N{n},"")',      # Q: Total Rate
        f'=B{n}+F{n}+J{n}',            # R: KPI Sales
        f'=IFERROR(P{n}/O{n},"")',      # S: KPI Dep%
        f'=IFERROR(R{n}/O{n},"")',      # T: KPI AOV
    ]

def sdr_formulas(n):
    """Formula row for SDR tab at sheet row n."""
    return [
        f'=B{n}+G{n}+K{n}',                     # O: Total Sales
        f'=E{n}+I{n}+M{n}',                     # P: Total Booked
        f'=F{n}+J{n}+N{n}',                     # Q: Total Deps
        f'=IFERROR(P{n}/(C{n}+H{n}+L{n}),"")',  # R: Total Rate
        f'=C{n}',                                # S: Total Dials
        f'=IFERROR(Q{n}/P{n},"")',               # T: KPI Dep%
        f'=IFERROR(O{n}/P{n},"")',               # U: KPI AOV
    ]

for name, atype in AGENTS:
    ws = sh.worksheet(name)

    # ── Find last data row and last date ──────────────────────────────────────
    col_a = ws.col_values(1)
    last_data_row = 2  # default to after headers
    last_date_str = None
    for i in range(2, len(col_a)):   # skip rows 0,1 (header rows)
        val = col_a[i].strip()
        if val and val.lower() != 'date':
            last_data_row = i + 1    # convert to 1-indexed
            last_date_str = val
    if not last_date_str:
        print(f"SKIP {name}: no date found in column A")
        continue

    try:
        last_date = datetime.strptime(last_date_str, '%d/%m/%Y')
    except ValueError:
        print(f"SKIP {name}: cannot parse date '{last_date_str}'")
        continue

    start_row = last_data_row + 1
    end_row   = last_data_row + EXTRA_ROWS

    # ── Resize worksheet ─────────────────────────────────────────────────────
    needed = end_row + 5
    if ws.row_count < needed:
        ws.resize(rows=needed)
        time.sleep(1)

    print(f"{name} ({atype}): last row={last_data_row}, last date={last_date_str}, "
          f"extending rows {start_row}–{end_row}")

    # ── Build date and formula data in chunks ─────────────────────────────────
    for chunk_start in range(0, EXTRA_ROWS, CHUNK):
        chunk_end = min(chunk_start + CHUNK, EXTRA_ROWS)
        r_start   = start_row + chunk_start
        r_end     = start_row + chunk_end - 1

        # Dates
        date_vals = []
        for i in range(chunk_start, chunk_end):
            d = last_date + timedelta(days=i + 1)
            date_vals.append([d.strftime('%d/%m/%Y')])

        ws.update(
            range_name=f'A{r_start}:A{r_end}',
            values=date_vals,
            value_input_option='USER_ENTERED'
        )
        time.sleep(0.5)

        # Formulas
        if atype == 'chat':
            fml_vals = [chat_formulas(r) for r in range(r_start, r_end + 1)]
            ws.update(
                range_name=f'N{r_start}:T{r_end}',
                values=fml_vals,
                value_input_option='USER_ENTERED'
            )
        else:
            fml_vals = [sdr_formulas(r) for r in range(r_start, r_end + 1)]
            ws.update(
                range_name=f'O{r_start}:U{r_end}',
                values=fml_vals,
                value_input_option='USER_ENTERED'
            )
        time.sleep(1)

        print(f"  chunk {chunk_start}–{chunk_end} written (rows {r_start}–{r_end})")

    print(f"  ✓ {name} done — {EXTRA_ROWS} rows added\n")
    time.sleep(2)  # pause between agents

print("All agents extended.")
