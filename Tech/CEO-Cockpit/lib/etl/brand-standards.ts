/**
 * Brand Standards ETL — fetch + parse the Facility / Front Desk / Mystery Guest
 * checklist tabs from the "Accounting Master" Google Sheet.
 *
 * Source layout (per tab, verified 2026-06-10):
 *   - Month-header row: month labels at block-start columns (merged cells →
 *     only the first column of each block is filled in the CSV). Labels are
 *     messy: "August 2024", "Mart 2025" (Turkish for March), "January and
 *     February " (no year — treated as the LATER month, year inferred from
 *     neighbours), " " (blank → no month → skipped + reported).
 *   - Location row (directly below): short names per column (Inter, Hugos,
 *     Hyatt, Ramla, Labranda/Riviera, Sunny, Excelsior, Novotel). Block width
 *     varies (2–9 columns) — always derived from the data, never hardcoded.
 *   - Score row: overall % per location (computed in-sheet — NOT imported;
 *     used only for out-of-band verification).
 *   - Data rows: checklist items. Category headers are rows with text but no
 *     TRUE/FALSE values (usually ending with ":"). Items below a header belong
 *     to it until the next header. Cells are "TRUE"/"FALSE"; blank or
 *     non-boolean cells mean "not assessed" and are skipped.
 *
 * Month-label ↔ location-column alignment (the hard part):
 *   Normally each month label sits exactly on the first column of its
 *   location block, and on the mystery-guest tabs months are DENSER than
 *   location runs (a 6-location run can host two 3-column months). In both
 *   cases the label positions are authoritative → "aligned" regime: a block
 *   spans from its label's column to the next label's column.
 *
 *   BUT on "Facility standards 26" the merged month headers stayed 6 columns
 *   wide while the location blocks grew to 8 → labels drift left of their
 *   real blocks. Signature: fewer month labels than location runs. In that
 *   case ("matched" regime) location runs (sequences restarting when a name
 *   repeats) define the blocks, and month labels are assigned to runs with an
 *   order-preserving minimum-displacement matching. Unlabelled runs are
 *   skipped + reported.
 *
 * Other quirks handled:
 *   - Facility tabs: month row is the first CSV row; items live in column B.
 *   - Front desk / mystery guest tabs: a fully-empty first row precedes the
 *     month row (dropped by parseCSV); items in column B — EXCEPT
 *     "Front desk standards 26" where items moved to column A and the month
 *     row is missing entirely (no month labels anywhere → whole tab skipped
 *     with a warning until labels are added to the sheet).
 *   - "Facility standards" 2024-era score row doubles as the first category
 *     header ("SPA RECEPTION:" sits next to the percentages).
 *   - Duplicate location columns inside one month block → last column wins;
 *     Riviera beats Labranda (same venue renamed) when both appear.
 *   - Duplicate month blocks inside one tab (e.g. "January 2025" twice on
 *     "Front desk standards 25"): last write wins, UNLESS the later block has
 *     no TRUE anywhere (unfilled template) — then the earlier block is kept.
 *   - Future-month blocks (placeholder all-FALSE checkboxes) are skipped.
 *   - Any (location, month, standard_type) group with >= MIN_GROUP_FOR_ALL_FALSE
 *     items that is 100% FALSE is treated as NOT ASSESSED and excluded.
 *     Unticked checkboxes export as FALSE, so an unfilled template column is
 *     cell-for-cell indistinguishable from a real all-fail — but a venue
 *     failing literally every checklist item is implausible, while unfilled
 *     columns are common (the sheet's own row-3 score also shows 0% for them,
 *     since its formula counts the same FALSE cells — so the row-3 % carries
 *     no extra evidence). Excluded groups are listed in the warnings.
 *
 * NO OAuth — public CSV export only (same auth-free pattern as the
 * crm-agents ETL; sheet is shared "Anyone with link can view").
 */

import { parseCSV } from "./csv";

// ── Config ───────────────────────────────────────────────────────────────────

const SPREADSHEET_ID = "1WWM7W6S5wtSC-5hdlcuJgW3zbYaO7YRgg4_-Bju4-5s";

export type StandardType = "facility" | "front_desk" | "mystery_guest";

interface TabConfig {
  name: string;        // human-readable tab name (logs/warnings)
  gid: string;         // CSV export gid
  type: StandardType;
  defaultYear: number; // last-resort year when no neighbouring block has one
}

