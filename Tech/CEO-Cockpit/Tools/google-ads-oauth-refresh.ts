/**
 * Refreshes the Google Ads OAuth refresh token.
 * Starts a local capture server, opens the consent screen, and exchanges the code.
 * Run: npx tsx --env-file .env.production.local Tools/google-ads-oauth-refresh.ts
 */

import * as http from "http";
import * as url from "url";

// Strip \n from Vercel env vars
for (const key of Object.keys(process.env)) {
  const v = process.env[key];
  if (typeof v === "string") process.env[key] = v.replace(/\\n$/g, "").trim();
}

const CLIENT_ID     = process.env.GOOGLE_ADS_CLIENT_ID!;
const CLIENT_SECRET = process.env.GOOGLE_ADS_CLIENT_SECRET!;
const PORT          = 8765;
const REDIRECT_URI  = `http://localhost:${PORT}`;

async function exchangeCode(code: string): Promise<{ access_token: string; refresh_token: string }> {
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method:  "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body:    new URLSearchParams({
      code,
      client_id:     CLIENT_ID,
      client_secret: CLIENT_SECRET,
      redirect_uri:  REDIRECT_URI,
      grant_type:    "authorization_code",
    }),
  });
  const json = await res.json() as { access_token?: string; refresh_token?: string; error?: string; error_description?: string };
  if (json.error) throw new Error(`Token exchange: ${json.error} — ${json.error_description}`);
  return { access_token: json.access_token!, refresh_token: json.refresh_token! };
}

async function updateVercelEnv(key: string, value: string): Promise<void> {
  // Update .env.production.local
  const fs = await import("fs");
  const path = await import("path");
  const envPath = path.join(process.cwd(), ".env.production.local");
  let content = fs.readFileSync(envPath, "utf-8");
  const regex = new RegExp(`^${key}=.*$`, "m");
  const newLine = `${key}="${value}"`;
  if (regex.test(content)) {
    content = content.replace(regex, newLine);
  } else {
    content += `\n${newLine}`;
  }
  fs.writeFileSync(envPath, content);
  console.log(`✓ Updated ${key} in .env.production.local`);
}

async function main() {
  if (!CLIENT_ID || !CLIENT_SECRET) {
    throw new Error("GOOGLE_ADS_CLIENT_ID or GOOGLE_ADS_CLIENT_SECRET not set");
  }

  const authUrl = "https://accounts.google.com/o/oauth2/v2/auth?" + new URLSearchParams({
    client_id:    CLIENT_ID,
    redirect_uri: REDIRECT_URI,
    scope:        "https://www.googleapis.com/auth/adwords",
    response_type:"code",
    access_type:  "offline",
    prompt:       "consent",
  }).toString();

  console.log("Starting local OAuth capture server on port", PORT);
  console.log("\nOpening Google consent screen...\n");
  console.log("If the browser doesn't open automatically, visit:");
  console.log(authUrl);
  console.log("");

  // Open browser
  const { exec } = await import("child_process");
  exec(`open "${authUrl}"`);

  // Wait for redirect
  const code = await new Promise<string>((resolve, reject) => {
    const server = http.createServer((req, res) => {
      const parsed = url.parse(req.url!, true);
      const code   = parsed.query["code"] as string;
      const error  = parsed.query["error"] as string;

      res.writeHead(200, { "Content-Type": "text/html" });
      if (code) {
        res.end("<h1>Authorization successful!</h1><p>You can close this tab.</p>");
        server.close();
        resolve(code);
      } else {
        res.end(`<h1>Error: ${error}</h1>`);
        server.close();
        reject(new Error(`OAuth error: ${error}`));
      }
    });
    server.listen(PORT, () => {
      console.log(`Waiting for Google to redirect to http://localhost:${PORT}...`);
    });
    setTimeout(() => { server.close(); reject(new Error("Timeout after 120s")); }, 120_000);
  });

  console.log("\n✓ Got authorization code");

  const tokens = await exchangeCode(code);
  console.log("✓ Exchanged for tokens");
  console.log("  access_token (first 20):", tokens.access_token.slice(0, 20) + "...");
  console.log("  refresh_token:", tokens.refresh_token);

  await updateVercelEnv("GOOGLE_ADS_REFRESH_TOKEN", tokens.refresh_token);

  console.log("\n✓ Refresh token saved to .env.production.local");
  console.log("\nNext step: update Vercel with:");
  console.log(`  npx vercel env rm GOOGLE_ADS_REFRESH_TOKEN production`);
  console.log(`  npx vercel env add GOOGLE_ADS_REFRESH_TOKEN production`);
  console.log(`  (paste the token: ${tokens.refresh_token})`);
}

main().catch(e => { console.error("✗", e.message); process.exit(1); });
