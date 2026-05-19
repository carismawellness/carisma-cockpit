/**
 * Deploys tools/apps_script_zoho_ebitda_pull.js into the EBITDA Apps Script project.
 * Run with: node tools/deploy_apps_script.js
 *
 * Requires env vars: GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, GOOGLE_REFRESH_TOKEN
 * (or GOOGLE_SHEETS_* equivalents) — all already set in .env
 */

const fs   = require("fs");
const path = require("path");

// ── Load .env ─────────────────────────────────────────────────────────────────
const envPath = path.join(__dirname, "..", ".env");
const envLines = fs.readFileSync(envPath, "utf8").split("\n");
for (const line of envLines) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
  if (m) process.env[m[1]] = m[2].replace(/^'|'$/g, "").trim();
}

const CLIENT_ID     = process.env.GOOGLE_SHEETS_CLIENT_ID     || process.env.GOOGLE_CLIENT_ID;
const CLIENT_SECRET = process.env.GOOGLE_SHEETS_CLIENT_SECRET || process.env.GOOGLE_CLIENT_SECRET;
const REFRESH_TOKEN = process.env.GOOGLE_SHEETS_REFRESH_TOKEN || process.env.GOOGLE_REFRESH_TOKEN;
const SCRIPT_ID     = "1rqVPC2MEy3eQlcKClIKpMpuTyV02vUcopGZzR3QV6ciZt5OCvYHwx5zp";

async function getAccessToken() {
  const params = new URLSearchParams({
    client_id:     CLIENT_ID,
    client_secret: CLIENT_SECRET,
    refresh_token: REFRESH_TOKEN,
    grant_type:    "refresh_token",
  });
  const resp = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: params.toString(),
  });
  const data = await resp.json();
  if (!data.access_token) {
    throw new Error("Token refresh failed: " + JSON.stringify(data));
  }
  return data.access_token;
}

async function getExistingFiles(token) {
  const resp = await fetch(
    `https://script.googleapis.com/v1/projects/${SCRIPT_ID}/content`,
    { headers: { Authorization: `Bearer ${token}` } }
  );
  if (!resp.ok) {
    const txt = await resp.text();
    throw new Error(`GET project content failed (${resp.status}): ${txt}`);
  }
  return (await resp.json()).files || [];
}

async function updateProject(token, files) {
  const resp = await fetch(
    `https://script.googleapis.com/v1/projects/${SCRIPT_ID}/content`,
    {
      method:  "PUT",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body:    JSON.stringify({ files }),
    }
  );
  if (!resp.ok) {
    const txt = await resp.text();
    throw new Error(`PUT project content failed (${resp.status}): ${txt}`);
  }
  return resp.json();
}

async function main() {
  console.log("Getting access token…");
  const token = await getAccessToken();
  console.log("✓ Token acquired");

  console.log("Reading existing Apps Script project files…");
  let existingFiles;
  try {
    existingFiles = await getExistingFiles(token);
  } catch (e) {
    if (e.message.includes("403") || e.message.includes("insufficient")) {
      console.error("\n✗ Scope error — the existing Google token does not have Apps Script API access.");
      console.error("  You need to re-authorise with the 'script.projects' scope.");
      console.error("  See instructions below.\n");
      printManualInstructions();
      process.exit(1);
    }
    throw e;
  }
  console.log(`  Found ${existingFiles.length} existing file(s):`, existingFiles.map(f => f.name).join(", "));

  const toDeploy = [
    { name: "zoho_ebitda_pull",  file: "apps_script_zoho_ebitda_pull.js" },
    { name: "ebida_layer_pull",  file: "apps_script_ebida_layer_pull.js" },
    { name: "onopen",            file: "apps_script_onopen.js" },
  ];

  const managedNames = new Set(toDeploy.map(t => t.name));
  const filtered     = existingFiles.filter(f => !managedNames.has(f.name));
  for (const t of toDeploy) {
    const src = fs.readFileSync(path.join(__dirname, t.file), "utf8");
    filtered.push({ name: t.name, type: "SERVER_JS", source: src });
  }

  console.log(`Pushing ${filtered.length} file(s) to Apps Script project…`);
  await updateProject(token, filtered);
  console.log("✓ Deployed successfully!");
  console.log("\nNext step: open the spreadsheet and refresh the page.");
  console.log("You should see a new 'Zoho Data' menu appear.");
  console.log("If the menu doesn't appear, open Extensions → Apps Script → run onOpenZohoMenu once.");
}

function printManualInstructions() {
  console.log("Manual deployment (takes ~3 minutes):");
  console.log("1. Open https://script.google.com/d/1rqVPC2MEy3eQlcKClIKpMpuTyV02vUcopGZzR3QV6ciZt5OCvYHwx5zp/edit");
  console.log("2. Click + → Script → name it zoho_ebitda_pull");
  console.log("3. Delete the empty function, paste entire contents of tools/apps_script_zoho_ebitda_pull.js");
  console.log("4. Save (Ctrl+S), then run onOpenZohoMenu once to authorise");
  console.log("5. Reload the Google Sheet — 'Zoho Data' menu appears in the menu bar");
}

main().catch(e => { console.error("Error:", e.message); process.exit(1); });
