import { NextRequest, NextResponse } from "next/server";
import { getAdminClient } from "@/lib/supabase/admin";

const SHEET_ID = "1AAnfm-SAYso6RpJhbdhJbTbcGDH1Ftlk0FHBPHfN98w";

// Map spa names (as written in column C) to Supabase location slugs
const SPA_NAME_TO_SLUG: Record<string, string | null> = {
  intercontinental: "inter",
  inter: "inter",
  "hugo's": "hugos",
  hugos: "hugos",
  hugo: "hugos",
  hyatt: "hyatt",
  ramla: "ramla",
  "ramla bay": "ramla",
  labranda: "labranda",
  lamranda: "labranda",
  riviera: "labranda",
  "sunny coast": "odycy",
  sunnycoast: "odycy",
  "suny coast": "odycy",
  odycy: "odycy",
  excelsior: "excelsior",
  novotel: "novotel",
  // Non-SPA brands — still valid slugs
  centre: "hq",
  center: "hq",
  aesthetics: "aesthetics",
  aesthtics: "aesthetics",
  slimming: "slimming",
  slim: "slimming",
};

function spaNameToSlug(raw: string): string | null | undefined {
  const key = raw.toLowerCase().trim();
  if (key === "") return undefined; // not in map at all
  return SPA_NAME_TO_SLUG[key] ?? undefined;
}

// Build the Google Sheet tab name for a given month
// 2025 tabs use the full month name ("January 25 (C)"); 2026+ tabs use the
// abbreviation ("Mar 26 (C)"). gviz silently returns a wrong tab when the
// name doesn't match exactly, so order matters per year.
function tabNamesForMonth(year: number, month: number): string[] {
  const abbrevs = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
  const fulls   = ["January","February","March","April","May","June","July","August","September","October","November","December"];
  const yy = String(year).slice(2);
  const abbr = abbrevs[month - 1];
  const full = fulls[month - 1];
  if (year <= 2025) {
    return [`${full} ${yy} (C)`, `${abbr} ${yy} (C)`];
  }
  return [`${abbr} ${yy} (C)`, `${full} ${yy} (C)`];
}

async function fetchSheetCsv(tabName: string): Promise<string | null> {
  const encoded = encodeURIComponent(tabName);
  const url = `https://docs.google.com/spreadsheets/d/${SHEET_ID}/gviz/tq?tqx=out:csv&sheet=${encoded}`;
  const res = await fetch(url, { redirect: "follow" });
  if (!res.ok) return null;
  const text = await res.text();
  // gviz returns an error page if sheet not found (not a 404)
  if (text.startsWith("<!") || text.includes("google.visualization.Query.setResponse")) return null;
  return text;
}

function parseAmount(raw: string): number {
  const cleaned = raw.replace(/[£€$,\s]/g, "");
  const val = parseFloat(cleaned);
  return isNaN(val) ? 0 : val;
}

function parseCsvLine(line: string): string[] {
  const result: string[] = [];
  let current = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      if (inQuotes && line[i + 1] === '"') { current += '"'; i++; }
      else inQuotes = !inQuotes;
    } else if (ch === "," && !inQuotes) {
      result.push(current);
      current = "";
    } else {
      current += ch;
    }
  }
  result.push(current);
  return result;
}

export async function POST(req: NextRequest) {
  const supabase = getAdminClient();
  const body = await req.json();
  const { month, debug } = body; // debug=true returns parsed rows without writing
  if (!month) return NextResponse.json({ error: "month required" }, { status: 400 });

  const [year, mo] = month.split("-").map(Number);
  const tabNames = tabNamesForMonth(year, mo);

  // Try each candidate tab name. gviz silently returns the wrong tab on a name
  // miss, so we treat "no Active employee header" as a miss and try the next.
  let lines: string[] = [];
  let dataStartIdx = -1;
  let statusCol = 3;
  let usedTab = "";
  const triedPreviews: string[] = [];

  for (const tab of tabNames) {
    const csv = await fetchSheetCsv(tab);
    if (!csv) continue;
    const candidateLines = csv.split("\n").filter(Boolean);
    for (let i = 0; i < Math.min(candidateLines.length, 30); i++) {
      const cols = parseCsvLine(candidateLines[i]);
      const idx = cols.findIndex((c, ci) => ci >= 2 && ci <= 6 && c?.trim().toLowerCase() === "active employee");
      if (idx !== -1) {
        dataStartIdx = i + 1;
        statusCol = idx;
        lines = candidateLines;
        usedTab = tab;
        break;
      }
    }
    if (dataStartIdx !== -1) break;
    triedPreviews.push(`[${tab}] row0: ${candidateLines[0]?.slice(0, 80) ?? "(empty)"}`);
  }

  if (dataStartIdx === -1) {
    return NextResponse.json(
      { error: `Could not locate employee header row. Tried tabs: ${triedPreviews.join(" | ")}` },
      { status: 422 }
    );
  }

  // Amount column varies by sheet layout:
  //  - 2025 tabs: status at col D (3), cash at col X (23)
  //  - 2026 tabs: status at col E (4), cash at col AC (28)
  const amountCol = statusCol === 3 ? 23 : 28;

  const employees: {
    employee_name: string;
    talexio_id: number | null;
    talexio_name: string | null;
    amount: number;
    spa_slug: string | null;
    month: string;
  }[] = [];

  const excluded: string[] = [];

  for (let i = dataStartIdx; i < lines.length; i++) {
    const cols = parseCsvLine(lines[i]);
    const name   = cols[1]?.trim() ?? "";            // B
    const spaRaw = cols[2]?.trim() ?? "";            // C — location
    const status = cols[statusCol]?.trim() ?? "";    // Active employee (dynamic col)
    const amtRaw = cols[amountCol]?.trim() ?? "";    // 2025: X(23), 2026: AC(28)

    if (!name || status.toLowerCase() !== "active") continue;

    const amount = parseAmount(amtRaw);
    if (amount <= 0) continue;

    const slugResult = spaNameToSlug(spaRaw);

    // null means explicitly excluded (Centre/Aesthetics/Slimming)
    if (slugResult === null) {
      excluded.push(`${name} (${spaRaw})`);
      continue;
    }

    // undefined means unknown spa — include with null slug so user can assign
    employees.push({
      employee_name: name,
      talexio_id: null,
      talexio_name: null,
      amount,
      spa_slug: slugResult ?? null,
      month,
    });
  }

  if (employees.length === 0) {
    // Return header row + first 3 data rows to diagnose column layout
    const headerCols = parseCsvLine(lines[dataStartIdx - 1]);
    const sampleRows = lines.slice(dataStartIdx, dataStartIdx + 3).map(l => parseCsvLine(l));
    return NextResponse.json({
      synced: 0, excluded, tab: usedTab, statusCol,
      header: headerCols.map((h, i) => `[${i}] ${h}`),
      sample: sampleRows.map(r => r.map((v, i) => `[${i}] ${v}`)),
    });
  }

  if (debug) {
    const total = employees.reduce((s, e) => s + e.amount, 0);
    return NextResponse.json({ debug: true, statusCol, count: employees.length, total, employees, excluded });
  }

  // Delete existing unfrozen rows for this month, then insert fresh
  await supabase
    .from("salary_supplement_monthly")
    .delete()
    .eq("month", month)
    .eq("is_frozen", false);

  const { error } = await supabase
    .from("salary_supplement_monthly")
    .upsert(
      employees.map(e => ({ ...e, is_frozen: false, synced_at: new Date().toISOString() })),
      { onConflict: "month,employee_name", ignoreDuplicates: false }
    );

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ synced: employees.length, excluded, tab: usedTab });
}
