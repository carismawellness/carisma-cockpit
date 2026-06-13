"use client";

import { useSpendComparison, type MonthlySpend } from "@/lib/hooks/useSpendComparison";
import { formatCurrency } from "@/lib/charts/config";
import { Card } from "@/components/ui/card";

/* ── helpers ─────────────────────────────────────────────────── */

interface DerivedRow extends MonthlySpend {
  metaYoY:    number | null;
  googleYoY:  number | null;
  totalTY:    number;
  totalLY:    number;
  totalYoY:   number | null;
}

function yoySafe(ty: number, ly: number): number | null {
  return ly > 0 ? Math.round(((ty - ly) / ly) * 100) : null;
}

function derive(d: MonthlySpend): DerivedRow {
  const totalTY = d.metaTY + d.googleTY;
  const totalLY = d.metaLY + d.googleLY;
  return {
    ...d,
    metaYoY:   yoySafe(d.metaTY,  d.metaLY),
    googleYoY: yoySafe(d.googleTY, d.googleLY),
    totalTY,
    totalLY,
    totalYoY:  yoySafe(totalTY, totalLY),
  };
}

// Spend YoY: green = investing more, amber/red = spending less (a warning signal)
function yoyClasses(pct: number | null): string {
  if (pct === null) return "text-gray-400";
  if (pct >= 0)    return "text-emerald-700 bg-emerald-50";
  if (pct >= -10)  return "text-amber-700 bg-amber-50";
  return "text-red-700 bg-red-50";
}

function YoYBadge({ pct }: { pct: number | null }) {
  const label = pct === null ? "—" : `${pct >= 0 ? "+" : ""}${pct}%`;
  return (
    <span
      className={`inline-flex items-center rounded-full px-1.5 py-0.5 text-[10px] font-bold tabular-nums ${yoyClasses(pct)}`}
    >
      {label}
    </span>
  );
}

/* ── skeleton ────────────────────────────────────────────────── */

function Skeleton() {
  return (
    <Card className="p-0 overflow-hidden">
      <div className="px-4 md:px-6 pt-4 pb-2 flex items-center gap-3">
        <span className="skeleton-shimmer h-3 w-40 rounded" />
        <span className="h-px flex-1 bg-[#F0EDE8]" />
      </div>
      <div className="px-4 pb-4 space-y-2">
        {Array.from({ length: 6 }).map((_, i) => (
          <div key={i} className="skeleton-shimmer h-8 w-full rounded" />
        ))}
      </div>
    </Card>
  );
}

/* ── main component ──────────────────────────────────────────── */

