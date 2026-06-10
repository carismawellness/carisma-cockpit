// Shared CSV parsing for Cockpit ETL feeds.
//
// State-machine parser over the FULL text — splitting on raw "\n" before
// parsing shears any row whose quoted cell contains a line break. This
// handles quoted fields with embedded newlines, commas, and escaped
// quotes (""), plus CRLF/CR line endings. Rows that are entirely empty
// (blank lines, ",,,," padding) are dropped, matching the previous
// `.filter(l => l.trim())` behaviour.
export function parseCSV(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cur = "", inQ = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (ch === '"') {
      if (inQ && text[i + 1] === '"') { cur += '"'; i++; }
      else inQ = !inQ;
    } else if (ch === "," && !inQ) {
      row.push(cur); cur = "";
    } else if ((ch === "\n" || ch === "\r") && !inQ) {
      if (ch === "\r" && text[i + 1] === "\n") i++;
      row.push(cur); cur = "";
      rows.push(row); row = [];
    } else cur += ch;
  }
  if (cur !== "" || row.length) { row.push(cur); rows.push(row); }
  return rows.filter(r => r.some(c => c.trim()));
}
