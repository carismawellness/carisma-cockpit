#!/usr/bin/env python3
"""Build the 'Aesthetics SMM Cal' tab in the Carisma Marketing Master Google Sheet.

Reads v2 working files (angles, key-messages, hooks, scripts) and populates a
new tab mirroring the format of the existing 'Purest SMM Cal' tab.
"""
import json
import re
import sys
import urllib.request
import urllib.parse
from pathlib import Path

SPREADSHEET_ID = "1q40Ke8wRsjnoVOngDupVdwxIWiTFXwYfh1ZwvUa9xtc"
TAB_NAME = "Aesthetics SMM Cal"
TAB_INDEX = 50  # immediately after 'Purest SMM Cal' (idx 49)
WORK_DIR = Path(__file__).resolve().parent

# ---------------------------------------------------------------------------
# Auth
# ---------------------------------------------------------------------------
TOKEN_PATH = Path.home() / ".go-google-mcp" / "token.json"
SECRETS_PATH = Path.home() / ".go-google-mcp" / "client_secrets.json"

def refresh_token():
    """Refresh access_token using stored refresh_token + client_secrets."""
    tok = json.load(open(TOKEN_PATH))
    sec = json.load(open(SECRETS_PATH))["installed"]
    data = urllib.parse.urlencode({
        "client_id": sec["client_id"],
        "client_secret": sec["client_secret"],
        "refresh_token": tok["refresh_token"],
        "grant_type": "refresh_token",
    }).encode()
    req = urllib.request.Request(sec["token_uri"], data=data, method="POST")
    with urllib.request.urlopen(req) as resp:
        new = json.loads(resp.read().decode())
    tok["access_token"] = new["access_token"]
    if "expires_in" in new:
        tok["expires_in"] = new["expires_in"]
    with open(TOKEN_PATH, "w") as f:
        json.dump(tok, f, indent=2)
    print(f"  Refreshed access token (expires in {new.get('expires_in')}s)")
    return tok["access_token"]

def get_token():
    tok = json.load(open(TOKEN_PATH))
    return tok["access_token"]

def api(method, url, body=None):
    token = get_token()
    headers = {
        "Authorization": f"Bearer {token}",
        "Content-Type": "application/json",
    }
    data = json.dumps(body).encode() if body else None
    req = urllib.request.Request(url, data=data, headers=headers, method=method)
    try:
        with urllib.request.urlopen(req) as resp:
            return json.loads(resp.read().decode())
    except urllib.error.HTTPError as e:
        print(f"HTTP {e.code} on {method} {url}", file=sys.stderr)
        print(e.read().decode(), file=sys.stderr)
        raise


# ---------------------------------------------------------------------------
# Parsers
# ---------------------------------------------------------------------------
def parse_angles(text):
    """Return dict keyed by day number → {seo, title, format, category}."""
    out = {}
    # Each entry: ### Day N — Title  followed by metadata bullets
    pattern = re.compile(
        r"^### Day (\d+) — (.+?)\n(.*?)(?=^### Day \d+ —|\Z)",
        re.MULTILINE | re.DOTALL,
    )
    for m in pattern.finditer(text):
        n = int(m.group(1))
        title = m.group(2).strip().strip('"')
        body = m.group(3)
        def get(label):
            r = re.search(rf"\*\*{re.escape(label)}:\*\*\s*(.+)", body)
            return r.group(1).strip() if r else ""
        out[n] = {
            "title": title,
            "seo": get("SEO Keyword"),
            "format": get("Format"),
            "category": get("Category"),
        }
    return out


def parse_key_messages(text):
    """Return dict keyed by day number → key_message body."""
    out = {}
    pattern = re.compile(
        r"^## Day (\d+) — (?:.+?)\n\n(.*?)(?=^## Day \d+ —|\Z)",
        re.MULTILINE | re.DOTALL,
    )
    for m in pattern.finditer(text):
        n = int(m.group(1))
        body = m.group(2).strip()
        # strip trailing horizontal rule separators
        body = re.sub(r"\n---\s*$", "", body).strip()
        out[n] = body
    return out


