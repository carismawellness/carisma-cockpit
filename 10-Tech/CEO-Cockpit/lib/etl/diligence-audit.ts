/**
 * Due Diligence Audit ETL — parser.
 *
 * Source: "Accounting Master" Google Sheet, tab "Diligence audit".
 * Fetched via the zero-auth public CSV export (same pattern as the other
 * cockpit ETLs — NO OAuth, NO refresh tokens):
 *   https://docs.google.com/spreadsheets/d/{SHEET_ID}/export?format=csv&gid={GID}
 *
 * Sheet layout (verified 2026-06-10):
 *   Row 1 — month labels ("January 2024" … "May 2026") at the START column of
 *           each month block; remaining cells in the block are empty.
 *   Row 2 — location short names per column within each block
 *           (Inter, Hugos, Hyatt, Ramla, Labranda, Sunny, Excelsior, Novotel…).
 *   Data rows — identified by their column-B label ("Total sales (including
 *           VAT)", "Total deleted & cancelled", …). "%" rows and section
 *           headers are derived/decorative and ignored.
 *
 * IMPORTANT: block width VARIES over time (6 locations in 2024, 7 from
 * ~Jul 2025, 8 from ~Oct 2025) and column ORDER within a block also varies
 * (e.g. Excelsior moves position between Jul and Oct 2025). NEVER hardcode
 * block widths or column indexes — blocks are derived dynamically: a block
 * spans from a month-label column to the column before the next month label.
 */

const DILIGENCE_SHEET_ID = "1WWM7W6S5wtSC-5hdlcuJgW3zbYaO7YRgg4_-Bju4-5s";
const DILIGENCE_GID = "912652373";

// ── Location mapping ─────────────────────────────────────────────────────────
// Sheet label (lowercased) → canonical location slug.
// "Riviera" is the same venue as Labranda (renamed). "Sunny" = Sunny Coast = odycy.
const LABEL_TO_SLUG: Record<string, string> = {
  inter: "inter",
  hugos: "hugos",
  hyatt: "hyatt",
  ramla: "ramla",
  labranda: "labranda",
  riviera: "labranda",
  sunny: "odycy",
  excelsior: "excelsior",
  novotel: "novotel",
};

const SLUG_TO_LOCATION_ID: Record<string, number> = {
  inter: 1,
  hugos: 2,
  hyatt: 3,
  ramla: 4,
  labranda: 5,
  odycy: 6,
  excelsior: 7,
  novotel: 8,
};

const BRAND_ID = 1;

// ── Metric row matching ──────────────────────────────────────────────────────
// Column-B labels, matched case-insensitively by prefix (tolerates trailing
// parentheticals and typos like "dicscounts"). ORDER MATTERS: "total
// discounted cash" must be checked before "total cash".
type MetricField =
  | "total_sales"
  | "deleted_cancelled"
  | "complimentary"
  | "cash_sales"
  | "discounted_cash"
  | "unattended_count";

const METRIC_PREFIXES: [string, MetricField][] = [
  ["total sales", "total_sales"],            // "Total sales (including VAT)"
  ["total deleted", "deleted_cancelled"],    // "Total deleted & cancelled"
  ["total complimentary", "complimentary"],  // "Total complimentary"
  ["total discounted cash", "discounted_cash"], // "Total discounted cash sales (Cash dicscounts given)"
  ["total cash", "cash_sales"],              // "Total cash sales"
  ["total unattended", "unattended_count"],  // "Total unattended - MUST BE 0"
];

function matchMetric(label: string): MetricField | null {
  const norm = label.trim().toLowerCase().replace(/\s+/g, " ");
  if (!norm || norm.startsWith("%")) return null;
  for (const [prefix, field] of METRIC_PREFIXES) {
    if (norm.startsWith(prefix)) return field;
  }
  return null;
}

