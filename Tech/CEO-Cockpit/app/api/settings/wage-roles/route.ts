import { NextRequest, NextResponse } from "next/server";
import { getAdminClient } from "@/lib/supabase/admin";

export const maxDuration = 60;

// Canonical role keys. Mirrors the CHECK constraint in migration 050.
const ROLES = ["manager", "reception", "practitioner", "therapist", "crm"] as const;
type Role = (typeof ROLES)[number];

const SGA_SUBS = ["prof_services","fuel","laundry","software","cleaning","travel","misc","insurance","events","maintenance","telecom"] as const;

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
    .select("contact_key, contact_name, role, is_prof_fee, sga_sub_line")
    .order("contact_name");

  // Migration 089 adds is_prof_fee and sga_sub_line. If it hasn't been applied
  // to production yet (error code 42703 = undefined_column), fall back to the
  // base columns so the route stays functional until the migration runs.
  // Apply via Supabase dashboard SQL editor:
  //   ALTER TABLE wage_role_mapping ADD COLUMN IF NOT EXISTS is_prof_fee boolean NOT NULL DEFAULT false;
  //   ALTER TABLE wage_role_mapping ADD COLUMN IF NOT EXISTS sga_sub_line text DEFAULT 'prof_services';
  if (error) {
    if (error.code === "42703") {
      console.error("[wage-roles] GET: migration 089 not applied — falling back to base columns:", error.message);
      const fallback = await supabase
        .from("wage_role_mapping")
        .select("contact_key, contact_name, role")
        .order("contact_name");
      if (fallback.error) {
        console.error("[wage-roles] GET fallback error:", fallback.error.message);
        return NextResponse.json({ error: fallback.error.message }, { status: 500 });
      }
      const rows = (fallback.data ?? []).map((r) => ({
        ...r,
        is_prof_fee: false,
        sga_sub_line: null,
      }));
      return NextResponse.json(rows);
    }
    console.error("[wage-roles] GET error:", error.message);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
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

  const rawRole    = body.role;
  const isProfFee  = body.is_prof_fee === true;
  const rawSgaSub  = typeof body.sga_sub_line === "string" ? body.sga_sub_line : null;
  const sgaSubLine = rawSgaSub && (SGA_SUBS as readonly string[]).includes(rawSgaSub) ? rawSgaSub : "prof_services";

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

  const upsertRow = {
    contact_key:  contactKey,
    contact_name: contactName.trim(),
    role,
    is_prof_fee:  isProfFee,
    sga_sub_line: isProfFee ? sgaSubLine : null,
    updated_at:   new Date().toISOString(),
  };
  let { error } = await supabase
    .from("wage_role_mapping")
    .upsert(upsertRow, { onConflict: "contact_key" });
  if (error && error.code === "42703") {
    // Migration 089 not yet applied — upsert without the new columns.
    console.error("[wage-roles] PATCH: migration 089 not applied — upserting without is_prof_fee/sga_sub_line:", error.message);
    const { contact_key, contact_name, role: r, updated_at } = upsertRow;
    ({ error } = await supabase
      .from("wage_role_mapping")
      .upsert({ contact_key, contact_name, role: r, updated_at }, { onConflict: "contact_key" }));
  }
  if (error) {
    console.error("[wage-roles] PATCH error:", error.message);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json({ ok: true, contact_key: contactKey, role, is_prof_fee: isProfFee, sga_sub_line: isProfFee ? sgaSubLine : null });
}
