/**
 * One-shot dump of the legacy "Sales MASTER" sheet to a local CSV.
 * Uses Google Sheets OAuth refresh token (same flow as lib/integrations/google-sheets.ts)
 * so the sheet does NOT need to be shared publicly.
 *
 * Usage:
 *   npx tsx --env-file .env.production.local Tools/spa-historical-sheet-dump.ts \
 *       [--out=/tmp/sales_master.csv] [--chunk=10000]
 */

for (const key of Object.keys(process.env)) {
  const v = process.env[key];
  if (typeof v === "string") process.env[key] = v.replace(/\\n$/g, "").trim();
}

import { writeFileSync } from "node:fs";

const SHEET_ID  = "1jOdDzPFWqVL-kRPA2TjBSqK6Fj5A6KCQZShlXwESh6I";
const TAB       = "Sales MASTER";
// 26 source columns A-Z; ignore formula columns AA-AP

const args: string[] = process.argv.slice(2);
const argMap: Record<string, string> = {};
for (const a of args) {
  if (a.startsWith("--")) { const [k, v] = a.slice(2).split("="); argMap[k] = v ?? ""; }
}
const OUT_PATH  = argMap.out   || "/tmp/sales_master.csv";
const CHUNK     = parseInt(argMap.chunk || "10000", 10);

async function getAccessToken(): Promise<string> {
  const body = new URLSearchParams({
    client_id:     process.env.GOOGLE_SHEETS_CLIENT_ID!,
    client_secret: process.env.GOOGLE_SHEETS_CLIENT_SECRET!,
    refresh_token: process.env.GOOGLE_SHEETS_REFRESH_TOKEN!,
    grant_type:    "refresh_token",
  });
  const r = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: body.toString(),
  });
  if (!r.ok) throw new Error(`Token refresh failed ${r.status}: ${await r.text()}`);
  const d = await r.json() as { access_token: string };
  return d.access_token;
}

async function fetchRange(token: string, range: string): Promise<string[][]> {
  const url = `https://sheets.googleapis.com/v4/spreadsheets/${SHEET_ID}/values/${encodeURIComponent(range)}` +
              `?majorDimension=ROWS&valueRenderOption=FORMATTED_VALUE&dateTimeRenderOption=FORMATTED_STRING`;
  const r = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
  if (!r.ok) throw new Error(`Sheets API ${range} failed ${r.status}: ${await r.text()}`);
  const d = await r.json() as { values?: string[][] };
  return d.values ?? [];
}

function escapeCsv(cell: string): string {
  if (cell == null) return "";
  const needsQuote = /["\n\r,]/.test(cell);
  return needsQuote ? `"${cell.replace(/"/g, '""')}"` : cell;
}

function rowsToCsv(rows: string[][], width: number): string {
  return rows.map(r => {
    const padded = r.length < width ? [...r, ...Array(width - r.length).fill("")] : r;
    return padded.map(escapeCsv).join(",");
  }).join("\n");
}

async function main() {
  console.log(`Dumping ${TAB} → ${OUT_PATH} (chunks of ${CHUNK} rows)`);
  const token = await getAccessToken();
  console.log("✓ OAuth token");

  // Header
  const headerRows = await fetchRange(token, `${TAB}!A1:Z1`);
  if (!headerRows.length) throw new Error("Empty header");
  const header = headerRows[0];
  const width  = header.length;
  console.log(`Header (${width} cols): ${header.slice(0, 6).join(" | ")} …`);

  let csv = rowsToCsv([header], width) + "\n";
  let start = 2;
  let totalDataRows = 0;
  while (true) {
    const end   = start + CHUNK - 1;
    const range = `${TAB}!A${start}:Z${end}`;
    const chunk = await fetchRange(token, range);
    if (chunk.length === 0) { console.log(`  ${range}: 0 rows — end of data.`); break; }
    csv += rowsToCsv(chunk, width) + "\n";
    totalDataRows += chunk.length;
    console.log(`  ${range}: ${chunk.length} rows  (cumulative ${totalDataRows})`);
    if (chunk.length < CHUNK) { console.log("  short chunk — end of data."); break; }
    start = end + 1;
  }

  writeFileSync(OUT_PATH, csv, "utf-8");
  const sizeMb = (csv.length / 1024 / 1024).toFixed(1);
  console.log(`\n✓ Wrote ${totalDataRows} data rows (${sizeMb} MB) to ${OUT_PATH}`);
}

main().catch(e => { console.error("✗", e.message); process.exit(1); });
