"use client";

// Program Health section for the Slimming sales page (purely additive).
// Data: /api/sales/slimming-retention via useSlimmingRetention.
//   1. Active patient census (≤21d active / 22–45d at-risk / >45d inactive)
//      + 12-month active-count trend
//   2. At-risk work-list — the churn-save call list
//   3. New vs Returning clients on slimming sales

import { useMemo, useState } from "react";
import { Card } from "@/components/ui/card";
import { SalesKPICard } from "@/components/sales/SalesKPICard";
import { SalesKPIGrid } from "@/components/sales/SalesKPIGrid";
import { ChartSkeleton, KPIGridSkeleton, TableSkeleton } from "@/components/ui/skeleton";
import { useSlimmingRetention, type SlimmingAtRiskItem } from "@/lib/hooks/useSlimmingRetention";
import { BRAND } from "@/lib/constants/design-tokens";
import { ArrowUpDown, AlertTriangle } from "lucide-react";
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, LabelList,
} from "recharts";

const SLIM_DARK = BRAND.slimming.soft;   // slimming soft fill — bars/swatches
const SLIM_MID  = "#8FB58F";             // slimming family mid-tone (new clients)

function fmtK(v: number): string {
  if (Math.abs(v) >= 1_000_000) return `€${(v / 1_000_000).toFixed(1)}M`;
  if (Math.abs(v) >= 1_000)     return `€${(v / 1_000).toFixed(1)}K`;
  return `€${v.toFixed(0)}`;
}

function fmtMonth(m: string): string {
  const d = new Date(m + "T00:00:00");
  const short = d.toLocaleString("en-GB", { month: "short" });
  return d.getMonth() === 0 ? `${short} ${d.getFullYear()}` : short;
}

function fmtDate(d: string): string {
  return new Date(d + "T00:00:00").toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" });
}

// ── At-risk work-list (sortable) ──────────────────────────────────────────────

type SortKey = "client" | "lastSessionDate" | "daysSince" | "lastTreatment" | "totalSessions" | "totalRevenue";

const COLUMNS: { key: SortKey; label: string; align: "left" | "right" }[] = [
  { key: "client",          label: "Client",         align: "left"  },
  { key: "lastTreatment",   label: "Last Treatment", align: "left"  },
  { key: "lastSessionDate", label: "Last Session",   align: "left"  },
  { key: "daysSince",       label: "Days Since",     align: "right" },
  { key: "totalSessions",   label: "Sessions",       align: "right" },
  { key: "totalRevenue",    label: "Total Revenue",  align: "right" },
];