def parse_hooks(text):
    """Return dict keyed by day number → (hook1, hook2, hook3)."""
    out = {}
    pattern = re.compile(
        r"^## Day (\d+) — (?:.+?)\n(.*?)(?=^## Day \d+ —|^## (?:Pattern Distribution|Style Notes|Change Log)|\Z)",
        re.MULTILINE | re.DOTALL,
    )
    for m in pattern.finditer(text):
        n = int(m.group(1))
        body = m.group(2)
        hooks = []
        for hm in re.finditer(
            r"\*\*Hook ([1234])[^\*]*?:\*\*\s*\n([^\n]+)",
            body,
        ):
            idx = int(hm.group(1))
            line = hm.group(2).strip().strip('"')
            if 1 <= idx <= 3:
                while len(hooks) < idx:
                    hooks.append("")
                hooks[idx - 1] = line
        while len(hooks) < 3:
            hooks.append("")
        out[n] = tuple(hooks[:3])
    return out


def parse_scripts(text):
    """Return dict keyed by day number → full script body."""
    out = {}
    pattern = re.compile(
        r"^## Day (\d+) — (?:.+?)\n(.*?)(?=^## Day \d+ —|^## Master Checklist|^## CTA Quick|\Z)",
        re.MULTILINE | re.DOTALL,
    )
    for m in pattern.finditer(text):
        n = int(m.group(1))
        body = m.group(2).strip()
        body = re.sub(r"\n---\s*$", "", body).strip()
        out[n] = body
    return out


# ---------------------------------------------------------------------------
# Color helpers (RGB 0–1)
# ---------------------------------------------------------------------------
DARK_TEAL = {"red": 0.110, "green": 0.298, "blue": 0.341}
GOLD = {"red": 0.722, "green": 0.580, "blue": 0.243}
CREAM = {"red": 0.984, "green": 0.961, "blue": 0.910}
WHITE = {"red": 1.0, "green": 1.0, "blue": 1.0}

CATEGORY_COLORS = {
    "Treatment Explainer":   {"red": 0.85, "green": 0.92, "blue": 0.98},  # soft blue
    "Myth-Buster":           {"red": 0.99, "green": 0.86, "blue": 0.78},  # soft coral
    "Educational":           {"red": 0.84, "green": 0.94, "blue": 0.91},  # soft mint
    "Before-and-After":      {"red": 0.87, "green": 0.95, "blue": 0.83},  # soft green
    "Patient Q&A":           {"red": 0.92, "green": 0.86, "blue": 0.96},  # soft lavender
    "Trend Response":        {"red": 0.99, "green": 0.88, "blue": 0.93},  # soft pink
    "Behind-the-Scenes":     {"red": 0.92, "green": 0.92, "blue": 0.92},  # soft grey
    "Combination Treatment": {"red": 0.98, "green": 0.92, "blue": 0.78},  # soft gold
    "Aftercare":             {"red": 0.94, "green": 0.89, "blue": 0.98},  # soft lilac
}


