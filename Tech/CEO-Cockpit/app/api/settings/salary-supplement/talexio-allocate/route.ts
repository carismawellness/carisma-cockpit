import { NextRequest, NextResponse } from "next/server";
import { getAdminClient } from "@/lib/supabase/admin";

export const maxDuration = 120;

const TALEXIO_GQL    = "https://api.talexiohr.com/graphql";
const TALEXIO_ORIGIN = "https://carismaspawellness.talexiohr.com";

// Map Talexio organisationUnit.name → spa_slug
const UNIT_TO_SLUG: Record<string, string> = {
  intercontinental: "inter",
  inter:            "inter",
  "hugo's":         "hugos",
  hugos:            "hugos",
  hugo:             "hugos",
  hyatt:            "hyatt",
  ramla:            "ramla",
  "ramla bay":      "ramla",
  labranda:         "labranda",
  "sunny coast":    "odycy",
  sunnycoast:       "odycy",
  odycy:            "odycy",
  excelsior:        "excelsior",
  novotel:          "novotel",
  aesthetics:       "aesthetics",
  aesthtics:        "aesthetics",
  slimming:         "slimming",
  centre:           "hq",
  center:           "hq",
  "head office":    "hq",
  management:       "hq",
  central:          "hq",
};

function unitToSlug(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const key = raw.toLowerCase().trim();
  // Exact match first
  if (key in UNIT_TO_SLUG) return UNIT_TO_SLUG[key];
  // Partial match — find first entry whose key appears in the unit name
  for (const [k, slug] of Object.entries(UNIT_TO_SLUG)) {
    if (key.includes(k) || k.includes(key)) return slug;
  }
  return null;
}

// ── Simple fuzzy name matching ────────────────────────────────────────────────
// Normalise: lowercase, collapse spaces, strip punctuation
function normalise(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9\s]/g, "").replace(/\s+/g, " ").trim();
}

// Token-overlap score: what % of the shorter name's tokens appear in the longer
function nameSimilarity(a: string, b: string): number {
  const ta = new Set(normalise(a).split(" ").filter(Boolean));
  const tb = new Set(normalise(b).split(" ").filter(Boolean));
  if (ta.size === 0 || tb.size === 0) return 0;
  let overlap = 0;
  for (const t of ta) { if (tb.has(t)) overlap++; }
  return overlap / Math.min(ta.size, tb.size);
}

interface TalexioEmployee {
  id:              number;
  employeeCode:    string;
  fullName:        string;
  isTerminated:    boolean;
  organisationUnit: string | null; // resolved from currentPositionSimple
}

async function fetchTalexioEmployees(): Promise<TalexioEmployee[]> {
  const token = process.env.TALEXIO_TOKEN;
  if (!token) return [];
  try {
    const res = await fetch(TALEXIO_GQL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
        Origin: TALEXIO_ORIGIN,
      },
      body: JSON.stringify({
        query: `query {
          employees {
            id
            employeeCode
            fullName
            isTerminated
            currentPositionSimple {
              isEnded
              organisationUnit { name }
            }
          }
        }`,
      }),
    });
    if (!res.ok) return [];
    const json = await res.json();
    const raw = json?.data?.employees ?? [];
    return raw.map((e: {
      id: number;
      employeeCode: string;
      fullName: string;
      isTerminated: boolean;
      currentPositionSimple?: { isEnded: boolean; organisationUnit?: { name: string } } | null;
    }) => ({
      id:              e.id,
      employeeCode:    e.employeeCode,
      fullName:        e.fullName,
      isTerminated:    e.isTerminated,
      organisationUnit: e.currentPositionSimple?.organisationUnit?.name ?? null,
    }));
  } catch {
    return [];
  }
}

// POST { month: "2026-04-01", force?: boolean }
// force=false (default): only fill in rows where spa_slug is currently null
// force=true: overwrite all rows
export async function POST(req: NextRequest) {
  const supabase = getAdminClient();
  const { month, force = false } = await req.json();
  if (!month) return NextResponse.json({ error: "month required" }, { status: 400 });

  // Fetch supplement rows for this month
  const { data: rows, error: rowErr } = await supabase
    .from("salary_supplement_monthly")
    .select("id, employee_name, talexio_id, talexio_name, spa_slug, is_frozen")
    .eq("month", month)
    .eq("is_frozen", false);

  if (rowErr) return NextResponse.json({ error: rowErr.message }, { status: 500 });
  if (!rows || rows.length === 0) return NextResponse.json({ allocated: 0, skipped: 0, unmatched: [] });

  // Fetch all active employees from Talexio
  const talexioEmps = await fetchTalexioEmployees();
  if (talexioEmps.length === 0) {
    return NextResponse.json({ error: "Could not fetch employees from Talexio — check TALEXIO_TOKEN" }, { status: 502 });
  }

  // Build lookup by employee code for fast exact match
  const byCode = new Map<number, TalexioEmployee>();
  for (const e of talexioEmps) {
    const code = parseInt(e.employeeCode, 10);
    if (!isNaN(code)) byCode.set(code, e);
  }

  const updates: { id: number; spa_slug: string }[] = [];
  const unmatched: string[] = [];

  for (const row of rows) {
    // Skip if already assigned and not forcing
    if (!force && row.spa_slug) continue;

    // 1. Exact match by talexio_id (employee number)
    let emp: TalexioEmployee | undefined;
    if (row.talexio_id) emp = byCode.get(row.talexio_id);

    // 2. Fuzzy name match against fullName — use best scoring candidate ≥ 0.6
    if (!emp) {
      const searchName = row.talexio_name || row.employee_name;
      let bestScore = 0;
      let bestEmp: TalexioEmployee | undefined;
      for (const e of talexioEmps) {
        const score = nameSimilarity(searchName, e.fullName);
        if (score > bestScore) { bestScore = score; bestEmp = e; }
      }
      if (bestScore >= 0.6) emp = bestEmp;
    }

    if (!emp) {
      unmatched.push(row.employee_name);
      continue;
    }

    const slug = unitToSlug(emp.organisationUnit);
    if (!slug) {
      unmatched.push(`${row.employee_name} (unit: ${emp.organisationUnit ?? "unknown"})`);
      continue;
    }

    updates.push({ id: row.id, spa_slug: slug });
  }

  // Apply updates
  let allocated = 0;
  for (const u of updates) {
    const { error } = await supabase
      .from("salary_supplement_monthly")
      .update({ spa_slug: u.spa_slug })
      .eq("id", u.id);
    if (!error) allocated++;
  }

  const skipped = rows.length - updates.length - unmatched.length;

  return NextResponse.json({ allocated, skipped, unmatched });
}
