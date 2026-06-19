import { NextRequest, NextResponse } from "next/server";

// POST /api/etl/fix-sga-sublines
//
// One-shot fix: patches ebitda_sub_line on existing transactions_raw rows
// using the same keyword rules as resolveSubLine() in the ETL files.
// Faster than re-running the full ETL — SPA has too many transactions to
// process within Vercel's 300s limit.

function sbUrl(table: string): string {
  const base = process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL!;
  return `${base}/rest/v1/${table}`;
}
function sbHeaders(): Record<string, string> {
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY!;
  return { apikey: key, Authorization: `Bearer ${key}`, "Content-Type": "application/json", Prefer: "return=representation" };
}

async function patchWhere(filters: string, body: Record<string, unknown>): Promise<number> {
  const resp = await fetch(`${sbUrl("transactions_raw")}?${filters}`, {
    method: "PATCH",
    headers: sbHeaders(),
    body: JSON.stringify(body),
  });
  if (!resp.ok) throw new Error(`PATCH failed ${resp.status}: ${await resp.text()}`);
  const rows = await resp.json() as unknown[];
  return rows.length;
}

// PostgREST OR filter checking both account_name and contact_name.
// Some vendors (e.g. Fresha) use generic COA accounts ("Service Charges") so the
// vendor name (contact_name) is the only reliable classification signal.
function orFilter(patterns: string[]): string {
  const parts = [
    ...patterns.map(p => `account_name.ilike.*${p}*`),
    ...patterns.map(p => `contact_name.ilike.*${p}*`),
  ];
  return "or=(" + parts.join(",") + ")";
}

const TRAVEL_KEYWORDS = [
  "travel", "transport", "flight", "hotel", "accommodation",
  "taxi", "uber", "airbnb", "parking", "car hire", "car rental",
  "vehicle hire", "airline", "airways", "transfer expense",
];
const SOFTWARE_KEYWORDS = [
  "software", "subscription", "saas", "license", "licence",
  "system", "fresha",
];
const FUEL_KEYWORDS      = ["fuel", "petrol", "diesel", "gas station"];
const LAUNDRY_KEYWORDS   = ["laundry", "linen", "uniform"];
const CLEANING_KEYWORDS  = ["clean", "hygiene", "sanitiz", "pest"];
const INSURANCE_KEYWORDS = ["insur"];
const EVENTS_KEYWORDS    = ["event", "function", "catering", "hospitality"];
const MAINT_KEYWORDS     = ["maintenance", "repair", "service contract"];
const TELECOM_KEYWORDS   = ["telecom", "telephone", "mobile", "internet", "broadband", "phone"];
const PROF_KEYWORDS      = ["professional", "legal", "audit", "accounting", "consultant", "advisory"];

interface FixResult { subLine: string; org: string; updated: number }

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({})) as Record<string, unknown>;
  const orgs: string[] = (body.orgs as string[]) ?? ["spa", "aesthetics", "slimming"];

  const results: FixResult[] = [];
  const log: string[] = [];

  for (const org of orgs) {
    const baseFilter = `org=eq.${org}&ebitda_line=eq.sga`;
    const fixes: [string[], string][] = [
      [TRAVEL_KEYWORDS,    "travel"],
      [SOFTWARE_KEYWORDS,  "software"],
      [FUEL_KEYWORDS,      "fuel"],
      [LAUNDRY_KEYWORDS,   "laundry"],
      [CLEANING_KEYWORDS,  "cleaning"],
      [INSURANCE_KEYWORDS, "insurance"],
      [EVENTS_KEYWORDS,    "events"],
      [MAINT_KEYWORDS,     "maintenance"],
      [TELECOM_KEYWORDS,   "telecom"],
      [PROF_KEYWORDS,      "prof_services"],
    ];

    for (const [keywords, subLine] of fixes) {
      try {
        // Only update rows that are currently wrong (not already this subLine)
        const filter = `${baseFilter}&ebitda_sub_line=neq.${subLine}&${orFilter(keywords)}`;
        const updated = await patchWhere(filter, { ebitda_sub_line: subLine });
        results.push({ subLine, org, updated });
        if (updated) log.push(`${org} → ${subLine}: ${updated} row(s) updated`);
      } catch (e) {
        log.push(`ERROR ${org} → ${subLine}: ${e}`);
      }
    }
  }

  const totalUpdated = results.reduce((s, r) => s + r.updated, 0);
  log.push(`Done — ${totalUpdated} total row(s) updated`);
  return NextResponse.json({ status: "ok", total_updated: totalUpdated, details: results, log });
}
