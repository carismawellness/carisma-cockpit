const SHEETS_API = "https://sheets.googleapis.com/v4/spreadsheets";
const TOKEN_URL  = "https://oauth2.googleapis.com/token";

let cachedToken: { token: string; expiresAt: number } | null = null;

async function getAccessToken(): Promise<string> {
  if (cachedToken && Date.now() < cachedToken.expiresAt) return cachedToken.token;

  const body = new URLSearchParams({
    client_id:     process.env.GOOGLE_SHEETS_CLIENT_ID     ?? process.env.GOOGLE_CLIENT_ID!,
    client_secret: process.env.GOOGLE_SHEETS_CLIENT_SECRET ?? process.env.GOOGLE_CLIENT_SECRET!,
    refresh_token: process.env.GOOGLE_SHEETS_REFRESH_TOKEN ?? process.env.GOOGLE_REFRESH_TOKEN!,
    grant_type:    "refresh_token",
  });

  const resp = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: body.toString(),
  });
  if (!resp.ok) throw new Error(`Google token refresh failed (${resp.status}): ${await resp.text()}`);
  const data = await resp.json() as { access_token: string; expires_in?: number };
  if (!data.access_token) throw new Error("Google token refresh: no access_token in response");

  cachedToken = {
    token:     data.access_token,
    expiresAt: Date.now() + ((data.expires_in ?? 3600) - 60) * 1000,
  };
  return cachedToken.token;
}

// Write a 2D array to a sheet, clearing it first.
// sheetName may contain spaces — handled via A1 notation quoting.
export async function writeSheet(
  spreadsheetId: string,
  sheetName: string,
  values: (string | number | null)[][],
): Promise<{ updatedRows: number; updatedColumns: number }> {
  const token = await getAccessToken();

  // Clear existing content
  const clearRange = encodeURIComponent(`'${sheetName}'!A:ZZZ`);
  const clearResp  = await fetch(`${SHEETS_API}/${spreadsheetId}/values/${clearRange}:clear`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: "{}",
  });
  if (!clearResp.ok) {
    const msg = await clearResp.text();
    throw new Error(`Google Sheets clear failed (${clearResp.status}): ${msg}`);
  }

  // Write new values
  const writeRange = encodeURIComponent(`'${sheetName}'!A1`);
  const writeResp  = await fetch(
    `${SHEETS_API}/${spreadsheetId}/values/${writeRange}?valueInputOption=USER_ENTERED`,
    {
      method: "PUT",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        range:          `'${sheetName}'!A1`,
        majorDimension: "ROWS",
        values,
      }),
    },
  );
  if (!writeResp.ok) {
    const msg = await writeResp.text();
    throw new Error(`Google Sheets write failed (${writeResp.status}): ${msg}`);
  }

  const result = await writeResp.json() as { updatedRows?: number; updatedColumns?: number };
  return { updatedRows: result.updatedRows ?? values.length, updatedColumns: result.updatedColumns ?? 0 };
}
