"use client";

import { useMemo, useState } from "react";
import { Users } from "lucide-react";
import { DashboardShell } from "@/components/dashboard/DashboardShell";
import { Card } from "@/components/ui/card";
import { useEbitdaAggregated, type LineItem } from "@/lib/hooks/useEbitdaAggregated";
import { SPA_LOCATION_META } from "@/lib/hooks/useSpaEbitda";
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
      .sort((a, b) => {
        // Unattributed always last; named employees alphabetically
        if (a.name === UNATTRIBUTED) return 1;
        if (b.name === UNATTRIBUTED) return -1;
        return a.name.localeCompare(b.name);
      });
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
/*  SALARY BREAKDOWN PIVOT TABLE                                       */
/* ------------------------------------------------------------------ */

const MONTH_NAMES = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];

function fmtMonth(m: string): string {
  const [year, mon] = m.split("-");
  return `${MONTH_NAMES[parseInt(mon, 10) - 1]} ${year.slice(2)}`;
}

function orgLabel(org: string): string {
  if (org === "spa") return "SPA";
  if (org === "aesthetics") return "Aesthetics";
  if (org === "slimming") return "Slimming";
  return org.charAt(0).toUpperCase() + org.slice(1);
}

interface SalaryEmployee {
  contact_name: string;
  org: string;
  monthly: Record<string, number>;
  total: number;
}

interface SalaryData {
  months: string[];
  employees: SalaryEmployee[];
}

