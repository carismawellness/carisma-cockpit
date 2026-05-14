import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

async function lookupTalexioName(empNo: number): Promise<string | null> {
  const token = process.env.TALEXIO_TOKEN;
  if (!token) return null;
  try {
    const res = await fetch("https://api.talexiohr.com/graphql", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
        Origin: "https://carismaspawellness.talexiohr.com",
      },
      body: JSON.stringify({ query: `query { employees { employeeCode fullName } }` }),
    });
    if (!res.ok) return null;
    const json = await res.json();
    const emps: { employeeCode: string; fullName: string }[] = json?.data?.employees ?? [];
    return emps.find(e => parseInt(e.employeeCode, 10) === empNo)?.fullName ?? null;
  } catch {
    return null;
  }
}

// GET ?month=2026-03-01  — list all rows for a month
export async function GET(req: NextRequest) {
  const month = req.nextUrl.searchParams.get("month");
  if (!month) return NextResponse.json({ error: "month required" }, { status: 400 });

  const { data, error } = await supabase
    .from("salary_supplement_monthly")
    .select("*")
    .eq("month", month)
    .order("employee_name");

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data);
}

// PATCH  — freeze a month or update a single row's spa_slug
export async function PATCH(req: NextRequest) {
  const body = await req.json();

  // Freeze or unfreeze entire month: { month, freeze: true | false }
  if ("freeze" in body && body.month) {
    const { error } = await supabase
      .from("salary_supplement_monthly")
      .update({ is_frozen: body.freeze === true })
      .eq("month", body.month);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ ok: true });
  }

  // Update single row: { id, spa_slug } or { id, talexio_id }
  if (body.id !== undefined) {
    const updates: Record<string, unknown> = {};
    if (body.spa_slug !== undefined) updates.spa_slug = body.spa_slug || null;
    if ("talexio_id" in body) {
      const empNo = body.talexio_id ? parseInt(String(body.talexio_id), 10) : null;
      updates.talexio_id = empNo;
      updates.talexio_name = empNo ? await lookupTalexioName(empNo) : null;
    }
    const { error } = await supabase
      .from("salary_supplement_monthly")
      .update(updates)
      .eq("id", body.id);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ ok: true, talexio_name: updates.talexio_name ?? null });
  }

  return NextResponse.json({ error: "invalid body" }, { status: 400 });
}
