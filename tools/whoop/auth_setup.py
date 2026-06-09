"""
WHOOP OAuth 2.0 setup — runs a localhost server to catch the redirect.

One-time: opens browser to WHOOP authorization URL, catches the redirect on
http://localhost:8080/callback, exchanges the code for access + refresh tokens,
and saves them to .tmp/whoop_tokens.json.

Prerequisite: WHOOP_CLIENT_ID and WHOOP_CLIENT_SECRET must be set in .env.
The dev app at developer.whoop.com must whitelist redirect URI:
    http://localhost:8080/callback

Usage:
    python Tools/whoop/auth_setup.py
"""

import json
import os
import secrets
import sys
import time
import urllib.parse
import webbrowser
from http.server import BaseHTTPRequestHandler, HTTPServer
from pathlib import Path

PROJECT_ROOT = Path(__file__).parent.parent.parent
sys.path.insert(0, str(PROJECT_ROOT))

from dotenv import load_dotenv

load_dotenv(PROJECT_ROOT / ".env")

import httpx

AUTH_URL = "https://api.prod.whoop.com/oauth/oauth2/auth"
TOKEN_URL = "https://api.prod.whoop.com/oauth/oauth2/token"
REDIRECT_URI = "http://localhost:8080/callback"
SCOPES = (
    "read:recovery read:cycles read:sleep read:workout "
    "read:profile read:body_measurement offline"
)
TOKEN_FILE = PROJECT_ROOT / ".tmp" / "whoop_tokens.json"


class CallbackHandler(BaseHTTPRequestHandler):
    auth_code: str | None = None
    state_received: str | None = None
    error: str | None = None

    def do_GET(self):  # noqa: N802
        parsed = urllib.parse.urlparse(self.path)
        if parsed.path != "/callback":
            self.send_response(404)
            self.end_headers()
            return
        qs = urllib.parse.parse_qs(parsed.query)
        CallbackHandler.auth_code = qs.get("code", [None])[0]
        CallbackHandler.state_received = qs.get("state", [None])[0]
        CallbackHandler.error = qs.get("error", [None])[0]
        self.send_response(200)
        self.send_header("Content-Type", "text/html; charset=utf-8")
        self.end_headers()
        if CallbackHandler.error:
            self.wfile.write(
                f"<h1>WHOOP error: {CallbackHandler.error}</h1>".encode()
            )
        else:
            self.wfile.write(
                b"<h1>WHOOP authorized.</h1><p>You can close this tab.</p>"
            )

    def log_message(self, format, *args):  # silence default logging
        pass


def main() -> int:
    client_id = os.getenv("WHOOP_CLIENT_ID", "")
    client_secret = os.getenv("WHOOP_CLIENT_SECRET", "")
    if not client_id or not client_secret:
        print("ERROR: WHOOP_CLIENT_ID / WHOOP_CLIENT_SECRET not set in .env", file=sys.stderr)
        return 1

    state = secrets.token_urlsafe(16)
    auth_link = f"{AUTH_URL}?" + urllib.parse.urlencode({
        "client_id": client_id,
        "redirect_uri": REDIRECT_URI,
        "response_type": "code",
        "scope": SCOPES,
        "state": state,
    })

    print("Opening WHOOP authorization in your browser...")
    print(f"If it doesn't open automatically, visit:\n  {auth_link}\n")
    webbrowser.open(auth_link)

    server = HTTPServer(("localhost", 8080), CallbackHandler)
    print("Waiting for redirect on http://localhost:8080/callback ...")
    while CallbackHandler.auth_code is None and CallbackHandler.error is None:
        server.handle_request()

    if CallbackHandler.error:
        print(f"ERROR from WHOOP: {CallbackHandler.error}", file=sys.stderr)
        return 1

    if CallbackHandler.state_received != state:
        print("ERROR: state mismatch — possible CSRF attempt.", file=sys.stderr)
        return 1

    print("Got authorization code. Exchanging for tokens...")
    r = httpx.post(
        TOKEN_URL,
        data={
            "grant_type": "authorization_code",
            "code": CallbackHandler.auth_code,
            "redirect_uri": REDIRECT_URI,
            "client_id": client_id,
            "client_secret": client_secret,
        },
        timeout=30,
    )
    if r.status_code != 200:
        print(f"ERROR exchanging code: {r.status_code} {r.text}", file=sys.stderr)
        return 1
    data = r.json()

    tokens = {
        "access_token": data["access_token"],
        "refresh_token": data["refresh_token"],
        "expires_at": time.time() + data["expires_in"],
        "scope": data.get("scope", SCOPES),
    }
    TOKEN_FILE.parent.mkdir(parents=True, exist_ok=True)
    TOKEN_FILE.write_text(json.dumps(tokens, indent=2))
    print(f"Tokens saved to {TOKEN_FILE}")
    print("Setup complete. Try: python Tools/whoop/pull.py --days 90")
    return 0


if __name__ == "__main__":
    sys.exit(main())
