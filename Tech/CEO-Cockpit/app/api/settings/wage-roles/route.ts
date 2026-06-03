import { NextRequest, NextResponse } from "next/server";
import { getAdminClient } from "@/lib/supabase/admin";

// Canonical role keys. Mirrors the CHECK constraint in migration 050.
const ROLES = ["manager", "reception", "practitioner", "therapist", "crm"] as const;
type Role = (typeof ROLES)[number];

// Normalise a Zoho contact name into the join key used as the table's unique
// key. MUST stay in lockstep with the client normaliser in lib/hooks/useWageRoles.ts:
// lowercase, trim, and collapse any run of inner whitespace to a single space.
function normalizeContact(name: string): string {
  return (name || "").trim().toLowerCase().replace(/\s+/g, " ");
}

// GET — return every role mapping. Small table (one row per categorised
// employee), so no pagination needed. The client builds a Map keyed by
// contact_key for the EBITDA bucketing + the settings selects.
export async function GET() {
  const supabase = getAdminClient();
  const { data, error } = await supabase
    .from("wage_role_mapping")
    .select("contact_key, contact_name, role")
    .order("contact_name");

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data ?? []);
}

// PATCH — upsert one employee's role, or clear it (back to Unassigned).
// Body: { contact_name: string, role: Role | null }
//   role === null / "" / "unassigned"  → delete the mapping (Unassigned bucket)
//   role in ROLES                       → upsert on contact_key
export async function PATCH(req: NextRequest) {
  const supabase = getAdminClient();
  const body = await req.json().catch(() => ({}));

  const contactName: string = typeof body.contact_name === "string" ? body.contact_name : "";
  const contactKey = normalizeContact(contactName);
  if (!contactKey) {
    return NextResponse.json({ error: "contact_name required" }, { status: 400 });
  }

  const rawRole = body.role;

  // Clear → Unassigned: delete the row so the employee falls into the implicit
  // Unassigned bucket on the dashboard (keeps reconciliation exact).
  if (rawRole === null || rawRole === "" || rawRole === "unassigned") {
    const { error } = await supabase
      .from("wage_role_mapping")
      .delete()
      .eq("contact_key", contactKey);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ ok: true, contact_key: contactKey, role: null });
  }

  if (!ROLES.includes(rawRole as Role)) {
    return NextResponse.json({ error: `role must be one of ${ROLES.join(", ")} or null` }, { status: 400 });
  }
  const role = rawRole as Role;

  const { error } = await supabase
    .from("wage_role_mapping")
    .upsert(
      { contact_key: contactKey, contact_name: contactName.trim(), role, updated_at: new Date().toISOString() },
      { onConflict: "contact_key" },
    );
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true, contact_key: contactKey, role });
}
