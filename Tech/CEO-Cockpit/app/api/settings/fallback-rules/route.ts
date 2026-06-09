import { NextRequest, NextResponse } from "next/server";
import { getAdminClient } from "@/lib/supabase/admin";

export const maxDuration = 60;

// ── Types ─────────────────────────────────────────────────────────────────────

type RuleType =
  | "ttm_spread"
  | "manual_annual"
  | "previous_month"
  | "quarterly_average"
  | "disabled";
const RULE_TYPES: RuleType[] = [
  "ttm_spread",
  "manual_annual",
  "previous_month",
  "quarterly_average",
  "disabled",
];
type Org = "spa" | "aesthetics";
const ORGS: Org[] = ["spa", "aesthetics"];

// ── Helpers ───────────────────────────────────────────────────────────────────

function isRuleType(v: unknown): v is RuleType {
  return typeof v === "string" && RULE_TYPES.includes(v as RuleType);
}
function isOrg(v: unknown): v is Org {
  return typeof v === "string" && ORGS.includes(v as Org);
}

function normalizeParams(
  rule_type: RuleType,
  rawParams: unknown,
  annual_amount: unknown,
): Record<string, unknown> {
  const params: Record<string, unknown> =
    rawParams && typeof rawParams === "object" && !Array.isArray(rawParams)
      ? { ...(rawParams as Record<string, unknown>) }
      : {};

  // Allow callers to pass annual_amount at the top level OR inside params.
  if (annual_amount !== undefined) {
    const n = Number(annual_amount);
    if (Number.isFinite(n)) params.annual_amount = n;
    else if (annual_amount === null || annual_amount === "") delete params.annual_amount;
  } else if (params.annual_amount !== undefined) {
    const n = Number(params.annual_amount);
    if (Number.isFinite(n)) params.annual_amount = n;
    else delete params.annual_amount;
  }

  // Manual annual: ensure a numeric amount exists.
  if (rule_type !== "manual_annual") {
    // Keep the value around in case the user toggles back, but it's ignored downstream.
  }
  return params;
}

// ── GET ───────────────────────────────────────────────────────────────────────
// List all rows, ordered by zoho_org then account_code.
// Optional ?org=spa|aesthetics filter, ?q= search across code/name, ?active=true|false
export async function GET(req: NextRequest) {
  const supabase = getAdminClient();
  const org    = req.nextUrl.searchParams.get("org");
  const search = req.nextUrl.searchParams.get("q") ?? "";
  const active = req.nextUrl.searchParams.get("active");

  let query = supabase
    .from("ebitda_fallback_rules")
    .select("*")
    .order("zoho_org")
    .order("account_code");

  if (org && isOrg(org)) query = query.eq("zoho_org", org);
  if (active === "true")  query = query.eq("active", true);
  if (active === "false") query = query.eq("active", false);
  if (search) {
    const like = `%${search}%`;
    query = query.or(`account_code.ilike.${like},account_name.ilike.${like}`);
  }

  const { data, error } = await query;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data);
}

// ── POST ──────────────────────────────────────────────────────────────────────
// Create a new fallback rule.
// Body: { zoho_org, account_code, account_name, rule_type?, active?, notes?, annual_amount?, params? }
export async function POST(req: NextRequest) {
  const supabase = getAdminClient();
  const body = await req.json().catch(() => null);
  if (!body || typeof body !== "object") {
    return NextResponse.json({ error: "invalid JSON body" }, { status: 400 });
  }

  const {
    zoho_org,
    account_code,
    account_name,
    rule_type = "ttm_spread",
    active = true,
    notes = null,
    annual_amount,
    params: rawParams,
  } = body as Record<string, unknown>;

  if (!isOrg(zoho_org)) {
    return NextResponse.json({ error: "zoho_org must be 'spa' or 'aesthetics'" }, { status: 400 });
  }
  if (typeof account_code !== "string" || !account_code.trim()) {
    return NextResponse.json({ error: "account_code is required" }, { status: 400 });
  }
  if (typeof account_name !== "string" || !account_name.trim()) {
    return NextResponse.json({ error: "account_name is required" }, { status: 400 });
  }
  if (!isRuleType(rule_type)) {
    return NextResponse.json({ error: "invalid rule_type" }, { status: 400 });
  }

  const params = normalizeParams(rule_type, rawParams, annual_amount);

  if (rule_type === "manual_annual") {
    const n = Number(params.annual_amount);
    if (!Number.isFinite(n) || n < 0) {
      return NextResponse.json(
        { error: "manual_annual requires a non-negative annual_amount" },
        { status: 400 },
      );
    }
  }

  const { data, error } = await supabase
    .from("ebitda_fallback_rules")
    .insert({
      zoho_org,
      account_code: account_code.trim(),
      account_name: account_name.trim(),
      rule_type,
      active: Boolean(active),
      notes: typeof notes === "string" ? notes : null,
      params,
    })
    .select()
    .single();

  if (error) {
    const status = error.code === "23505" ? 409 : 500; // unique violation
    return NextResponse.json({ error: error.message }, { status });
  }
  return NextResponse.json(data, { status: 201 });
}