function SalaryBreakdown() {
  const [data, setData] = useState<SalaryData | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleLoad() {
    setIsLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/settings/salary-monthly?date_from=2025-01-01&date_to=2026-06-30");
      if (!res.ok) {
        const text = await res.text().catch(() => res.statusText);
        throw new Error(`Server error ${res.status}: ${text}`);
      }
      setData(await res.json());
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setIsLoading(false);
    }
  }

  const grandTotal = data?.employees.reduce((s, e) => s + e.total, 0) ?? 0;

  return (
    <Card className="overflow-hidden">
      <div className="px-4 py-3 border-b border-border flex items-center justify-between gap-3">
        <div>
          <h2 className="text-base font-semibold text-foreground">Salary by Staff &amp; Month</h2>
          <p className="text-xs text-muted-foreground mt-0.5">
            Monthly wages per employee by org — Jan 2025 to Jun 2026. Source: transactions_raw (wages COA).
          </p>
        </div>
        <button
          onClick={handleLoad}
          disabled={isLoading}
          className="shrink-0 inline-flex items-center gap-2 rounded-md border border-border bg-background px-3 py-1.5 text-sm font-medium text-foreground hover:bg-muted/50 disabled:opacity-50 transition-colors"
        >
          {isLoading && (
            <svg className="animate-spin h-3.5 w-3.5 text-muted-foreground" viewBox="0 0 24 24" fill="none">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z" />
            </svg>
          )}
          {isLoading ? "Loading…" : "Load Salary Breakdown"}
        </button>
      </div>

      {error && (
        <div className="px-4 py-3 text-sm text-red-700 bg-red-50/60 border-b border-red-200">{error}</div>
      )}

      {data && data.employees.length === 0 && (
        <div className="px-4 py-6 text-sm text-center text-muted-foreground">
          No salary transactions found for the selected period.
        </div>
      )}

      {data && data.employees.length > 0 && (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border/60">
                <th className="text-left py-2 px-4 text-[11px] font-medium uppercase tracking-wider text-muted-foreground sticky left-0 bg-background z-10 min-w-[180px]">
                  Employee
                </th>
                <th className="text-left py-2 px-4 text-[11px] font-medium uppercase tracking-wider text-muted-foreground min-w-[90px]">
                  Org
                </th>
                {data.months.map((m) => (
                  <th key={m} className="text-right py-2 px-3 text-[11px] font-medium uppercase tracking-wider text-muted-foreground whitespace-nowrap min-w-[72px]">
                    {fmtMonth(m)}
                  </th>
                ))}
                <th className="text-right py-2 px-4 text-[11px] font-medium uppercase tracking-wider text-muted-foreground whitespace-nowrap">
                  Total
                </th>
              </tr>
            </thead>
            <tbody>
              {data.employees.map((emp) => (
                <tr
                  key={`${emp.contact_name}|${emp.org}`}
                  className="border-b border-border/40 last:border-0 hover:bg-muted/30 transition-colors"
                >
                  <td className="py-1.5 px-4 text-foreground sticky left-0 bg-background z-10 whitespace-nowrap">
                    {emp.contact_name}
                  </td>
                  <td className="py-1.5 px-4 text-xs text-muted-foreground whitespace-nowrap">
                    {orgLabel(emp.org)}
                  </td>
                  {data.months.map((m) => (
                    <td key={m} className="py-1.5 px-3 text-right text-xs tabular-nums whitespace-nowrap">
                      {emp.monthly[m]
                        ? <span className="text-foreground">{fmtEuro(emp.monthly[m])}</span>
                        : <span className="text-muted-foreground/30">—</span>}
                    </td>
                  ))}
                  <td className="py-1.5 px-4 text-right text-xs tabular-nums font-semibold text-foreground whitespace-nowrap">
                    {fmtEuro(emp.total)}
                  </td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr className="border-t border-border bg-muted/20">
                <td colSpan={2} className="py-2 px-4 text-xs font-medium text-muted-foreground sticky left-0 bg-muted/20 z-10">
                  Monthly total
                </td>
                {data.months.map((m) => {
                  const monthTotal = data.employees.reduce((s, e) => s + (e.monthly[m] ?? 0), 0);
                  return (
                    <td key={m} className="py-2 px-3 text-right text-xs tabular-nums font-medium text-foreground whitespace-nowrap">
                      {monthTotal > 0
                        ? fmtEuro(monthTotal)
                        : <span className="text-muted-foreground/30">—</span>}
                    </td>
                  );
                })}
                <td className="py-2 px-4 text-right text-xs tabular-nums font-bold text-foreground whitespace-nowrap">
                  {fmtEuro(grandTotal)}
                </td>
              </tr>
            </tfoot>
          </table>
        </div>
      )}
    </Card>
  );
}

/* ------------------------------------------------------------------ */
/*  CONTENT                                                            */
/* ------------------------------------------------------------------ */

// Employee-to-role mapping is a global setting, not period-specific.
// We use a fixed 2-year lookback so all known payroll contacts are visible
// regardless of whatever date the EBITDA cockpit currently has selected.
const MAPPING_FROM = new Date("2024-01-01");

function EmployeeMappingContent() {
  const dateTo = useMemo(() => new Date(), []);
  const agg = useEbitdaAggregated(MAPPING_FROM, dateTo);
  const { roleByContact, setRole } = useWageRoles();

  const groups = useMemo(() => buildVenueGroups(agg.lineItems), [agg.lineItems]);

  const anyFallback = useMemo(() => groups.some((g) => g.employees.some((e) => e.usedFallback)), [groups]);

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold text-foreground flex items-center gap-2">
          <Users className="h-5 w-5 text-gold" />
          Employee Mapping
        </h1>
        <p className="text-sm text-muted-foreground mt-1 max-w-2xl">
          Assign each employee a role (Manager, Reception, Practitioner, CRM). The EBITDA cockpit&apos;s
          Wages &amp; Salaries row uses these mappings to break payroll down by role for the selected period.
          Unassigned employees are counted separately. Employees are loaded from the last 2 years of payroll data.
        </p>
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
          No wages found in the last 2 years of payroll data.
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
          </Card>
        ))}
      </div>

      {/* Monthly salary pivot table */}
      <SalaryBreakdown />

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
    <DashboardShell hideDatePicker>
      {() => <EmployeeMappingContent />}
    </DashboardShell>
  );
}
