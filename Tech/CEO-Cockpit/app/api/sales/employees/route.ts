// /api/sales/employees — sales employee registry CRUD.
//
// GET    ?brand=spa|aesthetics|slimming (optional) → { employees: [...] }
//        each with current_rates (applicable today) + rate_history.
//        Requires any authenticated session.
// POST   create employee (optionally with initial rate row) → { employee }
// PATCH  { id, ...mutable fields } → { employee }
// DELETE ?id=N → { ok: true }
// Mutations require isAdminEmail(); all DB writes use the service-role client.

import { NextRequest, NextResponse } from "next/server";
import { getAdminClient } from "@/lib/supabase/admin";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { isAdminEmail } from "@/lib/auth/admins";
import { pickRate } from "@/lib/sales-employees/engine";
import type {
  CommissionRate,
  SalesEmployee,
  SalesEmployeeWithRates,
} from "@/lib/sales-employees/types";

export const maxDuration = 30;
export const dynamic = "force-dynamic";

const BRANDS = new Set(["spa", "aesthetics", "slimming"]);
const BASES = new Set(["ex_vat", "inc_vat"]);

// Fields a PATCH may modify
const MUTABLE_FIELDS = [
  "slug", "display_name", "brand_slug", "role", "location_name",
  "user_email", "is_active", "aliases", "commission_basis", "notes",
] as const;

async function sessionEmail(): Promise<string | null> {
  const supabase = await createServerSupabaseClient();
  const { data: { user } } = await supabase.auth.getUser();
  return user?.email?.toLowerCase() ?? null;
}

async function requireAdmin(): Promise<string | null> {
  const email = await sessionEmail();
  return email && isAdminEmail(email) ? email : null;
}

