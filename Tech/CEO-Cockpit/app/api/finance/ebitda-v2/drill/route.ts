/**
 * /api/finance/ebitda-v2/drill
 *
 * Query params:
 *   venue, ebitda_line, date_from, date_to (required)
 *   ebitda_sub_line  optional — filter to specific SGA sub-category
 *   wage_role        optional — when set, filter contacts to this role only
 *                    (e.g. "manager", "therapist", "reception", "crm", "unassigned")
 */

import { NextResponse } from "next/server";
import { createServerSupabaseClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

// ── Helpers ───────────────────────────────────────────────────────────────────

function basisLabel(ruleType: string | null, config: Record<string, unknown> | null): string {
  // "Tag" = transaction came in with a venue tag directly from Zoho (no split rule in zoho_coa_mapping).
  // Any rule_type means the ETL applied a split — show the rule, never "Tag".
  if (!ruleType) return "Tag";
  switch (ruleType) {
    case "equal":       return "Equal split";
    case "sales_ratio": return "Revenue split";
    case "salary_cost": return "Salary split";
    case "custom":
    case "custom_fixed": {
      if (!config) return "Fixed split";
      // Entries with a non-zero share
      const entries = Object.entries(config).filter(([, v]) => Number(v) > 0);
      if (entries.length === 1) {
        // Single-venue fixed allocation — show the venue
        return `Fixed (${entries[0][0]})`;
      }
      // Multi-venue — show each venue and its %
      const parts = entries.map(([k, v]) => `${k} ${v}%`).join(", ");
      return `Fixed: ${parts}`;
    }
    default: return ruleType.replace(/_/g, " ");
  }
}

// ── Main handler ──────────────────────────────────────────────────────────────

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const venue         = searchParams.get("venue");
  const ebitdaLine    = searchParams.get("ebitda_line");
  const ebitdaSubLine = searchParams.get("ebitda_sub_line");
  const wageRole      = searchParams.get("wage_role");    // filter wages to one role
  const adChannel     = searchParams.get("ad_channel");   // filter advertising to one channel
  const dateFrom      = searchParams.get("date_from");
  const dateTo        = searchParams.get("date_to");

  if (!venue || !ebitdaLine || !dateFrom || !dateTo)
    return NextResponse.json({ error: "venue, ebitda_line, date_from, date_to required" }, { status: 400 });

  const supabase = await createServerSupabaseClient();

  // "__spa__" is the collapsed Spa aggregate — queries span all 8 venues
  const SPA_VENUE_SLUGS = ["intercontinental","hugos","hyatt","ramla","labranda","sunny_coast","excelsior","novotel"];
  const isSpaAgg = venue === "__spa__";

  // ── Hardwired rule check (skipped for Spa aggregate — rules are per-venue) ──
  if (!isSpaAgg) {
  const { data: hwRules } = await supabase
    .from("ebitda_v2_hardwired_rules")
    .select("rule_type, params, note")
    .eq("venue", venue)
    .eq("ebitda_line", ebitdaLine)
    .lte("effective_from", dateTo);

  const activeHw = (hwRules ?? []).find(
    (r: Record<string, unknown>) => !r.effective_to || (r.effective_to as string) >= dateFrom!
  );
  if (activeHw) {
    function parseLocalHw(s: string) { const [y,m,d]=s.split("-").map(Number); return new Date(y,m-1,d); }
    function dipHw(a: string, b: string) { return Math.round((parseLocalHw(b).getTime()-parseLocalHw(a).getTime())/86_400_000)+1; }
    const dip = dipHw(dateFrom!, dateTo!);
    const ruleType = activeHw.rule_type as string;
    const params   = ((activeHw.params ?? {}) as Record<string, number>);

    type BDRow = { account_code:string; account_name:string; rule_type:string; ttm_total:number; ttm_months:number; annualized:number; monthly_avg:number; days_in_period:number; value:number; formula:string };
    const breakdown: BDRow[] = [];

    if (ruleType === "fixed_monthly") {
      const monthly = params.monthly_amount ?? 0;
      const value   = monthly * (dip / 30.4375);
      breakdown.push({ account_code:"FIXED", account_name:"Fixed monthly rent", rule_type:ruleType, ttm_total:monthly*12, ttm_months:12, annualized:monthly*12, monthly_avg:monthly, days_in_period:dip, value:+value.toFixed(2), formula:`€${monthly.toFixed(0)}/month × ${dip}/30.4375 avg days = €${value.toFixed(0)}` });

    } else if (ruleType === "base_plus_revenue_pct") {
      const baseMonthly = params.base_monthly  ?? 0;
      const pct         = params.revenue_pct   ?? 0;

      // Fetch Cockpit revenue for this venue+period
      const LOC_SLUG_TO_ID: Record<string,number> = { intercontinental:1, hugos:2, hyatt:3, ramla:4, labranda:5, sunny_coast:6, excelsior:7, novotel:8 };
      const locId = LOC_SLUG_TO_ID[venue!];
      let cockpitRevenue = 0;
      if (locId) {
        const months: string[] = [];
        let y=parseInt(dateFrom!.slice(0,4),10), m=parseInt(dateFrom!.slice(5,7),10);
        const ey=parseInt(dateTo!.slice(0,4),10), em=parseInt(dateTo!.slice(5,7),10);
        while (y<ey||(y===ey&&m<=em)) { months.push(`${y}-${String(m).padStart(2,"0")}-01`); m++; if(m>12){m=1;y++;} }
        const { data: revRows } = await supabase.from("spa_revenue_monthly")
          .select("month, services, product_phytomer, product_purest, product_other")
          .eq("location_id", locId).in("month", months);
        for (const r of (revRows ?? [])) {
          const mStr=(r.month as string).slice(0,10), mY=+mStr.slice(0,4), mMo=+mStr.slice(5,7);
          const lastD=new Date(mY,mMo,0).getDate(), mEnd=`${mY}-${String(mMo).padStart(2,"0")}-${String(lastD).padStart(2,"0")}`;
          const rs=dateFrom!>mStr?dateFrom!:mStr, re=dateTo!<mEnd?dateTo!:mEnd;
          const dr=rs>re?0:Math.round((parseLocalHw(re).getTime()-parseLocalHw(rs).getTime())/86_400_000)+1;
          // services + product_* hold inc-VAT after migration 073. Divide for ex-VAT.
          const grossInc = Number(r.services??0)+Number(r.product_phytomer??0)+Number(r.product_purest??0)+Number(r.product_other??0);
          cockpitRevenue += (grossInc/1.18)*(dr/lastD);
        }
      }

      const baseValue = baseMonthly * (dip / 30.4375);
      const pctValue  = cockpitRevenue * (pct / 100);
      if (baseMonthly > 0) {
        breakdown.push({ account_code:"BASE", account_name:"Base rent", rule_type:"fixed_monthly", ttm_total:baseMonthly*12, ttm_months:12, annualized:baseMonthly*12, monthly_avg:baseMonthly, days_in_period:dip, value:+baseValue.toFixed(2), formula:`€${baseMonthly.toFixed(0)}/month × ${dip}/30.4375 avg days = €${baseValue.toFixed(0)}` });
      }
      breakdown.push({ account_code:"PCT", account_name:`Revenue share (${pct}% of Cockpit)`, rule_type:"revenue_pct", ttm_total:+cockpitRevenue.toFixed(2), ttm_months:0, annualized:0, monthly_avg:0, days_in_period:dip, value:+pctValue.toFixed(2), formula:`${pct}% × €${cockpitRevenue.toFixed(0)} Cockpit revenue = €${pctValue.toFixed(0)}` });
    }

    if (breakdown.length > 0) {
      const total = breakdown.reduce((s,r)=>s+r.value,0);
      return NextResponse.json({ is_fallback:true, total:+total.toFixed(2), fallback_breakdown:breakdown, contacts:[], transactions:[], wage_roles:[], ad_channels:[] });
    }

    // Unknown hardwired type — keep amber note as fallback
    return NextResponse.json({
      is_fallback:  true,
      fallback_note: `Value is based on a hardwired rule (${ruleType}). ${activeHw.note ?? ""}`.trim(),
      contacts: [], transactions: [], wage_roles: [], ad_channels: [],
    });
  }
  } // end !isSpaAgg hardwired check

  // ── Revenue cells: use spa_revenue_monthly (Cockpit), not transactions_raw ──
  // Revenue in V2 comes from the Google Sheet / Cockpit system, not from Zoho.
  // Zoho sales transactions in transactions_raw are double-counting noise that
  // should be excluded (sales accounts are excluded in COA mapping but the ETL
  // still writes income-section lines unless explicitly excluded).
  if (ebitdaLine === "revenue") {
    const LOC_SLUG_TO_ID: Record<string, number> = {
      intercontinental: 1, hugos: 2, hyatt: 3, ramla: 4,
      labranda: 5, sunny_coast: 6, excelsior: 7, novotel: 8,
    };
    const SPA_LOC_IDS = [1, 2, 3, 4, 5, 6, 7, 8];
    const locationId = isSpaAgg ? null : LOC_SLUG_TO_ID[venue!];
    if (!isSpaAgg && !locationId) {
      return NextResponse.json({ is_fallback: false, total: 0, contacts: [], transactions: [], wage_roles: [], ad_channels: [] });
    }

    const months: string[] = [];
    let y = parseInt(dateFrom!.slice(0, 4), 10), m = parseInt(dateFrom!.slice(5, 7), 10);
    const ey = parseInt(dateTo!.slice(0, 4), 10), em = parseInt(dateTo!.slice(5, 7), 10);
    while (y < ey || (y === ey && m <= em)) {
      months.push(`${y}-${String(m).padStart(2, "0")}-01`);
      m++; if (m > 12) { m = 1; y++; }
    }

    let revQuery = supabase
      .from("spa_revenue_monthly")
      .select("month, services, product_phytomer, product_purest, product_other, wholesale, sales_discount, sales_refund")
      .in("month", months);
    if (isSpaAgg) {
      revQuery = revQuery.in("location_id", SPA_LOC_IDS);
    } else {
      revQuery = revQuery.eq("location_id", locationId!);
    }
    const { data: revRows } = await revQuery;

    const txns: Array<Record<string, unknown>> = [];
    let total = 0;
    for (const r of (revRows ?? [])) {
      const mStr = (r.month as string).slice(0, 7);
      const mFull = mStr + "-01";
      const mY = parseInt(mStr.slice(0, 4), 10), mMo = parseInt(mStr.slice(5, 7), 10);
      const lastD = new Date(mY, mMo, 0).getDate();
      const mEnd  = `${mY}-${String(mMo).padStart(2, "0")}-${String(lastD).padStart(2, "0")}`;
      const rs = dateFrom! > mFull ? dateFrom! : mFull;
      const re = dateTo!   < mEnd  ? dateTo!   : mEnd;
      const parseL = (s: string) => { const [py,pm,pd]=s.split("-").map(Number); return new Date(py,pm-1,pd); };
      const daysInRange = rs > re ? 0 : Math.round((parseL(re).getTime()-parseL(rs).getTime())/86400000)+1;
      const dim = lastD;
      const f = daysInRange / dim;

      // services + product_* hold inc-VAT after migration 073. Divide for ex-VAT.
      const svc = (Number(r.services ?? 0) / 1.18) * f;
      const prd = ((Number(r.product_phytomer ?? 0) + Number(r.product_purest ?? 0) + Number(r.product_other ?? 0)) / 1.18) * f;
      const whl = Number(r.wholesale ?? 0) * f;
      const disc = Number(r.sales_discount ?? 0) * f;
      const ref  = Number(r.sales_refund ?? 0) * f;

      if (svc  > 0) { txns.push({ txn_id: `rev-svc-${mStr}`,  date: rs, contact: "—", account_code: "COCKPIT", account_name: "Services revenue",   txn_type: "cockpit", sub_line: "revenue", amount: +svc.toFixed(2),   source: "google_sheet" }); total += svc; }
      if (prd  > 0) { txns.push({ txn_id: `rev-prd-${mStr}`,  date: rs, contact: "—", account_code: "COCKPIT", account_name: "Products revenue",   txn_type: "cockpit", sub_line: "revenue", amount: +prd.toFixed(2),   source: "google_sheet" }); total += prd; }
      if (whl  > 0) { txns.push({ txn_id: `rev-whl-${mStr}`,  date: rs, contact: "—", account_code: "ZOHO",  account_name: "Wholesale",           txn_type: "zoho",  sub_line: "revenue", amount: +whl.toFixed(2),   source: "zoho" });         total += whl; }
      if (disc > 0) { txns.push({ txn_id: `rev-dsc-${mStr}`,  date: rs, contact: "—", account_code: "ZOHO",  account_name: "Sales discount",      txn_type: "zoho",  sub_line: "revenue", amount: +(-disc).toFixed(2), source: "zoho" });       total -= disc; }
      if (ref  > 0) { txns.push({ txn_id: `rev-ref-${mStr}`,  date: rs, contact: "—", account_code: "ZOHO",  account_name: "Sales refund",        txn_type: "zoho",  sub_line: "revenue", amount: +(-ref).toFixed(2),  source: "zoho" });       total -= ref; }
    }

    return NextResponse.json({
      is_fallback: false,
      total: +total.toFixed(2),
      contacts:     [{ contact: "Cockpit (Google Sheet)", amount: +total.toFixed(2), share: 100, source: "google_sheet", basis: "Google Sheet" }],
      transactions: txns,
      wage_roles:   [],
      ad_channels:  [],
    });
  }

  // ── Fetch transactions ────────────────────────────────────────────────────
  let query = supabase
    .from("transactions_raw")
    .select("txn_id, date, account_code, account_name, contact_name, transaction_type, ebitda_sub_line, amount, venue");

  if (isSpaAgg) {
    query = query.in("venue", SPA_VENUE_SLUGS);
  } else {
    query = query.eq("venue", venue!);
  }
  query = query
    .eq("ebitda_line", ebitdaLine!)
    .gte("date", dateFrom!)
    .lte("date", dateTo!)
    .order("date", { ascending: false });

  if (ebitdaSubLine) query = query.eq("ebitda_sub_line", ebitdaSubLine);

  const { data: rows, error } = await query;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  // mutable — wage_role and ad_channel filters may narrow this later
  let txnRows = (rows ?? []) as Array<Record<string, unknown>>;

  // ── Wage role mapping + supplement ─────────────────────────────────────────
  type SuppRow = { employee_name: string; amount: number; month: string; role?: string };
  let suppRows: SuppRow[] = [];
  let wageRoleMap = new Map<string, string>();

  if (ebitdaLine === "wages") {
    const { data: roleData } = await supabase.from("wage_role_mapping").select("contact_key, role");
    for (const r of (roleData ?? [])) {
      wageRoleMap.set((r.contact_key as string).toLowerCase().trim(), r.role as string);
    }

    // Build overlapping months — pure string arithmetic to avoid UTC/local timezone bugs
    const suppMonths: string[] = [];
    let curY = parseInt(dateFrom.slice(0, 4), 10), curM = parseInt(dateFrom.slice(5, 7), 10);
    const endY = parseInt(dateTo.slice(0, 4), 10),  endM = parseInt(dateTo.slice(5, 7), 10);
    while (curY < endY || (curY === endY && curM <= endM)) {
      suppMonths.push(`${curY}-${String(curM).padStart(2, "0")}-01`);
      curM++; if (curM > 12) { curM = 1; curY++; }
    }

    let sdQuery = supabase
      .from("salary_supplement_monthly")
      .select("month, employee_name, amount, role")
      .eq("is_frozen", true)
      .in("month", suppMonths);
    if (isSpaAgg) {
      sdQuery = sdQuery.in("spa_slug", SPA_VENUE_SLUGS);
    } else {
      sdQuery = sdQuery.eq("spa_slug", venue!);
    }
    const { data: sd } = await sdQuery;

    for (const s of (sd ?? [])) {
      const m     = (s.month as string).slice(0, 10);
      const mY    = parseInt(m.slice(0, 4), 10), mMo = parseInt(m.slice(5, 7), 10);
      const lastD = new Date(mY, mMo, 0).getDate();
      const mEnd  = `${mY}-${String(mMo).padStart(2, "0")}-${String(lastD).padStart(2, "0")}`;
      const rangeStart  = dateFrom! > m    ? dateFrom! : m;
      const rangeEnd    = dateTo!   < mEnd ? dateTo!   : mEnd;
      const parseLocal  = (s: string) => { const [y,mo,d] = s.split("-").map(Number); return new Date(y,mo-1,d); };
      const daysInRange = rangeStart > rangeEnd ? 0 : Math.round((parseLocal(rangeEnd).getTime() - parseLocal(rangeStart).getTime()) / 86_400_000) + 1;
      const daysInMonth = lastD;
      const prorated = Number(s.amount ?? 0) * (daysInRange / daysInMonth);
      if (prorated > 0) suppRows.push({
        employee_name: s.employee_name as string,
        amount: +prorated.toFixed(2),
        month: m,
        role: ((s.role as string) || "").toLowerCase().trim() || undefined,
      });
    }

    // ── Wage role filter — apply BEFORE any totals ──────────────────────────
    if (wageRole) {
      txnRows  = txnRows.filter(r => {
        const key = ((r.contact_name as string) || "").toLowerCase().trim();
        return (wageRoleMap.get(key) ?? "unassigned") === wageRole;
      });
      suppRows = suppRows.filter(s => {
        // Supplement role from frozen record only — not wage_role_mapping
        const role = (s.role || "unassigned");
        return role === wageRole;
      });
    }
  }

  // ── Ad channel patterns ────────────────────────────────────────────────────
  let adPatterns: Array<{ pattern: string; canonical: string }> = [];
  if (ebitdaLine === "advertising") {
    const { data: ap } = await supabase
      .from("advertising_contact_mapping")
      .select("pattern, canonical, priority")
      .order("priority");
    adPatterns = (ap ?? []) as Array<{ pattern: string; canonical: string }>;
  }
  const KNOWN_AD_CHANNELS = new Set(["meta", "google", "klaviyo"]);
  function resolveAdChannel(contact: string): string {
    const lower = contact.toLowerCase();
    for (const p of adPatterns) {
      if (lower.includes(p.pattern.toLowerCase())) {
        const ch = (p.canonical ?? "").toLowerCase();
        return KNOWN_AD_CHANNELS.has(ch) ? ch : "misc";
      }
    }
    return "misc";
  }

  // ── Ad channel filter — keep only contacts resolving to this channel ───────
  if (adChannel && ebitdaLine === "advertising") {
    txnRows = txnRows.filter(r =>
      resolveAdChannel((r.contact_name as string) || "") === adChannel
    );
  }

  // ── COA mapping → split basis ─────────────────────────────────────────────
  const uniqueCodes = [...new Set(txnRows.map(r => r.account_code as string).filter(Boolean))];
  const basisMap = new Map<string, string>(); // account_code → label

  if (uniqueCodes.length > 0) {
    // Determine org from venue (__spa__ and all individual Spa venues → "spa")
    const isAesthetics = ["aesthetics", "slimming"].includes(venue!);
    const org = isAesthetics ? "aesthetics" : "spa";

    const { data: coaRows } = await supabase
      .from("zoho_coa_mapping")
      .select("account_code, coa_split_rules(rule_type, config)")
      .in("account_code", uniqueCodes)
      .eq("zoho_org", org);

    for (const row of (coaRows ?? [])) {
      const sr = (row as Record<string, unknown>).coa_split_rules as Record<string, unknown> | null;
      const ruleType = (sr?.rule_type as string) ?? null;
      const config   = (sr?.config as Record<string, unknown>) ?? null;
      basisMap.set(row.account_code as string, basisLabel(ruleType, config));
    }
  }

  function txnBasis(r: Record<string, unknown>): string {
    const code = r.account_code as string;
    return basisMap.get(code) ?? "Tag";
  }

  // ── Totals ────────────────────────────────────────────────────────────────
  const suppTotal = suppRows.reduce((s, r) => s + r.amount, 0);
  const total = txnRows.reduce((s, r) => s + Number(r.amount ?? 0), 0) + suppTotal;

  // ── Fallback breakdown (when no actual transactions found) ────────────────
  // Recomputes the TTM/prev-month estimate for this venue+line so the drill
  // can show exactly how the figure was derived.
  //
  // Skip fallback when filtering by ad_channel or wage_role: total=0 means
  // no transactions for THAT channel specifically, not that the line is empty.
  // Showing advertising-wide TTM estimates on a Klaviyo-specific drill is
  // misleading — the user needs to see "no data" not "estimated €X".
  if (total === 0 && ebitdaLine !== "revenue" && !adChannel && !wageRole && !isSpaAgg) {
    function shiftMonthStr(d: string, n: number): string {
      let y = parseInt(d.slice(0, 4), 10), m = parseInt(d.slice(5, 7), 10);
      m += n;
      while (m > 12) { m -= 12; y++; }
      while (m < 1)  { m += 12; y--; }
      return `${y}-${String(m).padStart(2, "0")}-${d.slice(8, 10)}`;
    }
    function parseLocal(s: string) { const [y, mo, d2] = s.split("-").map(Number); return new Date(y, mo - 1, d2); }
    function daysBetweenStr(a: string, b: string) { return Math.round((parseLocal(b).getTime() - parseLocal(a).getTime()) / 86_400_000) + 1; }

    const dip = daysBetweenStr(dateFrom!, dateTo!);
    const ttmFrom = shiftMonthStr(dateFrom!, -12);
    const prevFrom = shiftMonthStr(dateFrom!, -1);
    const prevY = parseInt(prevFrom.slice(0, 4), 10), prevM = parseInt(prevFrom.slice(5, 7), 10);
    const daysInPrevMonth = new Date(prevY, prevM, 0).getDate();

    const { data: fbRules } = await supabase
      .from("ebitda_fallback_rules")
      .select("account_code, account_name, rule_type, params, active, zoho_org");
    const activeRules = ((fbRules ?? []) as Array<Record<string, unknown>>).filter(r => r.active);

    if (activeRules.length > 0) {
      const activeCodes = activeRules.map(r => r.account_code as string);
      const PAGE = 200;
      type HR = { account_code: string; date: string; amount: number };

      // TTM history for this venue + line
      const histAll: HR[] = [];
      for (let off = 0; off < 500_000; off += PAGE) {
        let histQ = supabase.from("transactions_raw")
          .select("account_code, date, amount")
          .eq("ebitda_line", ebitdaLine!)
          .in("account_code", activeCodes)
          .gte("date", ttmFrom).lt("date", dateFrom!)
          .order("date").order("account_code")
          .range(off, off + PAGE - 1);
        histQ = isSpaAgg ? histQ.in("venue", SPA_VENUE_SLUGS) : histQ.eq("venue", venue!);
        const { data: pg } = await histQ;
        if (!pg || pg.length === 0) break;
        histAll.push(...(pg as HR[]));
      }

      const codeMap = new Map<string, { ttm: number; months: Set<string> }>();
      for (const r of histAll) {
        const ex = codeMap.get(r.account_code) ?? { ttm: 0, months: new Set<string>() };
        ex.ttm += Number(r.amount ?? 0);
        ex.months.add(r.date.slice(0, 7));
        codeMap.set(r.account_code, ex);
      }

      // Previous month for previous_month rules
      const prevAll: HR[] = [];
      if (activeRules.some(r => r.rule_type === "previous_month")) {
        for (let off = 0; off < 500_000; off += PAGE) {
        let prevQ = supabase.from("transactions_raw")
            .select("account_code, date, amount")
            .eq("ebitda_line", ebitdaLine!)
            .in("account_code", activeCodes)
            .gte("date", prevFrom).lt("date", dateFrom!)
            .order("date")
            .range(off, off + PAGE - 1);
          prevQ = isSpaAgg ? prevQ.in("venue", SPA_VENUE_SLUGS) : prevQ.eq("venue", venue!);
          const { data: pg } = await prevQ;
          if (!pg || pg.length === 0) break;
          prevAll.push(...(pg as HR[]));
        }
      }
      const prevMap = new Map<string, number>();
      for (const r of prevAll) prevMap.set(r.account_code, (prevMap.get(r.account_code) ?? 0) + Number(r.amount ?? 0));

      // Build per-account breakdown
      type BDRow = {
        account_code: string; account_name: string; rule_type: string;
        ttm_total: number; ttm_months: number; annualized: number;
        monthly_avg: number; days_in_period: number; value: number; formula: string;
      };
      const breakdown: BDRow[] = [];
      let fbTotal = 0;
      const applied = new Set<string>();

      for (const rule of activeRules) {
        const code = rule.account_code as string;
        if (applied.has(code)) continue;
        const hist = codeMap.get(code);
        if (!hist || hist.ttm === 0) continue;
        applied.add(code);

        const actualMonths = Math.max(hist.months.size, 1);
        const annualized = (hist.ttm / actualMonths) * 12;
        const ruleType = rule.rule_type as string;
        let value = 0, formula = "";

        if (ruleType === "ttm_spread") {
          value = annualized * (dip / 365);
          formula = `€${hist.ttm.toFixed(0)} ÷ ${actualMonths}mo × 12 = €${annualized.toFixed(0)}/yr → × ${dip}/365 = €${value.toFixed(0)}`;
        } else if (ruleType === "previous_month") {
          const prev = prevMap.get(code) ?? 0;
          value = prev * (dip / daysInPrevMonth);
          formula = `Prev month €${prev.toFixed(0)} × ${dip}/${daysInPrevMonth} days = €${value.toFixed(0)}`;
        } else if (ruleType === "manual_annual") {
          const annual = ((rule.params ?? {}) as Record<string, number>).annual_amount ?? 0;
          value = annual * (dip / 365);
          formula = `Annual €${annual.toFixed(0)} × ${dip}/365 = €${value.toFixed(0)}`;
        }
        if (value <= 0) continue;
        fbTotal += value;
        breakdown.push({
          account_code: code,
          account_name: (rule.account_name as string) || code,
          rule_type: ruleType,
          ttm_total: +hist.ttm.toFixed(2),
          ttm_months: actualMonths,
          annualized: +annualized.toFixed(2),
          monthly_avg: +(annualized / 12).toFixed(2),
          days_in_period: dip,
          value: +value.toFixed(2),
          formula,
        });
      }

      if (breakdown.length > 0) {
        return NextResponse.json({
          is_fallback: true,
          total: +fbTotal.toFixed(2),
          fallback_breakdown: breakdown,
          contacts: [], transactions: [], wage_roles: [], ad_channels: [],
        });
      }
    }
  }

  // ── Contact breakdown ─────────────────────────────────────────────────────
  type ContactAcc = { zoho: number; supplement: number; bases: Set<string> };
  const contactMap = new Map<string, ContactAcc>();

  for (const r of txnRows) {
    const c = (r.contact_name as string) || "Unknown";
    const existing = contactMap.get(c) ?? { zoho: 0, supplement: 0, bases: new Set() };
    existing.zoho += Number(r.amount ?? 0);
    existing.bases.add(txnBasis(r));
    contactMap.set(c, existing);
  }
  for (const s of suppRows) {
    const existing = contactMap.get(s.employee_name) ?? { zoho: 0, supplement: 0, bases: new Set() };
    existing.supplement += s.amount;
    existing.bases.add("Supplement");
    contactMap.set(s.employee_name, existing);
  }

  const contacts = Array.from(contactMap.entries())
    .map(([contact, acc]) => {
      const amount  = acc.zoho + acc.supplement;
      const role    = ebitdaLine === "wages"
        ? (() => {
            // For supplement-only contacts, use the supplement's role field
            const suppRole = suppRows.find(s => s.employee_name === contact)?.role;
            if (suppRole) return suppRole;
            return wageRoleMap.get(contact.toLowerCase().trim()) ?? "unassigned";
          })()
        : undefined;
      const source  = acc.zoho > 0 && acc.supplement > 0 ? "both"
                    : acc.supplement > 0                  ? "salary_supplement"
                    :                                       "zoho";
      const basesArr = Array.from(acc.bases);
      const basis   = basesArr.length === 1 ? basesArr[0] : "Mixed";
      return {
        contact, amount: +amount.toFixed(2),
        share: total > 0 ? +(amount / total * 100).toFixed(1) : 0,
        role, source, basis,
        zoho_amount: +acc.zoho.toFixed(2),
        supplement_amount: +acc.supplement.toFixed(2),
      };
    })
    .sort((a, b) => Math.abs(b.amount) - Math.abs(a.amount));

  // ── Wage roles breakdown ──────────────────────────────────────────────────
  const wageRoleAcc = new Map<string, number>();
  if (ebitdaLine === "wages") {
    for (const r of txnRows) {
      const key  = ((r.contact_name as string) || "").toLowerCase().trim();
      const role = wageRoleMap.get(key) ?? "unassigned";
      wageRoleAcc.set(role, (wageRoleAcc.get(role) ?? 0) + Number(r.amount ?? 0));
    }
    for (const s of suppRows) {
      // Supplement role from frozen record only
      const role = (s.role || "unassigned");
      wageRoleAcc.set(role, (wageRoleAcc.get(role) ?? 0) + s.amount);
    }
  }
  const wageRoles = Array.from(wageRoleAcc.entries())
    .map(([role, amount]) => ({ role, amount: +amount.toFixed(2), share: total > 0 ? +(amount / total * 100).toFixed(1) : 0 }))
    .sort((a, b) => Math.abs(b.amount) - Math.abs(a.amount));

  // ── Ad channels breakdown ─────────────────────────────────────────────────
  const adChannelAcc = new Map<string, number>();
  if (ebitdaLine === "advertising") {
    for (const r of txnRows) {
      const ch = resolveAdChannel((r.contact_name as string) || "");
      adChannelAcc.set(ch, (adChannelAcc.get(ch) ?? 0) + Number(r.amount ?? 0));
    }
  }
  const adChannels = Array.from(adChannelAcc.entries())
    .map(([channel, amount]) => ({ channel, amount: +amount.toFixed(2), share: total > 0 ? +(amount / total * 100).toFixed(1) : 0 }))
    .sort((a, b) => Math.abs(b.amount) - Math.abs(a.amount));

  // ── Individual transactions ───────────────────────────────────────────────
  const transactions = [
    ...txnRows.map(r => ({
      txn_id:       r.txn_id as string,
      date:         r.date as string,
      contact:      (r.contact_name as string) || "—",
      account_code: r.account_code as string,
      account_name: r.account_name as string,
      txn_type:     r.transaction_type as string,
      sub_line:     r.ebitda_sub_line as string,
      amount:       +Number(r.amount ?? 0).toFixed(2),
      source:       "zoho",
      basis:        txnBasis(r),
    })),
    ...suppRows.map(s => ({
      txn_id:       `supp-${s.month}-${s.employee_name}`,
      date:         s.month.slice(0, 10),
      contact:      s.employee_name,
      account_code: "SUPPLEMENT",
      account_name: "Salary Supplement",
      txn_type:     "salary_supplement",
      sub_line:     "wages",
      amount:       s.amount,
      source:       "salary_supplement",
      basis:        "Supplement",
    })),
  ];

  return NextResponse.json({
    is_fallback: false,
    total: +total.toFixed(2),
    wage_role_filter: wageRole ?? null,
    contacts, transactions, wage_roles: wageRoles, ad_channels: adChannels,
  });
}