# ---------------------------------------------------------------------------
# Main build
# ---------------------------------------------------------------------------
def main():
    print("Refreshing token...")
    refresh_token()
    angles = parse_angles((WORK_DIR / "03-angles.md").read_text())
    key_msgs = parse_key_messages((WORK_DIR / "04-key-messages.md").read_text())
    hooks = parse_hooks((WORK_DIR / "05-hooks.md").read_text())
    scripts = parse_scripts((WORK_DIR / "06-scripts.md").read_text())

    days = sorted(set(angles) | set(key_msgs) | set(hooks) | set(scripts))
    print(f"Parsed: angles={len(angles)}, key_msgs={len(key_msgs)}, hooks={len(hooks)}, scripts={len(scripts)}")
    print(f"Days present: {days[0]}..{days[-1]} ({len(days)} total)")
    missing = []
    for n in days:
        rec = {
            "angle": n in angles,
            "key": n in key_msgs,
            "hooks": n in hooks,
            "script": n in scripts,
        }
        if not all(rec.values()):
            missing.append((n, rec))
    if missing:
        print("WARN — missing pieces:")
        for n, rec in missing:
            print(f"  Day {n}: {rec}")

    # --- Build value matrix (rows × cols) ---
    headers = [
        "SEO", "Content Angle", "Owner", "Format", "Category",
        "Key message", "Hook 1", "Hook 2", "Hook 3", "Script",
        "", "",  # K, L spacers
        "Source", "Platform", "Views", "Followers", "Viral?",
        "Topic", "Hook", "Video format", "Caption", "Video link",
        "Repost", "Downloaded",
    ]

    # Title is split across two merged segments because A:B is in the frozen-column region
    # and merges cannot cross the freeze boundary.
    title_brand = "CARISMA AESTHETICS ACADEMY"  # A1:B1 (frozen)
    title_desc = "31-Day SMM Content Calendar  ·  Subtle by Design"  # C1:J1 (non-frozen)
    primer = (
        "GPT primer: You are an aesthetic medical practitioner at Carisma Aesthetics in Malta. "
        "Voice: warm, confident, anti-fearmongering, anti-overdone-look. You champion \"Subtle by Design\" "
        "— results that are deliberate, not accidental; restraint that requires skill; outcomes that look "
        "like the patient on their best day. Treatments in scope: anti-wrinkle injections (neuromodulators), "
        "dermal fillers, polynucleotides, Profhilo, Sculptra, fat-dissolving. OUT OF SCOPE: laser, "
        "HydraFacial, IPL. Audience: women (and men) 25+ in Malta, English-first. Use UK/EU spelling. "
        "Never use confidence-linking language. Always include the disclaimer \"Results vary by individual. "
        "Consultation required before any treatment.\" in caption copy."
    )

    rows = []
    # Row 1 (title) — A1 (frozen) holds brand label; C1 (non-frozen) holds descriptive subtitle
    row1 = [title_brand, "", title_desc] + [""] * 22
    rows.append(row1)
    # Row 2 (primer) — primer in B2, brand POV chip in K2
    row2 = [""] * 25
    row2[1] = primer  # B2
    row2[10] = "Brand POV: Subtle by Design"  # K2
    rows.append(row2)
    # Row 3 (headers)
    rows.append(headers)
    # Data rows
    for n in days:
        a = angles.get(n, {})
        h = hooks.get(n, ("", "", ""))
        row = [
            a.get("seo", ""),
            a.get("title", ""),
            "",                                # Owner
            a.get("format", ""),
            a.get("category", ""),
            key_msgs.get(n, ""),
            h[0], h[1], h[2],
            scripts.get(n, ""),
            "", "",                            # K, L
            "", "", "", "", "", "", "", "", "", "", "", "",  # M–Y empty
        ]
        rows.append(row)

    print(f"\nBuilt {len(rows)} rows × {len(rows[0])} cols")

    # --- Delete existing tab if present (idempotency) ---
    print("\nChecking for existing tab...")
    meta = api(
        "GET",
        f"https://sheets.googleapis.com/v4/spreadsheets/{SPREADSHEET_ID}?fields=sheets.properties(sheetId,title)",
    )
    existing = [s["properties"] for s in meta["sheets"] if s["properties"]["title"] == TAB_NAME]
    if existing:
        old_id = existing[0]["sheetId"]
        print(f"  Found existing tab (sheetId={old_id}) — deleting")
        api(
            "POST",
            f"https://sheets.googleapis.com/v4/spreadsheets/{SPREADSHEET_ID}:batchUpdate",
            {"requests": [{"deleteSheet": {"sheetId": old_id}}]},
        )

    # --- Create the sheet ---
    print("Creating sheet...")
    create_resp = api(
        "POST",
        f"https://sheets.googleapis.com/v4/spreadsheets/{SPREADSHEET_ID}:batchUpdate",
        {
            "requests": [
                {
                    "addSheet": {
                        "properties": {
                            "title": TAB_NAME,
                            "index": TAB_INDEX,
                            "gridProperties": {
                                "rowCount": max(50, len(rows) + 6),
                                "columnCount": 25,
                                "frozenRowCount": 3,
                                "frozenColumnCount": 2,
                                "hideGridlines": True,
                            },
                        }
                    }
                }
            ]
        },
    )
    sheet_id = create_resp["replies"][0]["addSheet"]["properties"]["sheetId"]
    print(f"  Created: sheetId={sheet_id}")

    # --- Push values ---
    print("Pushing values...")
    end_row = len(rows)
    range_a1 = f"'{TAB_NAME}'!A1:Y{end_row}"
    api(
        "PUT",
        f"https://sheets.googleapis.com/v4/spreadsheets/{SPREADSHEET_ID}/values/"
        f"{urllib.parse.quote(range_a1)}?valueInputOption=RAW",
        {"values": rows},
    )
    print(f"  Pushed: {end_row} rows × 25 cols")

    # --- Apply formatting (single batchUpdate) ---
    print("Applying formatting...")

    requests = []

    # 1. Merge title cells — must respect frozen-column boundary (cols 0-1 are frozen)
    # Merge A1:B1 within frozen area, then C1:J1 outside it (both stay dark-teal-styled)
    requests.append({
        "mergeCells": {
            "range": {"sheetId": sheet_id, "startRowIndex": 0, "endRowIndex": 1, "startColumnIndex": 0, "endColumnIndex": 2},
            "mergeType": "MERGE_ALL",
        }
    })
    requests.append({
        "mergeCells": {
            "range": {"sheetId": sheet_id, "startRowIndex": 0, "endRowIndex": 1, "startColumnIndex": 2, "endColumnIndex": 10},
            "mergeType": "MERGE_ALL",
        }
    })

    # 2. Row 1 title style
    requests.append({
        "repeatCell": {
            "range": {"sheetId": sheet_id, "startRowIndex": 0, "endRowIndex": 1, "startColumnIndex": 0, "endColumnIndex": 25},
            "cell": {
                "userEnteredFormat": {
                    "backgroundColor": DARK_TEAL,
                    "horizontalAlignment": "CENTER",
                    "verticalAlignment": "MIDDLE",
                    "textFormat": {"foregroundColor": WHITE, "bold": True, "fontSize": 16},
                }
            },
            "fields": "userEnteredFormat(backgroundColor,horizontalAlignment,verticalAlignment,textFormat)",
        }
    })
    requests.append({
        "updateDimensionProperties": {
            "range": {"sheetId": sheet_id, "dimension": "ROWS", "startIndex": 0, "endIndex": 1},
            "properties": {"pixelSize": 48},
            "fields": "pixelSize",
        }
    })

    # 3. Row 2 primer style (whole row)
    requests.append({
        "repeatCell": {
            "range": {"sheetId": sheet_id, "startRowIndex": 1, "endRowIndex": 2, "startColumnIndex": 0, "endColumnIndex": 25},
            "cell": {
                "userEnteredFormat": {
                    "backgroundColor": WHITE,
                    "wrapStrategy": "WRAP",
                    "verticalAlignment": "MIDDLE",
                    "textFormat": {"italic": True, "fontSize": 10, "foregroundColor": {"red": 0.3, "green": 0.3, "blue": 0.3}},
                }
            },
            "fields": "userEnteredFormat(backgroundColor,wrapStrategy,verticalAlignment,textFormat)",
        }
    })
    # K2 brand POV chip
    requests.append({
        "repeatCell": {
            "range": {"sheetId": sheet_id, "startRowIndex": 1, "endRowIndex": 2, "startColumnIndex": 10, "endColumnIndex": 11},
            "cell": {
                "userEnteredFormat": {
                    "backgroundColor": GOLD,
                    "horizontalAlignment": "CENTER",
                    "verticalAlignment": "MIDDLE",
                    "wrapStrategy": "WRAP",
                    "textFormat": {"foregroundColor": WHITE, "bold": True, "italic": False, "fontSize": 10},
                }
            },
            "fields": "userEnteredFormat(backgroundColor,horizontalAlignment,verticalAlignment,wrapStrategy,textFormat)",
        }
    })
    requests.append({
        "updateDimensionProperties": {
            "range": {"sheetId": sheet_id, "dimension": "ROWS", "startIndex": 1, "endIndex": 2},
            "properties": {"pixelSize": 80},
            "fields": "pixelSize",
        }
    })

    # 4. Row 3 header style
    requests.append({
        "repeatCell": {
            "range": {"sheetId": sheet_id, "startRowIndex": 2, "endRowIndex": 3, "startColumnIndex": 0, "endColumnIndex": 25},
            "cell": {
                "userEnteredFormat": {
                    "backgroundColor": DARK_TEAL,
                    "horizontalAlignment": "LEFT",
                    "verticalAlignment": "MIDDLE",
                    "wrapStrategy": "WRAP",
                    "textFormat": {"foregroundColor": WHITE, "bold": True, "fontSize": 11},
                    "borders": {
                        "bottom": {"style": "SOLID_MEDIUM", "color": {"red": 0.0, "green": 0.0, "blue": 0.0}},
                    },
                }
            },
            "fields": "userEnteredFormat(backgroundColor,horizontalAlignment,verticalAlignment,wrapStrategy,textFormat,borders)",
        }
    })
    requests.append({
        "updateDimensionProperties": {
            "range": {"sheetId": sheet_id, "dimension": "ROWS", "startIndex": 2, "endIndex": 3},
            "properties": {"pixelSize": 40},
            "fields": "pixelSize",
        }
    })

    # 5. Data rows default style (rows 4-..)
    data_start = 3
    data_end = len(rows)
    requests.append({
        "repeatCell": {
            "range": {"sheetId": sheet_id, "startRowIndex": data_start, "endRowIndex": data_end, "startColumnIndex": 0, "endColumnIndex": 25},
            "cell": {
                "userEnteredFormat": {
                    "wrapStrategy": "WRAP",
                    "verticalAlignment": "TOP",
                    "textFormat": {"fontSize": 10},
                }
            },
            "fields": "userEnteredFormat(wrapStrategy,verticalAlignment,textFormat)",
        }
    })

    # 6. Alternating row banding
    requests.append({
        "addBanding": {
            "bandedRange": {
                "range": {
                    "sheetId": sheet_id,
                    "startRowIndex": data_start,
                    "endRowIndex": data_end,
                    "startColumnIndex": 0,
                    "endColumnIndex": 25,
                },
                "rowProperties": {
                    "firstBandColor": WHITE,
                    "secondBandColor": CREAM,
                },
            }
        }
    })

    # 7. Column widths
    col_widths = [
        (0, 1, 130),   # A SEO
        (1, 2, 320),   # B Title
        (2, 3, 80),    # C Owner
        (3, 4, 130),   # D Format
        (4, 5, 140),   # E Category
        (5, 6, 500),   # F Key message
        (6, 7, 220),   # G Hook 1
        (7, 8, 220),   # H Hook 2
        (8, 9, 220),   # I Hook 3
        (9, 10, 540),  # J Script
        (10, 11, 30),  # K
        (11, 12, 30),  # L
        (12, 25, 110), # M-Y
    ]
    for start, end, width in col_widths:
        requests.append({
            "updateDimensionProperties": {
                "range": {"sheetId": sheet_id, "dimension": "COLUMNS", "startIndex": start, "endIndex": end},
                "properties": {"pixelSize": width},
                "fields": "pixelSize",
            }
        })

    # 8. Conditional formatting for Category column (E = index 4)
    for i, (cat, color) in enumerate(CATEGORY_COLORS.items()):
        requests.append({
            "addConditionalFormatRule": {
                "rule": {
                    "ranges": [{
                        "sheetId": sheet_id,
                        "startRowIndex": data_start,
                        "endRowIndex": data_end,
                        "startColumnIndex": 4,
                        "endColumnIndex": 5,
                    }],
                    "booleanRule": {
                        "condition": {
                            "type": "TEXT_EQ",
                            "values": [{"userEnteredValue": cat}],
                        },
                        "format": {
                            "backgroundColor": color,
                            "textFormat": {"bold": True},
                        },
                    },
                },
                "index": i,
            }
        })

    # 9. Week separator borders (between days 7/8, 14/15, 21/22, 28/29)
    # Day N is at row index data_start + (N - 1) = 2 + N
    for after_day in [7, 14, 21, 28]:
        # Row index of "Day after_day" data row = data_start + (after_day - 1)
        row_idx = data_start + (after_day - 1)
        requests.append({
            "updateBorders": {
                "range": {
                    "sheetId": sheet_id,
                    "startRowIndex": row_idx,
                    "endRowIndex": row_idx + 1,
                    "startColumnIndex": 0,
                    "endColumnIndex": 25,
                },
                "bottom": {
                    "style": "SOLID",
                    "color": {"red": 0.6, "green": 0.6, "blue": 0.6},
                },
            }
        })

    print(f"  Sending {len(requests)} formatting requests...")
    api(
        "POST",
        f"https://sheets.googleapis.com/v4/spreadsheets/{SPREADSHEET_ID}:batchUpdate",
        {"requests": requests},
    )
    print("  Formatting applied")

    # --- Verify ---
    print("\nVerifying...")
    verify_range = f"'{TAB_NAME}'!A3:E5"
    resp = api(
        "GET",
        f"https://sheets.googleapis.com/v4/spreadsheets/{SPREADSHEET_ID}/values/"
        f"{urllib.parse.quote(verify_range)}",
    )
    for r in resp.get("values", []):
        print("  " + " | ".join(c[:60] for c in r))

    print(f"\n✓ Done")
    print(f"  Tab: '{TAB_NAME}' (sheetId={sheet_id})")
    print(f"  URL: https://docs.google.com/spreadsheets/d/{SPREADSHEET_ID}/edit?gid={sheet_id}")


if __name__ == "__main__":
    main()
