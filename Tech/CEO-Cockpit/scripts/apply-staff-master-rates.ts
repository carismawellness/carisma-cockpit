/**
 * apply-staff-master-rates.ts
 *
 * Reads commission rates from the Salary Master > Staff master sheet
 * (already read manually — hardcoded below), matches each active employee
 * to the seeded sales_employees rows in Supabase, and:
 *
 *  1. Upserts one commission rate row with effective_from = 2025-01-01
 *     (covers all revenue data we have ingested)
 *  2. Updates employee_type (therapist | advisor | management) and role title
 *
 * Rate columns used per brand:
 *   spa        → service_rate = col T (or col S for pure management), retail = col U
 *   aesthetics → service_rate = col X (or col T for doctors),         retail = col U
 *   slimming   → service_rate = col Y,                                retail = col U
 *
 * Run: npx tsx --env-file=.env.local scripts/apply-staff-master-rates.ts
 */

import { createClient } from "@supabase/supabase-js";

const SUPA_URL   = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const SUPA_KEY   = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const EFFECTIVE_FROM = "2025-01-01";

if (!SUPA_URL || !SUPA_KEY) {
  console.error("Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY");
  process.exit(1);
}

const supa = createClient(SUPA_URL, SUPA_KEY);

// ── Staff master data ────────────────────────────────────────────────────────
// Source: Salary Master Sheet > "Staff master" tab, Active employees only.
// Fields: n=normalized name (uppercase), type, role_title,
//   sp=spa service rate (col T, or col S for pure management),
//   ae=aesthetics service rate (col X, or col T for doctors),
//   sl=slimming service rate (col Y),
//   r=retail/product rate (col U — same across brands)

type StaffEntry = {
  n: string;                                       // normalized uppercase name
  type: "therapist" | "advisor" | "management";
  role: string;
  sp: number;   // service rate applied when this employee matches a spa row
  ae: number;   // service rate applied when matches an aesthetics row
  sl: number;   // service rate applied when matches a slimming row
  r: number;    // retail/product rate (same for all brands)
};

