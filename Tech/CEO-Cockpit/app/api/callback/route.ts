import { NextRequest, NextResponse } from "next/server";
import * as fs from "fs";
import * as path from "path";

const AUTH_BASE    = "https://accounts.zoho.eu/oauth/v2";
const API_BASE     = "https://www.zohoapis.eu/books/v3";
const REDIRECT_URI = "http://localhost:3000/api/callback";

// Paths to both env files
const ENV_ROOT  = path.resolve(process.cwd(), "../../.env");
const ENV_LOCAL = path.resolve(process.cwd(), ".env.local");

function updateEnvFile(filePath: string, updates: Record<string, string>) {
  if (!fs.existsSync(filePath)) return;
  let content = fs.readFileSync(filePath, "utf-8");
  for (const [key, value] of Object.entries(updates)) {
    const regex = new RegExp(`^${key}=.*$`, "m");
    if (regex.test(content)) {
      content = content.replace(regex, `${key}=${value}`);
    } else {
      content += `\n${key}=${value}`;
    }
  }
  fs.writeFileSync(filePath, content, "utf-8");
}

export async function GET(req: NextRequest) {
  const code    = req.nextUrl.searchParams.get("code");
  const error   = req.nextUrl.searchParams.get("error");
  // state=spa → saving SPA credentials; state=aesthetics → saving Aesthetics credentials
  const orgType = (req.nextUrl.searchParams.get("state") ?? "aesthetics") as "spa" | "aesthetics";

  if (error) {
    return new NextResponse(errorPage(error, req.nextUrl.searchParams.get("error_description") ?? ""), {
      headers: { "Content-Type": "text/html" },
    });
  }
  if (!code) {
    return new NextResponse(errorPage("missing_code", "No authorization code in the redirect URL."), {
      headers: { "Content-Type": "text/html" },
    });
  }

  const clientId     = process.env.ZOHO_BOOKS_CLIENT_ID!;
  const clientSecret = process.env.ZOHO_BOOKS_CLIENT_SECRET!;

  // Exchange code for tokens
  const tokenRes = await fetch(
    `${AUTH_BASE}/token?grant_type=authorization_code` +
    `&client_id=${clientId}&client_secret=${clientSecret}` +
    `&redirect_uri=${encodeURIComponent(REDIRECT_URI)}&code=${code}`,
    { method: "POST" }
  );
  const tokenData = await tokenRes.json();

  if (!tokenData.refresh_token) {
    return new NextResponse(
      errorPage("token_exchange_failed", JSON.stringify(tokenData)),
      { headers: { "Content-Type": "text/html" } }
    );
  }

  const refreshToken = tokenData.refresh_token as string;
  const accessToken  = tokenData.access_token  as string;

  // Fetch organisations visible under this Zoho account
  const orgsRes = await fetch(`${API_BASE}/organizations`, {
    headers: { Authorization: `Zoho-oauthtoken ${accessToken}` },
  });
  const orgsData = await orgsRes.json();
  const orgs: Array<{ organization_id: string; name: string; currency_code: string }> =
    orgsData.organizations ?? [];

  // Pick the first org as the "primary" for this account
  const primaryOrg = orgs[0];

  // Save the right env vars depending on which account this is for
  const updates: Record<string, string> =
    orgType === "spa"
      ? {
          ZOHO_BOOKS_SPA_REFRESH_TOKEN: refreshToken,
          ZOHO_BOOKS_SPA_ORG_ID:        primaryOrg?.organization_id ?? "TO_BE_FILLED",
        }
      : {
          ZOHO_BOOKS_REFRESH_TOKEN:  refreshToken,
          ZOHO_BOOKS_AESTH_ORG_ID:   primaryOrg?.organization_id ?? "TO_BE_FILLED",
        };

  updateEnvFile(ENV_ROOT,  updates);
  updateEnvFile(ENV_LOCAL, updates);

  return new NextResponse(successPage(orgType, orgs, primaryOrg, refreshToken), {
    headers: { "Content-Type": "text/html" },
  });
}

