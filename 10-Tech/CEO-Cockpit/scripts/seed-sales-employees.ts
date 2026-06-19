/**
 * scripts/seed-sales-employees.ts
 *
 * Seeds the sales_employees registry from the last 12 months of revenue data:
 *   spa        → spa_services_by_employee_daily.employee_name
 *                + spa_retail_by_employee_daily.employee_name (tolerated missing)
 *   aesthetics → aesthetics_sales_daily.note_person
 *   slimming   → slimming_sales_daily.sales_staff
 *
 * Per brand: dedupe on normalizeName(), upsert one employee per distinct
 * normalized name with every raw sheet variant stored as an alias.
 * NO rate rows are seeded — commission shows "rates not set" until the CEO
 * enters real rates in Settings (design-doc invariant: no hard-coded rates).
 *
 * Idempotent: existing employees (matched by normalized display_name/alias,
 * or by slug) are skipped except for merging newly-seen alias variants.
 *
 * Run: npx tsx --env-file=.env.local scripts/seed-sales-employees.ts
 */

import { normalizeName } from "../lib/sales-employees/names";

const SUPABASE_URL =
  process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !SERVICE_KEY) {
  console.error("Missing SUPABASE_URL/NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY — run with --env-file=.env.local");
  process.exit(1);
}

const HEADERS: Record<string, string> = {
  apikey: SERVICE_KEY,
  Authorization: `Bearer ${SERVICE_KEY}`,
  "Content-Type": "application/json",
};

type BrandSlug = "spa" | "aesthetics" | "slimming";

// ── REST helpers (service-role, paged) ────────────────────────────────────────

async function restSelect<T>(
  table: string,
  params: Record<string, string>,
): Promise<T[]> {
  const PAGE = 1000;
  const all: T[] = [];
  for (let offset = 0; ; offset += PAGE) {
    const qs = new URLSearchParams({ ...params, limit: String(PAGE), offset: String(offset) });
    const resp = await fetch(`${SUPABASE_URL}/rest/v1/${table}?${qs}`, { headers: HEADERS });
    if (!resp.ok) {
      throw new Error(`select ${table} failed ${resp.status}: ${await resp.text()}`);
    }
    const data = (await resp.json()) as T[];
    all.push(...data);
    if (data.length < PAGE) break;
  }
  return all;
}

async function restInsert(table: string, row: Record<string, unknown>): Promise<void> {
  const resp = await fetch(`${SUPABASE_URL}/rest/v1/${table}`, {
    method: "POST",
    headers: { ...HEADERS, Prefer: "return=minimal" },
    body: JSON.stringify(row),
  });
  if (!resp.ok) throw new Error(`insert ${table} failed ${resp.status}: ${await resp.text()}`);
}

async function restPatch(
  table: string,
  id: number,
  patch: Record<string, unknown>,
): Promise<void> {
  const resp = await fetch(`${SUPABASE_URL}/rest/v1/${table}?id=eq.${id}`, {
    method: "PATCH",
    headers: { ...HEADERS, Prefer: "return=minimal" },
    body: JSON.stringify(patch),
  });
  if (!resp.ok) throw new Error(`patch ${table} failed ${resp.status}: ${await resp.text()}`);
}

// ── Name helpers ──────────────────────────────────────────────────────────────

function titleCase(normalized: string): string {
  return normalized
    .toLowerCase()
    .split(" ")
    .map((w) => (w ? w[0].toUpperCase() + w.slice(1) : w))
    .join(" ");
}