const STAFF: StaffEntry[] = [
  // ── SPA / mixed roles ──────────────────────────────────────────────────
  { n:"MILENA LAZOROVA",           type:"therapist",  role:"Trainer Therapist",  sp:0.0700, ae:0.0600, sl:0.0000, r:0.1500 },
  { n:"ANNA MARIA MIRISOLA",       type:"management", role:"Regional Manager",   sp:0.0150, ae:0.0300, sl:0.0300, r:0.1500 },
  { n:"NI MADE ETY DIANTARI",      type:"therapist",  role:"Therapist",          sp:0.0600, ae:0.0300, sl:0.0000, r:0.1500 },
  { n:"NI MADE SUDARMINI",         type:"therapist",  role:"Therapist",          sp:0.0600, ae:0.0600, sl:0.0000, r:0.1500 },
  { n:"MELANIE MITIC VELLA",       type:"management", role:"Regional Manager",   sp:0.0150, ae:0.0300, sl:0.0300, r:0.1500 },
  { n:"NELI RADEVA",               type:"management", role:"Regional Manager",   sp:0.0150, ae:0.0300, sl:0.0300, r:0.1500 },
  { n:"CINDY LORENA VARON PRIETO", type:"therapist",  role:"Therapist",          sp:0.0450, ae:0.0300, sl:0.0000, r:0.1500 },
  { n:"CINDY VARON",               type:"therapist",  role:"Therapist",          sp:0.0450, ae:0.0300, sl:0.0000, r:0.1500 },
  { n:"TAMARA VIDEC",              type:"therapist",  role:"Therapist",          sp:0.0600, ae:0.0300, sl:0.0000, r:0.1500 },
  { n:"KRISTINAA ALISAUSKAITE",    type:"therapist",  role:"Supervisor",         sp:0.0600, ae:0.0300, sl:0.0000, r:0.1500 },
  { n:"KRISTINA ALISAUSKAITE",     type:"therapist",  role:"Supervisor",         sp:0.0600, ae:0.0300, sl:0.0000, r:0.1500 },
  { n:"NATASHA MARJANOVIC",        type:"therapist",  role:"Supervisor",         sp:0.0700, ae:0.0300, sl:0.0000, r:0.1500 },
  { n:"VALERI KISEEV",             type:"therapist",  role:"Trainer Therapist",  sp:0.0600, ae:0.0300, sl:0.0000, r:0.1500 },
  { n:"SINAN TEFIK",               type:"management", role:"Management",         sp:0.0000, ae:0.0300, sl:0.0300, r:0.1500 },
  { n:"LOVELY SISON",              type:"therapist",  role:"Therapist",          sp:0.0450, ae:0.0300, sl:0.0000, r:0.1500 },
  { n:"NATASHA NAUMCHESKA",        type:"therapist",  role:"Therapist",          sp:0.0600, ae:0.0300, sl:0.0000, r:0.1500 },
  { n:"SEBASTIJAN LOMSEK",         type:"therapist",  role:"Therapist",          sp:0.0300, ae:0.0300, sl:0.0000, r:0.1500 },
  { n:"LAURA CAMILA",              type:"therapist",  role:"Therapist",          sp:0.0450, ae:0.0300, sl:0.0000, r:0.1500 },
  { n:"LOURDES M. DE LEON",        type:"therapist",  role:"Therapist",          sp:0.0300, ae:0.0300, sl:0.0000, r:0.1500 },
  { n:"LOURDES M DE LEON",         type:"therapist",  role:"Therapist",          sp:0.0300, ae:0.0300, sl:0.0000, r:0.1500 },
  { n:"LOURDES DE LEON",           type:"therapist",  role:"Therapist",          sp:0.0300, ae:0.0300, sl:0.0000, r:0.1500 },
  { n:"BENJAWAN PHEREEWONG",       type:"therapist",  role:"Therapist",          sp:0.0300, ae:0.0300, sl:0.0000, r:0.1500 },
  { n:"RUKSANA SHAKIR",            type:"management", role:"Management",         sp:0.0000, ae:0.0300, sl:0.0000, r:0.1500 },
  { n:"CLAUDIA GARCIA",            type:"therapist",  role:"Therapist",          sp:0.0300, ae:0.0300, sl:0.0300, r:0.1500 },
  { n:"KARLA CABRERA",             type:"therapist",  role:"Therapist",          sp:0.0300, ae:0.0300, sl:0.0300, r:0.1500 },
  { n:"ALANA DONOVAN",             type:"advisor",    role:"Spa Advisor",        sp:0.0000, ae:0.0000, sl:0.0000, r:0.1500 },
  { n:"MATILDE RICORDA",           type:"therapist",  role:"Therapist",          sp:0.0300, ae:0.0300, sl:0.0300, r:0.1500 },
  { n:"JANEJIRA KHOCHASANEE",      type:"therapist",  role:"Therapist",          sp:0.0600, ae:0.0300, sl:0.0300, r:0.1500 },
  { n:"PAKINEE KRIAMTHAISONG",     type:"therapist",  role:"Therapist",          sp:0.0450, ae:0.0300, sl:0.0000, r:0.1500 },
  { n:"CHRISTOPHER RYON OBIEN",    type:"therapist",  role:"Therapist",          sp:0.0450, ae:0.0300, sl:0.0300, r:0.1500 },
  { n:"CHRISTOPHER OBIEN",         type:"therapist",  role:"Therapist",          sp:0.0450, ae:0.0300, sl:0.0300, r:0.1500 },
  { n:"RITA SMITH AZIAH",          type:"therapist",  role:"Therapist",          sp:0.0508, ae:0.0254, sl:0.0254, r:0.1500 },
  { n:"RITA AZIAH",                type:"therapist",  role:"Therapist",          sp:0.0508, ae:0.0254, sl:0.0254, r:0.1500 },
  { n:"NATALIA ROMERO",            type:"advisor",    role:"Advisor",            sp:0.0000, ae:0.0000, sl:0.0000, r:0.1500 },
  { n:"NATHALIA BARRETO",          type:"advisor",    role:"Advisor",            sp:0.0000, ae:0.0000, sl:0.0000, r:0.1500 },
  { n:"TESSA LAURIO",              type:"therapist",  role:"Therapist",          sp:0.0450, ae:0.0300, sl:0.0300, r:0.1500 },
  { n:"SUJINDA PHEREEWONG",        type:"therapist",  role:"Therapist",          sp:0.0300, ae:0.0300, sl:0.0300, r:0.1500 },
  { n:"SUJINDA. PHEREEWONG",       type:"therapist",  role:"Therapist",          sp:0.0300, ae:0.0300, sl:0.0300, r:0.1500 },
  { n:"ELIZABETA ZDRAVKOV",        type:"therapist",  role:"Therapist",          sp:0.0600, ae:0.0300, sl:0.0300, r:0.1500 },
  { n:"BLAGOJCHE DAMEVSKI",        type:"therapist",  role:"Therapist",          sp:0.0600, ae:0.0300, sl:0.0300, r:0.1500 },
  { n:"MAILA MAILA",               type:"advisor",    role:"Advisor",            sp:0.0000, ae:0.0000, sl:0.0000, r:0.1500 },
  { n:"SOFIA GONZALEZ FERNANDEZ",  type:"advisor",    role:"Advisor",            sp:0.0000, ae:0.0000, sl:0.0000, r:0.1500 },
  { n:"SOFIA GONZALEZ",            type:"advisor",    role:"Advisor",            sp:0.0000, ae:0.0000, sl:0.0000, r:0.1500 },
  { n:"KUNYAPAK PHONSING",         type:"therapist",  role:"Therapist",          sp:0.0300, ae:0.0300, sl:0.0000, r:0.1500 },
  { n:"SYLVIA ARANA GAA",          type:"therapist",  role:"Therapist",          sp:0.0450, ae:0.0300, sl:0.0300, r:0.1500 },
  { n:"MARIVIC ARANA CLAVO",       type:"therapist",  role:"Therapist",          sp:0.0600, ae:0.0300, sl:0.0300, r:0.1500 },
  { n:"MANDAR RAJESH TALELE",      type:"management", role:"Management",         sp:0.0000, ae:0.0300, sl:0.0000, r:0.1500 },
  { n:"MELISSA CASTELLINO",        type:"management", role:"Management",         sp:0.0000, ae:0.0300, sl:0.0000, r:0.1500 },
  { n:"VIVIANE ALEXANDRE",         type:"therapist",  role:"Therapist",          sp:0.0300, ae:0.0300, sl:0.0000, r:0.1500 },
  { n:"VANESSA ESCOBAR",           type:"therapist",  role:"Therapist",          sp:0.0450, ae:0.0300, sl:0.0000, r:0.1500 },
  { n:"KOMANG BUDARSI",            type:"therapist",  role:"Therapist",          sp:0.0300, ae:0.0300, sl:0.0000, r:0.1500 },
  { n:"MADE ANDORIANI",            type:"therapist",  role:"Therapist",          sp:0.0200, ae:0.0300, sl:0.0000, r:0.1500 },
  { n:"KAREN TOBONGBANUA",         type:"therapist",  role:"Therapist",          sp:0.0300, ae:0.0300, sl:0.0000, r:0.1500 },
  { n:"GIANNI MARCAL CASOTTI",     type:"management", role:"CRM",                sp:0.0300, ae:0.0300, sl:0.0300, r:0.1500 },
  { n:"GIANNI CASOTTI",            type:"management", role:"CRM",                sp:0.0300, ae:0.0300, sl:0.0300, r:0.1500 },
  { n:"MARIA OLIVEIRA",            type:"advisor",    role:"Advisor",            sp:0.0000, ae:0.0000, sl:0.0000, r:0.1500 },
  { n:"GULNAZ KHANAM",             type:"advisor",    role:"Advisor",            sp:0.0000, ae:0.0000, sl:0.0000, r:0.1500 },
  { n:"THAIS LIMA",                type:"therapist",  role:"Therapist",          sp:0.0254, ae:0.0254, sl:0.0000, r:0.1500 },
  { n:"WARAPORN PONGRAT",          type:"therapist",  role:"Therapist",          sp:0.0254, ae:0.0254, sl:0.0254, r:0.1500 },
  { n:"PATRICIA TOMEI",            type:"therapist",  role:"Therapist",          sp:0.0254, ae:0.0254, sl:0.0254, r:0.1271 },
  { n:"JULIANA DEVES",             type:"therapist",  role:"Therapist",          sp:0.0254, ae:0.0254, sl:0.0254, r:0.1271 },
  { n:"KEMI ONAKOYA",              type:"advisor",    role:"Advisor",            sp:0.0000, ae:0.0000, sl:0.0000, r:0.1271 },
  { n:"ANJA BOGDANOVIC",           type:"advisor",    role:"Advisor",            sp:0.0000, ae:0.0000, sl:0.0000, r:0.1271 },
  { n:"DEBORAH DEBORAH",           type:"therapist",  role:"Therapist",          sp:0.0254, ae:0.0254, sl:0.0254, r:0.1271 },
  { n:"SANGAY WANGMO",             type:"therapist",  role:"Therapist",          sp:0.0254, ae:0.0254, sl:0.0254, r:0.1271 },
  { n:"GLECILA DETICIO",           type:"therapist",  role:"Therapist",          sp:0.0254, ae:0.0254, sl:0.0254, r:0.1271 },
  { n:"DANIELA XAVIER",            type:"advisor",    role:"Advisor",            sp:0.0000, ae:0.0000, sl:0.0000, r:0.1271 },
  { n:"GABRIELY PRADO",            type:"advisor",    role:"Advisor",            sp:0.0000, ae:0.0000, sl:0.0000, r:0.1271 },
  { n:"IHEBEDDIN SLAMA",           type:"therapist",  role:"Therapist",          sp:0.0254, ae:0.0254, sl:0.0254, r:0.1271 },
  { n:"IGOR GOLUBOVIC",            type:"therapist",  role:"Therapist",          sp:0.0254, ae:0.0254, sl:0.0254, r:0.1500 },
  { n:"PRAISE UWAGBOE",            type:"advisor",    role:"Advisor",            sp:0.0000, ae:0.0000, sl:0.0000, r:0.1271 },
  { n:"AKAUKSHA BOQKAQ",           type:"therapist",  role:"Supervisor",         sp:0.0254, ae:0.0254, sl:0.0254, r:0.1271 },
  { n:"DORIENNE ELLUL",            type:"management", role:"CRM",                sp:0.0000, ae:0.0254, sl:0.0254, r:0.1271 },
  { n:"NICOLE BAST",               type:"management", role:"CRM",                sp:0.0000, ae:0.0254, sl:0.0254, r:0.1271 },
  { n:"JEAN RIVERA",               type:"advisor",    role:"Advisor",            sp:0.0000, ae:0.0000, sl:0.0000, r:0.1271 },
  { n:"SEEMA PRASAD",              type:"advisor",    role:"Advisor",            sp:0.0000, ae:0.0000, sl:0.0000, r:0.1271 },
  { n:"FAVIOLA ANDUEZA",           type:"therapist",  role:"Therapist",          sp:0.0254, ae:0.0254, sl:0.0254, r:0.1271 },
  { n:"MANNAN",                    type:"management", role:"Chief of Staff",     sp:0.0000, ae:0.0000, sl:0.0000, r:0.1271 },
  { n:"JOVANA MARKOVIC",           type:"advisor",    role:"Supervisor",         sp:0.0000, ae:0.0300, sl:0.0000, r:0.1500 },
  // ── Aesthetics practitioners ───────────────────────────────────────────
  { n:"LETICIA BONASSI",           type:"therapist",  role:"Aesthetics",         sp:0.0300, ae:0.0300, sl:0.0000, r:0.1500 },
  { n:"ADRIENE PAULA",             type:"therapist",  role:"Aesthetics",         sp:0.0300, ae:0.0450, sl:0.0000, r:0.1500 },
  { n:"KENDRA FARUGGIA",           type:"therapist",  role:"Aesthetics",         sp:0.0254, ae:0.0254, sl:0.0000, r:0.1271 },
  { n:"DR GIOVANNI",               type:"therapist",  role:"Aesthetics Doctor",  sp:0.0000, ae:0.4000, sl:0.0000, r:0.1271 },
  { n:"DR FRAN",                   type:"therapist",  role:"Aesthetics Doctor",  sp:0.0000, ae:0.3000, sl:0.0000, r:0.1271 },
  // ── Slimming practitioners ─────────────────────────────────────────────
  { n:"DIANA HERRERA",             type:"therapist",  role:"Slimming",           sp:0.0000, ae:0.0254, sl:0.0254, r:0.0847 },
  { n:"BRUNNA TAVARES",            type:"therapist",  role:"Slimming",           sp:0.0000, ae:0.0254, sl:0.0254, r:0.1271 },
  { n:"IVANA BOSKOVIC",            type:"therapist",  role:"Slimming",           sp:0.0000, ae:0.0000, sl:0.0000, r:0.1271 },
];

