"use client";

import { useMemo } from "react";
import { Users } from "lucide-react";
import { DashboardShell } from "@/components/dashboard/DashboardShell";
import { Card } from "@/components/ui/card";
import { useEbitdaAggregated, type LineItem } from "@/lib/hooks/useEbitdaAggregated";
import { SPA_LOCATION_META } from "@/lib/hooks/useSpaEbitda";
import { formatDateRangeLabel } from "@/lib/utils/mock-date-filter";
import {
  useWageRoles,
  resolveRole,
  WAGE_ROLES,
  WAGE_ROLE_LABEL,
  type WageRole,
} from "@/lib/hooks/useWageRoles";

/* ------------------------------------------------------------------ */
/*  EMPLOYEE MAPPING                                                   */
/*                                                                     */
/*  A double-click into the "Wages & Salaries" line item on the main  */
/*  EBITDA cockpit. For each venue we list every individual (the Zoho  */
/*  `contact` on each wage transaction) that was accounted for in the  */
/*  selected period, and the salary booked against them. Numbers come  */
/*  from the SAME /api/finance/ebitda-aggregated feed the cockpit uses */
/*  (category === "wages"), so the venue subtotals here reconcile      */
/*  exactly with the Wages & Salaries row on /finance/ebitda.          */
/* ------------------------------------------------------------------ */

type Brand = LineItem["brand"];

// Display label + colour for a wage line item's venue. SPA rows carry a real
// column-E venue (InterContinental, Hugos, …); AES/SLIM rows usually have an
// empty venue, so they collapse under the brand name; HQ is corporate payroll.
const BRAND_FALLBACK_LABEL: Record<Brand, string> = {
  SPA:  "Spa (unmapped)",
  AES:  "Aesthetics",
  SLIM: "Slimming",
  HQ:   "HQ",
};
const BRAND_COLOR: Record<Brand, string> = {
  SPA:  "#1B3A4B",
  AES:  "#B79E61",
  SLIM: "#8EB093",
  HQ:   "#64748B",
};

// SPA venue display name (lowercased) → its brand colour, so the per-venue
// cards reuse the same palette as the EBITDA dashboard's venue columns.
const SPA_VENUE_COLOR: Record<string, string> = Object.fromEntries(
  Object.values(SPA_LOCATION_META).map((m) => [m.name.toLowerCase(), m.color]),
);

// Stable venue ordering: known SPA venues first (in dashboard order), then the
// three brand-level buckets, then anything unexpected alphabetically.
const SPA_VENUE_ORDER = Object.values(SPA_LOCATION_META).map((m) => m.name);
const VENUE_ORDER = [...SPA_VENUE_ORDER, "Aesthetics", "Slimming", "HQ"];

const UNATTRIBUTED = "(Unattributed / allocated)";

interface EmployeeRow {
  name:        string;
  amount:      number;   // post-fallback period value (matches the cockpit)
  literal:     number;   // literal Zoho sum, for partial-period transparency
  accounts:    Set<string>;
  usedFallback: boolean;
}

interface VenueGroup {
  label:    string;
  color:    string;
  total:    number;
  literal:  number;
  employees: EmployeeRow[];
}

function venueLabelFor(li: LineItem): string {
  const venue = (li.venue || "").trim();
  if (venue) return venue;
  return BRAND_FALLBACK_LABEL[li.brand];
}

function venueColorFor(label: string, brand: Brand): string {
  return SPA_VENUE_COLOR[label.toLowerCase()] ?? BRAND_COLOR[brand];
}

const euro = new Intl.NumberFormat("en-GB", {
  style: "currency",
  currency: "EUR",
  minimumFractionDigits: 0,
  maximumFractionDigits: 0,
});
function fmtEuro(n: number) {
  return euro.format(Number.isFinite(n) ? n : 0);
}

