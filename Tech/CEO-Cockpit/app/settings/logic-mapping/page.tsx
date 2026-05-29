"use client";

import { DashboardShell } from "@/components/dashboard/DashboardShell";
import { Card } from "@/components/ui/card";
import { chartColors } from "@/lib/charts/config";

/* ------------------------------------------------------------------ */
/*  Logic Mapping — a "where does this number come from" reference     */
/*  Update this page whenever a new data source, calculation, or       */
/*  hardcoded constant is added to the cockpit.                        */
/* ------------------------------------------------------------------ */

interface SourceRow {
  source: string;
  provides: string;
  usedBy: string;
  status: "Live" | "Pending" | "Placeholder";
}

const DATA_SOURCES: SourceRow[] = [
  { source: "Zoho Books",     provides: "Revenue, COGS, Salaries, Rent, SG&A per location (monthly)", usedBy: "EBITDA, CRM, Finance dashboards", status: "Live" },
  { source: "Supabase",       provides: "Auth, ETL state, computed tables", usedBy: "All pages (auth gate); ETL pipelines", status: "Live" },
  { source: "Meta Ads API",   provides: "Ad spend, leads, ROAS per campaign / brand", usedBy: "Marketing dashboards, Funnel, P&L Advertising row", status: "Pending" },
  { source: "Google Ads API", provides: "Ad spend, leads, conversions", usedBy: "Marketing dashboards, P&L Advertising row", status: "Pending" },
  { source: "Klaviyo API",    provides: "Email subscribers, campaign performance", usedBy: "Email reporting, P&L Advertising row", status: "Live" },
  { source: "Fresha",         provides: "Bookings, occupancy, practitioner availability", usedBy: "Operations dashboards (planned)", status: "Pending" },
  { source: "Talexio",        provides: "HR / payroll", usedBy: "HR dashboards", status: "Live" },
  { source: "GHL CRM (Spa)",  provides: "Leads, opportunities, tasks", usedBy: "CRM dashboards, setter queue", status: "Live" },
];

interface MetricRow {
  metric: string;
  formula: string;
  source: string;
  notes: string;
}

const EBITDA_METRICS: MetricRow[] = [
  { metric: "Net Revenue",      formula: "Σ Zoho revenue rows in date range",                    source: "Zoho",   notes: "Per venue, sum across selected months" },
  { metric: "Wages & Salaries", formula: "salaries × 0.89",                                       source: "Derived from Zoho salaries", notes: "89 % allocation; 8 % goes to COGS, 3 % to Utilities" },
  { metric: "COGS",             formula: "salaries × 0.08",                                       source: "Derived from Zoho salaries", notes: "Cost-redistribution split" },
  { metric: "Utilities",        formula: "salaries × 0.03",                                       source: "Derived from Zoho salaries", notes: "Cost-redistribution split" },
  { metric: "Advertising",      formula: "sga × 0.40",                                            source: "Derived from Zoho SG&A",     notes: "40 % of Zoho-reported SG&A is reclassified as advertising" },
  { metric: "SG&A",             formula: "sga × 0.60",                                            source: "Derived from Zoho SG&A",     notes: "Remaining 60 % stays as SG&A" },
  { metric: "Rent",             formula: "Zoho rent (passthrough) [+ surcharge]",                  source: "Zoho",   notes: "Per venue rent in lease terms. Novotel hardwired at €2,750/mo (never from Zoho), pro-rated. Excelsior = base rent + 5% of period net revenue" },
  { metric: "EBITDA",           formula: "revenue − wages − cogs − utilities − advertising − sga − rent", source: "Computed", notes: "Per venue and group" },
  { metric: "EBITDA Margin",    formula: "ebitda ÷ revenue × 100, rounded to whole %",            source: "Computed", notes: "Used in KPI cards, brand cards, and EBITDA % row" },
];

interface AllocationRow {
  category: string;
  weight: number;
}

