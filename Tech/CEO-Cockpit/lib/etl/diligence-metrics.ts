/**
 * Diligence Metrics ETL
 *
 * Auto-computes three diligence audit metrics directly from the Cockpit
 * datasheet "Service - Spa" tab — no manual Accounting Master entry needed.
 *
 * DEFINITIONS (verified by QC agent, May 2026):
 *   cash_sales      = SUM(Unit Price) WHERE PaymentType="Cash" AND SalesStatus="Sold"
 *                     — total revenue collected in cash
 *
 *   discounted_cash = SUM(Unit Price) WHERE PaymentType="Cash" AND Discount(%)>0 AND SalesStatus="Sold"
 *                     — total revenue from cash transactions that carried a discount
 *                     — divided by total_sales gives the governance risk metric (<5% threshold)
 *
 *   complimentary   = SUM(Unit Price) WHERE PaymentType="Payment Center" AND SalesStatus="Sold"
 *                     — "Payment Center" is the CSV export value for what the Lapis POS UI
 *                       labels "Open Account" — these are complimentary/hotel-account treatments
 *
 * Source: Cockpit datasheet (Excel), "Service - Spa" tab (GID 1281126329).
 * Fetched zero-auth via CSV export — no OAuth, no refresh tokens.
 *
 * Output: one row per (month, location_id). Upserted into `diligence_audit`,
 * overwriting only the three computed columns. total_sales, deleted_cancelled,
 * and unattended_count are left untouched (they come from the Accounting Master).
 */

import { parseCSV } from "./csv";
import { COCKPIT_SHEET_ID, COCKPIT_TABS } from "../constants/cockpit-sheets";

const SERVICE_GID = COCKPIT_TABS.SPA_SERVICES.gid;

// Sales Point (uppercased) → location_id — must match cockpit-revenue.ts
const LOCATION_MAP: Record<string, number> = {
  "HUGOS":                        2,
  "INTER":                        1,
  "RAMLA":                        4,
  "SUNNY COAST":                  6,
  "SALES POINT OF EXCELSIOR":     7,
  "HYATT":                        3,
  "LABRANDA GENERAL SALES POINT": 5,
  "SALES POINT OF NOV":           8,
};

const BRAND_ID = 1;

function parseMonthKey(raw: string): string | null {
  const s = raw.trim();
  if (!s) return null;
  // D/M/YYYY  or  D/M/YY
  const slash = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/);
  if (slash) {
    const [, d, m, yRaw] = slash;
    const y = +yRaw < 100 ? 2000 + +yRaw : +yRaw;
    if (+m >= 1 && +m <= 12 && +d >= 1) {
      return `${y}-${String(+m).padStart(2, "0")}-01`;
    }
  }
  // YYYY-MM-DD
  const iso = s.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (iso) return `${iso[1]}-${iso[2]}-01`;
  // D Month YYYY  (e.g. "4 June 2026")
  const dmy = s.match(/^(\d{1,2})\s+([A-Za-z]+)\s+(\d{4})$/);
  if (dmy) {
    const MONTHS: Record<string, string> = {
      january:"01",february:"02",march:"03",april:"04",may:"05",june:"06",
      july:"07",august:"08",september:"09",october:"10",november:"11",december:"12",
      jan:"01",feb:"02",mar:"03",apr:"04",jun:"06",jul:"07",aug:"08",
      sep:"09",oct:"10",nov:"11",dec:"12",
    };
    const m = MONTHS[dmy[2].toLowerCase()];
    if (m) return `${dmy[3]}-${m}-01`;
  }
  return null;
}

function safeFloat(val: string): number {
  return parseFloat(String(val).replace(/,/g, "").trim()) || 0;
}

export interface DiligenceMetricsRow {
  month: string;
  location_id: number;
  brand_id: number;
  cash_sales: number;
  discounted_cash: number;
  complimentary: number;
}