// ── CSV parsing ──────────────────────────────────────────────────────────────
// Full-text state-machine parser (same approach as lib/etl/csv.ts, kept
// self-contained here). Handles quoted cells with embedded commas
// (e.g. "59,722"), escaped quotes ("") and CRLF/CR line endings.
function parseCSV(text: string): string[][] {
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

// ── Value parsing ────────────────────────────────────────────────────────────
// Plain numbers; may be negative, may contain thousands-commas, may be empty
// (→ null). EUR amounts except unattended_count (integer count).
function parseNumber(raw: string): number | null {
  const v = raw.trim().replace(/[€\s]/g, "").replace(/,/g, "");
  if (v === "" || v === "-") return null;
  const n = parseFloat(v);
  return Number.isFinite(n) ? n : null;
}

// ── Month parsing ────────────────────────────────────────────────────────────
const MONTH_NAMES: Record<string, number> = {
  january: 1, february: 2, march: 3, april: 4, may: 5, june: 6,
  july: 7, august: 8, september: 9, october: 10, november: 11, december: 12,
};

const MONTH_LABEL_RE =
  /^(january|february|march|april|may|june|july|august|september|october|november|december)\s+(\d{4})$/i;

function parseMonthLabel(raw: string): string | null {
  const m = raw.trim().toLowerCase().match(MONTH_LABEL_RE);
  if (!m) return null;
  const monthNum = MONTH_NAMES[m[1]];
  if (!monthNum) return null;
  return `${m[2]}-${String(monthNum).padStart(2, "0")}-01`;
}

// ── Output types ─────────────────────────────────────────────────────────────

export type DiligenceAuditRow = {
  month: string;            // DATE — first of month, "YYYY-MM-01"
  location_id: number;
  brand_id: number;
  total_sales: number | null;
  deleted_cancelled: number | null;
  complimentary: number | null;
  cash_sales: number | null;
  discounted_cash: number | null;
  unattended_count: number | null;
};

export type DiligenceAuditResult = {
  rows: DiligenceAuditRow[];
  months: string[];         // distinct months covered, sorted
  warnings: string[];
};

// ── Fetch ────────────────────────────────────────────────────────────────────

export async function fetchDiligenceAuditCsv(): Promise<string> {
  const url = `https://docs.google.com/spreadsheets/d/${DILIGENCE_SHEET_ID}/export?format=csv&gid=${DILIGENCE_GID}`;
  const resp = await fetch(url, { redirect: "follow" });
  if (!resp.ok) {
    const text = await resp.text();
    throw new Error(
      `Diligence audit CSV fetch failed: ${resp.status} — ${text.slice(0, 200)}. ` +
      `Check that the Accounting Master sheet is shared "Anyone with link can view".`
    );
  }
  return resp.text();
}

// ── Parse ────────────────────────────────────────────────────────────────────

export function parseDiligenceAudit(csvText: string): DiligenceAuditResult {
  const warnings: string[] = [];
  const grid = parseCSV(csvText);

  // Locate the month-label row (first row containing a "Month YYYY" cell)
  // and the location row (the row immediately after it).
  const monthRowIdx = grid.findIndex(r => r.some(c => parseMonthLabel(c) !== null));
  if (monthRowIdx === -1 || monthRowIdx + 1 >= grid.length) {
    throw new Error("Diligence audit: could not locate month-label row in sheet");
  }
  const monthRow = grid[monthRowIdx];
  const locationRow = grid[monthRowIdx + 1];

  // Derive month blocks dynamically: a block spans from a month-label column
  // to the column before the next month label. The last block extends to the
  // last column with a non-empty location label.
  const blockStarts: { col: number; month: string }[] = [];
  for (let c = 0; c < monthRow.length; c++) {
    const month = parseMonthLabel(monthRow[c]);
    if (month) blockStarts.push({ col: c, month });
  }
  if (blockStarts.length === 0) {
    throw new Error("Diligence audit: no month labels found");
  }
  let lastLocCol = -1;
  for (let c = 0; c < locationRow.length; c++) {
    if (locationRow[c].trim()) lastLocCol = c;
  }

  // Build column → (month, location_id) map.
  type ColTarget = { month: string; locationId: number };
  const colTargets = new Map<number, ColTarget>();
  const seenKeys = new Set<string>();

  for (let b = 0; b < blockStarts.length; b++) {
    const { col: start, month } = blockStarts[b];
    const end = b + 1 < blockStarts.length
      ? blockStarts[b + 1].col - 1
      : Math.max(lastLocCol, start);

    for (let c = start; c <= end; c++) {
      const label = (locationRow[c] ?? "").trim();
      if (!label) continue; // empty header cell within block — nothing to map
      const slug = LABEL_TO_SLUG[label.toLowerCase()];
      if (!slug) {
        warnings.push(`Unknown location label "${label}" in block ${month} (column ${c + 1}) — column skipped`);
        continue;
      }
      const locationId = SLUG_TO_LOCATION_ID[slug];
      const key = `${month}|${locationId}`;
      if (seenKeys.has(key)) {
        warnings.push(`Duplicate location "${label}" in block ${month} (column ${c + 1}) — column skipped`);
        continue;
      }
      seenKeys.add(key);
      colTargets.set(c, { month, locationId });
    }
  }

  // Walk data rows, matching column-B labels to metric fields.
  const rowsByKey = new Map<string, DiligenceAuditRow>();
  const ensureRow = (t: ColTarget): DiligenceAuditRow => {
    const key = `${t.month}|${t.locationId}`;
    let r = rowsByKey.get(key);
    if (!r) {
      r = {
        month: t.month,
        location_id: t.locationId,
        brand_id: BRAND_ID,
        total_sales: null,
        deleted_cancelled: null,
        complimentary: null,
        cash_sales: null,
        discounted_cash: null,
        unattended_count: null,
      };
      rowsByKey.set(key, r);
    }
    return r;
  };

  const seenFields = new Set<MetricField>();
  for (let i = monthRowIdx + 2; i < grid.length; i++) {
    const field = matchMetric(grid[i][1] ?? "");
    if (!field) continue;
    if (seenFields.has(field)) {
      warnings.push(`Metric row "${(grid[i][1] ?? "").trim()}" appears more than once — later occurrence ignored`);
      continue;
    }
    seenFields.add(field);

    for (const [c, target] of colTargets) {
      const num = parseNumber(grid[i][c] ?? "");
      if (num === null) continue;
      const row = ensureRow(target);
      row[field] = field === "unattended_count" ? Math.round(num) : num;
    }
  }

  const missing = METRIC_PREFIXES.map(([, f]) => f).filter(f => !seenFields.has(f));
  if (missing.length) {
    warnings.push(`Metric rows not found in sheet: ${missing.join(", ")}`);
  }

  // Drop rows where every metric is null (e.g. future months not yet filled).
  const rows = Array.from(rowsByKey.values()).filter(r =>
    r.total_sales !== null || r.deleted_cancelled !== null || r.complimentary !== null ||
    r.cash_sales !== null || r.discounted_cash !== null || r.unattended_count !== null
  );
  rows.sort((a, b) =>
    a.month === b.month ? a.location_id - b.location_id : a.month.localeCompare(b.month)
  );

  const months = Array.from(new Set(rows.map(r => r.month))).sort();
  return { rows, months, warnings };
}

// ── Entry point ──────────────────────────────────────────────────────────────

export async function runDiligenceAudit(): Promise<DiligenceAuditResult> {
  const csvText = await fetchDiligenceAuditCsv();
  return parseDiligenceAudit(csvText);
}
