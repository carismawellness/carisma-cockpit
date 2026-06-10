"use client";

// Client Retention section for the Aesthetics sales page (purely additive).
// Data: /api/sales/aesthetics-retention via useAestheticsRetention.
//   1. New vs Returning clients (period KPIs + 12-month stacked revenue trend)
//   2. Consult → Treatment conversion (60-day window)
//   3. Tox 90-day recall compliance + recall work-list for the front desk

import { useMemo, useState } from "react";
import { Card } from "@/components/ui/card";
import { SalesKPICard } from "@/components/sales/SalesKPICard";
import { SalesKPIGrid } from "@/components/sales/SalesKPIGrid";
import { ChartSkeleton, KPIGridSkeleton, TableSkeleton } from "@/components/ui/skeleton";
import { useAestheticsRetention, type ToxBucketKey, type ToxWorkItem } from "@/lib/hooks/useAestheticsRetention";
import { BRAND } from "@/lib/constants/design-tokens";
import { ArrowUpDown } from "lucide-react";
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, LabelList,
} from "recharts";

const RETURNING_COLOR = BRAND.aesthetics.dark;   // #3B7676
const NEW_COLOR       = "#7FB3B3";               // aesthetics family mid-tone

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

const BUCKET_META: Record<ToxBucketKey, { label: string; sub: string }> = {
  onCycle: { label: "On-Cycle",  sub: "treated within window" },
  dueSoon: { label: "Due Soon",  sub: "due in next 14 days" },
  dueNow:  { label: "Due Now",   sub: "0–30 days overdue" },
  lapsed:  { label: "Lapsed",    sub: "31–90 days overdue" },
  lost:    { label: "Lost",      sub: ">90 days overdue" },
};
const BUCKET_ORDER: ToxBucketKey[] = ["onCycle", "dueSoon", "dueNow", "lapsed", "lost"];

// ── Recall work-list (sortable) ───────────────────────────────────────────────

type SortKey = "client" | "lastToxDate" | "daysOverdue" | "practitioner" | "ltv" | "toxVisits";

const COLUMNS: { key: SortKey; label: string; align: "left" | "right" }[] = [
  { key: "client",       label: "Client",         align: "left"  },
  { key: "lastToxDate",  label: "Last Tox",       align: "left"  },
  { key: "daysOverdue",  label: "Overdue",        align: "right" },
  { key: "practitioner", label: "Practitioner",   align: "left"  },
  { key: "toxVisits",    label: "Tox Visits",     align: "right" },
  { key: "ltv",          label: "Lifetime Value", align: "right" },
];

