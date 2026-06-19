import { NextRequest, NextResponse } from "next/server";
import { getAdminClient } from "@/lib/supabase/admin";

export const maxDuration = 120;

const ROLES = ["manager", "reception", "practitioner", "therapist", "crm"] as const;
type Role = (typeof ROLES)[number];

function normalizeContact(name: string): string {
  return (name || "").trim().toLowerCase().replace(/\s+/g, " ");
}

// POST — bulk upsert role mappings.
// Body: { assignments: Array<{ contact_name: string; role: Role }> }
export async function POST(req: NextRequest) {
  const supabase = getAdminClient();
  const body = await req.json().catch(() => ({}));

  const assignments: Array<{ contact_name: string; role: Role }> = body.assignments ?? [];
  if (!Array.isArray(assignments) || assignments.length === 0) {
    return NextResponse.json({ error: "assignments array required" }, { status: 400 });
  }

  const rows = assignments
    .filter((a) => typeof a.contact_name === "string" && ROLES.includes(a.role as Role))
    .map((a) => ({
      contact_key:  normalizeContact(a.contact_name),
      contact_name: a.contact_name.trim(),
      role:         a.role,
      updated_at:   new Date().toISOString(),
    }))
    .filter((r) => r.contact_key);

  if (rows.length === 0) {
    return NextResponse.json({ error: "No valid assignments found" }, { status: 400 });
  }

  const { error } = await supabase
    .from("wage_role_mapping")
    .upsert(rows, { onConflict: "contact_key" });

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true, saved: rows.length });
}