function buildVenueGroups(lineItems: LineItem[]): VenueGroup[] {
  // venueLabel → contactName → EmployeeRow
  const byVenue = new Map<string, { color: string; emps: Map<string, EmployeeRow> }>();

  for (const li of lineItems) {
    if (li.ebitda_category !== "wages") continue;
    // Skip rows that contributed nothing either way — they'd just be noise.
    if (li.period_value === 0 && li.literal_sum === 0) continue;

    const label = venueLabelFor(li);
    const color = venueColorFor(label, li.brand);
    const name  = (li.contact || "").trim() || UNATTRIBUTED;

    let venue = byVenue.get(label);
    if (!venue) {
      venue = { color, emps: new Map() };
      byVenue.set(label, venue);
    }

    let emp = venue.emps.get(name);
    if (!emp) {
      emp = { name, amount: 0, literal: 0, accounts: new Set(), usedFallback: false };
      venue.emps.set(name, emp);
    }
    emp.amount  += li.period_value;
    emp.literal += li.literal_sum;
    if (li.account_name) emp.accounts.add(li.account_name);
    if (li.used_fallback) emp.usedFallback = true;
  }

  const groups: VenueGroup[] = [];
  for (const [label, venue] of byVenue) {
    const employees = Array.from(venue.emps.values())
      // Drop net-zero contacts (a positive + offsetting negative wash).
      .filter((e) => e.amount !== 0 || e.literal !== 0)
      .sort((a, b) => b.amount - a.amount);
    if (employees.length === 0) continue;
    groups.push({
      label,
      color: venue.color,
      total:   employees.reduce((s, e) => s + e.amount, 0),
      literal: employees.reduce((s, e) => s + e.literal, 0),
      employees,
    });
  }

  // Order venues by the canonical list, unknowns last (alphabetical).
  groups.sort((a, b) => {
    const ia = VENUE_ORDER.indexOf(a.label);
    const ib = VENUE_ORDER.indexOf(b.label);
    if (ia === -1 && ib === -1) return a.label.localeCompare(b.label);
    if (ia === -1) return 1;
    if (ib === -1) return -1;
    return ia - ib;
  });
  return groups;
}

/* ------------------------------------------------------------------ */
/*  CONTENT                                                            */
/* ------------------------------------------------------------------ */

// Role labels used for the per-venue mix summary, including the implicit
// Unassigned bucket so the percentages always sum to 100% of venue wages.
const ROLE_BUCKETS: { key: WageRole | "unassigned"; label: string; color: string }[] = [
  { key: "manager",      label: "Manager",      color: "#1B3A4B" },
  { key: "reception",    label: "Reception",    color: "#B79E61" },
  { key: "practitioner", label: "Practitioner", color: "#8EB093" },
  { key: "crm",          label: "CRM",          color: "#7C6FAE" },
  { key: "unassigned",   label: "Unassigned",   color: "#94A3B8" },
];