// ── PATCH ─────────────────────────────────────────────────────────────────────
// Update one row. ?id=N, body has partial fields.
export async function PATCH(req: NextRequest) {
  const supabase = getAdminClient();
  const idParam = req.nextUrl.searchParams.get("id");
  const id = idParam ? parseInt(idParam, 10) : NaN;
  if (!Number.isFinite(id)) {
    return NextResponse.json({ error: "id query param required" }, { status: 400 });
  }

  const body = await req.json().catch(() => null);
  if (!body || typeof body !== "object") {
    return NextResponse.json({ error: "invalid JSON body" }, { status: 400 });
  }

  const updates: Record<string, unknown> = { updated_at: new Date().toISOString() };
  const b = body as Record<string, unknown>;

  if (b.zoho_org !== undefined) {
    if (!isOrg(b.zoho_org)) {
      return NextResponse.json({ error: "invalid zoho_org" }, { status: 400 });
    }
    updates.zoho_org = b.zoho_org;
  }
  if (b.account_code !== undefined) {
    if (typeof b.account_code !== "string" || !b.account_code.trim()) {
      return NextResponse.json({ error: "account_code cannot be empty" }, { status: 400 });
    }
    updates.account_code = b.account_code.trim();
  }
  if (b.account_name !== undefined) {
    if (typeof b.account_name !== "string" || !b.account_name.trim()) {
      return NextResponse.json({ error: "account_name cannot be empty" }, { status: 400 });
    }
    updates.account_name = b.account_name.trim();
  }
  if (b.rule_type !== undefined) {
    if (!isRuleType(b.rule_type)) {
      return NextResponse.json({ error: "invalid rule_type" }, { status: 400 });
    }
    updates.rule_type = b.rule_type;
  }
  if (b.active !== undefined) updates.active = Boolean(b.active);
  if (b.notes  !== undefined) updates.notes  = typeof b.notes === "string" ? b.notes : null;

  // Merge params/annual_amount with existing row so we don't clobber other keys.
  // We ALSO read existing when only rule_type changes, so we can drop a stale
  // annual_amount when the rule is no longer manual_annual.
  const needsParamMerge =
    b.params !== undefined ||
    b.annual_amount !== undefined ||
    updates.rule_type !== undefined;

  if (needsParamMerge) {
    const { data: existing, error: getErr } = await supabase
      .from("ebitda_fallback_rules")
      .select("rule_type, params")
      .eq("id", id)
      .single();
    if (getErr) return NextResponse.json({ error: getErr.message }, { status: 500 });

    const effectiveRuleType: RuleType = isRuleType(updates.rule_type)
      ? updates.rule_type
      : (existing.rule_type as RuleType);

    const merged: Record<string, unknown> = {
      ...((existing.params as Record<string, unknown> | null) ?? {}),
      ...(b.params && typeof b.params === "object" && !Array.isArray(b.params)
        ? (b.params as Record<string, unknown>)
        : {}),
    };

    if (b.annual_amount !== undefined) {
      if (b.annual_amount === null || b.annual_amount === "") {
        delete merged.annual_amount;
      } else {
        const n = Number(b.annual_amount);
        if (!Number.isFinite(n) || n < 0) {
          return NextResponse.json(
            { error: "annual_amount must be a non-negative number" },
            { status: 400 },
          );
        }
        merged.annual_amount = n;
      }
    }

    // When the effective rule isn't manual_annual, the stored amount is dead
    // weight and confuses the UI (it shows "(1,200.00)" next to a TTM rule).
    if (effectiveRuleType !== "manual_annual") {
      delete merged.annual_amount;
    }

    if (effectiveRuleType === "manual_annual") {
      const n = Number(merged.annual_amount);
      if (!Number.isFinite(n) || n < 0) {
        return NextResponse.json(
          { error: "manual_annual requires a non-negative annual_amount" },
          { status: 400 },
        );
      }
    }
    updates.params = merged;
  }

  const { data, error } = await supabase
    .from("ebitda_fallback_rules")
    .update(updates)
    .eq("id", id)
    .select()
    .single();

  if (error) {
    const status = error.code === "23505" ? 409 : 500;
    return NextResponse.json({ error: error.message }, { status });
  }
  return NextResponse.json(data);
}

// ── DELETE ────────────────────────────────────────────────────────────────────
// Hard delete one row by ?id=N.
export async function DELETE(req: NextRequest) {
  const supabase = getAdminClient();
  const idParam = req.nextUrl.searchParams.get("id");
  const id = idParam ? parseInt(idParam, 10) : NaN;
  if (!Number.isFinite(id)) {
    return NextResponse.json({ error: "id query param required" }, { status: 400 });
  }

  const { error } = await supabase
    .from("ebitda_fallback_rules")
    .delete()
    .eq("id", id);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
