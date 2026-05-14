import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

const SHEET_ID = "1AAnfm-SAYso6RpJhbdhJbTbcGDH1Ftlk0FHBPHfN98w";

// Map spa names (as written in column BM) to Supabase location slugs
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
  "sunny coast": "odycy",
  sunnycoast: "odycy",
  "suny coast": "odycy",
  odycy: "odycy",
  excelsior: "excelsior",
  novotel: "novotel",
  // Exclude these — not SPA locations
  centre: "centre",
  center: "centre",
  aesthetics: "aesthetics",
  aesthtics: "aesthetics",
  slimming: null,
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

// ── Talexio helpers ───────────────────────────────────────────────────────────

const TALEXIO_GQL = "https://api.talexiohr.com/graphql";
const TALEXIO_ORIGIN = "https://carismaspawellness.talexiohr.com";

async function fetchTalexioNameMap(): Promise<Map<number, string>> {
  const token = process.env.TALEXIO_TOKEN;
  if (!token) return new Map();
  try {
    const res = await fetch(TALEXIO_GQL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
        Origin: TALEXIO_ORIGIN,
      },
      body: JSON.stringify({ query: `query { employees { employeeCode fullName } }` }),
    });
    if (!res.ok) return new Map();
    const json = await res.json();
    const emps: { employeeCode: string; fullName: string }[] = json?.data?.employees ?? [];
    const map = new Map<number, string>();
    for (const e of emps) {
      const code = parseInt(e.employeeCode, 10);
      if (!isNaN(code) && e.fullName) map.set(code, e.fullName);
    }
    return map;
  } catch {
    return new Map();
  }
}

export async function POST(req: NextRequest) {
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
    const status = cols[3]?.trim() ?? "";   // D
    const amtRaw = cols[27]?.trim() ?? "";  // AB
    const spaRaw = cols[64]?.trim() ?? "";  // BM
    const empRaw = cols[65]?.trim() ?? "";  // BN

    if (!name || status.toLowerCase() !== "active") continue;

    const amount = parseAmount(amtRaw);
    if (amount <= 0) continue;

    const talexioId = empRaw && /^\d+$/.test(empRaw) ? parseInt(empRaw, 10) : null;
    const slugResult = spaNameToSlug(spaRaw);

    // null means explicitly excluded (Centre/Aesthetics)
    if (slugResult === null) {
      excluded.push(`${name} (${spaRaw})`);
      continue;
    }

    // undefined means unknown spa — include with null slug so user can assign
    employees.push({
      employee_name: name,
      talexio_id: talexioId,
      talexio_name: null,
      amount,
      spa_slug: slugResult ?? null,
      month,
    });
  }

  if (employees.length === 0) {
    return NextResponse.json({ synced: 0, excluded, tab: usedTab });
  }

  // Carry forward spa, talexio_id, talexio_name from the most recent other month
  // so users don't need to re-map every month and emp numbers missing from older tabs are filled in
  const employeeNames = employees.map((e) => e.employee_name);
  const { data: priorRows } = await supabase
    .from("salary_supplement_monthly")
    .select("employee_name, spa_slug, talexio_id, talexio_name, month")
    .in("employee_name", employeeNames)
    .neq("month", month)
    .order("month", { ascending: false });

  if (priorRows && priorRows.length > 0) {
    type Prior = { spa_slug: string | null; talexio_id: number | null; talexio_name: string | null };
    const priorMap = new Map<string, Prior>();
    for (const r of priorRows) {
      if (!priorMap.has(r.employee_name)) {
        priorMap.set(r.employee_name, {
          spa_slug:     r.spa_slug,
          talexio_id:   r.talexio_id,
          talexio_name: r.talexio_name,
        });
      }
    }
    for (const emp of employees) {
      const prior = priorMap.get(emp.employee_name);
      if (!prior) continue;
      if (prior.spa_slug)                          emp.spa_slug     = prior.spa_slug;
      if (!emp.talexio_id   && prior.talexio_id)   emp.talexio_id   = prior.talexio_id;
      if (!emp.talexio_name && prior.talexio_name) emp.talexio_name = prior.talexio_name;
    }
  }

  // Enrich with Talexio names where employee number is available
  const talexioNames = await fetchTalexioNameMap();
  if (talexioNames.size > 0) {
    for (const emp of employees) {
      if (emp.talexio_id && talexioNames.has(emp.talexio_id)) {
        emp.talexio_name = talexioNames.get(emp.talexio_id)!;
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
