// /api/sales/employees/unmapped — distinct revenue-data names with no
// matching employee/alias for the brand. Powers the admin "Unmapped names"
// panel so attribution gaps are visible instead of silent.
//
// GET ?brand=spa|aesthetics|slimming&from=YYYY-MM-DD&to=YYYY-MM-DD
// → { unmapped: [{ name, kind, revenue, tx_count, last_seen }] }
//
// Sources per brand (see design doc "Data reality" table):
//   spa        → spa_services_by_employee_daily.employee_name (service)
//                + spa_retail_by_employee_daily.employee_name (retail;
//                  table tolerated as missing pre-migration)
//   aesthetics → aesthetics_sales_daily.note_person (kind via classifier)
//   slimming   → slimming_sales_daily.sales_staff (service_type='product' = retail)
// Spa excludes 'CARISMA (SALES)' (walk-in sales, not an employee).
// Requires any authenticated session.

import { NextRequest, NextResponse } from "next/server";
import { getAdminClient } from "@/lib/supabase/admin";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { fetchAll } from "@/lib/supabase/fetch-all";
import { normalizeName } from "@/lib/sales-employees/names";
import { isAestheticsRetail } from "@/lib/sales-employees/classify";
import type { RevenueKind, SalesEmployee, UnmappedName } from "@/lib/sales-employees/types";

export const maxDuration = 60;
export const dynamic = "force-dynamic";

const BRANDS = new Set(["spa", "aesthetics", "slimming"]);
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function isMissingTable(message: string): boolean {
  const m = message.toLowerCase();
  return m.includes("42p01") || m.includes("does not exist") ||
    m.includes("could not find the table") || m.includes("404");
}

interface NameAcc {
  service_revenue: number;
  retail_revenue: number;
  tx_count: number;
  last_seen: string;
}

function accumulate(
  acc: Map<string, NameAcc>,
  rawName: string | null,
  kind: RevenueKind,
  amount: number,
  date: string | null,
): void {
  const name = normalizeName(rawName);
  if (!name) return;
  const entry = acc.get(name) ?? { service_revenue: 0, retail_revenue: 0, tx_count: 0, last_seen: "" };
  if (kind === "retail") entry.retail_revenue += amount;
  else entry.service_revenue += amount;
  entry.tx_count += 1;
  if (date && date > entry.last_seen) entry.last_seen = date;
  acc.set(name, entry);
}