export function SpendComparisonTable({
  brand,
  dateFrom,
  dateTo,
}: {
  brand: string;
  dateFrom: Date;
  dateTo: Date;
}) {
  const { data, isLoading } = useSpendComparison(brand, dateFrom, dateTo);

  if (isLoading) return <Skeleton />;
  if (!data || data.length === 0) return null;

  const rows = data.map(derive);

  // Running totals
  let mTY = 0, mLY = 0, gTY = 0, gLY = 0;
  for (const r of rows) { mTY += r.metaTY; mLY += r.metaLY; gTY += r.googleTY; gLY += r.googleLY; }
  const tTY = mTY + gTY;
  const tLY = mLY + gLY;

  return (
    <Card className="p-0 overflow-hidden">
      {/* Section label */}
      <div className="px-4 md:px-6 pt-4 pb-2 flex items-center gap-3">
        <span className="text-[10px] font-bold uppercase tracking-[0.12em] text-muted-foreground">
          Ad Spend — Meta &amp; Google
        </span>
        <span className="h-px flex-1 bg-[#F0EDE8]" />
      </div>

      <div className="overflow-x-auto">
        <table className="w-full min-w-[740px]">
          <thead>
            {/* Group headers */}
            <tr className="border-b border-[#F0EDE8]">
              <th className="px-4 py-1.5 text-left w-24" />
              <th
                colSpan={3}
                className="px-3 py-1.5 text-center text-[10px] font-bold uppercase tracking-widest text-[#6B7280] border-r border-[#F0EDE8]"
              >
                Meta Ads
              </th>
              <th
                colSpan={3}
                className="px-3 py-1.5 text-center text-[10px] font-bold uppercase tracking-widest text-[#6B7280] border-r border-[#F0EDE8]"
              >
                Google Ads
              </th>
              <th
                colSpan={3}
                className="px-3 py-1.5 text-center text-[10px] font-bold uppercase tracking-widest text-[#4B5563]"
              >
                Total Spend
              </th>
            </tr>
            {/* Sub-column headers */}
            <tr className="bg-[#F9F7F4] border-b-2 border-[#E8E4DC]">
              <th className="px-4 py-2 text-left text-[10px] font-semibold uppercase tracking-wide text-muted-foreground w-24">
                Month
              </th>
              <th className="px-3 py-2 text-right text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">TY</th>
              <th className="px-3 py-2 text-right text-[10px] font-semibold uppercase tracking-wide text-[#9CA3AF]">LY</th>
              <th className="px-3 py-2 text-right text-[10px] font-semibold uppercase tracking-wide text-muted-foreground border-r border-[#F0EDE8]">YoY</th>
              <th className="px-3 py-2 text-right text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">TY</th>
              <th className="px-3 py-2 text-right text-[10px] font-semibold uppercase tracking-wide text-[#9CA3AF]">LY</th>
              <th className="px-3 py-2 text-right text-[10px] font-semibold uppercase tracking-wide text-muted-foreground border-r border-[#F0EDE8]">YoY</th>
              <th className="px-3 py-2 text-right text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">TY</th>
              <th className="px-3 py-2 text-right text-[10px] font-semibold uppercase tracking-wide text-[#9CA3AF]">LY</th>
              <th className="px-3 py-2 text-right text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">YoY</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr
                key={r.month}
                className="border-b border-[#F0EDE8] hover:bg-[#FAFAF8] transition-colors"
              >
                <td className="px-4 py-2 text-xs font-semibold text-foreground whitespace-nowrap">{r.month}</td>
                {/* Meta */}
                <td className="px-3 py-2 text-right text-xs tabular-nums font-semibold text-foreground">{formatCurrency(r.metaTY)}</td>
                <td className="px-3 py-2 text-right text-xs tabular-nums text-[#9CA3AF]">{formatCurrency(r.metaLY)}</td>
                <td className="px-3 py-2 text-right border-r border-[#F0EDE8]"><YoYBadge pct={r.metaYoY} /></td>
                {/* Google */}
                <td className="px-3 py-2 text-right text-xs tabular-nums font-semibold text-foreground">{formatCurrency(r.googleTY)}</td>
                <td className="px-3 py-2 text-right text-xs tabular-nums text-[#9CA3AF]">{formatCurrency(r.googleLY)}</td>
                <td className="px-3 py-2 text-right border-r border-[#F0EDE8]"><YoYBadge pct={r.googleYoY} /></td>
                {/* Total */}
                <td className="px-3 py-2 text-right text-xs tabular-nums font-semibold text-foreground">{formatCurrency(r.totalTY)}</td>
                <td className="px-3 py-2 text-right text-xs tabular-nums text-[#9CA3AF]">{formatCurrency(r.totalLY)}</td>
                <td className="px-3 py-2 text-right"><YoYBadge pct={r.totalYoY} /></td>
              </tr>
            ))}
            {/* Totals row */}
            <tr className="bg-[#F5F3EE] border-t-2 border-[#D6D0C4]">
              <td className="px-4 py-2.5 text-[10px] font-bold uppercase tracking-widest text-foreground">Total</td>
              <td className="px-3 py-2.5 text-right text-xs tabular-nums font-bold text-foreground">{formatCurrency(mTY)}</td>
              <td className="px-3 py-2.5 text-right text-xs tabular-nums text-[#9CA3AF]">{formatCurrency(mLY)}</td>
              <td className="px-3 py-2.5 text-right border-r border-[#F0EDE8]"><YoYBadge pct={yoySafe(mTY, mLY)} /></td>
              <td className="px-3 py-2.5 text-right text-xs tabular-nums font-bold text-foreground">{formatCurrency(gTY)}</td>
              <td className="px-3 py-2.5 text-right text-xs tabular-nums text-[#9CA3AF]">{formatCurrency(gLY)}</td>
              <td className="px-3 py-2.5 text-right border-r border-[#F0EDE8]"><YoYBadge pct={yoySafe(gTY, gLY)} /></td>
              <td className="px-3 py-2.5 text-right text-xs tabular-nums font-bold text-foreground">{formatCurrency(tTY)}</td>
              <td className="px-3 py-2.5 text-right text-xs tabular-nums text-[#9CA3AF]">{formatCurrency(tLY)}</td>
              <td className="px-3 py-2.5 text-right"><YoYBadge pct={yoySafe(tTY, tLY)} /></td>
            </tr>
          </tbody>
        </table>
      </div>

      <p className="px-4 md:px-6 pb-3 pt-1.5 text-[10px] text-muted-foreground">
        Monthly totals · LY = same calendar month prior year · Green = increased investment vs LY · Amber/red = spend reduction
      </p>
    </Card>
  );
}
