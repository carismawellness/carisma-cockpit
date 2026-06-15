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

/**
 * Asserts that a parsed Cockpit CSV has the expected header row.
 *
 * The class of bug we are protecting against: gviz on uploaded-XLSX files
 * sometimes returns the wrong tab (e.g. Spa Services for an Aesthetics
 * query), or merges the sheet's title row into the first header cell
 * ("(USE CI SKILL...) Status"). Either case results in every row being
 * silently skipped at lookup time — the ETL "succeeds" with 0 valid rows
 * and downstream dashboards show €0 with no error.
 *
 * Call this immediately after parsing. It checks that every required
 * header is present (allowing trailing whitespace) somewhere in row 0.
 * Throws a clear, actionable error if any required header is missing.
 *
 * @param parsedRows  rows from parseCSV(); row 0 is treated as the header
 * @param tabName     the Cockpit tab name (for the error message)
 * @param required    headers that MUST exist in row 0
 */
export function assertCockpitHeaders(
  parsedRows: string[][],
  tabName:    string,
  required:   readonly string[],
): void {
  if (parsedRows.length === 0) {
    throw new Error(
      `Cockpit tab "${tabName}" returned 0 rows. Check the sheet has data ` +
      `and is shared as "Anyone with the link can view."`,
    );
  }
  const headerCells = parsedRows[0].map(c => c.trim());
  const headerSet   = new Set(headerCells);
  const missing     = required.filter(h => !headerSet.has(h));
  if (missing.length > 0) {
    // Show the cells we did get so the operator can see the merge symptom
    // ("(USE CI SKILL...) Status" instead of "Status") at a glance.
    const sample = headerCells.slice(0, 8).map(c =>
      c.length > 60 ? `${c.slice(0, 57)}...` : c,
    );
    throw new Error(
      `Cockpit tab "${tabName}" is missing required headers: [${missing.join(", ")}]. ` +
      `Got row 0: [${sample.join(" | ")}${headerCells.length > 8 ? " | ..." : ""}]. ` +
      `Most likely cause: the gviz URL returned the wrong tab, or the title ` +
      `row was merged into the headers. Verify cockpitCsvUrl() includes ` +
      `&sheet=NAME and &range=A2:ZZ.`,
    );
  }
}