function RecallWorkList({ items }: { items: ToxWorkItem[] }) {
  const [sort, setSort] = useState<{ key: SortKey; dir: 1 | -1 } | null>(null);

  const sorted = useMemo(() => {
    if (!sort) return items;   // API default order = most recoverable first
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
              <td className="py-1.5 text-muted-foreground whitespace-nowrap">{fmtDate(w.lastToxDate)}</td>
              <td className="py-1.5 text-right tabular-nums">
                {w.daysOverdue >= 0 ? (
                  <span className={w.daysOverdue <= 30 ? "text-amber-600 font-semibold" : "text-red-600 font-semibold"}>
                    {w.daysOverdue}d overdue
                  </span>
                ) : (
                  <span className="text-emerald-700">due in {-w.daysOverdue}d</span>
                )}
              </td>
              <td className="py-1.5 text-muted-foreground">{w.practitioner ?? "—"}</td>
              <td className="py-1.5 text-right tabular-nums text-muted-foreground">{w.toxVisits}</td>
              <td className="py-1.5 text-right tabular-nums font-medium">{fmtK(w.ltv)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ── Section ───────────────────────────────────────────────────────────────────

export function AestheticsRetentionSection({ dateFrom, dateTo }: { dateFrom: Date; dateTo: Date }) {
  const { data, isFetching, error } = useAestheticsRetention(dateFrom, dateTo);

  const monthlyData = useMemo(() =>
    (data?.newReturning.monthly ?? []).map(m => ({
      ...m,
      name:  fmtMonth(m.month),
      total: m.newRevenue + m.returningRevenue,
    })),
    [data],
  );
  const hasTrendData = monthlyData.some(m => m.total > 0);

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
        <KPIGridSkeleton count={4} className="md:grid-cols-4" />
        <Card className="p-4 md:p-5"><ChartSkeleton height={260} /></Card>
        <Card className="p-4 md:p-5"><TableSkeleton rows={8} columns={6} /></Card>
      </>
    );
  }

  if (!data) return null;

  const { newReturning, consults, toxRecall, matchQuality, historyStart } = data;
  const nr = newReturning.period;

  const explainer =
    `Matched by client name · history since ${historyStart ? fmtDate(historyStart) : "—"} · ` +
    `${matchQuality.unmatchedRevenueSharePct}% of revenue unmatched and excluded ` +
    `(${matchQuality.unmatchedTx} of ${matchQuality.totalTx} transactions)`;

  return (
    <>
      <SectionHeader explainer={explainer} />

      {/* ── New vs Returning — period KPIs ───────────────────────────── */}
      <SalesKPIGrid columns={4}>
        <SalesKPICard
          label="New Clients"
          value={String(nr.newClients)}
          subtitle={`${fmtK(nr.newRevenue)} revenue · first-ever visit in period`}
        />
        <SalesKPICard
          label="Returning Clients"
          value={String(nr.returningClients)}
          subtitle={`${fmtK(nr.returningRevenue)} revenue · seen before period`}
        />
        <SalesKPICard
          label="Returning Share"
          value={`${nr.returningSharePct}%`}
          subtitle="of clients in period"
        />
        <SalesKPICard
          label="Consult → Treatment"
          value={consults.conversionRatePct != null ? `${consults.conversionRatePct}%` : "—"}
          subtitle={
            consults.matured > 0
              ? `${consults.converted} of ${consults.matured} consults converted in ${consults.windowDays}d` +
                (consults.pending > 0 ? ` · ${consults.pending} window open` : "")
              : "no consult-first clients in period"
          }
        />
      </SalesKPIGrid>

      {/* ── Consult economics ────────────────────────────────────────── */}
      {consults.converted > 0 && (
        <SalesKPIGrid columns={3}>
          <SalesKPICard
            label="Median Days to Convert"
            value={consults.medianDaysToConvert != null ? `${Math.round(consults.medianDaysToConvert)}d` : "—"}
            subtitle="consult to first treatment"
          />
          <SalesKPICard
            label="Revenue per Converted Consult"
            value={consults.avgRevenuePerConverted != null ? fmtK(consults.avgRevenuePerConverted) : "—"}
            subtitle={`treatment revenue in first ${consults.windowDays} days`}
          />
          <SalesKPICard
            label="Consult-First Clients"
            value={String(consults.cohortSize)}
            subtitle="first visit was a consultation, in period"
          />
        </SalesKPIGrid>
      )}

      {/* ── New vs Returning revenue trend ───────────────────────────── */}
      <Card className="p-4 md:p-5">
        <div className="flex items-center gap-2 mb-1">
          <h3 className="text-base font-semibold text-foreground">New vs Returning Revenue — Trailing 12 Months</h3>
        </div>
        <p className="text-xs text-muted-foreground mb-4">
          New = client&apos;s first-ever transaction falls in that month (full-history lookback)
        </p>
        {!hasTrendData ? (
          <p className="text-sm text-muted-foreground py-6 text-center">No matched-client revenue in the trailing 12 months</p>
        ) : (
          <>
            <ResponsiveContainer width="100%" height={280}>
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
                <Bar dataKey="newRevenue" stackId="rev" fill={NEW_COLOR} name="newRevenue" />
                <Bar dataKey="returningRevenue" stackId="rev" fill={RETURNING_COLOR} name="returningRevenue" radius={[4, 4, 0, 0]}>
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
                <span className="inline-block w-3 h-3 rounded-sm" style={{ backgroundColor: NEW_COLOR }} />
                New clients
              </span>
              <span className="flex items-center gap-1.5">
                <span className="inline-block w-3 h-3 rounded-sm" style={{ backgroundColor: RETURNING_COLOR }} />
                Returning clients
              </span>
            </div>
          </>
        )}
      </Card>

      {/* ── Tox recall compliance ─────────────────────────────────────── */}
      <Card className="p-4 md:p-5">
        <div className="flex items-center gap-2 mb-1">
          <h3 className="text-base font-semibold text-foreground">Tox Recall — 90-Day Cycle</h3>
        </div>
        <p className="text-xs text-muted-foreground mb-4">
          Wrinkle-relaxer (botox/toxin) clients by days since latest treatment vs the {toxRecall.cycleDays}-day expected return ·
          {" "}{toxRecall.totalToxClients} tox clients all-time · full history, as of {fmtDate(data.asOf)}
        </p>
        {toxRecall.totalToxClients === 0 ? (
          <p className="text-sm text-muted-foreground py-6 text-center">No wrinkle-relaxer treatments found in history</p>
        ) : (
          <>
            <div className="grid grid-cols-2 md:grid-cols-5 gap-3 mb-5">
              {BUCKET_ORDER.map(key => {
                const b = toxRecall.buckets[key];
                const meta = BUCKET_META[key];
                return (
                  <div key={key} className="rounded-lg border px-3 py-2.5 bg-card/50">
                    <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">{meta.label}</p>
                    <p className="mt-1 text-xl font-bold text-foreground leading-tight tabular-nums">{b.count}</p>
                    <p className="text-xs text-muted-foreground">{meta.sub} · {fmtK(b.ltv)} LTV</p>
                  </div>
                );
              })}
            </div>

            <div className="flex items-baseline gap-2 mb-2">
              <h4 className="text-sm font-semibold text-foreground">Recall Work-List</h4>
              <span className="text-xs text-muted-foreground">
                due-soon + due-now + lapsed, most recoverable first
                {toxRecall.workListTotal > toxRecall.workList.length
                  ? ` · showing top ${toxRecall.workList.length} of ${toxRecall.workListTotal}`
                  : ` · ${toxRecall.workListTotal} clients`}
              </span>
            </div>
            {toxRecall.workList.length === 0 ? (
              <p className="text-sm text-muted-foreground py-4 text-center">Nobody due or lapsed — recall book is clean</p>
            ) : (
              <RecallWorkList items={toxRecall.workList} />
            )}
          </>
        )}
      </Card>
    </>
  );
}

function SectionHeader({ explainer }: { explainer: string | null }) {
  return (
    <div className="space-y-1 pt-2">
      <h2 className="text-lg font-bold text-foreground tracking-tight">Client Retention</h2>
      <p className="text-xs text-muted-foreground">
        {explainer ?? "Matched by client name across all transactions"}
      </p>
    </div>
  );
}
