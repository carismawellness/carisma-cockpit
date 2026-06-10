// /api/sales/employees/rates — effective-dated commission rate revisions.
//
// POST   { employee_id, service_rate, retail_rate, effective_from }
//        — upsert on (employee_id, effective_from) → { rate }
// DELETE ?id=N → { ok: true }
// Admin only; writes via the service-role client.

import { NextRequest, NextResponse } from "next/server";
import { getAdminClient } from "@/lib/supabase/admin";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { isAdminEmail } from "@/lib/auth/admins";

export const maxDuration = 30;
export const dynamic = "force-dynamic";

async function requireAdmin(): Promise<string | null> {
  const supabase = await createServerSupabaseClient();
  const { data: { user } } = await supabase.auth.getUser();
  const email = (user?.email ?? "").toLowerCase();
  return isAdminEmail(email) ? email : null;
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/** POST — upsert a rate revision for an employee */
export async function POST(req: NextRequest) {
  const admin = await requireAdmin();
  if (!admin) return NextResponse.json({ error: "Unauthorized" }, { status: 403 });

  let body: Record<string, unknown>;
  try { body = await req.json(); } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const employeeId = Number(body.employee_id);
  if (!Number.isInteger(employeeId) || employeeId <= 0) {
    return NextResponse.json({ error: "Valid employee_id is required" }, { status: 400 });
  }
  const effectiveFrom = String(body.effective_from ?? "");
  if (!DATE_RE.test(effectiveFrom)) {
    return NextResponse.json({ error: "effective_from must be YYYY-MM-DD" }, { status: 400 });
  }
  const serviceRate = Number(body.service_rate ?? 0);
  const retailRate = Number(body.retail_rate ?? 0);
  if (!Number.isFinite(serviceRate) || serviceRate < 0 || serviceRate > 1 ||
      !Number.isFinite(retailRate) || retailRate < 0 || retailRate > 1) {
    return NextResponse.json(
      { error: "Rates must be fractions between 0 and 1 (0.06 = 6%)" },
      { status: 400 },
    );
  }

  const db = getAdminClient();
  const { data, error } = await db
    .from("sales_employee_commission_rates")
    .upsert(
      {
        employee_id: employeeId,
        service_rate: serviceRate,
        retail_rate: retailRate,
        effective_from: effectiveFrom,
      },
      { onConflict: "employee_id,effective_from" },
    )
    .select("id, employee_id, service_rate, retail_rate, effective_from")
    .single();

  if (error) {
    // 23503 = employee_id FK violation
    const status = error.code === "23503" ? 404 : 500;
    return NextResponse.json({ error: error.message }, { status });
  }

  return NextResponse.json({
    rate: {
      ...data,
      service_rate: Number(data.service_rate),
      retail_rate: Number(data.retail_rate),
    },
  });
}

/** DELETE ?id=N — remove a rate revision */
export async function DELETE(req: NextRequest) {
  const admin = await requireAdmin();
  if (!admin) return NextResponse.json({ error: "Unauthorized" }, { status: 403 });

  const id = Number(req.nextUrl.searchParams.get("id"));
  if (!Number.isInteger(id) || id <= 0) {
    return NextResponse.json({ error: "Valid id is required" }, { status: 400 });
  }

  const db = getAdminClient();
  const { error } = await db.from("sales_employee_commission_rates").delete().eq("id", id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
