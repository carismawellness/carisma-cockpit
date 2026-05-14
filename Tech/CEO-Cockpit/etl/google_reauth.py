"""
Google OAuth Re-Authorization Script
Generates a new refresh token for Google Sheets API access.

Run: python google_reauth.py
Then open the printed URL in your browser, grant access,
and the script will automatically capture the code and update .env
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

# Load existing env
_etl_dir = Path(__file__).resolve().parent
_env_local = _etl_dir.parents[1] / ".env.local"
_env_root  = _etl_dir.parents[2] / ".env"
load_dotenv(_env_local)
load_dotenv(_env_root)

CLIENT_ID     = os.environ.get("GOOGLE_SHEETS_CLIENT_ID") or os.environ.get("GOOGLE_CLIENT_ID")
CLIENT_SECRET = os.environ.get("GOOGLE_SHEETS_CLIENT_SECRET") or os.environ.get("GOOGLE_CLIENT_SECRET")
REDIRECT_URI  = "http://localhost:8080"
SCOPE         = "https://www.googleapis.com/auth/spreadsheets.readonly"
ENV_FILE      = _env_root  # write new token back to carisma-support/.env

if not CLIENT_ID or not CLIENT_SECRET:
    print("ERROR: GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET not found in .env")
    sys.exit(1)

# Build auth URL
auth_url = (
    "https://accounts.google.com/o/oauth2/v2/auth?"
    + urllib.parse.urlencode({
        "client_id":     CLIENT_ID,
        "redirect_uri":  REDIRECT_URI,
        "response_type": "code",
        "scope":         SCOPE,
        "access_type":   "offline",
        "prompt":        "consent",   # force consent to always get refresh_token
    })
)

_auth_code: list[str] = []

class _Handler(BaseHTTPRequestHandler):
    def log_message(self, *_): pass  # suppress request logs

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
        # shut down server after handling first request
        threading.Thread(target=self.server.shutdown, daemon=True).start()

    def do_HEAD(self):
        self.send_response(200)
        self.end_headers()


def main():
    print()
    print("=" * 60)
    print("  Google Sheets Re-Authorization")
    print("=" * 60)
    print()
    print("Opening your browser to the Google sign-in page...")
    print("Sign in with the Carisma Gmail account that has access")
    print("to the Aesthetics Google Sheet.")
    print()

    server = HTTPServer(("localhost", 8080), _Handler)

    webbrowser.open(auth_url)

    print("Waiting for authorization (browser should open automatically)...")
    print("If the browser did not open, visit this URL manually:")
    print()
    print(f"  {auth_url}")
    print()

    server.serve_forever()  # blocks until handler shuts it down

    if not _auth_code:
        print("ERROR: No authorization code received.")
        sys.exit(1)

    code = _auth_code[0]
    print(f"Authorization code received. Exchanging for tokens...")

    # Exchange code for tokens
    token_data = urllib.parse.urlencode({
        "client_id":     CLIENT_ID,
        "client_secret": CLIENT_SECRET,
        "code":          code,
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

    access_token  = tokens.get("access_token")
    refresh_token = tokens.get("refresh_token")

    if not refresh_token:
        print("ERROR: No refresh_token in response. Response was:", tokens)
        sys.exit(1)

    print()
    print(f"New refresh token: {refresh_token[:30]}...")
    print()

    # Update .env file
    env_path = str(ENV_FILE)
    set_key(env_path, "GOOGLE_SHEETS_REFRESH_TOKEN", refresh_token)
    set_key(env_path, "GOOGLE_REFRESH_TOKEN",        refresh_token)
    print(f"Saved to {ENV_FILE}")
    print()

    # Quick verification — list the aesthetics sheet tabs
    SHEET_ID = "1Mr_aRRbRf3ex--WmUJIqXwko7okCyD82KxBOXWYnW24"
    meta_url = f"https://sheets.googleapis.com/v4/spreadsheets/{SHEET_ID}?fields=sheets.properties.title"
    req2 = urllib.request.Request(meta_url, headers={"Authorization": f"Bearer {access_token}"})
    try:
        with urllib.request.urlopen(req2, timeout=30) as r2:
            meta = json.loads(r2.read().decode())
        tabs = [s["properties"]["title"] for s in meta.get("sheets", [])]
        print(f"Sheet access confirmed — {len(tabs)} tab(s) found:")
        for t in tabs[:10]:
            print(f"  • {t}")
        if len(tabs) > 10:
            print(f"  ... and {len(tabs) - 10} more")
    except Exception as ex:
        print(f"Warning: could not verify sheet access: {ex}")

    print()
    print("Done! You can now re-run the Aesthetics ETL.")


if __name__ == "__main__":
    main()
