"""
Zoho Books OAuth Setup — run ONCE to get your refresh token.

Steps this script handles:
  1. Reads ZOHO_BOOKS_CLIENT_ID + ZOHO_BOOKS_CLIENT_SECRET from .env
  2. Prints the authorization URL — you open it in your browser
  3. You log into Zoho, grant access, and are redirected to localhost
     (the browser will show "This site can't be reached" — that's fine)
  4. You paste the full redirect URL (or just the ?code= value) back here
  5. Script exchanges the code for tokens and writes the refresh token to .env
  6. Also fetches your list of Zoho Books organisations so you can confirm the org IDs

Usage:
    cd carisma-support/Tech/CEO-Cockpit/etl

    # Read-only token (for ETL/reporting — default)
    python zoho_books_auth.py --org spa
    python zoho_books_auth.py --org aesthetics

    # Full-access token (required for tag updates and any write operations)
    python zoho_books_auth.py --org spa --full-access
    python zoho_books_auth.py --org aesthetics --full-access

--org spa       → saves to ZOHO_BOOKS_SPA_REFRESH_TOKEN
--org aesthetics → saves to ZOHO_BOOKS_REFRESH_TOKEN (used by aesthetics ETL)
--full-access   → requests ZohoBooks.fullaccess.all scope (needed for writes)
"""

import argparse
import os
import sys
import webbrowser
import requests
from pathlib import Path
from urllib.parse import urlparse, parse_qs

# ---------------------------------------------------------------------------
# Env setup
# ---------------------------------------------------------------------------
_ENV_PATH = Path(__file__).resolve().parents[3] / ".env"

try:
    from dotenv import load_dotenv, set_key
    load_dotenv(_ENV_PATH)
except ImportError:
    print("Installing python-dotenv...")
    import subprocess
    subprocess.check_call([sys.executable, "-m", "pip", "install", "python-dotenv", "requests"])
    from dotenv import load_dotenv, set_key
    load_dotenv(_ENV_PATH)

_AUTH_BASE    = "https://accounts.zoho.eu/oauth/v2"
_REDIRECT     = "https://localhost"
_SCOPES_READ  = "ZohoBooks.accountants.READ,ZohoBooks.reports.READ,ZohoBooks.settings.READ"
_SCOPES_FULL  = "ZohoBooks.fullaccess.all"

# Back-compat: keep the old name pointing at read scopes
_SCOPES = _SCOPES_READ


def _require_env(key: str) -> str:
    val = os.environ.get(key, "").strip()
    if not val or val == "TO_BE_FILLED":
        val = input(f"  Enter {key}: ").strip()
        set_key(str(_ENV_PATH), key, val)
        os.environ[key] = val
    return val


def main():
    parser = argparse.ArgumentParser(description="Zoho Books OAuth token setup")
    parser.add_argument(
        "--org", choices=["spa", "aesthetics"], default=None,
        help="Which org token to generate (spa → ZOHO_BOOKS_SPA_REFRESH_TOKEN, aesthetics → ZOHO_BOOKS_REFRESH_TOKEN)",
    )
    parser.add_argument(
        "--full-access", action="store_true",
        help="Request ZohoBooks.fullaccess.all scope (required for write operations like tag updates)",
    )
    args = parser.parse_args()

    scopes = _SCOPES_FULL if args.full_access else _SCOPES_READ
    env_key = "ZOHO_BOOKS_SPA_REFRESH_TOKEN" if args.org == "spa" else "ZOHO_BOOKS_REFRESH_TOKEN"

    print("\n=== Zoho Books OAuth Setup ===\n")
    print(f"  Org:    {args.org or 'aesthetics (default)'}")
    print(f"  Scopes: {scopes}")
    print(f"  Saves → {env_key}\n")

    client_id     = _require_env("ZOHO_BOOKS_CLIENT_ID")
    client_secret = _require_env("ZOHO_BOOKS_CLIENT_SECRET")

    auth_url = (
        f"{_AUTH_BASE}/auth"
        f"?scope={scopes}"
        f"&client_id={client_id}"
        f"&response_type=code"
        f"&access_type=offline"
        f"&redirect_uri={_REDIRECT}"
        f"&prompt=consent"
    )

    print("Opening your browser. Log in to Zoho and grant access.")
    print("After granting access, the browser will try to open 'localhost'")
    print("and show an error — that is expected. Just copy the full URL from")
    print("the address bar and paste it below.\n")
    print(f"Auth URL:\n{auth_url}\n")

    try:
        webbrowser.open(auth_url)
    except Exception:
        print("(Could not open browser automatically — please open the URL above manually.)\n")

    raw = input("Paste the full redirect URL (or just the 'code' value): ").strip()

    if raw.startswith("http"):
        parsed = urlparse(raw)
        qs = parse_qs(parsed.query)
        code_list = qs.get("code", [])
        if not code_list:
            print("ERROR: No 'code' parameter found in that URL.")
            sys.exit(1)
        code = code_list[0]
    else:
        code = raw

    print("\nExchanging code for tokens...")

    resp = requests.post(
        f"{_AUTH_BASE}/token",
        params={
            "code":          code,
            "client_id":     client_id,
            "client_secret": client_secret,
            "redirect_uri":  _REDIRECT,
            "grant_type":    "authorization_code",
        },
        timeout=15,
    )

    if resp.status_code != 200:
        print(f"ERROR: Token exchange failed ({resp.status_code}):\n{resp.text}")
        sys.exit(1)

    data = resp.json()
    if "refresh_token" not in data:
        print(f"ERROR: No refresh_token in response:\n{data}")
        sys.exit(1)

    refresh_token = data["refresh_token"]
    access_token  = data["access_token"]

    set_key(str(_ENV_PATH), env_key, refresh_token)
    os.environ[env_key] = refresh_token
    print(f"{env_key} saved to .env ✓")

    # Fetch organisations to confirm org IDs (only on first-time setup)
    if not args.org:
        print("\nFetching your Zoho Books organisations...\n")
        orgs_resp = requests.get(
            "https://www.zohoapis.eu/books/v3/organizations",
            headers={"Authorization": f"Zoho-oauthtoken {access_token}"},
            timeout=15,
        )

        if orgs_resp.status_code == 200:
            orgs = orgs_resp.json().get("organizations", [])
            print(f"{'Organisation Name':<35} {'Org ID':<20} {'Currency'}")
            print("-" * 65)
            for o in orgs:
                print(f"{o.get('name',''):<35} {o.get('organization_id',''):<20} {o.get('currency_code','')}")
            print()

            spa_id   = input("SPA org ID (Carisma Spa): ").strip()
            aesth_id = input("Aesthetics/Slimming org ID (Carisma Aesthetics): ").strip()
            if spa_id:
                set_key(str(_ENV_PATH), "ZOHO_BOOKS_SPA_ORG_ID", spa_id)
                print("  ZOHO_BOOKS_SPA_ORG_ID saved ✓")
            if aesth_id:
                set_key(str(_ENV_PATH), "ZOHO_BOOKS_AESTH_ORG_ID", aesth_id)
                print("  ZOHO_BOOKS_AESTH_ORG_ID saved ✓")
        else:
            print(f"Could not fetch organisations ({orgs_resp.status_code}). Org IDs already set in .env.")

    print("\n=== Setup complete. ===\n")


if __name__ == "__main__":
    main()