function todayStr(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

// NOTE: not exported — Next.js route modules may only export handlers/config.
// scripts/seed-sales-employees.ts carries its own copy.
function slugify(name: string): string {
  return name
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function isMissingTable(message: string | undefined): boolean {
  const m = (message ?? "").toLowerCase();
  return m.includes("42p01") || m.includes("does not exist") || m.includes("could not find the table");
}

/** Enrich a raw employee row with current_rates + rate_history. */
async function enrichEmployees(rows: SalesEmployee[]): Promise<SalesEmployeeWithRates[]> {
  if (!rows.length) return [];
  const db = getAdminClient();
  const ids = rows.map((r) => r.id);
  const { data: rates, error } = await db
    .from("sales_employee_commission_rates")
    .select("id, employee_id, service_rate, retail_rate, effective_from")
    .in("employee_id", ids)
    .order("effective_from", { ascending: false });
  if (error) throw new Error(error.message);

  const byEmployee = new Map<number, CommissionRate[]>();
  for (const r of (rates ?? []) as CommissionRate[]) {
    const rate: CommissionRate = {
      id: r.id,
      employee_id: r.employee_id,
      service_rate: Number(r.service_rate),
      retail_rate: Number(r.retail_rate),
      effective_from: r.effective_from,
    };
    const list = byEmployee.get(rate.employee_id!) ?? [];
    list.push(rate);
    byEmployee.set(rate.employee_id!, list);
  }

  const today = todayStr();
  return rows.map((emp) => {
    const history = byEmployee.get(emp.id) ?? [];
    return {
      ...emp,
      aliases: emp.aliases ?? [],
      current_rates: pickRate(history, today),
      rate_history: history,
    };
  });
}

async function loadEmployee(id: number): Promise<SalesEmployeeWithRates | null> {
  const db = getAdminClient();
  const { data, error } = await db
    .from("sales_employees")
    .select("*")
    .eq("id", id)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) return null;
  const [enriched] = await enrichEmployees([data as SalesEmployee]);
  return enriched ?? null;
}

/** GET /api/sales/employees?brand=spa — list employees with rates */
export async function GET(req: NextRequest) {
  const email = await sessionEmail();
  if (!email) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const brand = req.nextUrl.searchParams.get("brand");
  if (brand && !BRANDS.has(brand)) {
    return NextResponse.json({ error: `Invalid brand "${brand}"` }, { status: 400 });
  }

  const db = getAdminClient();
  let query = db.from("sales_employees").select("*").order("display_name", { ascending: true });
  if (brand) query = query.eq("brand_slug", brand);

  const { data, error } = await query;
  if (error) {
    if (isMissingTable(error.message)) {
      // Migration 073 not applied yet — let the UI show a setup banner
      return NextResponse.json(
        { error: error.message, migration_missing: true },
        { status: 500 },
      );
    }
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  try {
    const employees = await enrichEmployees((data ?? []) as SalesEmployee[]);
    return NextResponse.json({ employees });
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}

/** POST /api/sales/employees — create employee (+ optional initial rate row) */
export async function POST(req: NextRequest) {
  const admin = await requireAdmin();
  if (!admin) return NextResponse.json({ error: "Unauthorized" }, { status: 403 });

  let body: Record<string, unknown>;
  try { body = await req.json(); } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const displayName = String(body.display_name ?? "").trim();
  const brandSlug = String(body.brand_slug ?? "").trim();
  if (!displayName) return NextResponse.json({ error: "display_name is required" }, { status: 400 });
  if (!BRANDS.has(brandSlug)) {
    return NextResponse.json({ error: "brand_slug must be spa|aesthetics|slimming" }, { status: 400 });
  }
  const basis = body.commission_basis !== undefined ? String(body.commission_basis) : "ex_vat";
  if (!BASES.has(basis)) {
    return NextResponse.json({ error: "commission_basis must be ex_vat|inc_vat" }, { status: 400 });
  }

  const slug = (typeof body.slug === "string" && body.slug.trim())
    ? slugify(body.slug)
    : slugify(displayName);
  if (!slug) return NextResponse.json({ error: "Could not derive a slug" }, { status: 400 });

  const row = {
    slug,
    display_name: displayName,
    brand_slug: brandSlug,
    role: body.role != null ? String(body.role) : null,
    location_name: body.location_name != null ? String(body.location_name) : null,
    user_email: body.user_email != null ? String(body.user_email).toLowerCase() : null,
    is_active: body.is_active !== undefined ? Boolean(body.is_active) : true,
    aliases: Array.isArray(body.aliases) ? body.aliases.map(String) : [],
    commission_basis: basis,
    notes: body.notes != null ? String(body.notes) : null,
  };

  const db = getAdminClient();
  const { data, error } = await db.from("sales_employees").insert(row).select("*").single();
  if (error) {
    if (error.code === "23505") {
      return NextResponse.json({ error: `Slug "${slug}" already exists` }, { status: 409 });
    }
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  // Optional initial rate row
  const hasRates = body.service_rate !== undefined || body.retail_rate !== undefined;
  if (hasRates) {
    const { error: rateErr } = await db.from("sales_employee_commission_rates").insert({
      employee_id: (data as SalesEmployee).id,
      service_rate: Number(body.service_rate ?? 0),
      retail_rate: Number(body.retail_rate ?? 0),
      effective_from: typeof body.effective_from === "string" && body.effective_from
        ? body.effective_from
        : todayStr(),
    });
    if (rateErr) return NextResponse.json({ error: rateErr.message }, { status: 500 });
  }

  try {
    const employee = await loadEmployee((data as SalesEmployee).id);
    return NextResponse.json({ employee }, { status: 201 });
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}

/** PATCH /api/sales/employees — update mutable fields by id */
export async function PATCH(req: NextRequest) {
  const admin = await requireAdmin();
  if (!admin) return NextResponse.json({ error: "Unauthorized" }, { status: 403 });

  let body: Record<string, unknown>;
  try { body = await req.json(); } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const id = Number(body.id);
  if (!Number.isInteger(id) || id <= 0) {
    return NextResponse.json({ error: "Valid id is required" }, { status: 400 });
  }

  const updates: Record<string, unknown> = {};
  for (const field of MUTABLE_FIELDS) {
    if (!(field in body)) continue;
    const value = body[field];
    switch (field) {
      case "brand_slug":
        if (!BRANDS.has(String(value))) {
          return NextResponse.json({ error: "brand_slug must be spa|aesthetics|slimming" }, { status: 400 });
        }
        updates[field] = String(value);
        break;
      case "commission_basis":
        if (!BASES.has(String(value))) {
          return NextResponse.json({ error: "commission_basis must be ex_vat|inc_vat" }, { status: 400 });
        }
        updates[field] = String(value);
        break;
      case "slug":
        updates[field] = slugify(String(value));
        break;
      case "is_active":
        updates[field] = Boolean(value);
        break;
      case "aliases":
        if (!Array.isArray(value)) {
          return NextResponse.json({ error: "aliases must be an array" }, { status: 400 });
        }
        updates[field] = value.map(String);
        break;
      case "user_email":
        updates[field] = value != null && String(value).trim() ? String(value).toLowerCase().trim() : null;
        break;
      case "display_name":
        if (!String(value ?? "").trim()) {
          return NextResponse.json({ error: "display_name cannot be empty" }, { status: 400 });
        }
        updates[field] = String(value).trim();
        break;
      default:
        updates[field] = value != null ? String(value) : null;
    }
  }
  if (!Object.keys(updates).length) {
    return NextResponse.json({ error: "No mutable fields provided" }, { status: 400 });
  }
  updates.updated_at = new Date().toISOString();

  const db = getAdminClient();
  const { data, error } = await db
    .from("sales_employees")
    .update(updates)
    .eq("id", id)
    .select("*")
    .maybeSingle();
  if (error) {
    if (error.code === "23505") {
      return NextResponse.json({ error: "Slug already exists" }, { status: 409 });
    }
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  if (!data) return NextResponse.json({ error: "Employee not found" }, { status: 404 });

  try {
    const [employee] = await enrichEmployees([data as SalesEmployee]);
    return NextResponse.json({ employee });
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}

/** DELETE /api/sales/employees?id=N */
export async function DELETE(req: NextRequest) {
  const admin = await requireAdmin();
  if (!admin) return NextResponse.json({ error: "Unauthorized" }, { status: 403 });

  const id = Number(req.nextUrl.searchParams.get("id"));
  if (!Number.isInteger(id) || id <= 0) {
    return NextResponse.json({ error: "Valid id is required" }, { status: 400 });
  }

  const db = getAdminClient();
  // Rates cascade via FK ON DELETE CASCADE
  const { error } = await db.from("sales_employees").delete().eq("id", id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
