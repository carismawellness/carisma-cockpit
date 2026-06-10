"use client";

import { Card } from "@/components/ui/card";
import { useKlaviyoFlows, type KlaviyoFlowRow } from "@/lib/hooks/useKlaviyoFlows";
import type { BrandSlug } from "@/lib/types/ads";

interface Props {
  brand: BrandSlug;
  dateFrom: Date;
  dateTo: Date;
  brandColor?: string;
}

function fmtPct(v: number) {
  return `${(v * 100).toFixed(1)}%`;
}

function statusBadge(status: string) {
  const isLive = status === "live";
  return (
    <span
      className={
        "inline-block rounded-full px-2 py-0.5 text-[10px] font-medium " +
        (isLive
          ? "bg-emerald-100 text-emerald-700"
          : "bg-gray-100 text-gray-600")
      }
    >
      {status}
    </span>
  );
}

export function FlowsTable({ brand, dateFrom, dateTo, brandColor }: Props) {
  const { flows, loading, error, tokenMissing } = useKlaviyoFlows({
    brand,
    dateFrom,
    dateTo,
  });

  if (tokenMissing) return null;

  if (loading) {
    return (
      <div className="space-y-2">
        <div className="h-9 bg-gray-100 rounded animate-pulse" />
        <div className="h-9 bg-gray-100 rounded animate-pulse" />
        <div className="h-9 bg-gray-100 rounded animate-pulse" />
      </div>
    );
  }

  if (error) {
    return (
      <p className="text-xs text-gray-500 italic">
        Could not load flow details: {error}
      </p>
    );
  }

  const visible = flows.filter((f: KlaviyoFlowRow) => f.recipients > 0);
  if (visible.length === 0) {
    return (
      <p className="text-sm text-gray-500">
        No flow activity for the selected date range.
      </p>
    );
  }

  return (
    <div className="overflow-x-auto -mx-3 md:mx-0">
      <table className="min-w-full text-sm">
        <thead className="bg-gray-50 text-gray-600">
          <tr>
            <th className="px-3 py-2 text-left font-medium">Flow</th>
            <th className="px-3 py-2 text-right font-medium">Status</th>
            <th className="px-3 py-2 text-right font-medium">Recipients</th>
            <th className="px-3 py-2 text-right font-medium">Delivered</th>
            <th className="px-3 py-2 text-right font-medium">Open Rate</th>
            <th className="px-3 py-2 text-right font-medium">Click Rate</th>
            <th className="px-3 py-2 text-right font-medium">Unsub</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-100">
          {visible.map((f) => (
            <tr key={f.id} className="hover:bg-gray-50">
              <td className="px-3 py-2 font-medium text-gray-900 truncate max-w-[260px]">
                {f.name}
              </td>
              <td className="px-3 py-2 text-right">{statusBadge(f.status)}</td>
              <td className="px-3 py-2 text-right tabular-nums">
                {f.recipients.toLocaleString()}
              </td>
              <td className="px-3 py-2 text-right tabular-nums text-gray-600">
                {f.delivered.toLocaleString()}
              </td>
              <td
                className="px-3 py-2 text-right tabular-nums font-medium"
                style={{ color: brandColor }}
              >
                {fmtPct(f.openRate)}
              </td>
              <td className="px-3 py-2 text-right tabular-nums">
                {fmtPct(f.clickRate)}
              </td>
              <td className="px-3 py-2 text-right tabular-nums text-gray-500">
                {fmtPct(f.unsubscribeRate)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