export async function GET(req: NextRequest) {
  // Any authenticated session
  const supabase = await createServerSupabaseClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user?.email) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const params = req.nextUrl.searchParams;
  const brand = params.get("brand") ?? "";
  if (!BRANDS.has(brand)) {
    return NextResponse.json({ error: "brand must be spa|aesthetics|slimming" }, { status: 400 });
  }

  // Default window: trailing 12 months
  const now = new Date();
  const defaultTo = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
  const past = new Date(now.getFullYear() - 1, now.getMonth(), now.getDate());
  const defaultFrom = `${past.getFullYear()}-${String(past.getMonth() + 1).padStart(2, "0")}-${String(past.getDate()).padStart(2, "0")}`;
  const from = params.get("from") ?? defaultFrom;
  const to = params.get("to") ?? defaultTo;
  if (!DATE_RE.test(from) || !DATE_RE.test(to)) {
    return NextResponse.json({ error: "from/to must be YYYY-MM-DD" }, { status: 400 });
  }

  const db = getAdminClient();

  // ── Known names for this brand (display_name + aliases, normalized) ────────
  const { data: empRows, error: empErr } = await db
    .from("sales_employees")
    .select("id, slug, display_name, brand_slug, aliases")
    .eq("brand_slug", brand);
  if (empErr) {
    return NextResponse.json(
      { error: empErr.message, ...(isMissingTable(empErr.message) ? { migration_missing: true } : {}) },
      { status: 500 },
    );
  }
  const known = new Set<string>();
  for (const emp of (empRows ?? []) as Pick<SalesEmployee, "display_name" | "aliases">[]) {
    const display = normalizeName(emp.display_name);
    if (display) known.add(display);
    for (const alias of emp.aliases ?? []) {
      const norm = normalizeName(alias);
      if (norm) known.add(norm);
    }
  }

  // ── Scan brand revenue sources ──────────────────────────────────────────────
  const acc = new Map<string, NameAcc>();

  try {
    if (brand === "spa") {
      type SvcRow = { employee_name: string | null; price_ex_vat: number | null; date_of_service: string | null };
      const svcRows = await fetchAll<SvcRow>(
        (off, lim) =>
          db.from("spa_services_by_employee_daily")
            .select("employee_name, price_ex_vat, date_of_service")
            .gte("date_of_service", from)
            .lte("date_of_service", to)
            .range(off, off + lim - 1),
        "spa_services_by_employee_daily",
      );
      for (const r of svcRows) {
        if (normalizeName(r.employee_name) === "CARISMA (SALES)") continue;
        accumulate(acc, r.employee_name, "service", Number(r.price_ex_vat ?? 0), r.date_of_service);
      }

      // Retail table may not exist yet (pre-migration) — degrade to empty
      type RetRow = { employee_name: string | null; amount_ex_vat: number | null; date: string | null };
      try {
        const retRows = await fetchAll<RetRow>(
          (off, lim) =>
            db.from("spa_retail_by_employee_daily")
              .select("employee_name, amount_ex_vat, date")
              .gte("date", from)
              .lte("date", to)
              .range(off, off + lim - 1),
          "spa_retail_by_employee_daily",
        );
        for (const r of retRows) {
          if (normalizeName(r.employee_name) === "CARISMA (SALES)") continue;
          accumulate(acc, r.employee_name, "retail", Number(r.amount_ex_vat ?? 0), r.date);
        }
      } catch (e) {
        if (!isMissingTable(String(e))) throw e;
      }
    } else if (brand === "aesthetics") {
      type AesRow = {
        note_person: string | null;
        price_ex_vat: number | null;
        service_product: string | null;
        date_of_service: string | null;
      };
      const rows = await fetchAll<AesRow>(
        (off, lim) =>
          db.from("aesthetics_sales_daily")
            .select("note_person, price_ex_vat, service_product, date_of_service")
            .gte("date_of_service", from)
            .lte("date_of_service", to)
            .range(off, off + lim - 1),
        "aesthetics_sales_daily",
      );
      for (const r of rows) {
        const kind: RevenueKind = isAestheticsRetail(r.service_product) ? "retail" : "service";
        accumulate(acc, r.note_person, kind, Number(r.price_ex_vat ?? 0), r.date_of_service);
      }
    } else {
      type SlmRow = {
        sales_staff: string | null;
        price_ex_vat: number | null;
        service_type: string | null;
        date_of_service: string | null;
      };
      const rows = await fetchAll<SlmRow>(
        (off, lim) =>
          db.from("slimming_sales_daily")
            .select("sales_staff, price_ex_vat, service_type, date_of_service")
            .gte("date_of_service", from)
            .lte("date_of_service", to)
            .range(off, off + lim - 1),
        "slimming_sales_daily",
      );
      for (const r of rows) {
        const kind: RevenueKind = r.service_type === "product" ? "retail" : "service";
        accumulate(acc, r.sales_staff, kind, Number(r.price_ex_vat ?? 0), r.date_of_service);
      }
    }
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }

  // ── Filter out mapped names, shape response ─────────────────────────────────
  const unmapped: UnmappedName[] = [];
  for (const [name, entry] of acc) {
    if (known.has(name)) continue;
    const kind: RevenueKind = entry.retail_revenue > entry.service_revenue ? "retail" : "service";
    unmapped.push({
      name,
      kind,
      revenue: +(entry.service_revenue + entry.retail_revenue).toFixed(2),
      tx_count: entry.tx_count,
      last_seen: entry.last_seen || to,
    });
  }
  unmapped.sort((a, b) => b.revenue - a.revenue);

  return NextResponse.json({ unmapped });
}
