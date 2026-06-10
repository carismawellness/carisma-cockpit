"""
Talexio Token Refresh — Playwright-based session token capture.

Flow:
  1. Opens Talexio in headless Chromium (reCAPTCHA auto-passes)
  2. Checks "Remember me" to get a 7-day token
  3. Logs in with TALEXIO_EMAIL + TALEXIO_PASSWORD
  4. Captures the JWT from the loginUser GraphQL response
  5. Stores it in:
       • CEO-Cockpit/.env.local        (TALEXIO_TOKEN=)
       • ~/.claude/mcp-servers/talexio-mcp/.env  (TALEXIO_TOKEN=)
       • Supabase integration_tokens table (via API, if table exists)

Usage:
    python3 Tools/refresh_talexio_token.py

Requirements:
    pip install playwright python-dotenv httpx
    playwright install chromium
"""

import asyncio
import json
import sys
from datetime import datetime, timezone
from pathlib import Path

from dotenv import dotenv_values, set_key

try:
    from playwright.async_api import async_playwright, Response
except ImportError:
    print("playwright not installed. Run: pip install playwright && playwright install chromium")
    sys.exit(1)

# ── Paths ─────────────────────────────────────────────────────────────────────
ROOT        = Path(__file__).parent.parent
ENV_COCKPIT = ROOT / ".env.local"
ENV_MCP     = Path.home() / ".claude" / "mcp-servers" / "talexio-mcp" / ".env"

TALEXIO_URL = "https://carismaspawellness.talexiohr.com"
GRAPHQL_URL = "https://api.talexiohr.com/graphql"

env      = dotenv_values(ENV_COCKPIT)
EMAIL    = env.get("TALEXIO_EMAIL", "")
PASSWORD = env.get("TALEXIO_PASSWORD", "")

if not EMAIL or not PASSWORD:
    print("Set TALEXIO_EMAIL and TALEXIO_PASSWORD in .env.local first.")
    sys.exit(1)


def parse_expiry(token: str) -> str:
    import base64
    try:
        payload_b64 = token.split(".")[1]
        padding     = 4 - len(payload_b64) % 4
        payload     = json.loads(base64.b64decode(payload_b64 + "=" * padding).decode())
        return payload.get("expiryDate", payload.get("expireDate", payload.get("exp", "unknown")))
    except Exception:
        return "unknown"


def expiry_days(token: str) -> float:
    """Return days remaining on the token, or 0 if expired/unknown."""
    import base64
    try:
        payload_b64 = token.split(".")[1]
        padding     = 4 - len(payload_b64) % 4
        payload     = json.loads(base64.b64decode(payload_b64 + "=" * padding).decode())
        exp_str = payload.get("expiryDate") or payload.get("expireDate")
        if exp_str:
            exp_dt = datetime.fromisoformat(exp_str.replace("Z", "+00:00"))
            delta  = exp_dt - datetime.now(timezone.utc)
            return delta.total_seconds() / 86400
        exp_unix = payload.get("exp", 0)
        if exp_unix:
            return (exp_unix - datetime.now(timezone.utc).timestamp()) / 86400
    except Exception:
        pass
    return 0


def write_token_to_envs(token: str):
    for env_path in [ENV_COCKPIT, ENV_MCP]:
        if not env_path.exists():
            print(f"  (skipping {env_path} — file not found)")
            continue
        set_key(str(env_path), "TALEXIO_TOKEN", token)
        print(f"  ✓ Updated {env_path}")