const SGA_CATEGORIES: AllocationRow[] = [
  { category: "Prof services", weight: 20000 },
  { category: "Fuel",          weight: 5000 },
  { category: "Laundry",       weight: 50 },
  { category: "Software",      weight: 10 },
  { category: "Cleaning",      weight: 10 },
  { category: "Travel",        weight: 10 },
  { category: "Misc",          weight: 10 },
  { category: "Insurance",     weight: 8 },
  { category: "Events",        weight: 5 },
  { category: "Maintenance",   weight: 5 },
  { category: "Telecom",       weight: 2 },
];
const SGA_WEIGHT_TOTAL = SGA_CATEGORIES.reduce((a, c) => a + c.weight, 0);

const AD_CHANNELS: AllocationRow[] = [
  { category: "Meta",    weight: 55 },
  { category: "Google",  weight: 20 },
  { category: "Klaviyo", weight: 10 },
  { category: "Misc",    weight: 15 },
];

interface VenueMap {
  brand: "Spa" | "Aesthetics" | "Slimming";
  venues: string[];
  color: string;
}

const VENUE_MAP: VenueMap[] = [
  { brand: "Spa",        color: chartColors.spa,        venues: ["Inter", "Hugos", "Hyatt", "Ramla", "Excelsior", "Reviera", "Odycy", "Novotel"] },
  { brand: "Aesthetics", color: chartColors.aesthetics, venues: ["Aesthetics (single unit)"] },
  { brand: "Slimming",   color: chartColors.slimming,   venues: ["Slimming (single unit)"] },
];

interface FileRef {
  path: string;
  purpose: string;
}

const KEY_FILES: FileRef[] = [
  { path: "app/finance/ebitda/page.tsx",           purpose: "EBITDA Overview page (KPIs, brand cards, P&L by Venue, Contribution Waterfall)" },
  { path: "app/finance/ebitda/spa/page.tsx",       purpose: "Legacy: Spa EBITDA deep-dive (orphaned from nav, kept on disk)" },
  { path: "lib/constants/departments.ts",          purpose: "Sidebar navigation source of truth" },
  { path: "lib/charts/config.ts",                  purpose: "Brand color tokens + currency / percent formatters" },
  { path: "lib/hooks/useSpaEbitda.ts",             purpose: "Spa per-venue P&L hook (used by EBITDA Spa legacy page)" },
  { path: "lib/hooks/useAestheticsEbitda.ts",      purpose: "Aesthetics P&L hook" },
  { path: "app/settings/coa-mapping/page.tsx",     purpose: "Zoho CoA → EBITDA-line mapping editor" },
  { path: ".agents/skills/sga-categorization/",    purpose: "Skill: canonical SG&A category weights and allocation rule" },
];

interface ConstantRow {
  name: string;
  value: string;
  where: string;
}

const HARDCODED_CONSTANTS: ConstantRow[] = [
  { name: "Wages-from-salaries split",   value: "89 % wages, 8 % COGS, 3 % utilities", where: "app/finance/ebitda/page.tsx (buildVenueRows)" },
  { name: "SG&A-vs-advertising split",   value: "60 % SG&A, 40 % advertising",         where: "app/finance/ebitda/page.tsx (buildVenueRows)" },
  { name: "SG&A category weights",       value: "11 weights summing to 25,110",         where: "app/finance/ebitda/page.tsx (SGA_CATEGORIES) + sga-categorization skill" },
  { name: "Ad-channel split",            value: "55 % Meta, 20 % Google, 10 % Klaviyo, 15 % Misc (placeholder)", where: "app/finance/ebitda/page.tsx (adsExpanded block)" },
  { name: "EBITDA margin badge thresholds", value: "≥50 % green, ≥30 % amber, <30 % red", where: "app/finance/ebitda/page.tsx (EBITDA % row)" },
  { name: "Group EBITDA margin target",  value: "30 %",                                 where: "app/finance/ebitda/page.tsx (KPI cards)" },
  { name: "Novotel rent (hardwired)",     value: "€2,750 / month — never from Zoho; pro-rated for partial months", where: "app/api/finance/ebitda-aggregated/route.ts (SPA_FIXED_RENT_MONTHLY) — live page; legacy: lib/etl/spa-ebitda.ts + etl/*.py" },
  { name: "Excelsior rent surcharge",     value: "base rent + 5% of period net revenue", where: "app/api/finance/ebitda-aggregated/route.ts (SPA_REVENUE_RENT_SURCHARGE) — live page; legacy: lib/etl/spa-ebitda.ts + etl/*.py" },
];