function EmployeeMappingContent({ dateFrom, dateTo }: { dateFrom: Date; dateTo: Date }) {
  const agg = useEbitdaAggregated(dateFrom, dateTo);
  const { roleByContact, setRole } = useWageRoles();

  const groups = useMemo(() => buildVenueGroups(agg.lineItems), [agg.lineItems]);

  // Per-venue role mix: for each venue, sum each employee's salary into the
  // bucket resolved from the role mapping (Unassigned for anyone unmapped).
  // The Unattributed/allocated line and any unmapped employee both land in
  // Unassigned so the buckets reconcile to the venue total exactly.
  const roleMixByVenue = useMemo(() => {
    const out: Record<string, { total: number; buckets: Record<string, number> }> = {};
    for (const g of groups) {
      const buckets: Record<string, number> = {
        manager: 0, reception: 0, practitioner: 0, crm: 0, unassigned: 0,
      };
      for (const e of g.employees) {
        const role = e.name === UNATTRIBUTED ? null : resolveRole(roleByContact, e.name);
        buckets[role ?? "unassigned"] += e.amount;
      }
      out[g.label] = { total: g.total, buckets };
    }
    return out;
  }, [groups, roleByContact]);

  const grandTotal = useMemo(() => groups.reduce((s, g) => s + g.total, 0), [groups]);
  const headcount  = useMemo(
    () => groups.reduce((s, g) => s + g.employees.filter((e) => e.name !== UNATTRIBUTED).length, 0),
    [groups],
  );
  const rangeLabel = useMemo(() => formatDateRangeLabel(dateFrom, dateTo), [dateFrom, dateTo]);

  // Whether any group has a fallback-estimated row — relevant on partial
  // periods where the cockpit smooths wages and exact per-person figures
  // are modelled rather than booked.
  const anyFallback = useMemo(() => groups.some((g) => g.employees.some((e) => e.usedFallback)), [groups]);

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-foreground flex items-center gap-2">
            <Users className="h-5 w-5 text-gold" />
            Employee Mapping
          </h1>
          <p className="text-sm text-muted-foreground mt-1 max-w-2xl">
            A double-click into <span className="font-medium text-foreground">Wages &amp; Salaries</span> on the
            EBITDA cockpit. Every individual booked to each venue&apos;s payroll for {rangeLabel}, straight from the
            same Zoho-backed feed — use it to sense-check who is being counted, and for how much.
          </p>
        </div>
        <div className="text-right shrink-0">
          <p className="text-xs text-muted-foreground uppercase tracking-wide">Total Wages &amp; Salaries</p>
          <p className="text-2xl font-bold text-foreground tabular-nums">{fmtEuro(grandTotal)}</p>
          <p className="text-xs text-muted-foreground">
            {headcount} named {headcount === 1 ? "person" : "people"} · {groups.length} venues
          </p>
        </div>
      </div>

      {/* States */}
      {agg.error && (
        <Card className="p-4 border-red-200 bg-red-50/60 text-sm text-red-700">
          Failed to load wages data: {agg.error.message}
        </Card>
      )}

      {agg.isFetching && groups.length === 0 && (
        <div className="py-12 text-center text-sm text-muted-foreground animate-pulse">Loading payroll…</div>
      )}

      {!agg.isFetching && !agg.error && groups.length === 0 && (
        <Card className="p-8 text-center text-sm text-muted-foreground">
          No wages were booked to any venue in {rangeLabel}.
        </Card>
      )}

      {anyFallback && (
        <Card className="p-3 border-amber-200 bg-amber-50/60 text-xs text-amber-700">
          ⚠ This period is partial, so the cockpit estimates some wages via fallback rules. Rows marked{" "}
          <span className="font-medium">est.</span> are modelled (annualised / smoothed), not literal booked
          transactions — they reconcile with the cockpit total but won&apos;t match a single payslip.
        </Card>
      )}

      {/* Venue cards */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 lg:gap-6 items-start">
        {groups.map((g) => (
          <Card key={g.label} className="overflow-hidden">
            {/* Venue header */}
            <div className="flex items-center justify-between px-4 py-3 border-b border-border">
              <div className="flex items-center gap-2.5">
                <span className="inline-block h-3 w-3 rounded-full shrink-0" style={{ backgroundColor: g.color }} />
                <h2 className="text-base font-semibold text-foreground">{g.label}</h2>
              </div>
              <div className="text-right">
                <p className="text-sm font-bold text-foreground tabular-nums">{fmtEuro(g.total)}</p>
                <p className="text-[11px] text-muted-foreground">
                  {g.employees.filter((e) => e.name !== UNATTRIBUTED).length} people
                </p>
              </div>
            </div>

            {/* Employee table */}
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border/60">
                  <th className="text-left py-2 px-4 text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
                    Employee
                  </th>
                  <th className="text-left py-2 px-4 text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
                    Role
                  </th>
                  <th className="text-right py-2 px-4 text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
                    Salary
                  </th>
                </tr>
              </thead>
              <tbody>
                {g.employees.map((e) => {
                  const unattributed = e.name === UNATTRIBUTED;
                  const role = unattributed ? null : resolveRole(roleByContact, e.name);
                  return (
                    <tr key={e.name} className="border-b border-border/40 last:border-0 hover:bg-muted/30 transition-colors">
                      <td className="py-1.5 px-4">
                        <span className={unattributed ? "text-amber-600 italic" : "text-foreground"}>{e.name}</span>
                        {e.usedFallback && (
                          <span
                            className="ml-2 inline-flex items-center rounded-sm border border-amber-300 bg-amber-50 px-1 py-px text-[9px] font-medium text-amber-700"
                            title="Estimated via EBITDA fallback rule, not a literal booked amount"
                          >
                            est.
                          </span>
                        )}
                        {e.accounts.size > 0 && (
                          <span className="block text-[10px] text-muted-foreground/70 truncate max-w-[260px]">
                            {Array.from(e.accounts).join(" · ")}
                          </span>
                        )}
                      </td>
                      <td className="py-1.5 px-4 align-top">
                        {unattributed ? (
                          <span className="text-[11px] text-muted-foreground/70 italic">—</span>
                        ) : (
                          <select
                            value={role ?? ""}
                            onChange={(ev) =>
                              setRole.mutate({
                                contactName: e.name,
                                role: (ev.target.value || null) as WageRole | null,
                              })
                            }
                            disabled={setRole.isPending}
                            className={`text-xs border rounded px-2 py-1 bg-background disabled:opacity-50 ${
                              role ? "border-border text-foreground" : "border-amber-400 text-amber-700"
                            }`}
                          >
                            <option value="">Unassigned</option>
                            {WAGE_ROLES.map((r) => (
                              <option key={r} value={r}>{WAGE_ROLE_LABEL[r]}</option>
                            ))}
                          </select>
                        )}
                      </td>
                      <td className="py-1.5 px-4 text-right font-medium text-foreground tabular-nums align-top">
                        {fmtEuro(e.amount)}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
              <tfoot>
                <tr className="border-t-2 border-border bg-muted/20">
                  <td className="py-2 px-4 font-semibold text-foreground" colSpan={2}>
                    Total ({g.employees.length} {g.employees.length === 1 ? "line" : "lines"})
                  </td>
                  <td className="py-2 px-4 text-right font-bold text-foreground tabular-nums">{fmtEuro(g.total)}</td>
                </tr>
              </tfoot>
            </table>

            {/* Per-venue role mix — share of this venue's wages by role.
                Buckets sum to 100% (Unassigned absorbs unmapped people). */}
            {(() => {
              const mix = roleMixByVenue[g.label];
              if (!mix || mix.total === 0) return null;
              const visible = ROLE_BUCKETS.filter((b) => mix.buckets[b.key] !== 0);
              if (visible.length === 0) return null;
              return (
                <div className="px-4 py-3 border-t border-border/60 bg-muted/20">
                  <p className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground mb-2">
                    Role mix
                  </p>
                  {/* Stacked share bar */}
                  <div className="flex h-2 w-full overflow-hidden rounded-full mb-2">
                    {visible.map((b) => {
                      const pct = (mix.buckets[b.key] / mix.total) * 100;
                      return (
                        <span
                          key={b.key}
                          style={{ width: `${pct}%`, backgroundColor: b.color }}
                          title={`${b.label}: ${fmtEuro(mix.buckets[b.key])} (${Math.round(pct)}%)`}
                        />
                      );
                    })}
                  </div>
                  <div className="grid grid-cols-2 sm:grid-cols-3 gap-x-3 gap-y-1">
                    {visible.map((b) => {
                      const amt = mix.buckets[b.key];
                      const pct = Math.round((amt / mix.total) * 100);
                      return (
                        <div key={b.key} className="flex items-center justify-between text-[11px]">
                          <span className="flex items-center gap-1.5 text-muted-foreground">
                            <span className="inline-block h-2 w-2 rounded-full" style={{ backgroundColor: b.color }} />
                            {b.label}
                          </span>
                          <span className="tabular-nums text-foreground font-medium">{pct}%</span>
                        </div>
                      );
                    })}
                  </div>
                </div>
              );
            })()}
          </Card>
        ))}
      </div>

      {/* Reconciliation footnote */}
      {groups.length > 0 && (
        <p className="text-[11px] text-muted-foreground">
          Sourced from <code className="text-[10px]">/api/finance/ebitda-aggregated</code> (category{" "}
          <code className="text-[10px]">wages</code>) — the venue subtotals above sum to the Wages &amp; Salaries row
          on the EBITDA cockpit for the same period. &ldquo;Salary&rdquo; is the amount counted into EBITDA; on full
          calendar-month periods this is the literal Zoho figure.
        </p>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  PAGE                                                               */
/* ------------------------------------------------------------------ */

export default function EmployeeMappingPage() {
  return (
    <DashboardShell>
      {({ dateFrom, dateTo }) => <EmployeeMappingContent dateFrom={dateFrom} dateTo={dateTo} />}
    </DashboardShell>
  );
}
