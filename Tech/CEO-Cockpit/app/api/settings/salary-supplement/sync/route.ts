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
// Pattern: "Mar 26 (C)", "Feb 26 (C)", "April 25 (C)", "July 25 (C)"
function tabNamesForMonth(year: number, month: number): string[] {
  const abbrevs = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
  const fulls   = ["January","February","March","April","May","June","July","August","September","October","November","December"];
  const yy = String(year).slice(2);
  const abbr = abbrevs[month - 1];
  const full = fulls[month - 1];
  return [
    `${abbr} ${yy} (C)`,
    `${full} ${yy} (C)`,
  ];
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
  const { month } = await req.json(); // "2026-03-01"
  if (!month) return NextResponse.json({ error: "month required" }, { status: 400 });

  const [year, mo] = month.split("-").map(Number);
  const tabNames = tabNamesForMonth(year, mo);

  let csv: string | null = null;
  let usedTab = "";
  for (const tab of tabNames) {
    csv = await fetchSheetCsv(tab);
    if (csv) { usedTab = tab; break; }
  }

  if (!csv) {
    return NextResponse.json(
      { error: `No sheet tab found for ${month}. Tried: ${tabNames.join(", ")}` },
      { status: 404 }
    );
  }

  const lines = csv.split("\n").filter(Boolean);
  // Find the header row — look for "Active employee" (case-insensitive) in any
  // of the first 30 rows, checking columns C-F (indices 2-5) to handle layout shifts.
  let dataStartIdx = -1;
  for (let i = 0; i < Math.min(lines.length, 30); i++) {
    const cols = parseCsvLine(lines[i]);
    const found = cols.slice(2, 6).some(c => c?.trim().toLowerCase() === "active employee");
    if (found) { dataStartIdx = i + 1; break; }
  }
  if (dataStartIdx === -1) {
    // Return first 5 rows to help diagnose the sheet layout
    const preview = lines.slice(0, 5).map((l, i) => `row${i}: ${l.slice(0, 120)}`).join(" | ");
    return NextResponse.json(
      { error: `Could not locate employee header row in sheet (tab: ${usedTab}). Preview: ${preview}` },
      { status: 422 }
    );
  }

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
    const name   = cols[1]?.trim() ?? "";   // B
    const spaRaw = cols[2]?.trim() ?? "";   // C — location
    const status = cols[3]?.trim() ?? "";   // D
    const amtRaw = cols[27]?.trim() ?? "";  // AB

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
    return NextResponse.json({ synced: 0, excluded, tab: usedTab });
  }

  // For employees whose column C didn't map to a known slug, carry forward
  // their existing allocation: first from THIS month (preserves manual overrides
  // on re-sync), then from the most recent prior month (helps with new months).
  const unassigned = employees.filter((e) => !e.spa_slug);
  if (unassigned.length > 0) {
    const unassignedNames = unassigned.map((e) => e.employee_name);

    // Current month's existing allocations (manual overrides take priority)
    const { data: currentRows } = await supabase
      .from("salary_supplement_monthly")
      .select("employee_name, spa_slug")
      .in("employee_name", unassignedNames)
      .eq("month", month)
      .not("spa_slug", "is", null);

    const currentMap = new Map<string, string>();
    if (currentRows) {
      for (const r of currentRows) {
        if (r.spa_slug) currentMap.set(r.employee_name, r.spa_slug);
      }
    }

    // Prior month fallback for employees not yet assigned this month
    const needsPrior = unassignedNames.filter((n) => !currentMap.has(n));
    const priorMap = new Map<string, string>();
    if (needsPrior.length > 0) {
      const { data: priorRows } = await supabase
        .from("salary_supplement_monthly")
        .select("employee_name, spa_slug, month")
        .in("employee_name", needsPrior)
        .neq("month", month)
        .not("spa_slug", "is", null)
        .order("month", { ascending: false });

      if (priorRows) {
        for (const r of priorRows) {
          if (!priorMap.has(r.employee_name) && r.spa_slug) {
            priorMap.set(r.employee_name, r.spa_slug);
          }
        }
      }
    }

    for (const emp of employees) {
      if (!emp.spa_slug) {
        emp.spa_slug = currentMap.get(emp.employee_name) ?? priorMap.get(emp.employee_name) ?? null;
      }
    }
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