async def push_to_supabase(token: str, expiry_str: str):
    try:
        import httpx
        supabase_url = env.get("NEXT_PUBLIC_SUPABASE_URL", "")
        service_key  = env.get("SUPABASE_SERVICE_ROLE_KEY", "")
        if not supabase_url or not service_key:
            print("  (skipping Supabase — env vars not set)")
            return

        try:
            expires_at = datetime.fromisoformat(expiry_str.replace("Z", "+00:00")).isoformat()
        except Exception:
            expires_at = None

        r = httpx.post(
            f"{supabase_url}/rest/v1/integration_tokens",
            headers={
                "apikey":        service_key,
                "Authorization": f"Bearer {service_key}",
                "Content-Type":  "application/json",
                "Prefer":        "resolution=merge-duplicates",
            },
            json={
                "platform":   "talexio",
                "brand_id":   None,
                "token":      token,
                "expires_at": expires_at,
                "updated_at": datetime.now(timezone.utc).isoformat(),
            },
            timeout=10,
        )
        if r.status_code in (200, 201):
            print("  ✓ Stored in Supabase integration_tokens")
        elif "not found" in r.text.lower():
            print("  ⚠ Supabase integration_tokens table missing — apply migration 025 to enable cross-instance caching")
        else:
            print(f"  ⚠ Supabase upsert returned {r.status_code}: {r.text[:200]}")
    except Exception as e:
        print(f"  ⚠ Supabase push failed: {e}")


async def get_token_via_playwright() -> str:
    """
    Logs in to Talexio with Remember Me and captures the session JWT.
    reCAPTCHA auto-validates in headless Chromium — no manual intervention needed.
    """
    captured: dict = {}

    async with async_playwright() as pw:
        browser = await pw.chromium.launch(headless=True)
        ctx     = await browser.new_context()
        page    = await ctx.new_page()

        # ── Intercept loginUser GraphQL response ───────────────────────────────
        async def on_response(response: Response):
            if GRAPHQL_URL not in response.url:
                return
            try:
                body = await response.json()
                items = body if isinstance(body, list) else [body]
                for item in items:
                    login_data = (item.get("data") or {}).get("loginUser")
                    if login_data and login_data.get("token"):
                        token = login_data["token"]
                        days  = expiry_days(token)
                        print(f"  Token captured — expires in {days:.1f} days")
                        if days > captured.get("best_days", 0):
                            captured["token"]     = token
                            captured["best_days"] = days
            except Exception:
                pass

        page.on("response", on_response)

        # ── Login with Remember Me ──────────────────────────────────────────────
        print(f"  Opening {TALEXIO_URL}/login …")
        await page.goto(f"{TALEXIO_URL}/login", wait_until="domcontentloaded")
        await page.wait_for_selector('input[placeholder="Your email address"]', timeout=15_000)

        await page.fill('input[placeholder="Your email address"]', EMAIL)
        await page.fill('input[placeholder="Your password"]',       PASSWORD)

        # Check "Remember me" for a 7-day token
        try:
            remember_me = page.locator('input[type="checkbox"]').first
            is_checked  = await remember_me.is_checked()
            if not is_checked:
                await remember_me.click()
                print("  ✓ Remember me checked")
        except Exception as e:
            print(f"  (could not check Remember me: {e})")

        await page.click('button:has-text("Login")')

        # Wait for redirect to dashboard (proves login succeeded)
        await page.wait_for_url("**/dashboard**", timeout=30_000)
        print("  ✓ Logged in to dashboard")

        # Give interceptor a moment to process the response
        await page.wait_for_timeout(500)
        await browser.close()

    if not captured.get("token"):
        raise RuntimeError("Could not capture Talexio login token from network")

    return captured["token"]


async def main():
    print("=" * 60)
    print("  Talexio Token Refresh")
    print("=" * 60)

    print("\nStep 1: Logging in to capture session token …")
    token = await get_token_via_playwright()

    expiry  = parse_expiry(token)
    days    = expiry_days(token)
    print(f"\nToken expiry: {expiry} ({days:.1f} days remaining)")

    if days < 1:
        print("⚠ WARNING: Token expires in less than 1 day — refresh may have failed")

    print("\nStep 2: Storing token …")
    write_token_to_envs(token)
    await push_to_supabase(token, expiry)

    print(f"\n✓ Done. Token valid for {days:.1f} days (until {expiry})")
    print("  Add TALEXIO_TOKEN to Vercel env vars and redeploy to apply in production.")
    print(f"\n  Token (first 60 chars): {token[:60]}…")


if __name__ == "__main__":
    asyncio.run(main())