export async function computeDiligenceMetrics(): Promise<{
  rows: DiligenceMetricsRow[];
  months: string[];
  warnings: string[];
}> {
  const warnings: string[] = [];

  const url = `https://docs.google.com/spreadsheets/d/${COCKPIT_SHEET_ID}/gviz/tq?tqx=out:csv&gid=${SERVICE_GID}`;
  const resp = await fetch(url, { redirect: "follow" });
  if (!resp.ok) {
    throw new Error(
      `Cockpit Service-Spa CSV fetch failed: ${resp.status} — check sheet is shared "Anyone with the link can view"`
    );
  }
  const text = await resp.text();
  const rawRows = parseCSV(text);
  if (rawRows.length < 2) return { rows: [], months: [], warnings: ["Empty CSV"] };

  // Skip any leading title rows (same heuristic as cockpit-revenue.ts)
  let headerIdx = 0;
  for (let i = 0; i < Math.min(rawRows.length, 5); i++) {
    if (rawRows[i].filter((c) => c.trim()).length >= 3) { headerIdx = i; break; }
  }
  const headers = rawRows[headerIdx];
  const dataRows = rawRows.slice(headerIdx + 1).map((cells) =>
    Object.fromEntries(headers.map((h, i) => [h.trim(), (cells[i] ?? "").trim()]))
  );

  type Acc = { cash: number; discCash: number; comp: number };
  const acc = new Map<string, Acc>();

  let skippedNoDate = 0, skippedNoLoc = 0;

  for (const row of dataRows) {
    // Only count "Sold" transactions
    const status = (row["Sales Status"] ?? "").trim().toLowerCase();
    if (status !== "sold") continue;

    // Resolve month from Service Date (preferred) or Sales Date
    const dateRaw = row["Service Date"] || row["Sales Date"] || "";
    const mk = parseMonthKey(dateRaw);
    if (!mk) { skippedNoDate++; continue; }

    // Resolve location
    const sp = (row["Sales Point"] ?? "").trim().toUpperCase();
    const locationId = LOCATION_MAP[sp];
    if (!locationId) { skippedNoLoc++; continue; }

    const key = `${mk}|${locationId}`;
    if (!acc.has(key)) acc.set(key, { cash: 0, discCash: 0, comp: 0 });
    const bucket = acc.get(key)!;

    const unitPrice  = safeFloat(row["Unit Price"]  ?? "0");
    const discountPct = safeFloat(row["Discount (%)"] ?? "0");
    const payType    = (row["Payment Type"] ?? "").trim();

    if (payType === "Cash") {
      bucket.cash += unitPrice;
      if (discountPct > 0) bucket.discCash += unitPrice;
    }

    // Complimentary: "Payment Center" rows only.
    // QC verified this matches the Accounting Master figures exactly (May 2026).
    // "Open Account" rows also exist but accounting does NOT include them in
    // the complimentary total — they represent a separate internal billing
    // category not yet tracked in the diligence audit.
    if (payType === "Payment Center") {
      bucket.comp += unitPrice;
    }
  }

  if (skippedNoDate > 0)
    warnings.push(`${skippedNoDate} rows skipped — unparseable Service Date`);
  if (skippedNoLoc > 0)
    warnings.push(`${skippedNoLoc} rows skipped — unmapped Sales Point`);

  const rows: DiligenceMetricsRow[] = Array.from(acc.entries()).map(([key, v]) => {
    const [month, locStr] = key.split("|");
    return {
      month,
      location_id: parseInt(locStr, 10),
      brand_id: BRAND_ID,
      cash_sales:      Math.round(v.cash    * 100) / 100,
      discounted_cash: Math.round(v.discCash * 100) / 100,
      complimentary:   Math.round(v.comp    * 100) / 100,
    };
  }).sort((a, b) => a.month.localeCompare(b.month) || a.location_id - b.location_id);

  const months = Array.from(new Set(rows.map((r) => r.month))).sort();
  return { rows, months, warnings };
}
