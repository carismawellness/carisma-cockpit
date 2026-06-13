"use client";

// Program Health section — Slimming.
// Data: /api/sales/slimming-weight (reads Clients Weight Record tab from the
// Carisma Slimming Master Google Sheet directly, zero-auth CSV export).
//
// Primary purpose: surface who is NOT losing weight so the team can intervene.

import { useMemo, useState } from "react";
import { Card } from "@/components/ui/card";
import { SalesKPICard } from "@/components/sales/SalesKPICard";
import { SalesKPIGrid } from "@/components/sales/SalesKPIGrid";
import { KPIGridSkeleton, TableSkeleton } from "@/components/ui/skeleton";
import { useSlimmingWeight } from "@/lib/hooks/useSlimmingWeight";
import { useSlimmingWeightTrend } from "@/lib/hooks/useSlimmingWeightTrend";
import type { WeightClient } from "@/lib/types/slimming-weight";
import {
  ArrowUpDown,
  TrendingDown,
  TrendingUp,
  Minus,
  AlertTriangle,
  CheckCircle2,
} from "lucide-react";
import {
  BarChart,
  Bar,
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Cell,
  ReferenceLine,
  LabelList,
} from "recharts";

// ── Format helpers ────────────────────────────────────────────────────────────

function fmtDate(d: string): string {
  return new Date(d + "T00:00:00").toLocaleDateString("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
}

function fmtKg(v: number | null, decimals = 1): string {
  if (v === null) return "—";
  return `${Math.abs(v).toFixed(decimals)} kg`;
}

// ── Status badge ──────────────────────────────────────────────────────────────

const STATUS_CONFIG: Record<
  WeightClient["status"],
  { label: string; cls: string }
> = {
  on_track:    { label: "On Track",    cls: "bg-emerald-100 text-emerald-800" },
  plateau:     { label: "Plateau",     cls: "bg-amber-100 text-amber-800" },
  gaining:     { label: "Gaining",     cls: "bg-red-100 text-red-800 font-semibold" },
  awaiting:    { label: "Awaiting",    cls: "bg-gray-100 text-gray-500" },
  no_baseline: { label: "No Baseline", cls: "bg-gray-100 text-gray-400" },
};

function StatusBadge({ status }: { status: WeightClient["status"] }) {
  const { label, cls } = STATUS_CONFIG[status];
  return (
    <span
      className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${cls}`}
    >
      {label}
    </span>
  );
}

// ── Trend icon ────────────────────────────────────────────────────────────────

function TrendIcon({ trend }: { trend: WeightClient["trend"] }) {
  if (trend === "down")
    return <TrendingDown className="h-4 w-4 text-emerald-600" />;
  if (trend === "up")
    return <TrendingUp className="h-4 w-4 text-red-500" />;
  if (trend === "flat")
    return <Minus className="h-4 w-4 text-amber-500" />;
  return <span className="text-muted-foreground text-xs px-0.5">•</span>;
}

// ── Change display cell ───────────────────────────────────────────────────────

function ChangeCell({
  weightLost,
  pctLost,
}: {
  weightLost: number | null;
  pctLost: number | null;
}) {
  if (weightLost === null || pctLost === null)
    return <span className="text-muted-foreground">—</span>;

  const lost = weightLost > 0;
  const cls = lost ? "text-emerald-700" : "text-red-600";
  const sign = lost ? "−" : "+";

  return (
    <span className={`font-semibold tabular-nums ${cls}`}>
      {sign}{fmtKg(weightLost)}{" "}
      <span className="text-xs font-normal opacity-75">
        ({sign}{Math.abs(pctLost).toFixed(1)}%)
      </span>
    </span>
  );
}

// ── Alert table: clients NOT losing weight ────────────────────────────────────

function NeedsAttentionTable({ items }: { items: WeightClient[] }) {
  if (items.length === 0) {
    return (
      <div className="flex items-center gap-2 py-5 text-emerald-700">
        <CheckCircle2 className="h-5 w-5 shrink-0" />
        <span className="text-sm font-medium">
          All clients with data are currently on track — no intervention needed.
        </span>
      </div>
    );
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b text-xs text-muted-foreground uppercase tracking-wide">
            <th className="pb-2 font-medium text-left">Client</th>
            <th className="pb-2 font-medium text-right">Start</th>
            <th className="pb-2 font-medium text-right">Current</th>
            <th className="pb-2 font-medium text-right">Change</th>
            <th className="pb-2 font-medium text-right">Weeks</th>
            <th className="pb-2 font-medium text-center">Trend</th>
            <th className="pb-2 font-medium text-left pl-3">Status</th>
          </tr>
        </thead>
        <tbody>
          {items.map((c, i) => (
            <tr
              key={`${c.name}-${i}`}
              className={`border-b last:border-0 ${
                c.status === "gaining"
                  ? "bg-red-50/50"
                  : "bg-amber-50/40"
              }`}
            >
              <td className="py-1.5 font-medium">{c.name}</td>
              <td className="py-1.5 text-right tabular-nums text-muted-foreground">
                {c.startWeight ? `${c.startWeight} kg` : "—"}
              </td>
              <td className="py-1.5 text-right tabular-nums text-muted-foreground">
                {c.currentWeight ? `${c.currentWeight} kg` : "—"}
              </td>
              <td className="py-1.5 text-right">
                <ChangeCell weightLost={c.weightLost} pctLost={c.pctLost} />
              </td>
              <td className="py-1.5 text-right tabular-nums text-muted-foreground">
                {c.weeksLogged}w
              </td>
              <td className="py-1.5 text-center">
                <TrendIcon trend={c.trend} />
              </td>
              <td className="py-1.5 pl-3">
                <StatusBadge status={c.status} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ── Full sortable progress table ──────────────────────────────────────────────

type SortKey =
  | "name"
  | "startWeight"
  | "currentWeight"
  | "weightLost"
  | "pctLost"
  | "weeksLogged";

const PROGRESS_COLUMNS: {
  key: SortKey;
  label: string;
  align: "left" | "right";
}[] = [
  { key: "name",          label: "Client",     align: "left"  },
  { key: "startWeight",   label: "Start kg",   align: "right" },
  { key: "currentWeight", label: "Current kg", align: "right" },
  { key: "weightLost",    label: "Lost kg",    align: "right" },
  { key: "pctLost",       label: "Lost %",     align: "right" },
  { key: "weeksLogged",   label: "Weeks",      align: "right" },
];

function FullProgressTable({ clients }: { clients: WeightClient[] }) {
  const [sort, setSort] = useState<{ key: SortKey; dir: 1 | -1 }>({
    key: "pctLost",
    dir: -1,
  });

  const sorted = useMemo(
    () =>
      [...clients].sort((a, b) => {
        const av = a[sort.key] ?? -Infinity;
        const bv = b[sort.key] ?? -Infinity;
        if (typeof av === "string" && typeof bv === "string")
          return av.localeCompare(bv) * sort.dir;
        return ((av as number) - (bv as number)) * sort.dir;
      }),
    [clients, sort],
  );

  const toggle = (key: SortKey) =>
    setSort(prev =>
      prev.key === key
        ? { key, dir: prev.dir === 1 ? -1 : 1 }
        : { key, dir: -1 },
    );

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b text-xs text-muted-foreground uppercase tracking-wide">
            {PROGRESS_COLUMNS.map(c => (
              <th
                key={c.key}
                className={`pb-2 font-medium ${
                  c.align === "right" ? "text-right" : "text-left"
                }`}
              >
                <button
                  type="button"
                  onClick={() => toggle(c.key)}
                  className="inline-flex items-center gap-1 uppercase tracking-wide hover:text-foreground transition-colors"
                >
                  {c.label}
                  <ArrowUpDown
                    className={`h-3 w-3 ${
                      sort.key === c.key ? "opacity-100" : "opacity-30"
                    }`}
                  />
                </button>
              </th>
            ))}
            <th className="pb-2 font-medium text-center">Trend</th>
            <th className="pb-2 font-medium text-left pl-2">Status</th>
          </tr>
        </thead>
        <tbody>
          {sorted.map((c, i) => (
            <tr
              key={`${c.name}-${i}`}
              className="border-b last:border-0 hover:bg-muted/10"
            >
              <td className="py-1.5 font-medium">{c.name}</td>
              <td className="py-1.5 text-right tabular-nums text-muted-foreground">
                {c.startWeight ?? "—"}
              </td>
              <td className="py-1.5 text-right tabular-nums text-muted-foreground">
                {c.currentWeight ?? "—"}
              </td>
              <td className="py-1.5 text-right tabular-nums">
                {c.weightLost !== null ? (
                  <span
                    className={
                      c.weightLost >= 0 ? "text-emerald-700" : "text-red-600"
                    }
                  >
                    {c.weightLost >= 0 ? "−" : "+"}
                    {Math.abs(c.weightLost).toFixed(1)}
                  </span>
                ) : (
                  <span className="text-muted-foreground">—</span>
                )}
              </td>
              <td className="py-1.5 text-right tabular-nums font-semibold">
                {c.pctLost !== null ? (
                  <span
                    className={
                      c.pctLost >= 0 ? "text-emerald-700" : "text-red-600"
                    }
                  >
                    {c.pctLost >= 0 ? "−" : "+"}
                    {Math.abs(c.pctLost).toFixed(1)}%
                  </span>
                ) : (
                  <span className="text-muted-foreground">—</span>
                )}
              </td>
              <td className="py-1.5 text-right tabular-nums text-muted-foreground">
                {c.weeksLogged}
              </td>
              <td className="py-1.5 text-center">
                <TrendIcon trend={c.trend} />
              </td>
              <td className="py-1.5 pl-2">
                <StatusBadge status={c.status} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ── Weight loss distribution chart ────────────────────────────────────────────

const DIST_BINS = [
  { label: "> 10% lost",   min:  10,    max: Infinity, color: "#059669" },
  { label: "5 – 10% lost", min:   5,    max: 10,       color: "#34d399" },
  { label: "1 – 5% lost",  min:   0.3,  max: 5,        color: "#6ee7b7" },
  { label: "Plateau",      min:  -0.3,  max: 0.3,      color: "#f59e0b" },
  { label: "Gaining",      min: -Infinity, max: -0.3,  color: "#ef4444" },
];

function DistributionChart({ clients }: { clients: WeightClient[] }) {
  const data = useMemo(() => {
    const counts = DIST_BINS.map(b => ({ ...b, count: 0 }));
    for (const c of clients) {
      const p = c.pctLost ?? 0;
      for (const bin of counts) {
        if (p > bin.min && p <= bin.max) { bin.count++; break; }
      }
    }
    return counts.filter(b => b.count > 0);
  }, [clients]);

  if (data.length === 0) return null;

  return (
    <ResponsiveContainer width="100%" height={Math.max(160, data.length * 44)}>
      <BarChart
        data={data}
        layout="vertical"
        margin={{ top: 4, right: 90, left: 88, bottom: 4 }}
      >
        <CartesianGrid strokeDasharray="3 3" horizontal={false} />
        <XAxis
          type="number"
          allowDecimals={false}
          tick={{ fontSize: 11 }}
          axisLine={false}
          tickLine={false}
        />
        <YAxis
          type="category"
          dataKey="label"
          tick={{ fontSize: 11 }}
          axisLine={false}
          tickLine={false}
          width={84}
        />
        <Tooltip
          formatter={(v: unknown) => [`${Number(v)} clients`, "Count"]}
          contentStyle={{ fontSize: 12 }}
        />
        <Bar dataKey="count" radius={[0, 4, 4, 0]} maxBarSize={30}>
          {data.map((entry, idx) => (
            <Cell key={`cell-${idx}`} fill={entry.color} />
          ))}
          <LabelList
            dataKey="count"
            position="right"
            style={{ fontSize: 12, fontWeight: 700, fill: "#1f2937" }}
            formatter={(v: unknown) => `${v} clients`}
          />
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}

// ── Weekly % losing trend chart ───────────────────────────────────────────────

function WeeklyTrendChart() {
  const { data, isFetching } = useSlimmingWeightTrend();

  if (isFetching && !data) {
    return <div className="h-[260px] animate-pulse bg-muted/20 rounded" />;
  }

  const weeks = data?.weeks ?? [];
  // Only show weeks where at least 1 client was weighed
  const chartData = weeks.filter(w => w.weighed > 0);

  if (chartData.length === 0) {
    return (
      <p className="text-sm text-muted-foreground py-6 text-center">
        No weekly data yet — fill in Program Start dates and weekly weights to see the trend.
      </p>
    );
  }

  return (
    <ResponsiveContainer width="100%" height={280}>
      <LineChart data={chartData} margin={{ top: 28, right: 24, left: 0, bottom: 0 }}>
        <CartesianGrid strokeDasharray="3 3" vertical={false} />
        <XAxis
          dataKey="weekLabel"
          tick={{ fontSize: 11 }}
          axisLine={false}
          tickLine={false}
          interval="preserveStartEnd"
        />
        <YAxis
          domain={[0, 100]}
          tickFormatter={(v: number) => `${v}%`}
          tick={{ fontSize: 11 }}
          axisLine={false}
          tickLine={false}
          width={36}
        />
        <Tooltip
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          formatter={(value: unknown, _name: unknown, entry: any) => {
            const weighed = (entry?.payload?.weighed as number | undefined) ?? 0;
            return [`${Number(value).toFixed(1)}% (${weighed} weighed)`, "Losing weight"];
          }}
          contentStyle={{ fontSize: 12 }}
        />
        {/* 50% reference — majority losing is the target */}
        <ReferenceLine y={50} stroke="#e5e7eb" strokeDasharray="4 4" />
        <Line
          type="monotone"
          dataKey="losingPct"
          stroke="#059669"
          strokeWidth={2.5}
          dot={{ r: 4, fill: "#059669", strokeWidth: 0 }}
          activeDot={{ r: 6 }}
          connectNulls={false}
          name="losingPct"
        >
          <LabelList
            dataKey="losingPct"
            position="top"
            style={{ fontSize: 10, fontWeight: 700, fill: "#059669" }}
            formatter={(v: unknown) => (v != null ? `${Number(v)}%` : "")}
          />
        </Line>
      </LineChart>
    </ResponsiveContainer>
  );
}

// ── Main exported section ─────────────────────────────────────────────────────

export function SlimmingProgramHealthSection({
  dateFrom: _dateFrom,
  dateTo: _dateTo,
}: {
  dateFrom: Date;
  dateTo: Date;
}) {
  const { data, isFetching, error } = useSlimmingWeight();
  const [showAll, setShowAll] = useState(false);

  if (error) {
    return (
      <>
        <SectionHeader />
        <div className="flex items-start gap-2 text-xs text-red-800 bg-red-50 border border-red-200 rounded px-3 py-2">
          <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5" />
          <span>{error}</span>
        </div>
      </>
    );
  }

  if (isFetching && !data) {
    return (
      <>
        <SectionHeader />
        <KPIGridSkeleton count={4} className="md:grid-cols-4" />
        <Card className="p-4 md:p-5">
          <TableSkeleton rows={8} columns={7} />
        </Card>
      </>
    );
  }

  if (!data) return null;

  const { summary, clients, notLosingWeight } = data;

  const clientsWithData = clients.filter(
    c => c.status !== "awaiting" && c.status !== "no_baseline",
  );

  const needsAttentionCount = summary.gaining + summary.plateaued;
  const onTrackPct =
    summary.clientsWithData > 0
      ? Math.round((summary.onTrack / summary.clientsWithData) * 100)
      : null;

  const previewCount = 15;

  return (
    <>
      <SectionHeader />

      <p className="text-xs text-muted-foreground -mt-2">
        Weight outcomes from Clients Weight Record ·{" "}
        {summary.totalClients} clients tracked · as of {fmtDate(data.asOf)}
        {summary.noBaseline > 0
          ? ` · ${summary.noBaseline} without Tanita baseline`
          : ""}
        {summary.awaiting > 0
          ? ` · ${summary.awaiting} awaiting first check-in`
          : ""}
      </p>

      {/* ── KPIs ─────────────────────────────────────────────────────────── */}
      <SalesKPIGrid columns={4}>
        <SalesKPICard
          label="Clients with Data"
          value={String(summary.clientsWithData)}
          subtitle={`of ${summary.totalClients} enrolled`}
        />
        <SalesKPICard
          label="On Track"
          value={String(summary.onTrack)}
          subtitle={
            onTrackPct !== null
              ? `${onTrackPct}% of clients actively losing`
              : "actively losing weight"
          }
        />
        <SalesKPICard
          label="Needs Attention"
          value={String(needsAttentionCount)}
          subtitle={`${summary.gaining} gaining · ${summary.plateaued} plateau`}
        />
        <SalesKPICard
          label="Avg Loss"
          value={
            summary.avgPctLost !== null
              ? `${summary.avgPctLost.toFixed(1)}%`
              : "—"
          }
          subtitle={`${summary.totalKgLost.toFixed(1)} kg total lost`}
        />
      </SalesKPIGrid>

      {/* ── Distribution chart (headline KPI) ───────────────────────────── */}
      {clientsWithData.length > 0 && (
        <Card className="p-4 md:p-5 border-2 border-border">
          <div className="flex items-baseline justify-between mb-1">
            <h3 className="text-base font-semibold text-foreground">
              Outcome Distribution
            </h3>
            <span className="text-xs text-muted-foreground">
              {clientsWithData.length} clients with data · point-in-time snapshot
            </span>
          </div>
          <p className="text-xs text-muted-foreground mb-4">
            Where every client sits right now across weight outcome buckets
          </p>
          <DistributionChart clients={clientsWithData} />
        </Card>
      )}

      {/* ── Weekly % losing trend ────────────────────────────────────────── */}
      <Card className="p-4 md:p-5">
        <div className="flex items-baseline justify-between mb-1">
          <h3 className="text-base font-semibold text-foreground">
            % Clients Losing Weight — Week by Week
          </h3>
          <span className="text-xs text-muted-foreground">chronological · per calendar week</span>
        </div>
        <p className="text-xs text-muted-foreground mb-4">
          Of clients who were weighed each week, what % showed a weight drop vs their prior reading.
          Dashed line = 50% target.
        </p>
        <WeeklyTrendChart />
      </Card>

      {/* ── Needs Attention (call list) ───────────────────────────────────── */}
      <Card className="p-4 md:p-5">
        <div className="flex items-center gap-2 mb-1">
          {needsAttentionCount > 0 ? (
            <AlertTriangle className="h-5 w-5 text-red-500 shrink-0" />
          ) : (
            <CheckCircle2 className="h-5 w-5 text-emerald-600 shrink-0" />
          )}
          <h3 className="text-base font-semibold text-foreground">
            Needs Attention
            {needsAttentionCount > 0 && (
              <span className="ml-2 inline-flex items-center rounded-full bg-red-100 px-2.5 py-0.5 text-xs font-semibold text-red-800">
                {needsAttentionCount} clients to call
              </span>
            )}
          </h3>
        </div>
        <p className="text-xs text-muted-foreground mb-3">
          Gaining or plateaued — sorted worst first ·{" "}
          {summary.gaining > 0 && (
            <span className="text-red-700 font-medium">
              {summary.gaining} gaining weight
            </span>
          )}
          {summary.gaining > 0 && summary.plateaued > 0 && " · "}
          {summary.plateaued > 0 && (
            <span className="text-amber-700 font-medium">
              {summary.plateaued} plateau
            </span>
          )}
        </p>
        <NeedsAttentionTable items={notLosingWeight} />
      </Card>

      {/* ── Full progress table ───────────────────────────────────────────── */}
      <Card className="p-4 md:p-5">
        <div className="flex items-baseline justify-between mb-1">
          <h3 className="text-base font-semibold text-foreground">
            All Client Progress
          </h3>
          {clientsWithData.length > previewCount && (
            <button
              type="button"
              onClick={() => setShowAll(v => !v)}
              className="text-xs text-muted-foreground hover:text-foreground transition-colors underline-offset-2 hover:underline"
            >
              {showAll
                ? "Show less"
                : `Show all ${clientsWithData.length} clients`}
            </button>
          )}
        </div>
        <p className="text-xs text-muted-foreground mb-3">
          Sorted by % lost by default · click any column header to re-sort
        </p>
        <FullProgressTable
          clients={showAll ? clientsWithData : clientsWithData.slice(0, previewCount)}
        />
        {!showAll && clientsWithData.length > previewCount && (
          <p className="text-xs text-muted-foreground mt-3 text-center">
            Showing {previewCount} of {clientsWithData.length} ·{" "}
            <button
              type="button"
              onClick={() => setShowAll(true)}
              className="underline hover:text-foreground transition-colors"
            >
              show all
            </button>
          </p>
        )}
      </Card>
    </>
  );
}

function SectionHeader() {
  return (
    <div className="space-y-1 pt-2">
      <h2 className="text-lg font-bold text-foreground tracking-tight">
        Program Health
      </h2>
    </div>
  );
}
