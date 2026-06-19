"""
Restore Aesthetics Zoho Books refresh token.

USAGE:
  1. Open this URL in browser, login as mert@carismaaesthetics.com:
     https://accounts.zoho.eu/oauth/v2/auth?scope=ZohoBooks.accountants.READ%2CZohoBooks.reports.READ%2CZohoBooks.settings.READ&client_id=1000.T2JSUQRVK983MOFY28ZYQV2H39W3IK&response_type=code&access_type=offline&redirect_uri=https%3A%2F%2Flocalhost&prompt=consent&state=aesthetics

  2. You'll be redirected to https://localhost?code=XXXX... (browser shows error, that's fine)

  3. Copy the full URL or just the code= value, then run:
     python etl/restore_aesthetics_token.py --code "1000.XXXXXX"
"""

import argparse
import subprocess
import sys
from urllib.parse import urlencode

CLIENT_ID     = "1000.T2JSUQRVK983MOFY28ZYQV2H39W3IK"
CLIENT_SECRET = "4ac883e8ab414618b941de8622ca6550eef511b7a5"
REDIRECT_URI  = "https://localhost"
AUTH_BASE     = "https://accounts.zoho.eu/oauth/v2"

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--code", required=True, help="The code= value from the redirect URL")
    args = parser.parse_args()

    code = args.code.strip()
    if "code=" in code:
        import re
        m = re.search(r"code=([^&]+)", code)
        if m:
            code = m.group(1)

    print(f"Exchanging code: {code[:20]}...")

    import urllib.request, json
    params = urlencode({
        "grant_type":    "authorization_code",
        "client_id":     CLIENT_ID,
        "client_secret": CLIENT_SECRET,
        "redirect_uri":  REDIRECT_URI,
        "code":          code,
    })
    url = f"{AUTH_BASE}/token?{params}"
    req = urllib.request.Request(url, method="POST")
    with urllib.request.urlopen(req) as r:
        data = json.loads(r.read())

    if "refresh_token" not in data:
        print("ERROR: No refresh_token in response:")
        print(json.dumps(data, indent=2))
        sys.exit(1)

    refresh_token = data["refresh_token"]
    print(f"\nSuccess! Refresh token: {refresh_token}")
    print("\nNow run these commands to update Vercel:")
    print(f'  printf "%s" "{refresh_token}" | vercel env add ZOHO_BOOKS_REFRESH_TOKEN production --yes')
    print("\nThen verify Aesthetics ETL:")
    print('  curl -s -X POST "https://cockpit.carismaspa.com/api/etl/zoho-aesthetics-transactions" \\')
    print('    -H "Content-Type: application/json" \\')
    print('    -d \'{"date_from": "2026-06-18", "date_to": "2026-06-18"}\' | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get(\'status\'), d.get(\'rows\', d.get(\'error\', \'?\')))\"')

if __name__ == "__main__":
    main()
