// /api/sales/employee-rank
// GET ?brand=spa&slug=blagojche-damevski&from=2026-06-01&to=2026-06-30
// Returns the rank of the given employee among all active employees of the same brand
// for the given period, ranked by total commission earned.
// Only spa brand is supported (aesthetics/slimming have simpler flat structures).

import { NextRequest, NextResponse } from "next/server";
import { getAdminClient } from "@/lib/supabase/admin";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { fetchAll } from "@/lib/supabase/fetch-all";
import { normalizeName } from "@/lib/sales-employees/names";
import { isAdminEmail } from "@/lib/auth/admins";

export const maxDuration = 30;
export const dynamic = "force-dynamic";

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function isMissingTable(msg: string) {
  const m = msg.toLowerCase();
  return m.includes("42p01") || m.includes("does not exist") || m.includes("404");
}

export async function GET(req: NextRequest) {
  const supabase = await createServerSupabaseClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user?.email) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const params = req.nextUrl.searchParams;
  const brand = params.get("brand") ?? "";
  const slug = params.get("slug") ?? "";
  let from = params.get("from") ?? "";
  const to = params.get("to") ?? "";

  if (!DATE_RE.test(from) || !DATE_RE.test(to) || !slug) {
    return NextResponse.json({ rank: null, totalEmployees: null });
  }

  // Enforce 6-month lookback for non-admins
  if (!isAdminEmail(user.email)) {
    const earliest = new Date();
    earliest.setMonth(earliest.getMonth() - 6);
    earliest.setHours(0, 0, 0, 0);
    const earliestStr = earliest.toISOString().slice(0, 10);
    if (from < earliestStr) from = earliestStr;
  }

  // Only spa supported for now
  if (brand !== "spa") return NextResponse.json({ rank: null, totalEmployees: null });

  const db = getAdminClient();

  try {
    // 1. All active spa employees
    const { data: empData, error: empErr } = await db
      .from("sales_employees")
      .select("id, slug, display_name, aliases")
      .eq("brand_slug", "spa")
      .eq("is_active", true);
    if (empErr || !empData?.length) return NextResponse.json({ rank: null, totalEmployees: null });

    // Build normalisedName → employee_id map (handles aliases)
    const nameToId = new Map<string, string>();
    for (const emp of empData) {
      const allNames = [emp.display_name, ...(emp.aliases ?? [])];
      for (const n of allNames) {
        const key = normalizeName(n);
        if (key) nameToId.set(key, emp.id as string);
      }
    }

    // Find the current employee's DB id
    const currentEmp = empData.find(e => e.slug === slug);
    if (!currentEmp) return NextResponse.json({ rank: null, totalEmployees: null });
    const currentId = currentEmp.id as string;

    // 2. Commission rates for all employees (latest per employee)
    const empIds = empData.map(e => e.id as string);
    const { data: rateData } = await db
      .from("sales_employee_commission_rates")
      .select("employee_id, service_rate, retail_rate, effective_from")
      .in("employee_id", empIds)
      .lte("effective_from", to)
      .order("effective_from", { ascending: false });

    const rateMap = new Map<string, { service_rate: number; retail_rate: number }>();
    for (const r of (rateData ?? [])) {
      const id = r.employee_id as string;
      if (!rateMap.has(id)) {
        rateMap.set(id, {
          service_rate: Number(r.service_rate),
          retail_rate: Number(r.retail_rate),
        });
      }
    }

    // 3. Aggregate service + retail revenue per employee
    const serviceRev = new Map<string, number>();
    const retailRev = new Map<string, number>();

    type SvcRow = { employee_name: string | null; price_ex_vat: number | null };
    const svcRows = await fetchAll<SvcRow>(
      (off, lim) =>
        db.from("spa_services_by_employee_daily")
          .select("employee_name, price_ex_vat")
          .gte("date_of_service", from)
          .lte("date_of_service", to)
          .range(off, off + lim - 1),
      "spa_services_by_employee_daily",
    );
    for (const r of svcRows) {
      const id = nameToId.get(normalizeName(r.employee_name));
      if (!id) continue;
      serviceRev.set(id, (serviceRev.get(id) ?? 0) + Number(r.price_ex_vat ?? 0));
    }

    try {
      type RetRow = { employee_name: string | null; amount_ex_vat: number | null };
      const retRows = await fetchAll<RetRow>(
        (off, lim) =>
          db.from("spa_retail_by_employee_daily")
            .select("employee_name, amount_ex_vat")
            .gte("date", from)
            .lte("date", to)
            .range(off, off + lim - 1),
        "spa_retail_by_employee_daily",
      );
      for (const r of retRows) {
        const id = nameToId.get(normalizeName(r.employee_name));
        if (!id) continue;
        retailRev.set(id, (retailRev.get(id) ?? 0) + Number(r.amount_ex_vat ?? 0));
      }
    } catch (e) {
      if (!isMissingTable(String(e))) throw e;
    }

    // 4. Compute commission per employee, rank descending
    const commissions: { id: string; commission: number }[] = [];
    for (const emp of empData) {
      const id = emp.id as string;
      const rates = rateMap.get(id) ?? { service_rate: 0.03, retail_rate: 0.05 };
      const svc = serviceRev.get(id) ?? 0;
      const ret = retailRev.get(id) ?? 0;
      const commission = svc * rates.service_rate + ret * rates.retail_rate;
      // Include all employees who have any revenue OR is the current employee
      if (commission > 0 || id === currentId) {
        commissions.push({ id, commission });
      }
    }

    commissions.sort((a, b) => b.commission - a.commission);

    const rankIdx = commissions.findIndex(c => c.id === currentId);
    if (rankIdx === -1) return NextResponse.json({ rank: null, totalEmployees: null });

    return NextResponse.json({
      rank: rankIdx + 1,
      totalEmployees: commissions.length,
      slug,
      brand,
    });
  } catch (e) {
    console.error("[employee-rank] error:", e);
    return NextResponse.json({ rank: null, totalEmployees: null });
  }
}
