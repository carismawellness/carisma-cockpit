/**
 * /api/finance/practitioner-productivity
 *
 * Joins per-employee salary cost (Zoho wages + frozen salary supplements,
 * period-prorated) with per-practitioner revenue (Spa employee services,
 * Aesthetics sales note_person, Slimming treatments therapist) and emits
 * K% = salary / revenue * 100 per practitioner per brand.
 *
 * Role filter: only therapists + practitioners are returned. Managers,
 * reception, CRM, unassigned, and HQ staff are excluded.
 *
 * Name matching:
 *   1. practitioner_name_aliases table (manual overrides)
 *   2. Exact normalized-name match
 *   3. Token fallback: revenue base-name (venue suffix stripped) matched
 *      against any token of the Zoho salary name within the same venue.
 *      Only resolves when exactly one salary candidate matches (unambiguous).
 *
 * Query params (both required, YYYY-MM-DD):
 *   date_from, date_to
 */

import { NextResponse } from "next/server";
import { getAdminClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

// ── Venue config ─────────────────────────────────────────────────────────────
const SPA_VENUES = ["intercontinental","hugos","hyatt","ramla","labranda","sunny_coast","excelsior","novotel"];
const ALL_VENUES = [...SPA_VENUES, "aesthetics", "slimming"];
const LOC_ID_TO_SLUG: Record<number, string> = {
  1: "intercontinental",
  2: "hugos",
  3: "hyatt",
  4: "ramla",
  5: "labranda",
  6: "sunny_coast",
  7: "excelsior",
  8: "novotel",
};
const PRODUCTIVE_ROLES = new Set(["therapist", "practitioner"]);

// Minimum token length to avoid matching noise words ("de", "ni", "la", etc.)
const MIN_TOKEN_LEN = 4;

// ── Helpers ──────────────────────────────────────────────────────────────────
function norm(s: string): string {
  return (s || "").toLowerCase().trim().replace(/\s+/g, " ");
}

/**
 * Strip location suffix that Spa sheet appends to therapist names.
 * Examples:  "TINA-HUGOS" → "tina"
 *            "BLAGOJCHE-INTER" → "blagojche"
 *            "Juliana D.-Ramla" → "juliana d."
 *            "Lovely-Hugo" → "lovely"
 *            "PHACHA" → "phacha" (no suffix, unchanged)
 */
function stripVenueSuffix(rawName: string): string {
  const s = (rawName || "").trim();
  const dashIdx = s.indexOf("-");
  return norm(dashIdx > 0 ? s.slice(0, dashIdx) : s);
}

function parseLocal(s: string): Date {
  const [y, m, d] = s.split("-").map(Number);
  return new Date(y, m - 1, d);
}

function daysBetween(a: string, b: string): number {
  return Math.round((parseLocal(b).getTime() - parseLocal(a).getTime()) / 86_400_000) + 1;
}

// ── Response type ────────────────────────────────────────────────────────────
type Row = {
  employee_name: string;
  venue: string;
  role: string;
  salary: number;
  revenue: number;
  k_pct: number | null;
  flag: "no_revenue" | "no_salary" | null;
};

// ── Main handler ─────────────────────────────────────────────────────────────
export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const dateFrom = searchParams.get("date_from");
  const dateTo   = searchParams.get("date_to");
  if (!dateFrom || !dateTo) {
    return NextResponse.json({ error: "date_from and date_to are required" }, { status: 400 });
  }
  const supabase = getAdminClient();

  // ── 1. Role mapping (Zoho contact_key → role) ──────────────────────────────
  const { data: roleData } = await supabase
    .from("wage_role_mapping")
    .select("contact_key, role");
  const roleMap = new Map<string, string>();
  for (const r of (roleData ?? [])) {
    roleMap.set(norm(r.contact_key as string), ((r.role as string) || "").toLowerCase());
  }

  // ── 2. Wages from transactions_raw — productive roles only ────────────────
  const { data: wageTxns } = await supabase
    .from("transactions_raw")
    .select("venue, contact_name, amount")
    .eq("ebitda_line", "wages")
    .in("venue", ALL_VENUES)
    .gte("date", dateFrom)
    .lte("date", dateTo);

  // salaryMap key: `${venue}|${normalized_name}` → aggregated salary
  const salaryMap = new Map<string, { salary: number; role: string; rawName: string; venue: string }>();
  for (const t of (wageTxns ?? [])) {
    const name = (t.contact_name as string) || "";
    if (!name) continue;
    const key = norm(name);
    const role = roleMap.get(key) ?? "unassigned";
    if (!PRODUCTIVE_ROLES.has(role)) continue;
    const venue = t.venue as string;
    const mapKey = `${venue}|${key}`;
    const ex = salaryMap.get(mapKey) ?? { salary: 0, role, rawName: name, venue };
    ex.salary += Number(t.amount ?? 0);
    salaryMap.set(mapKey, ex);
  }

  // ── 3. Salary supplement (prorate per month) ──────────────────────────────
  const months: string[] = [];
  {
    let y = parseInt(dateFrom.slice(0, 4), 10);
    let m = parseInt(dateFrom.slice(5, 7), 10);
    const ey = parseInt(dateTo.slice(0, 4), 10);
    const em = parseInt(dateTo.slice(5, 7), 10);
    while (y < ey || (y === ey && m <= em)) {
      months.push(`${y}-${String(m).padStart(2, "0")}-01`);
      m++; if (m > 12) { m = 1; y++; }
    }
  }

  const { data: suppData } = await supabase
    .from("salary_supplement_monthly")
    .select("spa_slug, employee_name, amount, role, month")
    .in("spa_slug", ALL_VENUES)
    .in("month", months.length ? months : ["1900-01-01"])
    .eq("is_frozen", true);

  for (const s of (suppData ?? [])) {
    const role = ((s.role as string) || "").toLowerCase().trim();
    if (!PRODUCTIVE_ROLES.has(role)) continue;
    const name = (s.employee_name as string) || "";
    if (!name) continue;
    const venue = (s.spa_slug as string) || "";
    if (!venue) continue;

    const m     = (s.month as string).slice(0, 10);
    const mY    = parseInt(m.slice(0, 4), 10);
    const mMo   = parseInt(m.slice(5, 7), 10);
    const lastD = new Date(mY, mMo, 0).getDate();
    const mEnd  = `${mY}-${String(mMo).padStart(2, "0")}-${String(lastD).padStart(2, "0")}`;
    const rs    = dateFrom > m    ? dateFrom : m;
    const re    = dateTo   < mEnd ? dateTo   : mEnd;
    const dr    = rs > re ? 0 : daysBetween(rs, re);
    const prorated = Number(s.amount ?? 0) * (dr / lastD);
    if (prorated <= 0) continue;

    const key    = norm(name);
    const mapKey = `${venue}|${key}`;
    const ex = salaryMap.get(mapKey) ?? { salary: 0, role, rawName: name, venue };
    ex.salary += prorated;
    if (!ex.role || ex.role === "unassigned") ex.role = role;
    salaryMap.set(mapKey, ex);
  }

  // ── 3b. Token index (built after salaryMap is complete) ───────────────────
  // Maps `${venue}|${token}` (Spa) or just `${token}` (Aes/Slm) → [salaryMapKey].
  // Used for fallback name resolution when exact join fails.
  const spaTokenIdx = new Map<string, string[]>();
  const aesTokenIdx = new Map<string, string[]>();
  const slmTokenIdx = new Map<string, string[]>();

  for (const [mapKey, v] of salaryMap) {
    const tokens = norm(v.rawName).split(" ").filter(t => t.length >= MIN_TOKEN_LEN);
    for (const token of tokens) {
      if (SPA_VENUES.includes(v.venue)) {
        const ik = `${v.venue}|${token}`;
        const arr = spaTokenIdx.get(ik) ?? []; arr.push(mapKey); spaTokenIdx.set(ik, arr);
      } else if (v.venue === "aesthetics") {
        const arr = aesTokenIdx.get(token) ?? []; arr.push(mapKey); aesTokenIdx.set(token, arr);
      } else if (v.venue === "slimming") {
        const arr = slmTokenIdx.get(token) ?? []; arr.push(mapKey); slmTokenIdx.set(token, arr);
      }
    }
  }

  function resolveViaTok(
    idx: Map<string, string[]>,
    prefix: string | null,
    revRawName: string,
  ): string | null {
    const base = stripVenueSuffix(revRawName);
    for (const token of base.split(" ").filter(t => t.length >= MIN_TOKEN_LEN)) {
      const ik = prefix ? `${prefix}|${token}` : token;
      const cands = idx.get(ik) ?? [];
      if (cands.length === 1) return cands[0];
      if (cands.length > 1) return null;
    }
    return null;
  }

  // ── 4. Practitioner name aliases (applied on revenue side BEFORE join) ────
  const { data: aliasData } = await supabase
    .from("practitioner_name_aliases")
    .select("revenue_name, canonical_name, venue");
  const aliasMap = new Map<string, string>();
  for (const a of (aliasData ?? [])) {
    aliasMap.set(
      `${a.venue as string}|${norm(a.revenue_name as string)}`,
      norm(a.canonical_name as string),
    );
  }
  function applyAlias(brand: string, name: string): string {
    return aliasMap.get(`${brand}|${norm(name)}`) ?? norm(name);
  }

  // ── 5. Revenue per practitioner per brand ─────────────────────────────────

  // 5a. Spa
  const { data: spaRev } = await supabase
    .from("spa_services_by_employee_daily")
    .select("location_id, employee_name, price_ex_vat")
    .gte("date_of_service", dateFrom)
    .lte("date_of_service", dateTo);
  const spaRevMap = new Map<string, { revenue: number; rawName: string; venue: string }>();
  for (const r of (spaRev ?? [])) {
    const venue = LOC_ID_TO_SLUG[r.location_id as number];
    if (!venue) continue;
    const rawName = (r.employee_name as string) || "";
    if (!rawName) continue;
    const key    = applyAlias("spa", rawName);
    const mapKey = `${venue}|${key}`;
    const ex = spaRevMap.get(mapKey) ?? { revenue: 0, rawName, venue };
    ex.revenue += Number(r.price_ex_vat ?? 0);
    spaRevMap.set(mapKey, ex);
  }

  // 5b. Aesthetics
  const { data: aesRev } = await supabase
    .from("aesthetics_sales_daily")
    .select("note_person, sales_staff, price_ex_vat")
    .gte("date_of_service", dateFrom)
    .lte("date_of_service", dateTo);
  const aesRevMap = new Map<string, { revenue: number; rawName: string }>();
  for (const r of (aesRev ?? [])) {
    const notePerson = ((r.note_person as string) || "").trim();
    const salesStaff = ((r.sales_staff as string) || "").trim();
    const rawName    = notePerson || salesStaff;
    if (!rawName) continue;
    const key = applyAlias("aesthetics", rawName);
    const ex = aesRevMap.get(key) ?? { revenue: 0, rawName };
    ex.revenue += Number(r.price_ex_vat ?? 0);
    aesRevMap.set(key, ex);
  }

  // 5c. Slimming
  const { data: slmRev } = await supabase
    .from("slimming_treatments_daily")
    .select("therapist, price_ex_vat")
    .gte("date_of_service", dateFrom)
    .lte("date_of_service", dateTo);
  const slmRevMap = new Map<string, { revenue: number; rawName: string }>();
  for (const r of (slmRev ?? [])) {
    const rawName = ((r.therapist as string) || "").trim();
    if (!rawName) continue;
    const key = applyAlias("slimming", rawName);
    const ex = slmRevMap.get(key) ?? { revenue: 0, rawName };
    ex.revenue += Number(r.price_ex_vat ?? 0);
    slmRevMap.set(key, ex);
  }

  // ── 6. Join + emit rows per brand ─────────────────────────────────────────
  // Each brand uses a two-step join:
  //   a) salary-driven loop: for each salary entry try exact rev-key, then token fallback
  //   b) revenue-only sweep: emit rows whose revenue was never matched to a salary entry

  const out: Record<"spa" | "aesthetics" | "slimming", Row[]> = {
    spa: [], aesthetics: [], slimming: [],
  };

  // 6a. Spa
  {
    // salary-driven: merge revenue into salary entry
    const spaRevAssigned = new Set<string>(); // rev map keys that were merged

    const mergedSpa = new Map<string, {
      salary: number; role: string; rawName: string; venue: string; revenue: number; revRawName?: string;
    }>();
    for (const [k, v] of salaryMap) {
      if (!SPA_VENUES.includes(v.venue)) continue;
      mergedSpa.set(k, { salary: v.salary, role: v.role, rawName: v.rawName, venue: v.venue, revenue: 0 });
    }

    for (const [revKey, r] of spaRevMap) {
      // Exact match?
      if (mergedSpa.has(revKey)) {
        mergedSpa.get(revKey)!.revenue += r.revenue;
        mergedSpa.get(revKey)!.revRawName = r.rawName;
        spaRevAssigned.add(revKey);
        continue;
      }
      // Token fallback
      const salaryKey = resolveViaTok(spaTokenIdx, r.venue, r.rawName);
      if (salaryKey && mergedSpa.has(salaryKey)) {
        mergedSpa.get(salaryKey)!.revenue += r.revenue;
        mergedSpa.get(salaryKey)!.revRawName = r.rawName;
        spaRevAssigned.add(revKey);
      }
    }

    for (const [, e] of mergedSpa) {
      out.spa.push({
        employee_name: e.revRawName || e.rawName,
        venue: e.venue, role: e.role,
        salary: +e.salary.toFixed(2),
        revenue: +e.revenue.toFixed(2),
        k_pct: e.revenue > 0 ? +((e.salary / e.revenue) * 100).toFixed(1) : null,
        flag: e.revenue === 0 ? "no_revenue" : null,
      });
    }
    for (const [revKey, r] of spaRevMap) {
      if (spaRevAssigned.has(revKey)) continue;
      out.spa.push({
        employee_name: r.rawName, venue: r.venue, role: "therapist",
        salary: 0, revenue: +r.revenue.toFixed(2), k_pct: null, flag: "no_salary",
      });
    }
  }

  // 6b. Aesthetics
  {
    const aesRevAssigned = new Set<string>();
    const mergedAes = new Map<string, {
      salary: number; role: string; rawName: string; revenue: number; revRawName?: string;
    }>();
    for (const [k, v] of salaryMap) {
      if (v.venue !== "aesthetics") continue;
      const nameKey = norm(v.rawName);
      mergedAes.set(nameKey, { salary: v.salary, role: v.role, rawName: v.rawName, revenue: 0 });
    }

    for (const [revKey, r] of aesRevMap) {
      if (mergedAes.has(revKey)) {
        mergedAes.get(revKey)!.revenue += r.revenue;
        mergedAes.get(revKey)!.revRawName = r.rawName;
        aesRevAssigned.add(revKey);
        continue;
      }
      const salaryKey = resolveViaTok(aesTokenIdx, null, r.rawName);
      if (salaryKey) {
        const nameKey = norm(salaryMap.get(salaryKey)!.rawName);
        if (mergedAes.has(nameKey)) {
          mergedAes.get(nameKey)!.revenue += r.revenue;
          mergedAes.get(nameKey)!.revRawName = r.rawName;
          aesRevAssigned.add(revKey);
        }
      }
    }

    for (const [_k, e] of mergedAes) {
      out.aesthetics.push({
        employee_name: e.revRawName || e.rawName, venue: "aesthetics", role: e.role,
        salary: +e.salary.toFixed(2), revenue: +e.revenue.toFixed(2),
        k_pct: e.revenue > 0 ? +((e.salary / e.revenue) * 100).toFixed(1) : null,
        flag: e.revenue === 0 ? "no_revenue" : null,
      });
    }
    for (const [revKey, r] of aesRevMap) {
      if (aesRevAssigned.has(revKey)) continue;
      out.aesthetics.push({
        employee_name: r.rawName, venue: "aesthetics", role: "practitioner",
        salary: 0, revenue: +r.revenue.toFixed(2), k_pct: null, flag: "no_salary",
      });
    }
  }

  // 6c. Slimming
  {
    const slmRevAssigned = new Set<string>();
    const mergedSlm = new Map<string, {
      salary: number; role: string; rawName: string; revenue: number; revRawName?: string;
    }>();
    for (const [k, v] of salaryMap) {
      if (v.venue !== "slimming") continue;
      const nameKey = norm(v.rawName);
      mergedSlm.set(nameKey, { salary: v.salary, role: v.role, rawName: v.rawName, revenue: 0 });
    }

    for (const [revKey, r] of slmRevMap) {
      if (mergedSlm.has(revKey)) {
        mergedSlm.get(revKey)!.revenue += r.revenue;
        mergedSlm.get(revKey)!.revRawName = r.rawName;
        slmRevAssigned.add(revKey);
        continue;
      }
      const salaryKey = resolveViaTok(slmTokenIdx, null, r.rawName);
      if (salaryKey) {
        const nameKey = norm(salaryMap.get(salaryKey)!.rawName);
        if (mergedSlm.has(nameKey)) {
          mergedSlm.get(nameKey)!.revenue += r.revenue;
          mergedSlm.get(nameKey)!.revRawName = r.rawName;
          slmRevAssigned.add(revKey);
        }
      }
    }

    for (const [_k, e] of mergedSlm) {
      out.slimming.push({
        employee_name: e.revRawName || e.rawName, venue: "slimming", role: e.role,
        salary: +e.salary.toFixed(2), revenue: +e.revenue.toFixed(2),
        k_pct: e.revenue > 0 ? +((e.salary / e.revenue) * 100).toFixed(1) : null,
        flag: e.revenue === 0 ? "no_revenue" : null,
      });
    }
    for (const [revKey, r] of slmRevMap) {
      if (slmRevAssigned.has(revKey)) continue;
      out.slimming.push({
        employee_name: r.rawName, venue: "slimming", role: "therapist",
        salary: 0, revenue: +r.revenue.toFixed(2), k_pct: null, flag: "no_salary",
      });
    }
  }

  // Sort each brand by K% DESCENDING (worst productivity at top).
  // Nulls go last; within the null group, sort by revenue DESCENDING.
  function sortByKpct(rows: Row[]): Row[] {
    return rows.sort((a, b) => {
      if (a.k_pct == null && b.k_pct == null) return b.revenue - a.revenue;
      if (a.k_pct == null) return 1;
      if (b.k_pct == null) return -1;
      return b.k_pct - a.k_pct;
    });
  }

  return NextResponse.json({
    date_from:  dateFrom,
    date_to:    dateTo,
    spa:        sortByKpct(out.spa),
    aesthetics: sortByKpct(out.aesthetics),
    slimming:   sortByKpct(out.slimming),
  });
}