function successPage(
  orgType: "spa" | "aesthetics",
  orgs: Array<{ organization_id: string; name: string; currency_code: string }>,
  primaryOrg: { organization_id: string; name: string } | undefined,
  refreshToken: string,
) {
  const orgRows = orgs.map(o =>
    `<tr><td>${o.name}</td><td style="font-family:monospace">${o.organization_id}</td><td>${o.currency_code}</td></tr>`
  ).join("");

  const envKey = orgType === "spa" ? "ZOHO_BOOKS_SPA_REFRESH_TOKEN" : "ZOHO_BOOKS_REFRESH_TOKEN";
  const orgKey = orgType === "spa" ? "ZOHO_BOOKS_SPA_ORG_ID" : "ZOHO_BOOKS_AESTH_ORG_ID";
  const label  = orgType === "spa" ? "SPA" : "Aesthetics";

  const otherOrgType = orgType === "spa" ? "aesthetics" : "spa";
  const otherLabel   = orgType === "spa" ? "Aesthetics" : "SPA";
  const otherAuthUrl =
    `https://accounts.zoho.eu/oauth/v2/auth?scope=ZohoBooks.accountants.READ,ZohoBooks.reports.READ,ZohoBooks.settings.READ` +
    `&client_id=${process.env.ZOHO_BOOKS_CLIENT_ID}&response_type=code&access_type=offline` +
    `&redirect_uri=http://localhost:3000/api/callback&prompt=consent&state=${otherOrgType}`;

  return `<!DOCTYPE html>
<html><head><meta charset="utf-8">
<title>Zoho Books ${label} Connected ✓</title>
<style>
  body{font-family:system-ui,sans-serif;max-width:700px;margin:60px auto;padding:0 20px;color:#333}
  h1{color:#2a6e3f}
  .badge{display:inline-block;padding:4px 10px;border-radius:20px;font-size:13px;font-weight:600}
  .green{background:#d1fae5;color:#065f46}
  .amber{background:#fef3c7;color:#92400e}
  table{width:100%;border-collapse:collapse;margin:16px 0}
  th,td{text-align:left;padding:8px 12px;border-bottom:1px solid #e5e7eb;font-size:14px}
  th{background:#f9fafb;font-weight:600}
  .token{font-family:monospace;font-size:12px;background:#f3f4f6;padding:8px 12px;border-radius:6px;word-break:break-all;margin-bottom:8px}
  .next{background:#1a1a2e;color:white;padding:20px 24px;border-radius:10px;margin-top:24px}
  .next h3{margin:0 0 12px;color:#c9a84c}
  .next ol{margin:0;padding-left:20px;line-height:1.8}
  .btn{display:inline-block;padding:10px 20px;background:#c9a84c;color:white;border-radius:8px;text-decoration:none;font-weight:600;margin-top:12px}
  a{color:#2563eb}
</style>
</head>
<body>
<h1>Zoho Books ${label} Connected ✓</h1>
<p><strong>${envKey}</strong> and <strong>${orgKey}</strong> have been saved to <code>.env</code> and <code>.env.local</code>.</p>

<h3>Organisations on this account</h3>
<table><thead><tr><th>Name</th><th>Org ID</th><th>Currency</th></tr></thead>
<tbody>${orgRows}</tbody></table>

<p>Saved as <strong>${label}</strong> org: ${primaryOrg
  ? `<span class="badge green">${primaryOrg.name} — ${primaryOrg.organization_id}</span>`
  : `<span class="badge amber">No org found</span>`
}</p>

<h3>Token saved (${envKey})</h3>
<div class="token">${refreshToken}</div>

<div class="next">
  <h3>Next step — connect the ${otherLabel} account</h3>
  <p style="margin:0 0 8px;opacity:.85;font-size:14px">
    Click below and log in with the <strong>${otherLabel}</strong> Zoho account.
  </p>
  <a href="${otherAuthUrl}" class="btn">Connect ${otherLabel} Zoho →</a>
</div>
</body></html>`;
}

function errorPage(code: string, description: string) {
  return `<!DOCTYPE html>
<html><head><meta charset="utf-8"><title>Auth Error</title>
<style>body{font-family:system-ui;max-width:600px;margin:60px auto;color:#333}h1{color:#dc2626}</style>
</head><body>
<h1>Auth Error: ${code}</h1>
<p>${description}</p>
<p><a href="javascript:history.back()">← Go back</a></p>
</body></html>`;
}