function slugify(name: string): string {
  return name
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function isMissingTable(message: string): boolean {
  const m = message.toLowerCase();
  return m.includes("42p01") || m.includes("does not exist") || m.includes("404");
}

// ── Source scans ──────────────────────────────────────────────────────────────

function dateStr(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

interface BrandNames {
  /** normalized name → set of raw variants seen in the data */
  [normalized: string]: Set<string>;
}

function collect(map: BrandNames, raw: string | null | undefined): void {
  const norm = normalizeName(raw);
  if (!norm) return;
  if (norm === "CARISMA (SALES)") return; // spa walk-in sales — not an employee
  if (!map[norm]) map[norm] = new Set();
  map[norm].add((raw ?? "").replace(/\s+/g, " ").trim());
}

async function scanBrandNames(from: string, to: string): Promise<Record<BrandSlug, BrandNames>> {
  const result: Record<BrandSlug, BrandNames> = { spa: {}, aesthetics: {}, slimming: {} };

  // restSelect can't express two filters on the same column (gte + lte) via a
  // Record — build the query string explicitly, paged in 1000-row chunks:
  const ranged = async <T>(table: string, select: string, dateCol: string): Promise<T[]> => {
    const PAGE = 1000;
    const all: T[] = [];
    for (let offset = 0; ; offset += PAGE) {
      const qs =
        `select=${encodeURIComponent(select)}` +
        `&${dateCol}=gte.${from}&${dateCol}=lte.${to}` +
        `&limit=${PAGE}&offset=${offset}`;
      const resp = await fetch(`${SUPABASE_URL}/rest/v1/${table}?${qs}`, { headers: HEADERS });
      if (!resp.ok) throw new Error(`select ${table} failed ${resp.status}: ${await resp.text()}`);
      const data = (await resp.json()) as T[];
      all.push(...data);
      if (data.length < PAGE) break;
    }
    return all;
  };

  // Spa — services + retail (retail table may not exist yet)
  for (const r of await ranged<{ employee_name: string | null }>(
    "spa_services_by_employee_daily", "employee_name", "date_of_service",
  )) {
    collect(result.spa, r.employee_name);
  }
  try {
    for (const r of await ranged<{ employee_name: string | null }>(
      "spa_retail_by_employee_daily", "employee_name", "date",
    )) {
      collect(result.spa, r.employee_name);
    }
  } catch (e) {
    if (!isMissingTable(String(e))) throw e;
    console.log("  (spa_retail_by_employee_daily missing — run migration 073 + the ETL, then re-seed to pick up retail-only names)");
  }

  // Aesthetics
  for (const r of await ranged<{ note_person: string | null }>(
    "aesthetics_sales_daily", "note_person", "date_of_service",
  )) {
    collect(result.aesthetics, r.note_person);
  }

  // Slimming
  for (const r of await ranged<{ sales_staff: string | null }>(
    "slimming_sales_daily", "sales_staff", "date_of_service",
  )) {
    collect(result.slimming, r.sales_staff);
  }

  return result;
}

// ── Main ──────────────────────────────────────────────────────────────────────

interface ExistingEmployee {
  id: number;
  slug: string;
  display_name: string;
  brand_slug: BrandSlug;
  aliases: string[] | null;
}

async function main(): Promise<void> {
  const now = new Date();
  const from = dateStr(new Date(now.getFullYear() - 1, now.getMonth(), now.getDate()));
  const to = dateStr(now);
  console.log(`Scanning revenue sources ${from} → ${to}…`);

  const brandNames = await scanBrandNames(from, to);
  for (const brand of ["spa", "aesthetics", "slimming"] as BrandSlug[]) {
    console.log(`  ${brand}: ${Object.keys(brandNames[brand]).length} distinct names`);
  }

  // Existing registry (for idempotency)
  let existing: ExistingEmployee[];
  try {
    existing = await restSelect<ExistingEmployee>("sales_employees", {
      select: "id,slug,display_name,brand_slug,aliases",
    });
  } catch (e) {
    if (isMissingTable(String(e))) {
      console.error("sales_employees table not found — apply supabase/migrations/073_create_sales_employees.sql first.");
      process.exit(1);
    }
    throw e;
  }
  const existingSlugs = new Set(existing.map((e) => e.slug));

  let created = 0, aliasMerged = 0, skipped = 0;

  for (const brand of ["spa", "aesthetics", "slimming"] as BrandSlug[]) {
    // normalized known name → employee, for this brand
    const knownByName = new Map<string, ExistingEmployee>();
    for (const emp of existing.filter((e) => e.brand_slug === brand)) {
      knownByName.set(normalizeName(emp.display_name), emp);
      for (const alias of emp.aliases ?? []) knownByName.set(normalizeName(alias), emp);
    }

    for (const [norm, variants] of Object.entries(brandNames[brand])) {
      const match = knownByName.get(norm);
      if (match) {
        // Merge raw variants not yet stored verbatim into the employee's aliases
        const verbatim = new Set(match.aliases ?? []);
        const toAdd = Array.from(variants).filter(
          (v) => !verbatim.has(v) && v !== match.display_name,
        );
        if (toAdd.length > 0) {
          const merged = Array.from(new Set([...(match.aliases ?? []), ...toAdd]));
          await restPatch("sales_employees", match.id, {
            aliases: merged,
            updated_at: new Date().toISOString(),
          });
          match.aliases = merged;
          aliasMerged++;
          console.log(`  ~ ${brand}: merged aliases into "${match.display_name}" (${toAdd.join(", ")})`);
        } else {
          skipped++;
        }
        continue;
      }

      // New employee
      const displayName = titleCase(norm);
      let slug = slugify(displayName);
      if (!slug) { skipped++; continue; }
      if (existingSlugs.has(slug)) slug = `${slug}-${brand}`; // cross-brand collision
      if (existingSlugs.has(slug)) { skipped++; continue; }   // still taken → leave for manual fix

      await restInsert("sales_employees", {
        slug,
        display_name: displayName,
        brand_slug: brand,
        is_active: true,
        aliases: Array.from(variants),
        commission_basis: "ex_vat",
        notes: "Seeded from revenue data — verify name/role and set commission rates.",
      });
      existingSlugs.add(slug);
      knownByName.set(norm, {
        id: -1, slug, display_name: displayName, brand_slug: brand,
        aliases: Array.from(variants),
      });
      created++;
      console.log(`  + ${brand}: created "${displayName}" (${slug}) aliases=[${Array.from(variants).join(", ")}]`);
    }
  }

  console.log(`\nDone — created ${created}, alias-merged ${aliasMerged}, unchanged ${skipped}.`);
  console.log("No commission rates were seeded — set them in Settings → Sales Employees.");
}

main().catch((e) => {
  console.error(String(e));
  process.exit(1);
});
