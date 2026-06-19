"""
Google OAuth Re-Authorization — READ/WRITE Scope
Generates a refresh token that can both read AND write to Google Sheets.

Run once before using etl_zoho_spa_raw_layer.py:
    cd "10-Tech/CEO-Cockpit/etl"
    py google_reauth_write.py

Then open the printed URL in your browser, authorize with the Carisma account,
and the script will capture the code and update .env automatically.

NOTE: This replaces GOOGLE_SHEETS_REFRESH_TOKEN with a write-capable token.
The Aesthetics read ETL also works fine with a write-capable token — it's
strictly more permissive, so no other ETLs break.
"""

import os, sys, json, urllib.request, urllib.parse, webbrowser, threading
from pathlib import Path
from http.server import HTTPServer, BaseHTTPRequestHandler

try:
    from dotenv import load_dotenv, set_key
except ImportError:
    import subprocess
    subprocess.check_call([sys.executable, "-m", "pip", "install", "python-dotenv"])
    from dotenv import load_dotenv, set_key

_etl_dir  = Path(__file__).resolve().parent
_env_root = _etl_dir.parents[2] / ".env"
load_dotenv(_env_root)

CLIENT_ID     = os.environ.get("GOOGLE_SHEETS_CLIENT_ID") or os.environ.get("GOOGLE_CLIENT_ID")
CLIENT_SECRET = os.environ.get("GOOGLE_SHEETS_CLIENT_SECRET") or os.environ.get("GOOGLE_CLIENT_SECRET")
REDIRECT_URI  = "http://localhost:8080"

# Full read/write scope (not readonly)
SCOPE = "https://www.googleapis.com/auth/spreadsheets"

if not CLIENT_ID or not CLIENT_SECRET:
    print("ERROR: GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET not found in .env")
    sys.exit(1)

auth_url = (
    "https://accounts.google.com/o/oauth2/v2/auth?"
    + urllib.parse.urlencode({
        "client_id":     CLIENT_ID,
        "redirect_uri":  REDIRECT_URI,
        "response_type": "code",
        "scope":         SCOPE,
        "access_type":   "offline",
        "prompt":        "consent",  # always shows consent screen to force refresh_token in response
    })
)

_auth_code: list[str] = []


class _Handler(BaseHTTPRequestHandler):
    def log_message(self, *_): pass

    def do_GET(self):
        parsed = urllib.parse.urlparse(self.path)
        params = urllib.parse.parse_qs(parsed.query)
        if "code" in params:
            _auth_code.append(params["code"][0])
            self.send_response(200)
            self.send_header("Content-Type", "text/html")
            self.end_headers()
            self.wfile.write(b"""
                <html><body style="font-family:sans-serif;padding:40px">
                <h2 style="color:green">Authorization successful!</h2>
                <p>You can close this tab and return to the terminal.</p>
                </body></html>
            """)
        else:
            error = params.get("error", ["unknown"])[0]
            self.send_response(400)
            self.send_header("Content-Type", "text/html")
            self.end_headers()
            self.wfile.write(f"<html><body><h2>Error: {error}</h2></body></html>".encode())
        threading.Thread(target=self.server.shutdown, daemon=True).start()

    def do_HEAD(self):
        self.send_response(200)
        self.end_headers()


def main():
    print()
    print("=" * 60)
    print("  Google Sheets Write Authorization")
    print("=" * 60)
    print()
    print("This grants READ + WRITE access to Google Sheets.")
    print("Sign in with the Carisma account that owns the KPI sheet.")
    print()
    print("Opening browser...")

    server = HTTPServer(("localhost", 8080), _Handler)
    webbrowser.open(auth_url)

    print("Waiting for authorization...")
    print("If the browser did not open, visit this URL manually:")
    print()
    print(f"  {auth_url}")
    print()

    server.serve_forever()

    if not _auth_code:
        print("ERROR: No authorization code received.")
        sys.exit(1)

    print("Authorization code received. Exchanging for tokens...")

    token_data = urllib.parse.urlencode({
        "client_id":     CLIENT_ID,
        "client_secret": CLIENT_SECRET,
        "code":          _auth_code[0],
        "grant_type":    "authorization_code",
        "redirect_uri":  REDIRECT_URI,
    }).encode()

    req = urllib.request.Request(
        "https://oauth2.googleapis.com/token",
        data=token_data,
        method="POST",
    )
    try:
        with urllib.request.urlopen(req, timeout=30) as resp:
            tokens = json.loads(resp.read().decode())
    except urllib.error.HTTPError as e:
        print(f"ERROR exchanging code: HTTP {e.code}: {e.read().decode()}")
        sys.exit(1)

    refresh_token = tokens.get("refresh_token")
    access_token  = tokens.get("access_token")

    if not refresh_token:
        print("ERROR: No refresh_token in response. Response was:", tokens)
        sys.exit(1)

    print(f"New write-scope refresh token: {refresh_token[:30]}...")

    # Save to .env — overwrites the existing readonly token
    env_path = str(_env_root)
    set_key(env_path, "GOOGLE_SHEETS_REFRESH_TOKEN", refresh_token)
    set_key(env_path, "GOOGLE_REFRESH_TOKEN",        refresh_token)
    print(f"Saved to {_env_root}")
    print()

    # Quick verification — check access to the KPI sheet
    KPI_SHEET_ID = "1WWM7W6S5wtSC-5hdlcuJgW3zbYaO7YRgg4_-Bju4-5s"
    meta_url = f"https://sheets.googleapis.com/v4/spreadsheets/{KPI_SHEET_ID}?fields=properties.title,sheets.properties.title"
    req2 = urllib.request.Request(meta_url, headers={"Authorization": f"Bearer {access_token}"})
    try:
        with urllib.request.urlopen(req2, timeout=30) as r2:
            meta = json.loads(r2.read().decode())
        title = meta.get("properties", {}).get("title", "unknown")
        tabs  = [s["properties"]["title"] for s in meta.get("sheets", [])]
        print(f"KPI sheet confirmed: '{title}'")
        print(f"  {len(tabs)} tab(s): {', '.join(tabs[:8])}{'...' if len(tabs) > 8 else ''}")
    except Exception as ex:
        print(f"Warning: could not verify KPI sheet access: {ex}")
        print("  (The token is saved — try running the ETL anyway.)")

    print()
    print("Done! Now run:")
    print("  cd '10-Tech/CEO-Cockpit/etl'")
    print("  py etl_zoho_spa_raw_layer.py")


if __name__ == "__main__":
    main()