/* ------------------------------------------------------------------ */
/*  Small table components                                             */
/* ------------------------------------------------------------------ */

function StatusBadge({ status }: { status: SourceRow["status"] }) {
  const cls =
    status === "Live"        ? "bg-emerald-100 text-emerald-800"
    : status === "Pending"   ? "bg-amber-100 text-amber-800"
    : "bg-slate-100 text-slate-700";
  return (
    <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${cls}`}>
      {status}
    </span>
  );
}

function SectionTable({ headers, children }: { headers: string[]; children: React.ReactNode }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr>
            {headers.map((h) => (
              <th key={h} className="text-left py-2 px-3 font-semibold text-muted-foreground border-b border-border">
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>{children}</tbody>
      </table>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Page                                                               */
/* ------------------------------------------------------------------ */

export default function LogicMappingPage() {
  return (
    <DashboardShell>
      {() => (
        <>
          <div>
            <h1 className="text-2xl font-bold text-foreground">Logic Mapping</h1>
            <p className="text-sm text-muted-foreground mt-1">
              Reference: where every number in the cockpit comes from. Update this page whenever a new data source,
              calculation, or hardcoded constant is added.
            </p>
          </div>

          {/* Data sources */}
          <Card className="p-3 md:p-6">
            <h2 className="text-lg font-semibold text-foreground mb-1">Data Sources</h2>
            <p className="text-xs text-muted-foreground mb-4">External systems the cockpit reads from.</p>
            <SectionTable headers={["Source", "Provides", "Used by", "Status"]}>
              {DATA_SOURCES.map((r) => (
                <tr key={r.source} className="border-b border-border last:border-0">
                  <td className="py-2 px-3 font-medium text-foreground">{r.source}</td>
                  <td className="py-2 px-3 text-foreground">{r.provides}</td>
                  <td className="py-2 px-3 text-muted-foreground">{r.usedBy}</td>
                  <td className="py-2 px-3"><StatusBadge status={r.status} /></td>
                </tr>
              ))}
            </SectionTable>
          </Card>

          {/* EBITDA metrics */}
          <Card className="p-3 md:p-6">
            <h2 className="text-lg font-semibold text-foreground mb-1">EBITDA P&amp;L Line Items</h2>
            <p className="text-xs text-muted-foreground mb-4">
              How each row in the P&amp;L by Venue table is computed. Cost-redistribution splits exist because Zoho&apos;s
              CoA does not yet map cleanly onto the 7-bucket EBITDA model.
            </p>
            <SectionTable headers={["Metric", "Formula", "Source", "Notes"]}>
              {EBITDA_METRICS.map((r) => (
                <tr key={r.metric} className="border-b border-border last:border-0">
                  <td className="py-2 px-3 font-medium text-foreground whitespace-nowrap">{r.metric}</td>
                  <td className="py-2 px-3 text-foreground font-mono text-xs">{r.formula}</td>
                  <td className="py-2 px-3 text-muted-foreground">{r.source}</td>
                  <td className="py-2 px-3 text-muted-foreground">{r.notes}</td>
                </tr>
              ))}
            </SectionTable>
          </Card>

          {/* SG&A categories */}
          <Card className="p-3 md:p-6">
            <h2 className="text-lg font-semibold text-foreground mb-1">SG&amp;A Sub-categories</h2>
            <p className="text-xs text-muted-foreground mb-4">
              Total SG&amp;A (Zoho SG&amp;A × 0.60) is split across these 11 categories by fixed weight until Zoho line-item
              CoA mapping is wired up. Each share = total × (weight ÷ {SGA_WEIGHT_TOTAL.toLocaleString()}).
            </p>
            <SectionTable headers={["Category", "Weight", "% of SG&A"]}>
              {SGA_CATEGORIES.map((r) => (
                <tr key={r.category} className="border-b border-border last:border-0">
                  <td className="py-2 px-3 font-medium text-foreground">{r.category}</td>
                  <td className="py-2 px-3 text-foreground font-mono text-xs">{r.weight.toLocaleString()}</td>
                  <td className="py-2 px-3 text-muted-foreground">
                    {Math.round((r.weight / SGA_WEIGHT_TOTAL) * 1000) / 10}%
                  </td>
                </tr>
              ))}
            </SectionTable>
            <p className="text-xs text-muted-foreground mt-3">
              Canonical definition lives in <code className="bg-muted px-1 py-0.5 rounded text-[11px]">.agents/skills/sga-categorization/SKILL.md</code>.
              Update both files together.
            </p>
          </Card>

          {/* Advertising channels */}
          <Card className="p-3 md:p-6">
            <h2 className="text-lg font-semibold text-foreground mb-1">Advertising Sub-channels</h2>
            <p className="text-xs text-muted-foreground mb-4">
              Placeholder allocation until Meta / Google / Klaviyo APIs are wired into the EBITDA page.
              GHL is no longer tracked as its own channel — any GHL (CRM / automation) contact now falls
              under Misc on the Advertising line.
            </p>
            <SectionTable headers={["Channel", "Allocation"]}>
              {AD_CHANNELS.map((r) => (
                <tr key={r.category} className="border-b border-border last:border-0">
                  <td className="py-2 px-3 font-medium text-foreground">{r.category}</td>
                  <td className="py-2 px-3 text-foreground font-mono text-xs">{r.weight}%</td>
                </tr>
              ))}
            </SectionTable>
            <p className="text-xs text-muted-foreground mt-3">
              Per-venue spend is computed by multiplying the venue&apos;s advertising total by the channel %. SPA venues
              share one Meta / Google ad account — when the API is wired, spend will be distributed across SPA venues
              by revenue share. Aesthetics and Slimming have their own ad accounts.
            </p>
          </Card>

          {/* Venue → brand map */}
          <Card className="p-3 md:p-6">
            <h2 className="text-lg font-semibold text-foreground mb-1">Venue → Brand Mapping</h2>
            <p className="text-xs text-muted-foreground mb-4">Which venues belong to which brand, and the canonical brand color used across the cockpit.</p>
            <div className="space-y-3">
              {VENUE_MAP.map((b) => (
                <div key={b.brand} className="flex items-start gap-3">
                  <span className="inline-flex items-center gap-1.5 min-w-[120px] pt-0.5">
                    <span className="inline-block h-2.5 w-2.5 rounded-full" style={{ backgroundColor: b.color }} />
                    <span className="font-medium text-foreground">{b.brand}</span>
                  </span>
                  <span className="text-sm text-muted-foreground">{b.venues.join(", ")}</span>
                </div>
              ))}
            </div>
          </Card>

          {/* Hardcoded constants */}
          <Card className="p-3 md:p-6">
            <h2 className="text-lg font-semibold text-foreground mb-1">Hardcoded Constants &amp; Thresholds</h2>
            <p className="text-xs text-muted-foreground mb-4">
              Magic numbers worth knowing. When a number stops feeling right, this is the index to find and edit it.
            </p>
            <SectionTable headers={["Constant", "Value", "Where defined"]}>
              {HARDCODED_CONSTANTS.map((r) => (
                <tr key={r.name} className="border-b border-border last:border-0">
                  <td className="py-2 px-3 font-medium text-foreground">{r.name}</td>
                  <td className="py-2 px-3 text-foreground">{r.value}</td>
                  <td className="py-2 px-3 text-muted-foreground font-mono text-xs">{r.where}</td>
                </tr>
              ))}
            </SectionTable>
          </Card>

          {/* Key files */}
          <Card className="p-3 md:p-6">
            <h2 className="text-lg font-semibold text-foreground mb-1">Key Files</h2>
            <p className="text-xs text-muted-foreground mb-4">Starting points when investigating where a number is produced.</p>
            <SectionTable headers={["Path", "Purpose"]}>
              {KEY_FILES.map((r) => (
                <tr key={r.path} className="border-b border-border last:border-0">
                  <td className="py-2 px-3 font-mono text-xs text-foreground">{r.path}</td>
                  <td className="py-2 px-3 text-muted-foreground">{r.purpose}</td>
                </tr>
              ))}
            </SectionTable>
          </Card>
        </>
      )}
    </DashboardShell>
  );
}
