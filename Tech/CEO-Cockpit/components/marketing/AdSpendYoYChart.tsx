"use client";

import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  LabelList,
  ResponsiveContainer,
} from "recharts";
import { Card } from "@/components/ui/card";

export interface SpendChartRow {
  brand: string;
  metaTY: number;
  metaLY: number;
  googleTY: number;
  googleLY: number;
}

export interface ChannelRoas {
  metaRoas: number | null;
  googleRoas: number | null;
}

interface Props {
  rows: SpendChartRow[];
  roas: {
    spa: ChannelRoas;
    aesthetics: ChannelRoas;
    slimming: ChannelRoas;
  };
  loading?: boolean;
  dateLabel?: string;
}

function fmtSpend(n: number): string {
  if (n === 0) return "—";
  if (n >= 1000) return `€${(n / 1000).toFixed(1)}k`;
  return `€${Math.round(n)}`;
}

function fmtRoas(n: number | null): string {
  if (n == null || n === 0) return "—";
  return `${n.toFixed(1)}x`;
}

function roasColor(n: number | null): string {
  if (n == null || n === 0) return "text-muted-foreground";
  if (n >= 5) return "text-green-600";
  if (n >= 3) return "text-amber-600";
  return "text-red-600";
}

const BRANDS: Array<{ key: keyof Props["roas"]; label: string }> = [
  { key: "spa", label: "Spa" },
  { key: "aesthetics", label: "Aesthetics" },
  { key: "slimming", label: "Slimming" },
];

const CHANNEL_COLORS = {
  metaTY:    "#1877F2",
  metaLY:    "#93C5FD",
  googleTY:  "#10B981",
  googleLY:  "#6EE7B7",
} as const;

export function AdSpendYoYChart({ rows, roas, loading, dateLabel }: Props) {
  if (loading) {
    return (
      <Card className="p-4 md:p-6">
        <div className="h-6 w-56 bg-muted animate-pulse rounded mb-2" />
        <div className="h-4 w-40 bg-muted animate-pulse rounded mb-6" />
        <div className="h-72 bg-muted animate-pulse rounded" />
      </Card>
    );
  }

  const hasData = rows.some(
    (r) => r.metaTY > 0 || r.metaLY > 0 || r.googleTY > 0 || r.googleLY > 0
  );
  if (!hasData) return null;

  return (
    <Card className="p-4 md:p-6">
      <div className="mb-5">
        <h2 className="text-lg font-semibold">Ad Spend — Year over Year</h2>
        {dateLabel && (
          <p className="text-xs text-muted-foreground mt-0.5">
            TY = {dateLabel} &nbsp;·&nbsp; LY = same period prior year
          </p>
        )}
      </div>

      {/* ── Grouped bar chart ──────────────────────────────────────────── */}
      <ResponsiveContainer width="100%" height={300}>
        <BarChart
          data={rows}
          margin={{ top: 28, right: 16, left: 0, bottom: 0 }}
          barCategoryGap="30%"
          barGap={2}
        >
          <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" vertical={false} />
          <XAxis dataKey="brand" tick={{ fontSize: 12 }} axisLine={false} tickLine={false} />
          <YAxis
            tickFormatter={(v) =>
              v === 0 ? "€0" : `€${(v / 1000).toFixed(0)}k`
            }
            tick={{ fontSize: 11 }}
            width={50}
            axisLine={false}
            tickLine={false}
          />
          <Tooltip
            formatter={(value: number, name: string) => [
              `€${value.toLocaleString("en-EU", { minimumFractionDigits: 0 })}`,
              name,
            ]}
            cursor={{ fill: "rgba(0,0,0,0.03)" }}
          />
          <Legend iconType="square" wrapperStyle={{ fontSize: 12, paddingTop: 12 }} />

          <Bar dataKey="metaTY" name="Meta (TY)" fill={CHANNEL_COLORS.metaTY} radius={[3, 3, 0, 0]}>
            <LabelList
              dataKey="metaTY"
              position="top"
              style={{ fontSize: 9, fontWeight: 700, fill: CHANNEL_COLORS.metaTY }}
              formatter={(v: unknown) => fmtSpend(Number(v))}
            />
          </Bar>
          <Bar dataKey="metaLY" name="Meta (LY)" fill={CHANNEL_COLORS.metaLY} radius={[3, 3, 0, 0]}>
            <LabelList
              dataKey="metaLY"
              position="top"
              style={{ fontSize: 9, fontWeight: 700, fill: "#60A5FA" }}
              formatter={(v: unknown) => fmtSpend(Number(v))}
            />
          </Bar>
          <Bar dataKey="googleTY" name="Google (TY)" fill={CHANNEL_COLORS.googleTY} radius={[3, 3, 0, 0]}>
            <LabelList
              dataKey="googleTY"
              position="top"
              style={{ fontSize: 9, fontWeight: 700, fill: CHANNEL_COLORS.googleTY }}
              formatter={(v: unknown) => fmtSpend(Number(v))}
            />
          </Bar>
          <Bar dataKey="googleLY" name="Google (LY)" fill={CHANNEL_COLORS.googleLY} radius={[3, 3, 0, 0]}>
            <LabelList
              dataKey="googleLY"
              position="top"
              style={{ fontSize: 9, fontWeight: 700, fill: "#059669" }}
              formatter={(v: unknown) => fmtSpend(Number(v))}
            />
          </Bar>
        </BarChart>
      </ResponsiveContainer>

      {/* ── ROAS by channel table ──────────────────────────────────────── */}
      <div className="mt-6 border-t border-border pt-4">
        <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground mb-3">
          ROAS by Channel
        </p>
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border text-xs text-muted-foreground">
              <th className="text-left py-2 font-medium w-28">Channel</th>
              {BRANDS.map((b) => (
                <th key={b.key} className="text-right py-2 font-medium">
                  {b.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {/* Meta */}
            <tr>
              <td className="py-2.5 text-sm font-medium">
                <span className="inline-flex items-center gap-2">
                  <span className="inline-block h-2.5 w-2.5 rounded-sm bg-[#1877F2] shrink-0" />
                  Meta
                </span>
              </td>
              {BRANDS.map((b) => (
                <td
                  key={b.key}
                  className={`py-2.5 text-right tabular-nums font-bold ${roasColor(roas[b.key].metaRoas)}`}
                >
                  {fmtRoas(roas[b.key].metaRoas)}
                </td>
              ))}
            </tr>
            {/* Google */}
            <tr>
              <td className="py-2.5 text-sm font-medium">
                <span className="inline-flex items-center gap-2">
                  <span className="inline-block h-2.5 w-2.5 rounded-sm bg-[#10B981] shrink-0" />
                  Google
                </span>
              </td>
              {BRANDS.map((b) => (
                <td
                  key={b.key}
                  className={`py-2.5 text-right tabular-nums font-bold ${roasColor(roas[b.key].googleRoas)}`}
                >
                  {fmtRoas(roas[b.key].googleRoas)}
                </td>
              ))}
            </tr>
            {/* Klaviyo */}
            <tr>
              <td className="py-2.5 text-sm font-medium">
                <span className="inline-flex items-center gap-2">
                  <span className="inline-block h-2.5 w-2.5 rounded-sm bg-[#EA4C89] shrink-0" />
                  Klaviyo
                </span>
              </td>
              <td colSpan={3} className="py-2.5 text-right text-xs text-muted-foreground">
                Revenue attribution not tracked — cost is a flat subscription
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </Card>
  );
}
