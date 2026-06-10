"""
Talexio Token Refresh — Playwright-based Third Party Token generation.

Flow:
  1. Opens Talexio in Chromium (reCAPTCHA auto-passes)
  2. Logs in with TALEXIO_EMAIL + TALEXIO_PASSWORD
  3. Navigates to Dashboard → Third Party Tokens tab
  4. Generates a new "CEO Cockpit" API token
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
    from playwright.async_api import async_playwright
except ImportError:
    print("playwright not installed. Run: pip install playwright && playwright install chromium")
    sys.exit(1)

# ── Paths ─────────────────────────────────────────────────────────────────────
ROOT        = Path(__file__).parent.parent
ENV_COCKPIT = ROOT / ".env.local"
ENV_MCP     = Path.home() / ".claude" / "mcp-servers" / "talexio-mcp" / ".env"

TALEXIO_URL = "https://carismaspawellness.talexiohr.com"

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
            expires_at = datetime.fromisoformat(
                expiry_str.replace("Z", "+00:00")
            ).isoformat()
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
            print("  ⚠ Supabase integration_tokens table missing — apply migration 025 first")
        else:
            print(f"  ⚠ Supabase upsert returned {r.status_code}: {r.text[:200]}")
    except Exception as e:
        print(f"  ⚠ Supabase push failed: {e}")


async def get_token_via_playwright() -> str:
    """
    Logs in to Talexio and generates a new Third Party API Token.
    reCAPTCHA auto-validates headless Chromium.
    """
    async with async_playwright() as pw:
        browser = await pw.chromium.launch(headless=True)
        ctx     = await browser.new_context()
        page    = await ctx.new_page()

        # ── Step 1: Login ──────────────────────────────────────────────────────
        print(f"  Opening {TALEXIO_URL}/login …")
        await page.goto(f"{TALEXIO_URL}/login", wait_until="domcontentloaded")

        # Wait for the email input to appear
        await page.wait_for_selector('input[placeholder="Your email address"]', timeout=15_000)

        await page.fill('input[placeholder="Your email address"]', EMAIL)
        await page.fill('input[placeholder="Your password"]',       PASSWORD)
        await page.click('button:has-text("Login")')

        # Wait for redirect to dashboard
        await page.wait_for_url(f"**/dashboard**", timeout=30_000)
        print("  ✓ Logged in to dashboard")

        # ── Step 2: Navigate to Third Party Tokens tab ─────────────────────────
        await page.goto(f"{TALEXIO_URL}/dashboard#third-party-tokens", wait_until="domcontentloaded")

        # Wait for the tab to render
        tab = await page.wait_for_selector('role=tab[name="Third Party Tokens"]', timeout=15_000)
        await tab.click()
        await page.wait_for_timeout(1500)
        print("  ✓ On Third Party Tokens tab")

        # ── Step 3: Click the create button ────────────────────────────────────
        # Find the "+" button in the Third Party Tokens heading row
        # It's a button with only an img child, next to "Connect your Google Calendar"
        create_btn = await page.wait_for_selector(
            'xpath=//h6[contains(text(),"Third Party Tokens")]/following-sibling::*//button[last()]',
            timeout=10_000,
        )
        await create_btn.click()

        # Wait for dialog input to appear (use page-level selector)
        await page.wait_for_selector('role=dialog', timeout=8_000)
        print("  ✓ Generate Token dialog opened")

        # ── Step 4: Enter name and click Generate ─────────────────────────────
        name_input = await page.wait_for_selector(
            'input[placeholder="Enter token name"]', timeout=10_000
        )
        await name_input.fill("CEO Cockpit")
        await page.wait_for_timeout(300)

        generate_btn = await page.wait_for_selector(
            'role=dialog >> button:has-text("Generate")', timeout=5_000
        )
        await generate_btn.click()

        # ── Step 5: Read the generated token ──────────────────────────────────
        # After generation the dialog shows a disabled input with the JWT
        await page.wait_for_timeout(1500)
        token_input = await page.wait_for_selector(
            'role=dialog >> input[disabled]', timeout=10_000
        )
        token = await token_input.input_value()

        if not token or not token.startswith("eyJ"):
            raise RuntimeError(f"Generated token looks invalid: {token[:50]}")

        print("  ✓ Third Party Token generated")
        await browser.close()
        return token


async def main():
    print("=" * 60)
    print("  Talexio Token Refresh")
    print("=" * 60)

    print("\nStep 1: Generating Talexio Third Party Token …")
    token = await get_token_via_playwright()

    expiry = parse_expiry(token)
    print(f"\nToken expiry: {expiry}")

    print("\nStep 2: Storing token …")
    write_token_to_envs(token)
    await push_to_supabase(token, expiry)

    print(f"\n✓ Done. Token valid until {expiry}")
    print("  Add TALEXIO_TOKEN to Vercel env vars and redeploy to apply in production.")
    print(f"\n  Token (first 60 chars): {token[:60]}…")


if __name__ == "__main__":
    asyncio.run(main())