// A (location, month, standard_type) group that is 100% FALSE with at least
// this many items is treated as an unfilled template (not assessed) and
// excluded. Small groups (< 10 items) are kept — too little signal to judge.
const MIN_GROUP_FOR_ALL_FALSE = 10;

// Processed in this order — later tabs win when the same
// (month, type, item, location) appears in more than one tab.
const TABS: TabConfig[] = [
  { name: "Facility standards",       gid: "2099637249", type: "facility",      defaultYear: 2024 },
  { name: "Facility standards 25",    gid: "48304779",   type: "facility",      defaultYear: 2025 },
  { name: "Facility standards 26",    gid: "1523717837", type: "facility",      defaultYear: 2026 },
  { name: "Front desk standards",     gid: "386903760",  type: "front_desk",    defaultYear: 2024 },
  { name: "Front desk standards 25",  gid: "1673151431", type: "front_desk",    defaultYear: 2025 },
  { name: "Front desk standards 26",  gid: "1897103524", type: "front_desk",    defaultYear: 2026 },
  { name: "Mystery guest standards",  gid: "1422994359", type: "mystery_guest", defaultYear: 2024 },
  { name: "Mystery guest standards 25 from AUGUST to 2026", gid: "263663566", type: "mystery_guest", defaultYear: 2025 },
];

// Raw sheet label (lowercased) → canonical locations.slug
const LOCATION_ALIASES: Record<string, string> = {
  "inter":            "inter",
  "intercontinental": "inter",
  "hugos":            "hugos",
  "hugo's":           "hugos",
  "hyatt":            "hyatt",
  "ramla":            "ramla",
  "ramla bay":        "ramla",
  "labranda":         "labranda",
  "riviera":          "labranda", // same venue, renamed in 2026
  "sunny":            "odycy",
  "odycy":            "odycy",
  "excelsior":        "excelsior",
  "novotel":          "novotel",
};

// ── Month parsing ────────────────────────────────────────────────────────────

const MONTH_NAMES: Record<string, number> = {
  january: 1, february: 2, march: 3, mart: 3 /* Turkish */, april: 4,
  may: 5, june: 6, july: 7, august: 8,
  september: 9, october: 10, november: 11, december: 12,
};

const MONTH_RE = new RegExp(`\\b(${Object.keys(MONTH_NAMES).join("|")})\\b`, "gi");
const YEAR_RE = /\b(20\d{2})\b/;

/**
 * Extract (month, year?) from a messy block label.
 * "January and February " → month 2 (the LATER month), no year.
 * Returns null month when no month name is found.
 */
function parseMonthLabel(label: string): { month: number | null; year: number | null } {
  const matches = label.toLowerCase().match(MONTH_RE);
  const month = matches && matches.length > 0
    ? MONTH_NAMES[matches[matches.length - 1]]
    : null;
  const yearMatch = label.match(YEAR_RE);
  const year = yearMatch ? parseInt(yearMatch[1], 10) : null;
  return { month, year };
}

// ── Cell helpers ─────────────────────────────────────────────────────────────

function cell(row: string[] | undefined, idx: number): string {
  if (!row || idx >= row.length) return "";
  return String(row[idx]).trim();
}

function rawCell(row: string[] | undefined, idx: number): string {
  if (!row || idx >= row.length) return "";
  return String(row[idx]);
}

function isTrueFalse(val: string): boolean {
  const v = val.trim().toUpperCase();
  return v === "TRUE" || v === "FALSE";
}

/** Detect score/summary values like "85%", "0.85", "2.5". */
function isPercentage(val: string): boolean {
  const v = val.trim().replace(/%$/, "");
  if (!v) return false;
  const f = parseFloat(v);
  return !isNaN(f) && /^[\d.]+$/.test(v) && f >= 0 && f <= 100;
}