// ── Name normalization (mirrors lib/sales-employees/names.ts) ────────────────
function norm(s: string): string {
  return s.toUpperCase().replace(/\s+/g, " ").trim();
}

// Build lookup: normalized name → StaffEntry
const LOOKUP = new Map<string, StaffEntry>();
for (const e of STAFF) {
  LOOKUP.set(norm(e.n), e);
}

// ── Rate helpers ─────────────────────────────────────────────────────────────
function serviceRate(entry: StaffEntry, brand: string): number {
  if (brand === "aesthetics") return entry.ae;
  if (brand === "slimming")   return entry.sl;
  return entry.sp; // spa
}

// ── Main ─────────────────────────────────────────────────────────────────────
async function main() {
  console.log("Fetching all employees from Supabase…");
  const { data: employees, error } = await supa
    .from("sales_employees")
    .select("id, slug, display_name, brand_slug, aliases")
    .order("brand_slug")
    .order("display_name");

  if (error) { console.error("Fetch error:", error); process.exit(1); }
  console.log(`  ${employees.length} employees found.\n`);

  let matched = 0, ratesApplied = 0, typesUpdated = 0, missed = 0;

  for (const emp of employees) {
    const normalizedDisplay = norm(emp.display_name);
    const normalizedAliases: string[] = (emp.aliases || []).map(norm);

    // Find matching staff entry by display_name or any alias
    let entry = LOOKUP.get(normalizedDisplay);
    if (!entry) {
      for (const a of normalizedAliases) {
        entry = LOOKUP.get(a);
        if (entry) break;
      }
    }

    if (!entry) {
      missed++;
      continue;
    }

    matched++;
    const sRate = serviceRate(entry, emp.brand_slug);
    const rRate = entry.r;

    // Upsert commission rate (effective from 2025-01-01)
    const { error: rateErr } = await supa
      .from("sales_employee_commission_rates")
      .upsert(
        {
          employee_id:    emp.id,
          service_rate:   sRate,
          retail_rate:    rRate,
          effective_from: EFFECTIVE_FROM,
        },
        { onConflict: "employee_id,effective_from" },
      );

    if (rateErr) {
      console.error(`  Rate upsert failed for ${emp.display_name} (${emp.brand_slug}):`, rateErr.message);
    } else {
      ratesApplied++;
    }

    // Update employee_type and role
    const { error: typeErr } = await supa
      .from("sales_employees")
      .update({ employee_type: entry.type, role: entry.role })
      .eq("id", emp.id);

    if (typeErr) {
      console.error(`  Type update failed for ${emp.display_name}:`, typeErr.message);
    } else {
      typesUpdated++;
      console.log(
        `  ✓ ${emp.display_name.padEnd(35)} [${emp.brand_slug}] ` +
        `${entry.type.padEnd(12)} svc=${(sRate * 100).toFixed(2)}%  ret=${(rRate * 100).toFixed(2)}%`,
      );
    }
  }

  console.log("\n── Summary ─────────────────────────────────────────────────────");
  console.log(`  Matched:        ${matched} / ${employees.length}`);
  console.log(`  Rates applied:  ${ratesApplied}`);
  console.log(`  Types updated:  ${typesUpdated}`);
  console.log(`  Unmatched:      ${missed} (no staff-master entry — left unchanged)`);
  console.log("Done.");
}

main().catch((e) => { console.error(e); process.exit(1); });