function AtRiskWorkList({ items }: { items: SlimmingAtRiskItem[] }) {
  const [sort, setSort] = useState<{ key: SortKey; dir: 1 | -1 } | null>(null);

  const sorted = useMemo(() => {
    if (!sort) return items;   // API default order = highest-value saves first
    const { key, dir } = sort;
    return [...items].sort((a, b) => {
      const av = a[key] ?? "", bv = b[key] ?? "";
      if (typeof av === "number" && typeof bv === "number") return (av - bv) * dir;
      return String(av).localeCompare(String(bv)) * dir;
    });
  }, [items, sort]);

  const toggleSort = (key: SortKey) =>
    setSort(prev => prev?.key === key ? { key, dir: prev.dir === 1 ? -1 : 1 } : { key, dir: 1 });

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b text-xs text-muted-foreground uppercase tracking-wide">
            {COLUMNS.map(c => (
              <th key={c.key} className={`pb-2 font-medium ${c.align === "right" ? "text-right" : "text-left"}`}>
                <button
                  type="button"
                  onClick={() => toggleSort(c.key)}
                  className="inline-flex items-center gap-1 uppercase tracking-wide hover:text-foreground transition-colors"
                >
                  {c.label}
                  <ArrowUpDown className={`h-3 w-3 ${sort?.key === c.key ? "opacity-100" : "opacity-30"}`} />
                </button>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {sorted.map((w, i) => (
            <tr key={`${w.client}-${i}`} className="border-b last:border-0 hover:bg-muted/10">
              <td className="py-1.5 font-medium">{w.client}</td>
              <td className="py-1.5 text-muted-foreground">{w.lastTreatment ?? "—"}</td>
              <td className="py-1.5 text-muted-foreground whitespace-nowrap">{fmtDate(w.lastSessionDate)}</td>
              <td className="py-1.5 text-right tabular-nums">
                <span className="text-amber-600 font-semibold">{w.daysSince}d</span>
              </td>
              <td className="py-1.5 text-right tabular-nums text-muted-foreground">{w.totalSessions}</td>
              <td className="py-1.5 text-right tabular-nums font-medium">
                {w.totalRevenue > 0 ? fmtK(w.totalRevenue) : "—"}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ── Section ───────────────────────────────────────────────────────────────────

export function SlimmingProgramHealthSection({ dateFrom, dateTo }: { dateFrom: Date; dateTo: Date }) {
  const { data, isFetching, error } = useSlimmingRetention(dateFrom, dateTo);

  const trendData = useMemo(() =>
    (data?.census.trend ?? []).map(t => ({ ...t, name: fmtMonth(t.month) })),
    [data],
  );
  const hasTrendData = trendData.some(t => t.active > 0);

  const monthlyData = useMemo(() =>
    (data?.newReturning.monthly ?? []).map(m => ({
      ...m,
      name:  fmtMonth(m.month),
      total: m.newRevenue + m.returningRevenue,
    })),
    [data],
  );
  const hasNrData = monthlyData.some(m => m.total > 0);

  if (error) {
    return (
      <>
        <SectionHeader explainer={null} />
        <p className="text-xs text-red-600 bg-red-50 rounded px-3 py-2">{error}</p>
      </>
    );
  }

  if (isFetching && !data) {
    return (
      <>
        <SectionHeader explainer={null} />
        <KPIGridSkeleton count={3} className="md:grid-cols-3" />
        <Card className="p-4 md:p-5"><ChartSkeleton height={240} /></Card>
        <Card className="p-4 md:p-5"><TableSkeleton rows={6} columns={6} /></Card>
      </>
    );
  }

  if (!data) return null;

  const { census, treatments, atRiskList, atRiskListTotal, newReturning, salesMatchQuality } = data;
  const nr = newReturning.period;

  // Data-quality guard: Tx rows without client names can't feed the census.
  // Warn when names stop noticeably before the sessions do.
  const namesLagSessions =
    treatments.lastSessionDate != null &&
    (treatments.lastNamedSessionDate == null ||
      treatments.lastNamedSessionDate < treatments.lastSessionDate);

  const explainer =
    `Matched by client name across Tx sessions and sales · ` +
    `${treatments.nameCoveragePct}% of ${treatments.totalSessions} sessions have a usable client name · ` +
    `as of ${fmtDate(data.asOf)}`;

  return (
    <>
      <SectionHeader explainer={explainer} />

      {namesLagSessions && (
        <div className="flex items-start gap-2 text-xs text-amber-800 bg-amber-50 border border-amber-200 rounded px-3 py-2">
          <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5" />
          <span>
            Client names are missing on recent Tx rows — sessions recorded through{" "}
            {treatments.lastSessionDate ? fmtDate(treatments.lastSessionDate) : "—"}, but the last session with a client
            name is {treatments.lastNamedSessionDate ? fmtDate(treatments.lastNamedSessionDate) : "none"}. The census
            below understates current activity until names are filled in on the Tx Slimming tab.
          </span>
        </div>
      )}

      {/* ── Census KPIs ──────────────────────────────────────────────── */}
      <SalesKPIGrid columns={3}>
        <SalesKPICard
          label="Active Patients"
          value={String(census.active)}
          subtitle={`session in last ${census.activeDays} days`}
        />
        <SalesKPICard
          label="At-Risk Patients"
          value={String(census.atRisk)}
          subtitle={`last session ${census.activeDays + 1}–${census.atRiskDays} days ago — call list below`}
        />
        <SalesKPICard
          label="Inactive Patients"
          value={String(census.inactive)}
          subtitle={`no session in ${census.atRiskDays}+ days · ${census.totalPatients} named patients all-time`}
        />
      </SalesKPIGrid>

      {/* ── Active census trend ──────────────────────────────────────── */}
      <Card className="p-4 md:p-5">
        <h3 className="text-base font-semibold text-foreground mb-1">Active Patients — Trailing 12 Months</h3>
        <p className="text-xs text-muted-foreground mb-4">
          Distinct named patients with a session in the {census.activeDays} days ending at each month-end
        </p>
        {!hasTrendData ? (
          <p className="text-sm text-muted-foreground py-6 text-center">No named sessions in the trailing 12 months</p>
        ) : (
          <ResponsiveContainer width="100%" height={240}>
            <BarChart data={trendData} margin={{ top: 24, right: 8, left: 0, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" vertical={false} />
              <XAxis dataKey="name" tick={{ fontSize: 11 }} axisLine={false} tickLine={false} />
              <YAxis allowDecimals={false} tick={{ fontSize: 11 }} axisLine={false} tickLine={false} />
              <Tooltip
                formatter={(v) => [`${Number(v ?? 0)} patients`, "Active"]}
                contentStyle={{ fontSize: 12 }}
              />
              <Bar dataKey="active" fill={SLIM_DARK} radius={[4, 4, 0, 0]} maxBarSize={48}>
                <LabelList
                  dataKey="active"
                  position="top"
                  formatter={(v: unknown) => Number(v) > 0 ? String(v) : ""}
                  style={{ fontSize: 10, fill: "#111827", fontWeight: 600 }}
                />
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        )}
      </Card>

      {/* ── At-risk work-list ────────────────────────────────────────── */}
      <Card className="p-4 md:p-5">
        <div className="flex items-baseline gap-2 mb-1">
          <h3 className="text-base font-semibold text-foreground">At-Risk Work-List</h3>
          <span className="text-xs text-muted-foreground">
            last session {census.activeDays + 1}–{census.atRiskDays} days ago · highest-value saves first
            {atRiskListTotal > atRiskList.length ? ` · showing top ${atRiskList.length} of ${atRiskListTotal}` : ""}
          </span>
        </div>
        <p className="text-xs text-muted-foreground mb-3">
          Revenue joined from slimming sales by client name — blank where the patient has no matched sale
        </p>
        {atRiskList.length === 0 ? (
          <p className="text-sm text-muted-foreground py-6 text-center">
            {namesLagSessions
              ? "No named patients currently in the 22–45 day window (recent Tx rows lack client names)"
              : "No patients currently in the 22–45 day window"}
          </p>
        ) : (
          <AtRiskWorkList items={atRiskList} />
        )}
      </Card>

      {/* ── New vs Returning ─────────────────────────────────────────── */}
      <SalesKPIGrid columns={3}>
        <SalesKPICard
          label="New Clients"
          value={String(nr.newClients)}
          subtitle={`${fmtK(nr.newRevenue)} revenue · first-ever sale in period`}
        />
        <SalesKPICard
          label="Returning Clients"
          value={String(nr.returningClients)}
          subtitle={`${fmtK(nr.returningRevenue)} revenue · seen before period`}
        />
        <SalesKPICard
          label="Returning Share"
          value={`${nr.returningSharePct}%`}
          subtitle={`of clients in period · ${salesMatchQuality.unmatchedRevenueSharePct}% of sales revenue unmatched`}
        />
      </SalesKPIGrid>

      <Card className="p-4 md:p-5">
        <h3 className="text-base font-semibold text-foreground mb-1">New vs Returning Revenue — Trailing 12 Months</h3>
        <p className="text-xs text-muted-foreground mb-4">
          From slimming sales (Paid) · New = client&apos;s first-ever sale falls in that month · history since{" "}
          {salesMatchQuality.historyStart ? fmtDate(salesMatchQuality.historyStart) : "—"}
        </p>
        {!hasNrData ? (
          <p className="text-sm text-muted-foreground py-6 text-center">No matched-client revenue in the trailing 12 months</p>
        ) : (
          <>
            <ResponsiveContainer width="100%" height={260}>
              <BarChart data={monthlyData} margin={{ top: 24, right: 8, left: 0, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} />
                <XAxis dataKey="name" tick={{ fontSize: 11 }} axisLine={false} tickLine={false} />
                <YAxis tickFormatter={(v) => fmtK(Number(v))} tick={{ fontSize: 11 }} axisLine={false} tickLine={false} />
                <Tooltip
                  formatter={(value, name, entry) => {
                    const n = Number(value ?? 0);
                    const p = entry.payload as typeof monthlyData[0];
                    return name === "newRevenue"
                      ? [`${fmtK(n)} · ${p.newClients} clients`, "New"]
                      : [`${fmtK(n)} · ${p.returningClients} clients`, "Returning"];
                  }}
                  contentStyle={{ fontSize: 12 }}
                />
                <Bar dataKey="newRevenue" stackId="rev" fill={SLIM_MID} name="newRevenue" />
                <Bar dataKey="returningRevenue" stackId="rev" fill={SLIM_DARK} name="returningRevenue" radius={[4, 4, 0, 0]}>
                  <LabelList
                    dataKey="total"
                    position="top"
                    formatter={(v: unknown) => Number(v) > 0 ? fmtK(Number(v)) : ""}
                    style={{ fontSize: 10, fill: "#111827", fontWeight: 600 }}
                  />
                </Bar>
              </BarChart>
            </ResponsiveContainer>
            <div className="flex items-center gap-4 mt-2 text-xs text-muted-foreground">
              <span className="flex items-center gap-1.5">
                <span className="inline-block w-3 h-3 rounded-sm" style={{ backgroundColor: SLIM_MID }} />
                New clients
              </span>
              <span className="flex items-center gap-1.5">
                <span className="inline-block w-3 h-3 rounded-sm" style={{ backgroundColor: SLIM_DARK }} />
                Returning clients
              </span>
            </div>
          </>
        )}
      </Card>
    </>
  );
}

function SectionHeader({ explainer }: { explainer: string | null }) {
  return (
    <div className="space-y-1 pt-2">
      <h2 className="text-lg font-bold text-foreground tracking-tight">Program Health</h2>
      <p className="text-xs text-muted-foreground">
        {explainer ?? "Matched by client name across Tx sessions and sales"}
      </p>
    </div>
  );
}
