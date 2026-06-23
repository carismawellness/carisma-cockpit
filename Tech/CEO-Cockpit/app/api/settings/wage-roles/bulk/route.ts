import { NextRequest, NextResponse } from "next/server";
import { getAdminClient } from "@/lib/supabase/admin";

export const maxDuration = 120;

const ROLES = ["manager", "reception", "practitioner", "therapist", "crm"] as const;
type Role = (typeof ROLES)[number];

function normalizeContact(name: string): string {
  return (name || "").trim().toLowerCase().replace(/\s+/g, " ");
}

// POST — bulk upsert role mappings.
// Body: { assignments: Array<{ contact_name: string; role: Role; is_prof_fee?: boolean; sga_sub_line?: string }> }
export async function POST(req: NextRequest) {
  const supabase = getAdminClient();
  const body = await req.json().catch(() => ({}));

  const assignments: Array<{ contact_name: string; role: Role; is_prof_fee?: boolean; sga_sub_line?: string | null }> = body.assignments ?? [];
  if (!Array.isArray(assignments) || assignments.length === 0) {
    return NextResponse.json({ error: "assignments array required" }, { status: 400 });
  }

  const rows = assignments
    .filter((a) => typeof a.contact_name === "string" && ROLES.includes(a.role as Role))
    .map((a) => ({
      contact_key:  normalizeContact(a.contact_name),
      contact_name: a.contact_name.trim(),
      role:         a.role,
      is_prof_fee:  a.is_prof_fee ?? false,
      sga_sub_line: a.is_prof_fee ? (a.sga_sub_line || "prof_services") : null,
      updated_at:   new Date().toISOString(),
    }))
    .filter((r) => r.contact_key);

  if (rows.length === 0) {
    return NextResponse.json({ error: "No valid assignments found" }, { status: 400 });
  }

  let { error } = await supabase
    .from("wage_role_mapping")
    .upsert(rows, { onConflict: "contact_key" });

  if (error && error.code === "42703") {
    // Migration 089 not yet applied — strip new columns and retry.
    console.error("[wage-roles/bulk] migration 089 not applied — upserting without is_prof_fee/sga_sub_line:", error.message);
    const baseRows = rows.map(({ contact_key, contact_name, role, updated_at }) => ({
      contact_key, contact_name, role, updated_at,
    }));
    ({ error } = await supabase
      .from("wage_role_mapping")
      .upsert(baseRows, { onConflict: "contact_key" }));
  }
  if (error) {
    console.error("[wage-roles/bulk] POST error:", error.message);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json({ ok: true, saved: rows.length });
}