function collapseWhitespace(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

// ── Output types ─────────────────────────────────────────────────────────────

export interface BrandStandardRow {
  month: string; // YYYY-MM-01
  standard_type: StandardType;
  category: string;
  item: string;
  location: string; // canonical slug
  result: boolean;
}

export interface TabSummary {
  tab: string;
  type: StandardType;
  blocks: number;
  skipped_blocks: number;
  rows: number;
}

export interface BrandStandardsResult {
  rows: BrandStandardRow[];
  warnings: string[];
  tabs: TabSummary[];
}

// ── CSV fetch (public sheet — no auth) ───────────────────────────────────────

async function fetchTab(tab: TabConfig): Promise<string[][]> {
  const url = `https://docs.google.com/spreadsheets/d/${SPREADSHEET_ID}/export?format=csv&gid=${tab.gid}`;
  const resp = await fetch(url, { redirect: "follow" });
  if (!resp.ok) {
    throw new Error(
      `CSV fetch failed for tab "${tab.name}" (gid=${tab.gid}): ${resp.status}. ` +
      `Check that the sheet is shared "Anyone with link can view".`
    );
  }
  return parseCSV(await resp.text());
}

// ── Block resolution ─────────────────────────────────────────────────────────

interface LabelCell {
  col: number;
  label: string; // trimmed; "" for blank (" ") labels
  month: number | null;
  year: number | null;
}

interface Block {
  label: string;
  startCol: number;
  cols: { col: number; name: string }[]; // location columns in this block
  month: number | null;
  year: number | null;
  monthIso: string | null;
}

interface LocationRun {
  startCol: number;
  cols: { col: number; name: string }[];
}

/**
 * Split the location row into "runs": a new run starts whenever a location
 * name repeats within the current run (raw names, so a block holding both
 * Labranda and Riviera stays intact).
 */
function computeLocationRuns(locRow: string[]): LocationRun[] {
  const runs: LocationRun[] = [];
  let current: LocationRun | null = null;
  let seen = new Set<string>();

  for (let c = 0; c < locRow.length; c++) {
    const name = cell(locRow, c);
    if (!name || !LOCATION_ALIASES[name.toLowerCase()]) continue;
    const key = name.toLowerCase();
    if (!current || seen.has(key)) {
      current = { startCol: c, cols: [] };
      runs.push(current);
      seen = new Set();
    }
    current.cols.push({ col: c, name });
    seen.add(key);
  }
  return runs;
}

/** Aligned regime: each label owns the columns up to the next label. */
function buildBlocksAligned(labels: LabelCell[], locRow: string[], maxCol: number): Block[] {
  return labels.map((l, i) => {
    const end = i + 1 < labels.length ? labels[i + 1].col : maxCol;
    const cols: { col: number; name: string }[] = [];
    for (let c = l.col; c < end; c++) {
      const name = cell(locRow, c);
      if (name && LOCATION_ALIASES[name.toLowerCase()]) cols.push({ col: c, name });
    }
    return { label: l.label, startCol: l.col, cols, month: l.month, year: l.year, monthIso: null };
  });
}

/**
 * Matched regime (stale merged headers): assign month labels to location runs
 * with an order-preserving minimum-total-displacement matching (DP).
 * Requires labels.length <= runs.length. Returns blocks for matched runs and
 * the list of unmatched runs.
 */
function buildBlocksMatched(
  labels: LabelCell[],
  runs: LocationRun[]
): { blocks: Block[]; unmatchedRuns: LocationRun[] } {
  const m = labels.length, r = runs.length;
  const INF = Number.POSITIVE_INFINITY;
  const cost = (i: number, j: number) => Math.abs(labels[i].col - runs[j].startCol);

  // dp[i][j] = min cost matching labels 0..i with label i → run j (order-preserving)
  const dp: number[][] = Array.from({ length: m }, () => Array(r).fill(INF));
  const prev: number[][] = Array.from({ length: m }, () => Array(r).fill(-1));
  for (let j = 0; j < r; j++) dp[0][j] = cost(0, j);
  for (let i = 1; i < m; i++) {
    let bestJ = -1;
    for (let j = i; j < r; j++) {
      if (bestJ === -1 || dp[i - 1][j - 1] < dp[i - 1][bestJ]) bestJ = j - 1;
      if (bestJ !== -1 && dp[i - 1][bestJ] < INF) {
        dp[i][j] = dp[i - 1][bestJ] + cost(i, j);
        prev[i][j] = bestJ;
      }
    }
  }

  // Reconstruct
  const assignment = new Array<number>(m).fill(-1);
  let endJ = 0;
  for (let j = 1; j < r; j++) if (dp[m - 1][j] < dp[m - 1][endJ]) endJ = j;
  let j = endJ;
  for (let i = m - 1; i >= 0; i--) {
    assignment[i] = j;
    j = i > 0 ? prev[i][j] : -1;
  }

  const matched = new Set(assignment);
  const blocks: Block[] = labels.map((l, i) => {
    const run = runs[assignment[i]];
    return { label: l.label, startCol: run.startCol, cols: run.cols, month: l.month, year: l.year, monthIso: null };
  });
  const unmatchedRuns = runs.filter((_, idx) => !matched.has(idx));
  return { blocks, unmatchedRuns };
}

/**
 * Fill in missing years (e.g. "January and February ", "May ") from
 * neighbouring blocks: prefer the nearest previous dated block (rolling over
 * to the next year when the month number goes backwards), else the nearest
 * next dated block, else the tab's default year. Then resolve monthIso.
 */
function resolveYears(blocks: Block[], defaultYear: number, tabName: string, warnings: string[]): void {
  for (let i = 0; i < blocks.length; i++) {
    const b = blocks[i];
    if (b.month === null) continue;
    if (b.year === null) {
      let resolved: number | null = null;
      for (let j = i - 1; j >= 0; j--) {
        const p = blocks[j];
        if (p.month !== null && p.year !== null) {
          resolved = b.month >= p.month ? p.year : p.year + 1;
          break;
        }
      }
      if (resolved === null) {
        for (let k = i + 1; k < blocks.length; k++) {
          const n = blocks[k];
          if (n.month !== null && n.year !== null) {
            resolved = b.month <= n.month ? n.year : n.year - 1;
            break;
          }
        }
      }
      if (resolved === null) {
        resolved = defaultYear;
        warnings.push(`${tabName}: block "${b.label}" has no year and no dated neighbours — assumed tab default ${defaultYear}`);
      } else {
        warnings.push(`${tabName}: block "${b.label}" has no year — inferred ${resolved} from neighbouring blocks`);
      }
      b.year = resolved;
    }
    b.monthIso = `${b.year}-${String(b.month).padStart(2, "0")}-01`;
  }
}

// ── Tab parser ───────────────────────────────────────────────────────────────

function parseTab(
  raw: string[][],
  tab: TabConfig,
  warnings: string[]
): { rows: BrandStandardRow[]; blocks: number; skippedBlocks: number } {
  if (raw.length < 4) {
    warnings.push(`${tab.name}: tab has fewer than 4 rows — skipped entirely`);
    return { rows: [], blocks: 0, skippedBlocks: 0 };
  }

  const maxCol = Math.max(...raw.map((r) => r.length));

  // Location row = first row with >= 3 recognised location names.
  let locRowIdx = -1;
  for (let i = 0; i < Math.min(raw.length, 6); i++) {
    let hits = 0;
    for (let c = 0; c < raw[i].length; c++) {
      if (LOCATION_ALIASES[cell(raw[i], c).toLowerCase()]) hits++;
    }
    if (hits >= 3) { locRowIdx = i; break; }
  }
  if (locRowIdx === -1) {
    warnings.push(`${tab.name}: could not find a location header row — skipped entirely`);
    return { rows: [], blocks: 0, skippedBlocks: 0 };
  }
  const locRow = raw[locRowIdx];
  const runs = computeLocationRuns(locRow);

  // Month row = nearest row ABOVE the location row containing >= 1 parseable
  // month label. ("Front desk standards 26" has none → whole tab skipped.)
  let monthRowIdx = -1;
  for (let i = locRowIdx - 1; i >= 0; i--) {
    const hasMonth = raw[i].some((v) => parseMonthLabel(String(v)).month !== null);
    if (hasMonth) { monthRowIdx = i; break; }
  }
  if (monthRowIdx === -1) {
    warnings.push(
      `${tab.name}: NO month labels found anywhere above the location row — ` +
      `skipped the entire tab (~${runs.length} blocks). Add month labels to the sheet to import it.`
    );
    return { rows: [], blocks: runs.length, skippedBlocks: runs.length };
  }

  // All raw-non-empty cells in the month row are label cells; a " " cell marks
  // a labelless block (distinguishable from truly-empty merge continuations).
  const labelCells: LabelCell[] = [];
  for (let c = 0; c < raw[monthRowIdx].length; c++) {
    const rawVal = rawCell(raw[monthRowIdx], c);
    if (rawVal === "" || /checklist/i.test(rawVal)) continue;
    const { month, year } = parseMonthLabel(rawVal);
    labelCells.push({ col: c, label: rawVal.trim(), month, year });
  }
  const monthLabels = labelCells.filter((l) => l.month !== null);

  // Regime selection: when there are at least as many month labels as
  // location runs, label positions are authoritative (covers the mystery-guest
  // tabs where one 6-location run hosts two 3-column months). When there are
  // FEWER labels than runs, the merged month headers went stale (Facility 26)
  // → match labels to runs in order.
  let blocks: Block[];
  let skippedBlocks = 0;

  if (monthLabels.length >= runs.length) {
    blocks = buildBlocksAligned(labelCells, locRow, maxCol);
  } else {
    const { blocks: matched, unmatchedRuns } = buildBlocksMatched(monthLabels, runs);
    blocks = matched;
    for (const l of labelCells.filter((x) => x.month === null)) {
      skippedBlocks++;
      warnings.push(
        `${tab.name}: month-header cell at column ${l.col + 1} ` +
        `${l.label === "" ? "is blank" : `("${l.label}") is unparseable`} — no block assigned`
      );
    }
    for (const b of blocks) {
      const l = monthLabels[blocks.indexOf(b)];
      if (l && l.col !== b.startCol) {
        warnings.push(
          `${tab.name}: label "${b.label}" at column ${l.col + 1} re-anchored to location block ` +
          `starting at column ${b.startCol + 1} (stale merged month header)`
        );
      }
    }
    for (const run of unmatchedRuns) {
      skippedBlocks++;
      const lastCol = run.cols[run.cols.length - 1]?.col ?? run.startCol;
      warnings.push(
        `${tab.name}: skipped unlabelled location block at columns ${run.startCol + 1}–${lastCol + 1} (no month assigned)`
      );
    }
  }

  resolveYears(blocks, tab.defaultYear, tab.name, warnings);

  // First day of the current month — blocks dated in the future are template
  // placeholders (all-FALSE checkboxes), not real assessments.
  const now = new Date();
  const currentMonthIso = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-01`;

  const dataStart = locRowIdx + 1;

  /** Does any data cell in the block's columns hold TRUE? (unfilled-template detection) */
  const blockHasAnyTrue = (b: Block): boolean => {
    for (let i = dataStart; i < raw.length; i++) {
      for (const { col } of b.cols) {
        if (cell(raw[i], col).toUpperCase() === "TRUE") return true;
      }
    }
    return false;
  };

  // Map data columns → (monthIso, locationSlug), block by block.
  const colPairs = new Map<number, { month: string; location: string }>();
  const seenMonths = new Map<string, string>(); // monthIso → label (dup detection)
  const unknownLocs = new Set<string>();

  for (const b of blocks) {
    if (!b.monthIso) {
      skippedBlocks++;
      warnings.push(
        `${tab.name}: skipped block at column ${b.startCol + 1} — ` +
        `month label ${b.label === "" ? "is blank" : `"${b.label}" is unparseable`}`
      );
      continue;
    }
    if (b.monthIso > currentMonthIso) {
      skippedBlocks++;
      warnings.push(`${tab.name}: skipped future-month block "${b.label}" (${b.monthIso}) — placeholder, not yet assessed`);
      continue;
    }
    const prevLabel = seenMonths.get(b.monthIso);
    if (prevLabel !== undefined) {
      if (!blockHasAnyTrue(b)) {
        skippedBlocks++;
        warnings.push(
          `${tab.name}: duplicate month block "${b.label}" (${b.monthIso}) contains no TRUE values ` +
          `(unfilled template) — kept the earlier block "${prevLabel}"`
        );
        continue;
      }
      warnings.push(`${tab.name}: duplicate month block "${b.label}" (${b.monthIso}) — overwrites earlier block "${prevLabel}" (last write wins)`);
    } else {
      seenMonths.set(b.monthIso, b.label);
    }

    // Within a block: one column per location slug. Last column wins, except
    // Riviera always beats Labranda (same venue renamed — Riviera is current).
    const bySlug = new Map<string, { col: number; raw: string }>();
    for (const { col, name } of b.cols) {
      const slug = LOCATION_ALIASES[name.toLowerCase()];
      if (!slug) {
        if (!unknownLocs.has(name.toLowerCase())) {
          unknownLocs.add(name.toLowerCase());
          warnings.push(`${tab.name}: unknown location label "${name}" — column skipped`);
        }
        continue;
      }
      const existing = bySlug.get(slug);
      if (existing && existing.raw.toLowerCase() === "riviera" && name.toLowerCase() !== "riviera") {
        continue; // keep Riviera's column
      }
      bySlug.set(slug, { col, raw: name });
    }
    for (const { col } of bySlug.values()) {
      colPairs.set(col, { month: b.monthIso, location: LOCATION_ALIASES[cell(locRow, col).toLowerCase()] });
    }
  }

  if (colPairs.size === 0) {
    return { rows: [], blocks: blocks.length, skippedBlocks };
  }

  // Item column detection: items normally live in column B — except
  // "Front desk standards 26" which moved them to column A. Detect by
  // comparing non-empty counts over the data rows (same approach as the
  // legacy Python ETL).
  let colACount = 0, colBCount = 0;
  for (let i = dataStart; i < Math.min(raw.length, dataStart + 40); i++) {
    if (cell(raw[i], 0)) colACount++;
    if (cell(raw[i], 1)) colBCount++;
  }
  const itemCol = colBCount >= colACount ? 1 : 0;
  const altCol = itemCol === 1 ? 0 : 1;

  // Walk data rows, tracking the current category.
  const rows: BrandStandardRow[] = [];
  let currentCategory = "General";

  for (let i = dataStart; i < raw.length; i++) {
    const r = raw[i];
    const itemText = cell(r, itemCol);
    const altText = cell(r, altCol);

    // Collect TRUE/FALSE values at mapped data columns. Blank / non-boolean
    // cells = not assessed → skipped.
    const tfValues = new Map<number, boolean>();
    for (const col of colPairs.keys()) {
      const v = cell(r, col);
      if (isTrueFalse(v)) tfValues.set(col, v.toUpperCase() === "TRUE");
    }

    if (tfValues.size === 0) {
      // Category header or score/summary row (the 2024 facility tab keeps the
      // first category header ON the score row — text + percentages, no TF).
      const catText = itemText || altText;
      if (catText && !isPercentage(catText)) {
        currentCategory = collapseWhitespace(catText.replace(/:+\s*$/, ""));
      }
      continue;
    }

    const label = itemText || altText;
    if (!label || isPercentage(label)) continue; // stray TF cells with no item label

    const item = collapseWhitespace(label);
    for (const [col, result] of tfValues) {
      const pair = colPairs.get(col)!;
      rows.push({
        month: pair.month,
        standard_type: tab.type,
        category: currentCategory,
        item,
        location: pair.location,
        result,
      });
    }
  }

  return { rows, blocks: blocks.length, skippedBlocks };
}

// ── Public entry point ───────────────────────────────────────────────────────

/**
 * Fetch all 8 tabs, parse, and return deduplicated rows + warnings.
 * Dedupe key = (month, standard_type, item, location); last write wins —
 * tabs are processed oldest-era → newest-era so corrected/re-entered data in
 * newer tabs overrides stale copies in older ones.
 */
export async function buildBrandStandards(): Promise<BrandStandardsResult> {
  const warnings: string[] = [];
  const tabs: TabSummary[] = [];

  const rawTabs = await Promise.all(TABS.map((t) => fetchTab(t)));

  const deduped = new Map<string, BrandStandardRow>();
  for (let i = 0; i < TABS.length; i++) {
    const tab = TABS[i];
    const { rows, blocks, skippedBlocks } = parseTab(rawTabs[i], tab, warnings);
    for (const row of rows) {
      deduped.set(`${row.month}|${row.standard_type}|${row.item}|${row.location}`, row);
    }
    tabs.push({ tab: tab.name, type: tab.type, blocks, skipped_blocks: skippedBlocks, rows: rows.length });
  }

  // Final pass: drop (location, month, standard_type) groups that are 100%
  // FALSE with >= MIN_GROUP_FOR_ALL_FALSE items — unfilled checklist templates
  // masquerading as real 0% scores (see header doc). Judged per location-month
  // AFTER cross-tab dedupe so a group is only kept if it has a TRUE anywhere.
  const groups = new Map<string, { trueCount: number; total: number }>();
  for (const row of deduped.values()) {
    const key = `${row.standard_type}|${row.month}|${row.location}`;
    const g = groups.get(key) ?? { trueCount: 0, total: 0 };
    g.total++;
    if (row.result) g.trueCount++;
    groups.set(key, g);
  }
  const excludedGroups = new Set<string>();
  for (const [key, g] of groups) {
    if (g.trueCount === 0 && g.total >= MIN_GROUP_FOR_ALL_FALSE) {
      excludedGroups.add(key);
      const [type, month, location] = key.split("|");
      warnings.push(
        `Excluded ${type} ${month} ${location}: all ${g.total} items FALSE — ` +
        `treated as unfilled template (not assessed), not a real 0% score`
      );
    }
  }

  const rows = Array.from(deduped.values()).filter(
    (row) => !excludedGroups.has(`${row.standard_type}|${row.month}|${row.location}`)
  );

  return { rows, warnings, tabs };
}
